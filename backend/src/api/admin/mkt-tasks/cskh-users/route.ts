import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

/** GET /admin/mkt-tasks/cskh-users
 * Danh sách user có quyền page.mkt-tasks.view (bao gồm role cskh + marketing + manager)
 * — dùng cho dropdown chọn người phụ trách khi bulk-tạo task gọi CSKH.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const auth = (req as any).auth_context
  if (auth?.actor_type !== "user" || !auth?.actor_id) {
    return res.status(401).json({ error: "Unauthenticated" })
  }

  const userModule = req.scope.resolve(Modules.USER)
  const allUsers = await userModule.listUsers({}, { select: ["id", "email", "first_name", "last_name", "metadata"] })

  const superEmail = process.env.SUPER_ADMIN_EMAIL
  const perm = "page.mkt-tasks.view"

  const users = allUsers
    .filter(u => {
      if (u.email === superEmail) return true
      const perms: string[] = Array.isArray((u.metadata as any)?.permissions) ? (u.metadata as any).permissions : []
      return perms.includes(perm)
    })
    .map(u => ({
      id: u.id,
      email: u.email,
      name: (u.first_name || u.last_name) ? [u.first_name, u.last_name].filter(Boolean).join(" ") : u.email,
    }))

  return res.json({ users })
}
