import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getChatAuthInfo, getChatPool } from "../_lib"

/** TEMP DEBUG — GET /admin/chat/debug-graph?page_id=xxx — xoá sau khi xong điều tra tên khách. */
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
  const url = `https://graph.facebook.com/${version}/${pageId}/conversations?fields=participants{id,name,email}&limit=5&access_token=${token}`
  const r = await fetch(url)
  const data = await r.json()

  const { rows: dbSample } = await pool.query(
    `SELECT customer_psid, customer_name FROM fb_conversation WHERE page_id = $1 ORDER BY updated_at DESC LIMIT 5`,
    [pageId]
  )

  return res.json({ version, status: r.status, graph_response: data, db_sample: dbSample })
}
