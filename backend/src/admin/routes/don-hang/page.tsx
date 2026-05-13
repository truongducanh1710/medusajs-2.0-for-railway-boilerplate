import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useEffect, useState } from "react"

function formatVND(amount: number) {
  // Medusa lưu giá dạng integer (VND không có decimal), không cần chia 100
  return new Intl.NumberFormat("vi-VN").format(Math.round(amount)) + "đ"
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

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

const LIMIT = 50

const DonHangPage = () => {
  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [search, setSearch] = useState("")
  const [searchInput, setSearchInput] = useState("")

  const fetchOrders = async (off: number, q: string) => {
    setLoading(true)
    try {
      const fields = [
        "id", "display_id", "created_at", "total", "payment_status", "fulfillment_status",
        "+shipping_address.first_name", "+shipping_address.last_name",
        "+shipping_address.phone", "+shipping_address.province", "+shipping_address.city",
        "+items.title", "+items.quantity", "+metadata",
      ].join(",")

      let url = `/admin/orders?limit=${LIMIT}&offset=${off}&fields=${encodeURIComponent(fields)}&order=-created_at`
      if (q) url += `&q=${encodeURIComponent(q)}`

      const res = await fetch(url, { credentials: "include" })
      const data = await res.json()
      setOrders(data.orders || [])
      setTotal(data.count || 0)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchOrders(offset, search) }, [offset, search])

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
        <a
          href="/app/orders"
          className="text-sm text-blue-600 hover:underline"
        >
          Xem bảng mặc định →
        </a>
      </div>

      {/* Search bar */}
      <form onSubmit={handleSearch} className="mb-4 flex gap-2">
        <input
          type="text"
          placeholder="Tìm theo tên, SĐT, mã đơn..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 max-w-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
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
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">#Đơn</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Ngày đặt</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Tên khách</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">SĐT</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Tỉnh/TP</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Sản phẩm</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Tổng tiền</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Thanh toán</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Giao hàng</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {orders.map((order) => {
                    const addr = order.shipping_address || {}
                    const fullName = [addr.first_name, addr.last_name].filter(Boolean).join(" ") || "—"
                    const phone = addr.phone || order.metadata?.phone || "—"
                    const province = addr.province || addr.city || order.metadata?.province || "—"
                    const firstItem = order.items?.[0]
                    const itemTitle = firstItem
                      ? firstItem.title + (order.items.length > 1 ? ` +${order.items.length - 1}` : "")
                      : "—"

                    return (
                      <tr
                        key={order.id}
                        className="hover:bg-blue-50 cursor-pointer transition-colors"
                        onClick={() => window.location.href = `/app/orders/${order.id}`}
                      >
                        <td className="px-4 py-3 font-mono font-bold text-gray-900">
                          #{order.display_id}
                        </td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                          {formatDate(order.created_at)}
                        </td>
                        <td className="px-4 py-3 font-semibold text-gray-900 whitespace-nowrap">
                          {fullName}
                        </td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                          {phone}
                        </td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                          {province}
                        </td>
                        <td className="px-4 py-3 text-gray-600 max-w-[200px] truncate" title={itemTitle}>
                          {itemTitle}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-gray-900 whitespace-nowrap">
                          {formatVND(order.total)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <PaymentBadge status={order.payment_status} />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <FulfillmentBadge status={order.fulfillment_status} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <a
                            href={`/app/orders/${order.id}`}
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
