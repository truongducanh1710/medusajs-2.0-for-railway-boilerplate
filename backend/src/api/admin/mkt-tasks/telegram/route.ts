import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

const BOT_TOKEN = () => process.env.TELEGRAM_BOT_TOKEN ?? ""

async function sendTg(chatId: string | number, text: string) {
  if (!BOT_TOKEN()) return
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN()}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  }).catch(() => {})
}

/**
 * POST /admin/mkt-tasks/telegram/link
 * Telegram bot webhook gọi vào đây khi user nhắn /link {email}
 * Body: { message: { chat: { id }, text } }  (Telegram Update object)
 *
 * Lưu tg_chat_id vào user.metadata — sau đó dùng để gửi noti cá nhân.
 *
 * Bảo mật: kiểm tra X-Telegram-Bot-Api-Secret-Token header (set trong setWebhook).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    // Xác thực webhook secret
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? ""
    if (secret && req.headers["x-telegram-bot-api-secret-token"] !== secret) {
      return res.status(403).json({ ok: false })
    }

    const body = req.body as any
    const msg = body?.message
    if (!msg) return res.json({ ok: true }) // ignore non-message updates

    const chatId = String(msg.chat?.id ?? "")
    const text: string = msg.text ?? ""

    // /link email@example.com
    const match = text.match(/^\/link\s+(\S+@\S+\.\S+)/i)
    if (!match) {
      await sendTg(chatId, "Dùng lệnh: <code>/link email@phanviet.vn</code> để kết nối tài khoản của bạn.")
      return res.json({ ok: true })
    }

    const email = match[1].toLowerCase()
    const userModule = req.scope.resolve(Modules.USER)
    const [user] = await userModule.listUsers({ email }, { select: ["id", "email", "first_name", "last_name", "metadata"] })

    if (!user) {
      await sendTg(chatId, `❌ Không tìm thấy tài khoản với email <b>${email}</b>.\nKiểm tra lại hoặc liên hệ admin.`)
      return res.json({ ok: true })
    }

    const existingMeta = (user.metadata as any) ?? {}
    await userModule.updateUsers({
      id: user.id,
      metadata: { ...existingMeta, tg_chat_id: chatId },
    })

    const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || email
    await sendTg(chatId,
      `✅ Đã kết nối thành công!\n\nXin chào <b>${name}</b> 👋\nBạn sẽ nhận thông báo giao việc qua Telegram từ bây giờ.`
    )
    return res.json({ ok: true })
  } catch (e: any) {
    console.error("[telegram/link]", e.message)
    return res.json({ ok: true }) // always 200 for Telegram
  }
}
