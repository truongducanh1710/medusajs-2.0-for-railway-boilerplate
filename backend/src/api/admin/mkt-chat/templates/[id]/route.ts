import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { getPool } from "../../../../../lib/db"

async function isManager(req: MedusaRequest): Promise<boolean> {
  const auth = (req as any).auth_context
  if (auth?.actor_type !== "user" || !auth?.actor_id) return false
  const superEmail = process.env.SUPER_ADMIN_EMAIL
  const userModule = req.scope.resolve(Modules.USER)
  const user = await userModule.retrieveUser(auth.actor_id, { select: ["email", "metadata"] })
  if (user.email === superEmail) return true
  const perms: string[] = Array.isArray((user.metadata as any)?.permissions)
    ? (user.metadata as any).permissions : []
  return perms.includes("page.mkt-chat.manage")
}

// PATCH /admin/mkt-chat/templates/:id — manager only
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    if (!(await isManager(req))) return res.status(403).json({ error: "Chỉ manager mới được sửa mẫu" })

    const { id } = req.params
    const { label, content } = req.body as any
    if (!label?.trim() && !content?.trim()) {
      return res.status(400).json({ error: "Không có gì để cập nhật" })
    }

    const r = await getPool().query(
      `UPDATE mkt_chat_template
       SET label = COALESCE(NULLIF($2, ''), label),
           content = COALESCE(NULLIF($3, ''), content),
           updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, label, content`,
      [id, (label || "").trim().slice(0, 60), (content || "").trim().slice(0, 2000)]
    )
    if (r.rowCount === 0) return res.status(404).json({ error: "Không tìm thấy mẫu" })

    res.json({ template: r.rows[0] })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

// DELETE /admin/mkt-chat/templates/:id — manager only
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    if (!(await isManager(req))) return res.status(403).json({ error: "Chỉ manager mới được xóa mẫu" })

    const { id } = req.params
    await getPool().query(`UPDATE mkt_chat_template SET deleted_at = now() WHERE id = $1`, [id])
    res.json({ success: true })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
