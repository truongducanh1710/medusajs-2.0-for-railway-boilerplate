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

  let pages: Array<{ page_id: string; page_name: string; access_token: string }> = []
  try {
    const { rows } = await pool.query(
      `SELECT page_id, page_name, access_token FROM fb_page_token
       WHERE access_token IS NOT NULL AND access_token != ''
         AND sync_enabled = true`
    )
    pages = rows
  } catch {
    // sync_enabled có thể chưa tồn tại ở môi trường cũ — fallback không lọc cột đó
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

  for (const page of pages) {
    try {
      const r = await pullPageInbox(page.page_id, page.page_name, page.access_token, since, container)
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

  logger?.info?.(`[fb-inbox-sync] Done: ${pages.length} pages, ${totalSaved} saved, ${totalErrors} errors`)
}

export const config = {
  name: "fb-inbox-sync",
  schedule: "*/3 * * * *",
}
