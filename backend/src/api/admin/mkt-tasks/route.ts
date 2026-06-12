import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import {
  Frequency,
  vnDate,
  periodKeyFor,
  periodDeadline,
  spawnInstanceForPeriod,
} from "../../../modules/mkt-task/recurring-helpers"

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

// GET /admin/mkt-tasks
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const uid = actorId(req)
    if (!uid) return res.status(401).json({ error: "Unauthenticated" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const { status, type, assignee_id, group_by, priority, tag, channel_id } = req.query as any

    const manager = await isManager(req)

    // Build filter
    const filter: Record<string, any> = {}
    if (!manager) filter.assignee_id = uid  // MKT only sees own tasks
    else if (assignee_id) filter.assignee_id = assignee_id
    if (status && status !== "all") filter.status = status
    if (type) filter.type = type
    if (priority) filter.priority = priority
    if (channel_id) filter.channel_id = channel_id

    let tasks = await svc.listMktTasks(filter, {
      select: ["id", "title", "type", "assignee_id", "created_by", "deadline", "status", "priority", "tags", "notes", "comments", "rating", "channel_id", "created_at", "updated_at", "output", "result", "frequency", "is_template", "template_id", "period_key", "checklist"],
      order: { created_at: "DESC" },
    })

    // Tag filter (jsonb array — lọc trong JS để khỏi phụ thuộc operator)
    if (tag) {
      tasks = tasks.filter((t: any) => Array.isArray(t.tags) && t.tags.includes(tag))
    }

    // Resolve assignee names
    const userModule = req.scope.resolve(Modules.USER)
    const allUsers = await userModule.listUsers({}, { select: ["id", "email", "first_name", "last_name"] })
    const userMap: Record<string, string> = {}
    for (const u of allUsers) {
      userMap[u.id] = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email
    }

    const enriched = tasks.map((t: any) => ({
      ...t,
      assignee_name: userMap[t.assignee_id] || t.assignee_id,
    }))

    // Group if requested
    if (group_by === "assignee") {
      const groups: Record<string, any[]> = {}
      for (const t of enriched) {
        const key = t.assignee_name
        if (!groups[key]) groups[key] = []
        groups[key].push(t)
      }
      return res.json({ grouped: true, group_by: "assignee", groups })
    }
    if (group_by === "type") {
      const groups: Record<string, any[]> = {}
      for (const t of enriched) {
        if (!groups[t.type]) groups[t.type] = []
        groups[t.type].push(t)
      }
      return res.json({ grouped: true, group_by: "type", groups })
    }
    if (group_by === "week") {
      const groups: Record<string, any[]> = {}
      for (const t of enriched) {
        const d = t.deadline ? new Date(t.deadline) : null
        const key = d ? `${d.getFullYear()}-W${String(getWeek(d)).padStart(2, "0")}` : "Không có deadline"
        if (!groups[key]) groups[key] = []
        groups[key].push(t)
      }
      return res.json({ grouped: true, group_by: "week", groups })
    }

    res.json({ tasks: enriched })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

// POST /admin/mkt-tasks
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const uid = actorId(req)
    if (!uid) return res.status(401).json({ error: "Unauthenticated" })
    if (!(await isManager(req))) return res.status(403).json({ error: "Không có quyền" })

    const { title, type, assignee_id, deadline, notes, channel_id, priority, tags, status, output, frequency, checklist } = req.body as any
    if (!title || !type || !assignee_id) {
      return res.status(400).json({ error: "Thiếu title, type hoặc assignee_id" })
    }
    const validPriority = ["high", "medium", "low"].includes(priority) ? priority : "medium"
    const validStatus = ["todo", "in_progress"].includes(status) ? status : "todo"
    const validFrequency: Frequency = ["once", "daily", "weekly", "monthly"].includes(frequency) ? frequency : "once"
    const isRecurring = validFrequency !== "once"
    const cleanTags = Array.isArray(tags) ? tags.filter((t: any) => typeof t === "string" && t.trim()).slice(0, 10) : []

    const svc = req.scope.resolve("mktTaskModule") as any
    const task = await svc.createMktTasks({
      title, type, assignee_id,
      created_by: uid,
      // Template không cần deadline thực — instance mới mang deadline cuối kỳ
      deadline: isRecurring ? null : (deadline ? new Date(deadline) : undefined),
      notes: notes || null,
      channel_id: channel_id || null,
      status: validStatus,
      priority: validPriority,
      tags: cleanTags,
      comments: [],
      output: output || null,
      frequency: validFrequency,
      is_template: isRecurring,
      checklist: sanitizeChecklist(checklist),
    })

    // Recurring → sinh ngay instance kỳ hiện tại để nhân sự thấy việc luôn
    if (isRecurring) {
      const vn = vnDate()
      const periodKey = periodKeyFor(validFrequency, vn)
      const instDeadline = periodDeadline(validFrequency, vn)
      await spawnInstanceForPeriod(svc, task, periodKey, instDeadline).catch(() => {})
    }

    // Post system message to channel if provided
    if (channel_id) {
      const userModule = req.scope.resolve(Modules.USER)
      const creator = await userModule.retrieveUser(uid, { select: ["first_name", "last_name", "email"] })
      const creatorName = [creator.first_name, creator.last_name].filter(Boolean).join(" ") || creator.email
      await svc.createMktMessages({
        channel_id,
        author_id: uid,
        content: isRecurring
          ? `🔁 Việc lặp mới: "${title}" (${validFrequency}) → ${assignee_id}`
          : `📋 Task mới: "${title}" → ${assignee_id}`,
        task_id: task.id,
        msg_type: isRecurring ? "recurring_created" : "task_created",
        metadata: { task_title: title, created_by_name: creatorName, assignee_id },
      })
    }

    res.json({ task })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

// Checklist [{ id, text, done }] — bỏ item rỗng, giới hạn 30 mục / 500 ký tự
function sanitizeChecklist(raw: any): { id: string; text: string; done: boolean }[] | null {
  if (!Array.isArray(raw)) return null
  return raw
    .filter((i: any) => i && typeof i.text === "string" && i.text.trim())
    .slice(0, 30)
    .map((i: any) => ({
      id: typeof i.id === "string" && i.id ? i.id : Math.random().toString(36).slice(2, 10),
      text: i.text.trim().slice(0, 500),
      done: !!i.done,
    }))
}

function getWeek(d: Date): number {
  const onejan = new Date(d.getFullYear(), 0, 1)
  return Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7)
}
