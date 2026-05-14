import { defineMiddlewares } from "@medusajs/framework/http"
import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

function requirePerm(...needed: string[]) {
  return async (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {
    try {
      const auth = (req as any).auth_context
      if (auth?.actor_type !== "user" || !auth?.actor_id) {
        return res.status(401).json({ error: "Unauthenticated" })
      }
      const userModule = req.scope.resolve(Modules.USER)
      const user = await userModule.retrieveUser(auth.actor_id, { select: ["id", "email", "metadata"] })

      if (user.email && user.email === process.env.SUPER_ADMIN_EMAIL) return next()

      const perms: string[] = Array.isArray((user.metadata as any)?.permissions)
        ? (user.metadata as any).permissions
        : []
      if (!needed.every((p) => perms.includes(p))) {
        return res.status(403).json({ error: "Forbidden", required: needed, current: perms })
      }
      next()
    } catch {
      return res.status(403).json({ error: "Forbidden" })
    }
  }
}

export default defineMiddlewares({
  routes: [
    // Body parser cho product-content (giữ nguyên)
    {
      matcher: "/admin/product-content",
      method: ["POST"],
      bodyParser: { sizeLimit: "100mb" },
    },

    // Custom routes — permission guards
    { matcher: "/admin/pancake-sync", method: ["POST"], middlewares: [requirePerm("page.pancake-sync.run")] },
    { matcher: "/admin/pancake-sync/status*", method: ["GET"], middlewares: [requirePerm("page.pancake-sync.view")] },
    { matcher: "/admin/pancake-sync/report*", middlewares: [requirePerm("page.bao-cao.view")] },
    { matcher: "/admin/pancake-sync/call-board*", method: ["GET"], middlewares: [requirePerm("page.don-hang.view")] },
    { matcher: "/admin/pancake-sync/orders*", method: ["GET"], middlewares: [requirePerm("page.don-hang.view")] },
    { matcher: "/admin/pancake-sync/orders/*", method: ["POST", "PUT", "PATCH"], middlewares: [requirePerm("page.don-hang.edit")] },
    { matcher: "/admin/pages*", method: ["GET"], middlewares: [requirePerm("page.pages.view")] },
    { matcher: "/admin/pages*", method: ["POST", "PUT", "DELETE", "PATCH"], middlewares: [requirePerm("page.pages.edit")] },
    { matcher: "/admin/product-content*", method: ["POST"], middlewares: [requirePerm("page.san-pham.edit")] },
    { matcher: "/admin/pancake-status*", middlewares: [requirePerm("page.don-hang.view")] },

    // Quản lý user — không chặn ở đây vì Medusa native auth đã guard /admin/users
    // requirePerm chạy trước auth_context được inject nên sẽ 401
  ],
})
