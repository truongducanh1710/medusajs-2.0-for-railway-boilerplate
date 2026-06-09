import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool, getAuthInfo } from "../../_lib"
import * as https from "https"
import * as http from "http"

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ""
const GEMINI_MODEL = "gemini-3.1-pro-preview"
const GEMINI_BASE = "generativelanguage.googleapis.com"

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

async function callGemini(fileUri: string, prompt: string): Promise<string> {
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
      path: `/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
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

  let fileUri = ""
  try {
    // 1. Upload video Drive → Gemini Files API (stream, không lưu disk)
    fileUri = await uploadToGemini(fileId)

    // 2. Chờ Gemini xử lý xong
    await waitFileActive(fileUri)

    // 3. Gọi Gemini phân tích
    const prompt = `Bạn là chuyên gia phân tích video bán hàng thương mại điện tử Việt Nam.

Sản phẩm: ${row.product || "Không rõ"} (mã: ${row.product_code || "N/A"})
Loại video: ${row.video_type || "Không rõ"}
${row.script ? `Script tham khảo:\n"""\n${row.script}\n"""` : ""}

Xem toàn bộ video, phân tích chi tiết từng cảnh và transcribe chính xác lời thoại.

Trả về JSON THUẦN (không markdown, không code block):
{
  "tong_quan": "mô tả tổng quan nội dung và phong cách video",
  "diem_ban_hang": 8.5,
  "loi_thoai": "toàn bộ lời thoại transcribe chính xác tiếng Việt có dấu",
  "tung_canh": [
    {
      "frame": 1,
      "timestamp": "0s-5s",
      "phan_script": "lời thoại đang được nói tại đoạn này — trích nguyên văn",
      "mo_ta_hinh": "mô tả chi tiết hình ảnh: ai, làm gì, sản phẩm, background",
      "text_overlay": "text thực tế nhìn thấy trên màn hình (subtitle, tiêu đề, giá...)",
      "loai_canh": "hook|problem|demo|testimonial|lifestyle|cta|other",
      "loi_phat_hien": "lỗi phát hiện nếu có (font, màu, mờ, subtitle sai...) hoặc để trống",
      "danh_gia": "đánh giá hiệu quả bán hàng của cảnh này"
    }
  ],
  "bo_cuc": {
    "hook": "phân tích 3-5s đầu",
    "pain_point": "phân tích đoạn nêu vấn đề",
    "solution_demo": "phân tích đoạn demo sản phẩm",
    "cta": "phân tích lời kêu gọi",
    "diem_manh": ["..."],
    "diem_yeu": ["..."]
  },
  "loi_video": ["danh sách lỗi phát hiện trong toàn video nếu có"],
  "goc_do_trien_khai": "đánh giá angle: vấn đề/giải pháp/lifestyle/tính năng/storytelling",
  "danh_gia_visual": "đánh giá chất lượng hình ảnh, màu sắc, ánh sáng, font chữ",
  "khuyen_nghi": ["tip cải thiện cụ thể và khả thi"]
}

Viết toàn bộ bằng tiếng Việt có dấu đầy đủ.`

    const rawContent = await callGemini(fileUri, prompt)

    let aiReview: any
    try {
      aiReview = parseJsonFromContent(rawContent)
    } catch {
      aiReview = { tong_quan: rawContent, diem_ban_hang: null, parse_error: true }
    }

    const aiScore = typeof aiReview.diem_ban_hang === "number" ? aiReview.diem_ban_hang : null

    // 4. Lưu DB
    await pool.query(
      `UPDATE mkt_video SET ai_score = $1, ai_review = $2, updated_at = now() WHERE id = $3`,
      [aiScore, JSON.stringify(aiReview), id]
    )

    return res.json({ ok: true, ai_score: aiScore, ai_review: aiReview })

  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  } finally {
    // Xóa file khỏi Gemini Files API
    if (fileUri) await deleteGeminiFile(fileUri).catch(() => {})
  }
}
