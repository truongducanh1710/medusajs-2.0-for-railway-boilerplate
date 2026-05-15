import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useEffect, useRef, useState } from "react"
import { apiFetch } from "../../lib/api-client"

// ---- Helpers ----

function todayVN(): string {
  const d = new Date()
  const vn = new Date(d.getTime() + 7 * 3600 * 1000)
  return vn.toISOString().slice(0, 10)
}

function formatDateTime(iso: string | null) {
  if (!iso) return "—"
  const d = new Date(iso)
  const pad = (x: number) => String(x).padStart(2, "0")
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatVND(n: number) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(n)) + "đ"
}

// ---- Level config ----

const LEVEL_CONFIG: Record<string, { label: string; dot: string; row: string; badge: string }> = {
  critical: {
    label: "Cực kỳ gấp",
    dot: "🔴",
    row: "bg-red-50/80",
    badge: "bg-red-100 text-red-700 ring-1 ring-red-300",
  },
  high: {
    label: "Gấp",
    dot: "🟠",
    row: "bg-orange-50/60",
    badge: "bg-orange-100 text-orange-700 ring-1 ring-orange-300",
  },
  medium: {
    label: "Bình thường",
    dot: "🟡",
    row: "",
    badge: "bg-yellow-100 text-yellow-700 ring-1 ring-yellow-300",
  },
  low: {
    label: "Thấp",
    dot: "⚪",
    row: "bg-gray-50/40",
    badge: "bg-gray-100 text-gray-500 ring-1 ring-gray-200",
  },
}

// ---- Note Modal ----

function NoteModal({ order, onClose }: { order: any; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(order.customer_phone)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded-full ${LEVEL_CONFIG[order.priority_level]?.badge}`}>
                {LEVEL_CONFIG[order.priority_level]?.dot} {LEVEL_CONFIG[order.priority_level]?.label}
              </span>
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">#{order.id}</span>
            </div>
            <h3 className="font-bold text-base mt-1">{order.customer_name}</h3>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <button
                onClick={handleCopy}
                className={`text-sm transition-colors ${copied ? "text-green-500" : "text-gray-500 hover:text-violet-600"}`}
                title="Click để copy"
              >
                {copied ? "✓ Đã copy!" : `📋 ${order.customer_phone}`}
              </button>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="bg-orange-50 rounded-lg px-3 py-2 text-sm text-orange-800">
          <span className="font-semibold">Lý do gấp:</span> {order.urgency_reason}
          {" · "}
          <span className="font-semibold">Điểm:</span> {order.priority_score}
        </div>

        <div className="text-sm text-gray-600">
          <span className="font-medium">Sản phẩm:</span> {order.product_summary || "—"}
        </div>
        <div className="text-sm text-gray-600">
          <span className="font-medium">Tổng tiền:</span> {formatVND(order.total)}
          {" · "}
          <span className="font-medium">Sale:</span> {order.sale_name || "—"}
          {" · "}
          <span className="font-medium">Tạo lúc:</span> {formatDateTime(order.pancake_created_at)}
        </div>

        {order.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {order.tags.map((t: any, i: number) => (
              <span key={i} className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">{t.name}</span>
            ))}
          </div>
        )}

        <div className="space-y-2 max-h-48 overflow-y-auto">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Lịch sử ghi chú</p>
          {order.notes?.length === 0 ? (
            <p className="text-sm text-gray-400 italic">Chưa có ghi chú</p>
          ) : (
            order.notes.map((n: any, i: number) => (
              <div key={i} className="flex gap-3 text-sm">
                <div className="flex-shrink-0 w-7 h-7 bg-violet-100 text-violet-700 rounded-full flex items-center justify-center text-xs font-bold">
                  {(n.by ?? "?")[0]?.toUpperCase()}
                </div>
                <div className="flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium">{n.by || "—"}</span>
                    <span className="text-xs text-gray-400">{formatDateTime(n.at)}</span>
                  </div>
                  <p className="text-gray-700 mt-0.5 whitespace-pre-line">{n.message}</p>
                </div>
              </div>
            ))
          )}
        </div>

        {order.pancake_link && (
          <a
            href={order.pancake_link}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center px-4 py-2 bg-violet-600 text-white text-sm rounded-lg hover:bg-violet-700 transition-colors"
          >
            Mở trên Pancake →
          </a>
        )}
      </div>
    </div>
  )
}

// ---- Main page ----

const UuTienGoiPage = () => {
  const [orders, setOrders] = useState<any[]>([])
  const [summary, setSummary] = useState<any>({})
  const [sellers, setSellers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [date, setDate] = useState(todayVN)
  const [sellerFilter, setSellerFilter] = useState("")
  const [selectedOrder, setSelectedOrder] = useState<any>(null)
  const [lastRefresh, setLastRefresh] = useState(new Date())
  const [syncing, setSyncing] = useState(false)
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null)

  const copyPhone = (phone: string, e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(phone)
    setCopiedPhone(phone)
    setTimeout(() => setCopiedPhone(null), 1500)
  }

  const fetchData = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ date })
      if (sellerFilter) params.set("seller", sellerFilter)
      const res = await apiFetch(`/admin/pancake-sync/call-board/priority?${params}`)
      if (!res.ok) return
      const data = await res.json()
      setOrders(data.orders ?? [])
      setSummary(data.summary ?? {})
      setSellers(data.sellers ?? [])
      setLastRefresh(new Date())
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const syncAndRefresh = async (silent = false) => {
    if (!silent) setSyncing(true)
    try {
      await apiFetch("/admin/pancake-sync/active-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
      await fetchData()
    } finally {
      if (!silent) setSyncing(false)
    }
  }

  // Mount lần đầu: chỉ fetch data từ DB, không sync Pancake (để tiết kiệm)
  // User bấm "Đồng bộ & làm mới" khi cần data mới nhất
  const didInit = useRef(false)
  useEffect(() => {
    if (didInit.current) return
    didInit.current = true
    fetchData()
  }, [])

  // Refetch khi filter thay đổi
  useEffect(() => { fetchData() }, [date, sellerFilter])

  // Auto-refresh đã tắt để tiết kiệm chi phí — user dùng nút "Đồng bộ" thủ công

  const minutesAgo = Math.floor((Date.now() - lastRefresh.getTime()) / 60000)

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Bảng Ưu Tiên Gọi</h1>
          <p className="text-sm text-gray-400">
            Cập nhật {minutesAgo === 0 ? "vừa xong" : `${minutesAgo} phút trước`}
            {" · "}Sắp xếp theo độ gấp — đơn nào gọi trước
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => syncAndRefresh(false)}
            disabled={syncing}
            className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm hover:bg-violet-700 transition-colors disabled:opacity-50"
          >
            {syncing ? "⏳ Đang đồng bộ..." : "📥 Đồng bộ & làm mới"}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Tổng cần gọi", value: summary.total ?? 0, cls: "bg-gray-50", dot: "" },
          { label: "Cực kỳ gấp 🔴", value: summary.critical ?? 0, cls: "bg-red-50", dot: "🔴" },
          { label: "Gấp 🟠", value: summary.high ?? 0, cls: "bg-orange-50", dot: "🟠" },
          { label: "Bình thường 🟡", value: summary.medium ?? 0, cls: "bg-yellow-50", dot: "🟡" },
        ].map((card) => (
          <div key={card.label} className={`${card.cls} rounded-xl p-4`}>
            <div className="text-2xl font-bold">{card.value}</div>
            <div className="text-xs text-gray-500 mt-1">{card.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
        />
        <select
          value={sellerFilter}
          onChange={(e) => setSellerFilter(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
        >
          <option value="">Tất cả Sale</option>
          {sellers.map((s) => (
            <option key={s.id} value={s.name}>{s.name}</option>
          ))}
        </select>
        <span className="text-sm text-gray-400">{orders.length} đơn cần xử lý</span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">Đang tải...</div>
      ) : orders.length === 0 ? (
        <div className="text-center py-16 text-gray-400">Không có đơn nào cần xử lý 🎉</div>
      ) : (
        <div className="border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-center px-3 py-3 font-medium text-gray-600 w-10">#</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Khách hàng</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden md:table-cell">Sản phẩm</th>
                <th className="text-left px-3 py-3 font-medium text-gray-600">Sale</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Lý do gấp</th>
                <th className="text-center px-3 py-3 font-medium text-gray-600">Giờ</th>
                <th className="text-center px-3 py-3 font-medium text-gray-600">Điểm</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o, idx) => {
                const cfg = LEVEL_CONFIG[o.priority_level] ?? LEVEL_CONFIG.low
                return (
                  <tr
                    key={o.id}
                    className={`border-b last:border-0 cursor-pointer hover:bg-violet-50 transition-colors ${cfg.row}`}
                    onClick={() => setSelectedOrder(o)}
                  >
                    <td className="px-3 py-3 text-center">
                      <span className="text-base">{cfg.dot}</span>
                      <div className="text-xs text-gray-400 mt-0.5">{idx + 1}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{o.customer_name}</div>
                      <button
                        onClick={(e) => copyPhone(o.customer_phone, e)}
                        className={`text-xs mt-0.5 transition-colors ${copiedPhone === o.customer_phone ? "text-green-500" : "text-gray-400 hover:text-violet-600"}`}
                        title="Click để copy"
                      >
                        {copiedPhone === o.customer_phone ? "✓ Đã copy!" : o.customer_phone}
                      </button>
                      <div className="text-gray-300 text-xs">#{o.id}</div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-gray-600 max-w-xs truncate">
                      {o.product_summary || "—"}
                    </td>
                    <td className="px-3 py-3 text-gray-600 text-xs">{o.sale_name || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${cfg.badge}`}>
                        {o.urgency_reason}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-center text-xs text-gray-500">
                      {o.hours_old >= 1 ? `${Math.round(o.hours_old)}h` : `${Math.round(o.hours_old * 60)}p`}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={`text-sm font-bold ${o.priority_level === "critical" ? "text-red-600" : o.priority_level === "high" ? "text-orange-500" : "text-gray-500"}`}>
                        {o.priority_score}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedOrder && (
        <NoteModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />
      )}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Ưu tiên gọi",
})

export default UuTienGoiPage
