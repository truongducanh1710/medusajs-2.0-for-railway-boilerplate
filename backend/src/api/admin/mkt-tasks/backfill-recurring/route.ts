import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import {
  Frequency,
  vnDate,
  periodKeyFor,
  periodDeadline,
  shouldSpawnToday,
  spawnInstanceForPeriod,
} from "../../../../modules/mkt-task/recurring-helpers"

// Route tạm one-off: cron mkt-task-recurring không chạy đúng 00:00 VN 24/07/2026
// (nghi Railway restart trùng thời điểm tick). Sinh lại instance kỳ hôm nay cho
// template daily/weekly/monthly đang active, dùng đúng logic cron thật (idempotent).
// Xoá route này sau khi dùng xong.
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const auth = (req as any).auth_context
  if (auth?.actor_type !== "user" || !auth?.actor_id) {
    return res.status(401).json({ error: "Unauthenticated" })
  }
  const userModule = req.scope.resolve(Modules.USER)
  const user = await userModule.retrieveUser(auth.actor_id, { select: ["email"] })
  if (user.email !== process.env.SUPER_ADMIN_EMAIL) {
    return res.status(403).json({ error: "Forbidden" })
  }

  const svc = req.scope.resolve("mktTaskModule") as any
  const vn = vnDate()

  const templates = await svc.listMktTasks({ is_template: true, deleted_at: null }, { take: 1000 })
  const results: any[] = []
  for (const tpl of templates) {
    const freq = (tpl.frequency || "once") as Frequency
    if (freq === "once") continue
    if (!shouldSpawnToday(freq, vn)) continue

    const periodKey = periodKeyFor(freq, vn)
    const deadline = periodDeadline(freq, vn)
    const created = await spawnInstanceForPeriod(svc, tpl, periodKey, deadline)
    results.push({ title: tpl.title, assignee_id: tpl.assignee_id, periodKey, spawned: !!created })
  }

  res.json({ vn: vn.toISOString(), results, spawned_count: results.filter((r) => r.spawned).length })
}
