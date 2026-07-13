import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { resolveUserPerms } from "../../../middlewares"

const AI_AGENT_EMAIL = "ai-agent@phanviet.vn"

/**
 * GET /admin/permissions/check?email=...&permission=...
 * Trả { allowed: boolean } cho MỘT permission cụ thể của MỘT user cụ thể —
 * không lộ toàn bộ danh sách quyền của họ (least-disclosure), dùng bởi
 * ai-agent để verify quyền người duyệt (approval-flow.mjs) trước khi thực
 * thi write tool đã được approve.
 *
 * Guard nằm ở đây thay vì requirePerm chung: chỉ actor là chính ai-agent,
 * hoặc actor có page.mkt-tasks.manage (manager), mới gọi được — tránh phải
 * cấp page.mkt-tasks.manage (kéo theo quyền giao việc/đánh giá task thật)
 * cho ai-agent chỉ để nó đọc quyền người khác.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const auth = (req as any).auth_context
  if (auth?.actor_type !== "user" || !auth?.actor_id) {
    return res.status(401).json({ error: "Unauthenticated" })
  }

  const userModule = req.scope.resolve(Modules.USER)
  const caller = await userModule.retrieveUser(auth.actor_id, { select: ["id", "email", "metadata"] })
  const isSuper = caller.email === process.env.SUPER_ADMIN_EMAIL
  const isAiAgent = caller.email === AI_AGENT_EMAIL
  const callerPerms = resolveUserPerms(caller.metadata)
  const isManager = callerPerms.includes("page.mkt-tasks.manage")
  if (!isSuper && !isAiAgent && !isManager) {
    return res.status(403).json({ error: "Forbidden" })
  }

  const { email, permission } = req.query as Record<string, string>
  if (!email || !permission) {
    return res.status(400).json({ error: "Thiếu email hoặc permission" })
  }

  const [target] = await userModule.listUsers({ email }, { select: ["id", "email", "metadata"] })
  if (!target) return res.json({ allowed: false })

  const targetIsSuper = target.email === process.env.SUPER_ADMIN_EMAIL
  const targetPerms = resolveUserPerms(target.metadata)
  const allowed = targetIsSuper || targetPerms.includes(permission)
  return res.json({ allowed })
}
