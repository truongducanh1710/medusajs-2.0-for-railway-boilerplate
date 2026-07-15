import { getPool } from "./db"

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? ""
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? ""

let _tgLogReady = false

// Ghi log mỗi lần gửi Telegram cho 1 nhân sự (để hiển thị ở trang Chấm công).
// Best-effort: lỗi log KHÔNG được làm hỏng luồng gửi. Tự tạo bảng lần đầu (như mkt_exchange_rate).
export async function logTelegramSent(email: string, kind: string, ok: boolean): Promise<void> {
  if (!email) return
  try {
    const pool = getPool()
    if (!_tgLogReady) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS mkt_telegram_log (
          id BIGSERIAL PRIMARY KEY,
          recipient_email TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'notify',
          ok BOOLEAN NOT NULL DEFAULT true,
          sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `)
      await pool.query(`CREATE INDEX IF NOT EXISTS mkt_telegram_log_recip_idx ON mkt_telegram_log (recipient_email, sent_at)`)
      _tgLogReady = true
    }
    await pool.query(
      `INSERT INTO mkt_telegram_log (recipient_email, kind, ok) VALUES ($1, $2, $3)`,
      [email, kind || "notify", ok]
    )
  } catch (e: any) {
    console.warn("[notify] logTelegramSent error:", e.message)
  }
}

export async function notifyTelegram(text: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML" }),
    })
  } catch (e: any) {
    console.warn("[notify] Telegram error:", e.message)
  }
}

/** Gửi Telegram tới 1 chat_id cụ thể */
export async function notifyTelegramChat(chatId: string, text: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !chatId) return
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    })
  } catch (e: any) {
    console.warn("[notify] Telegram chat error:", e.message)
  }
}

/**
 * Gửi Telegram tới một hoặc nhiều user theo email.
 * Lookup tg_chat_id từ user.metadata — bỏ qua user chưa link bot.
 */
export async function notifyTelegramByEmail(
  userModule: any,
  emails: string | string[],
  text: string,
  kind = "notify"
): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) return
  const emailList = Array.isArray(emails) ? emails : [emails]
  try {
    const users = await userModule.listUsers(
      { email: emailList.length === 1 ? emailList[0] : undefined },
      { select: ["email", "metadata"] }
    )
    const targets = emailList.length > 1
      ? users.filter((u: any) => emailList.includes(u.email))
      : users
    await Promise.all(
      targets.map(async (u: any) => {
        const chatId: string | undefined = (u.metadata as any)?.tg_chat_id
        if (!chatId) return // chưa link bot → không gửi, không log
        await notifyTelegramChat(chatId, text)
        await logTelegramSent(u.email, kind, true)
      })
    )
  } catch (e: any) {
    console.warn("[notify] notifyTelegramByEmail error:", e.message)
  }
}

export function formatRuleAlert(opts: {
  ruleName: string
  mktName: string
  campName: string
  action: string
  metrics: Record<string, any>
  actionDone?: boolean
}): string {
  const icon = opts.actionDone ? "🤖" : "🔔"
  const actionLabel: Record<string, string> = {
    pause: "⏸ Tắt camp",
    activate: "▶️ Bật camp",
    set_budget_pct: "💰 Đổi budget %",
    set_budget_abs: "💰 Đặt budget",
    notify: "🔔 Cảnh báo",
  }
  const m = opts.metrics
  const lines = [
    `${icon} <b>Rule: ${opts.ruleName}</b>`,
    `👤 MKT: ${opts.mktName}`,
    `📋 Camp: ${opts.campName}`,
    `⚡ Action: ${actionLabel[opts.action] ?? opts.action}`,
    ``,
    `📊 Metrics:`,
    m.spend != null ? `  • Spend: ${Math.round(m.spend / 1000)}k` : "",
    m.cpr_real != null ? `  • CPR thực: ${Math.round(m.cpr_real / 1000)}k` : "",
    m.orders_real != null ? `  • Đơn thực: ${m.orders_real}` : "",
    m.learning_stage ? `  • Learning: ${m.learning_stage}` : "",
  ].filter(Boolean)
  return lines.join("\n")
}
