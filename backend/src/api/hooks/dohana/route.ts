import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * POST /hooks/dohana — webhook Dohana báo có video mới.
 *
 * Đặt ngoài /store/ là CỐ Ý. Mọi route dưới /store/* bị Medusa bắt buộc phải có header
 * `x-publishable-api-key`, mà Dohana chỉ cho khai URL chứ không cho thêm header — nên
 * bản cũ ở /store/dohana/webhook bị chặn ngay tầng middleware với lỗi 400 "Publishable
 * API key required", request chưa bao giờ chạm tới code này. Dohana thấy lỗi liên tiếp
 * nên đánh dấu "URL không hoạt động" và tắt webhook từ 29/08/2026.
 *
 * Payload webhook rất nhẹ (orderCode/slug/type/timestamps, không phải full object) nên
 * phải fetch chi tiết qua GET /partner/video/:slug rồi upsert.
 *
 * Luôn trả 200 thật nhanh: Dohana tắt webhook nếu lỗi liên tiếp 25 lần, nên mọi việc
 * nặng đều chạy async sau khi đã trả lời.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = req.body as any

  try {
    const syncService = req.scope.resolve("dohanaSyncModule") as any

    const rawBody = (req as any).rawBody ?? JSON.stringify(body)
    const signature = (req.headers["x-dhn-sign"] as string) ?? null
    if (!syncService.verifyWebhookSignature(rawBody, signature)) {
      console.warn("[Dohana Webhook] Invalid signature — rejecting")
      return res.status(401).json({ error: "Invalid signature" })
    }

    // Trả 200 ngay, xử lý sau.
    res.json({ success: true })

    if (body?.event !== "video.create") return

    const slug = body?.data?.slug
    if (!slug) return

    syncService.fetchAndUpsertBySlug(slug).catch((err: any) => {
      console.error(`[Dohana Webhook] fetchAndUpsertBySlug(${slug}) failed:`, err.message)
    })
  } catch (err: any) {
    console.error("[Dohana Webhook] Error:", err.message)
    res.json({ success: true })
  }
}

/**
 * GET /hooks/dohana — Dohana bấm "Yêu cầu xử lý URL" có thể gọi GET để kiểm tra URL sống
 * hay chết. Trả 200 để URL được đánh dấu hoạt động trở lại.
 */
export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  return res.json({ ok: true, service: "dohana-webhook" })
}
