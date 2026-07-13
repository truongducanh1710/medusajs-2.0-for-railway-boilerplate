import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * POST /store/dohana/webhook
 * Chỉ xử lý event "video.create" — payload webhook nhẹ (orderCode/slug/type/timestamps,
 * không phải full object) nên phải fetch chi tiết qua GET /partner/video/:slug rồi upsert.
 * Strategy: trả 200 ngay (Dohana tắt webhook nếu lỗi liên tiếp 25 lần), xử lý async.
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

    // Trả 200 ngay
    res.json({ success: true })

    if (body?.event !== "video.create") return

    const slug = body?.data?.slug
    if (!slug) return

    // Fire-and-forget: fetch chi tiết + upsert
    syncService.fetchAndUpsertBySlug(slug).catch((err: any) => {
      console.error(`[Dohana Webhook] fetchAndUpsertBySlug(${slug}) failed:`, err.message)
    })
  } catch (err: any) {
    console.error("[Dohana Webhook] Error:", err.message)
    res.json({ success: true })
  }
}
