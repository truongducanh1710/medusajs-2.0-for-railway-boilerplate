import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const body = req.body as any
    const trackingService = req.scope.resolve("webTrackingModule") as any

    const ip = (
      req.headers["x-forwarded-for"] as string ||
      req.headers["x-real-ip"] as string ||
      (req as any).ip ||
      ""
    ).split(",")[0].trim()

    await trackingService.recordPageview({
      visitor_id: body.visitor_id ?? "",
      session_id: body.session_id ?? "",
      url: body.url ?? "",
      title: body.title ?? "",
      referrer: body.referrer ?? "",
      utm_source: body.utm_source ?? "",
      utm_medium: body.utm_medium ?? "",
      utm_campaign: body.utm_campaign ?? "",
      utm_content: body.utm_content ?? "",
      utm_term: body.utm_term ?? "",
      time_on_prev_page: Number(body.time_on_prev_page ?? 0),
      has_cart: Boolean(body.has_cart),
      cart_id: body.cart_id ?? null,
      ip,
      user_agent: req.headers["user-agent"] ?? "",
    })
  } catch (err: any) {
    console.error("[track/pageview]", err.message)
  }
  return res.status(204).send()
}
