import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { getPool } from "../../../../lib/db"
import { vnDayKey } from "../../mkt-chat/_presence"

type TimelineItem = {
  at: string
  kind: "session" | "message" | "task" | "call"
  label: string
  detail?: string
  meta?: Record<string, any>
}

// GET /admin/cham-cong/timeline?email=...&date=2026-07-15
// Nhật ký 1 người trong 1 ngày: phiên online + tin nhắn + task + cuộc gọi, trộn theo thời gian.
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = String((req.query as any).email || "")
    const date = String((req.query as any).date || vnDayKey())
    if (!email) return res.status(400).json({ error: "Thiếu email" })

    const fromTs = `${date}T00:00:00+07:00`
    const toTs = `${date}T23:59:59.999+07:00`
    const pool = getPool()

    const userModule = req.scope.resolve(Modules.USER)
    const users = await userModule.listUsers({ email }, { select: ["id", "email", "first_name", "last_name"] })
    const user = users[0]
    if (!user) return res.status(404).json({ error: "Không tìm thấy nhân sự" })

    const [sessions, messages, tasks, calls] = await Promise.all([
      pool.query(
        `SELECT started_at, ended_at, last_seen_at, active_seconds, idle_seconds, status
         FROM mkt_presence_session
         WHERE user_email = $1 AND day_key = $2
         ORDER BY started_at`,
        [email, date]
      ),
      pool.query(
        `SELECT m.created_at, m.content, m.msg_type, c.name AS channel_name
         FROM mkt_message m
         LEFT JOIN mkt_channel c ON c.id = m.channel_id
         WHERE m.author_id = $1 AND m.created_at BETWEEN $2 AND $3
           AND m.deleted_at IS NULL AND m.channel_id <> '__notify__'
           AND m.msg_type NOT IN ('system', 'system_notify', 'mention')
         ORDER BY m.created_at`,
        [email, fromTs, toTs]
      ),
      pool.query(
        `SELECT id, title, status, updated_at, created_at, rating
         FROM mkt_task
         WHERE assignee_id = $1 AND deleted_at IS NULL AND is_template = false
           AND COALESCE(updated_at, created_at) BETWEEN $2 AND $3
         ORDER BY COALESCE(updated_at, created_at)`,
        [email, fromTs, toTs]
      ),
      pool.query(
        `SELECT c.calldate, c.customer_phone, c.billsec, c.disposition
         FROM ity_cdr_call c
         JOIN ity_extension_map m ON m.extension = c.extension
         WHERE m.user_id = $1 AND c.calldate BETWEEN $2 AND $3 AND c.direction = 'outgoing'
         ORDER BY c.calldate`,
        [user.id, fromTs, toTs]
      ).catch(() => ({ rows: [] as any[] })),
    ])

    const items: TimelineItem[] = []

    for (const s of sessions.rows) {
      items.push({
        at: s.started_at,
        kind: "session",
        label: "Mở tab — bắt đầu phiên online",
        meta: { active_seconds: s.active_seconds, idle_seconds: s.idle_seconds },
      })
      const end = s.ended_at || null
      if (end) {
        items.push({
          at: end,
          kind: "session",
          label: "Kết thúc phiên",
          detail: `Online ${fmtDur(s.active_seconds)} · Idle ${fmtDur(s.idle_seconds)}`,
        })
      }
    }
    for (const m of messages.rows) {
      items.push({
        at: m.created_at,
        kind: "message",
        label: `Nhắn tin ở #${m.channel_name || "?"}`,
        detail: String(m.content || "").slice(0, 120),
      })
    }
    for (const t of tasks.rows) {
      items.push({
        at: t.updated_at || t.created_at,
        kind: "task",
        label: `Task [${t.status}] ${t.title}`,
        detail: t.rating ? `Đánh giá: ${t.rating}/5` : undefined,
        meta: { task_id: t.id },
      })
    }
    for (const c of calls.rows) {
      items.push({
        at: c.calldate,
        kind: "call",
        label: `Gọi ${c.customer_phone}`,
        detail: `${c.disposition === "ANSWERED" ? "Nghe máy" : c.disposition} · ${fmtDur(c.billsec)}`,
      })
    }

    items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

    res.json({
      email,
      date,
      name: [user.first_name, user.last_name].filter(Boolean).join(" ") || email,
      summary: {
        active_seconds: sessions.rows.reduce((s: number, r: any) => s + Number(r.active_seconds || 0), 0),
        idle_seconds: sessions.rows.reduce((s: number, r: any) => s + Number(r.idle_seconds || 0), 0),
        messages: messages.rows.length,
        tasks_done: tasks.rows.filter((t: any) => t.status === "done").length,
        calls: calls.rows.length,
      },
      items,
    })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

function fmtDur(sec: number): string {
  const s = Math.max(0, Math.floor(Number(sec) || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}m` : `${m}m`
}
