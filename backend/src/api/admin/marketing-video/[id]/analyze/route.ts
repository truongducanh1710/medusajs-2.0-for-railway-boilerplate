import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool, getAuthInfo } from "../../_lib"
import * as https from "https"
import * as http from "http"

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ""
const GEMINI_MODEL_DEFAULT = "gemini-3.1-pro-preview"
const GEMINI_BASE = "generativelanguage.googleapis.com"

const ALLOWED_MODELS = new Set([
  "gemini-3.1-pro-preview", "gemini-3-pro-preview", "gemini-2.5-pro",
  "gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-3-flash-preview", "gemini-2.5-flash",
])

function extractDriveFileId(link: string): string | null {
  const m = link.match(/\/d\/([a-zA-Z0-9_-]+)/)
  if (m) return m[1]
  const m2 = link.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  if (m2) return m2[1]
  return null
}

// Download Drive video → pipe thẳng lên Gemini Files API (không lưu disk)
async function uploadToGemini(fileId: string): Promise<string> {
  // Step 1: Lấy content-length từ Drive
  const driveUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`

  // HEAD request để lấy content-length
  const contentLength = await new Promise<number>((resolve) => {
    https.request(driveUrl, { method: "HEAD", headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      const loc = res.headers.location
      if (loc && res.statusCode && res.statusCode >= 300) {
        // follow redirect một lần
        https.request(loc, { method: "HEAD" }, (r2) => {
          resolve(parseInt(r2.headers["content-length"] || "0", 10))
          r2.resume()
        }).end()
      } else {
        resolve(parseInt(res.headers["content-length"] || "0", 10))
        res.resume()
      }
    }).end()
  })

  const fileSize = contentLength || 35000000

  // Step 2: Initiate resumable upload trên Gemini Files API
  const initBody = Buffer.from(JSON.stringify({ file: { display_name: `analyze-${fileId}` } }), "utf-8")
  const uploadUrl = await new Promise<string>((resolve, reject) => {
    const req = https.request({
      hostname: GEMINI_BASE,
      path: `/upload/v1beta/files?key=${GEMINI_API_KEY}`,
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": fileSize,
        "X-Goog-Upload-Header-Content-Type": "video/mp4",
        "Content-Type": "application/json",
        "Content-Length": initBody.length,
      },
    }, (res) => {
      const url = res.headers["x-goog-upload-url"] as string
      res.resume()
      if (url) resolve(url)
      else reject(new Error("No upload URL from Gemini Files API"))
    })
    req.on("error", reject)
    req.write(initBody)
    req.end()
  })

  // Step 3: Stream Drive video → Gemini upload URL
  const fileUri = await new Promise<string>((resolve, reject) => {
    // Download từ Drive
    const followDrive = (u: string, redirects = 8) => {
      const mod = u.startsWith("https") ? https : http
      mod.get(u, { headers: { "User-Agent": "Mozilla/5.0" } }, (driveRes) => {
        if (driveRes.statusCode && driveRes.statusCode >= 300 && driveRes.headers.location) {
          if (redirects <= 0) return reject(new Error("Too many redirects"))
          driveRes.resume()
          return followDrive(driveRes.headers.location, redirects - 1)
        }
        if (driveRes.statusCode !== 200) {
          driveRes.resume()
          return reject(new Error(`Drive HTTP ${driveRes.statusCode}`))
        }
        const ct = driveRes.headers["content-type"] || ""
        if (ct.includes("text/html")) {
          driveRes.resume()
          return reject(new Error("Drive trả HTML — file cần quyền 'Anyone with link can view'"))
        }

        // Pipe vào Gemini upload URL
        const uploadUrlObj = new URL(uploadUrl)
        const uploadReq = https.request({
          hostname: uploadUrlObj.hostname,
          path: uploadUrlObj.pathname + uploadUrlObj.search,
          method: "POST",
          headers: {
            "Content-Length": fileSize,
            "X-Goog-Upload-Command": "upload, finalize",
            "X-Goog-Upload-Offset": "0",
            "Content-Type": "video/mp4",
          },
        }, (uploadRes) => {
          const chunks: Buffer[] = []
          uploadRes.on("data", (c) => chunks.push(c))
          uploadRes.on("end", () => {
            try {
              const result = JSON.parse(Buffer.concat(chunks).toString("utf-8"))
              const uri = result?.file?.uri
              if (uri) resolve(uri)
              else reject(new Error("No file URI: " + JSON.stringify(result)))
            } catch (e) { reject(e) }
          })
        })
        uploadReq.on("error", reject)
        driveRes.pipe(uploadReq)
      }).on("error", reject)
    }
    followDrive(driveUrl)
  })

  return fileUri
}

async function waitFileActive(fileUri: string, maxWait = 30000): Promise<void> {
  const fileId = fileUri.split("/").pop()!
  const start = Date.now()
  while (Date.now() - start < maxWait) {
    const state = await new Promise<string>((resolve, reject) => {
      https.get({
        hostname: GEMINI_BASE,
        path: `/v1beta/files/${fileId}?key=${GEMINI_API_KEY}`,
      }, (res) => {
        const chunks: Buffer[] = []
        res.on("data", c => chunks.push(c))
        res.on("end", () => {
          try {
            const r = JSON.parse(Buffer.concat(chunks).toString("utf-8"))
            resolve(r.state || "UNKNOWN")
          } catch { resolve("ERROR") }
        })
      }).on("error", reject)
    })
    if (state === "ACTIVE") return
    if (state === "FAILED") throw new Error("Gemini file processing FAILED")
    await new Promise(r => setTimeout(r, 2000))
  }
  throw new Error("Timeout waiting for Gemini file ACTIVE")
}

async function deleteGeminiFile(fileUri: string): Promise<void> {
  const fileId = fileUri.split("/").pop()!
  await new Promise<void>((resolve) => {
    const req = https.request({
      hostname: GEMINI_BASE,
      path: `/v1beta/files/${fileId}?key=${GEMINI_API_KEY}`,
      method: "DELETE",
    }, (res) => { res.resume(); resolve() })
    req.on("error", () => resolve())
    req.end()
  })
}

async function callGemini(fileUri: string, prompt: string, model = GEMINI_MODEL_DEFAULT): Promise<string> {
  const body = Buffer.from(JSON.stringify({
    contents: [{
      parts: [
        { file_data: { mime_type: "video/mp4", file_uri: fileUri } },
        { text: prompt },
      ]
    }],
    generationConfig: { temperature: 0.3 },
  }), "utf-8")

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: GEMINI_BASE,
      path: `/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": body.length,
      },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on("data", c => chunks.push(c))
      res.on("end", () => {
        try {
          const r = JSON.parse(Buffer.concat(chunks).toString("utf-8"))
          const text = r?.candidates?.[0]?.content?.parts?.[0]?.text
          if (text) resolve(text)
          else reject(new Error(r?.error?.message || JSON.stringify(r)))
        } catch (e) { reject(e) }
      })
    })
    req.on("error", reject)
    req.write(body)
    req.end()
  })
}

function parseJsonFromContent(content: string): any {
  const stripped = content.replace(/^```json\s*/m, "").replace(/\s*```\s*$/m, "").trim()
  const start = stripped.indexOf("{")
  const end = stripped.lastIndexOf("}")
  if (start === -1 || end === -1) throw new Error("No JSON object found")
  return JSON.parse(stripped.slice(start, end + 1))
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthenticated" })

  const id = (req.params as any).id
  const pool = getPool()

  const { rows } = await pool.query(
    `SELECT link, product, product_code, video_type, script FROM mkt_video WHERE id = $1`,
    [id]
  )
  if (!rows.length) return res.status(404).json({ error: "Không tìm thấy video" })

  const row = rows[0]
  if (!row.link) return res.status(400).json({ error: "Video chưa có link Drive" })

  const fileId = extractDriveFileId(row.link)
  if (!fileId) return res.status(400).json({ error: "Không nhận ra link Google Drive" })

  if (!GEMINI_API_KEY) return res.status(500).json({ error: "Thiếu GEMINI_API_KEY" })

  const body = req.body as any
  const requestedModel = (body?.model && ALLOWED_MODELS.has(body.model)) ? body.model : GEMINI_MODEL_DEFAULT

  let fileUri = ""
  try {
    // 1. Upload video Drive → Gemini Files API (stream, không lưu disk)
    fileUri = await uploadToGemini(fileId)

    // 2. Chờ Gemini xử lý xong
    await waitFileActive(fileUri)

    // 3. Gọi Gemini phân tích
    const prompt = `Bạn là quản lý Ads Performance với 10 năm kinh nghiệm chạy quảng cáo Facebook/TikTok cho thị trường Việt Nam, chuyên ngành đồ gia dụng. Bạn KHÓ TÍNH, không chấp nhận video trung bình — mục tiêu duy nhất là video phải khiến người xem DỪNG LẠI, MUỐN MUA và BẤM ĐẶT HÀNG NGAY.

Bạn đã review hàng nghìn video ads, biết chính xác giây nào người xem thoát, câu nào tạo desire, hình ảnh nào trigger mua hàng.

## THÔNG TIN VIDEO
- Sản phẩm: ${row.product || "Không rõ"} (mã: ${row.product_code || "N/A"})
- Loại video: ${row.video_type || "Không rõ"} ${row.video_type === "Real" ? "(người thật review/demo — UGC)" : row.video_type === "Video AI" ? "(AI generated — cần chú ý tính chân thực)" : ""}
${row.script ? `- Script gốc:\n"""\n${row.script}\n"""` : "- Script: không có sẵn (tự transcribe từ audio)"}

## NHIỆM VỤ — xem TOÀN BỘ video từ đầu đến cuối:
1. **Transcribe** 100% lời thoại/voiceover — tiếng Việt có dấu, giữ nguyên cách nói
2. **Phân tích từng cảnh** — KHÔNG gom cảnh, mỗi lần góc quay thay đổi hoặc nội dung chuyển sang ý mới là 1 cảnh riêng. Video 20-30s thường có 8-15 cảnh, không phải 5. Ghi timestamp chính xác theo thực tế video.
3. **Chấm điểm khắt khe** theo rubric — điểm 7+ phải thực sự xứng đáng, không cho điểm đẹp
4. **Phán xét thẳng thắn** từng điểm yếu — cụ thể đến từng giây, từng câu, từng hình ảnh

## RUBRIC CHẤM ĐIỂM (diem_ban_hang 0-10, khắt khe):
- **Hook 0-3s**: Có khiến người đang scroll DỪNG lại không? Hình ảnh/câu đầu có gây tò mò, shock, hoặc đánh đúng nỗi đau không? (2đ — chỉ 2đ nếu stop-scroll rate dự kiến >40%)
- **Demo sản phẩm**: Tính năng được thể hiện có THUYẾT PHỤC không? Người xem có hình dung được lợi ích thực tế không? Có "aha moment" không? (3đ)
- **Lời thoại & cảm xúc**: Giọng nói tự nhiên hay đọc script? Có tạo được DESIRE — người xem muốn có sản phẩm này không? Có trust không? (2đ)
- **CTA & Urgency**: Có lý do để bấm MUA NGAY không? Offer có hấp dẫn không? Urgency có thật không? (1đ)
- **Chất lượng kỹ thuật**: Hình ảnh sắc nét, ánh sáng tốt, âm thanh rõ, edit mượt không? (2đ)

## YÊU CẦU PHÂN TÍCH SÂU:
- Với mỗi điểm yếu: chỉ rõ tại sao nó gây hại cho conversion, và viết lại cụ thể nên sửa thành gì
- Phân tích tâm lý người mua: video này tác động vào trigger mua hàng nào (FOMO, social proof, pain relief, aspirational, value...)
- Dự đoán "điểm thoát" — giây nào người xem có khả năng cao thoát ra và tại sao
- So sánh với benchmark UGC review tốt trên thị trường VN

## OUTPUT — JSON THUẦN, không markdown, không giải thích ngoài JSON:
{
  "tong_quan": "2-3 câu nhận xét tổng thể thẳng thắn — style, angle, điểm mạnh/yếu lớn nhất",
  "nhan_xet_quanly": "đoạn nhận xét 4-6 câu từ góc độ quản lý ads: video này có chạy được không, tại sao, cần sửa gì trước khi boost budget",
  "diem_ban_hang": 7.5,
  "diem_chi_tiet": { "hook": 1.5, "demo": 2.5, "loi_thoai": 1.5, "cta": 0.5, "chat_luong": 1.5 },
  "ly_giai_diem": {
    "hook": "giải thích cụ thể tại sao cho điểm này — hook có làm người xem dừng không, câu/hình đầu tiên là gì, đủ mạnh chưa",
    "demo": "tính năng nào được demo tốt, tính năng nào chưa rõ, có 'aha moment' không",
    "loi_thoai": "giọng có tự nhiên không, câu nào đọc script lộ, câu nào tạo được emotion/desire",
    "cta": "offer cụ thể là gì, urgency có thật không, có lý do mua ngay không",
    "chat_luong": "ánh sáng, góc quay, edit, subtitle — cái gì ổn, cái gì cần fix"
  },
  "loi_thoai": "TOÀN BỘ transcript chính xác từng câu, giữ nguyên cách nói tự nhiên, không tóm tắt",
  "phan_tich_tam_ly": {
    "trigger_chinh": "trigger mua hàng chính video đang dùng: pain_relief|fomo|social_proof|aspirational|value_deal|curiosity",
    "trigger_hieu_qua": "trigger nào đang hoạt động tốt và tại sao",
    "trigger_thieu": "trigger nào nên thêm vào để tăng conversion",
    "diem_thoat_du_doan": "timestamp dự đoán người xem thoát nhiều nhất và lý do tâm lý"
  },
  "tung_canh": [
    {
      "stt": 1,
      "timestamp": "0s-4s",
      "loai_canh": "hook|problem|demo|social_proof|cta|outro|other",
      "loi_thoai_canh": "lời thoại nguyên văn tại cảnh này",
      "mo_ta_hinh": "góc quay, chủ thể, hành động, background, ánh sáng — cụ thể",
      "text_overlay": "text/subtitle trên màn hình (để trống nếu không có)",
      "am_thanh": "nhạc nền/hiệu ứng âm thanh đặc biệt",
      "hieu_qua_ban_hang": "cảnh này tác động gì đến người xem — tạo emotion gì, có giữ chân không",
      "diem_yeu_canh": "điểm yếu cụ thể của cảnh này nếu có (để trống nếu tốt)",
      "loi_ky_thuat": "lỗi kỹ thuật nếu có: mờ, rung, cắt đột ngột, subtitle sai... (để trống nếu ok)"
    }
  ],
  "phan_tich_bo_cuc": {
    "hook_manh": true,
    "co_pain_point": true,
    "co_demo_ro": true,
    "co_social_proof": false,
    "cta_ro_rang": true,
    "nhan_xet": "nhận xét về narrative flow — bố cục có dẫn dắt người xem đến hành động mua không"
  },
  "am_thanh_tong_the": "nhận xét chi tiết: nhạc có phù hợp mood không, voiceover có truyền cảm không, có âm thanh nào distract không",
  "danh_gia_visual": "nhận xét chi tiết: màu sắc, ánh sáng, góc quay, font subtitle, edit rhythm",
  "goc_do_trien_khai": "angle chính: storytelling|demo|ugc|asmr|comparison|lifestyle|education",
  "loi_video": [
    "LỖI 1: [tên lỗi] — tại sao ảnh hưởng conversion — sửa thành: [hướng dẫn cụ thể]",
    "LỖI 2: ..."
  ],
  "diem_manh": [
    "ĐIỂM MẠNH 1: [cụ thể] — tại sao hiệu quả với người mua VN",
    "ĐIỂM MẠNH 2: ..."
  ],
  "viet_lai_de_xuat": {
    "hook_moi": "viết lại câu hook 3s đầu mạnh hơn — cụ thể, có thể dùng ngay",
    "cta_moi": "viết lại CTA cuối mạnh hơn, có urgency thật",
    "canh_nen_them": "mô tả 1-2 cảnh nên thêm vào để tăng desire hoặc trust"
  },
  "ket_luan_quanly": "kết luận 2-3 câu: video này CÓ NÊN chạy ads không, ngân sách test bao nhiêu là hợp lý, ưu tiên sửa gì TRƯỚC KHI boost"
}

Viết toàn bộ tiếng Việt có dấu. KHÔNG khen chung chung. KHÔNG dùng từ "khá tốt", "ổn", "được" — phải cụ thể.`

    const rawContent = await callGemini(fileUri, prompt, requestedModel)

    let aiReview: any
    try {
      aiReview = parseJsonFromContent(rawContent)
    } catch {
      aiReview = { tong_quan: rawContent, diem_ban_hang: null, parse_error: true }
    }

    const aiScore = typeof aiReview.diem_ban_hang === "number" ? aiReview.diem_ban_hang : null

    // 4. Lưu DB — nếu chưa có script thì bổ sung lời thoại transcribe vào cột script
    const newScript = (!row.script && aiReview.loi_thoai) ? aiReview.loi_thoai : null
    if (newScript) {
      await pool.query(
        `UPDATE mkt_video SET ai_score = $1, ai_review = $2, script = $3, updated_at = now() WHERE id = $4`,
        [aiScore, JSON.stringify(aiReview), newScript, id]
      )
    } else {
      await pool.query(
        `UPDATE mkt_video SET ai_score = $1, ai_review = $2, updated_at = now() WHERE id = $3`,
        [aiScore, JSON.stringify(aiReview), id]
      )
    }

    return res.json({ ok: true, ai_score: aiScore, ai_review: aiReview })

  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  } finally {
    // Xóa file khỏi Gemini Files API
    if (fileUri) await deleteGeminiFile(fileUri).catch(() => {})
  }
}
