import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { resolveMktUserPerms } from "../_lib"

const CHAT_VIEW_PERM = "page.mkt-chat.view"
const CHAT_MANAGE_PERM = "page.mkt-chat.manage"

function displayName(user: any): string {
  return [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email
}

/** GET /admin/mkt-chat/users
 * Users who can access MKT chat, for channel member pickers and mentions.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const auth = (req as any).auth_context
  if (auth?.actor_type !== "user" || !auth?.actor_id) {
    return res.status(401).json({ error: "Unauthenticated" })
  }

  const userModule = req.scope.resolve(Modules.USER)
  const allUsers = await userModule.listUsers({}, { select: ["id", "email", "first_name", "last_name", "metadata"] })
  const superEmail = process.env.SUPER_ADMIN_EMAIL

  const users = allUsers
    .filter((user: any) => {
      if (!user.email) return false
      if (user.email === superEmail) return true
      const perms = resolveMktUserPerms(user.metadata)
      return perms.includes(CHAT_VIEW_PERM) || perms.includes(CHAT_MANAGE_PERM)
    })
    .map((user: any) => ({
      email: user.email,
      name: displayName(user),
      // metadata.is_ai_agent — field RIÊNG, KHÔNG dùng metadata.role: role "ai-agent" đã
      // có sẵn 1 preset quyền RỘNG trong ROLE_PRESETS (permissions.ts), và
      // resolveUserPerms() = union(role permissions, explicit permissions) — nếu đánh
      // dấu AI qua role thì mọi agent quyền hẹp (sale-agent chỉ nên có 5 quyền) sẽ VÔ
      // TÌNH được cộng thêm toàn bộ quyền của preset "ai-agent" (fb-content.post,
      // mkt-tasks.manage, cskh.manage...). is_ai_agent chỉ là NHÃN HIỂN THỊ, không đi
      // qua resolveUserPerms nên không ảnh hưởng quyền thật.
      is_ai_agent: user.metadata?.is_ai_agent === true,
    }))
    .sort((a: any, b: any) => a.name.localeCompare(b.name, "vi"))

  return res.json({ users })
}