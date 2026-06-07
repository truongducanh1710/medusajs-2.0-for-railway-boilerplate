import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ensureChatTables, getChatAuthInfo, getChatPool, upsertIncomingMessage } from "../_lib"

const FB_VERSION = "v20.0"

async function fbGet(path: string, token: string) {
  const url = `https://graph.facebook.com/${FB_VERSION}${path}${path.includes("?") ? "&" : "?"}access_token=${token}`
  const r = await fetch(url)
  const d = await r.json()
  if (d?.error) throw new Error(`FB API: ${d.error.message} (code ${d.error.code})`)
  return d
}

/**
 * Pull conversations từ một page.
 * FB Conversations API: GET /{page-id}/conversations?fields=participants,messages{message,from,created_time,id}
 * Trả về danh sách conversation kèm messages mới nhất.
 */
async function pullPageInbox(
  pageId: string,
  pageName: string,
  token: string,
  since?: Date
): Promise<{ saved: number; skipped: number; errors: string[] }> {
  let saved = 0
  let skipped = 0
  const errors: string[] = []
  const sinceTs = since ? Math.floor(since.getTime() / 1000) : Math.floor(Date.now() / 1000) - 7 * 24 * 3600

  // Lấy danh sách conversations (mặc định 25 conv mới nhất có messages)
  let convUrl = `/${pageId}/conversations?fields=participants,updated_time&limit=25`
  if (sinceTs) convUrl += `&since=${sinceTs}`

  let convData: any
  try {
    convData = await fbGet(convUrl, token)
  } catch (e: any) {
    errors.push(`Lấy conversations thất bại: ${e.message}`)
    return { saved, skipped, errors }
  }

  const conversations = convData?.data || []

  for (const conv of conversations) {
    const convId = conv.id
    // Tìm PSID của người dùng (không phải page)
    const participants: any[] = conv.participants?.data || []
    const customer = participants.find((p: any) => p.id !== pageId)
    if (!customer) { skipped++; continue }
    const psid = customer.id
    const customerName = customer.name || undefined

    // Lấy messages của conversation này
    let msgsData: any
    try {
      msgsData = await fbGet(
        `/${convId}/messages?fields=id,message,from,created_time,attachments&limit=50`,
        token
      )
    } catch (e: any) {
      errors.push(`Conv ${convId}: lấy messages thất bại: ${e.message}`)
      skipped++
      continue
    }

    const messages: any[] = msgsData?.data || []
    // messages trả về newest first — xử lý theo thứ tự cũ → mới
    const ordered = [...messages].reverse()

    for (const msg of ordered) {
      const text = (msg.message || "").trim()
      const msgId = msg.id
      const createdAt = msg.created_time ? new Date(msg.created_time) : new Date()
      const fromId = msg.from?.id
      const isFromPage = fromId === pageId

      if (!text && !(msg.attachments?.data?.length)) { skipped++; continue }

      try {
        if (isFromPage) {
          // Tin nhắn từ page (outbound) — upsert trực tiếp vào DB, không chạy bot
          const pool = getChatPool()
          await ensureChatTables(pool)
          // Đảm bảo conversation tồn tại trước
          await pool.query(
            `INSERT INTO fb_conversation (page_id, page_name, customer_psid, customer_name, status, last_message, last_message_at)
             VALUES ($1,$2,$3,$4,'new',$5,$6)
             ON CONFLICT (page_id, customer_psid) DO UPDATE SET
               customer_name = COALESCE(EXCLUDED.customer_name, fb_conversation.customer_name),
               updated_at = now()`,
            [pageId, pageName, psid, customerName || null, text || "[attachment]", createdAt]
          )
          const convRow = await pool.query(
            `SELECT id FROM fb_conversation WHERE page_id=$1 AND customer_psid=$2`, [pageId, psid]
          )
          const dbConvId = convRow.rows[0]?.id
          if (dbConvId) {
            await pool.query(
              `INSERT INTO fb_message (conversation_id, fb_message_id, direction, sender_type, text, created_at)
               VALUES ($1,$2,'outbound','page',$3,$4)
               ON CONFLICT (fb_message_id) DO NOTHING`,
              [dbConvId, msgId, text || "[attachment]", createdAt]
            )
          }
          saved++
        } else {
          // Tin nhắn từ khách (inbound)
          const pool = getChatPool()
          // Cập nhật customer_name nếu có
          if (customerName) {
            await pool.query(
              `UPDATE fb_conversation SET customer_name = $3, updated_at = now()
               WHERE page_id = $1 AND customer_psid = $2 AND customer_name IS NULL`,
              [pageId, psid, customerName]
            )
          }
          await upsertIncomingMessage({
            pageId,
            psid,
            text: text || "[attachment]",
            fbMessageId: msgId,
            attachments: msg.attachments?.data || [],
            raw: msg,
            createdAt,
          })
          saved++
        }
      } catch (e: any) {
        errors.push(`Msg ${msgId}: ${e.message}`)
        skipped++
      }
    }
  }

  return { saved, skipped, errors }
}

/**
 * POST /admin/chat/sync-inbox
 * Body: { page_id?: string, days?: number }
 * - page_id: chỉ sync 1 page, không có thì sync tất cả
 * - days: số ngày lấy về (mặc định 7)
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const body = (req.body as any) || {}
    const days = Math.min(parseInt(body.days || "7", 10), 30)
    const since = new Date(Date.now() - days * 24 * 3600 * 1000)

    const pool = getChatPool()
    await ensureChatTables(pool)

    // Lấy page tokens
    let pagesQuery = `SELECT page_id, page_name, access_token FROM fb_page_token WHERE access_token IS NOT NULL`
    const pagesParams: any[] = []
    if (body.page_id) {
      pagesQuery += ` AND page_id = $1`
      pagesParams.push(body.page_id)
    } else if (auth.fbPageIds?.length) {
      pagesQuery += ` AND page_id = ANY($1)`
      pagesParams.push(auth.fbPageIds)
    }

    const { rows: pages } = await pool.query(pagesQuery, pagesParams)
    if (!pages.length) return res.status(404).json({ error: "Không tìm thấy page token" })

    const results: Record<string, any> = {}
    let totalSaved = 0
    let totalErrors = 0

    for (const page of pages) {
      const r = await pullPageInbox(page.page_id, page.page_name, page.access_token, since)
      results[page.page_name] = r
      totalSaved += r.saved
      totalErrors += r.errors.length
    }

    return res.json({
      ok: true,
      pages_synced: pages.length,
      total_saved: totalSaved,
      total_errors: totalErrors,
      days,
      results,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
