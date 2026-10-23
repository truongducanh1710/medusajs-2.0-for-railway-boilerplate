import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ITY_PBX_DOMAIN, ITY_CLICK2CALL_SECRET, ITY_CUSTOMER_ID } from "../../../../lib/constants"
import { getAuthInfo } from "../../fb-content/_lib"

function normalizeVnPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "")
  if (digits.startsWith("84")) return "0" + digits.slice(2)
  if (digits.startsWith("0")) return digits
  return digits
}

/**
 * GET /admin/ity-cdr-sync/click2call
 * Máy nhánh của người đang đăng nhập; admin nhận thêm danh sách mọi máy nhánh để
 * chọn gọi thử bằng máy người khác.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const actorId = (req as any).auth_context?.actor_id
  const auth = await getAuthInfo(req)
  const syncService = req.scope.resolve("ityCdrSyncModule") as any
  const maps = await syncService.listItyExtensionMaps({}, { take: 200 })
  const own = maps.find((m: any) => m.user_id === actorId)?.extension ?? null
  return res.json({
    extension: own,
    is_admin: !!auth?.isAdmin,
    extensions: auth?.isAdmin ? maps.map((m: any) => ({ extension: m.extension, name: m.display_name || m.extension })) : [],
  })
}

/**
 * POST /admin/ity-cdr-sync/click2call
 * Trả về link click2call của ITY để TRÌNH DUYỆT của sale tự gọi: ITY chặn kết nối
 * từ IP Railway (connect timeout) nhưng máy sale ở VN vào được. Đổi lại, secret
 * nằm trong link nên ai mở DevTools cũng thấy — chấp nhận vì là nhân sự nội bộ.
 * Máy nhánh lấy theo user đang đăng nhập; chỉ admin được chỉ định máy nhánh khác
 * (để test). Body: { phone: string, userfield?: string, extension?: string }
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    if (!ITY_PBX_DOMAIN || !ITY_CLICK2CALL_SECRET || !ITY_CUSTOMER_ID) {
      return res.status(500).json({ error: "Chưa cấu hình ITY_PBX_DOMAIN / ITY_CLICK2CALL_SECRET / ITY_CUSTOMER_ID trên server" })
    }

    const { phone, userfield, extension: requested } = req.body as { phone?: string; userfield?: string; extension?: string }
    if (!phone) {
      return res.status(400).json({ error: "Thiếu số điện thoại khách" })
    }

    const actorId = (req as any).auth_context?.actor_id
    if (!actorId) {
      return res.status(401).json({ error: "Không xác định được người dùng đăng nhập" })
    }

    const syncService = req.scope.resolve("ityCdrSyncModule") as any
    let extension: string | undefined
    if (requested) {
      const auth = await getAuthInfo(req)
      if (!auth?.isAdmin) return res.status(403).json({ error: "Chỉ admin được gọi bằng máy nhánh khác" })
      extension = String(requested)
    } else {
      const maps = await syncService.listItyExtensionMaps({ user_id: actorId }, { take: 1 })
      extension = maps?.[0]?.extension
    }
    if (!extension) {
      return res.status(400).json({ error: "Bạn chưa được gán máy nhánh (extension) tổng đài. Liên hệ admin gán ở trang Cuộc gọi (CDR)." })
    }

    const phoneDigits = normalizeVnPhone(phone)
    const url = new URL(`https://${ITY_PBX_DOMAIN}/wsapi/click2call.php`)
    url.searchParams.set("secret", ITY_CLICK2CALL_SECRET)
    url.searchParams.set("domain", ITY_CUSTOMER_ID)
    url.searchParams.set("extension", extension)
    url.searchParams.set("phone", phoneDigits)
    if (userfield) url.searchParams.set("userfield", userfield)

    // The PBX never sees our server any more, so this line is the only record of who dialled.
    console.log(`[click2call] user=${actorId} ext=${extension} phone=${phoneDigits} userfield=${userfield ?? ""}`)
    return res.json({ ok: true, extension, phone: phoneDigits, url: url.toString() })
  } catch (err: any) {
    console.error("[click2call] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
