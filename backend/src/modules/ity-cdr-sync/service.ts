import { MedusaService } from "@medusajs/framework/utils"
import ItyCdrCall from "./models/ity-cdr-call"
import ItyCdrSyncJob from "./models/ity-cdr-sync-job"
import ItyExtensionMap from "./models/ity-extension-map"
import { ITY_CDR_API_BASE, ITY_CDR_USERNAME, ITY_CDR_PASSWORD } from "../../lib/constants"

// ---- Helpers ----

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function basicAuthHeader(): string {
  return "Basic " + Buffer.from(`${ITY_CDR_USERNAME}:${ITY_CDR_PASSWORD}`).toString("base64")
}

async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
  let lastErr: Error | undefined
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    try {
      const res = await fetch(url, {
        headers: { Authorization: basicAuthHeader() },
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout))
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("Retry-After") || "5", 10)
        console.warn(`[ItyCdrSync] Rate limited, waiting ${retryAfter}s...`)
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
        console.warn(`[ItyCdrSync] Request failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${backoff}ms`)
        await delay(backoff)
      }
    }
  }
  throw lastErr ?? new Error("Unknown fetch error")
}

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// ITY trả calldate dạng "YYYY-MM-DD HH:mm:ss" theo giờ VN (+07:00), không có timezone suffix.
// Node parse chuỗi không suffix là UTC → phải gắn rõ +07:00 để convert đúng sang UTC khi lưu,
// nếu không giờ hiển thị sẽ lệch 7 tiếng (cuộc gọi "trong tương lai" so với giờ VN thật).
function parseItyCalldate(raw: string | undefined): Date {
  if (!raw) return new Date()
  return new Date(raw.replace(" ", "T") + "+07:00")
}

function mapCdr(raw: any): Record<string, any> {
  return {
    id: String(raw.uniqueid),
    calldate: parseItyCalldate(raw.calldate),
    direction: raw.direction ?? "",
    extension: raw.cnum ?? raw.src ?? "",
    agent_name: raw.cnam ?? raw.clid ?? "",
    customer_phone: raw.dst ?? "",
    duration: Number(raw.duration ?? 0),
    billsec: Number(raw.billsec ?? 0),
    disposition: raw.disposition ?? "",
    recording_url: raw.recordingfile ?? null,
    raw,
    synced_at: new Date(),
  }
}

// ---- Service ----

class ItyCdrSyncService extends MedusaService({ ItyCdrCall, ItyCdrSyncJob, ItyExtensionMap }) {
  /**
   * Pull toàn bộ CDR trong khoảng ngày [from, to] (inclusive, theo từng ngày riêng lẻ
   * vì API ITY chỉ filter được theo 1 `date` cụ thể, không có range thật).
   * Chạy async — trả về jobId ngay để caller poll status.
   */
  async pullByDateRange(from: Date, to: Date): Promise<{ jobId: string }> {
    await this._cleanupZombieJobs()

    const recentRunning = await this.listItyCdrSyncJobs(
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

    const job = await this.createItyCdrSyncJobs({
      status: "queued",
      from_date: from,
      to_date: to,
    })
    const jobId = job.id

    this._executeSync(jobId, from, to).catch((err) => {
      console.error(`[ItyCdrSync] Job ${jobId} failed:`, err.message)
    })

    return { jobId }
  }

  private async _cleanupZombieJobs(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - 30 * 60 * 1000)
      const zombies = await this.listItyCdrSyncJobs(
        {
          status: { $in: ["queued", "running"] } as any,
          started_at: { $lt: cutoff } as any,
        } as any,
        { take: 50 }
      )
      for (const z of zombies as any[]) {
        await this.updateItyCdrSyncJobs({
          id: z.id,
          status: "failed",
          finished_at: new Date(),
          error: "Backend restarted before sync finished (zombie cleanup)",
        } as any)
        console.warn(`[ItyCdrSync] Cleaned zombie job ${z.id} (started ${z.started_at})`)
      }
    } catch (err: any) {
      console.warn(`[ItyCdrSync] Zombie cleanup failed: ${err.message}`)
    }
  }

  private async _executeSync(jobId: string, from: Date, to: Date): Promise<void> {
    const startedAt = Date.now()
    const errors: Array<{ message: string }> = []
    let imported = 0
    let updated = 0
    let daysSynced = 0

    await this.updateItyCdrSyncJobs({
      id: jobId,
      status: "running",
      started_at: new Date(),
    })

    try {
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        const dateStr = toYmd(d)
        try {
          const { imported: dayImported, updated: dayUpdated } = await this._pullDay(dateStr)
          imported += dayImported
          updated += dayUpdated
          daysSynced++
          console.log(`[ItyCdrSync] Day ${dateStr} done — imported=${dayImported} updated=${dayUpdated}`)
        } catch (dayErr: any) {
          console.error(`[ItyCdrSync] Day ${dateStr} failed:`, dayErr.message)
          errors.push({ message: `${dateStr}: ${dayErr.message}` })
        }

        try {
          await this.updateItyCdrSyncJobs({
            id: jobId,
            stats: {
              imported,
              updated,
              days_synced: daysSynced,
              errors: errors.slice(0, 100),
              duration_ms: Date.now() - startedAt,
            },
          } as any)
        } catch {}

        await delay(300)
      }
    } finally {
      await this.updateItyCdrSyncJobs({
        id: jobId,
        status: errors.length > 0 && imported === 0 && updated === 0 ? "failed" : "done",
        finished_at: new Date(),
        stats: {
          imported,
          updated,
          days_synced: daysSynced,
          errors: errors.slice(0, 100),
          duration_ms: Date.now() - startedAt,
        },
        ...(errors.length > 0 && imported === 0 && updated === 0
          ? { error: errors[0]?.message ?? "Unknown error" }
          : {}),
      })
    }
  }

  /**
   * Pull toàn bộ record của 1 ngày, phân trang tới khi API trả mảng rỗng
   * (API ITY không trả total_pages — dừng khi `cdr.length === 0`, limit tối đa 30/page).
   */
  private async _pullDay(dateStr: string): Promise<{ imported: number; updated: number }> {
    const pageSize = 30
    let page = 0
    let imported = 0
    let updated = 0

    while (true) {
      const url = `${ITY_CDR_API_BASE}?action=query_cdr&date=${dateStr}&limit=${pageSize}&page=${page}`
      const res = await fetchWithRetry(url)
      const body: any = await res.json()
      const records: any[] = body.cdr ?? []

      if (records.length === 0) break

      for (const raw of records) {
        try {
          if (!raw.uniqueid) continue
          const mapped = mapCdr(raw)
          const existing = await this.listItyCdrCalls({ id: mapped.id }, { take: 1 })
          if (existing.length > 0) {
            await this.updateItyCdrCalls(mapped as any)
            updated++
          } else {
            await this.createItyCdrCalls([mapped] as any)
            imported++
          }
        } catch (recErr: any) {
          console.error(`[ItyCdrSync] Error upserting call ${raw.uniqueid}:`, recErr.message)
        }
      }

      if (records.length < pageSize) break
      page++
      await delay(150)
    }

    return { imported, updated }
  }
}

export default ItyCdrSyncService
