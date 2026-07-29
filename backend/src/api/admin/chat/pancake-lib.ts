import type { Pool } from "pg"

/**
 * Pancake chat integration — SEND messages via Pancake API when the Facebook App
 * is not yet approved for the Graph messaging permission.
 *
 * Receiving stays on Facebook (webhook + sync). Only sending goes through Pancake.
 *
 * Verified facts (tested against page 693411540511731 on 2026-07-02):
 *   - conversation_id = `${pancake_page_id}_${psid}` (psid == Facebook PSID, matches customer_psid)
 *   - LIST conversations: GET public_api/v2 .../conversations?type=INBOX  (v1 needs `since`)
 *   - READ messages:      GET public_api/v1 .../conversations/{cid}/messages  (v2 returns 404 HTML)
 *   - SEND message:       POST public_api/v1 .../conversations/{cid}/messages
 *                         body {"action":"reply_inbox","message":"..."} — must be UTF-8
 */

const PANCAKE_BASE = "https://pages.fm/api/public_api"

export async function ensurePancakeTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pancake_page_token (
      fb_page_id VARCHAR(32) PRIMARY KEY,
      pancake_page_id VARCHAR(32) NOT NULL,
      page_access_token TEXT,
      enabled BOOLEAN DEFAULT true,
      last_tested_at TIMESTAMPTZ,
      last_test_ok BOOLEAN,
      last_test_error TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `)
}

export type PancakeConfig = { pancake_page_id: string; page_access_token: string }

/** Look up an enabled Pancake config by Facebook page id. Returns null if not configured. */
export async function getPancakeConfig(pool: Pool, fbPageId: string): Promise<PancakeConfig | null> {
  const { rows } = await pool.query(
    `SELECT pancake_page_id, page_access_token
     FROM pancake_page_token
     WHERE fb_page_id = $1 AND enabled = true
       AND page_access_token IS NOT NULL AND page_access_token != ''`,
    [fbPageId]
  )
  return rows[0] || null
}

/**
 * Send a text message to a customer through Pancake.
 * Builds conversation_id directly from page_id + psid; falls back to a list-and-match
 * lookup if Pancake rejects the constructed id.
 *
 * @returns Pancake message id on success
 * @throws  Error with Pancake's message on failure
 */
export async function pancakeSendMessage(
  cfg: PancakeConfig,
  psid: string,
  text: string
): Promise<string> {
  const pid = cfg.pancake_page_id
  const token = cfg.page_access_token
  let convId = `${pid}_${psid}`

  const post = async (cid: string) => {
    const url = `${PANCAKE_BASE}/v1/pages/${pid}/conversations/${cid}/messages?page_access_token=${token}`
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ action: "reply_inbox", message: text }),
    })
    const d: any = await r.json().catch(() => ({}))
    return { ok: !!d?.success, id: d?.id as string | undefined, error: d?.message as string | undefined, status: r.status }
  }

  let result = await post(convId)

  // Fallback: constructed conv_id may be wrong if Pancake uses a non-PSID id.
  // Look the conversation up by matching the customer's fb_id.
  if (!result.ok) {
    const found = await findConversationIdByPsid(cfg, psid).catch(() => null)
    if (found && found !== convId) {
      convId = found
      result = await post(convId)
    }
  }

  if (!result.ok) {
    throw new Error(result.error || `Pancake send failed (HTTP ${result.status})`)
  }
  return result.id || ""
}

/**
 * Build a PSID → customer name map from Pancake's conversation list.
 *
 * Needed because Facebook Graph `/{page}/conversations` returns OAuthException code 2
 * for every page whose inbox is managed by Pancake (verified 2026-07-29 across 13 pages:
 * all 9 Pancake-connected pages fail, all Graph-OK pages are not on Pancake). Pancake is
 * therefore the only source of customer names for those pages.
 *
 * @param maxPages pagination depth — conversations missing a name are usually old ones.
 */
export async function pancakeLoadParticipantNames(
  cfg: PancakeConfig,
  maxPages = 40
): Promise<Map<string, string>> {
  const pid = cfg.pancake_page_id
  const token = cfg.page_access_token
  const names = new Map<string, string>()
  let lastId: string | null = null

  for (let page = 0; page < maxPages; page++) {
    let url = `${PANCAKE_BASE}/v2/pages/${pid}/conversations?page_access_token=${token}&type=INBOX`
    if (lastId) url += `&last_conversation_id=${lastId}`
    const r = await fetch(url)
    const d: any = await r.json().catch(() => ({}))
    if (d?.success === false) {
      throw new Error(`Pancake: ${d?.message || "list conversations failed"}`)
    }
    const convs: any[] = d?.conversations || []
    if (!convs.length) break

    for (const c of convs) {
      // Tên khách nằm ở customers[].name; from.name là fallback cho hội thoại
      // chưa gắn customer record.
      for (const cu of c?.customers || []) {
        const id = cu?.fb_id
        const nm = String(cu?.name || "").trim()
        if (id && nm) names.set(String(id), nm)
      }
      const fromId = c?.from?.id
      const fromName = String(c?.from?.name || "").trim()
      if (fromId && fromName && !names.has(String(fromId))) names.set(String(fromId), fromName)
    }

    lastId = convs[convs.length - 1]?.id
    if (!lastId) break
  }
  return names
}

/** Scan the page's INBOX conversations (paginated) to find the one whose customer fb_id == psid. */
async function findConversationIdByPsid(cfg: PancakeConfig, psid: string): Promise<string | null> {
  const pid = cfg.pancake_page_id
  const token = cfg.page_access_token
  let lastId: string | null = null
  for (let page = 0; page < 10; page++) {
    let url = `${PANCAKE_BASE}/v2/pages/${pid}/conversations?page_access_token=${token}&type=INBOX`
    if (lastId) url += `&last_conversation_id=${lastId}`
    const r = await fetch(url)
    const d: any = await r.json().catch(() => ({}))
    const convs: any[] = d?.conversations || []
    if (!convs.length) break
    for (const c of convs) {
      const fromId = c?.from?.id
      const fbIds = (c?.customers || []).map((cu: any) => cu?.fb_id)
      if (fromId === psid || fbIds.includes(psid)) return c.id
    }
    lastId = convs[convs.length - 1]?.id
    if (!lastId) break
  }
  return null
}
