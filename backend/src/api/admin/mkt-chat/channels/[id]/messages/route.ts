import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

function actorId(req: MedusaRequest): string | null {
  const auth = (req as any).auth_context
  return auth?.actor_type === "user" ? auth.actor_id : null
}

// Identity key = email (đồng bộ toàn feature mkt-chat)
async function actorEmail(req: MedusaRequest): Promise<string | null> {
  const uid = actorId(req)
  if (!uid) return null
  const userModule = req.scope.resolve(Modules.USER)
  const user = await userModule.retrieveUser(uid, { select: ["email"] })
  return user?.email ?? null
}

// GET /admin/mkt-chat/channels/:id/messages
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const uid = actorId(req)
    if (!uid) return res.status(401).json({ error: "Unauthenticated" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const { id } = req.params
    const { before, limit = "50" } = req.query as any

    const [channel] = await svc.listMktChannels({ id, deleted_at: null })
    if (!channel) return res.status(404).json({ error: "Không tìm thấy channel" })

    const filter: any = { channel_id: id, deleted_at: null }
    if (before) filter.created_at = { $lt: new Date(before) }

    const messages = await svc.listMktMessages(filter, {
      order: { created_at: "DESC" },
      take: Math.min(Number(limit), 100),
    })

    // Resolve author names — author_id lưu bằng email nên map theo email
    const userModule = req.scope.resolve(Modules.USER)
    const allUsers = await userModule.listUsers({}, { select: ["email", "first_name", "last_name"] })
    const nameByEmail: Record<string, string> = {}
    for (const u of allUsers) {
      nameByEmail[u.email] = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email
    }

    const enriched = messages.reverse().map((m: any) => ({
      ...m,
      author_name: m.author_id === "ai" ? "AI Assistant" : (nameByEmail[m.author_id] || m.author_id),
    }))

    res.json({ messages: enriched })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

// POST /admin/mkt-chat/channels/:id/messages
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await actorEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const { id } = req.params
    const { content } = req.body as any
    if (!content?.trim()) return res.status(400).json({ error: "Nội dung không được rỗng" })

    const [channel] = await svc.listMktChannels({ id, deleted_at: null })
    if (!channel) return res.status(404).json({ error: "Không tìm thấy channel" })

    // Check @ai command
    const isAiCommand = content.trim().toLowerCase().startsWith("@ai ")
    const question = isAiCommand ? content.trim().slice(4).trim() : ""

    const message = await svc.createMktMessages({
      channel_id: id,
      author_id: email,
      content: content.trim(),
      msg_type: "text",
    })

    // Handle @ai async - post response as separate message
    if (isAiCommand && question) {
      if (process.env.ANTHROPIC_API_KEY) {
        handleAiResponse(svc, id, question).catch(console.error)
      } else {
        await svc.createMktMessages({
          channel_id: id,
          author_id: "ai",
          content: "⚠️ Tính năng @ai chưa bật (thiếu ANTHROPIC_API_KEY).",
          msg_type: "ai_response",
        })
      }
    }

    res.json({ message })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

async function handleAiResponse(svc: any, channelId: string, question: string) {
  try {
    // Get task context for this channel
    const tasks = await svc.listMktTasks({ channel_id: channelId, deleted_at: null })
    const taskSummary = tasks.map((t: any) =>
      `- ${t.title} [${t.type}] → ${t.assignee_id} | ${t.status}${t.deadline ? ` | deadline: ${t.deadline}` : ""}${t.rating ? ` | ★${t.rating}` : ""}`
    ).join("\n")

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        system: `Bạn là trợ lý quản lý team marketing Phan Viet. Trả lời ngắn gọn bằng tiếng Việt.\nDanh sách task của channel này:\n${taskSummary || "(Chưa có task nào)"}`,
        messages: [{ role: "user", content: question }],
      }),
    })
    const data = await response.json() as any
    const aiText = data.content?.[0]?.text || "Không thể xử lý câu hỏi này."

    await svc.createMktMessages({
      channel_id: channelId,
      author_id: "ai",
      content: aiText,
      msg_type: "ai_response",
    })
  } catch (e) {
    await svc.createMktMessages({
      channel_id: channelId,
      author_id: "ai",
      content: "⚠️ AI không thể trả lời lúc này.",
      msg_type: "ai_response",
    })
  }
}
