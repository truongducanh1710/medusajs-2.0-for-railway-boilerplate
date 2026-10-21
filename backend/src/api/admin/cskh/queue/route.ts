import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { computeCskhTasks, syncDailyList, getDailyList, currentBlock, vnDay, CSKH_BLOCKS } from "../../../../lib/cskh-queue"

/**
 * GET /admin/cskh/queue
 * Hàng đợi việc CSKH (luật trong lib/cskh-queue.ts) + tiến độ danh sách gọi hôm nay.
 * Mỗi lần tải cũng cập nhật danh sách ngày, để tiến độ khớp ngay sau khi Hà ghi kết quả.
 */
export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  try {
    const now = Date.now()
    const { tasks, counts } = await computeCskhTasks(now)
    await syncDailyList(tasks, now)
    const today = await getDailyList(vnDay(now))
    const inToday = new Map(today.rows.map((r: any) => [String(r.order_id), r]))
    for (const t of tasks) {
      const d: any = inToday.get(t.id)
      t.today = d ? { status: d.status, carried_from: d.carried_from, reopened: d.reopened } : null
    }

    const byCode: Record<string, number> = {}
    for (const t of tasks) if (t.bucket !== "later") byCode[t.task.code] = (byCode[t.task.code] ?? 0) + 1
    res.json({
      summary: {
        due: tasks.filter((t) => t.bucket !== "later").length,
        overdue: tasks.filter((t) => t.bucket === "overdue").length,
        waiting_carrier: tasks.filter((t) => t.bucket === "later").length,
        by_code: byCode,
        ...counts,
      },
      today: today.summary,
      blocks: { ...currentBlock(now), all: CSKH_BLOCKS },
      tasks,
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}
