import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import OpenAI from "openai"
import { Client } from "minio"

interface Scrape1688Data {
  title: string
  description: string
  images: string[]
  specs: Record<string, string>
  price: string
  url: string
  reviews?: string[]
  rating?: string
}

interface AIContent {
  title_vi: string
  description_vi: string
  benefits: Array<{ icon: string; title: string; desc: string }>
  pains: string[]
  solutions: string[]
  faq: Array<{ q: string; a: string }>
  specs_vi: Record<string, string>
  reviews_vi: Array<{ name: string; location: string; rating: number; text: string; date: string }>
}

// ── MinIO ──────────────────────────────────────────────────────────────────
function getMinioClient() {
  const endpoint = process.env.MINIO_ENDPOINT!
  const bucket = process.env.MINIO_BUCKET || "medusa-media"
  let host = endpoint.replace(/^https?:\/\//, "").replace(/\/$/, "")
  const useSSL = !endpoint.startsWith("http://")
  let port = useSSL ? 443 : 80
  const pm = host.match(/:(\d+)$/)
  if (pm) { port = parseInt(pm[1], 10); host = host.replace(/:\d+$/, "") }
  const client = new Client({
    endPoint: host, port, useSSL,
    accessKey: process.env.MINIO_ACCESS_KEY!,
    secretKey: process.env.MINIO_SECRET_KEY!,
    pathStyle: true, region: "us-east-1",
  })
  return { client, bucket }
}

function getPublicUrl(bucket: string, key: string): string {
  const endpoint = process.env.MINIO_ENDPOINT!.replace(/\/$/, "")
  return `${endpoint}/${bucket}/${key}`
}

// Download URL → upload MinIO → return public URL
async function uploadImageFromUrl(imageUrl: string, folder: string): Promise<string> {
  const { client, bucket } = getMinioClient()

  // Fetch ảnh
  const resp = await fetch(imageUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  })
  if (!resp.ok) throw new Error(`Cannot fetch image: ${resp.status}`)

  const buffer = Buffer.from(await resp.arrayBuffer())
  const contentType = resp.headers.get("content-type") || "image/jpeg"
  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg"
  const filename = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`

  await client.putObject(bucket, filename, buffer, buffer.length, { "Content-Type": contentType })
  return getPublicUrl(bucket, filename)
}

// Upload nhiều ảnh song song, bỏ qua lỗi từng ảnh
async function uploadImages(urls: string[], folder: string): Promise<string[]> {
  const results = await Promise.allSettled(
    urls.slice(0, 12).map(url => uploadImageFromUrl(url, folder))
  )
  return results
    .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
    .map(r => r.value)
}

// ── AI Content ─────────────────────────────────────────────────────────────
async function generateContent(data: Scrape1688Data): Promise<AIContent> {
  const client = new OpenAI({
    baseURL: "https://api.deepseek.com",
    apiKey: process.env.DEEPSEEK_API_KEY!,
  })

  const specsText = Object.entries(data.specs).slice(0, 20).map(([k, v]) => `${k}: ${v}`).join("\n")

  const prompt = `Bạn là chuyên gia viết content marketing bán hàng online Việt Nam cho cửa hàng đồ gia dụng Phan Viet.

Thông tin sản phẩm từ 1688/AliExpress:
Tên gốc: ${data.title}
Mô tả: ${data.description.slice(0, 600)}
Thông số:
${specsText || "(không có)"}
Rating gốc: ${data.rating || "(không có)"}
Giá: ${data.price || "(không có)"}

Trả về JSON thuần túy (không markdown), format:
{
  "title_vi": "Tên sản phẩm tiếng Việt, ngắn gọn hấp dẫn, tối đa 80 ký tự",
  "description_vi": "Mô tả 2-3 câu, nhấn mạnh công dụng và lợi ích cho gia đình Việt",
  "benefits": [
    {"icon": "✅", "title": "Lợi ích ngắn", "desc": "Giải thích thêm 1 câu"},
    {"icon": "⚡", "title": "Lợi ích 2", "desc": "..."},
    {"icon": "🔒", "title": "Lợi ích 3", "desc": "..."},
    {"icon": "💡", "title": "Lợi ích 4", "desc": "..."}
  ],
  "pains": ["Vấn đề khách hàng 1", "Vấn đề 2", "Vấn đề 3"],
  "solutions": ["Giải pháp 1", "Giải pháp 2", "Giải pháp 3"],
  "faq": [
    {"q": "Câu hỏi 1?", "a": "Trả lời"},
    {"q": "Câu hỏi 2?", "a": "Trả lời"},
    {"q": "Câu hỏi 3?", "a": "Trả lời"}
  ],
  "specs_vi": {"Chất liệu": "...", "Kích thước": "...", "Xuất xứ": "Trung Quốc"},
  "reviews_vi": [
    {"name": "Tên người Việt", "location": "Hà Nội", "rating": 5, "text": "Nhận xét chân thực 1-2 câu về sản phẩm này, đúng với tính năng thực tế", "date": "2 ngày trước"},
    {"name": "...", "location": "TP.HCM", "rating": 5, "text": "...", "date": "1 tuần trước"},
    {"name": "...", "location": "Đà Nẵng", "rating": 5, "text": "...", "date": "2 tuần trước"},
    {"name": "...", "location": "Hải Phòng", "rating": 4, "text": "...", "date": "3 tuần trước"},
    {"name": "...", "location": "Cần Thơ", "rating": 5, "text": "...", "date": "1 tháng trước"}
  ]
}

Lưu ý reviews_vi: viết tự nhiên như người thật, đa dạng giới tính (nam/nữ), đề cập đúng tính năng sản phẩm này, không copy nhau, không dùng từ ngữ quảng cáo lộ liễu.`

  const model = "deepseek-chat"
  const completion = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    max_tokens: 2500,
    temperature: 0.7,
  })

  const raw = completion.choices[0]?.message?.content ?? ""
  const jsonStr = raw.replace(/^```json?\s*/i, "").replace(/```\s*$/, "").trim()
  return JSON.parse(jsonStr) as AIContent
}

// ── Parse giá từ string ────────────────────────────────────────────────────
function parsePriceVND(priceStr: string): number {
  if (!priceStr) return 0
  // "₫28,679" → 28679
  const vndMatch = priceStr.match(/[₫đ][\s]*([\d,. ]+)/)
  if (vndMatch) {
    const digits = vndMatch[1].replace(/[,. ]/g, "")
    // nếu < 1000 thì đơn vị nghìn đồng (VD: "₫280" → 280,000)
    const num = parseFloat(digits)
    return num < 10000 ? num * 1000 : num
  }
  // "¥40.00" → estimate CNY × 3500
  const cnyMatch = priceStr.match(/[¥￥]([\d,.]+)/)
  if (cnyMatch) {
    const cny = parseFloat(cnyMatch[1].replace(/,/g, ""))
    return Math.round(cny * 3500 / 1000) * 1000
  }
  return 0
}

// ── Clean review string từ AliExpress DOM ──────────────────────────────────
// Input: "5.0 - Color:green - Ships From:China Mainland Good product | UserName | 2024-01-15"
// Output: { rating, text, name, date } hoặc null nếu quá ngắn/rác
function parseReviewString(raw: string): { rating: number; text: string; name: string; date: string } | null {
  if (!raw || raw.length < 10) return null

  // Bỏ qua các dòng là aggregate stats (chứa "ratings", "verified purchases", "All ratings")
  if (/\d+\s+ratings|verified purchases|All ratings|works well|fast delivery|good quality/i.test(raw)) return null

  let str = raw.trim()

  // Lấy rating ở đầu: "5.0 - " hoặc "4.0"
  let rating = 5
  const ratingM = str.match(/^(\d(?:\.\d)?)\s*[-–]?\s*/)
  if (ratingM) {
    rating = Math.round(parseFloat(ratingM[1]))
    str = str.slice(ratingM[0].length)
  }

  // Bỏ "Color:xxx - Ships From:yyy - " prefix
  str = str.replace(/^(Color:\S+\s*[-–]?\s*)?(Ships\s+From:[^-–|]+([-–]|\s*\|)\s*)?/i, "").trim()

  // Tách name + date từ cuối: "...content | Name | 2024-01-15"
  const parts = str.split("|").map(s => s.trim()).filter(Boolean)
  let text = str
  let name = "Khách hàng"
  let date = ""

  if (parts.length >= 3) {
    text = parts.slice(0, parts.length - 2).join(" ")
    name = parts[parts.length - 2] || "Khách hàng"
    date = parts[parts.length - 1] || ""
  } else if (parts.length === 2) {
    text = parts[0]
    name = parts[1]
  }

  // Bỏ "Sort by default Show original language" trailing garbage
  text = text.replace(/Sort by default.*$/i, "").replace(/Show original language.*/i, "").trim()

  // Nếu text quá ngắn hoặc vẫn có rác → bỏ
  if (text.length < 8) return null
  if (/^[\d\s★☆.,]+$/.test(text)) return null

  return { rating: Math.min(5, Math.max(1, rating)), text: text.slice(0, 300), name, date }
}

// Convert raw review strings → structured array lưu vào metadata
function structureReviews(rawReviews: string[]): Array<{ rating: number; text: string; name: string; date: string }> {
  const seen = new Set<string>()
  return rawReviews
    .flatMap(r => r.includes("\n") ? r.split("\n") : [r])
    .map(r => parseReviewString(r))
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .filter(r => {
      const key = r.text.slice(0, 60)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 10)
}

// ── Build GrapesJS-compatible landing page ─────────────────────────────────
// Output: { html, css } — parseGrapesContent() sẽ render đúng trên storefront
// Dùng pvb-* classes để admin có thể mở GrapesJS editor và edit từng block
function buildGrapesContent(
  ai: AIContent,
  images: string[],
  structuredReviews: Array<{ name: string; location?: string; rating: number; text: string; date: string }>
): string {
  // ── Benefits block (pvb-ben) ────────────────────────────────────────────
  const benefitCards = ai.benefits.map(b =>
    `<div class="card"><div class="icon">${b.icon}</div><h4>${b.title}</h4>${b.desc ? `<p>${b.desc}</p>` : ""}</div>`
  ).join("")

  const benHtml = `<section class="pvb-ben">
  <div class="inner">
    <h2>✨ Điểm nổi bật</h2>
    <div class="grid">${benefitCards}</div>
  </div>
</section>`

  const benCss = `.pvb-ben{padding:40px 16px;background:#fff}
.pvb-ben .inner{max-width:1100px;margin:0 auto}
.pvb-ben h2{font-size:clamp(20px,4vw,28px);font-weight:900;margin:0 0 20px;text-align:center}
.pvb-ben .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.pvb-ben .card{background:#f9fafb;border:1px solid #e5e7eb;border-radius:16px;padding:16px;text-align:center}
.pvb-ben .icon{font-size:28px;margin-bottom:8px}
.pvb-ben h4{margin:0 0 4px;font-weight:800;font-size:14px;color:#111827}
.pvb-ben p{margin:0;color:#6b7280;font-size:13px}
@media(min-width:640px){.pvb-ben{padding:56px 24px}.pvb-ben .grid{grid-template-columns:repeat(4,1fr);gap:18px}.pvb-ben .card{padding:20px}.pvb-ben .icon{font-size:32px}.pvb-ben h4{font-size:16px}}`

  // ── Gallery block (pvb-gal) ─────────────────────────────────────────────
  const galHtml = images.length > 1 ? `<section class="pvb-gal">
  <div class="inner">
    <h2>🖼️ Hình ảnh sản phẩm</h2>
    <div class="grid">
      ${images.slice(0, 9).map(src => `<img src="${src}" alt="Ảnh sản phẩm" loading="lazy" />`).join("")}
    </div>
  </div>
</section>` : ""

  const galCss = `.pvb-gal{padding:40px 16px;background:#f9fafb}
.pvb-gal .inner{max-width:1100px;margin:0 auto}
.pvb-gal h2{font-size:clamp(20px,4vw,28px);font-weight:900;margin:0 0 16px;text-align:center}
.pvb-gal .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.pvb-gal img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:12px;border:1px solid #e5e7eb;display:block}
@media(min-width:640px){.pvb-gal{padding:56px 24px}.pvb-gal .grid{grid-template-columns:repeat(4,1fr);gap:12px}}`

  // ── Pain/Solution block (pvb-ps) ────────────────────────────────────────
  const painItems = ai.pains.map(p => `<li>${p}</li>`).join("")
  const solItems = ai.solutions.map(s => `<li>${s}</li>`).join("")

  const psHtml = `<section class="pvb-ps">
  <div class="inner">
    <div class="box pain">
      <h3>😤 Bạn đang gặp vấn đề?</h3>
      <ul>${painItems}</ul>
    </div>
    <div class="box solution">
      <h3>✅ Giải pháp của chúng tôi</h3>
      <ul>${solItems}</ul>
    </div>
  </div>
</section>`

  const psCss = `.pvb-ps{padding:40px 16px;background:#fff}
.pvb-ps .inner{max-width:1100px;margin:0 auto;display:grid;gap:16px}
.pvb-ps .box{border-radius:18px;padding:20px}
.pvb-ps .pain{background:#fff1f2;border:1px solid #fecdd3}
.pvb-ps .solution{background:#ecfdf5;border:1px solid #bbf7d0}
.pvb-ps h3{margin:0 0 12px;font-size:20px;font-weight:900}
.pvb-ps .pain h3{color:#be123c}
.pvb-ps .solution h3{color:#047857}
.pvb-ps ul{margin:0;padding-left:18px;line-height:1.9;color:#4b5563;font-size:15px}
@media(min-width:640px){.pvb-ps{padding:56px 24px}.pvb-ps .inner{grid-template-columns:1fr 1fr;gap:24px}.pvb-ps h3{font-size:24px}}`

  // ── Specs block (pvb-spec) ──────────────────────────────────────────────
  const specEntries = Object.entries(ai.specs_vi)
  const specRows = specEntries.map(([k, v], i) =>
    `<tr class="${i % 2 === 0 ? "even" : "odd"}"><td>${k}</td><td>${v}</td></tr>`
  ).join("")

  const specHtml = specEntries.length ? `<section class="pvb-spec">
  <div class="inner">
    <h2>📋 Thông số kỹ thuật</h2>
    <div class="wrap">
      <table><tbody>${specRows}</tbody></table>
    </div>
  </div>
</section>` : ""

  const specCss = `.pvb-spec{padding:40px 16px;background:#f9fafb}
.pvb-spec .inner{max-width:860px;margin:0 auto}
.pvb-spec h2{font-size:clamp(20px,4vw,28px);font-weight:900;margin:0 0 16px}
.pvb-spec .wrap{border-radius:14px;overflow:hidden;border:1px solid #e5e7eb}
.pvb-spec table{width:100%;border-collapse:collapse}
.pvb-spec td{padding:12px 16px;font-size:14px;border-bottom:1px solid #f3f4f6}
.pvb-spec td:first-child{font-weight:700;color:#374151;width:42%}
.pvb-spec tr.even td{background:#fff}
.pvb-spec tr.odd td{background:#f9fafb}
@media(min-width:640px){.pvb-spec{padding:56px 24px}}`

  // ── Reviews block (pvb-rev) ─────────────────────────────────────────────
  const PASTEL = ["#dbeafe","#dcfce7","#fce7f3","#fef3c7","#f3e8ff","#ffedd5","#e0f2fe","#fef9c3"]
  const revCards = structuredReviews.slice(0, 6).map(r => {
    const stars = "★".repeat(r.rating) + "☆".repeat(5 - r.rating)
    const initials = r.name.slice(0, 2).toUpperCase()
    const bg = PASTEL[r.name.charCodeAt(0) % PASTEL.length]
    return `<div class="card">
  <div class="head">
    <div class="avatar" style="background:${bg}">${initials}</div>
    <div class="meta">
      <div class="name">${r.name}${r.location ? ` <span class="loc">— ${r.location}</span>` : ""}</div>
      <div class="stars">${stars}${r.date ? ` <span class="date">${r.date}</span>` : ""}</div>
    </div>
  </div>
  <p class="body">${r.text}</p>
</div>`
  }).join("")

  const revHtml = revCards ? `<section class="pvb-rev">
  <div class="inner">
    <h2>⭐ Đánh giá từ khách hàng</h2>
    <div class="grid">${revCards}</div>
  </div>
</section>` : ""

  const revCss = `.pvb-rev{padding:40px 16px;background:#fff}
.pvb-rev .inner{max-width:1100px;margin:0 auto}
.pvb-rev h2{font-size:clamp(20px,4vw,28px);font-weight:900;margin:0 0 20px;text-align:center}
.pvb-rev .grid{display:grid;grid-template-columns:1fr;gap:14px}
.pvb-rev .card{background:#f9fafb;border:1px solid #e5e7eb;border-radius:14px;padding:16px}
.pvb-rev .head{display:flex;gap:10px;align-items:center;margin-bottom:10px}
.pvb-rev .avatar{width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;color:#374151;flex-shrink:0}
.pvb-rev .name{font-weight:700;font-size:14px;color:#111}
.pvb-rev .stars{color:#f59e0b;font-size:13px}
.pvb-rev .loc{color:#9ca3af;font-size:12px;font-weight:400}
.pvb-rev .date{color:#9ca3af;font-size:11px;margin-left:6px}
.pvb-rev .body{margin:0;font-size:13px;color:#374151;line-height:1.7}
@media(min-width:640px){.pvb-rev{padding:56px 24px}.pvb-rev .grid{grid-template-columns:repeat(2,1fr)}}
@media(min-width:1024px){.pvb-rev .grid{grid-template-columns:repeat(3,1fr)}}`

  // ── FAQ block (pvb-faq dùng details/summary) ───────────────────────────
  const faqItems = ai.faq.map(f => `<details class="item">
  <summary>${f.q}</summary>
  <div class="ans">${f.a}</div>
</details>`).join("")

  const faqHtml = ai.faq.length ? `<section class="pvb-faq">
  <div class="inner">
    <h2>❓ Câu hỏi thường gặp</h2>
    ${faqItems}
  </div>
</section>` : ""

  const faqCss = `.pvb-faq{padding:40px 16px;background:#f9fafb}
.pvb-faq .inner{max-width:860px;margin:0 auto}
.pvb-faq h2{font-size:clamp(20px,4vw,28px);font-weight:900;margin:0 0 20px;text-align:center}
.pvb-faq .item{background:#fff;border:1px solid #e5e7eb;border-radius:12px;margin-bottom:8px;overflow:hidden}
.pvb-faq summary{padding:14px 18px;font-weight:700;font-size:14px;color:#111;cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center}
.pvb-faq summary::-webkit-details-marker{display:none}
.pvb-faq summary::after{content:"+";color:#9ca3af;font-size:20px;line-height:1}
.pvb-faq details[open] summary::after{content:"−"}
.pvb-faq .ans{padding:0 18px 16px;color:#4b5563;font-size:13px;line-height:1.7;border-top:1px solid #f3f4f6;padding-top:12px;background:#fafafa}
@media(min-width:640px){.pvb-faq{padding:56px 24px}}`

  // ── Assemble ────────────────────────────────────────────────────────────
  const html = [benHtml, galHtml, psHtml, specHtml, revHtml, faqHtml].filter(Boolean).join("\n")
  const css = [benCss, images.length > 1 ? galCss : "", psCss, specEntries.length ? specCss : "", revCards ? revCss : "", ai.faq.length ? faqCss : ""].filter(Boolean).join("\n")

  return JSON.stringify({ html, css })
}

// ── Main handler ───────────────────────────────────────────────────────────
function setCorsForExtension(req: MedusaRequest, res: MedusaResponse) {
  const origin = req.headers.origin || ""
  // Cho phép mọi chrome-extension và moz-extension origin
  if (origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://") || !origin) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*")
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-medusa-access-token")
    res.setHeader("Access-Control-Allow-Credentials", "true")
  }
}

export async function OPTIONS(req: MedusaRequest, res: MedusaResponse) {
  setCorsForExtension(req, res)
  return res.status(204).end()
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  setCorsForExtension(req, res)
  try {
    const body = req.body as Scrape1688Data

    if (!body.title) {
      return res.status(400).json({ message: "Thiếu title — extension chưa scrape được dữ liệu" })
    }

    // 1. Upload ảnh lên MinIO song song với gọi AI
    const imageUrls = (body.images || []).filter(u => u.startsWith("http"))
    const folder = `imports/${Date.now()}`

    const [ai, uploadedImages] = await Promise.all([
      generateContent(body).catch(err => {
        throw new Error("AI lỗi: " + err.message)
      }),
      uploadImages(imageUrls, folder),
    ])

    // Reviews do AI tạo bằng tiếng Việt (trong ai.reviews_vi)

    // Dùng ảnh đã upload nếu có, fallback về URL gốc
    const finalImages = uploadedImages.length > 0 ? uploadedImages : imageUrls.slice(0, 8)
    const thumbnail = finalImages[0] || null

    // 2. Tạo Medusa product via workflow
    const priceVND = parsePriceVND(body.price)

    const { result: productResult } = await createProductsWorkflow(req.scope).run({
      input: {
        products: [
          {
            title: ai.title_vi || body.title,
            description: ai.description_vi,
            status: "draft" as any,
            thumbnail: thumbnail || undefined,
            images: finalImages.map(url => ({ url })),
            options: [{ title: "Màu sắc", values: ["Mặc định"] }],
            variants: [
              {
                title: "Mặc định",
                sku: `1688-${Date.now()}`,
                options: { "Màu sắc": "Mặc định" },
                prices: priceVND > 0
                  ? [{ currency_code: "vnd", amount: priceVND }]
                  : [],
                manage_inventory: false,
              },
            ],
            metadata: {
              source_url: body.url,
              source_platform: body.url.includes("aliexpress") ? "aliexpress" : "1688",
              source_price: body.price,
              source_rating: body.rating || "",
              benefit_icon_1: ai.benefits[0]?.icon || "",
              benefit_title_1: ai.benefits[0]?.title || "",
              benefit_desc_1: ai.benefits[0]?.desc || "",
              benefit_icon_2: ai.benefits[1]?.icon || "",
              benefit_title_2: ai.benefits[1]?.title || "",
              benefit_desc_2: ai.benefits[1]?.desc || "",
              benefit_icon_3: ai.benefits[2]?.icon || "",
              benefit_title_3: ai.benefits[2]?.title || "",
              benefit_desc_3: ai.benefits[2]?.desc || "",
              benefit_icon_4: ai.benefits[3]?.icon || "",
              benefit_title_4: ai.benefits[3]?.title || "",
              benefit_desc_4: ai.benefits[3]?.desc || "",
              pain_1: ai.pains[0] || "",
              pain_2: ai.pains[1] || "",
              pain_3: ai.pains[2] || "",
              solution_1: ai.solutions[0] || "",
              solution_2: ai.solutions[1] || "",
              solution_3: ai.solutions[2] || "",
              faq: JSON.stringify(ai.faq.map(f => ({ question: f.q, answer: f.a }))),
              reviews: JSON.stringify(ai.reviews_vi || []),
              xuat_xu: "Trung Quốc",
              ...(ai.specs_vi["Chất liệu"] ? { chat_lieu: ai.specs_vi["Chất liệu"] } : {}),
              ...(ai.specs_vi["Kích thước"] ? { kich_thuoc: ai.specs_vi["Kích thước"] } : {}),
              ...(ai.specs_vi["Trọng lượng"] ? { trong_luong: ai.specs_vi["Trọng lượng"] } : {}),
            },
          },
        ],
      },
    })

    const product = productResult[0]

    // 3. Build GrapesJS-compatible landing page và lưu vào product metadata
    const pageContent = buildGrapesContent(ai, finalImages, ai.reviews_vi || [])

    const productModule = req.scope.resolve(Modules.PRODUCT)
    await productModule.updateProducts(product.id, {
      metadata: {
        ...(product.metadata as Record<string, any>),
        page_content: pageContent,
      },
    })

    return res.json({
      productId: product.id,
      handle: (product as any).handle,
      title: ai.title_vi || body.title,
      thumbnail,
      imagesUploaded: uploadedImages.length,
      imagesTotal: imageUrls.length,
      priceVND,
    })
  } catch (err: any) {
    console.error("[1688-import]", err)
    return res.status(500).json({ message: err.message })
  }
}
