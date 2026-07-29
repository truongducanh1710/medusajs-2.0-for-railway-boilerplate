import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ensureChatTables, getChatAuthInfo, getChatPool, loadPageParticipantNames } from "../_lib"
import { ensurePancakeTable, getPancakeConfig, pancakeLoadParticipantNames } from "../pancake-lib"

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

/**
 * Điều kiện SQL: customer_name coi như trống.
 * @param p  vị trí tham số chứa mảng PLACEHOLDER_NAMES
 * @param t  tiền tố bảng ("c." khi có alias, "" khi UPDATE không alias)
 */
const MISSING_NAME_SQL = (p: number, t = "c.") =>
  `(${t}customer_name IS NULL OR trim(${t}customer_name) = '' OR ${t}customer_name ~ '^[0-9]+$' OR trim(${t}customer_name) = ANY($${p}))`

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const pool = getChatPool()
    await ensureChatTables(pool)
    await ensurePancakeTable(pool)

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
      source?: "pancake" | "graph"
      error?: string
    }
    const perPage: Record<string, PageResult> = {}

    for (const pr of pageRows) {
      const pageId = pr.page_id
      let names = new Map<string, string>()
      let source: "pancake" | "graph" | null = null
      const errs: string[] = []

      // Pancake trước: page nào đã nối Pancake thì Graph /conversations luôn trả
      // OAuthException code 2 (Facebook chặn app khác đọc inbox do bên thứ 3 quản lý),
      // nên Pancake là nguồn tên DUY NHẤT cho các page đó.
      const pcfg = await getPancakeConfig(pool, pageId).catch(() => null)
      if (pcfg) {
        try {
          names = await pancakeLoadParticipantNames(pcfg)
          source = "pancake"
        } catch (e: any) {
          errs.push(`Pancake: ${e.message}`)
        }
      }

      // Graph fallback cho page chưa nối Pancake.
      if (!names.size) {
        try {
          // fresh: bỏ cache 60s để bấm "Vá tên" lần 2 không dùng lại kết quả rỗng.
          // maxPages cao: hội thoại thiếu tên thường là hội thoại cũ, nằm sâu trong phân trang.
          names = await loadPageParticipantNames(pool, pageId, { fresh: true, maxPages: 40 })
          if (names.size) source = "graph"
        } catch (e: any) {
          errs.push(`Graph: ${e.message}`)
        }
      }

      if (!names.size) {
        // Trước đây `catch {}` rỗng — token hỏng biến thành "0 updated" im lặng,
        // khiến bấm Vá tên mãi không ăn thua mà không biết vì sao.
        const msg = errs.join(" · ")
        if (msg) console.warn(`[backfill-names] page ${pageId}: ${msg}`)
        perPage[pageId] = {
          missing: pr.missing,
          updated: 0,
          resolved: 0,
          status: errs.length ? "graph_error" : "no_names",
          ...(msg ? { error: msg } : {}),
        }
        continue
      }

      let updated = 0
      for (const [psid, name] of names) {
        if (!name || PLACEHOLDER_NAMES.includes(name.trim())) continue
        const r = await pool.query(
          `UPDATE fb_conversation
           SET customer_name = $1, updated_at = now()
           WHERE page_id = $2 AND customer_psid = $3 AND ${MISSING_NAME_SQL(4, "")}`,
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
        ...(source ? { source } : {}),
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
