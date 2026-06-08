import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ensureChatTables, getChatAuthInfo, getChatPool, upsertIncomingMessage } from "../_lib"

const FB_VERSION = "v20.0"

// In-memory job state (đủ dùng cho 1 instance Railway)
type SyncJob = {
  status: "running" | "done" | "error"
  startedAt: string
  finishedAt?: string
  pages_synced: number
  total_saved: number
  total_errors: number
  results: Record<string, { saved: number; skipped: number; errors: string[] }>
  error?: string
}
const jobs = new Map<string, SyncJob>()
let currentJobId: string | null = null

async function fbGet(path: string, token: string) {
  const url = `https://graph.facebook.com/${FB_VERSION}${path}${path.includes("?") ? "&" : "?"}access_token=${token}`
  const r = await fetch(url)
  const d = await r.json()
  if (d?.error) throw new Error(`FB API: ${d.error.message} (code ${d.error.code})`)
  return d
}

async function pullPageInbox(
  pageId: string,
  pageName: string,
  token: string,
  since: Date
): Promise<{ saved: number; skipped: number; errors: string[] }> {
  let saved = 0, skipped = 0
  const errors: string[] = []
  const sinceTs = Math.floor(since.getTime() / 1000)

  let convData: any
  try {
    convData = await fbGet(`/${pageId}/conversations?fields=participants,updated_time&limit=25&since=${sinceTs}`, token)
  } catch (e: any) {
    errors.push(`Lấy conversations thất bại: ${e.message}`)
    return { saved, skipped, errors }
  }

  const conversations = convData?.data || []
  const pool = getChatPool()

  for (const conv of conversations) {
    const convId = conv.id
    const participants: any[] = conv.participants?.data || []
    const customer = participants.find((p: any) => p.id !== pageId)
    if (!customer) { skipped++; continue }
    const psid = customer.id
    const customerName = customer.name || undefined

    let msgsData: any
    try {
      msgsData = await fbGet(
        `/${convId}/messages?fields=id,message,from,created_time,attachments&limit=50`,
        token
      )
    } catch (e: any) {
      errors.push(`Conv ${convId}: ${e.message}`)
      skipped++
      continue
    }

    const messages: any[] = [...(msgsData?.data || [])].reverse() // oldest first

    for (const msg of messages) {
      const text = (msg.message || "").trim()
      const msgId = msg.id
      const createdAt = msg.created_time ? new Date(msg.created_time) : new Date()
      const isFromPage = msg.from?.id === pageId

      try {
        if (isFromPage) {
          await ensureChatTables(pool)
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
          if (dbConvId && msgId) {
            await pool.query(
              `INSERT INTO fb_message (conversation_id, fb_message_id, direction, sender_type, text, attachments, created_at)
               VALUES ($1,$2,'outbound','page',$3,$4,$5)
               ON CONFLICT (fb_message_id) DO NOTHING`,
              [dbConvId, msgId, text || "[attachment]", JSON.stringify(msg.attachments?.data || []), createdAt]
            )
          }
          saved++
        } else {
          await upsertIncomingMessage({
            pageId, psid,
            customerName: customerName || undefined,
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

async function runSyncJob(jobId: string, pages: any[], days: number) {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000)
  const job = jobs.get(jobId)!

  for (const page of pages) {
    const r = await pullPageInbox(page.page_id, page.page_name, page.access_token, since).catch(e => ({
      saved: 0, skipped: 0, errors: [e.message]
    }))
    job.results[page.page_name] = r
    job.pages_synced++
    job.total_saved += r.saved
    job.total_errors += r.errors.length
  }

  job.status = "done"
  job.finishedAt = new Date().toISOString()
}

/**
 * POST /admin/chat/sync-inbox — khởi động sync background, trả về jobId ngay
 * GET  /admin/chat/sync-inbox — poll trạng thái job hiện tại
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getChatAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthenticated" })

  if (!currentJobId) return res.json({ status: "idle" })
  const job = jobs.get(currentJobId)
  if (!job) return res.json({ status: "idle" })
  return res.json({ jobId: currentJobId, ...job })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const body = (req.body as any) || {}
    const days = Math.min(parseInt(body.days || "7", 10), 30)

    const pool = getChatPool()
    await ensureChatTables(pool)

    let pagesQuery = `SELECT page_id, page_name, access_token FROM fb_page_token WHERE access_token IS NOT NULL ORDER BY page_name`
    const pagesParams: any[] = []
    if (body.page_id) {
      pagesQuery = `SELECT page_id, page_name, access_token FROM fb_page_token WHERE access_token IS NOT NULL AND page_id=$1`
      pagesParams.push(body.page_id)
    } else if (auth.fbPageIds?.length) {
      pagesQuery = `SELECT page_id, page_name, access_token FROM fb_page_token WHERE access_token IS NOT NULL AND page_id=ANY($1) ORDER BY page_name`
      pagesParams.push(auth.fbPageIds)
    }

    const { rows: pages } = await pool.query(pagesQuery, pagesParams)
    if (!pages.length) return res.status(404).json({ error: "Không tìm thấy page token" })

    // Nếu đang có job chạy, trả về job đó
    if (currentJobId) {
      const running = jobs.get(currentJobId)
      if (running?.status === "running") {
        return res.json({ ok: true, jobId: currentJobId, status: "running", message: "Đang sync, poll GET để kiểm tra tiến độ" })
      }
    }

    const jobId = `sync_${Date.now()}`
    currentJobId = jobId
    const job: SyncJob = {
      status: "running",
      startedAt: new Date().toISOString(),
      pages_synced: 0,
      total_saved: 0,
      total_errors: 0,
      results: {},
    }
    jobs.set(jobId, job)

    // Chạy background — không await
    runSyncJob(jobId, pages, days).catch(e => {
      job.status = "error"
      job.error = e.message
      job.finishedAt = new Date().toISOString()
    })

    return res.json({ ok: true, jobId, status: "running", pages_count: pages.length, days, message: "Đang sync background. Poll GET /admin/chat/sync-inbox để xem tiến độ." })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
