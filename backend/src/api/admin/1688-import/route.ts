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
  // "₫28,679" → 28679 | "¥40.00" → 0 (không parse CNY)
  const match = priceStr.match(/[₫đ][\s]*([\d,. ]+)/)
  if (!match) return 0
  return Math.round(parseFloat(match[1].replace(/[,. ]/g, "").replace(/(\d{3})$/, ".$1")) * 1000) || 0
}

// ── Landing page HTML ──────────────────────────────────────────────────────
function buildLandingPage(ai: AIContent, images: string[]): string {
  const benefitsHtml = ai.benefits.map(b => `
    <div style="display:flex;align-items:flex-start;gap:12px;padding:14px;background:#f0fdf4;border-radius:10px;margin-bottom:10px;border:1px solid #bbf7d0">
      <span style="font-size:28px;flex-shrink:0;line-height:1">${b.icon}</span>
      <div>
        <div style="font-weight:700;color:#111;font-size:15px;margin-bottom:3px">${b.title}</div>
        ${b.desc ? `<div style="color:#4b5563;font-size:13px;line-height:1.5">${b.desc}</div>` : ""}
      </div>
    </div>`).join("")

  const painSolutionHtml = ai.pains.map((pain, i) => `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      <div style="background:#fff5f5;border-left:4px solid #ef4444;padding:12px;border-radius:0 8px 8px 0">
        <div style="font-size:10px;font-weight:800;color:#ef4444;margin-bottom:5px;text-transform:uppercase;letter-spacing:0.05em">❌ Vấn đề</div>
        <div style="color:#374151;font-size:13px;line-height:1.5">${pain}</div>
      </div>
      <div style="background:#f0fdf4;border-left:4px solid #10b981;padding:12px;border-radius:0 8px 8px 0">
        <div style="font-size:10px;font-weight:800;color:#10b981;margin-bottom:5px;text-transform:uppercase;letter-spacing:0.05em">✅ Giải pháp</div>
        <div style="color:#374151;font-size:13px;line-height:1.5">${ai.solutions[i] || ""}</div>
      </div>
    </div>`).join("")

  const specsHtml = Object.entries(ai.specs_vi).map(([k, v]) => `
    <tr>
      <td style="padding:10px 12px;background:#f9fafb;font-weight:600;color:#374151;border:1px solid #e5e7eb;width:40%">${k}</td>
      <td style="padding:10px 12px;color:#111;border:1px solid #e5e7eb">${v}</td>
    </tr>`).join("")

  const faqHtml = ai.faq.map(item => `
    <details style="border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px;overflow:hidden">
      <summary style="padding:14px 16px;font-weight:600;color:#111;cursor:pointer;background:#fafafa;user-select:none">
        ${item.q}
      </summary>
      <div style="padding:12px 16px;color:#4b5563;font-size:14px;line-height:1.7;border-top:1px solid #e5e7eb">${item.a}</div>
    </details>`).join("")

  // Gallery lớn — tất cả ảnh
  const galleryHtml = images.length > 1 ? `
    <div style="margin-bottom:28px">
      <h2 style="font-size:18px;font-weight:700;margin-bottom:14px;padding-bottom:8px;border-bottom:2px solid #e63946">🖼️ Hình ảnh sản phẩm</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px">
        ${images.slice(1).map(img =>
          `<img src="${img}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;border:1px solid #e5e7eb" loading="lazy" />`
        ).join("")}
      </div>
    </div>` : ""

  return `<div style="max-width:820px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;line-height:1.6">

  <!-- Hero -->
  <div style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 60%,#0f3460 100%);padding:36px 24px;border-radius:14px;margin-bottom:28px;text-align:center">
    ${images[0] ? `<img src="${images[0]}" style="width:100%;max-height:420px;object-fit:contain;border-radius:10px;margin-bottom:20px;background:white;padding:8px" />` : ""}
    <h1 style="color:white;font-size:22px;font-weight:800;line-height:1.35;margin-bottom:12px">${ai.title_vi}</h1>
    <p style="color:#94a3b8;font-size:14px;line-height:1.7;max-width:600px;margin:0 auto">${ai.description_vi}</p>
  </div>

  <!-- Benefits -->
  <div style="margin-bottom:28px">
    <h2 style="font-size:18px;font-weight:700;margin-bottom:14px;padding-bottom:8px;border-bottom:2px solid #e63946">✨ Điểm nổi bật</h2>
    ${benefitsHtml}
  </div>

  <!-- Gallery -->
  ${galleryHtml}

  <!-- Pain / Solution -->
  <div style="margin-bottom:28px">
    <h2 style="font-size:18px;font-weight:700;margin-bottom:14px;padding-bottom:8px;border-bottom:2px solid #e63946">💡 Vấn đề & Giải pháp</h2>
    ${painSolutionHtml}
  </div>

  <!-- Specs -->
  ${specsHtml ? `
  <div style="margin-bottom:28px">
    <h2 style="font-size:18px;font-weight:700;margin-bottom:14px;padding-bottom:8px;border-bottom:2px solid #e63946">📋 Thông số kỹ thuật</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px">${specsHtml}</table>
  </div>` : ""}

  <!-- FAQ -->
  ${faqHtml ? `
  <div style="margin-bottom:28px">
    <h2 style="font-size:18px;font-weight:700;margin-bottom:14px;padding-bottom:8px;border-bottom:2px solid #e63946">❓ Câu hỏi thường gặp</h2>
    ${faqHtml}
  </div>` : ""}

  <!-- Reviews -->
  ${(ai as any)._reviews?.length ? `
  <div style="margin-bottom:28px">
    <h2 style="font-size:18px;font-weight:700;margin-bottom:14px;padding-bottom:8px;border-bottom:2px solid #e63946">⭐ Đánh giá khách hàng</h2>
    ${(ai as any)._reviews.slice(0, 6).map((r: string) => `
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 14px;margin-bottom:10px;font-size:13px;color:#374151;line-height:1.6">
      ${r.slice(0, 300)}
    </div>`).join("")}
  </div>` : ""}

</div>`
}

// ── Main handler ───────────────────────────────────────────────────────────
export async function POST(req: MedusaRequest, res: MedusaResponse) {
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

    // Gắn reviews vào ai object để dùng trong landing page
    ;(ai as any)._reviews = body.reviews || []

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
              reviews: JSON.stringify((body.reviews || []).slice(0, 10)),
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
    const pageHtml = buildLandingPage(ai, finalImages)

    const productModule = req.scope.resolve(Modules.PRODUCT)
    await productModule.updateProducts(product.id, {
      metadata: {
        ...(product.metadata as Record<string, any>),
        page_content_draft: pageHtml,
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
