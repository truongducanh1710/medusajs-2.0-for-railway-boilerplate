import { MedusaRequest } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { ROLE_PRESETS } from "../../../admin/lib/permissions"

export async function getCurrentUserEmail(req: MedusaRequest): Promise<string | null> {
  const auth = (req as any).auth_context
  if (auth?.actor_type !== "user" || !auth?.actor_id) return null
  const userModule = req.scope.resolve(Modules.USER)
  const user = await userModule.retrieveUser(auth.actor_id, { select: ["email"] })
  return user?.email || null
}

// Check quyền của user hiện tại (role preset + permissions thủ công), dùng trong handler
// cho các route mà middleware chỉ chặn ở mức "view" chung, còn hành động cụ thể (approve,
// manage...) cần permission cao hơn — tương tự resolveUserPerms trong middlewares.ts nhưng
// không import trực tiếp middlewares.ts để tránh phụ thuộc vòng.
export async function userHasPerm(req: MedusaRequest, email: string, perm: string): Promise<boolean> {
  if (email === process.env.SUPER_ADMIN_EMAIL) return true
  const auth = (req as any).auth_context
  const userModule = req.scope.resolve(Modules.USER)
  const user = await userModule.retrieveUser(auth.actor_id, { select: ["metadata"] })
  const metadata: any = user?.metadata || {}
  const role: string = metadata.role || ""
  const explicit: string[] = Array.isArray(metadata.permissions) ? metadata.permissions : []
  const fromRole: string[] = role && ROLE_PRESETS[role] ? ROLE_PRESETS[role] : []
  return fromRole.includes(perm) || explicit.includes(perm)
}
