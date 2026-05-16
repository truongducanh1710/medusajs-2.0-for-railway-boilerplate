import { MedusaService } from "@medusajs/framework/utils"
import PancakeOrder from "./models/pancake-order"
import PancakeSyncJob from "./models/pancake-sync-job"
import { PANCAKE_API_BASE, PANCAKE_API_KEY, PANCAKE_SHOP_ID } from "../../lib/constants"
import { extractNotesForOrder, extractTags } from "./extractors"

// ---- Types ----

export type SyncResult = {
  imported: number
  updated: number
  failed_pages: number[]
  errors: Array<{ orderId?: string; message: string }>
  duration_ms: number
}

type PancakeListResponse = {
  data?: any[]
  orders?: any[]
  total_pages?: number
  total?: number
  page_number?: number
}

// ---- Helpers ----

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
  let lastErr: Error | undefined
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    try {
      const res = await fetch(url, { signal: controller.signal }).finally(() =>
        clearTimeout(timeout)
      )
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("Retry-After") || "5", 10)
        console.warn(`[PancakeSync] Rate limited, waiting ${retryAfter}s...`)
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
        console.warn(`[PancakeSync] Request failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${backoff}ms`)
        await delay(backoff)
      }
    }
  }
  throw lastErr ?? new Error("Unknown fetch error")
}

// ---- Status helpers ----

// Mapping theo Pancake thực tế (verify bằng status_name từ API):
//   0=new (mới về), 1=submitted (sale chốt), 2=shipped (đang giao),
//   3=delivered (giao thành công), 4=returning (đang hoàn về),
//   5=returned (đã hoàn về kho), 6=canceled (đã hủy bởi sale/admin),
//   7=deleted, 11=waitting (chờ hàng)
const STATUS_VI: Record<number, string> = {
  0: "Chờ xử lý",
  1: "Sale đã chốt",
  2: "Đang giao",
  3: "Giao thành công",
  4: "Đang hoàn về",
  5: "Đã hoàn về kho",
  6: "Đã hủy",
  7: "Đã xóa",
  11: "Chờ hàng",
  "-1": "Đã hủy",
  "-2": "Hoàn hàng",
} as any

function statusLabel(status: number): string {
  return STATUS_VI[status] ?? STATUS_VI[String(status)] ?? `Trạng thái ${status}`
}

// ---- Sync optimization ----

/**
 * Terminal statuses: orders that never change again on Pancake POS.
 * 3=Giao thành công, 5=Đã hoàn về kho, 6=Đã hủy (canceled), 7=Đã xóa,
 * -1=Đã hủy (legacy), -2=Hoàn hàng manual (legacy).
 *
 * Status 4 "Đang hoàn về" is NOT terminal — still tracked until it becomes 5.
 */
const TERMINAL_STATUSES = new Set([3, 5, 6, 7, -1, -2])

/**
 * Stop early if N consecutive pages are "stable" — meaning either:
 *   A. >= STABLE_TERMINAL_RATIO % orders are terminal-in-DB and unchanged
 *      (Pancake sorts updated_at DESC, so once stable pages start they continue)
 *   B. 100% orders have inserted_at older than STABLE_OLD_DAYS days
 *      (đơn 30+ ngày coi như không cần sync — business rule)
 */
const EARLY_STOP_CONSECUTIVE_PAGES = 3
const STABLE_TERMINAL_RATIO = 0.95   // 95% terminal trong page → coi như stable
const STABLE_OLD_DAYS = 30           // page toàn đơn > 30 ngày → cũng coi stable

// ---- Detect source ----

function detectSource(order: any): string {
  // order_sources_name là field chính xác nhất từ Pancake
  const srcName = String(order.order_sources_name ?? "").toLowerCase()
  if (srcName === "facebook") return "facebook"
  if (srcName === "zalo") return "zalo"
  if (srcName === "tiktok") return "tiktok"
  if (srcName === "shopee") return "shopee"
  if (srcName === "lazada") return "lazada"
  // "Webcake" = tạo thủ công trên Pancake — nhưng đơn từ phanviet.vn cũng là Webcake
  // Phân biệt bằng tag "phanviet-web", p_utm_source = "phanviet.vn", hoặc note chứa "[phanviet.vn]"
  if (srcName === "webcake" || srcName === "") {
    const tags: string[] = Array.isArray(order.tags)
      ? order.tags.map((t: any) => String(t?.name ?? t).toLowerCase())
      : []
    if (tags.includes("phanviet-web")) return "medusa"
    const utm0 = String(order.p_utm_source ?? "").toLowerCase()
    if (utm0 === "phanviet.vn") return "medusa"
    const note = String(order.note ?? "").toLowerCase()
    if (note.includes("[phanviet.vn]")) return "medusa"
    if (srcName === "") return "unknown"
    return "manual"
  }

  // Fallback: UTM source
  const utm = String(order.p_utm_source ?? order.marketing?.p_utm_source ?? order.marketing?.utm_source ?? "").toLowerCase()
  if (utm.includes("facebook") || utm.includes("fb")) return "facebook"
  if (utm.includes("zalo")) return "zalo"
  if (utm.includes("tiktok")) return "tiktok"
  if (utm.includes("shopee")) return "shopee"

  // Fallback: page_id prefix
  const pageId = String(order.page_id ?? "").toLowerCase()
  if (pageId.startsWith("spo_")) return "shopee"
  if (pageId.startsWith("tts_")) return "tiktok"

  return "unknown"
}

// ---- Mapping ----

function mapPancakeOrder(raw: any): Record<string, any> {
  const items = Array.isArray(raw.items) ? raw.items.map((item: any) => ({
    name: item.variation_info?.name ?? item.name ?? "—",
    qty: item.quantity ?? 1,
    price: item.variation_info?.retail_price ?? item.price ?? 0,
  })) : []

  return {
    id: String(raw.system_id || raw.id || ""),
    source: detectSource(raw),
    status: raw.status ?? 0,
    status_name: statusLabel(raw.status ?? 0),
    customer_name: raw.bill_full_name ?? raw.customer?.name ?? "",
    customer_phone: raw.bill_phone_number ?? raw.customer?.phone ?? "",
    province: raw.shipping_address?.province_name ?? raw.customer?.province ?? "",
    total: raw.total_price ?? raw.total ?? 0,
    shipping_fee: raw.shipping_fee ?? 0,
    cod_amount: raw.cod ?? 0,
    items,
    items_count: items.length,
    tracking_code: raw.partner?.extend_code ?? raw.tracking_code ?? "",
    marketer_name: raw.marketer?.name ?? "",
    sale_name: raw.assigning_seller?.name ?? "",
    care_name: raw.assigning_care?.name ?? "",
    raw: raw,
    pancake_created_at: raw.inserted_at ? new Date(raw.inserted_at) : (raw.created_at ? new Date(raw.created_at) : null),
    synced_at: new Date(),
    data_quality: Array.isArray(raw.items) ? "complete" : "partial",
  }
}

// ---- Service ----

class PancakeSyncService extends MedusaService({ PancakeOrder, PancakeSyncJob }) {
  /**
   * Pull orders from Pancake in a date range and upsert into DB.
   * Runs inside a Postgres advisory lock to prevent concurrent syncs.
   */
  async pullByDateRange(
    from: Date,
    to: Date,
    opts?: { force?: boolean }
  ): Promise<{ jobId: string }> {
    // 1) Cleanup zombie jobs: mark "running" quá 30 phút thành "failed"
    //    (xảy ra khi backend restart giữa chừng — job stuck status=running)
    await this._cleanupZombieJobs()

    // 2) Reject nếu đã có job thực sự đang chạy trong 30 phút qua
    const recentRunning = await this.listPancakeSyncJobs(
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

    // 3) Create new job
    const job = await this.createPancakeSyncJobs({
      status: "queued",
      from_date: from,
      to_date: to,
    })
    const jobId = job.id

    // Run async — caller polls /status
    this._executeSync(jobId, from, to, opts).catch((err) => {
      console.error(`[PancakeSync] Job ${jobId} failed:`, err.message)
    })

    return { jobId }
  }

  /**
   * Đánh dấu job stuck "running" hoặc "queued" quá 30 phút thành "failed".
   * Lý do: backend restart giữa chừng → process chết nhưng row job vẫn status=running.
   */
  private async _cleanupZombieJobs(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - 30 * 60 * 1000)
      const zombies = await this.listPancakeSyncJobs(
        {
          status: { $in: ["queued", "running"] } as any,
          started_at: { $lt: cutoff } as any,
        } as any,
        { take: 50 }
      )
      for (const z of zombies as any[]) {
        await this.updatePancakeSyncJobs({
          id: z.id,
          status: "failed",
          finished_at: new Date(),
          error: "Backend restarted before sync finished (zombie cleanup)",
        } as any)
        console.warn(`[PancakeSync] Cleaned zombie job ${z.id} (started ${z.started_at})`)
      }
    } catch (err: any) {
      console.warn(`[PancakeSync] Zombie cleanup failed: ${err.message}`)
    }
  }

  private async _executeSync(
    jobId: string,
    from: Date,
    to: Date,
    opts?: { force?: boolean }
  ): Promise<void> {
    const startedAt = Date.now()
    const errors: Array<{ orderId?: string; message: string }> = []
    const failedPages: number[] = []
    let imported = 0
    let updated = 0
    let skippedTerminal = 0
    let stoppedEarlyAtPage: number | null = null
    let consecutiveTerminalPages = 0
    let page = 1
    let totalPages = 1

    try {
      // Advisory lock — fail fast if another sync is running
      const mgr = (this as any).__container?.manager
      if (mgr) {
        const [lockResult] = await mgr.execute(
          `SELECT pg_try_advisory_lock(hashtext('pancake-sync')) as locked`
        )
        if (!lockResult?.locked) {
          await this.updatePancakeSyncJobs({
            id: jobId,
            status: "failed",
            finished_at: new Date(),
            error: "SYNC_IN_PROGRESS: Another sync job is already running",
          })
          return
        }
      }

      // Mark running
      await this.updatePancakeSyncJobs({
        id: jobId,
        status: "running",
        started_at: new Date(),
      })

      const pageSize = 50
      // Pancake API sort theo updated_at DESC.
      // Skip terminal-in-DB orders + early-stop sau N page liên tiếp toàn terminal.

      while (page <= totalPages) {
        let pageTerminalCount = 0

        try {
          const url = `${PANCAKE_API_BASE}/shops/${PANCAKE_SHOP_ID}/orders?api_key=${PANCAKE_API_KEY}&page_size=${pageSize}&page_number=${page}`

          const res = await fetchWithRetry(url)
          const body: PancakeListResponse = await res.json()

          const orders: any[] = body.data ?? body.orders ?? []
          totalPages = body.total_pages ?? 1

          for (const raw of orders) {
            try {
              const mapped = mapPancakeOrder(raw)
              if (!mapped.id) continue

              // Kiểm tra đơn đã có trong DB chưa
              const existing = await this.listPancakeOrders(
                { id: mapped.id },
                { take: 1 }
              )

              if (existing.length > 0) {
                const prev = existing[0]

                // Skip terminal-in-DB orders that haven't changed status
                // Bypass skip nếu:
                //   - data_quality=partial (chỉ có data từ webhook, thiếu items/customer)
                //   - care_name rỗng và Pancake có (cần backfill field mới)
                //   - status_name SAI so với mapping mới (cần heal label)
                const isPartial = prev.data_quality === "partial"
                const needsCareBackfill = !prev.care_name && !!mapped.care_name
                const needsLabelHeal = prev.status_name !== mapped.status_name
                if (
                  !opts?.force &&
                  !isPartial &&
                  !needsCareBackfill &&
                  !needsLabelHeal &&
                  TERMINAL_STATUSES.has(prev.status) &&
                  prev.status === mapped.status
                ) {
                  skippedTerminal++
                  pageTerminalCount++
                  continue
                }

                if (opts?.force) {
                  // Force: overwrite status_history too, keeping old entries
                  const prevHistory: any[] = Array.isArray(prev.status_history) ? prev.status_history : []
                  const hasChanged = prev.status !== mapped.status
                  const newHistory = hasChanged
                    ? [
                        ...prevHistory,
                        {
                          status: mapped.status,
                          status_name: mapped.status_name,
                          changed_at: new Date().toISOString(),
                          source: "sync",
                        },
                      ]
                    : prevHistory

                  await this.updatePancakeOrders({
                    id: mapped.id,
                    ...mapped,
                    status_history: newHistory as any,
                    raw: mapped.raw,
                    raw_version: "v1",
                  } as any)
                  updated++
                } else {
                  if (isPartial) {
                    // Partial row từ webhook — fill đầy đủ data
                    const prevHistory: any[] = Array.isArray(prev.status_history) ? prev.status_history : []
                    const hasChanged = prev.status !== mapped.status
                    await this.updatePancakeOrders({
                      id: mapped.id,
                      ...mapped,
                      status_history: (hasChanged ? [
                        ...prevHistory,
                        { status: mapped.status, status_name: mapped.status_name, changed_at: new Date().toISOString(), source: "sync" },
                      ] : prevHistory) as any,
                      raw_version: "v1",
                    } as any)
                    updated++
                  } else if (prev.status !== mapped.status) {
                    // Non-force: chỉ update status nếu thay đổi
                    const prevHistory: any[] = Array.isArray(prev.status_history) ? prev.status_history : []
                    await this.updatePancakeOrders({
                      id: mapped.id,
                      status: mapped.status,
                      status_name: mapped.status_name,
                      status_history: [
                        ...prevHistory,
                        {
                          status: mapped.status,
                          status_name: mapped.status_name,
                          changed_at: new Date().toISOString(),
                          source: "sync",
                        },
                      ] as any,
                      synced_at: new Date(),
                    } as any)
                    updated++
                  } else if (needsCareBackfill || needsLabelHeal) {
                    // Backfill care_name hoặc heal label sai — không đụng status_history
                    await this.updatePancakeOrders({
                      id: mapped.id,
                      ...(needsCareBackfill ? { care_name: mapped.care_name } : {}),
                      ...(needsLabelHeal ? { status_name: mapped.status_name } : {}),
                      synced_at: new Date(),
                    } as any)
                    updated++
                  }
                }
              } else {
                // Insert mới — chỉ import đơn có inserted_at trong khoảng [from, to]
                const orderDate = mapped.pancake_created_at as Date | null
                if (orderDate && (orderDate < from || orderDate > to)) {
                  // Đơn cũ ngoài date range, chưa có trong DB:
                  // - Nếu Pancake đã terminal → coi như "stable", đếm vào pageTerminalCount để early-stop
                  // - Nếu chưa terminal → vẫn skip nhưng KHÔNG đếm (không kích early-stop)
                  if (!opts?.force && TERMINAL_STATUSES.has(mapped.status)) {
                    pageTerminalCount++
                  }
                  continue
                }
                await this.createPancakeOrders([mapped])
                imported++
              }
            } catch (orderErr: any) {
              console.error(`[PancakeSync] Error upserting order ${raw.system_id ?? raw.id}:`, orderErr.message)
              errors.push({
                orderId: String(raw.system_id ?? raw.id ?? ""),
                message: orderErr.message,
              })
            }
          }

          // Early-stop: page "stable" nếu một trong 2 điều kiện:
          //   A. >= 95% đơn đã terminal-in-DB
          //   B. 100% đơn có inserted_at > 30 ngày trước
          if (!opts?.force && orders.length > 0) {
            const terminalRatio = pageTerminalCount / orders.length
            const oldCutoff = Date.now() - STABLE_OLD_DAYS * 24 * 3600 * 1000
            const allOld = orders.every((raw: any) => {
              const inserted = raw.inserted_at ? new Date(raw.inserted_at).getTime() : 0
              return inserted > 0 && inserted < oldCutoff
            })
            const isStablePage = terminalRatio >= STABLE_TERMINAL_RATIO || allOld

            if (isStablePage) {
              consecutiveTerminalPages++
              if (consecutiveTerminalPages >= EARLY_STOP_CONSECUTIVE_PAGES) {
                const reason = allOld
                  ? `all orders older than ${STABLE_OLD_DAYS}d`
                  : `terminal ratio ${(terminalRatio * 100).toFixed(0)}%`
                console.log(
                  `[PancakeSync] Stop early at page ${page}/${totalPages} — ${consecutiveTerminalPages} consecutive stable pages (${reason})`
                )
                stoppedEarlyAtPage = page
                break
              }
            } else {
              consecutiveTerminalPages = 0
            }
          }

          console.log(
            `[PancakeSync] Page ${page}/${totalPages} done — imported=${imported} updated=${updated} skipped=${skippedTerminal}`
          )

          // Update progress incremental để frontend poll thấy tiến trình
          try {
            await this.updatePancakeSyncJobs({
              id: jobId,
              stats: {
                imported,
                updated,
                skipped_terminal: skippedTerminal,
                stopped_early_at_page: stoppedEarlyAtPage,
                current_page: page,
                total_pages: totalPages,
                failed_pages: failedPages,
                errors: errors.slice(0, 100),
                duration_ms: Date.now() - startedAt,
              },
            } as any)
          } catch {}

          if (page < totalPages) {
            await delay(200) // rate limit buffer between pages
          }
        } catch (pageErr: any) {
          console.error(`[PancakeSync] Page ${page} failed:`, pageErr.message)
          failedPages.push(page)
          errors.push({ message: `Page ${page}: ${pageErr.message}` })
          // Reset consecutive counter on failed page — don't trust missing data
          consecutiveTerminalPages = 0
        }

        page++
      }

      // Release lock
      if (mgr) {
        await mgr.execute(`SELECT pg_advisory_unlock(hashtext('pancake-sync'))`)
      }
    } finally {
      const durationMs = Date.now() - startedAt
      // Lấy total_pages hiện tại từ scope (có thể chưa được set nếu fail page đầu)
      const finalCurrentPage = page - 1 // page đã ++ sau khi xong page cuối
      await this.updatePancakeSyncJobs({
        id: jobId,
        status: errors.length > 0 && imported === 0 && updated === 0 ? "failed" : "done",
        finished_at: new Date(),
        stats: {
          imported,
          updated,
          skipped_terminal: skippedTerminal,
          stopped_early_at_page: stoppedEarlyAtPage,
          current_page: finalCurrentPage,
          total_pages: totalPages,
          failed_pages: failedPages,
          errors: errors.slice(0, 100), // cap error log
          duration_ms: durationMs,
        },
        ...(errors.length > 0 && imported === 0 && updated === 0
          ? { error: errors[0]?.message ?? "Unknown error" }
          : {}),
      })
    }
  }

  /**
   * Detect source from a Pancake order (exposed for API)
   */
  detectSource(order: any): string {
    return detectSource(order)
  }

  /**
   * Sync toàn bộ đơn status=0 (đơn mới chưa xác nhận) từ Pancake.
   *
   * Pancake list endpoint trả về đầy đủ customer.notes + tags trong response — không cần
   * fetch detail từng đơn. Lọc notes theo order_id (UUID extract từ order_link) để tránh
   * lấy nhầm note của đơn khác cùng khách.
   *
   * Snapshot strategy: replace toàn bộ notes/tags mỗi lần sync. POS là source of truth.
   */
  async syncActiveOrders(): Promise<{ updated: number; created: number; total: number; errors: number }> {
    let page = 1
    const pageSize = 200
    let totalPages = 1
    let updated = 0
    let created = 0
    let total = 0
    let errors = 0

    while (page <= totalPages) {
      try {
        const url = `${PANCAKE_API_BASE}/shops/${PANCAKE_SHOP_ID}/orders?api_key=${PANCAKE_API_KEY}&status=0&page_size=${pageSize}&page_number=${page}`
        const res = await fetchWithRetry(url)
        const body: PancakeListResponse = await res.json()
        totalPages = body.total_pages ?? 1

        const orders: any[] = body.data ?? body.orders ?? []
        total += orders.length

        for (const raw of orders) {
          try {
            const mapped = mapPancakeOrder(raw)
            if (!mapped.id) continue

            const { notes, lastNoteAt, callCount } = extractNotesForOrder(raw)
            const tags = extractTags(raw)

            const existing = await this.listPancakeOrders({ id: mapped.id }, { take: 1 })

            if (existing.length > 0) {
              await this.updatePancakeOrders({
                id: mapped.id,
                ...mapped,
                notes,
                last_note_at: lastNoteAt,
                call_count: callCount,
                tags,
                data_quality: "complete",
                raw_version: "v1",
              } as any)
              updated++
            } else {
              await this.createPancakeOrders([{
                ...mapped,
                notes,
                last_note_at: lastNoteAt,
                call_count: callCount,
                tags,
                raw_version: "v1",
              }] as any)
              created++
            }
          } catch (orderErr: any) {
            console.error(`[syncActiveOrders] Order ${raw.system_id ?? raw.id} failed:`, orderErr.message)
            errors++
          }
        }

        if (page < totalPages) {
          await delay(200)
        }
        page++
      } catch (pageErr: any) {
        console.error(`[syncActiveOrders] Page ${page} failed:`, pageErr.message)
        errors++
        break
      }
    }

    // One-time heal: fix status_name sai từ code cũ (mapping đã update đúng theo Pancake)
    // Status 6 đặc biệt: trước mapped là "Đã gửi VC", giờ đúng là "Đã hủy"
    // Paginate qua tất cả đơn cần heal (không cap 500) — quan trọng vì status=6 có >3000 đơn cũ
    try {
      const statusesToHeal = [1, 2, 3, 4, 5, 6, 7]
      for (const st of statusesToHeal) {
        const expected = statusLabel(st)
        // Chỉ heal đơn có status_name SAI (filter trực tiếp trong DB query)
        let healSkip = 0
        const healPageSize = 200
        while (true) {
          const wrongRows = await this.listPancakeOrders(
            {
              status: st,
              status_name: { $ne: expected } as any,
            } as any,
            { take: healPageSize, skip: healSkip, select: ["id", "status_name"] as any }
          )
          if (wrongRows.length === 0) break
          for (const o of wrongRows) {
            await this.updatePancakeOrders({ id: o.id, status_name: expected } as any)
          }
          console.log(`[syncActiveOrders] Healed ${wrongRows.length} rows status=${st} → "${expected}"`)
          if (wrongRows.length < healPageSize) break
          healSkip += healPageSize
        }
      }
    } catch (healErr: any) {
      console.warn("[syncActiveOrders] status_name heal failed:", healErr.message)
    }

    console.log(`[syncActiveOrders] Done — total=${total} updated=${updated} created=${created} errors=${errors}`)
    return { updated, created, total, errors }
  }

  /**
   * Reconcile: link medusa_order_id for rows that were synced before the column existed.
   * Scans pancake_order rows without medusa_order_id and tries to match via customer phone + total.
   */
  async reconcileMedusaLinks(): Promise<{ linked: number }> {
    let linked = 0

    const unlinked = await this.listPancakeOrders(
      { medusa_order_id: null },
      { take: 500 }
    )

    if (unlinked.length === 0) return { linked }

    // Try to resolve orderModuleService via container
    const container = (this as any).__container
    const orderService = container?.resolve?.("orderModuleService") as any

    if (!orderService) {
      console.warn("[PancakeSync] Cannot access orderModuleService for reconciliation")
      return { linked }
    }

    for (const po of unlinked) {
      try {
        // Match: phone + approximate total
        const orders = await orderService.listOrders(
          {},
          { take: 300, order: { created_at: "DESC" } }
        )

        const match = orders.find((o: any) => {
          const phone = o.shipping_address?.phone || o.metadata?.phone || ""
          const total = o.total ?? 0
          return (
            phone &&
            phone === po.customer_phone &&
            Math.abs(Number(total) - Number(po.total)) < 1000
          )
        })

        if (match) {
          await this.updatePancakeOrders({
            id: po.id,
            medusa_order_id: match.id,
          })
          linked++
        }
      } catch {
        // skip individual errors
      }
    }

    return { linked }
  }
}

export default PancakeSyncService