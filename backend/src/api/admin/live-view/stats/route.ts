import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const trackingService = req.scope.resolve("webTrackingModule") as any
    const stats = await trackingService.getStats(10)
    return res.json(stats)
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
