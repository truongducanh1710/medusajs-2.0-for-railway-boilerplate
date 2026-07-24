import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

// Xem lịch sử chạy của cron mkt-task-recurring — tra khi nghi job bị bỏ lỡ tick
// (Railway CLI chỉ giữ log ngắn hạn nên không đủ để kiểm tra ngược).
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const svc = req.scope.resolve("mktTaskModule") as any
  const { job_name } = req.query as any

  const logs = await svc.listJobRunLogs(
    { job_name: job_name || "mkt-task-recurring" },
    { order: { ran_at: "DESC" }, take: 30 },
  )
  res.json({ logs })
}
