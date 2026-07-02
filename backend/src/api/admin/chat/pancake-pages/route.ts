import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getChatAuthInfo, getChatPool } from "../_lib"
import { ensurePancakeTable, pancakeSendMessage } from "../pancake-lib"

/**
 * GET  /admin/chat/pancake-pages — list all FB pages + their Pancake token config
 * PATCH /admin/chat/pancake-pages — upsert a page's Pancake token (admin only)
 * POST /admin/chat/pancake-pages — test a token by calling Pancake API (admin only)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const pool = getChatPool()
    await ensurePancakeTable(pool)

    // Join fb_page_token (page list) with pancake_page_token (token config).
    // Token itself is never returned to the client — only whether one exists.
    const { rows } = await pool.query(`
      SELECT
        ft.page_id,
        ft.page_name,
        pt.pancake_page_id,
        pt.enabled,
        (pt.page_access_token IS NOT NULL AND pt.page_access_token != '') AS has_token,
        pt.last_tested_at,
        pt.last_test_ok,
        pt.last_test_error,
        pt.updated_at
      FROM fb_page_token ft
      LEFT JOIN pancake_page_token pt ON pt.fb_page_id = ft.page_id
      ORDER BY ft.page_name
    `)
    return res.json({ pages: rows })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getChatAuthInfo(req)
    if (!auth?.isAdmin) return res.status(403).json({ error: "Admin only" })
    const pool = getChatPool()
    await ensurePancakeTable(pool)

    const b = (req.body as any) || {}
    const fbPageId = String(b.fb_page_id || b.page_id || "").trim()
    if (!fbPageId) return res.status(400).json({ error: "fb_page_id required" })

    // Default pancake_page_id = fb_page_id (verified equal for FB pages on Pancake).
    // Allow manual override in case a page's Pancake id differs.
    const pancakePageId = String(b.pancake_page_id || fbPageId).trim()
    const token = b.page_access_token !== undefined ? String(b.page_access_token || "").trim() : undefined
    const enabled = b.enabled !== undefined ? !!b.enabled : undefined

    const sets: string[] = ["fb_page_id = $1", "pancake_page_id = $2"]
    const vals: any[] = [fbPageId, pancakePageId]
    if (token !== undefined) { vals.push(token); sets.push(`page_access_token = $${vals.length}`) }
    if (enabled !== undefined) { vals.push(enabled); sets.push(`enabled = $${vals.length}`) }

    await pool.query(
      `INSERT INTO pancake_page_token (fb_page_id, pancake_page_id, page_access_token, enabled, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (fb_page_id) DO UPDATE SET
         ${sets.slice(1).join(", ")},
         updated_at = now()`,
      [fbPageId, pancakePageId, token ?? "", enabled ?? true]
    )
    return res.json({ ok: true })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/** POST — test a token: try listing 1 conversation. Body: { fb_page_id } (uses stored token) */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getChatAuthInfo(req)
    if (!auth?.isAdmin) return res.status(403).json({ error: "Admin only" })
    const pool = getChatPool()
    await ensurePancakeTable(pool)

    const b = (req.body as any) || {}
    const fbPageId = String(b.fb_page_id || b.page_id || "").trim()
    if (!fbPageId) return res.status(400).json({ error: "fb_page_id required" })

    const { rows } = await pool.query(
      `SELECT pancake_page_id, page_access_token FROM pancake_page_token WHERE fb_page_id = $1`,
      [fbPageId]
    )
    const cfg = rows[0]
    if (!cfg?.page_access_token) return res.status(400).json({ error: "Chưa có token cho page này" })

    // Test: list conversations (cheapest read that requires a valid page token)
    const url = `https://pages.fm/api/public_api/v2/pages/${cfg.pancake_page_id}/conversations?page_access_token=${cfg.page_access_token}&type=INBOX`
    let ok = false
    let errMsg: string | null = null
    let sample: any = null
    try {
      const r = await fetch(url)
      const d: any = await r.json().catch(() => ({}))
      if (d?.success && Array.isArray(d.conversations)) {
        ok = true
        sample = { count: d.conversations.length, first: d.conversations[0]?.from?.name || null }
      } else {
        errMsg = d?.message || `HTTP ${r.status}`
      }
    } catch (e: any) {
      errMsg = e.message
    }

    await pool.query(
      `UPDATE pancake_page_token
       SET last_tested_at = now(), last_test_ok = $2, last_test_error = $3
       WHERE fb_page_id = $1`,
      [fbPageId, ok, errMsg]
    )
    return res.json({ ok, error: errMsg, sample })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
