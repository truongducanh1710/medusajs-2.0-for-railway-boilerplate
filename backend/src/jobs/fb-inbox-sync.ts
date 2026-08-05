import { MedusaContainer } from "@medusajs/framework"
import { getChatPool, pullPageInbox } from "../api/admin/chat/_lib"

/**
 * Kéo tin page (outbound) về DB định kỳ.
 *
 * Vì sao cần: sale trả lời khách qua giao diện Pancake, không phải qua Send API của
 * app phanvietweb2 → Facebook KHÔNG phát message_echoes về webhook → tin page không
 * vào DB realtime. Cron này kéo Graph API conversations (thấy được cả tin page) mỗi
 * vài phút để tin page hiện mà không cần bấm Sync thủ công.
 *
 * Window 10 phút (schedule mỗi 3 phút) để bù trễ/miss, giữ số request Graph API thấp.
 */
const WINDOW_MINUTES = 10

export default async function fbInboxSync(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  const pool = getChatPool()

  // Cột con trỏ để xoay vòng page. Không có nó, câu SELECT trả về thứ tự cố định
  // của Postgres nên 5 page đầu bị quét lại mỗi lần còn 27 page sau KHÔNG BAO GIỜ
  // tới lượt — quan sát trên production: "Done: 5/32 pages" lặp lại mọi lần chạy.
  await pool.query(
    `ALTER TABLE fb_page_token ADD COLUMN IF NOT EXISTS last_inbox_sync_at TIMESTAMPTZ`
  ).catch(() => {})

  let pages: Array<{ page_id: string; page_name: string; access_token: string }> = []
  try {
    const { rows } = await pool.query(
      `SELECT page_id, page_name, access_token FROM fb_page_token
       WHERE access_token IS NOT NULL AND access_token != ''
         AND sync_enabled = true
       ORDER BY last_inbox_sync_at ASC NULLS FIRST`
    )
    pages = rows
  } catch {
    // sync_enabled/last_inbox_sync_at có thể chưa tồn tại ở môi trường cũ — fallback
    const { rows } = await pool.query(
      `SELECT page_id, page_name, access_token FROM fb_page_token
       WHERE access_token IS NOT NULL AND access_token != ''`
    )
    pages = rows
  }

  if (!pages.length) {
    logger?.info?.("[fb-inbox-sync] No pages with token")
    return
  }

  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000)
  let totalSaved = 0, totalErrors = 0

  // Trần thời gian: chạy */3 với concurrency "forbid" nhưng không có timeout, nên một
  // lần chạy chậm (page nhiều, FB Graph treo) giữ slot worker duy nhất và làm mọi cron
  // khác xếp hàng — đúng cách pancake-incremental-sync từng chặn cả queue 40+ phút.
  const deadline = Date.now() + 2 * 60_000
  let scanned = 0

  // Trần cứng cho MỘT page. Deadline kiểm giữa các page là chưa đủ: pullPageInbox
  // tra tên khách cho từng hội thoại mới (fetchCustomerNameFromGraph → tối đa
  // 2 trang × 4 lần thử, kèm backoff sleep), nên một page nhiều hội thoại lạ có thể
  // chạy rất lâu dù mỗi request đã có timeout 20s. Không có trần này thì job vẫn
  // giữ slot worker duy nhất và chặn mọi cron khác.
  const withCap = <T,>(p: Promise<T>, ms: number): Promise<T> =>
    Promise.race([
      p,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`quá ${ms / 1000}s`)), ms)),
    ])

  for (const page of pages) {
    if (Date.now() > deadline) {
      logger?.warn?.(`[fb-inbox-sync] Quá 2 phút — dừng, bỏ qua ${pages.length - scanned} page còn lại`)
      break
    }
    scanned++
    // Đánh dấu TRƯỚC khi quét, và cả khi lỗi: page hỏng phải bị đẩy xuống cuối
    // hàng đợi thay vì chặn mãi ở đầu. Hai page timeout 45s liên tục từng ăn
    // 90/120 giây ngân sách mỗi lần chạy.
    await pool.query(
      `UPDATE fb_page_token SET last_inbox_sync_at = now() WHERE page_id = $1`,
      [page.page_id]
    ).catch(() => {})

    try {
      const r = await withCap(
        pullPageInbox(page.page_id, page.page_name, page.access_token, since, container),
        45_000
      )
      totalSaved += r.saved
      totalErrors += r.errors.length
      if (r.errors.length) {
        logger?.warn?.(`[fb-inbox-sync] ${page.page_name}: ${r.errors.slice(0, 2).join("; ")}`)
      }
    } catch (e: any) {
      totalErrors++
      logger?.error?.(`[fb-inbox-sync] ${page.page_name} failed: ${e.message}`)
    }
  }

  logger?.info?.(`[fb-inbox-sync] Done: ${scanned}/${pages.length} pages, ${totalSaved} saved, ${totalErrors} errors`)
}

export const config = {
  name: "fb-inbox-sync",
  schedule: "*/3 * * * *",
}
