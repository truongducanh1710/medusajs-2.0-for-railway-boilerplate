/**
 * Điền customer_name cho các fb_conversation đang NULL (hiện PSID thay vì tên khách).
 *
 * Vì sao cần: trước đây name chỉ được resolve qua Graph /{pageId}/conversations?limit=25
 * không phân trang — khách nằm ngoài 25 hội thoại gần nhất không bao giờ có tên, và
 * COALESCE trong upsert giữ NULL đó vĩnh viễn.
 *
 * Chạy:
 *   pnpm exec medusa exec ./src/scripts/backfill-chat-customer-names.ts          # dry-run
 *   BACKFILL_APPLY=1 pnpm exec medusa exec ./src/scripts/backfill-chat-customer-names.ts
 *
 * Env:
 *   BACKFILL_APPLY=1   — ghi thật (mặc định chỉ in ra)
 *   BACKFILL_PAGE=<id> — chỉ xử lý 1 page
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ensureChatTables, getChatPool, loadPageParticipantNames } from "../api/admin/chat/_lib"

export default async function backfillChatCustomerNames({ container }: ExecArgs) {
  const logger = container.resolve("logger") as any
  const apply = process.env.BACKFILL_APPLY === "1"
  const onlyPage = process.env.BACKFILL_PAGE || null

  const pool = getChatPool()
  await ensureChatTables(pool)

  const params: any[] = []
  let filter = ""
  if (onlyPage) {
    params.push(onlyPage)
    filter = `AND page_id = $1`
  }

  const { rows: pages } = await pool.query(
    `SELECT page_id, COUNT(*)::int AS missing
     FROM fb_conversation
     WHERE (customer_name IS NULL OR customer_name = '') ${filter}
     GROUP BY page_id
     ORDER BY missing DESC`,
    params
  )

  if (!pages.length) {
    logger.info("[backfill-names] Không có conversation nào thiếu tên.")
    return
  }

  logger.info(
    `[backfill-names] ${pages.length} page, tổng ${pages.reduce((s, p) => s + p.missing, 0)} conversation thiếu tên. ` +
      (apply ? "Chế độ GHI THẬT." : "Dry-run — đặt BACKFILL_APPLY=1 để ghi.")
  )

  let totalFixed = 0
  let totalUnresolved = 0

  for (const page of pages) {
    let names: Map<string, string>
    try {
      names = await loadPageParticipantNames(pool, page.page_id)
    } catch (e: any) {
      logger.warn(`[backfill-names] page ${page.page_id}: không lấy được tên — ${e.message}`)
      continue
    }
    if (!names.size) {
      logger.warn(`[backfill-names] page ${page.page_id}: Graph không trả tên nào (token hỏng hoặc thiếu quyền?)`)
      continue
    }

    const { rows: convs } = await pool.query(
      `SELECT id, customer_psid FROM fb_conversation
       WHERE page_id = $1 AND (customer_name IS NULL OR customer_name = '')`,
      [page.page_id]
    )

    let fixed = 0
    for (const c of convs) {
      const name = names.get(c.customer_psid)
      if (!name) {
        totalUnresolved++
        continue
      }
      if (apply) {
        await pool.query(`UPDATE fb_conversation SET customer_name = $2, updated_at = now() WHERE id = $1`, [c.id, name])
      }
      fixed++
    }

    totalFixed += fixed
    logger.info(`[backfill-names] page ${page.page_id}: ${fixed}/${convs.length} có tên (Graph biết ${names.size} khách)`)
  }

  logger.info(
    `[backfill-names] Xong. ${totalFixed} conversation ${apply ? "đã cập nhật" : "sẽ được cập nhật"}, ` +
      `${totalUnresolved} không tìm thấy tên trên Graph.`
  )
}
