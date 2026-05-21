import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

const VALID_STATUSES = [0, 1, 2, 3, 4, 5, 6, 7, 9, 11]

/**
 * POST /admin/pancake-sync/pull-by-status
 * Trigger pullByStatus cho 1 hoặc nhiều status ngay lập tức.
 * Body: { statuses: number[], daysBack?: number }
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { statuses, daysBack } = req.body as { statuses?: number[]; daysBack?: number }

  if (!Array.isArray(statuses) || statuses.length === 0) {
    return res.status(400).json({ error: "statuses (number[]) là bắt buộc" })
  }

  const invalid = statuses.filter(s => !VALID_STATUSES.includes(s))
  if (invalid.length > 0) {
    return res.status(400).json({ error: `Status không hợp lệ: ${invalid.join(",")}` })
  }

  const syncService = req.scope.resolve("pancakeSyncModule") as any
  const startedAt = new Date()
  const results: any[] = []

  for (const status of statuses) {
    try {
      const result = await syncService.pullByStatus(status, daysBack ? { daysBack } : undefined)
      results.push({ status, ...result })
    } catch (err: any) {
      results.push({ status, error: err.message })
    }
  }

  await syncService.logCronRun({
    run_type: "manual",
    started_at: startedAt,
    finished_at: new Date(),
    statuses: results.filter(r => !r.error),
  }).catch(() => {})

  return res.json({ results, duration_ms: Date.now() - startedAt.getTime() })
}
