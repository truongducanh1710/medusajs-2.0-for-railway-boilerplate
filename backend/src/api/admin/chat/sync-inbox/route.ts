import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ensureChatTables, getChatAuthInfo, getChatPool, pullPageInbox } from "../_lib"

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

async function runSyncJob(jobId: string, pages: any[], days: number, scope: any) {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000)
  const job = jobs.get(jobId)!

  for (const page of pages) {
    const r = await pullPageInbox(page.page_id, page.page_name, page.access_token, since, scope).catch(e => ({
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
    runSyncJob(jobId, pages, days, req.scope).catch(e => {
      job.status = "error"
      job.error = e.message
      job.finishedAt = new Date().toISOString()
    })

    return res.json({ ok: true, jobId, status: "running", pages_count: pages.length, days, message: "Đang sync background. Poll GET /admin/chat/sync-inbox để xem tiến độ." })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
