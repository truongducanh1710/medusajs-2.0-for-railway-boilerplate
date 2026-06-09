import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

function actorId(req: MedusaRequest): string | null {
  const auth = (req as any).auth_context
  return auth?.actor_type === "user" ? auth.actor_id : null
}

async function isManager(req: MedusaRequest): Promise<boolean> {
  const uid = actorId(req)
  if (!uid) return false
  const superEmail = process.env.SUPER_ADMIN_EMAIL
  const userModule = req.scope.resolve(Modules.USER)
  const user = await userModule.retrieveUser(uid, { select: ["email", "metadata"] })
  if (user.email === superEmail) return true
  const perms: string[] = Array.isArray((user.metadata as any)?.permissions)
    ? (user.metadata as any).permissions : []
  return perms.includes("page.mkt-tasks.manage")
}

// PATCH /admin/mkt-tasks/:id/rate
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const uid = actorId(req)
    if (!uid) return res.status(401).json({ error: "Unauthenticated" })
    if (!(await isManager(req))) return res.status(403).json({ error: "Chỉ manager mới được đánh giá" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const { id } = req.params
    const { rating } = req.body as any

    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: "Rating phải từ 1-5" })

    const [task] = await svc.listMktTasks({ id, deleted_at: null })
    if (!task) return res.status(404).json({ error: "Không tìm thấy task" })
    if (task.status !== "done") return res.status(400).json({ error: "Chỉ đánh giá task đã hoàn thành" })

    await svc.updateMktTasks({ id }, { rating: Number(rating) })
    res.json({ success: true })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
