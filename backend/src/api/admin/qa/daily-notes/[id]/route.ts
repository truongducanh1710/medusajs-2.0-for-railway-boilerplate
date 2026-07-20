import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

// DELETE /admin/qa/daily-notes/:id — xoá 1 ghi chú ngày (leader ghi nhầm).
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { id } = req.params
    const svc = req.scope.resolve("mktTaskModule") as any
    await svc.deleteQaDailyNotes([id])
    res.json({ id, deleted: true })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
