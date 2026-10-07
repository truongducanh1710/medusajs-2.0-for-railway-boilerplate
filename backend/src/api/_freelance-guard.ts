import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import {
  buildOwnScope,
  FREELANCE_ROLE,
  ownsCampaign,
  ownsMktVideo,
  ownsProductTest,
  type OwnScope,
} from "../lib/freelance-scope"

/**
 * Cổng chặn cho nhân sự FREELANCE (metadata.role = "freelance").
 *
 * Đăng ký là middleware TOÀN CỤC trên /admin (không khai method) nên Medusa xếp nó
 * chạy sau bước xác thực nhưng TRƯỚC mọi route — kể cả route gốc như /admin/orders,
 * /admin/customers vốn không đi qua requirePerm nào.
 *
 * Fail-closed: endpoint không khớp rule nào trong FREELANCE_RULES → 403. Endpoint khớp
 * vẫn phải qua requirePerm như thường (quyền lấy từ preset "freelance"), với một ngoại
 * lệ: page.bao-cao.view được coi là đạt (SCOPED_GRANTS trong middlewares.ts), vì quyền
 * đó vốn nghĩa là "xem số liệu chung" — ở đây dữ liệu đã bị lọc về đúng người gọi.
 *
 * Thêm tính năng mới cho freelancer = thêm rule ở đây VÀ đảm bảo handler lọc theo
 * getOwnScope(req). Đừng thêm rule cho endpoint trả số liệu toàn công ty.
 */

type Rule = {
  methods: string[]
  path: RegExp
  /**
   * Chạy sau khi khớp. Trả chuỗi lỗi để chặn; undefined để cho qua. Dùng để kiểm tra
   * quyền sở hữu bản ghi, hoặc ép tham số lọc (query) về dữ liệu của chính người gọi.
   */
  check?: (req: MedusaRequest, scope: OwnScope, m: RegExpMatchArray) => Promise<string | void> | string | void
}

// Ép tham số lọc mkt trên query — handler vốn đã hỗ trợ "mkt=A,B", chỉ cần thay giá trị
// người gọi gửi lên bằng mã của chính họ (bỏ trống hay gửi mã người khác đều bị ghi đè).
const forceMkt = (key = "mkt") => (req: MedusaRequest, scope: OwnScope) => {
  ;(req.query as any)[key] = scope.mktCodes.join(",")
}

const campaignFromQuery = async (req: MedusaRequest, scope: OwnScope) => {
  const id = String((req.query as any)?.campaign_id ?? "")
  if (!(await ownsCampaign(scope, id))) return "Camp không thuộc mã MKT của bạn"
}

const PRODUCT_TEST_RESERVED = new Set(["facets", "purchasers", "campaign-metrics"])
const MKT_VIDEO_RESERVED = new Set(["products", "report", "check-link"])

const FREELANCE_RULES: Rule[] = [
  // ── Khung admin (sidebar, hồ sơ, quyền) ──────────────────────────────────────────
  { methods: ["GET"], path: /^\/admin\/users\/me$/ },
  { methods: ["GET"], path: /^\/admin\/stores(\/[^/]+)?$/ },
  { methods: ["GET"], path: /^\/admin\/feature-flags$/ },
  { methods: ["GET"], path: /^\/admin\/permissions\/me$/ },
  // Handler trả về đúng 1 dòng là chính người gọi khi là freelancer.
  { methods: ["GET"], path: /^\/admin\/permissions\/mkt-users$/ },
  // Ảnh đính kèm hồ sơ test sản phẩm.
  { methods: ["POST"], path: /^\/admin\/uploads$/ },

  // ── Test sản phẩm: chỉ hồ sơ mình tạo hoặc được giao ────────────────────────────
  { methods: ["GET", "POST"], path: /^\/admin\/product-tests$/ },
  { methods: ["GET"], path: /^\/admin\/product-tests\/(facets|purchasers|campaign-metrics)$/ },
  {
    // /:id, /:id/proposal, /:id/purchase-check, /:id/daily-results[/:rid[/evaluate|/mkt-decision]], /:id/actions
    methods: ["GET", "PATCH", "PUT", "POST", "DELETE"],
    path: /^\/admin\/product-tests\/([^/]+)(\/.*)?$/,
    check: async (_req, scope, m) => {
      if (PRODUCT_TEST_RESERVED.has(m[1])) return "Không hỗ trợ"
      if (!(await ownsProductTest(scope, m[1]))) return "Hồ sơ test không thuộc về bạn"
    },
  },

  // ── Doanh số MKT: chỉ camp mang mã MKT của mình ─────────────────────────────────
  { methods: ["GET"], path: /^\/admin\/pancake-sync\/report\/mkt$/ }, // handler lọc theo scope
  { methods: ["GET"], path: /^\/admin\/pancake-sync\/report\/mkt-campaign$/, check: forceMkt() },
  { methods: ["GET"], path: /^\/admin\/pancake-sync\/report\/camp-control\/all-schedules$/, check: forceMkt() },
  { methods: ["GET"], path: /^\/admin\/pancake-sync\/report\/camp-control\/all-logs$/, check: forceMkt() },
  { methods: ["GET"], path: /^\/admin\/pancake-sync\/report\/fb-activity$/, check: forceMkt() },
  { methods: ["GET"], path: /^\/admin\/pancake-sync\/report\/camp-control\/(verify|schedule|log)$/, check: campaignFromQuery },
  // Bật/tắt, đổi ngân sách, hẹn lịch: handler tự kiểm tra camp thuộc mkt_codes (checkCampOwner).
  { methods: ["POST"], path: /^\/admin\/pancake-sync\/report\/camp-control\/(toggle|schedule)$/ },
  { methods: ["PATCH"], path: /^\/admin\/pancake-sync\/report\/camp-control\/budget$/ },
  // Huỷ lịch: handler chỉ cho người tạo lịch huỷ.
  { methods: ["DELETE"], path: /^\/admin\/pancake-sync\/report\/camp-control\/schedule\/[^/]+$/ },

  // ── Marketing Hub: nguyên liệu video của mình + hiệu quả video của mình ─────────
  { methods: ["GET"], path: /^\/admin\/marketing-video$/, check: (req) => { ;(req.query as any).mine = "true" } },
  { methods: ["POST"], path: /^\/admin\/marketing-video$/ }, // created_by = người gọi
  { methods: ["GET"], path: /^\/admin\/marketing-video\/(products|report|check-link)$/ }, // report: handler lọc
  {
    methods: ["GET", "PATCH", "DELETE", "POST"],
    path: /^\/admin\/marketing-video\/([^/]+)(\/(analyze|request-revision))?$/,
    check: async (_req, scope, m) => {
      if (MKT_VIDEO_RESERVED.has(m[1])) return "Không hỗ trợ"
      if (!(await ownsMktVideo(scope, m[1]))) return "Video không thuộc về bạn"
    },
  },
  { methods: ["GET"], path: /^\/admin\/pancake-sync\/report\/video-performance$/ }, // handler lọc

  // ── Agent Video: chỉ xem video của mình (handler lọc) ───────────────────────────
  { methods: ["GET"], path: /^\/admin\/agent-video\/(videos|decisions)$/ },
]

// Cache user ngắn hạn: guard chạy trên MỌI request /admin của MỌI người, không nên
// đọc DB user mỗi lần. Đổi role freelance có hiệu lực tối đa sau CACHE_MS.
const CACHE_MS = 30_000
const userCache = new Map<string, { at: number; user: any }>()

async function loadUser(req: MedusaRequest, actorId: string) {
  const hit = userCache.get(actorId)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.user
  const userModule = req.scope.resolve(Modules.USER) as any
  const user = await userModule.retrieveUser(actorId, { select: ["id", "email", "metadata"] })
  userCache.set(actorId, { at: Date.now(), user })
  return user
}

export async function freelanceGuard(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
  const auth = (req as any).auth_context
  // Không có actor user: route public đã opt-out auth, hoặc xác thực đã thất bại và
  // tầng auth trả lỗi rồi — không phải việc của guard này.
  if (auth?.actor_type !== "user" || !auth?.actor_id) return next()

  let user: any
  try {
    user = await loadUser(req, auth.actor_id)
  } catch {
    return res.status(403).json({ error: "Forbidden" })
  }
  if ((user?.metadata as any)?.role !== FREELANCE_ROLE) return next()
  if (user.email && user.email === process.env.SUPER_ADMIN_EMAIL) return next()

  const scope = buildOwnScope(user)
  // originalUrl giữ path đầy đủ; req.path đã bị cắt theo mount point "/admin".
  const path = (((req as any).originalUrl || "") as string).split("?")[0].replace(/\/+$/, "")
  const method = req.method.toUpperCase()

  for (const rule of FREELANCE_RULES) {
    if (!rule.methods.includes(method)) continue
    const m = path.match(rule.path)
    if (!m) continue
    try {
      const denied = rule.check ? await rule.check(req, scope, m) : undefined
      if (denied) return res.status(403).json({ error: denied, freelance: true })
    } catch {
      return res.status(403).json({ error: "Forbidden", freelance: true })
    }
    ;(req as any).freelanceScope = scope
    return next()
  }
  return res.status(403).json({ error: "Tài khoản freelance không được truy cập chức năng này", freelance: true })
}
