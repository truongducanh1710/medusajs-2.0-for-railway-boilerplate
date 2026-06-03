import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import OpenAI from "openai"

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

// Gọi AI phân tích và sinh nội dung Vietnamese
async function generateContent(data: Scrape1688Data): Promise<AIContent> {
  const client = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
  })

  const specsText = Object.entries(data.specs)
    .slice(0, 20)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n")

  const reviewsText = data.reviews?.slice(0, 5).map((r, i) => `${i + 1}. ${r}`).join("\n") || "(không có)"

  const prompt = `Bạn là chuyên gia viết content marketing bán hàng online Việt Nam cho cửa hàng đồ gia dụng Phan Viet.

Dưới đây là thông tin sản phẩm từ nguồn nước ngoài (1688/AliExpress):

Tên gốc: ${data.title}
Mô tả gốc: ${data.description.slice(0, 800)}
Thông số:
${specsText || "(không có)"}
Đánh giá khách hàng (để hiểu điểm mạnh thực tế):
${reviewsText}
Điểm đánh giá: ${data.rating || "(không có)"}
Giá tham khảo: ${data.price || "(không có)"}
URL: ${data.url}

Hãy tạo nội dung marketing tiếng Việt cho sản phẩm này. Trả về JSON thuần túy (không markdown), đúng format:
{
  "title_vi": "Tên sản phẩm tiếng Việt, ngắn gọn, hấp dẫn, tối đa 80 ký tự",
  "description_vi": "Mô tả sản phẩm 2-3 câu, nhấn mạnh công dụng và lợi ích cho gia đình Việt",
  "benefits": [
    {"icon": "✅", "title": "Lợi ích ngắn", "desc": "Giải thích thêm 1 câu"},
    {"icon": "⚡", "title": "Lợi ích 2", "desc": "..."},
    {"icon": "🔒", "title": "Lợi ích 3", "desc": "..."},
    {"icon": "💡", "title": "Lợi ích 4", "desc": "..."}
  ],
  "pains": [
    "Vấn đề/nỗi đau của khách hàng 1",
    "Vấn đề 2",
    "Vấn đề 3"
  ],
  "solutions": [
    "Giải pháp tương ứng 1",
    "Giải pháp 2",
    "Giải pháp 3"
  ],
  "faq": [
    {"q": "Câu hỏi thường gặp 1?", "a": "Trả lời ngắn gọn"},
    {"q": "Câu hỏi 2?", "a": "..."},
    {"q": "Câu hỏi 3?", "a": "..."}
  ],
  "specs_vi": {
    "Chất liệu": "...",
    "Kích thước": "...",
    "Xuất xứ": "Trung Quốc"
  }
}`

  const completion = await client.chat.completions.create({
    model: "deepseek/deepseek-chat",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 1500,
    temperature: 0.7,
  })

  const raw = completion.choices[0]?.message?.content ?? ""
  // Strip markdown code blocks nếu có
  const jsonStr = raw.replace(/^```json?\s*/i, "").replace(/```\s*$/, "").trim()
  return JSON.parse(jsonStr) as AIContent
}

// Sinh HTML landing page từ AI content + ảnh
function buildLandingPageHtml(ai: AIContent, images: string[]): string {
  const benefitsHtml = ai.benefits
    .map(
      (b) => `
    <div style="display:flex;align-items:flex-start;gap:12px;padding:12px;background:#f0fdf4;border-radius:8px;margin-bottom:8px">
      <span style="font-size:24px;flex-shrink:0">${b.icon}</span>
      <div>
        <div style="font-weight:700;color:#111;font-size:15px">${b.title}</div>
        ${b.desc ? `<div style="color:#4b5563;font-size:13px;margin-top:2px">${b.desc}</div>` : ""}
      </div>
    </div>`
    )
    .join("")

  const painSolutionHtml = ai.pains
    .map(
      (pain, i) => `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
      <div style="background:#fef2f2;border-left:4px solid #ef4444;padding:12px;border-radius:0 8px 8px 0">
        <div style="font-size:11px;font-weight:700;color:#ef4444;margin-bottom:4px">NỖI ĐAU</div>
        <div style="color:#374151;font-size:14px">${pain}</div>
      </div>
      <div style="background:#f0fdf4;border-left:4px solid #10b981;padding:12px;border-radius:0 8px 8px 0">
        <div style="font-size:11px;font-weight:700;color:#10b981;margin-bottom:4px">GIẢI PHÁP</div>
        <div style="color:#374151;font-size:14px">${ai.solutions[i] || ""}</div>
      </div>
    </div>`
    )
    .join("")

  const specsHtml = Object.entries(ai.specs_vi)
    .map(
      ([k, v]) => `
    <tr>
      <td style="padding:10px 12px;background:#f9fafb;font-weight:600;color:#374151;white-space:nowrap;border:1px solid #e5e7eb">${k}</td>
      <td style="padding:10px 12px;color:#111;border:1px solid #e5e7eb">${v}</td>
    </tr>`
    )
    .join("")

  const faqHtml = ai.faq
    .map(
      (item) => `
    <details style="border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px;overflow:hidden">
      <summary style="padding:14px 16px;font-weight:600;color:#111;cursor:pointer;list-style:none;display:flex;justify-content:space-between">
        ${item.q} <span>▼</span>
      </summary>
      <div style="padding:0 16px 14px;color:#4b5563;font-size:14px;line-height:1.6">${item.a}</div>
    </details>`
    )
    .join("")

  const galleryHtml =
    images.length > 1
      ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;margin:16px 0">
      ${images
        .slice(1, 6)
        .map(
          (img) =>
            `<img src="${img}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px" loading="lazy" />`
        )
        .join("")}
    </div>`
      : ""

  return `<div style="max-width:800px;margin:0 auto;font-family:-apple-system,sans-serif;color:#111">

  <!-- Hero Banner -->
  <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:32px 24px;border-radius:12px;margin-bottom:24px;text-align:center">
    ${images[0] ? `<img src="${images[0]}" style="width:100%;max-height:400px;object-fit:contain;border-radius:8px;margin-bottom:20px" />` : ""}
    <h1 style="color:white;font-size:24px;font-weight:800;line-height:1.3;margin-bottom:12px">${ai.title_vi}</h1>
    <p style="color:#94a3b8;font-size:15px;line-height:1.6">${ai.description_vi}</p>
  </div>

  <!-- Benefits -->
  <div style="margin-bottom:24px">
    <h2 style="font-size:20px;font-weight:700;margin-bottom:16px;padding-bottom:8px;border-bottom:2px solid #e63946">✨ Điểm nổi bật</h2>
    ${benefitsHtml}
  </div>

  <!-- Gallery -->
  ${galleryHtml}

  <!-- Pain / Solution -->
  <div style="margin-bottom:24px">
    <h2 style="font-size:20px;font-weight:700;margin-bottom:16px;padding-bottom:8px;border-bottom:2px solid #e63946">💡 Vấn đề & Giải pháp</h2>
    ${painSolutionHtml}
  </div>

  <!-- Specs -->
  ${
    specsHtml
      ? `<div style="margin-bottom:24px">
    <h2 style="font-size:20px;font-weight:700;margin-bottom:16px;padding-bottom:8px;border-bottom:2px solid #e63946">📋 Thông số kỹ thuật</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px">${specsHtml}</table>
  </div>`
      : ""
  }

  <!-- FAQ -->
  ${
    faqHtml
      ? `<div style="margin-bottom:24px">
    <h2 style="font-size:20px;font-weight:700;margin-bottom:16px;padding-bottom:8px;border-bottom:2px solid #e63946">❓ Câu hỏi thường gặp</h2>
    ${faqHtml}
  </div>`
      : ""
  }

</div>`
}

/**
 * POST /admin/1688-import
 * Body: Scrape1688Data (từ Chrome Extension)
 * Gọi AI → tạo Medusa product + landing page
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const body = req.body as Scrape1688Data

    if (!body.title) {
      return res.status(400).json({ message: "Thiếu title — extension chưa scrape được dữ liệu" })
    }

    // 1. Gọi AI sinh content
    let ai: AIContent
    try {
      ai = await generateContent(body)
    } catch (err: any) {
      return res.status(502).json({ message: "AI lỗi: " + err.message })
    }

    // 2. Tạo Medusa product
    const productModule = req.scope.resolve(Modules.PRODUCT)
    const product = await productModule.createProducts({
      title: ai.title_vi || body.title,
      description: ai.description_vi,
      status: "draft" as any,
      metadata: {
        source_1688: body.url,
        benefit_icon_1: ai.benefits[0]?.icon || "",
        benefit_title_1: ai.benefits[0]?.title || "",
        benefit_icon_2: ai.benefits[1]?.icon || "",
        benefit_title_2: ai.benefits[1]?.title || "",
        benefit_icon_3: ai.benefits[2]?.icon || "",
        benefit_title_3: ai.benefits[2]?.title || "",
        benefit_icon_4: ai.benefits[3]?.icon || "",
        benefit_title_4: ai.benefits[3]?.title || "",
        pain_1: ai.pains[0] || "",
        pain_2: ai.pains[1] || "",
        pain_3: ai.pains[2] || "",
        solution_1: ai.solutions[0] || "",
        solution_2: ai.solutions[1] || "",
        solution_3: ai.solutions[2] || "",
        faq: JSON.stringify(ai.faq.map((f) => ({ question: f.q, answer: f.a }))),
        chat_lieu: ai.specs_vi["Chất liệu"] || body.specs["材质"] || body.specs["面料"] || "",
        kich_thuoc: ai.specs_vi["Kích thước"] || body.specs["尺寸"] || body.specs["规格"] || "",
        xuat_xu: "Trung Quốc",
      },
    })

    // 3. Sinh landing page HTML
    const pageHtml = buildLandingPageHtml(ai, body.images)

    // 4. Lưu page_content vào product metadata
    await productModule.updateProducts(product.id, {
      metadata: {
        ...(product.metadata as Record<string, any>),
        page_content_draft: pageHtml,
      },
    })

    return res.json({
      productId: product.id,
      title: ai.title_vi || body.title,
      thumbnail: body.images[0] || null,
      handle: (product as any).handle,
    })
  } catch (err: any) {
    console.error("[1688-import]", err)
    return res.status(500).json({ message: err.message })
  }
}
