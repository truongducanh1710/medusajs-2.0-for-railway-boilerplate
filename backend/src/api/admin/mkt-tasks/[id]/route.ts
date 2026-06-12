import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

function actorId(req: MedusaRequest): string | null {
  const auth = (req as any).auth_context
  return auth?.actor_type === "user" ? auth.actor_id : null
}

async function actorEmail(req: MedusaRequest): Promise<string | null> {
  const uid = actorId(req)
  if (!uid) return null
  const userModule = req.scope.resolve(Modules.USER)
  const user = await userModule.retrieveUser(uid, { select: ["email"] })
  return user?.email ?? null
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

// GET /admin/mkt-tasks/:id
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const uid = actorId(req)
    if (!uid) return res.status(401).json({ error: "Unauthenticated" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const { id } = req.params

    const [task] = await svc.listMktTasks({ id, deleted_at: null })
    if (!task) return res.status(404).json({ error: "Không tìm thấy task" })

    const manager = await isManager(req)
    if (!manager && task.assignee_id !== uid) {
      return res.status(403).json({ error: "Không có quyền" })
    }

    res.json({ task })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

// PATCH /admin/mkt-tasks/:id
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await actorEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const { id } = req.params

    const [task] = await svc.listMktTasks({ id, deleted_at: null })
    if (!task) return res.status(404).json({ error: "Không tìm thấy task" })

    const manager = await isManager(req)
    // assignee_id là email (đồng bộ với mkt-chat identity)
    if (!manager && task.assignee_id !== email) {
      return res.status(403).json({ error: "Không có quyền" })
    }

    const body = req.body as any
    const update: Record<string, any> = {}

    if (manager) {
      if (body.title !== undefined) update.title = body.title
      if (body.notes !== undefined) update.notes = body.notes
      if (body.deadline !== undefined) update.deadline = body.deadline ? new Date(body.deadline) : null
      if (body.assignee_id !== undefined) update.assignee_id = body.assignee_id
      if (body.channel_id !== undefined) update.channel_id = body.channel_id
      if (body.output !== undefined) update.output = body.output || null
      if (body.frequency !== undefined) {
        if (!["once", "daily", "weekly", "monthly"].includes(body.frequency)) return res.status(400).json({ error: "Frequency không hợp lệ" })
        update.frequency = body.frequency
      }
      if (body.priority !== undefined) {
        if (!["high", "medium", "low"].includes(body.priority)) return res.status(400).json({ error: "Priority không hợp lệ" })
        update.priority = body.priority
      }
      if (body.tags !== undefined) {
        if (!Array.isArray(body.tags)) return res.status(400).json({ error: "Tags phải là mảng" })
        update.tags = body.tags.filter((t: any) => typeof t === "string" && t.trim()).slice(0, 10)
      }
    }
    if (body.status !== undefined) {
      // missed do cron set; manager có thể chuyển missed → todo/done khi làm bù.
      const valid = ["todo", "in_progress", "done", "cancelled", "missed"]
      if (!valid.includes(body.status)) return res.status(400).json({ error: "Status không hợp lệ" })
      update.status = body.status
    }
    // Kết quả thực tế: assignee (và manager) điền được khi làm/đóng task của mình
    if (body.result !== undefined) {
      update.result = body.result || null
    }

    if (Object.keys(update).length === 0) return res.status(400).json({ error: "Không có field nào để cập nhật" })

    const updated = await svc.updateMktTasks({ id }, update)

    // Post system message vào channel khi status thay đổi
    if (body.status !== undefined && task.channel_id && body.status !== task.status) {
      const statusLabel: Record<string, string> = {
        in_progress: "🚀 Đang làm",
        done: "✅ Hoàn thành",
        cancelled: "❌ Đã huỷ",
        todo: "⏳ Để làm",
      }
      await svc.createMktMessages({
        channel_id: task.channel_id,
        author_id: email,
        content: `${statusLabel[body.status] ?? body.status}: "${task.title}"`,
        task_id: id,
        msg_type: `task_${body.status}`,
        reactions: {},
        mentions: [],
      }).catch(console.error)
    }

    res.json({ task: updated })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

// DELETE /admin/mkt-tasks/:id
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const uid = actorId(req)
    if (!uid) return res.status(401).json({ error: "Unauthenticated" })
    if (!(await isManager(req))) return res.status(403).json({ error: "Không có quyền" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const { id } = req.params

    await svc.updateMktTasks({ id }, { deleted_at: new Date() })
    res.json({ success: true })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
