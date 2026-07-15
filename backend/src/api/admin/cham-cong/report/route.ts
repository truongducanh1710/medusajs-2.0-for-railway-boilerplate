import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { getPool } from "../../../../lib/db"
import { reapStalePresenceSessions, PRESENCE_IDLE_MS, vnDayKey } from "../../mkt-chat/_presence"

// GET /admin/cham-cong/report?from=2026-07-15&to=2026-07-15
// Tổng hợp: giờ online/idle (từ presence session) + việc đã làm thật (tin nhắn, task, cuộc gọi).
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    // Chốt các session mồ côi trước khi cộng giờ, nếu không số liệu sẽ phồng lên.
    await reapStalePresenceSessions()

    const from = String((req.query as any).from || vnDayKey())
    const to = String((req.query as any).to || from)
    const pool = getPool()

    // Khoảng thời gian tuyệt đối theo giờ VN để lọc message/task/call (chúng lưu timestamptz).
    const fromTs = `${from}T00:00:00+07:00`
    const toTs = `${to}T23:59:59.999+07:00`

    const userModule = req.scope.resolve(Modules.USER)
    const users = await userModule.listUsers({}, { select: ["id", "email", "first_name", "last_name", "metadata"] })

    const [presence, live, messages, tasks, calls] = await Promise.all([
      pool.query(
        `SELECT user_email,
                SUM(active_seconds)::int AS active_seconds,
                SUM(idle_seconds)::int AS idle_seconds,
                MIN(started_at) AS first_seen,
                MAX(COALESCE(ended_at, last_seen_at)) AS last_seen,
                COUNT(*)::int AS session_count
         FROM mkt_presence_session
         WHERE day_key >= $1 AND day_key <= $2
         GROUP BY user_email`,
        [from, to]
      ),
      pool.query(
        `SELECT user_email,
                bool_or(last_active_at > now() - ($1 || ' milliseconds')::interval) AS is_active
         FROM mkt_presence_session WHERE ended_at IS NULL GROUP BY user_email`,
        [PRESENCE_IDLE_MS]
      ),
      pool.query(
        `SELECT author_id AS email, COUNT(*)::int AS n
         FROM mkt_message
         WHERE created_at BETWEEN $1 AND $2 AND deleted_at IS NULL
           AND channel_id <> '__notify__'
           AND msg_type NOT IN ('system', 'system_notify', 'mention')
         GROUP BY author_id`,
        [fromTs, toTs]
      ),
      pool.query(
        `SELECT assignee_id AS email,
                COUNT(*) FILTER (WHERE status = 'done')::int AS done,
                COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
                COUNT(*) FILTER (WHERE status NOT IN ('done', 'cancelled'))::int AS pending
         FROM mkt_task
         WHERE deleted_at IS NULL AND is_template = false
           AND COALESCE(updated_at, created_at) BETWEEN $1 AND $2
         GROUP BY assignee_id`,
        [fromTs, toTs]
      ),
      // CDR chỉ biết extension → phải qua ity_extension_map.user_id rồi mới ra email.
      pool.query(
        `SELECT u.email AS email,
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE c.disposition = 'ANSWERED')::int AS answered,
                COALESCE(SUM(c.billsec), 0)::int AS talk_seconds
         FROM ity_cdr_call c
         JOIN ity_extension_map m ON m.extension = c.extension AND m.user_id IS NOT NULL
         JOIN "user" u ON u.id = m.user_id
         WHERE c.calldate BETWEEN $1 AND $2 AND c.direction = 'outgoing'
         GROUP BY u.email`,
        [fromTs, toTs]
      ).catch(() => ({ rows: [] as any[] })), // tổng đài chưa map extension → bỏ qua, không vỡ report
    ])

    const byEmail = <T extends { email?: string; user_email?: string }>(rows: T[]) =>
      Object.fromEntries(rows.map(r => [r.email ?? r.user_email, r]))
    const pMap = byEmail(presence.rows)
    const liveMap = byEmail(live.rows)
    const mMap = byEmail(messages.rows)
    const tMap = byEmail(tasks.rows)
    const cMap = byEmail(calls.rows)

    const rows = users
      .filter((u: any) => !u.deleted_at)
      .map((u: any) => {
        const p = pMap[u.email] || {}
        const l = liveMap[u.email]
        const m = mMap[u.email] || {}
        const t = tMap[u.email] || {}
        const c = cMap[u.email] || {}
        return {
          email: u.email,
          name: [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email,
          role: (u.metadata as any)?.role || "",
          status: l ? (l.is_active ? "online" : "idle") : "offline",
          active_seconds: Number(p.active_seconds || 0),
          idle_seconds: Number(p.idle_seconds || 0),
          first_seen: p.first_seen || null,
          last_seen: p.last_seen || null,
          session_count: Number(p.session_count || 0),
          messages: Number(m.n || 0),
          tasks_done: Number(t.done || 0),
          tasks_in_progress: Number(t.in_progress || 0),
          tasks_pending: Number(t.pending || 0),
          calls: Number(c.total || 0),
          calls_answered: Number(c.answered || 0),
          talk_seconds: Number(c.talk_seconds || 0),
        }
      })
      .sort((a, b) => b.active_seconds - a.active_seconds || a.name.localeCompare(b.name))

    res.json({ from, to, rows })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
