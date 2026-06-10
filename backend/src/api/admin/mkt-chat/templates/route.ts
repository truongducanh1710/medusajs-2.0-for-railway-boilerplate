import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { getPool } from "../../../../lib/db"
import { ulid } from "ulid"

async function actorEmail(req: MedusaRequest): Promise<string | null> {
  const auth = (req as any).auth_context
  if (auth?.actor_type !== "user" || !auth?.actor_id) return null
  const userModule = req.scope.resolve(Modules.USER)
  const user = await userModule.retrieveUser(auth.actor_id, { select: ["email"] })
  return user?.email ?? null
}

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

// GET /admin/mkt-chat/templates — mọi user có quyền chat đều dùng được mẫu
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await actorEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })

    const r = await getPool().query(
      `SELECT id, label, content, created_by FROM mkt_chat_template
       WHERE deleted_at IS NULL ORDER BY label ASC`
    )
    res.json({ templates: r.rows })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

// POST /admin/mkt-chat/templates — manager only
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await actorEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })
    if (!(await isManager(req))) return res.status(403).json({ error: "Chỉ manager mới được tạo mẫu" })

    const { label, content } = req.body as any
    if (!label?.trim() || !content?.trim()) {
      return res.status(400).json({ error: "Thiếu label hoặc content" })
    }

    const id = `tpl_${ulid()}`
    const now = new Date().toISOString()
    await getPool().query(
      `INSERT INTO mkt_chat_template (id, label, content, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5)`,
      [id, label.trim().slice(0, 60), content.trim().slice(0, 2000), email, now]
    )

    res.json({ template: { id, label: label.trim(), content: content.trim(), created_by: email } })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
