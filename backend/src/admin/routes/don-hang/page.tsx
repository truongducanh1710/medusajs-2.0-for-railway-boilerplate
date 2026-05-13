import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useEffect, useState } from "react"

// ---- Formatters ----

function formatVND(amount: number) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(amount)) + "đ"
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ---- Badges ----

function PaymentBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    paid: { label: "Đã TT", cls: "bg-green-100 text-green-700" },
    authorized: { label: "Đã duyệt", cls: "bg-green-100 text-green-700" },
    captured: { label: "Đã thu", cls: "bg-green-100 text-green-700" },
    awaiting: { label: "Chờ TT", cls: "bg-yellow-100 text-yellow-700" },
    not_paid: { label: "Chưa TT", cls: "bg-red-100 text-red-700" },
    refunded: { label: "Hoàn tiền", cls: "bg-purple-100 text-purple-700" },
    partially_refunded: { label: "Hoàn 1 phần", cls: "bg-purple-100 text-purple-700" },
    canceled: { label: "Hủy", cls: "bg-red-100 text-red-700" },
  }
  const s = map[status] || { label: status, cls: "bg-gray-100 text-gray-600" }
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${s.cls}`}>
      {s.label}
    </span>
  )
}

function FulfillmentBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    fulfilled: { label: "Đã giao", cls: "bg-green-100 text-green-700" },
    shipped: { label: "Đang giao", cls: "bg-blue-100 text-blue-700" },
    not_fulfilled: { label: "Chưa giao", cls: "bg-yellow-100 text-yellow-700" },
    canceled: { label: "Hủy", cls: "bg-red-100 text-red-700" },
    partially_fulfilled: { label: "Giao 1 phần", cls: "bg-orange-100 text-orange-700" },
  }
  const s = map[status] || { label: status, cls: "bg-gray-100 text-gray-600" }
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${s.cls}`}>
      {s.label}
    </span>
  )
}

const STATUS_VI: Record<number, string> = {
  0: "Chờ xử lý", 1: "Đã xác nhận", 2: "Đang đóng gói", 3: "Chờ giao hàng",
  4: "Đang giao", 5: "Hoàn thành", 6: "Đã gửi VC", 7: "Đã hủy",
  9: "Đã gửi VC", 11: "Chờ hàng", [-1]: "Đã hủy", [-2]: "Hoàn hàng",
}

function getPancakeStatusLabel(status: number): string {
  return STATUS_VI[status] ?? `Trạng thái ${status}`
}

function getPancakeStatusCls(status: number): string {
  if (status === 5) return "bg-green-100 text-green-700"
  if (status === 7 || status === -1) return "bg-red-100 text-red-700"
  if (status === -2) return "bg-purple-100 text-purple-700"
  if (status === 2 || status === 4 || status === 6 || status === 9) return "bg-blue-100 text-blue-700"
  if (status === 0 || status === 11) return "bg-yellow-100 text-yellow-700"
  if (status === 1 || status === 3) return "bg-orange-100 text-orange-700"
  return "bg-gray-100 text-gray-600"
}

function SourceBadge({ source }: { source: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    medusa: { label: "Website", cls: "bg-indigo-100 text-indigo-700" },
    facebook: { label: "Facebook", cls: "bg-blue-100 text-blue-700" },
    zalo: { label: "Zalo", cls: "bg-sky-100 text-sky-700" },
    tiktok: { label: "TikTok", cls: "bg-pink-100 text-pink-700" },
    shopee: { label: "Shopee", cls: "bg-orange-100 text-orange-700" },
    manual: { label: "Thủ công", cls: "bg-gray-100 text-gray-700" },
    unknown: { label: "Khác", cls: "bg-gray-100 text-gray-600" },
  }
  const s = map[source] || { label: source, cls: "bg-gray-100 text-gray-600" }
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${s.cls}`}>
      {s.label}
    </span>
  )
}

// ---- Constants ----

const LIMIT = 50
const SOURCES = [
  { value: "all", label: "Tất cả nguồn" },
  { value: "medusa", label: "Website" },
  { value: "facebook", label: "Facebook" },
  { value: "zalo", label: "Zalo" },
  { value: "tiktok", label: "TikTok" },
  { value: "shopee", label: "Shopee" },
  { value: "unknown", label: "Khác" },
]

// ---- Component ----

const DonHangPage = () => {
  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [search, setSearch] = useState("")
  const [searchInput, setSearchInput] = useState("")
  const [sourceFilter, setSourceFilter] = useState("all")
  // Medusa statuses for linked orders: medusa_order_id → { payment_status, fulfillment_status, display_id }
  const [medusaStatuses, setMedusaStatuses] = useState<Record<string, any>>({})

  const fetchOrders = async (off: number, q: string, src: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set("limit", String(LIMIT))
      params.set("offset", String(off))
      if (src && src !== "all") params.set("source", src)
      if (q) params.set("q", q)

      const res = await fetch(
        `/admin/pancake-sync/orders?${params.toString()}`,
        { credentials: "include" }
      )
      const data = await res.json()
      const fetchedOrders = data.orders || []
      setOrders(fetchedOrders)
      setTotal(data.count || 0)

      // Batch fetch Medusa payment/fulfillment for linked orders
      const medusaIds = fetchedOrders
        .map((o: any) => o.medusa_order_id)
        .filter(Boolean) as string[]

      if (medusaIds.length > 0) {
        fetchMedusaStatuses(medusaIds)
      } else {
        setMedusaStatuses({})
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const fetchMedusaStatuses = async (ids: string[]) => {
    try {
      // Use the Medusa admin orders endpoint with id filter
      // We batch by querying recent orders and matching ids
      const fields = [
        "id", "display_id", "payment_status", "fulfillment_status",
      ].join(",")
      const res = await fetch(
        `/admin/orders?limit=200&fields=${encodeURIComponent(fields)}&order=-created_at`,
        { credentials: "include" }
      )
      if (!res.ok) return
      const data = await res.json()
      const statuses: Record<string, any> = {}
      for (const o of data.orders || []) {
        if (ids.includes(o.id)) {
          statuses[o.id] = {
            display_id: o.display_id,
            payment_status: o.payment_status,
            fulfillment_status: o.fulfillment_status,
          }
        }
      }
      setMedusaStatuses(statuses)
    } catch {
      // non-critical
    }
  }

  useEffect(() => { fetchOrders(offset, search, sourceFilter) }, [offset, search, sourceFilter])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setOffset(0)
    setSearch(searchInput)
  }

  const totalPages = Math.ceil(total / LIMIT)
  const currentPage = Math.floor(offset / LIMIT) + 1

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Đơn hàng</h1>
          <p className="text-gray-500 text-sm mt-1">
            {total > 0 ? `${total} đơn hàng` : "Đang tải..."}
          </p>
        </div>
        <div className="flex gap-3">
          <a
            href="/app/pancake-sync"
            className="text-sm text-blue-600 hover:underline self-center"
          >
            Đồng bộ Pancake →
          </a>
          <a
            href="/app/orders"
            className="text-sm text-gray-500 hover:underline self-center"
          >
            Bảng mặc định
          </a>
        </div>
      </div>

      {/* Filters row */}
      <div className="mb-4 flex gap-3 flex-wrap items-center">
        {/* Source filter */}
        <select
          value={sourceFilter}
          onChange={(e) => { setSourceFilter(e.target.value); setOffset(0) }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          {SOURCES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>

        {/* Search bar */}
        <form onSubmit={handleSearch} className="flex gap-2 flex-1 max-w-sm">
          <input
            type="text"
            placeholder="Tìm theo SĐT..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <button
            type="submit"
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            Tìm
          </button>
          {search && (
            <button
              type="button"
              onClick={() => { setSearchInput(""); setSearch(""); setOffset(0) }}
              className="border border-gray-300 px-4 py-2 rounded-lg text-sm hover:bg-gray-50"
            >
              Xóa lọc
            </button>
          )}
        </form>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400">Đang tải...</div>
      ) : orders.length === 0 ? (
        <div className="text-center py-16 text-gray-400">Không có đơn hàng nào</div>
      ) : (
        <>
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">#POS</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Nguồn</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Ngày đặt</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Tên khách</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">SĐT</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Tỉnh/TP</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Sản phẩm</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Marketer</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Sale</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Tổng tiền</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">TT POS</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Thanh toán</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Giao hàng</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {orders.map((order) => {
                    const medusaInfo = order.medusa_order_id
                      ? medusaStatuses[order.medusa_order_id]
                      : null

                    const items: any[] = Array.isArray(order.items) ? order.items : []
                    const firstItem = items[0]
                    const itemTitle = firstItem
                      ? firstItem.name + (items.length > 1 ? ` +${items.length - 1}` : "")
                      : "—"

                    // Click handler: Medusa-linked → Medusa detail, Pancake-only → Pancake detail
                    const detailUrl = order.medusa_order_id
                      ? `/app/orders/${order.medusa_order_id}`
                      : `/app/pancake-orders/${order.id}`

                    return (
                      <tr
                        key={order.id}
                        className="hover:bg-blue-50 cursor-pointer transition-colors"
                        onClick={() => window.location.href = detailUrl}
                      >
                        <td className="px-4 py-3 font-mono font-bold text-gray-900">
                          #{order.id}
                          {medusaInfo?.display_id && (
                            <span className="text-gray-400 font-normal ml-1 text-xs">
                              (MD#{medusaInfo.display_id})
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <SourceBadge source={order.source} />
                        </td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                          {formatDate(order.pancake_created_at || order.synced_at || order.created_at)}
                        </td>
                        <td className="px-4 py-3 font-semibold text-gray-900 whitespace-nowrap">
                          {order.customer_name || "—"}
                        </td>
                        <td
                          className="px-4 py-3 text-gray-600 whitespace-nowrap"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (order.customer_phone) {
                              navigator.clipboard.writeText(order.customer_phone)
                              const el = e.currentTarget
                              const orig = el.textContent
                              el.textContent = "✓ Đã cop!"
                              el.classList.add("text-green-600")
                              setTimeout(() => { el.textContent = orig; el.classList.remove("text-green-600") }, 1200)
                            }
                          }}
                          title="Bấm để copy SĐT"
                          style={{ cursor: "copy" }}
                        >
                          {order.customer_phone || "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                          {order.province || "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-600 max-w-[200px] truncate" title={itemTitle}>
                          {itemTitle}
                        </td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap text-xs">
                          {order.marketer_name || "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap text-xs">
                          {order.sale_name || "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-gray-900 whitespace-nowrap">
                          {formatVND(order.total)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${getPancakeStatusCls(order.status)}`}>
                            {order.status_name || getPancakeStatusLabel(order.status)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {medusaInfo
                            ? <PaymentBadge status={medusaInfo.payment_status} />
                            : <span className="text-xs text-gray-400">—</span>
                          }
                        </td>
                        <td className="px-4 py-3 text-center">
                          {medusaInfo
                            ? <FulfillmentBadge status={medusaInfo.fulfillment_status} />
                            : <span className="text-xs text-gray-400">—</span>
                          }
                        </td>
                        <td className="px-4 py-3 text-right">
                          <a
                            href={detailUrl}
                            onClick={(e) => e.stopPropagation()}
                            className="text-blue-600 hover:underline whitespace-nowrap text-xs"
                          >
                            Chi tiết →
                          </a>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-gray-500">
                Trang {currentPage}/{totalPages} — {total} đơn
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                  disabled={offset === 0}
                  className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ← Trước
                </button>
                <button
                  onClick={() => setOffset(offset + LIMIT)}
                  disabled={offset + LIMIT >= total}
                  className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Tiếp →
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Đơn hàng (Tên KH)",
})

export default DonHangPage
