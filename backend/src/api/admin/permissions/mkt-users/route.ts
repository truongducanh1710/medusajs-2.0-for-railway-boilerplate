import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { resolveUserPerms } from "../../../middlewares"

/** GET /admin/permissions/mkt-users
 * Trả về danh sách user có quyền page.marketing-video.view (role marketing),
 * kèm mkt_code từ metadata. Dùng cho tab Theo người trong Marketing Hub.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const auth = (req as any).auth_context
  if (auth?.actor_type !== "user" || !auth?.actor_id) {
    return res.status(401).json({ error: "Unauthenticated" })
  }

  const userModule = req.scope.resolve(Modules.USER)
  const allUsers = await userModule.listUsers({}, { select: ["id", "email", "first_name", "last_name", "metadata"] })

  const superEmail = process.env.SUPER_ADMIN_EMAIL
  const mktPerm = "page.marketing-video.view"

  const mktUsers = allUsers
    .filter(u => {
      if (u.email === superEmail) return true
      const perms = resolveUserPerms(u.metadata)
      return perms.includes(mktPerm)
    })
    .map(u => ({
      email: u.email,
      name: (u.first_name || u.last_name)
        ? [u.first_name, u.last_name].filter(Boolean).join(" ")
        : u.email,
      mkt_code: (u.metadata as any)?.mkt_code ?? null,
    }))

  return res.json({ users: mktUsers })
}
