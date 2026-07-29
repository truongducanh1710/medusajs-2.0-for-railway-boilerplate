import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ensureChatTables, getChatAuthInfo, getChatPool, loadPageParticipantNames } from "../_lib"

/**
 * POST /admin/chat/backfill-names
 * body: { page_id?: string }   // giới hạn 1 page; bỏ trống = mọi page có token
 *
 * Vá tên khách cho các hội thoại đang hiển thị PSID thay vì tên. Với mỗi page có
 * hội thoại thiếu tên: kéo participants{id,name} từ Graph rồi UPDATE theo PSID.
 * Idempotent — chạy lại nhiều lần chỉ điền thêm tên còn thiếu.
 *
 * Mỗi page trả về status để biết chính xác vì sao không vá được:
 *   ok            — có tên và đã update
 *   graph_error   — gọi Graph thất bại (token hỏng/thiếu quyền) → xem `error`
 *   no_names      — Graph trả 200 nhưng không có tên nào
 *   no_match      — Graph có tên nhưng không PSID nào khớp hội thoại thiếu tên
 *                   (hội thoại cũ hơn độ sâu phân trang Graph cho phép)
 */

/**
 * Facebook trả literal "Người dùng Facebook" khi khách không cho truy cập profile.
 * Đây không phải tên thật nên phải coi như thiếu tên: vừa để đếm đúng vào `missing`,
 * vừa để lần vá sau có cơ hội ghi đè nếu Graph trả tên thật.
 */
const PLACEHOLDER_NAMES = ["Người dùng Facebook", "Facebook User"]

/** Điều kiện SQL: customer_name coi như trống. $n đầu tiên là mảng placeholder. */
const MISSING_NAME_SQL = (p: number) =>
  `(c.customer_name IS NULL OR trim(c.customer_name) = '' OR c.customer_name ~ '^[0-9]+$' OR trim(c.customer_name) = ANY($${p}))`

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const pool = getChatPool()
    await ensureChatTables(pool)

    const body = (req.body as any) || {}
    const params: any[] = [PLACEHOLDER_NAMES]
    const where: string[] = [MISSING_NAME_SQL(1)]
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
    type PageResult = {
      missing: number
      updated: number
      resolved: number
      status: "ok" | "graph_error" | "no_names" | "no_match"
      error?: string
    }
    const perPage: Record<string, PageResult> = {}

    for (const pr of pageRows) {
      const pageId = pr.page_id
      let names: Map<string, string>
      try {
        // fresh: bỏ cache 60s để bấm "Vá tên" lần 2 không dùng lại kết quả rỗng.
        // maxPages cao: hội thoại thiếu tên thường là hội thoại cũ, nằm sâu trong phân trang.
        names = await loadPageParticipantNames(pool, pageId, { fresh: true, maxPages: 40 })
      } catch (e: any) {
        // Trước đây `catch {}` rỗng — token hỏng biến thành "0 updated" im lặng,
        // khiến bấm Vá tên mãi không ăn thua mà không biết vì sao.
        console.warn(`[backfill-names] page ${pageId}: ${e.message}`)
        perPage[pageId] = { missing: pr.missing, updated: 0, resolved: 0, status: "graph_error", error: e.message }
        continue
      }

      if (!names.size) {
        perPage[pageId] = { missing: pr.missing, updated: 0, resolved: 0, status: "no_names" }
        continue
      }

      let updated = 0
      for (const [psid, name] of names) {
        if (!name || PLACEHOLDER_NAMES.includes(name.trim())) continue
        const r = await pool.query(
          `UPDATE fb_conversation c
           SET customer_name = $1, updated_at = now()
           WHERE c.page_id = $2 AND c.customer_psid = $3 AND ${MISSING_NAME_SQL(4)}`,
          [name, pageId, psid, PLACEHOLDER_NAMES]
        )
        updated += r.rowCount || 0
      }
      totalUpdated += updated
      perPage[pageId] = {
        missing: pr.missing,
        updated,
        resolved: names.size,
        status: updated > 0 ? "ok" : "no_match",
      }
    }

    const failed = Object.entries(perPage).filter(([, v]) => v.status !== "ok" && v.missing > 0)
    return res.json({
      ok: true,
      pages: pageRows.length,
      updated: totalUpdated,
      failed_pages: failed.length,
      per_page: perPage,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
