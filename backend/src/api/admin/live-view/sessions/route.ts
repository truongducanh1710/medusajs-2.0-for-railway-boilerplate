import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const q = req.query as Record<string, string>
    const trackingService = req.scope.resolve("webTrackingModule") as any
    const sessions = await trackingService.getSessions({
      active: q.active === "1",
      limit: Number(q.limit ?? 100),
      from: q.from,
      to: q.to,
    })
    return res.json({ sessions })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
