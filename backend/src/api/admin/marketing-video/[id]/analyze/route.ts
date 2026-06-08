import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool, getAuthInfo } from "../../_lib"
import { Client } from "minio"
import * as https from "https"
import { ulid } from "ulid"

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ""
const GEMINI_MODEL = "google/gemini-2.5-pro-preview"

function extractDriveFileId(link: string): string | null {
  const m = link.match(/\/d\/([a-zA-Z0-9_-]+)/)
  if (m) return m[1]
  const m2 = link.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  if (m2) return m2[1]
  return null
}

function getMinioClient() {
  const endpoint = process.env.MINIO_ENDPOINT!
  const accessKey = process.env.MINIO_ACCESS_KEY!
  const secretKey = process.env.MINIO_SECRET_KEY!
  let host = endpoint.replace(/^https?:\/\//, "").replace(/\/$/, "")
  const useSSL = !endpoint.startsWith("http://")
  let port = useSSL ? 443 : 80
  const pm = host.match(/:(\d+)$/)
  if (pm) { port = parseInt(pm[1], 10); host = host.replace(/:\d+$/, "") }
  return new Client({ endPoint: host, port, useSSL, accessKey, secretKey, pathStyle: true, region: "us-east-1" })
}

function callOpenRouter(messages: any[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify({ model: GEMINI_MODEL, messages }), "utf-8")
    const req = https.request({
      hostname: "openrouter.ai",
      path: "/api/v1/chat/completions",
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json; charset=utf-8",
        "HTTP-Referer": "https://api.phanviet.vn",
        "Content-Length": body.length,
      },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on("data", (c) => chunks.push(c))
      res.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8"))) }
        catch (e) { reject(e) }
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

  const body = req.body as any
  if (!body?.videoBase64) {
    return res.status(400).json({ error: "Thiếu videoBase64 — frontend phải fetch video trước" })
  }

  const bucket = process.env.MINIO_BUCKET || "medusa-media"
  const minio = getMinioClient()
  const fileKey = `tmp-analyze-${id}-${ulid()}.mp4`
  let minioUrl = ""

  try {
    // 1. Upload video lên MinIO
    const videoBuf = Buffer.from(body.videoBase64, "base64")
    await minio.putObject(bucket, fileKey, videoBuf, videoBuf.length, {
      "Content-Type": "video/mp4",
      "x-amz-acl": "public-read",
    })

    const endpoint = process.env.MINIO_ENDPOINT!.replace(/\/$/, "")
    minioUrl = `${endpoint}/${bucket}/${fileKey}`

    // 2. Gọi Gemini với video URL — Gemini 2.5 Pro hiểu video native
    const prompt = `Bạn là chuyên gia phân tích video bán hàng thương mại điện tử Việt Nam.

Sản phẩm: ${row.product || "Không rõ"} (mã: ${row.product_code || "N/A"})
Loại video: ${row.video_type || "Không rõ"}
${row.script ? `Script/Lời thoại:\n"""\n${row.script}\n"""` : ""}

Xem toàn bộ video này và phân tích chi tiết từng cảnh, lời thoại, lỗi phát hiện được.

Trả về JSON THUẦN (không markdown, không code block):
{
  "tong_quan": "mô tả tổng quan nội dung và phong cách video",
  "diem_ban_hang": 8.5,
  "tung_canh": [
    {
      "frame": 1,
      "timestamp": "0s-5s",
      "phan_script": "phần lời thoại đang được nói tại đoạn này — trích nguyên văn",
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

    const analysisResp = await callOpenRouter([{
      role: "user",
      content: [
        { type: "image_url", image_url: { url: minioUrl } },
        { type: "text", text: prompt },
      ]
    }])

    const rawContent = analysisResp?.choices?.[0]?.message?.content || ""
    if (!rawContent) {
      const errMsg = analysisResp?.error?.message || JSON.stringify(analysisResp?.error) || "Model không trả về kết quả"
      return res.status(500).json({ error: errMsg })
    }

    let aiReview: any
    try {
      aiReview = parseJsonFromContent(rawContent)
    } catch {
      aiReview = { tong_quan: rawContent, diem_ban_hang: null, parse_error: true }
    }

    const aiScore = typeof aiReview.diem_ban_hang === "number" ? aiReview.diem_ban_hang : null

    await pool.query(
      `UPDATE mkt_video SET ai_score = $1, ai_review = $2, updated_at = now() WHERE id = $3`,
      [aiScore, JSON.stringify(aiReview), id]
    )

    return res.json({ ok: true, ai_score: aiScore, ai_review: aiReview })

  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  } finally {
    // Xóa video tạm khỏi MinIO
    try { await minio.removeObject(bucket, fileKey) } catch {}
  }
}
