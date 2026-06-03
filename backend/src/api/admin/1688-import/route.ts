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
  const reviewsText = data.reviews?.slice(0, 5).map((r, i) => `${i + 1}. ${r.slice(0, 200)}`).join("\n") || ""

  const prompt = `Bạn là chuyên gia viết content marketing bán hàng online Việt Nam cho cửa hàng đồ gia dụng Phan Viet.

Thông tin sản phẩm từ 1688/AliExpress:
Tên gốc: ${data.title}
Mô tả: ${data.description.slice(0, 600)}
Thông số:
${specsText || "(không có)"}
Đánh giá khách:
${reviewsText || "(không có)"}
Rating: ${data.rating || "(không có)"}
Giá: ${data.price || "(không có)"}
URL: ${data.url}

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
  "specs_vi": {"Chất liệu": "...", "Kích thước": "...", "Xuất xứ": "Trung Quốc"}
}`

  const model = "deepseek-chat"
  const completion = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    max_tokens: 1500,
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

// ── Landing page HTML ──────────────────────────────────────────────────────
// Nhận structured reviews (đã parse), không nhận raw string nữa
function buildLandingPage(
  ai: AIContent,
  images: string[],
  structuredReviews: Array<{ rating: number; text: string; name: string; date: string }>
): string {
  const C = "#e63946"

  function sectionTitle(emoji: string, text: string) {
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-bottom:10px;border-bottom:2px solid ${C}">
      <span style="font-size:20px">${emoji}</span>
      <h2 style="margin:0;font-size:18px;font-weight:700;color:#111">${text}</h2>
    </div>`
  }

  // Benefits — 2x2 grid
  const benefitsHtml = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${ai.benefits.map(b => `
      <div style="background:white;border:1px solid #e5e7eb;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.05)">
        <div style="font-size:30px;margin-bottom:8px">${b.icon}</div>
        <div style="font-weight:700;color:#111;font-size:14px;margin-bottom:4px">${b.title}</div>
        ${b.desc ? `<div style="color:#6b7280;font-size:12px;line-height:1.5">${b.desc}</div>` : ""}
      </div>`).join("")}
    </div>`

  // Pain/Solution
  const painSolutionHtml = ai.pains.map((pain, i) => `
    <div style="display:flex;gap:8px;align-items:stretch;margin-bottom:10px">
      <div style="flex:1;background:#fff1f2;border-radius:10px;padding:14px">
        <div style="font-size:10px;font-weight:800;color:#f43f5e;margin-bottom:6px;letter-spacing:.05em">✕ VẤN ĐỀ</div>
        <div style="color:#374151;font-size:13px;line-height:1.6">${pain}</div>
      </div>
      <div style="display:flex;align-items:center;color:#d1d5db;font-size:22px;padding:0 2px">→</div>
      <div style="flex:1;background:#f0fdf4;border-radius:10px;padding:14px">
        <div style="font-size:10px;font-weight:800;color:#10b981;margin-bottom:6px;letter-spacing:.05em">✓ GIẢI PHÁP</div>
        <div style="color:#374151;font-size:13px;line-height:1.6">${ai.solutions[i] || ""}</div>
      </div>
    </div>`).join("")

  // Specs — zebra table
  const specsRows = Object.entries(ai.specs_vi).map(([k, v], i) => `
    <tr style="background:${i % 2 === 0 ? "#f9fafb" : "white"}">
      <td style="padding:10px 14px;font-weight:600;color:#374151;font-size:13px;border-bottom:1px solid #f3f4f6;width:42%">${k}</td>
      <td style="padding:10px 14px;color:#111;font-size:13px;border-bottom:1px solid #f3f4f6">${v}</td>
    </tr>`).join("")

  // FAQ accordion
  const faqHtml = ai.faq.map(item => `
    <details style="border:1px solid #e5e7eb;border-radius:10px;margin-bottom:8px;overflow:hidden">
      <summary style="padding:14px 18px;font-weight:600;color:#111;cursor:pointer;font-size:14px;background:white;list-style:none;display:flex;justify-content:space-between;align-items:center">
        <span>${item.q}</span><span style="color:#9ca3af;font-size:18px">+</span>
      </summary>
      <div style="padding:12px 18px 16px;color:#4b5563;font-size:13px;line-height:1.7;background:#fafafa;border-top:1px solid #f3f4f6">${item.a}</div>
    </details>`).join("")

  // Gallery — chỉ thumbs (ảnh hero đã có ở ImageGallery storefront)
  const galleryHtml = images.length > 1 ? `
    <div style="margin-bottom:32px">
      ${sectionTitle("🖼️", "Hình ảnh sản phẩm")}
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px">
        ${images.slice(0, 9).map(img =>
          `<img src="${img}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;border:1.5px solid #e5e7eb" loading="lazy" />`
        ).join("")}
      </div>
    </div>` : ""

  // Reviews — dùng structured reviews đã parse sạch
  const PASTEL = ["#dbeafe","#dcfce7","#fce7f3","#fef3c7","#f3e8ff","#ffedd5","#e0f2fe","#fef9c3"]
  const reviewCardsHtml = structuredReviews.slice(0, 6).map(r => {
    const { rating, text, name, date } = r
    const initials = name.slice(0, 2).toUpperCase()
    const bg = PASTEL[name.charCodeAt(0) % PASTEL.length]
    const starStr = Array.from({length: 5}, (_, i) =>
      `<span style="color:${i < rating ? "#f59e0b" : "#d1d5db"};font-size:13px">★</span>`
    ).join("")
    return `
    <div style="background:white;border:1px solid #e5e7eb;border-radius:12px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,.04)">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <div style="width:36px;height:36px;border-radius:50%;background:${bg};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;color:#374151;flex-shrink:0">${initials}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:13px;color:#111">${name}</div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:2px">
            <span>${starStr}</span>
            ${date ? `<span style="font-size:11px;color:#9ca3af">${date}</span>` : ""}
          </div>
        </div>
      </div>
      <p style="margin:0;font-size:13px;color:#374151;line-height:1.7">${text}</p>
    </div>`
  }).join("")

  // Không có Hero section — storefront đã render title/desc/gallery ở trên
  return `<div style="max-width:840px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111;line-height:1.6">

  <!-- Benefits -->
  <div style="margin-bottom:32px">
    ${sectionTitle("✨", "Điểm nổi bật")}
    ${benefitsHtml}
  </div>

  <!-- Gallery -->
  ${galleryHtml}

  <!-- Pain/Solution -->
  <div style="margin-bottom:32px">
    ${sectionTitle("💡", "Vì sao chọn sản phẩm này?")}
    ${painSolutionHtml}
  </div>

  <!-- Specs -->
  ${specsRows ? `<div style="margin-bottom:32px">
    ${sectionTitle("📋", "Thông số kỹ thuật")}
    <div style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
      <table style="width:100%;border-collapse:collapse">${specsRows}</table>
    </div>
  </div>` : ""}

  <!-- Reviews -->
  ${reviewCardsHtml ? `<div style="margin-bottom:32px">
    ${sectionTitle("⭐", "Đánh giá từ khách hàng")}
    <div style="display:grid;gap:10px">
      ${reviewCardsHtml}
    </div>
  </div>` : ""}

  <!-- FAQ -->
  ${faqHtml ? `<div style="margin-bottom:32px">
    ${sectionTitle("❓", "Câu hỏi thường gặp")}
    ${faqHtml}
  </div>` : ""}

</div>`
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

    // Parse reviews thành structured format
    const reviews = structureReviews(body.reviews || [])

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
              reviews: JSON.stringify(reviews),
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

    // 3. Sinh landing page HTML và lưu vào product metadata
    const pageHtml = buildLandingPage(ai, finalImages, reviews)

    const productModule = req.scope.resolve(Modules.PRODUCT)
    await productModule.updateProducts(product.id, {
      metadata: {
        ...(product.metadata as Record<string, any>),
        page_content: pageHtml,
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
