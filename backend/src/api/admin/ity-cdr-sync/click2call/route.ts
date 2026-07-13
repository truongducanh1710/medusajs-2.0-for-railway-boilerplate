import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ITY_PBX_DOMAIN, ITY_CLICK2CALL_SECRET, ITY_CUSTOMER_ID } from "../../../../lib/constants"

function normalizeVnPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "")
  if (digits.startsWith("84")) return "0" + digits.slice(2)
  if (digits.startsWith("0")) return digits
  return digits
}

/**
 * POST /admin/ity-cdr-sync/click2call
 * Bấm gọi từ web: tra extension của user đang đăng nhập qua ItyExtensionMap,
 * gọi API https://{ITY_PBX_DOMAIN}/wsapi/click2call.php (?secret&domain&extension&phone)
 * để đổ chuông máy nhánh trước rồi tổng đài tự nối sang khách khi sale nhấc máy.
 * Không nhận extension từ client để tránh gọi nhầm máy người khác.
 * Body: { phone: string, userfield?: string }
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    if (!ITY_PBX_DOMAIN || !ITY_CLICK2CALL_SECRET || !ITY_CUSTOMER_ID) {
      return res.status(500).json({ error: "Chưa cấu hình ITY_PBX_DOMAIN / ITY_CLICK2CALL_SECRET / ITY_CUSTOMER_ID trên server" })
    }

    const { phone, userfield } = req.body as { phone?: string; userfield?: string }
    if (!phone) {
      return res.status(400).json({ error: "Thiếu số điện thoại khách" })
    }

    const actorId = (req as any).auth_context?.actor_id
    if (!actorId) {
      return res.status(401).json({ error: "Không xác định được người dùng đăng nhập" })
    }

    const syncService = req.scope.resolve("ityCdrSyncModule") as any
    const maps = await syncService.listItyExtensionMaps({ user_id: actorId }, { take: 1 })
    const extension = maps?.[0]?.extension
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

    const response = await fetch(url.toString())
    const text = await response.text()

    if (!response.ok) {
      console.error("[click2call] ITY API error:", response.status, text)
      return res.status(502).json({ error: "Tổng đài từ chối yêu cầu gọi", detail: text })
    }

    return res.json({ ok: true, extension, phone: phoneDigits, detail: text })
  } catch (err: any) {
    console.error("[click2call] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
