import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getAuthInfo } from "../../camp-control/_lib"

async function checkOwner(sql: any, ruleId: string, auth: any) {
  const [rule] = await sql(`SELECT * FROM mkt_care_rule WHERE id = $1 AND deleted_at IS NULL`, [ruleId]).catch(() => [])
  if (!rule) return { ok: false, rule: null, reason: "Rule không tồn tại" }
  if (!auth.isSuper && rule.mkt_name !== auth.mktCode) return { ok: false, rule, reason: "Không có quyền" }
  return { ok: true, rule }
}

// GET /admin/pancake-sync/report/care-rules/:id
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthenticated" })
  const sql = req.scope.resolve("cskhAnalysisModule") as any
  const { id } = req.params
  const { ok, rule, reason } = await checkOwner(sql, id, auth)
  if (!ok) return res.status(rule ? 403 : 404).json({ error: reason })
  return res.json({ rule })
}

// PATCH /admin/pancake-sync/report/care-rules/:id
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthenticated" })
  const sql = req.scope.resolve("cskhAnalysisModule") as any
  const { id } = req.params
  const { ok, rule, reason } = await checkOwner(sql, id, auth)
  if (!ok) return res.status(rule ? 403 : 404).json({ error: reason })

  const body = req.body as any
  const allowed = ["name","rule_mode","scope_type","scope_value","conditions","condition_logic",
    "product_key","time_window","action","action_payload","check_schedule","min_spend","cooldown_hours","enabled"]

  const sets: string[] = ["updated_at = now()"]
  const vals: any[] = [id]

  for (const key of allowed) {
    if (key in body) {
      vals.push(["conditions","action_payload"].includes(key) ? JSON.stringify(body[key]) : body[key])
      const cast = ["conditions","action_payload"].includes(key) ? "::jsonb" : ""
      sets.push(`${key} = $${vals.length}${cast}`)
    }
  }

  if (sets.length === 1) return res.status(400).json({ error: "Không có field nào để cập nhật" })

  const [updated] = await sql(
    `UPDATE mkt_care_rule SET ${sets.join(", ")} WHERE id = $1 RETURNING *`,
    vals
  )
  return res.json({ rule: updated })
}

// DELETE /admin/pancake-sync/report/care-rules/:id
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthenticated" })
  const sql = req.scope.resolve("cskhAnalysisModule") as any
  const { id } = req.params
  const { ok, rule, reason } = await checkOwner(sql, id, auth)
  if (!ok) return res.status(rule ? 403 : 404).json({ error: reason })
  await sql(`UPDATE mkt_care_rule SET deleted_at = now(), enabled = false WHERE id = $1`, [id])
  return res.json({ ok: true })
}
