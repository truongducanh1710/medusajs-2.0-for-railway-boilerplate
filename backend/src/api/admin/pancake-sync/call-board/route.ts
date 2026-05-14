import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

// Tính action_status từ notes và tags
function computeActionStatus(notes: any[], tags: any[]): string {
  const tagNames = (tags ?? []).map((t: any) => String(t?.name ?? "").toLowerCase())

  // Ưu tiên tag chính thức từ Pancake
  if (tagNames.some((t) => t.includes("xác nhận") || t.includes("cho đi"))) return "confirmed"
  if (tagNames.some((t) => t.includes("hủy") || t.includes("cancel"))) return "cancelled"
  if (tagNames.some((t) => t.includes("cho đi"))) return "send"
  if (tagNames.some((t) => t.includes("sale chốt") || t.includes("rmk") || t.includes("remarketing"))) return "confirmed"

  const noteList = notes ?? []
  const knmCount = noteList.filter((n: any) =>
    String(n.message ?? "").toUpperCase().includes("KNM")
  ).length

  if (knmCount >= 3) return "knm_3"
  if (knmCount === 2) return "knm_2"
  if (knmCount === 1) return "knm_1"
  if (noteList.length > 0) return "called"
  return "no_action"
}

function actionStatusLabel(s: string): string {
  const map: Record<string, string> = {
    no_action: "Chưa tác động",
    called: "Đã gọi",
    knm_1: "KNM lần 1",
    knm_2: "KNM lần 2",
    knm_3: "KNM lần 3",
    confirmed: "Đã xác nhận",
    cancelled: "Đã hủy",
    send: "Cho đi",
  }
  return map[s] ?? s
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const syncService = req.scope.resolve("pancakeSyncModule") as any

  const q = req.query as Record<string, string>
  const date = q.date ?? new Date().toISOString().slice(0, 10)          // YYYY-MM-DD
  const sellerFilter = q.seller ?? ""
  const statusFilter = q.status_filter ?? "all"
  const page = Math.max(0, parseInt(q.page ?? "0", 10))
  const limit = Math.min(100, parseInt(q.limit ?? "50", 10))

  // Lấy đơn trong ngày yêu cầu (theo pancake_created_at)
  const dayStart = new Date(`${date}T00:00:00+07:00`)
  const dayEnd = new Date(`${date}T23:59:59+07:00`)

  let orders: any[]
  try {
    // Lấy nhiều để filter — Medusa ORM list không hỗ trợ date range filter trực tiếp
    orders = await syncService.listPancakeOrders(
      {},
      { take: 500, order: { pancake_created_at: "DESC" } }
    )
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }

  // Filter theo ngày + chỉ đơn mới (status = 0)
  orders = orders.filter((o: any) => {
    const d = o.pancake_created_at ? new Date(o.pancake_created_at) : null
    return d && d >= dayStart && d <= dayEnd && o.status === 0
  })

  // Filter theo sale
  if (sellerFilter) {
    orders = orders.filter((o: any) =>
      String(o.sale_name ?? "").toLowerCase().includes(sellerFilter.toLowerCase())
    )
  }

  // Thêm action_status vào từng đơn
  const enriched = orders.map((o: any) => {
    const notes: any[] = Array.isArray(o.notes) ? o.notes : []
    const tags: any[] = Array.isArray(o.tags) ? o.tags : []
    const actionStatus = computeActionStatus(notes, tags)
    const createdAt = o.pancake_created_at ? new Date(o.pancake_created_at) : null
    const hoursSinceCreated = createdAt
      ? Math.floor((Date.now() - createdAt.getTime()) / 3_600_000)
      : 0

    // Kiểm tra quá hạn: đơn tạo trước 17h nhưng chưa có note và đã qua ngày
    const createdHour = createdAt ? createdAt.getHours() + 7 : 0 // convert UTC→VN
    const isOverdue =
      actionStatus === "no_action" &&
      createdAt !== null &&
      new Date() > dayEnd

    return {
      id: o.id,
      customer_name: o.customer_name,
      customer_phone: o.customer_phone,
      sale_name: o.sale_name,
      sale_id: (o.raw as any)?.assigning_seller?.id ?? "",
      product_summary: Array.isArray(o.items)
        ? o.items.map((i: any) => `${i.name} x${i.qty}`).join(", ")
        : "",
      total: o.total,
      source: o.source,
      pancake_created_at: o.pancake_created_at,
      status: o.status,
      status_name: o.status_name,
      tags,
      notes: notes.map((n: any) => ({
        message: n.message,
        by: n.by,
        at: n.at_ms ? new Date(n.at_ms).toISOString() : null,
      })),
      last_note_at: o.last_note_at,
      call_count: o.call_count ?? 0,
      action_status: actionStatus,
      action_status_label: actionStatusLabel(actionStatus),
      hours_since_created: hoursSinceCreated,
      is_overdue: isOverdue,
      pancake_link: (o.raw as any)?.order_link ?? null,
    }
  })

  // Filter theo status
  const filtered =
    statusFilter === "all"
      ? enriched
      : statusFilter === "no_action"
      ? enriched.filter((o) => o.action_status === "no_action")
      : statusFilter === "knm"
      ? enriched.filter((o) => o.action_status.startsWith("knm"))
      : statusFilter === "confirmed"
      ? enriched.filter((o) => o.action_status === "confirmed")
      : statusFilter === "cancelled"
      ? enriched.filter((o) => o.action_status === "cancelled")
      : enriched

  // Summary
  const summary = {
    total: enriched.length,
    no_action: enriched.filter((o) => o.action_status === "no_action").length,
    knm: enriched.filter((o) => o.action_status.startsWith("knm")).length,
    knm_3: enriched.filter((o) => o.action_status === "knm_3").length,
    called: enriched.filter((o) => o.action_status === "called").length,
    confirmed: enriched.filter((o) => o.action_status === "confirmed").length,
    cancelled: enriched.filter((o) => o.action_status === "cancelled").length,
    overdue: enriched.filter((o) => o.is_overdue).length,
  }

  // Lấy danh sách sellers unique để render filter dropdown
  const sellersMap = new Map<string, string>()
  for (const o of enriched) {
    if (o.sale_name) sellersMap.set(o.sale_id || o.sale_name, o.sale_name)
  }
  const sellers = Array.from(sellersMap.entries()).map(([id, name]) => ({ id, name }))

  // Paginate
  const paged = filtered.slice(page * limit, page * limit + limit)

  res.json({
    orders: paged,
    total: filtered.length,
    page,
    limit,
    summary,
    sellers,
  })
}
