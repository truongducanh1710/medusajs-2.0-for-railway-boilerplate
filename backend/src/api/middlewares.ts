import { defineMiddlewares } from "@medusajs/framework/http"
import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { ROLE_PRESETS } from "../admin/lib/permissions"

export function resolveUserPerms(metadata: any): string[] {
  const explicit: string[] = Array.isArray(metadata?.permissions) ? metadata.permissions : []
  const role: string = metadata?.role ?? ""
  const fromRole: string[] = role && ROLE_PRESETS[role] ? (ROLE_PRESETS[role] as string[]) : []
  // union: role permissions + any extra explicit permissions
  return [...new Set([...fromRole, ...explicit])]
}

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

      const perms = resolveUserPerms(user.metadata)
      if (!needed.every((p) => perms.includes(p))) {
        return res.status(403).json({ error: "Forbidden", required: needed, current: perms })
      }
      next()
    } catch {
      return res.status(403).json({ error: "Forbidden" })
    }
  }
}

// CORS middleware cho Chrome Extension
const extensionCors = (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {
  const origin = req.headers.origin || ""
  // Cho phép chrome-extension://* và moz-extension://*
  if (origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://")) {
    res.setHeader("Access-Control-Allow-Origin", origin)
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,x-medusa-access-token")
    res.setHeader("Access-Control-Allow-Credentials", "true")
  }
  if (req.method === "OPTIONS") return res.status(204).end()
  return next()
}

export default defineMiddlewares({
  routes: [
    // Body parser cho product-content (giữ nguyên)
    {
      matcher: "/admin/product-content",
      method: ["POST"],
      bodyParser: { sizeLimit: "100mb" },
    },
    // Video analyze — nhận base64 video từ browser (~50MB)
    {
      matcher: "/admin/marketing-video/:id/analyze",
      method: ["POST"],
      bodyParser: { sizeLimit: "100mb" },
    },
    // Product update — sản phẩm có metadata/variants lớn (vd combo đơn) có thể vượt limit mặc định
    {
      matcher: "/admin/products/:id",
      method: ["POST"],
      bodyParser: { sizeLimit: "20mb" },
    },

    // CORS cho Chrome Extension — phải đứng trước auth middleware
    {
      matcher: "/admin/1688-import",
      method: ["POST", "OPTIONS"],
      middlewares: [extensionCors],
    },
    {
      matcher: "/admin/1688-auth",
      method: ["POST", "OPTIONS"],
      middlewares: [extensionCors],
    },

    // Custom routes — permission guards
    { matcher: "/admin/pancake-sync", method: ["POST"], middlewares: [requirePerm("page.pancake-sync.run")] },
    { matcher: "/admin/pancake-sync/cleanup", method: ["POST"], middlewares: [requirePerm("page.pancake-sync.run")] },
    { matcher: "/admin/pancake-sync/backfill-care", method: ["POST"], middlewares: [requirePerm("page.pancake-sync.run")] },
    { matcher: "/admin/pancake-sync/active-orders", method: ["POST"], middlewares: [requirePerm("page.don-hang.view")] },
    { matcher: "/admin/pancake-sync/status*", method: ["GET"], middlewares: [requirePerm("page.pancake-sync.view")] },
    { matcher: "/admin/pancake-sync/logs*", method: ["GET"], middlewares: [requirePerm("page.pancake-sync.view")] },
    { matcher: "/admin/pancake-sync/pull-by-status", method: ["POST"], middlewares: [requirePerm("page.pancake-sync.run")] },
    { matcher: "/admin/pancake-sync/report*", middlewares: [requirePerm("page.bao-cao.view")] },
    { matcher: "/admin/pancake-sync/call-board*", method: ["GET"], middlewares: [requirePerm("page.don-hang.view")] },
    { matcher: "/admin/pancake-sync/orders*", method: ["GET"], middlewares: [requirePerm("page.don-hang.view")] },
    { matcher: "/admin/pancake-sync/orders/*", method: ["POST", "PUT", "PATCH"], middlewares: [requirePerm("page.don-hang.edit")] },
    { matcher: "/admin/pages*", method: ["GET"], middlewares: [requirePerm("page.pages.view")] },
    { matcher: "/admin/pages*", method: ["POST", "PUT", "DELETE", "PATCH"], middlewares: [requirePerm("page.pages.edit")] },
    { matcher: "/admin/product-content*", method: ["POST"], middlewares: [requirePerm("page.san-pham.edit")] },
    { matcher: "/admin/pancake-status*", middlewares: [requirePerm("page.don-hang.view")] },
    { matcher: "/admin/cskh/orders*", method: ["GET"], middlewares: [requirePerm("page.cskh.view")] },
    { matcher: "/admin/cskh/analyze*", method: ["GET"], middlewares: [requirePerm("page.cskh.view")] },
    { matcher: "/admin/cskh/analyze*", method: ["POST"], middlewares: [requirePerm("page.cskh.analyze")] },
    { matcher: "/admin/cskh/team-stats*", method: ["GET"], middlewares: [requirePerm("page.cskh.manage")] },
    { matcher: "/admin/cskh/suspicious*", method: ["GET"], middlewares: [requirePerm("page.cskh.manage")] },
    { matcher: "/admin/media", method: ["GET"], middlewares: [requirePerm("page.san-pham.edit")] },
    { matcher: "/admin/media", method: ["DELETE"], middlewares: [requirePerm("page.san-pham.edit")] },
    { matcher: "/admin/gia-von*", method: ["GET"], middlewares: [requirePerm("page.gia-von.view")] },
    { matcher: "/admin/gia-von*", method: ["POST", "PUT", "DELETE"], middlewares: [requirePerm("page.gia-von.manage")] },
    { matcher: "/admin/webcake-leads*", method: ["GET"], middlewares: [requirePerm("page.don-hang.view")] },
    { matcher: "/admin/webcake-leads*", method: ["PATCH"], middlewares: [requirePerm("page.don-hang.edit")] },
    { matcher: "/admin/pancake-sync/fb-accounts*", middlewares: [requirePerm("page.bao-cao.fb-accounts")] },
    { matcher: "/admin/sql-query*", method: ["POST"], middlewares: [requirePerm("page.bao-cao.view")] },
    { matcher: "/admin/pancake-sync/report/mkt-cost-backfill*", method: ["POST"], middlewares: [requirePerm("page.bao-cao.view")] },
    { matcher: "/admin/pancake-sync/report/mkt-cost-status*", method: ["GET"], middlewares: [requirePerm("page.bao-cao.view")] },
    { matcher: "/admin/pancake-sync/report/camp-control*", method: ["POST", "PATCH", "DELETE"], middlewares: [requirePerm("page.bao-cao.camp-control")] },
    { matcher: "/admin/pancake-sync/report/camp-control*", method: ["GET"], middlewares: [requirePerm("page.bao-cao.view")] },
    { matcher: "/admin/pancake-sync/report/camp-control/verify", method: ["GET"], middlewares: [requirePerm("page.bao-cao.view")] },
    { matcher: "/admin/pancake-sync/report/camp-ai*", method: ["GET"], middlewares: [requirePerm("page.bao-cao.view")] },
    { matcher: "/admin/pancake-sync/report/camp-ai*", method: ["POST", "PATCH", "DELETE"], middlewares: [requirePerm("page.bao-cao.camp-control")] },

    { matcher: "/admin/ai-config*", method: ["GET"], middlewares: [requirePerm("page.bao-cao.view")] },
    { matcher: "/admin/ai-config*", method: ["PATCH"], middlewares: [requirePerm("page.ai-settings.manage")] },

    { matcher: "/admin/ai-usage*", method: ["GET"], middlewares: [requirePerm("page.bao-cao.view")] },

    { matcher: "/admin/live-view*", method: ["GET"], middlewares: [requirePerm("page.live-view.view")] },

    // Chat bot — sandbox test + quản lý agent chỉ dành cho người có quyền quản lý bot
    { matcher: "/admin/chat/bot-test", method: ["POST"], middlewares: [requirePerm("page.chat.bot.manage")] },
    { matcher: "/admin/chat/agents*", method: ["GET"], middlewares: [requirePerm("page.chat.bot.manage")] },
    { matcher: "/admin/chat/agents*", method: ["POST", "PATCH"], middlewares: [requirePerm("page.chat.bot.manage")] },

    // MKT Task Management + Chat
    // Telegram webhook — không cần auth JWT (bot gọi vào, xác thực bằng TELEGRAM_WEBHOOK_SECRET header)
    { matcher: "/admin/mkt-tasks/telegram", method: ["POST"], middlewares: [] },
    { matcher: "/admin/mkt-tasks/cskh-source*", method: ["GET"], middlewares: [requirePerm("page.mkt-tasks.manage")] },
    { matcher: "/admin/mkt-tasks/cskh-call/bulk", method: ["POST"], middlewares: [requirePerm("page.mkt-tasks.manage")] },
    { matcher: "/admin/mkt-tasks*", method: ["GET"], middlewares: [requirePerm("page.mkt-tasks.view")] },
    { matcher: "/admin/mkt-tasks", method: ["POST"], middlewares: [requirePerm("page.mkt-tasks.manage")] },
    { matcher: "/admin/mkt-tasks/*", method: ["PATCH", "DELETE", "POST"], middlewares: [requirePerm("page.mkt-tasks.view")] },
    { matcher: "/admin/mkt-chat*", method: ["GET"], middlewares: [requirePerm("page.mkt-chat.view")] },
    { matcher: "/admin/mkt-chat/channels", method: ["POST"], middlewares: [requirePerm("page.mkt-chat.manage")] },
    { matcher: "/admin/mkt-chat/channels/*", method: ["POST", "PATCH", "DELETE"], middlewares: [requirePerm("page.mkt-chat.view")] },
    // Quick Reply templates: handler tự check manage cho write, perm view đủ để vào route
    { matcher: "/admin/mkt-chat/templates*", method: ["POST", "PATCH", "DELETE"], middlewares: [requirePerm("page.mkt-chat.view")] },

    // Marketing Hub — nguyên liệu video (thay Google Sheet)
    { matcher: "/admin/permissions/mkt-users", method: ["GET"], middlewares: [requirePerm("page.marketing-video.view")] },
    { matcher: "/admin/mkt-pages*", method: ["GET"], middlewares: [requirePerm("page.marketing-video.view")] },
    { matcher: "/admin/mkt-pages*", method: ["POST", "PATCH", "DELETE"], middlewares: [requirePerm("page.marketing-video.edit")] },
    { matcher: "/admin/marketing-video*", method: ["GET"], middlewares: [requirePerm("page.marketing-video.view")] },
    { matcher: "/admin/marketing-video*", method: ["POST", "PATCH", "DELETE"], middlewares: [requirePerm("page.marketing-video.edit")] },

    // Marketing Hub — Facebook Content Manager
    // GET (gồm /post/status poll) cần view; mutate cần post
    { matcher: "/admin/fb-content/boost/meta*", method: ["GET"], middlewares: [requirePerm("page.fb-content.boost")] },
    { matcher: "/admin/fb-content/boost", method: ["POST"], middlewares: [requirePerm("page.fb-content.boost")] },
    { matcher: "/admin/fb-content/pixel-map*", method: ["GET"], middlewares: [requirePerm("page.bao-cao.view")] },
    { matcher: "/admin/fb-content/audiences*", method: ["GET", "POST"], middlewares: [requirePerm("page.fb-content.boost")] },
    { matcher: "/admin/fb-content*", method: ["GET"], middlewares: [requirePerm("page.fb-content.view")] },
    { matcher: "/admin/fb-content/post*", method: ["POST", "PATCH", "DELETE"], middlewares: [requirePerm("page.fb-content.post")] },
    { matcher: "/admin/fb-content/templates*", method: ["POST", "PATCH", "DELETE"], middlewares: [requirePerm("page.fb-content.post")] },
    { matcher: "/admin/fb-content/refresh-tokens", method: ["POST"], middlewares: [requirePerm("page.fb-content.post")] },

    // Đo video qua Ads — tab Hiệu quả Video trong bao-cao-mkt
    { matcher: "/admin/pancake-sync/report/video-performance*", method: ["GET"], middlewares: [requirePerm("page.bao-cao.view")] },
    { matcher: "/admin/pancake-sync/report/video-performance*", method: ["POST"], middlewares: [requirePerm("page.bao-cao.camp-control")] },

    // 1688-import: allow cả Secret API Key (actor_type=api_key) và user với quyền san-pham.edit
    {
      matcher: "/admin/1688-import",
      method: ["POST"],
      middlewares: [
        async (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {
          const auth = (req as any).auth_context
          // Secret API Key → cho qua luôn
          if (auth?.actor_type === "api_key") return next()
          // User → check perm bình thường
          return requirePerm("page.san-pham.edit")(req, res, next)
        }
      ]
    },

    // Facebook post stats — xem insights tổng hợp
    { matcher: "/admin/fb-content/post-stats*", method: ["GET"], middlewares: [requirePerm("page.fb-content.view")] },
    { matcher: "/admin/fb-content/post-stats*", method: ["POST"], middlewares: [requirePerm("page.fb-content.post")] },

    // Facebook page stats — thống kê tổng thể từng page
    { matcher: "/admin/fb-content/page-stats*", method: ["GET", "POST"], middlewares: [requirePerm("page.fb-content.view")] },

    // Facebook webhook — public, không cần auth (Facebook gọi vào, không có token)
    { matcher: "/admin/facebook/webhook", method: ["GET", "POST"], middlewares: [] },

    // Quản lý user — không chặn ở đây vì Medusa native auth đã guard /admin/users
    // requirePerm chạy trước auth_context được inject nên sẽ 401
  ],
})
