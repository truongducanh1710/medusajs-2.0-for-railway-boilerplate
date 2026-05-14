import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useEffect, useState } from "react"
import { apiFetch } from "../../../lib/api-client"

// Get route param without react-router-dom import
const useOrderId = () => {
  const parts = window.location.pathname.split("/")
  return parts[parts.length - 1] || ""
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

function getStatusLabel(status: number): string {
  return STATUS_VI[status] ?? STATUS_VI[String(status)] ?? `Trạng thái ${status}`
}

function getStatusBadgeCls(status: number): string {
  if (status === 5) return "bg-green-100 text-green-700 border-green-300"
  if (status === 7 || status === -1) return "bg-red-100 text-red-700 border-red-300"
  if (status === -2) return "bg-purple-100 text-purple-700 border-purple-300"
  if (status === 2 || status === 4 || status === 9 || status === 6) return "bg-blue-100 text-blue-700 border-blue-300"
  if (status === 0 || status === 11) return "bg-yellow-100 text-yellow-700 border-yellow-300"
  if (status === 1 || status === 3) return "bg-orange-100 text-orange-700 border-orange-300"
  return "bg-gray-100 text-gray-600 border-gray-300"
}

function getSourceBadgeCls(source: string): string {
  const map: Record<string, string> = {
    medusa: "bg-indigo-100 text-indigo-700 border-indigo-300",
    facebook: "bg-blue-100 text-blue-700 border-blue-300",
    zalo: "bg-sky-100 text-sky-700 border-sky-300",
    tiktok: "bg-pink-100 text-pink-700 border-pink-300",
    shopee: "bg-orange-100 text-orange-700 border-orange-300",
    manual: "bg-gray-100 text-gray-700 border-gray-300",
  }
  return map[source] ?? "bg-gray-100 text-gray-600 border-gray-300"
}

function getSourceLabel(source: string): string {
  const map: Record<string, string> = {
    medusa: "Website",
    facebook: "Facebook",
    zalo: "Zalo",
    tiktok: "TikTok",
    shopee: "Shopee",
    manual: "Thủ công",
    unknown: "Khác",
  }
  return map[source] ?? source
}

// ---- Helpers ----

function formatVND(amount: number) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(amount)) + "đ"
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatFullDate(dateStr: string) {
  if (!dateStr) return "—"
  const d = new Date(dateStr)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// ---- Component ----

const navigate = (path: string) => { window.location.href = path }

const PancakeOrderDetailPage = () => {
  const id = useOrderId()
  const [order, setOrder] = useState<any>(null)
  const [medusaOrder, setMedusaOrder] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showRaw, setShowRaw] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const fetchOrder = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch(`/admin/pancake-sync/orders/${id}`)
      if (!res.ok) {
        if (res.status === 404) throw new Error("Không tìm thấy đơn hàng")
        throw new Error(`Lỗi ${res.status}`)
      }
      const data = await res.json()
      setOrder(data.order)
      setMedusaOrder(data.medusa_order ?? null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchOrder() }, [id])

  const handleRefreshStatus = async () => {
    if (!order?.id) return
    setRefreshing(true)
    try {
      // Call the existing pancake-status proxy to get latest Pancake status
      const res = await apiFetch(`/admin/pancake-status?ids=${order.id}`)
      if (res.ok) {
        const data = await res.json()
        const statusInfo = data.statuses?.[order.id]
        if (statusInfo) {
          setOrder((prev: any) => ({
            ...prev,
            status: statusInfo.status,
            status_name: statusInfo.label,
          }))
        }
      }
    } catch (err: any) {
      console.error("Refresh status failed:", err.message)
    } finally {
      setRefreshing(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6 text-center py-16 text-gray-400">Đang tải...</div>
    )
  }

  if (error || !order) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error || "Không tìm thấy đơn hàng"}
        </div>
        <button
          onClick={() => navigate("/app/don-hang")}
          className="mt-4 text-sm text-blue-600 hover:underline"
        >
          ← Quay lại danh sách
        </button>
      </div>
    )
  }

  const items: any[] = Array.isArray(order.items) ? order.items : []
  const statusHistory: any[] = Array.isArray(order.status_history) ? order.status_history : []
  const rawAddress = order.raw?.shipping_address

  return (
    <div className="p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate("/app/don-hang")}
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          ← Quay lại
        </button>
        <h1 className="text-2xl font-bold text-gray-900">
          Đơn Pancake #{order.id}
        </h1>
        <span
          className={`text-xs font-bold px-3 py-1 rounded-full border ${getSourceBadgeCls(order.source)}`}
        >
          {getSourceLabel(order.source)}
        </span>
        <span
          className={`text-xs font-bold px-3 py-1 rounded-full border ${getStatusBadgeCls(order.status)}`}
        >
          {order.status_name || getStatusLabel(order.status)}
        </span>
        {order.data_quality === "partial" && (
          <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full border border-yellow-300">
            Dữ liệu cũ
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — main info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Customer */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <h2 className="font-semibold text-gray-700 mb-3">Khách hàng</h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-gray-400">Tên</span>
                <p className="font-semibold text-gray-900">{order.customer_name || "—"}</p>
              </div>
              <div>
                <span className="text-gray-400">SĐT</span>
                <p
                  className="font-semibold text-gray-900 cursor-copy"
                  onClick={() => {
                    if (order.customer_phone) {
                      navigator.clipboard.writeText(order.customer_phone)
                    }
                  }}
                  title="Bấm để copy"
                >
                  {order.customer_phone || "—"}
                </p>
              </div>
              <div>
                <span className="text-gray-400">Tỉnh/TP</span>
                <p className="text-gray-700">{order.province || "—"}</p>
              </div>
              <div>
                <span className="text-gray-400">Mã vận đơn</span>
                <p className="text-gray-700 font-mono text-xs">
                  {order.tracking_code || "—"}
                </p>
              </div>
            </div>
            {/* Full address from raw */}
            {rawAddress && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <span className="text-gray-400 text-sm">Địa chỉ đầy đủ</span>
                <p className="text-sm text-gray-700 mt-1">
                  {[
                    rawAddress.full_name,
                    rawAddress.address,
                    rawAddress.province_name,
                  ]
                    .filter(Boolean)
                    .join(", ") || "—"}
                </p>
              </div>
            )}
          </div>

          {/* Items */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <h2 className="font-semibold text-gray-700 mb-3">
              Sản phẩm ({order.items_count ?? items.length})
            </h2>
            {items.length === 0 ? (
              <p className="text-sm text-gray-400">Không có thông tin sản phẩm</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-100">
                    <tr className="text-left text-gray-500">
                      <th className="py-2 font-medium">Tên sản phẩm</th>
                      <th className="py-2 font-medium text-center w-16">SL</th>
                      <th className="py-2 font-medium text-right w-32">Đơn giá</th>
                      <th className="py-2 font-medium text-right w-32">Thành tiền</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {items.map((item: any, i: number) => {
                      const qty = item.qty ?? 1
                      const price = item.price ?? 0
                      const lineTotal = price * qty
                      return (
                        <tr key={i} className="text-gray-700">
                          <td className="py-2.5 font-medium">{item.name || "—"}</td>
                          <td className="py-2.5 text-center">{qty}</td>
                          <td className="py-2.5 text-right">{formatVND(price)}</td>
                          <td className="py-2.5 text-right font-semibold">
                            {formatVND(lineTotal)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-gray-200">
                      <td colSpan={3} className="py-2 text-right text-gray-500 font-medium">
                        Tổng cộng
                      </td>
                      <td className="py-2 text-right font-bold text-gray-900">
                        {formatVND(order.total)}
                      </td>
                    </tr>
                    <tr className="text-sm text-gray-500">
                      <td colSpan={3} className="py-1 text-right">Phí vận chuyển</td>
                      <td className="py-1 text-right">{formatVND(order.shipping_fee ?? 0)}</td>
                    </tr>
                    <tr className="text-sm text-gray-500">
                      <td colSpan={3} className="py-1 text-right">COD</td>
                      <td className="py-1 text-right font-medium">
                        {formatVND(order.cod_amount ?? 0)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Status timeline */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <h2 className="font-semibold text-gray-700 mb-3">Lịch sử trạng thái</h2>
            {statusHistory.length === 0 ? (
              <p className="text-sm text-gray-400">Chưa có lịch sử thay đổi trạng thái</p>
            ) : (
              <div className="relative">
                {/* Timeline line */}
                <div className="absolute left-3 top-2 bottom-2 w-0.5 bg-gray-200" />
                <div className="space-y-3">
                  {[...statusHistory].reverse().map((entry: any, i: number) => {
                    const isLatest = i === 0
                    return (
                      <div key={i} className="flex gap-3 relative">
                        <div
                          className={`w-6 h-6 rounded-full flex items-center justify-center z-10 flex-shrink-0 ${
                            isLatest
                              ? "bg-blue-500 text-white"
                              : "bg-gray-200 text-gray-500"
                          }`}
                        >
                          <span className="text-xs font-bold">
                            {isLatest ? "✓" : ""}
                          </span>
                        </div>
                        <div className="pb-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-gray-800">
                              {entry.status_name || getStatusLabel(entry.status)}
                            </span>
                            {entry.source && (
                              <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                                {entry.source}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {formatFullDate(entry.changed_at)}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            {/* Current status (when no history exists) */}
            {statusHistory.length === 0 && order.status_name && (
              <div className="flex gap-3 mt-2">
                <div className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold">✓</span>
                </div>
                <div>
                  <span className="text-sm font-semibold text-gray-800">
                    {order.status_name}
                  </span>
                  <p className="text-xs text-gray-400 mt-0.5">Hiện tại</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right column — meta */}
        <div className="space-y-4">
          {/* Quick info */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <h2 className="font-semibold text-gray-700 mb-3">Thông tin</h2>
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-gray-400">Ngày tạo</span>
                <p className="text-gray-700">
                  {formatDate(order.pancake_created_at || order.synced_at || order.created_at)}
                </p>
              </div>
              <div>
                <span className="text-gray-400">Sync lần cuối</span>
                <p className="text-gray-700">{formatDate(order.synced_at)}</p>
              </div>
              <div>
                <span className="text-gray-400">Tiền tệ</span>
                <p className="text-gray-700">{order.currency || "VND"}</p>
              </div>
              <div>
                <span className="text-gray-400">Chất lượng dữ liệu</span>
                <p className="text-gray-700">{order.data_quality === "complete" ? "Đầy đủ" : "Thiếu"}</p>
              </div>
            </div>
          </div>

          {/* Medusa link */}
          {order.medusa_order_id && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5">
              <h2 className="font-semibold text-indigo-700 mb-2">Liên kết Medusa</h2>
              {medusaOrder ? (
                <div className="space-y-1 text-sm">
                  <p className="text-indigo-600">
                    <span className="font-medium">#{medusaOrder.display_id}</span>
                  </p>
                  <p className="text-indigo-500">
                    TT: {medusaOrder.payment_status} · GH: {medusaOrder.fulfillment_status}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-indigo-500">
                  Linked: {order.medusa_order_id}
                </p>
              )}
              <a
                href={`/app/orders/${order.medusa_order_id}`}
                className="inline-block mt-2 text-sm text-indigo-600 hover:underline font-medium"
              >
                Xem trong Medusa →
              </a>
            </div>
          )}

          {/* Actions */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <h2 className="font-semibold text-gray-700 mb-3">Thao tác</h2>
            <div className="space-y-2">
              <button
                onClick={handleRefreshStatus}
                disabled={refreshing}
                className="w-full text-sm border border-gray-300 px-3 py-2 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors font-medium"
              >
                {refreshing ? "Đang refresh..." : "🔄 Refresh từ Pancake"}
              </button>
              <a
                href={`https://pancake.vn/orders/${order.id}`}
                target="_blank"
                rel="noreferrer"
                className="block text-center text-sm border border-gray-300 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors font-medium"
              >
                🔗 Mở trong Pancake
              </a>
            </div>
          </div>

          {/* Raw JSON */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <button
              onClick={() => setShowRaw(!showRaw)}
              className="w-full p-5 text-left font-semibold text-gray-700 hover:bg-gray-50 transition-colors flex justify-between items-center"
            >
              <span>📋 Raw JSON (debug)</span>
              <span className="text-gray-400 text-sm">{showRaw ? "▲" : "▼"}</span>
            </button>
            {showRaw && (
              <div className="p-4 pt-0 border-t border-gray-100">
                <pre className="text-xs text-gray-600 bg-gray-50 rounded-lg p-3 max-h-96 overflow-auto font-mono leading-relaxed">
                  {JSON.stringify(order.raw ?? {}, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Chi tiết đơn Pancake",
})

export default PancakeOrderDetailPage
