import { MedusaService } from "@medusajs/framework/utils"
import { createHmac } from "crypto"
import DohanaVideo from "./models/dohana-video"
import DohanaSyncJob from "./models/dohana-sync-job"

export const DOHANA_API_BASE = "https://be.dhn.io.vn/dpm/v1"

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Dohana free tier: 2 RPS / 100 req ngày — cần backoff dài hơn nhiều so với Pancake.
 */
export async function fetchWithRetry(url: string, apiKey: string, retries = 3): Promise<Response> {
  let lastErr: Error | undefined
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "x-api-key": apiKey },
      }).finally(() => clearTimeout(timeout))
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("Retry-After") || "5", 10)
        console.warn(`[DohanaSync] Rate limited, waiting ${retryAfter}s...`)
        await delay(retryAfter * 1000)
        continue
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "")
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`)
      }
      return res
    } catch (err: any) {
      lastErr = err
      if (attempt < retries) {
        const backoff = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 10_000)
        console.warn(`[DohanaSync] Request failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${backoff}ms`)
        await delay(backoff)
      }
    }
  }
  throw lastErr ?? new Error("Unknown fetch error")
}

export function mapDohanaVideo(raw: any): Record<string, any> {
  return {
    id: String(raw.id || ""),
    store_id: raw.storeId ?? "",
    order_code: raw.orderCode ?? "",
    prepare_code: raw.prepareCode ?? "",
    type: raw.type ?? "",
    status: raw.status ?? "",
    slug: raw.slug ?? "",
    duration: raw.duration ?? 0,
    start_time: raw.startTime ? new Date(raw.startTime) : null,
    user_email: raw.user?.email ?? "",
    user_name: [raw.user?.firstName, raw.user?.lastName].filter(Boolean).join(" "),
    drive_link: raw.driveLink ?? null,
    deleted_timeline: raw.deletedTimeline ? new Date(raw.deletedTimeline) : null,
    raw,
    synced_at: new Date(),
  }
}

class DohanaSyncService extends MedusaService({ DohanaVideo, DohanaSyncJob }) {
  /**
   * Tạo job và chạy sync bất đồng bộ (fire-and-forget), trả về jobId để poll status.
   */
  async pullByDateRange(
    from: Date,
    to: Date,
    opts?: { apiKey?: string; type?: string }
  ): Promise<{ jobId: string }> {
    await this._cleanupZombieJobs()

    const recentRunning = await this.listDohanaSyncJobs(
      {
        status: { $in: ["queued", "running"] } as any,
        started_at: { $gte: new Date(Date.now() - 30 * 60 * 1000) } as any,
      } as any,
      { take: 1 }
    )
    if (recentRunning.length > 0) {
      const existing = recentRunning[0] as any
      throw Object.assign(
        new Error(`SYNC_IN_PROGRESS: Đã có job ${existing.id} đang chạy (status=${existing.status})`),
        { code: "SYNC_IN_PROGRESS", existingJobId: existing.id }
      )
    }

    const job = await this.createDohanaSyncJobs({
      status: "queued",
      from_date: from,
      to_date: to,
    })
    const jobId = job.id

    this._executeSync(jobId, from, to, opts).catch((err) => {
      console.error(`[DohanaSync] Job ${jobId} failed:`, err.message)
    })

    return { jobId }
  }

  private async _cleanupZombieJobs(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - 30 * 60 * 1000)
      const zombies = await this.listDohanaSyncJobs(
        {
          status: { $in: ["queued", "running"] } as any,
          started_at: { $lt: cutoff } as any,
        } as any,
        { take: 50 }
      )
      for (const z of zombies as any[]) {
        await this.updateDohanaSyncJobs({
          id: z.id,
          status: "failed",
          finished_at: new Date(),
          error: "Backend restarted before sync finished (zombie cleanup)",
        } as any)
        console.warn(`[DohanaSync] Cleaned zombie job ${z.id} (started ${z.started_at})`)
      }
    } catch (err: any) {
      console.warn(`[DohanaSync] Zombie cleanup failed: ${err.message}`)
    }
  }

  private async _executeSync(
    jobId: string,
    from: Date,
    to: Date,
    opts?: { apiKey?: string; type?: string }
  ): Promise<void> {
    const apiKey = opts?.apiKey ?? process.env.DOHANA_API_KEY ?? ""
    const startedAt = Date.now()
    const errors: Array<{ videoId?: string; message: string }> = []
    const failedPages: number[] = []
    let imported = 0
    let updated = 0
    let page = 0
    let totalPages = 1
    let mgr: any

    try {
      mgr = (this as any).__container?.manager
      if (mgr) {
        const [lockResult] = await mgr.execute(`SELECT pg_try_advisory_lock(hashtext('dohana-sync')) as locked`)
        if (!lockResult?.locked) {
          await this.updateDohanaSyncJobs({
            id: jobId,
            status: "failed",
            finished_at: new Date(),
            error: "SYNC_IN_PROGRESS: Another sync job is already running",
          })
          return
        }
      }

      await this.updateDohanaSyncJobs({ id: jobId, status: "running", started_at: new Date() })

      const limit = 100

      while (page < totalPages) {
        try {
          const params = new URLSearchParams({
            page: String(page),
            limit: String(limit),
            type: opts?.type ?? "package",
            from: from.toISOString(),
            to: to.toISOString(),
          })
          const url = `${DOHANA_API_BASE}/partner/video/search?${params.toString()}`
          const res = await fetchWithRetry(url, apiKey)
          const body: any = await res.json()

          const videos: any[] = body.data ?? []
          const total: number = body.total ?? 0
          totalPages = Math.max(1, Math.ceil(total / limit))

          for (const raw of videos) {
            try {
              const mapped = mapDohanaVideo(raw)
              if (!mapped.id) continue

              const existing = await (this as any).listDohanaVideos({ id: mapped.id }, { take: 1 })
              if (existing.length > 0) {
                await (this as any).updateDohanaVideos(mapped)
                updated++
              } else {
                await (this as any).createDohanaVideos([mapped])
                imported++
              }
            } catch (videoErr: any) {
              console.error(`[DohanaSync] Error upserting video ${raw.id}:`, videoErr.message)
              errors.push({ videoId: String(raw.id ?? ""), message: videoErr.message })
            }
          }

          try {
            await this.updateDohanaSyncJobs({
              id: jobId,
              stats: {
                imported,
                updated,
                current_page: page,
                total_pages: totalPages,
                failed_pages: failedPages,
                errors: errors.slice(0, 100),
                duration_ms: Date.now() - startedAt,
              },
            } as any)
          } catch {}

          console.log(`[DohanaSync] Page ${page}/${totalPages - 1} done — imported=${imported} updated=${updated}`)

          if (page < totalPages - 1) {
            await delay(600) // rate limit buffer — Dohana free tier chỉ 2 RPS
          }
        } catch (pageErr: any) {
          console.error(`[DohanaSync] Page ${page} failed:`, pageErr.message)
          failedPages.push(page)
          errors.push({ message: `Page ${page}: ${pageErr.message}` })
        }

        page++
      }

      if (mgr) {
        await mgr.execute(`SELECT pg_advisory_unlock(hashtext('dohana-sync'))`)
      }
    } finally {
      const durationMs = Date.now() - startedAt
      await this.updateDohanaSyncJobs({
        id: jobId,
        status: errors.length > 0 && imported === 0 && updated === 0 ? "failed" : "done",
        finished_at: new Date(),
        stats: {
          imported,
          updated,
          current_page: page - 1,
          total_pages: totalPages,
          failed_pages: failedPages,
          errors: errors.slice(0, 100),
          duration_ms: durationMs,
        },
        ...(errors.length > 0 && imported === 0 && updated === 0
          ? { error: errors[0]?.message ?? "Unknown error" }
          : {}),
      })
    }
  }

  /**
   * Pull video mới trong N giờ gần nhất — dùng cho cron incremental (bù trường hợp miss webhook).
   */
  async pullRecent(hoursBack = 2): Promise<{ imported: number; updated: number; errors: number }> {
    const to = new Date()
    const from = new Date(to.getTime() - hoursBack * 3600_000)
    const { jobId } = await this.pullByDateRange(from, to)

    // Đợi job hoàn tất (cron chạy độc lập, không cần trả UI ngay) trước khi log kết quả.
    for (let i = 0; i < 60; i++) {
      await delay(2000)
      const jobs = await this.listDohanaSyncJobs({ id: jobId }, { take: 1 })
      const job = jobs[0] as any
      if (!job) break
      if (job.status === "done" || job.status === "failed") {
        return {
          imported: job.stats?.imported ?? 0,
          updated: job.stats?.updated ?? 0,
          errors: job.stats?.errors?.length ?? 0,
        }
      }
    }
    return { imported: 0, updated: 0, errors: 0 }
  }

  /**
   * Fetch chi tiết 1 video theo slug và upsert — dùng khi webhook video.create báo có video mới.
   */
  async fetchAndUpsertBySlug(slug: string): Promise<void> {
    const apiKey = process.env.DOHANA_API_KEY ?? ""
    const url = `${DOHANA_API_BASE}/partner/video/${slug}`
    const res = await fetchWithRetry(url, apiKey, 2)
    const body: any = await res.json()
    const raw = body?.video
    if (!raw?.id) return

    const mapped = mapDohanaVideo(raw)
    const existing = await (this as any).listDohanaVideos({ id: mapped.id }, { take: 1 })
    if (existing.length > 0) {
      await (this as any).updateDohanaVideos(mapped)
    } else {
      await (this as any).createDohanaVideos([mapped])
    }
  }

  /**
   * Verify header x-dhn-sign gửi kèm webhook Dohana — HMAC-SHA256(body, verifyKey).
   * Verify key do người dùng tự đặt lúc cấu hình webhook trên Dohana dashboard.
   */
  verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
    const verifyKey = process.env.DOHANA_WEBHOOK_VERIFY_KEY || ""
    if (!verifyKey) return true
    if (!signature) return false
    try {
      const computed = createHmac("sha256", verifyKey).update(rawBody).digest("hex")
      return computed === signature
    } catch {
      return false
    }
  }
}

export default DohanaSyncService
