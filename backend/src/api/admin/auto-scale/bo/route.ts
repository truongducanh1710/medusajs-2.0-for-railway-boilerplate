import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { getPool } from "../../../../lib/db"
import { canEditAdsRules, EDIT_DENIED, logRuleChange } from "../../../../lib/ads-rules"
import { getAuthInfo } from "../../pancake-sync/report/camp-control/_lib"
import { boOverview, getSetting, runCvBo, ensureCvBoTables, STATE_LABEL } from "../../../../lib/cv-bo"

/** GET /admin/auto-scale/bo — cài đặt, danh sách bộ chảo vàng + số liệu, 300 dòng nhật ký gần nhất. */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthorized" })
  try {
    return res.json({ ...(await boOverview()), can_edit: canEditAdsRules(auth.email) })
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
}

/**
 * POST /admin/auto-scale/bo — chỉ AI, luôn kèm reason.
 *   { action: "setting", enabled?, dry_run?, max_camps?, max_new_day?, test_per_day?, cap_total?, bad_day_pct?, week_stop_pct?, reason }
 *   { action: "state", key, state, locked?, reason }   — đặt tay trạng thái bộ (vd HOAN bộ Tết, QUEUE để test lại)
 *   { action: "run", mode: "check" | "night" | "morning" | "summary", reason }
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthorized" })
  if (!canEditAdsRules(auth.email)) return res.status(403).json({ error: EDIT_DENIED })
  const b = (req.body || {}) as any
  const reason = String(b.reason || "").trim()
  if (!reason) return res.status(400).json({ error: "Thiếu reason" })
  await ensureCvBoTables()
  const pool = getPool()
  try {
    if (b.action === "setting") {
      const before = await getSetting()
      const F = ["enabled", "dry_run", "max_camps", "max_new_day", "test_per_day", "cap_total", "bad_day_pct", "week_stop_pct"]
      const sets: string[] = [], vals: any[] = []
      for (const f of F) if (b[f] !== undefined) { vals.push(b[f]); sets.push(`${f} = $${vals.length}`) }
      if (!sets.length) return res.status(400).json({ error: "Không có trường nào để sửa" })
      vals.push(auth.email)
      await pool.query(`UPDATE cv_bo_setting SET ${sets.join(", ")}, updated_by = $${vals.length}, updated_at = now() WHERE id = 1`, vals)
      const after = await getSetting()
      await logRuleChange("cv_bo_setting", 1, before, after, auth.email, reason)
      return res.json({ ok: true, setting: after })
    }
    if (b.action === "state") {
      if (!STATE_LABEL[b.state]) return res.status(400).json({ error: `state phải là ${Object.keys(STATE_LABEL).join("/")}` })
      const { rows: before } = await pool.query(`SELECT * FROM cv_bo WHERE key = $1`, [b.key])
      if (!before[0]) return res.status(404).json({ error: "Không có bộ này" })
      const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
      const { rows } = await pool.query(
        `UPDATE cv_bo SET state = $2, state_since = $3, extended = false, locked = $4, note = $5, updated_at = now() WHERE key = $1 RETURNING *`,
        [b.key, b.state, today, b.locked === true || b.state === "HOAN", `Người đặt: ${reason}`])
      await logRuleChange("cv_bo", b.key, before[0], rows[0], auth.email, reason)
      return res.json({ ok: true, bo: rows[0] })
    }
    if (b.action === "run") {
      const r = await runCvBo(req.scope.resolve(Modules.USER), b.mode)
      return res.json({ ok: true, result: r })
    }
    return res.status(400).json({ error: "action phải là setting / state / run" })
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
}
