import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool } from "../../../../lib/db"
import { ensureTables } from "../../../../lib/auto-scale"
import { getAuthInfo } from "../../pancake-sync/report/camp-control/_lib"

const num = (v: any, min: number, max: number, def: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def
}

/** POST /admin/auto-scale/rules — tạo (không có id) hoặc sửa bộ điều kiện. */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthorized" })
  await ensureTables()
  const b = (req.body || {}) as any
  const name = String(b.name || "").trim()
  if (!name) return res.status(400).json({ error: "Thiếu tên bộ điều kiện" })

  const v = [
    name,
    num(b.target_cpa, 20000, 5_000_000, 200000),
    num(b.min_orders, 1, 50, 2),
    num(b.spend_ratio, 0.3, 3, 1),
    num(b.multiplier, 1.1, 5, 2),
    num(b.max_budget, 100000, 50_000_000, 4_000_000),
    num(b.cooldown_min, 30, 720, 120),
    num(b.revert_factor, 1, 5, 1.5),
    num(b.hour_from, 0, 23, 9),
    num(b.hour_to, 1, 24, 19),
    b.nightly_reset !== false,
    b.dry_run !== false,
    b.active !== false,
  ]
  const pool = getPool()
  if (b.id) {
    const { rows } = await pool.query(
      `UPDATE auto_scale_rule SET name=$1, target_cpa=$2, min_orders=$3, spend_ratio=$4, multiplier=$5, max_budget=$6,
         cooldown_min=$7, revert_factor=$8, hour_from=$9, hour_to=$10, nightly_reset=$11, dry_run=$12, active=$13, updated_at=now()
       WHERE id=$14 RETURNING *`,
      [...v, b.id]
    )
    if (!rows.length) return res.status(404).json({ error: "Không tìm thấy bộ điều kiện" })
    return res.json({ rule: rows[0] })
  }
  const { rows } = await pool.query(
    `INSERT INTO auto_scale_rule (name, target_cpa, min_orders, spend_ratio, multiplier, max_budget, cooldown_min,
       revert_factor, hour_from, hour_to, nightly_reset, dry_run, active, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [...v, auth.email]
  )
  return res.json({ rule: rows[0] })
}

/** DELETE /admin/auto-scale/rules?id= — chỉ xoá được khi không còn camp nào gắn. */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthorized" })
  await ensureTables()
  const id = Number((req.query as any).id)
  const pool = getPool()
  const { rows } = await pool.query(`SELECT COUNT(*)::int n FROM auto_scale_camp WHERE rule_id = $1`, [id])
  if (rows[0].n > 0) return res.status(400).json({ error: `Còn ${rows[0].n} camp đang gắn — gỡ camp hoặc tắt bộ điều kiện trước` })
  await pool.query(`DELETE FROM auto_scale_rule WHERE id = $1`, [id])
  return res.json({ ok: true })
}
