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

const STATUS_VI: Record<number, string> = {
  0: "Chờ xử lý",
  1: "Đã xác nhận",
  2: "Đang đóng gói",
  3: "Chờ giao hàng",
  4: "Đang giao",
  5: "Hoàn thành",
  6: "Đã gửi VC",
  7: "Đã xóa",
  9: "Đã gửi VC",
  11: "Chờ hàng",
  "-1": "Đã hủy",
  "-2": "Hoàn hàng",
} as any

function statusLabel(status: number): string {
  return STATUS_VI[status] ?? STATUS_VI[String(status)] ?? `Trạng thái ${status}`
}

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
    // Create job record
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

      let page = 1
      const pageSize = 50
      let totalPages = 1
      // Pancake API sort theo updated_at DESC (không phải inserted_at) — không thể dừng sớm.
      // Phải đọc toàn bộ, insert đơn có inserted_at trong [from,to], update đơn đã có bất kể ngày.

      while (page <= totalPages) {
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
                if (opts?.force) {
                  // Force: overwrite status_history too, keeping old entries
                  const prev = existing[0]
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
                  const prev = existing[0]
                  const isPartial = prev.data_quality === "partial"
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
                  }
                }
              } else {
                // Insert mới — chỉ import đơn có inserted_at trong khoảng [from, to]
                const orderDate = mapped.pancake_created_at as Date | null
                if (orderDate && (orderDate < from || orderDate > to)) {
                  continue // bỏ qua đơn ngoài khoảng ngày khi insert lần đầu
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

          console.log(
            `[PancakeSync] Page ${page}/${totalPages} done — imported=${imported} updated=${updated}`
          )

          if (page < totalPages) {
            await delay(200) // rate limit buffer between pages
          }
        } catch (pageErr: any) {
          console.error(`[PancakeSync] Page ${page} failed:`, pageErr.message)
          failedPages.push(page)
          errors.push({ message: `Page ${page}: ${pageErr.message}` })
        }

        page++
      }

      // Release lock
      if (mgr) {
        await mgr.execute(`SELECT pg_advisory_unlock(hashtext('pancake-sync'))`)
      }
    } finally {
      const durationMs = Date.now() - startedAt
      await this.updatePancakeSyncJobs({
        id: jobId,
        status: errors.length > 0 && imported === 0 && updated === 0 ? "failed" : "done",
        finished_at: new Date(),
        stats: {
          imported,
          updated,
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

    // One-time heal: fix status_name sai từ code cũ — chỉ lấy đơn status=7 vì đó là mapping từng bị sai
    try {
      const wrongRows = await this.listPancakeOrders({ status: 7 }, { take: 100 })
      for (const o of wrongRows) {
        if (o.status_name !== "Đã xóa") {
          await this.updatePancakeOrders({ id: o.id, status_name: "Đã xóa" } as any)
          console.log(`[syncActiveOrders] Healed status_name for #${o.id}: "${o.status_name}" → "Đã xóa"`)
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
