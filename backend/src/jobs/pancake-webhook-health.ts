import { MedusaContainer } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { getPool } from "../lib/db"

// Webhook Pancake là đường cập nhật đơn chính: đo trên production 14 ngày nó ghi
// 97.8% thay đổi status, và số đơn CHỈ cron bắt được = 0. Vì vậy pancake-incremental-sync
// đã hạ từ */5 xuống 1 lần/ngày — nghĩa là nếu webhook chết, không còn gì quét lại kịp thời.
// Job này thay vai trò lưới an toàn đó: phát hiện webhook im lặng trong ~30 phút
// và báo ngay, thay vì đợi cron tình cờ tìm ra sau nhiều giờ.

// Ngưỡng im lặng. Ngày thường webhook về 1.200–2.400 event/ngày (~1 event/phút giờ hành chính),
// nên 30 phút không có gì là bất thường thật sự, không phải noise.
const SILENCE_MINUTES = 30

// Chỉ cảnh báo trong giờ có đơn (VN 07:00–23:00). Đêm khuya lặng là bình thường.
const ACTIVE_HOUR_VN_START = 7
const ACTIVE_HOUR_VN_END = 23

// Không spam: mỗi lần cảnh báo cách nhau tối thiểu 2 tiếng.
const REALERT_COOLDOWN_MS = 2 * 3600_000

let lastAlertAt = 0

export default async function pancakeWebhookHealth(container: MedusaContainer) {
  const logger = container.resolve("logger") as any

  const hourVN = new Date(Date.now() + 7 * 3600_000).getUTCHours()
  if (hourVN < ACTIVE_HOUR_VN_START || hourVN >= ACTIVE_HOUR_VN_END) return

  try {
    const { rows } = await getPool().query(
      `SELECT max(received_at) AS newest,
              count(*) FILTER (WHERE received_at > now() - interval '1 hour') AS last_hour,
              count(*) FILTER (WHERE received_at > now() - interval '1 hour'
                               AND upsert_success IS NOT TRUE) AS failed_last_hour
       FROM pancake_webhook_log`
    )

    const newest: Date | null = rows[0]?.newest ?? null
    const lastHour = Number(rows[0]?.last_hour ?? 0)
    const failedLastHour = Number(rows[0]?.failed_last_hour ?? 0)

    const silentMin = newest ? Math.floor((Date.now() - new Date(newest).getTime()) / 60000) : null

    // silentMin === null: bảng rỗng. Ngay sau khi bật logging lại thì đây là trạng thái
    // bình thường trong ít phút đầu, nên không cảnh báo — chỉ log để theo dõi.
    if (silentMin === null) {
      logger?.info?.("[PancakeWebhookHealth] Chưa có webhook log nào — bỏ qua lần kiểm tra này")
      return
    }

    const isSilent = silentMin >= SILENCE_MINUTES
    const isFailing = lastHour > 0 && failedLastHour / lastHour > 0.5

    if (!isSilent && !isFailing) {
      logger?.info?.(`[PancakeWebhookHealth] OK — ${lastHour} event/giờ, mới nhất ${silentMin} phút trước`)
      return
    }

    const reason = isSilent
      ? `Không nhận được webhook nào trong ${silentMin} phút (ngưỡng ${SILENCE_MINUTES})`
      : `${failedLastHour}/${lastHour} webhook giờ qua xử lý thất bại`

    logger?.error?.(`[PancakeWebhookHealth] ⚠ ${reason}`)

    if (Date.now() - lastAlertAt < REALERT_COOLDOWN_MS) return
    lastAlertAt = Date.now()

    const notifModule = container.resolve(Modules.NOTIFICATION) as any
    const userModule = container.resolve(Modules.USER) as any
    const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL

    const allUsers = await userModule.listUsers({}, { select: ["email", "metadata"] })
    const emails: string[] = allUsers
      .filter((u: any) => {
        if (u.email === SUPER_ADMIN_EMAIL) return true
        const perms: string[] = Array.isArray(u.metadata?.permissions) ? u.metadata.permissions : []
        return perms.includes("page.don-hang.manage")
      })
      .map((u: any) => u.email)
      .filter(Boolean)

    if (!emails.length) {
      logger?.warn?.("[PancakeWebhookHealth] Không tìm được email người nhận cảnh báo")
      return
    }

    for (const to of emails) {
      await notifModule.createNotifications({
        to,
        channel: "email",
        template: "pancake-webhook-health",
        content: {
          subject: "⚠ Webhook Pancake có vấn đề — đơn có thể không được cập nhật",
          text: `${reason}.\n\nĐơn hàng có thể đang không được cập nhật trạng thái. Kiểm tra cấu hình webhook trên Pancake POS (shop VN + MY) và log backend.`,
        },
      }).catch((e: any) => logger?.warn?.(`[PancakeWebhookHealth] Gửi mail ${to} lỗi: ${e.message}`))
    }
  } catch (err: any) {
    logger?.error?.(`[PancakeWebhookHealth] Lỗi kiểm tra: ${err.message}`)
  }
}

export const config = {
  name: "pancake-webhook-health",
  schedule: "*/15 * * * *",
}
