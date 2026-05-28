import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { id } = req.params
    const q = req.query as Record<string, string>
    const trackingService = req.scope.resolve("webTrackingModule") as any
    const history = await trackingService.getVisitorHistory(id, Number(q.limit ?? 200))
    return res.json({ history })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
