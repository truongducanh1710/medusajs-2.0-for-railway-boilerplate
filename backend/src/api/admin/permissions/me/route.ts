import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { resolveUserPerms } from "../../../middlewares"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const auth = (req as any).auth_context
  if (auth?.actor_type !== "user" || !auth?.actor_id) {
    return res.status(401).json({ error: "Unauthenticated" })
  }
  const userModule = req.scope.resolve(Modules.USER)
  const user = await userModule.retrieveUser(auth.actor_id, { select: ["id", "email", "metadata"] })
  const isSuper = !!(user.email && user.email === process.env.SUPER_ADMIN_EMAIL)
  const perms = resolveUserPerms(user.metadata)
  const mktCode = (user.metadata as any)?.mkt_code ?? null
  const rawCodes = (user.metadata as any)?.mkt_codes
  const mktCodes: string[] = (Array.isArray(rawCodes) && rawCodes.length > 0) ? rawCodes : (mktCode ? [mktCode] : [])
  const role: string = (user.metadata as any)?.role ?? ""
  res.json({ email: user.email, permissions: isSuper ? "*" : perms, is_super: isSuper, mkt_code: mktCode, mkt_codes: mktCodes, role })
}
