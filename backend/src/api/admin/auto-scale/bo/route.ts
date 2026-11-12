import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { getPool } from "../../../../lib/db"
import { canEditAdsRules, EDIT_DENIED, logRuleChange } from "../../../../lib/ads-rules"
import { getAuthInfo } from "../../pancake-sync/report/camp-control/_lib"
import { boOverview, getSetting, runCvBo, ensureCvBoTables, STATE_LABEL, PRODUCTS } from "../../../../lib/cv-bo"

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
 *     products: { "KGV": { "enabled": true, "max_new_day": 2, "test_per_day": 1 } } — bật/tắt + giới hạn riêng từng SP (CV mặc định bật, SP khác mặc định tắt)
 *   { action: "add", posts, name?, prio?, state?, product? ("CV" | "KGV"), reason }
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
      const F = ["enabled", "dry_run", "max_camps", "max_new_day", "test_per_day", "cap_total", "bad_day_pct", "week_stop_pct", "products"]
      const sets: string[] = [], vals: any[] = []
      for (const f of F) if (b[f] !== undefined) { vals.push(f === "products" ? JSON.stringify(b[f]) : b[f]); sets.push(`${f} = $${vals.length}`) }
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
    if (b.action === "add") {
      // Thêm / xếp lại bộ vào hàng chờ test: posts [{ post: "{page}_{story}", vd }] — bộ cũ đầu năm chưa có số liệu ad
      const posts = (Array.isArray(b.posts) ? b.posts : []).filter((p: any) => /^\d+_\d+$/.test(String(p?.post || "")))
      if (!posts.length) return res.status(400).json({ error: "Thiếu posts [{post, vd}]" })
      posts.sort((x: any, y: any) => String(x.post).localeCompare(String(y.post)))
      const key = posts.map((p: any) => p.post).join(",")
      const name = String(b.name || "VD" + posts.map((p: any) => String(p.vd || "?").replace(/^VD/i, "")).join("+"))
      const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
      const state = STATE_LABEL[b.state] ? b.state : "QUEUE"
      // 13/11: bộ test lên tay chạy từ 5h hôm sau → since = ngày camp bắt đầu chạy để chấm đủ 3 ngày
      const since = /^\d{4}-\d{2}-\d{2}$/.test(String(b.since || "")) ? String(b.since) : today
      const { rows: before } = await pool.query(`SELECT * FROM cv_bo WHERE key = $1`, [key])
      const { rows } = await pool.query(
        `INSERT INTO cv_bo (key, name, page_id, posts, state, state_since, note, prio, product) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9)
         ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, state = EXCLUDED.state, state_since = EXCLUDED.state_since, extended = false,
           locked = false, note = EXCLUDED.note, prio = EXCLUDED.prio, product = EXCLUDED.product, updated_at = now() RETURNING *`,
        [key, name, String(posts[0].post).split("_")[0], JSON.stringify(posts.map((p: any) => ({ post: p.post, vd: p.vd || "?" }))), state, since, `Người thêm: ${reason}`, Number(b.prio || 0),
         PRODUCTS.some((P) => P.key === b.product) ? b.product : "CV"])
      await logRuleChange("cv_bo", key, before[0] ?? null, rows[0], auth.email, reason)
      return res.json({ ok: true, bo: rows[0] })
    }
    if (b.action === "camp") {
      // Gắn camp lên ngoài hệ thống (launch.mjs, tay) vào bộ — để 23h tính đủ số camp, không lên trùng
      const { rows: bo } = await pool.query(`SELECT key, name FROM cv_bo WHERE key = $1 OR name = $1 LIMIT 1`, [String(b.bo_key || b.bo_name || "")])
      if (!bo[0]) return res.status(404).json({ error: "Không có bộ này (bo_key hoặc bo_name)" })
      const ids: string[] = Array.isArray(b.campaign_ids) ? b.campaign_ids.map(String) : [String(b.campaign_id || "")]
      for (const id of ids.filter(Boolean)) {
        await pool.query(`INSERT INTO cv_bo_camp (campaign_id, bo_key, campaign_name, launched) VALUES ($1,$2,$3,true)
          ON CONFLICT (campaign_id) DO UPDATE SET bo_key = EXCLUDED.bo_key`, [id, bo[0].key, b.campaign_name || null])
      }
      await logRuleChange("cv_bo_camp", bo[0].key, null, { campaign_ids: ids, bo: bo[0].name }, auth.email, reason)
      return res.json({ ok: true, bo: bo[0].name, camps: ids.length })
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
