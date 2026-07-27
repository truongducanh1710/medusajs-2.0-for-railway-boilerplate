import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { broadcastToChannel, formatMktMessage, getMktChatAuthInfo } from "../../../_lib"

// POST /admin/mkt-chat/channels/:id/create-task
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getMktChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const { id: channelId } = req.params
    const { title, type, assignee_id, assignee_ids, deadline, notes } = req.body as any

    // Nhận cả assignee_ids[] (giao nhiều người) lẫn assignee_id đơn (tương thích cũ).
    const rawAssignees: string[] = Array.isArray(assignee_ids) && assignee_ids.length
      ? assignee_ids
      : (assignee_id ? [assignee_id] : [])
    const assignees = Array.from(new Set(
      rawAssignees.map((a) => (typeof a === "string" ? a.trim().toLowerCase() : "")).filter(Boolean),
    ))

    if (!title || !type || assignees.length === 0) {
      return res.status(400).json({ error: "Thiếu title, type hoặc người nhận" })
    }

    const [channel] = await svc.listMktChannels({ id: channelId, deleted_at: null })
    if (!channel) return res.status(404).json({ error: "Không tìm thấy channel" })

    // Chỉ cho giao cho thành viên của channel này (user_id lưu email).
    const memberEmails = new Set(
      (Array.isArray(channel.members) ? channel.members : [])
        .map((m: any) => (typeof m?.user_id === "string" ? m.user_id.toLowerCase() : ""))
        .filter(Boolean),
    )
    const invalid = assignees.filter((a) => !memberEmails.has(a))
    if (invalid.length > 0) {
      return res.status(400).json({ error: `Người nhận không thuộc nhóm: ${invalid.join(", ")}` })
    }

    const actorId = (req as any).auth_context.actor_id
    const userModule = req.scope.resolve(Modules.USER)
    const creator = await userModule.retrieveUser(actorId, { select: ["first_name", "last_name", "email"] })
    const creatorName = [creator.first_name, creator.last_name].filter(Boolean).join(" ") || creator.email

    // Tạo 1 task riêng cho mỗi người nhận (mỗi người có task độc lập để theo dõi/hoàn thành).
    const tasks = []
    for (const email of assignees) {
      const task = await svc.createMktTasks({
        title, type, assignee_id: email,
        created_by: actorId,
        deadline: deadline ? new Date(deadline) : undefined,
        notes: notes || null,
        channel_id: channelId,
        status: "todo",
        tags: [],
        comments: [],
      })
      tasks.push(task)
    }

    const assigneesLabel = assignees.join(", ")
    const systemMessage = await svc.createMktMessages({
      channel_id: channelId,
      author_id: actorId,
      content: `📋 Task mới: "${title}" → ${assigneesLabel}`,
      task_id: tasks[0]?.id,
      msg_type: "task_created",
      metadata: { task_title: title, created_by_name: creatorName, assignee_id: assigneesLabel, assignee_ids: assignees },
      reactions: {},
      mentions: [],
    })

    broadcastToChannel(channelId, "message.created", { message: formatMktMessage(systemMessage, { [actorId]: creatorName }) })
    broadcastToChannel(channelId, "channel.updated", {})

    res.json({ tasks, task: tasks[0] })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
