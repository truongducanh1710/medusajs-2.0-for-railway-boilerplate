import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getAuthInfo } from "../camp-control/_lib"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sql = req.scope.resolve("cskhAnalysisModule") as any
  const thresholds = await sql(`SELECT * FROM product_care_threshold ORDER BY product_label ASC`).catch(() => [])
  return res.json({ thresholds })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthenticated" })
  if (!auth.isSuper) return res.status(403).json({ error: "Chỉ super admin" })

  const sql = req.scope.resolve("cskhAnalysisModule") as any
  const { product_key, product_label, target_cpr,
    new_camp_multiplier = 2.0, old_camp_warn_multiplier = 1.5, old_camp_kill_multiplier = 2.0 } = req.body as any

  const [row] = await sql(`
    INSERT INTO product_care_threshold
      (product_key, product_label, target_cpr, new_camp_multiplier, old_camp_warn_multiplier, old_camp_kill_multiplier, updated_by_email)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (product_key) DO UPDATE SET
      product_label = EXCLUDED.product_label,
      target_cpr = EXCLUDED.target_cpr,
      new_camp_multiplier = EXCLUDED.new_camp_multiplier,
      old_camp_warn_multiplier = EXCLUDED.old_camp_warn_multiplier,
      old_camp_kill_multiplier = EXCLUDED.old_camp_kill_multiplier,
      updated_by_email = EXCLUDED.updated_by_email,
      updated_at = now()
    RETURNING *
  `, [product_key, product_label, target_cpr, new_camp_multiplier, old_camp_warn_multiplier, old_camp_kill_multiplier, auth.email])

  return res.json({ threshold: row })
}
