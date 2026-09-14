import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * POST /admin/dohana-sync
 * Body: { from: ISOString, to: ISOString }
 * Trigger sync thủ công (nút "Đồng bộ lại" trên UI).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { from, to } = req.body as { from?: string; to?: string }

    if (!from || !to) {
      return res.status(400).json({ error: "Missing from/to" })
    }

    // Chặn cả nút "Đồng bộ lại" khi cron đang tắt: API key đang bị Dohana khoá (429 với
    // mọi request từ 30/08/2026), nên mỗi lần bấm chỉ thêm request hỏng vào lịch sử và
    // làm họ khó mở khoá hơn. Bật lại bằng DOHANA_SYNC_CRON=on.
    if (String(process.env.DOHANA_SYNC_CRON ?? "").toLowerCase() !== "on") {
      return res.status(503).json({
        error:
          "Đồng bộ Dohana đang tạm dừng: API key bị Dohana khoá (lỗi 429 với mọi request " +
          "từ 30/08/2026). Đang chờ Dohana mở lại — video mới vẫn về qua webhook. " +
          "Bật lại bằng biến môi trường DOHANA_SYNC_CRON=on.",
      })
    }

    const syncService = req.scope.resolve("dohanaSyncModule") as any
    const { jobId } = await syncService.pullByDateRange(new Date(from), new Date(to))

    return res.json({ jobId })
  } catch (err: any) {
    if (err.code === "SYNC_IN_PROGRESS") {
      return res.status(409).json({ error: err.message, existingJobId: err.existingJobId })
    }
    console.error("[DohanaSync Trigger API] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
