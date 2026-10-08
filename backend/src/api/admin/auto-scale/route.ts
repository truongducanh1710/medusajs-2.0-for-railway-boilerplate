import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool } from "../../../lib/db"
import { ensureTables, nowVN } from "../../../lib/auto-scale"
import { mktTotalsForDate } from "../../../lib/mkt-today"
import { getAuthInfo } from "../pancake-sync/report/camp-control/_lib"

/** GET /admin/auto-scale — bộ điều kiện, camp đã gắn, nhật ký gần nhất. MKT chỉ thấy camp của mình. */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthorized" })
  await ensureTables()
  const pool = getPool()
  const mktFilter = auth.isSuper ? "" : "WHERE c.mkt_name = ANY($1)"
  const mktParams = auth.isSuper ? [] : [auth.mktCodes]

  const { rows: rules } = await pool.query(
    `SELECT r.*, (SELECT COUNT(*)::int FROM auto_scale_camp c WHERE c.rule_id = r.id) AS camp_count
       FROM auto_scale_rule r ORDER BY r.active DESC, r.id DESC`
  )
  const { rows: camps } = await pool.query(
    `SELECT c.*, r.name AS rule_name, r.dry_run
       FROM auto_scale_camp c JOIN auto_scale_rule r ON r.id = c.rule_id
       ${mktFilter} ORDER BY c.enabled DESC, c.updated_at DESC`,
    mktParams
  )
  const { rows: logs } = await pool.query(
    `SELECT l.* FROM auto_scale_log l
       ${auth.isSuper ? "" : "JOIN auto_scale_camp c ON c.campaign_id = l.campaign_id WHERE c.mkt_name = ANY($1)"}
      ORDER BY l.created_at DESC LIMIT 150`,
    mktParams
  )
  // Quản lý tổng theo MKT: cài đặt + số hôm nay (cùng công thức báo cáo COD theo MKT)
  const { rows: settings } = await pool.query(`SELECT * FROM auto_scale_mkt ORDER BY mkt_name`)
  const totals = await mktTotalsForDate(nowVN().date).catch(() => ({} as Record<string, any>))
  const mktNames = new Set<string>([...settings.map((s: any) => s.mkt_name), ...camps.map((c: any) => c.mkt_name).filter(Boolean)])
  const mkts = [...mktNames]
    .filter((m) => auth.isSuper || auth.mktCodes.includes(m))
    .map((m) => ({ mkt_name: m, setting: settings.find((s: any) => s.mkt_name === m) || null, today: totals[m] || null }))
  return res.json({ rules, camps, logs, mkts, is_super: auth.isSuper, mkt_codes: auth.mktCodes })
}
