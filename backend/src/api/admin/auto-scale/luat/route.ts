import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool } from "../../../../lib/db"
import { canEditAdsRules, EDIT_DENIED, ensureAdsRuleTables, logRuleChange } from "../../../../lib/ads-rules"
import { getAuthInfo } from "../../pancake-sync/report/camp-control/_lib"

/**
 * GET /admin/auto-scale/luat — luật ads hiện hành (nguồn sự thật cho mọi AI) + 100 lần sửa gần nhất
 * (luật, bộ điều kiện Tự scale, gắn/gỡ camp, tổng theo MKT).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthorized" })
  await ensureAdsRuleTables()
  const pool = getPool()
  const { rows: rules } = await pool.query(`SELECT * FROM ads_rule ORDER BY sort, key`)
  const { rows: history } = await pool.query(`SELECT * FROM ads_rule_history ORDER BY created_at DESC LIMIT 100`)
  return res.json({ rules, history, can_edit: canEditAdsRules(auth.email) })
}

/**
 * POST /admin/auto-scale/luat — chỉ AI. body: { rules: [{ key, nhom, tieu_de, noi_dung, nguon?, bang_chung?, sort? }], reason }
 * Upsert theo key; dòng không đổi thì bỏ qua (không ghi lịch sử).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthorized" })
  if (!canEditAdsRules(auth.email)) return res.status(403).json({ error: EDIT_DENIED })
  const b = (req.body || {}) as any
  const list = Array.isArray(b.rules) ? b.rules : []
  const reason = String(b.reason || "").trim()
  if (!list.length) return res.status(400).json({ error: "Thiếu rules" })
  if (!reason) return res.status(400).json({ error: "Thiếu reason (vì sao sửa luật)" })
  await ensureAdsRuleTables()
  const pool = getPool()
  const F = ["nhom", "tieu_de", "noi_dung", "nguon", "bang_chung", "sort"] as const
  let changed = 0
  for (const r of list) {
    const key = String(r.key || "").trim()
    if (!key || !r.nhom || !r.tieu_de || !r.noi_dung) return res.status(400).json({ error: `Luật thiếu key/nhom/tieu_de/noi_dung: ${key || "?"}` })
    const { rows: before } = await pool.query(`SELECT * FROM ads_rule WHERE key = $1`, [key])
    const next = { nhom: String(r.nhom), tieu_de: String(r.tieu_de), noi_dung: String(r.noi_dung), nguon: r.nguon ?? null, bang_chung: r.bang_chung ?? null, sort: Number(r.sort ?? before[0]?.sort ?? 0) }
    if (before[0] && F.every((f) => String(before[0][f] ?? "") === String((next as any)[f] ?? ""))) continue
    const { rows } = await pool.query(
      `INSERT INTO ads_rule (key, nhom, tieu_de, noi_dung, nguon, bang_chung, sort, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
       ON CONFLICT (key) DO UPDATE SET nhom=EXCLUDED.nhom, tieu_de=EXCLUDED.tieu_de, noi_dung=EXCLUDED.noi_dung, nguon=EXCLUDED.nguon,
         bang_chung=EXCLUDED.bang_chung, sort=EXCLUDED.sort, updated_by=EXCLUDED.updated_by, updated_at=now()
       RETURNING *`,
      [key, next.nhom, next.tieu_de, next.noi_dung, next.nguon, next.bang_chung, next.sort, auth.email]
    )
    await logRuleChange("ads_rule", key, before[0] ?? null, rows[0], auth.email, reason)
    changed++
  }
  return res.json({ ok: true, changed })
}

/** DELETE /admin/auto-scale/luat?key=&reason= — chỉ AI. */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthorized" })
  if (!canEditAdsRules(auth.email)) return res.status(403).json({ error: EDIT_DENIED })
  const { key, reason } = req.query as Record<string, string>
  if (!key || !reason) return res.status(400).json({ error: "Cần key và reason" })
  await ensureAdsRuleTables()
  const { rows } = await getPool().query(`DELETE FROM ads_rule WHERE key = $1 RETURNING *`, [key])
  if (rows[0]) await logRuleChange("ads_rule", key, rows[0], null, auth.email, reason)
  return res.json({ ok: true, deleted: rows.length })
}
