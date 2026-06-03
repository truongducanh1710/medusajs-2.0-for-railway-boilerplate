import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool, getAuthInfo, getPageTokens } from "../_lib"
import { isTokenError } from "../../../../lib/fb-graph"

/** POST /admin/fb-content/refresh-tokens — force refresh page tokens từ FB. */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const pool = getPool()
    const pages = await getPageTokens(pool, true)
    return res.json({ refreshed: pages.length })
  } catch (err: any) {
    if (isTokenError(err)) return res.status(400).json({ error: "FB_TOKEN_EXPIRED" })
    return res.status(500).json({ error: err.message })
  }
}
