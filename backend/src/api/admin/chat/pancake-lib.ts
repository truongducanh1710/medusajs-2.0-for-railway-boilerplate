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

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Timeout bắt buộc cho mọi call Pancake: fetch của Node không có timeout mặc định,
// và các hàm dưới đây gọi trong vòng lồng nhau (tới 4 lần thử × 10-20 trang) từ
// fb-inbox-sync (cron */3, concurrency "forbid"). Một request treo là job treo,
// giữ slot worker duy nhất và chặn mọi cron khác — gồm mkt-cost-intraday-sync.
const PANCAKE_TIMEOUT_MS = 20_000

function pancakeFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(PANCAKE_TIMEOUT_MS) })
}

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
    const r = await pancakeFetch(url, {
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
 * @param wanted   PSIDs still needing a name. Paging stops as soon as all are found,
 *                 which keeps a typical backfill to a couple of requests instead of
 *                 `maxPages` and avoids tripping Pancake's rate limit.
 */
export async function pancakeLoadParticipantNames(
  cfg: PancakeConfig,
  maxPages = 40,
  wanted?: Set<string>,
  // Backfill thủ công (route backfill-names) chấp nhận chờ để vá bằng được;
  // đường cron tra tên từng hội thoại thì không — 4 lần thử kèm backoff nhân với
  // số hội thoại lạ là đủ để fb-inbox-sync chạy quá lâu và chặn queue.
  maxAttempts = 4
): Promise<Map<string, string>> {
  const pid = cfg.pancake_page_id
  const token = cfg.page_access_token
  const names = new Map<string, string>()
  let lastId: string | null = null

  for (let page = 0; page < maxPages; page++) {
    let url = `${PANCAKE_BASE}/v2/pages/${pid}/conversations?page_access_token=${token}&type=INBOX`
    if (lastId) url += `&last_conversation_id=${lastId}`

    // Pancake rate-limit khá thấp; vá tên toàn bộ page sẽ đụng trần nếu gọi liên tục.
    // Retry với backoff tăng dần thay vì bỏ cuộc — nếu không, page bị "Too many requests"
    // sẽ không vá được tên nào dù dữ liệu vẫn ở đó.
    let d: any = null
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (page > 0 || attempt > 0) await sleep(attempt ? 1500 * attempt : 350)
      const r = await pancakeFetch(url)
      d = await r.json().catch(() => ({}))
      if (d?.success !== false) break
      const msg = String(d?.message || "")
      if (!/too many requests|try again later/i.test(msg)) break
      d = { success: false, message: msg, _retryable: true }
    }
    if (d?.success === false) {
      throw new Error(String(d?.message || "list conversations failed"))
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

    // Đã tìm đủ PSID cần vá → dừng, không quét tiếp cho tốn quota.
    if (wanted && wanted.size && [...wanted].every(id => names.has(id))) break

    lastId = convs[convs.length - 1]?.id
    if (!lastId) break
  }
  return names
}

/**
 * Liệt kê hội thoại INBOX có hoạt động từ `since` trở lại đây.
 *
 * Pancake sắp xếp mới nhất trước, nên dừng ngay khi gặp trang đã cũ hơn `since` —
 * cron 3 phút chỉ tốn 1 request thay vì quét cả inbox.
 */
export async function pancakeListConversations(
  cfg: PancakeConfig,
  since: Date,
  maxPages = 20
): Promise<Array<{ psid: string; name?: string }>> {
  const pid = cfg.pancake_page_id
  const out: Array<{ psid: string; name?: string }> = []
  const seen = new Set<string>()
  let lastId: string | null = null

  for (let page = 0; page < maxPages; page++) {
    let url = `${PANCAKE_BASE}/v2/pages/${pid}/conversations?page_access_token=${cfg.page_access_token}&type=INBOX`
    if (lastId) url += `&last_conversation_id=${lastId}`

    let d: any = null
    for (let attempt = 0; attempt < 4; attempt++) {
      if (page > 0 || attempt > 0) await sleep(attempt ? 1500 * attempt : 350)
      const r = await pancakeFetch(url)
      d = await r.json().catch(() => ({}))
      if (d?.success !== false) break
      if (!/too many requests|try again later/i.test(String(d?.message || ""))) break
    }
    if (d?.success === false) throw new Error(String(d?.message || "list conversations failed"))

    const convs: any[] = d?.conversations || []
    if (!convs.length) break

    let sawOlder = false
    for (const c of convs) {
      const ts = c?.updated_at || c?.inserted_at
      if (ts && new Date(`${ts}Z`) < since) { sawOlder = true; continue }
      const cust = (c?.customers || [])[0]
      const psid = String(cust?.fb_id || c?.from?.id || "")
      if (!psid || seen.has(psid)) continue
      seen.add(psid)
      out.push({ psid, name: String(cust?.name || c?.from?.name || "").trim() || undefined })
    }
    if (sawOlder) break

    lastId = convs[convs.length - 1]?.id
    if (!lastId) break
  }
  return out
}

export type PancakeMessage = {
  id: string
  text: string
  fromPage: boolean
  createdAt: Date
  attachments: any[]
  raw: any
}

/** Pancake trả message dạng HTML ("<div>xin chào</div>") — chat lưu plain text. */
function stripHtml(html: string): string {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/**
 * Đọc tin nhắn của 1 hội thoại từ Pancake, gồm CẢ tin page trả lời khách.
 *
 * Cần thiết vì: tin page được sale gõ trên Pancake nên Facebook không phát
 * message_echoes, còn Graph /{page}/conversations lại bị chặn trên chính các page
 * nối Pancake (OAuthException code 2) — nên Graph không kéo được gì cả. Pancake là
 * đường duy nhất lấy được tin outbound cho các page này.
 *
 * Verify 2026-07-31 (page 693411540511731): conv_id `{pancake_page_id}_{psid}` trả 200
 * với 30 message, text nằm ở `message` (HTML), `from.id === page_id` là tin của page.
 */
export async function pancakeFetchMessages(
  cfg: PancakeConfig,
  fbPageId: string,
  psid: string
): Promise<PancakeMessage[]> {
  const pid = cfg.pancake_page_id
  const cid = `${pid}_${psid}`
  const url = `${PANCAKE_BASE}/v1/pages/${pid}/conversations/${cid}/messages?page_access_token=${cfg.page_access_token}`

  let d: any = null
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(1200 * attempt)
    const r = await pancakeFetch(url)
    d = await r.json().catch(() => ({}))
    if (d?.success !== false && r.status < 500) break
  }
  if (d?.success === false) throw new Error(String(d?.message || "Pancake messages failed"))

  const out: PancakeMessage[] = []
  for (const m of d?.messages || []) {
    const attachments = m?.attachments || []
    const text = stripHtml(m?.message ?? m?.original_message ?? "")
    if (!text && !attachments.length) continue
    // Pancake id có thể thiếu — ghép khoá ổn định để ON CONFLICT chống trùng.
    const id = String(m?.id || `${cid}_${m?.inserted_at || ""}`)
    out.push({
      id,
      text: text || "[attachment]",
      fromPage: String(m?.from?.id || "") === String(fbPageId),
      createdAt: m?.inserted_at ? new Date(`${m.inserted_at}Z`) : new Date(),
      attachments,
      raw: m,
    })
  }
  // Cũ trước, mới sau — khớp thứ tự lưu của luồng Graph.
  out.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  return out
}

/** Scan the page's INBOX conversations (paginated) to find the one whose customer fb_id == psid. */
async function findConversationIdByPsid(cfg: PancakeConfig, psid: string): Promise<string | null> {
  const pid = cfg.pancake_page_id
  const token = cfg.page_access_token
  let lastId: string | null = null
  for (let page = 0; page < 10; page++) {
    let url = `${PANCAKE_BASE}/v2/pages/${pid}/conversations?page_access_token=${token}&type=INBOX`
    if (lastId) url += `&last_conversation_id=${lastId}`
    const r = await pancakeFetch(url)
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
