import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getChatAuthInfo, getChatPool } from "../_lib"

/**
 * TEMP DEBUG — GET /admin/chat/debug-graph?page_id=xxx
 *
 * Chẩn đoán vì sao vá tên không lấy được tên khách cho 1 page. Với mỗi page thử
 * lần lượt: token có hợp lệ không (/me), page có trả conversations không, và
 * ID mà Graph trả về có khớp customer_psid trong DB không.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getChatAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthenticated" })
  const pageId = String((req.query as any).page_id || "")
  if (!pageId) return res.status(400).json({ error: "page_id required" })

  const pool = getChatPool()
  const { rows } = await pool.query(`SELECT access_token FROM fb_page_token WHERE page_id = $1`, [pageId])
  const token = rows[0]?.access_token
  if (!token) return res.status(404).json({ error: "no token" })

  const version = process.env.FB_GRAPH_VERSION || "v25.0"
  const call = async (path: string) => {
    const url = `https://graph.facebook.com/${version}${path}${path.includes("?") ? "&" : "?"}access_token=${token}`
    try {
      const r = await fetch(url)
      const data = await r.json()
      return { status: r.status, data }
    } catch (e: any) {
      return { status: 0, data: { fetch_error: e.message } }
    }
  }

  // 1. Token còn sống không, và nó là token của ai (page vs user)?
  const me = await call(`/me?fields=id,name`)
  // 2. Token có scope gì — debug_token cần app token nên chỉ suy ra gián tiếp.
  const perms = await call(`/${pageId}?fields=id,name,tasks`)
  // 3. Endpoint thật sự dùng khi vá tên.
  const convs = await call(`/${pageId}/conversations?fields=participants{id,name}&limit=5`)
  // 4. Thử không kèm fields — tách bạch lỗi do field participants hay do cả endpoint.
  const convsPlain = await call(`/${pageId}/conversations?limit=3`)

  const { rows: dbSample } = await pool.query(
    `SELECT customer_psid, customer_name FROM fb_conversation WHERE page_id = $1 ORDER BY updated_at DESC LIMIT 5`,
    [pageId]
  )

  return res.json({
    version,
    page_id: pageId,
    token_owner: me.data?.id ? { id: me.data.id, name: me.data.name } : me.data,
    token_is_for_this_page: me.data?.id === pageId,
    page_info: perms.data,
    conversations_with_fields: { status: convs.status, error: convs.data?.error, count: convs.data?.data?.length },
    conversations_plain: { status: convsPlain.status, error: convsPlain.data?.error, count: convsPlain.data?.data?.length },
    db_sample: dbSample,
  })
}
