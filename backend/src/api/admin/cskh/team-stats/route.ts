import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"
import { HOAN_TAGS } from "../../../../modules/cskh-analysis/service"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

const ALLOWED_SOURCES = ["manual", "facebook", "zalo", "unknown", "medusa"]
const NEGLECT_HOURS: Record<string, number | null> = { critical: 4, high: 24, medium: 48, low: null }

function periodStart(period: string): Date {
  const now = Date.now()
  // Boundary hôm nay theo VN (UTC+7)
  const todayVN = new Date(now + 7 * 3600_000).toISOString().slice(0, 10)
  const todayStart = new Date(todayVN + "T00:00:00+07:00")
  if (period === "today") return todayStart
  if (period === "30d") return new Date(now - 30 * 24 * 3600_000)
  return new Date(now - 7 * 24 * 3600_000) // default 7d
}

/**
 * GET /admin/cskh/team-stats?period=7d
 * KPI tổng hợp per CSKH — không dùng AI, query thuần SQL
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { period = "7d" } = req.query as Record<string, string>
    const start = periodStart(period)
    const now = Date.now()
    const nowTs = new Date(now).toISOString()

    // today_vn boundary cho hoan_today
    const todayVN = new Date(now + 7 * 3600_000).toISOString().slice(0, 10)
    const todayStartTs = new Date(todayVN + "T00:00:00+07:00").toISOString()

    const pool = getPool()

    // Query tất cả đơn active (status 2,4) + đơn kết thúc trong period (status 3,4)
    const { rows } = await pool.query(`
      SELECT
        po.id,
        po.care_name,
        po.status,
        po.source,
        po.tags,
        po.last_note_at,
        po.updated_at,
        po.pancake_created_at,
        ca.urgency,
        ca.call_time
      FROM pancake_order po
      LEFT JOIN cskh_analysis ca ON ca.order_id = po.id
      WHERE po.deleted_at IS NULL
        AND po.care_name IS NOT NULL
        AND po.care_name != ''
        AND (
          po.status IN (2, 4)
          OR (po.status IN (3, 4) AND po.updated_at >= $1)
        )
    `, [start.toISOString()])

    // Group by care_name
    const byAgent: Record<string, {
      care_name: string
      total_assigned: number
      active: number
      overdue: number
      neglected: number
      hoan_total: number
      hoan_today: number
      hoan_by_reason: Record<string, number>
    }> = {}

    for (const row of rows) {
      if (!ALLOWED_SOURCES.includes(row.source)) continue

      const name: string = row.care_name
      if (!byAgent[name]) {
        byAgent[name] = {
          care_name: name,
          total_assigned: 0,
          active: 0,
          overdue: 0,
          neglected: 0,
          hoan_total: 0,
          hoan_today: 0,
          hoan_by_reason: {
            Hoan_DoKhach: 0, Hoan_DoKhongLienLacDuoc: 0, Hoan_DoDVVC: 0,
            Hoan_DoKho: 0, Hoan_DoSanPham: 0, Hoan_GiaoHangLau: 0,
            Hoan_KhachTuChoi: 0, missing: 0,
          },
        }
      }
      const ag = byAgent[name]

      // Đơn được giao trong period (tất cả status)
      const createdMs = row.pancake_created_at ? new Date(row.pancake_created_at).getTime() : 0
      if (createdMs >= start.getTime()) ag.total_assigned++

      // Đang xử lý
      if (row.status === 2 || row.status === 4) ag.active++

      // Overdue / neglected — chỉ tính đơn đang active
      if (row.status === 2 || row.status === 4) {
        const noteTime = row.last_note_at ? new Date(row.last_note_at).getTime() : 0
        const callTime = row.call_time ? new Date(row.call_time).getTime() : null
        const overdue = callTime !== null && now > callTime + 2 * 3600_000 && noteTime < callTime
        const limit = NEGLECT_HOURS[row.urgency ?? "low"]
        const neglected = limit !== null && (noteTime === 0 || now - noteTime > limit * 3600_000)
        if (overdue) ag.overdue++
        if (neglected && !overdue) ag.neglected++
      }

      // Hoàn (status 4)
      if (row.status === 4) {
        const updatedMs = row.updated_at ? new Date(row.updated_at).getTime() : 0
        const todayStartMs = new Date(todayStartTs).getTime()

        // Tổng hoàn trong period
        if (updatedMs >= start.getTime()) {
          ag.hoan_total++

          // Breakdown lý do
          const tags: string[] = Array.isArray(row.tags)
            ? row.tags.map((t: any) => t.name ?? t)
            : []
          let foundTag = false
          for (const tag of HOAN_TAGS) {
            if (tags.includes(tag)) {
              ag.hoan_by_reason[tag] = (ag.hoan_by_reason[tag] ?? 0) + 1
              foundTag = true
            }
          }
          if (!foundTag) ag.hoan_by_reason.missing++
        }

        // Hoàn hôm nay
        if (updatedMs >= todayStartMs) ag.hoan_today++
      }
    }

    const result = Object.values(byAgent)
      .filter(ag => ag.total_assigned > 0 || ag.active > 0)
      .map(ag => ({
        ...ag,
        hoan_rate: ag.total_assigned > 0
          ? Math.round((ag.hoan_total / ag.total_assigned) * 1000) / 10
          : 0,
      }))
      .sort((a, b) => b.hoan_rate - a.hoan_rate || b.overdue - a.overdue)

    // Tổng đội
    const team = {
      care_name: "__team__",
      total_assigned: result.reduce((s, a) => s + a.total_assigned, 0),
      active: result.reduce((s, a) => s + a.active, 0),
      overdue: result.reduce((s, a) => s + a.overdue, 0),
      neglected: result.reduce((s, a) => s + a.neglected, 0),
      hoan_total: result.reduce((s, a) => s + a.hoan_total, 0),
      hoan_today: result.reduce((s, a) => s + a.hoan_today, 0),
      hoan_rate: 0,
      hoan_by_reason: HOAN_TAGS.concat("missing").reduce((acc, tag) => {
        acc[tag] = result.reduce((s, a) => s + (a.hoan_by_reason[tag] ?? 0), 0)
        return acc
      }, {} as Record<string, number>),
    }
    team.hoan_rate = team.total_assigned > 0
      ? Math.round((team.hoan_total / team.total_assigned) * 1000) / 10
      : 0

    return res.json({ agents: result, team, period, generated_at: nowTs })
  } catch (err: any) {
    console.error("[CSKH team-stats]", err.message, err.stack)
    return res.status(500).json({ error: err.message })
  }
}
