import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

function actorId(req: MedusaRequest): string | null {
  const auth = (req as any).auth_context
  return auth?.actor_type === "user" ? auth.actor_id : null
}

// POST /admin/mkt-tasks/:id/comment
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const uid = actorId(req)
    if (!uid) return res.status(401).json({ error: "Unauthenticated" })

    const userModule = req.scope.resolve(Modules.USER)
    const user = await userModule.retrieveUser(uid, { select: ["email"] })
    const email = user?.email
    if (!email) return res.status(401).json({ error: "Unauthenticated" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const { id } = req.params
    const { text } = req.body as any
    if (!text?.trim()) return res.status(400).json({ error: "Nội dung comment không được rỗng" })

    const [task] = await svc.listMktTasks({ id })
    if (!task) return res.status(404).json({ error: "Không tìm thấy task" })

    const newComment = { author_id: email, text: text.trim(), created_at: new Date().toISOString() }
    const comments = [...(task.comments || []), newComment]

    await svc.updateMktTasks({ id, comments })
    res.json({ success: true, comment: newComment })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
