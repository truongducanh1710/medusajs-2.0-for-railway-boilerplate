import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { resolveUserPerms } from "../../../../middlewares"

/**
 * POST /admin/users/:id/set-password
 * Body: { password: string }
 *
 * Admin đặt mật khẩu mới cho tài khoản khác — dùng khi nhân sự nghỉ việc để khoá
 * đăng nhập. Medusa chỉ có luồng tự đặt lại qua email (người đã nghỉ không dùng
 * được), nên route này gọi thẳng provider emailpass như route update gốc của Medusa,
 * mật khẩu được hash trong provider.
 *
 * Quyền: users.manage — kiểm tra NGAY TRONG route, không khai ở middlewares.ts: với
 * /admin/users*, requirePerm chạy trước khi auth_context được gắn nên luôn trả 401
 * (xem ghi chú cuối middlewares.ts). Không cho đổi mật khẩu super admin qua đây —
 * tài khoản đó đổi bằng luồng chính chủ.
 *
 * LƯU Ý: đổi mật khẩu KHÔNG đăng xuất phiên đang mở. Muốn chặn ngay thì gỡ quyền
 * (metadata.role/permissions) — middleware đọc lại metadata ở mỗi request.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = (req as any).auth_context
    if (auth?.actor_type !== "user" || !auth?.actor_id) {
      return res.status(401).json({ error: "Unauthenticated" })
    }
    const userModule = req.scope.resolve(Modules.USER) as any
    const me = await userModule.retrieveUser(auth.actor_id, { select: ["id", "email", "metadata"] })
    const superEmail = process.env.SUPER_ADMIN_EMAIL
    const laSuper = !!(superEmail && me.email === superEmail)
    if (!laSuper && !resolveUserPerms(me.metadata).includes("users.manage")) {
      return res.status(403).json({ error: "Cần quyền Quản lý user (users.manage)" })
    }

    const { password } = (req.body ?? {}) as { password?: unknown }
    if (typeof password !== "string" || password.length < 10) {
      return res.status(400).json({ error: "Mật khẩu phải là chuỗi tối thiểu 10 ký tự" })
    }

    const target = await userModule
      .retrieveUser(req.params.id, { select: ["id", "email"] })
      .catch(() => null)
    if (!target?.email) return res.status(404).json({ error: "Không tìm thấy user" })

    if (superEmail && target.email === superEmail) {
      return res.status(403).json({ error: "Không đổi mật khẩu super admin qua API này" })
    }

    const authModule = req.scope.resolve(Modules.AUTH) as any
    // entity_id của emailpass = email lúc đăng ký. Thử nguyên văn trước, rồi chữ thường
    // (một số tài khoản tạo với chữ hoa, vd "Nghiavv@...").
    const candidates = [...new Set([target.email, String(target.email).toLowerCase()])]
    let lastError = "Không cập nhật được mật khẩu"
    for (const entityId of candidates) {
      const r = await authModule.updateProvider("emailpass", { entity_id: entityId, password })
      if (r?.success && r?.authIdentity) {
        console.info(`[set-password] ${me.email} đổi mật khẩu cho ${target.email}`)
        return res.json({ ok: true, email: target.email })
      }
      if (r?.error) lastError = r.error
    }
    return res.status(400).json({ error: lastError })
  } catch (err: any) {
    console.error("[set-password]", err?.message)
    return res.status(500).json({ error: err?.message ?? "Lỗi không xác định" })
  }
}
