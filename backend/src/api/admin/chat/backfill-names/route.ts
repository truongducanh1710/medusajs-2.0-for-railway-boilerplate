import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ensureChatTables, getChatAuthInfo, getChatPool, loadPageParticipantNames } from "../_lib"

/**
 * POST /admin/chat/backfill-names
 * body: { page_id?: string }   // giới hạn 1 page; bỏ trống = mọi page có token
 *
 * Vá tên khách cho các hội thoại đã lưu customer_name NULL (do trước đây gọi Graph
 * bằng version v20.0 đã hết hạn → participants không trả `name`). Với mỗi page có
 * conversation thiếu tên: kéo participants{id,name} từ Graph rồi UPDATE theo PSID.
 * Idempotent — chạy lại nhiều lần chỉ điền thêm tên còn thiếu.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const pool = getChatPool()
    await ensureChatTables(pool)

    const body = (req.body as any) || {}
    const params: any[] = []
    const where: string[] = [`(c.customer_name IS NULL OR c.customer_name = '' OR c.customer_name ~ '^[0-9]+$')`]
    if (body.page_id) {
      params.push(body.page_id)
      where.push(`c.page_id = $${params.length}`)
    } else if (auth.fbPageIds?.length) {
      params.push(auth.fbPageIds)
      where.push(`c.page_id = ANY($${params.length})`)
    } else if (auth.fbPageIds && !auth.fbPageIds.length) {
      return res.json({ ok: true, pages: 0, updated: 0, message: "Không có page nào được phân quyền" })
    }

    // Các page cần vá + số hội thoại thiếu tên
    const { rows: pageRows } = await pool.query(
      `SELECT c.page_id, COUNT(*)::int AS missing
       FROM fb_conversation c
       WHERE ${where.join(" AND ")}
       GROUP BY c.page_id
       ORDER BY missing DESC`,
      params
    )

    let totalUpdated = 0
    const perPage: Record<string, { missing: number; updated: number; resolved: number }> = {}

    for (const pr of pageRows) {
      const pageId = pr.page_id
      let names: Map<string, string>
      try {
        names = await loadPageParticipantNames(pool, pageId)
      } catch {
        perPage[pageId] = { missing: pr.missing, updated: 0, resolved: 0 }
        continue
      }
      let updated = 0
      for (const [psid, name] of names) {
        if (!name) continue
        const r = await pool.query(
          `UPDATE fb_conversation
           SET customer_name = $1, updated_at = now()
           WHERE page_id = $2 AND customer_psid = $3
             AND (customer_name IS NULL OR customer_name = '' OR customer_name ~ '^[0-9]+$')`,
          [name, pageId, psid]
        )
        updated += r.rowCount || 0
      }
      totalUpdated += updated
      perPage[pageId] = { missing: pr.missing, updated, resolved: names.size }
    }

    return res.json({ ok: true, pages: pageRows.length, updated: totalUpdated, per_page: perPage })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
