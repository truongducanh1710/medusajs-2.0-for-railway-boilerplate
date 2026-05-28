import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const q = req.query as Record<string, string>
    const trackingService = req.scope.resolve("webTrackingModule") as any
    const rows = await trackingService.getTopPages({
      windowMinutes: Number(q.window ?? 60),
      limit: Number(q.limit ?? 20),
      from: q.from,
      to: q.to,
    })
    return res.json({ rows })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
