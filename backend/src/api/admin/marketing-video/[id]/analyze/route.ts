import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool, getAuthInfo } from "../../_lib"
import { execSync, spawnSync } from "child_process"
import * as fs from "fs"
import * as path from "path"
import * as https from "https"
import * as http from "http"

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ""
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
const GEMINI_MODEL = "google/gemini-3-flash-preview"
const N_FRAMES = 20

function extractDriveFileId(link: string): string | null {
  const m = link.match(/\/d\/([a-zA-Z0-9_-]+)/)
  if (m) return m[1]
  const m2 = link.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  if (m2) return m2[1]
  return null
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const follow = (u: string, redirects = 5) => {
      const mod = u.startsWith("https") ? https : http
      mod.get(u, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirects <= 0) return reject(new Error("Too many redirects"))
          return follow(res.headers.location, redirects - 1)
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`))
        const out = fs.createWriteStream(dest)
        res.pipe(out)
        out.on("finish", () => { out.close(); resolve() })
        out.on("error", reject)
      }).on("error", reject)
    }
    follow(url)
  })
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
        try {
          const text = Buffer.concat(chunks).toString("utf-8")
          resolve(JSON.parse(text))
        } catch (e) { reject(e) }
      })
    })
    req.on("error", reject)
    req.write(body)
    req.end()
  })
}

function parseJsonFromContent(content: string): any {
  // Strip markdown code block nếu có
  const stripped = content.replace(/^```json\s*/m, "").replace(/\s*```\s*$/m, "").trim()
  // Tìm JSON object đầu tiên
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

  // Lấy thông tin video
  const { rows } = await pool.query(
    `SELECT link, product, product_code, video_type, script FROM mkt_video WHERE id = $1`,
    [id]
  )
  if (!rows.length) return res.status(404).json({ error: "Không tìm thấy video" })

  const row = rows[0]
  if (!row.link) return res.status(400).json({ error: "Video chưa có link Drive" })

  const fileId = extractDriveFileId(row.link)
  if (!fileId) return res.status(400).json({ error: "Không nhận ra link Google Drive" })

  const tmpDir = `/tmp/analyze_${id}`
  const videoPath = `${tmpDir}/video.mp4`
  const audioPath = `${tmpDir}/audio.mp3`
  const frameDir = `${tmpDir}/frames`

  try {
    fs.mkdirSync(tmpDir, { recursive: true })
    fs.mkdirSync(frameDir, { recursive: true })

    // 1. Download video
    const downloadUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download`
    await downloadFile(downloadUrl, videoPath)

    if (!fs.existsSync(videoPath) || fs.statSync(videoPath).size < 10000) {
      return res.status(400).json({ error: "Không download được video từ Drive (file quá nhỏ hoặc lỗi)" })
    }

    // 2. Lấy duration
    const probe = spawnSync("ffprobe", [
      "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", videoPath
    ])
    const duration = parseFloat(probe.stdout?.toString().trim() || "60")

    // 3. Extract N_FRAMES frames
    const timestamps: number[] = []
    for (let i = 1; i <= N_FRAMES; i++) {
      timestamps.push(parseFloat((duration * i / (N_FRAMES + 1)).toFixed(2)))
    }

    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i]
      const framePath = path.join(frameDir, `frame_${String(i + 1).padStart(3, "0")}.jpg`)
      spawnSync("ffmpeg", [
        "-ss", String(ts), "-i", videoPath,
        "-frames:v", "1", "-q:v", "4", "-vf", "scale=640:-1",
        framePath, "-y", "-loglevel", "quiet"
      ])
    }

    // 4. Extract + transcribe audio (nếu chưa có script)
    let transcript = row.script || ""
    if (!transcript) {
      spawnSync("ffmpeg", [
        "-i", videoPath, "-vn", "-ar", "16000", "-ac", "1", "-b:a", "32k",
        audioPath, "-y", "-loglevel", "quiet"
      ])

      if (fs.existsSync(audioPath) && fs.statSync(audioPath).size > 1000) {
        const audioB64 = fs.readFileSync(audioPath).toString("base64")
        const transcribeResp = await callOpenRouter([{
          role: "user",
          content: [
            { type: "input_audio", input_audio: { data: audioB64, format: "mp3" } },
            { type: "text", text: "Transcribe toàn bộ nội dung audio này sang tiếng Việt có dấu đầy đủ. Chỉ trả về text transcript, không thêm gì khác." }
          ]
        }])
        transcript = transcribeResp?.choices?.[0]?.message?.content || ""
      }
    }

    // 5. Build content array với frames + prompt
    const content: any[] = []
    const frameFiles = fs.readdirSync(frameDir).sort()
    for (let i = 0; i < frameFiles.length; i++) {
      const framePath = path.join(frameDir, frameFiles[i])
      if (!fs.existsSync(framePath)) continue
      const b64 = fs.readFileSync(framePath).toString("base64")
      const ts = timestamps[i] ?? 0
      content.push({ type: "text", text: `[Frame ${i + 1} tại ${ts}s]` })
      content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } })
    }

    const prompt = `Bạn là chuyên gia phân tích video bán hàng thương mại điện tử Việt Nam.

Trên đây là ${frameFiles.length} frames trích từ video theo thứ tự thời gian (video dài ~${Math.round(duration)}s).

Sản phẩm: ${row.product || "Không rõ"} (mã: ${row.product_code || "N/A"})
Loại video: ${row.video_type || "Không rõ"}
Script/Lời thoại đầy đủ:
"""
${transcript || "Không có script — chỉ phân tích từ hình ảnh"}
"""

Dựa vào ${frameFiles.length} frames VÀ script trên, phân tích chi tiết TỪNG CẢNH video, khớp phần script đang được đọc tại mỗi frame. Phát hiện lỗi nếu có (font chữ sai, subtitle lỗi, cảnh mờ, màu sắc không nhất quán, v.v.)

Trả về JSON THUẦN (không markdown, không code block):
{
  "tong_quan": "mô tả tổng quan nội dung và phong cách video",
  "diem_ban_hang": 8.5,
  "tung_canh": [
    {
      "frame": 1,
      "timestamp": "4.4s",
      "phan_script": "phần script đang được đọc tại timestamp này — trích nguyên văn tiếng Việt",
      "mo_ta_hinh": "mô tả chi tiết hình ảnh: ai, làm gì, sản phẩm, background",
      "text_overlay": "text thực tế nhìn thấy trong hình (subtitle, tiêu đề, giá...)",
      "loai_canh": "hook|problem|demo|testimonial|lifestyle|cta|other",
      "loi_phat_hien": "lỗi phát hiện được nếu có (font, màu, mờ, subtitle sai...) hoặc để trống",
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

    content.push({ type: "text", text: prompt })

    // 6. Gọi Gemini phân tích
    const analysisResp = await callOpenRouter([{ role: "user", content }])
    const rawContent = analysisResp?.choices?.[0]?.message?.content || ""
    if (!rawContent) return res.status(500).json({ error: "Model không trả về kết quả" })

    let aiReview: any
    try {
      aiReview = parseJsonFromContent(rawContent)
    } catch {
      // Nếu parse lỗi, lưu raw text vào note
      aiReview = { tong_quan: rawContent, diem_ban_hang: null, parse_error: true }
    }

    const aiScore = typeof aiReview.diem_ban_hang === "number" ? aiReview.diem_ban_hang : null
    // Gắn transcript vào kết quả nếu mới transcribe
    if (transcript && !row.script) aiReview._transcript = transcript

    // 7. Lưu DB
    await pool.query(
      `UPDATE mkt_video SET ai_score = $1, ai_review = $2, updated_at = now() WHERE id = $3`,
      [aiScore, JSON.stringify(aiReview), id]
    )

    return res.json({ ok: true, ai_score: aiScore, ai_review: aiReview })

  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  } finally {
    // Cleanup tmp files
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
}
