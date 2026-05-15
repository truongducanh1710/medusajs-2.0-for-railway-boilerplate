import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * POST /admin/pancake-sync/cleanup
 * Mark TẤT CẢ job đang status=queued/running thành failed.
 * Dùng khi có zombie job stuck (backend restart, deployment crash).
 *
 * KHÔNG dùng cho operation thường — chỉ khi user thấy UI bị stuck vào job zombie.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const syncService = req.scope.resolve("pancakeSyncModule") as any

    // Lấy tất cả job đang running/queued (bất kể age)
    const stuckJobs = await syncService.listPancakeSyncJobs(
      { status: { $in: ["queued", "running"] } as any } as any,
      { take: 100 }
    )

    let cleaned = 0
    for (const j of stuckJobs as any[]) {
      try {
        await syncService.updatePancakeSyncJobs({
          id: j.id,
          status: "failed",
          finished_at: new Date(),
          error: "Manual cleanup by admin",
        } as any)
        cleaned++
      } catch (err: any) {
        console.warn(`[Cleanup] Failed to mark ${j.id}: ${err.message}`)
      }
    }

    // Release advisory lock nếu còn
    try {
      const mgr = (syncService as any).__container?.manager
      if (mgr) {
        await mgr.execute(`SELECT pg_advisory_unlock(hashtext('pancake-sync'))`)
      }
    } catch {}

    return res.json({ ok: true, cleaned, jobs: stuckJobs.map((j: any) => j.id) })
  } catch (err: any) {
    console.error("[PancakeSync Cleanup] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
