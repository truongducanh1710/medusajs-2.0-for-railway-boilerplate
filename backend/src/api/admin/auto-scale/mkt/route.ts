import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool } from "../../../../lib/db"
import { ensureTables } from "../../../../lib/auto-scale"
import { getAuthInfo } from "../../pancake-sync/report/camp-control/_lib"

const num = (v: any, min: number, max: number, def: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def
}

/** POST /admin/auto-scale/mkt — bật/sửa quản lý tổng theo MKT (giữ % chi phí cả MKT trong ngày). */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthorized" })
  await ensureTables()
  const b = (req.body || {}) as any
  const mkt = String(b.mkt_name || "").trim().toUpperCase()
  if (!mkt) return res.status(400).json({ error: "Thiếu mkt_name" })
  if (!auth.isSuper && !auth.mktCodes.includes(mkt)) return res.status(403).json({ error: `Không có quyền với MKT ${mkt}` })
  const { rows } = await getPool().query(
    `INSERT INTO auto_scale_mkt (mkt_name, enabled, dry_run, max_pct, lenient_max_pct, trim_hour, trim_spend, trim_min_spend, updated_by, trim_camp_pct, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
     ON CONFLICT (mkt_name) DO UPDATE SET enabled=EXCLUDED.enabled, dry_run=EXCLUDED.dry_run, max_pct=EXCLUDED.max_pct,
       lenient_max_pct=EXCLUDED.lenient_max_pct, trim_hour=EXCLUDED.trim_hour, trim_spend=EXCLUDED.trim_spend,
       trim_min_spend=EXCLUDED.trim_min_spend, trim_camp_pct=EXCLUDED.trim_camp_pct, updated_by=EXCLUDED.updated_by, updated_at=now()
     RETURNING *`,
    [mkt, b.enabled === true, b.dry_run !== false, num(b.max_pct, 5, 200, 27), num(b.lenient_max_pct, 10, 500, 70),
     num(b.trim_hour, 0, 24, 16), num(b.trim_spend, 0, 500_000_000, 0), num(b.trim_min_spend, 0, 50_000_000, 400_000), auth.email,
     num(b.trim_camp_pct, 5, 500, 40)]
  )
  return res.json({ setting: rows[0] })
}
