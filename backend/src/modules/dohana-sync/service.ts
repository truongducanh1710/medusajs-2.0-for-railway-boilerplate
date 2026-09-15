import { MedusaService } from "@medusajs/framework/utils"
import { createHmac } from "crypto"
import { Pool } from "pg"
import DohanaVideo from "./models/dohana-video"
import DohanaSyncJob from "./models/dohana-sync-job"

// Pool riêng cho truy vấn SQL thô. __container.manager KHÔNG dùng được ở các method gọi
// từ webhook/route (chỉ có trong ngữ cảnh job của _executeSync), nên tra pancake_order
// phải đi đường này — giống mọi route khác trong dự án.
let _sqlPool: Pool | null = null
function sqlPool(): Pool {
  if (!_sqlPool) _sqlPool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _sqlPool
}

// Dohana đổi domain API 14/09/2026 (be.dhn.io.vn → openapi.dhn.io.vn). Domain cũ vẫn
// trỏ về cùng backend nên chưa chết, nhưng dùng link chính thức để khỏi hỏng khi họ tắt.
// Cho phép ghi đè bằng env để lần đổi sau không phải deploy lại.
export const DOHANA_API_BASE =
  process.env.DOHANA_API_BASE || "https://openapi.dhn.io.vn/dpm/v1"

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Dohana free tier: 2 RPS / 100 req ngày — 429 rất dễ gặp khi phân trang nhanh,
 * nên dùng budget retry riêng cho rate-limit (không tính chung với lỗi network).
 */
export async function fetchWithRetry(
  url: string,
  apiKey: string,
  retries = 3,
  maxRateLimitRetries = 10
): Promise<Response> {
  let lastErr: Error | undefined
  let rateLimitAttempts = 0
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "x-api-key": apiKey,
          // BẮT BUỘC: be.dhn.io.vn đứng sau Cloudflare, request không có User-Agent bị
          // chặn bằng "error code: 1010" (403) trước khi tới API — khi đó không đọc được
          // lỗi thật của Dohana, chỉ thấy 403 trống nghĩa.
          "User-Agent": "PhanVietSync/1.0 (+https://api.phanviet.vn)",
          Accept: "application/json",
        },
      }).finally(() => clearTimeout(timeout))
      if (res.status === 429) {
        rateLimitAttempts++
        if (rateLimitAttempts > maxRateLimitRetries) {
          throw new Error(`HTTP 429: rate limited quá ${maxRateLimitRetries} lần liên tiếp`)
        }
        // Free tier Dohana trả Retry-After rất ngắn (1s) — không đủ nếu request kế tiếp
        // lại dồn dập ngay khi hết cửa sổ. Đặt sàn tối thiểu 3s để tránh 429 liên tục.
        const retryAfter = Math.max(parseInt(res.headers.get("Retry-After") || "5", 10), 3)
        console.warn(`[DohanaSync] Rate limited (${rateLimitAttempts}/${maxRateLimitRetries}), waiting ${retryAfter}s...`)
        await delay(retryAfter * 1000)
        attempt-- // không tính 429 vào budget retry lỗi network
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
        console.warn(`[DohanaSync] Request failed (attempt ${attempt + 1}/${retries + 1}): ${err.message} — retrying in ${backoff}ms`)
        await delay(backoff)
      }
    }
  }
  throw lastErr ?? new Error(`Hết ${retries + 1} lần thử, không rõ nguyên nhân`)
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
            await delay(1500) // rate limit buffer — Dohana free tier chỉ 2 RPS, cần buffer rộng
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
    // 10 phút: quét 24h có thể tới ~34 trang, mỗi trang nghỉ 1,5s để né rate limit, chưa
    // kể các lần lùi 3s+ khi gặp 429 — mốc 2 phút cũ luôn hết giờ trước khi job xong nên
    // log báo imported=0 dù job thực tế vẫn đang chạy và có thể thành công.
    for (let i = 0; i < 300; i++) {
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
   * Hàng hoàn đã về kho: đẩy đơn Pancake từ "Đang hoàn về" (4) sang "Đã hoàn về kho" (5).
   *
   * Kho quay video "nhập hàng hoàn" khi nhận lại hàng, nên video type=inbound là BẰNG
   * CHỨNG VẬT LÝ hàng đã nằm trong kho. Pancake không tự đổi status trong trường hợp này
   * — hiện ~2.500 đơn kẹt ở status 4, làm sai lệch báo cáo lẫn tồn kho.
   *
   * Không có nguồn nào khác thay thế được: `partner.extend_update` của Pancake chỉ lưu
   * vài mốc đầu hành trình (dừng ở "đến kho phân loại"), đơn Shopee không có trường này,
   * còn đơn PKE thì action_code toàn null — đã kiểm 25 đơn mẫu.
   *
   * ĐẨY LÊN POS chứ không sửa thẳng DB: POS là nguồn sự thật, sửa DB sẽ bị ghi đè ở lần
   * sync sau. Sau khi POS đổi, webhook Pancake tự bắn về cập nhật DB (đã đo: ~6 giây).
   *
   * Chỉ đụng vào đơn đang ở đúng status 4. Mọi trạng thái khác bỏ qua — video nhập hoàn
   * không phải lý do để đổi một đơn đã giao thành công hay đã huỷ.
   */
  /**
   * Xem trước cho markReturnedByOrderCode: tra đơn và nói rõ SẼ đổi hay không, nhưng
   * KHÔNG ghi gì lên POS. Dùng cho chế độ dry-run khi xử lý hàng loạt đơn tồn đọng —
   * xử lý ~2.500 đơn mà không xem trước thì sai một nhịp là hỏng hàng loạt.
   */
  async xemTruocHangHoan(
    orderCode: string,
  ): Promise<{ se_doi: boolean; reason: string; don_id?: string; status?: number }> {
    const ma = String(orderCode || "").trim()
    if (!ma) return { se_doi: false, reason: "Thiếu mã đơn" }

    // Dohana ghi orderCode theo mã hãng ship in trên vận đơn, mà mã đó KHÔNG phải lúc
    // nào cũng là tracking_code bên Pancake:
    //   - Đơn sàn (TikTok 862..., Shopee SPX...) → trùng tracking_code
    //   - Đơn Pancake tự giao → Dohana ghi mã NGẮN (PKE1513317474, 13 ký tự) còn
    //     tracking_code là mã DÀI (PKE90085132227588, 18 ký tự). Mã ngắn nằm ở
    //     raw.partner.order_number_vtp — đã đối chiếu 4/4 mẫu.
    // Thiếu nhánh thứ hai thì 31/91 video nhập hoàn (toàn bộ đơn PKE) không khớp được.
    const r = await sqlPool().query(
      `SELECT id, status, source, raw->>'id' AS pos_id
         FROM pancake_order
        WHERE deleted_at IS NULL
          AND (
                upper(trim(tracking_code)) = upper(trim($1))
             OR upper(trim(COALESCE(raw->'partner'->>'order_number_vtp',''))) = upper(trim($1))
          )
        LIMIT 1`,
      [ma],
    )
    const don = r.rows[0]
    if (!don) return { se_doi: false, reason: `Không tìm thấy đơn có mã vận đơn ${ma}` }

    const st = Number(don.status)
    if (st === 5) return { se_doi: false, reason: "Đã là 'Đã hoàn về kho'", don_id: don.id, status: st }
    if (st !== 4) {
      return { se_doi: false, reason: `Đang ở status ${st}, không phải "đang hoàn về"`, don_id: don.id, status: st }
    }
    if (!don.pos_id) {
      return { se_doi: false, reason: "Đơn không có pos_id để gọi Pancake", don_id: don.id, status: st }
    }
    return { se_doi: true, reason: "SẼ chuyển 4 → 5 (Đã hoàn về kho)", don_id: don.id, status: st }
  }

  async markReturnedByOrderCode(
    orderCode: string,
  ): Promise<{ updated: boolean; reason: string; posId?: string }> {
    const ma = String(orderCode || "").trim()
    if (!ma) return { updated: false, reason: "Thiếu mã đơn" }

    const apiKey = process.env.PANCAKE_API_KEY || ""
    const shopId = process.env.PANCAKE_SHOP_ID || ""
    if (!apiKey || !shopId) {
      return { updated: false, reason: "Chưa cấu hình PANCAKE_API_KEY / PANCAKE_SHOP_ID" }
    }

    // Video Dohana mang MÃ VẬN ĐƠN của hãng ship, khớp với tracking_code bên Pancake.
    const r = await sqlPool().query(
      `SELECT id, raw->>'id' AS pos_id, status
         FROM pancake_order
        WHERE deleted_at IS NULL
          AND (
                upper(trim(tracking_code)) = upper(trim($1))
             OR upper(trim(COALESCE(raw->'partner'->>'order_number_vtp',''))) = upper(trim($1))
          )
        LIMIT 1`,
      [ma],
    )
    const don = r.rows[0]
    if (!don) return { updated: false, reason: `Không tìm thấy đơn có mã vận đơn ${ma}` }
    if (Number(don.status) !== 4) {
      return { updated: false, reason: `Đơn đang ở status ${don.status}, không phải "đang hoàn về"` }
    }
    const posId = String(don.pos_id || "")
    if (!posId) return { updated: false, reason: "Đơn không có pos_id để gọi Pancake" }

    const base = "https://pos.pages.fm/api/v1"
    const url = `${base}/shops/${shopId}/orders/${posId}?api_key=${apiKey}`

    // Đọc lại từ POS trước khi ghi: DB có thể cũ hơn thực tế.
    const rGet = await fetch(url)
    if (!rGet.ok) return { updated: false, reason: `Không đọc được đơn trên POS (HTTP ${rGet.status})`, posId }
    const dGet: any = await rGet.json()
    const o = dGet?.data ?? dGet?.order ?? dGet
    if (Number(o?.status) === 5) return { updated: false, reason: "POS đã là 'đã hoàn về kho'", posId }
    if (Number(o?.status) !== 4) {
      return { updated: false, reason: `POS đang ở status ${o?.status}, bỏ qua`, posId }
    }

    const rPut = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: 5 }),
    })
    if (!rPut.ok) {
      const t = await rPut.text().catch(() => "")
      return { updated: false, reason: `PUT thất bại (HTTP ${rPut.status}): ${t.slice(0, 150)}`, posId }
    }

    console.log(`[Dohana] Hàng hoàn ${ma} đã về kho — đẩy POS ${posId}: status 4 → 5`)
    return { updated: true, reason: "Đã chuyển sang 'Đã hoàn về kho'", posId }
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
      // Medusa parse JSON rồi mới tới route, và KHÔNG giữ lại chuỗi gốc trừ khi route
      // khai preserveRawBody. Nếu chỉ so chữ ký với JSON.stringify(body) thì mọi webhook
      // đều bị từ chối: thứ tự khoá hay khoảng trắng chỉ cần khác một chỗ là HMAC khác.
      // Nên thử lần lượt vài cách biểu diễn thường gặp của cùng một payload.
      const ungVien = [
        rawBody,
        // JSON.stringify chuẩn (không khoảng trắng) — dạng Node tạo ra.
        (() => { try { return JSON.stringify(JSON.parse(rawBody)) } catch { return null } })(),
        // Một số bên ký trên JSON có thụt lề 2 dấu cách.
        (() => { try { return JSON.stringify(JSON.parse(rawBody), null, 2) } catch { return null } })(),
      ].filter((v): v is string => typeof v === "string" && v.length > 0)

      const sigHex = String(signature).trim().toLowerCase()
      for (const v of ungVien) {
        const computed = createHmac("sha256", verifyKey).update(v, "utf8").digest("hex")
        if (computed === sigHex) return true
      }
      console.warn(
        `[Dohana Webhook] Chữ ký không khớp — nhận ${sigHex.slice(0, 16)}…, ` +
        `đã thử ${ungVien.length} cách biểu diễn payload`
      )
      return false
    } catch {
      return false
    }
  }
}

export default DohanaSyncService
