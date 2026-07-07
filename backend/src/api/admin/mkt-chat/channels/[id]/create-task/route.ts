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
    const { title, type, assignee_id, deadline, notes } = req.body as any

    if (!title || !type || !assignee_id) {
      return res.status(400).json({ error: "Thiếu title, type hoặc assignee_id" })
    }

    const [channel] = await svc.listMktChannels({ id: channelId, deleted_at: null })
    if (!channel) return res.status(404).json({ error: "Không tìm thấy channel" })

    const task = await svc.createMktTasks({
      title, type, assignee_id,
      created_by: (req as any).auth_context.actor_id,
      deadline: deadline ? new Date(deadline) : undefined,
      notes: notes || null,
      channel_id: channelId,
      status: "todo",
    })

    const userModule = req.scope.resolve(Modules.USER)
    const creator = await userModule.retrieveUser((req as any).auth_context.actor_id, { select: ["first_name", "last_name", "email"] })
    const creatorName = [creator.first_name, creator.last_name].filter(Boolean).join(" ") || creator.email

    const systemMessage = await svc.createMktMessages({
      channel_id: channelId,
      author_id: (req as any).auth_context.actor_id,
      content: `📋 Task mới: "${title}" → ${assignee_id}`,
      task_id: task.id,
      msg_type: "task_created",
      metadata: { task_title: title, created_by_name: creatorName, assignee_id },
      reactions: {},
      mentions: [],
    })

    broadcastToChannel(channelId, "message.created", { message: formatMktMessage(systemMessage, { [(req as any).auth_context.actor_id]: creatorName }) })
    broadcastToChannel(channelId, "channel.updated", {})

    res.json({ task })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
