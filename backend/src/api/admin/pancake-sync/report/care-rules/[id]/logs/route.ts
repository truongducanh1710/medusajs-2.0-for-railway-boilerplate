import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getAuthInfo } from "../../../camp-control/_lib"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthenticated" })

  const sql = req.scope.resolve("cskhAnalysisModule") as any
  const { id } = req.params
  const limit = Math.min(200, Number(req.query.limit ?? 50))
  const offset = Number(req.query.offset ?? 0)

  // Verify owner
  const [rule] = await sql(`SELECT mkt_name FROM mkt_care_rule WHERE id = $1 AND deleted_at IS NULL`, [id]).catch(() => [])
  if (!rule) return res.status(404).json({ error: "Rule không tồn tại" })
  if (!auth.isSuper && rule.mkt_name !== auth.mktCode) return res.status(403).json({ error: "Không có quyền" })

  const logs = await sql(`
    SELECT * FROM mkt_care_rule_log
    WHERE rule_id = $1
    ORDER BY created_at DESC
    LIMIT $2 OFFSET $3
  `, [id, limit, offset]).catch(() => [])

  return res.json({ logs })
}
