import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useEffect, useRef, useState } from "react"
import { apiFetch } from "../../lib/api-client"

// ---- Helpers ----

function formatVND(n: number) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(n)) + "đ"
}

function formatDateTime(iso: string | null) {
  if (!iso) return "—"
  const d = new Date(iso)
  const pad = (x: number) => String(x).padStart(2, "0")
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function todayVN() {
  const d = new Date()
  // Shift to VN time (UTC+7)
  const vn = new Date(d.getTime() + 7 * 3600 * 1000)
  return vn.toISOString().slice(0, 10)
}

// ---- Status badge ----

const ACTION_BADGE: Record<string, { label: string; cls: string }> = {
  no_action: { label: "Chưa tác động", cls: "bg-red-100 text-red-700 ring-1 ring-red-300" },
  called:    { label: "Đã gọi",        cls: "bg-blue-100 text-blue-700 ring-1 ring-blue-300" },
  knm_1:     { label: "KNM lần 1",     cls: "bg-yellow-100 text-yellow-800 ring-1 ring-yellow-300" },
  knm_2:     { label: "KNM lần 2",     cls: "bg-orange-100 text-orange-700 ring-1 ring-orange-300" },
  knm_3:     { label: "KNM lần 3 ⚠️", cls: "bg-red-100 text-red-700 ring-1 ring-red-400 font-semibold" },
  confirmed: { label: "Đã xác nhận",   cls: "bg-green-100 text-green-700 ring-1 ring-green-300" },
  cancelled: { label: "Đã hủy",        cls: "bg-gray-100 text-gray-500 ring-1 ring-gray-300" },
  send:      { label: "Cho đi",         cls: "bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300" },
}

const SOURCE_BADGE: Record<string, string> = {
  medusa:   "🌐",
  facebook: "📘",
  zalo:     "💬",
  tiktok:   "🎵",
  shopee:   "🛒",
  manual:   "✏️",
  unknown:  "❓",
}

// ---- Note timeline modal ----

function NoteModal({ order, onClose }: { order: any; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(order.customer_phone)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-bold text-base">{order.customer_name}</h3>
            <div className="flex items-center gap-2 flex-wrap mt-0.5">
              <button
                onClick={handleCopy}
                className={`text-sm transition-colors ${copied ? "text-green-500" : "text-gray-500 hover:text-violet-600"}`}
                title="Click để copy số điện thoại"
              >
                {copied ? "✓ Đã copy!" : `📋 ${order.customer_phone}`}
              </button>
              {order.id && (
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">#{order.id}</span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="text-sm text-gray-600">
          <span className="font-medium">Sản phẩm:</span> {order.product_summary || "—"}
        </div>
        <div className="text-sm text-gray-600">
          <span className="font-medium">Tổng tiền:</span> {formatVND(order.total)}
          {" · "}
          <span className="font-medium">Sale:</span> {order.sale_name || "—"}
        </div>

        {/* Tags */}
        {order.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {order.tags.map((t: any, i: number) => (
              <span key={i} className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                {t.name}
              </span>
            ))}
          </div>
        )}

        {/* Notes timeline */}
        <div className="space-y-2 max-h-60 overflow-y-auto">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Lịch sử ghi chú</p>
          {order.notes?.length === 0 ? (
            <p className="text-sm text-gray-400 italic">Chưa có ghi chú nào</p>
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

const XacNhanDonPage = () => {
  const [orders, setOrders] = useState<any[]>([])
  const [summary, setSummary] = useState<any>({})
  const [sellers, setSellers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [date, setDate] = useState(todayVN)
  const [sellerFilter, setSellerFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [selectedOrder, setSelectedOrder] = useState<any>(null)
  const [lastRefresh, setLastRefresh] = useState(new Date())
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null)
  const LIMIT = 50

  const copyPhone = (phone: string, e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(phone)
    setCopiedPhone(phone)
    setTimeout(() => setCopiedPhone(null), 1500)
  }

  const fetchData = async (p = page) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        date,
        limit: String(LIMIT),
        page: String(p),
        status_filter: statusFilter,
      })
      if (sellerFilter) params.set("seller", sellerFilter)
      const res = await apiFetch(`/admin/pancake-sync/call-board?${params}`)
      if (!res.ok) return
      const data = await res.json()
      setOrders(data.orders ?? [])
      setTotal(data.total ?? 0)
      setSummary(data.summary ?? {})
      setSellers(data.sellers ?? [])
      setLastRefresh(new Date())
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  // Sync active orders (status=0) từ Pancake — silent option để auto-trigger không hiện msg
  const syncActiveOrders = async (silent = false) => {
    setSyncing(true)
    if (!silent) setSyncMsg(null)
    try {
      const res = await apiFetch("/admin/pancake-sync/active-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
      const data = await res.json()
      if (res.status === 429) {
        if (!silent) setSyncMsg(data.error ?? "Đang sync, thử lại sau")
      } else if (res.ok) {
        if (!silent) setSyncMsg(`✓ ${data.updated} cập nhật / ${data.created} mới / ${data.total} tổng`)
        await fetchData(page)
      } else {
        if (!silent) setSyncMsg("Sync thất bại")
      }
    } catch {
      if (!silent) setSyncMsg("Lỗi kết nối")
    } finally {
      setSyncing(false)
      if (!silent) setTimeout(() => setSyncMsg(null), 5000)
    }
  }

  // Auto-sync khi mount lần đầu (silent — không hiện msg)
  const didInitSync = useRef(false)
  useEffect(() => {
    if (didInitSync.current) return
    didInitSync.current = true
    syncActiveOrders(true)
  }, [])

  // Fetch khi filter thay đổi
  useEffect(() => {
    setPage(0)
    fetchData(0)
  }, [date, sellerFilter, statusFilter])

  // Auto-refresh đã tắt để tiết kiệm chi phí — user dùng nút "Đồng bộ" thủ công

  const minutesAgo = Math.floor((Date.now() - lastRefresh.getTime()) / 60000)

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Bảng Xác Nhận Đơn</h1>
          <p className="text-sm text-gray-400">
            Cập nhật {minutesAgo === 0 ? "vừa xong" : `${minutesAgo} phút trước`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {syncMsg && (
            <span className="text-xs text-gray-500">{syncMsg}</span>
          )}
          <button
            onClick={() => syncActiveOrders(false)}
            disabled={syncing}
            className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm hover:bg-violet-700 transition-colors disabled:opacity-50"
          >
            {syncing ? "⏳ Đang đồng bộ..." : "📥 Đồng bộ Pancake"}
          </button>
          <button
            onClick={() => fetchData(page)}
            className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50 transition-colors"
          >
            🔄 Làm mới
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {[
          { label: "Tổng đơn", value: summary.total ?? 0, cls: "bg-gray-50", filter: "all" },
          { label: "Chưa tác động", value: summary.no_action ?? 0, cls: "bg-red-50", filter: "no_action" },
          { label: "KNM", value: summary.knm ?? 0, cls: "bg-yellow-50", filter: "knm" },
          { label: "KNM lần 3", value: summary.knm_3 ?? 0, cls: "bg-orange-50", filter: "knm" },
          { label: "Đã xác nhận", value: summary.confirmed ?? 0, cls: "bg-green-50", filter: "confirmed" },
          { label: "Quá hạn", value: summary.overdue ?? 0, cls: "bg-red-100", filter: "no_action" },
        ].map((card) => (
          <button
            key={card.label}
            onClick={() => setStatusFilter(card.filter)}
            className={`${card.cls} rounded-xl p-4 text-left hover:ring-2 hover:ring-violet-400 transition-all ${
              statusFilter === card.filter ? "ring-2 ring-violet-500" : ""
            }`}
          >
            <div className="text-2xl font-bold">{card.value}</div>
            <div className="text-xs text-gray-500 mt-1">{card.label}</div>
          </button>
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
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
        >
          <option value="all">Tất cả trạng thái</option>
          <option value="no_action">Chưa tác động</option>
          <option value="knm">KNM (1-3 lần)</option>
          <option value="confirmed">Đã xác nhận</option>
          <option value="cancelled">Đã hủy</option>
        </select>
        <span className="text-sm text-gray-400">{total} đơn</span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">Đang tải...</div>
      ) : orders.length === 0 ? (
        <div className="text-center py-16 text-gray-400">Không có đơn nào trong ngày này</div>
      ) : (
        <div className="border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Khách hàng</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden md:table-cell">Sản phẩm</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Tổng tiền</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden lg:table-cell">Sale</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Tình trạng</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden md:table-cell">Giờ tạo</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const badge = ACTION_BADGE[o.action_status] ?? { label: o.action_status, cls: "bg-gray-100 text-gray-500" }
                const lastNote = o.notes?.[o.notes.length - 1]
                return (
                  <tr
                    key={o.id}
                    className={`border-b last:border-0 cursor-pointer hover:bg-violet-50 transition-colors ${
                      o.is_overdue ? "bg-red-50" : ""
                    }`}
                    onClick={() => setSelectedOrder(o)}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium">{o.customer_name}</div>
                      <button
                        onClick={(e) => copyPhone(o.customer_phone, e)}
                        className={`text-xs mt-0.5 transition-colors ${copiedPhone === o.customer_phone ? "text-green-500" : "text-gray-400 hover:text-violet-600"}`}
                        title="Click để copy số điện thoại"
                      >
                        {copiedPhone === o.customer_phone ? "✓ Đã copy!" : o.customer_phone}
                      </button>
                      {o.id && <div className="text-gray-300 text-xs">#{o.id}</div>}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-gray-600 max-w-xs truncate">
                      {o.product_summary || "—"}
                    </td>
                    <td className="px-4 py-3 font-medium">{formatVND(o.total)}</td>
                    <td className="px-4 py-3 hidden lg:table-cell text-gray-600">{o.sale_name || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${badge.cls}`}>
                        {badge.label}
                      </span>
                      {lastNote && (
                        <div className="text-xs text-gray-400 mt-1">
                          {lastNote.by} · {formatDateTime(lastNote.at)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-gray-400 text-xs">
                      {formatDateTime(o.pancake_created_at)}
                      {o.is_overdue && (
                        <div className="text-red-500 font-medium">⚠️ Quá hạn</div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {total > LIMIT && (
        <div className="flex justify-between items-center text-sm text-gray-500">
          <button
            onClick={() => { setPage((p) => Math.max(0, p - 1)); fetchData(Math.max(0, page - 1)) }}
            disabled={page === 0}
            className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-gray-50"
          >
            ← Trước
          </button>
          <span>Trang {page + 1} / {Math.ceil(total / LIMIT)}</span>
          <button
            onClick={() => { setPage((p) => p + 1); fetchData(page + 1) }}
            disabled={(page + 1) * LIMIT >= total}
            className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-gray-50"
          >
            Sau →
          </button>
        </div>
      )}

      {/* Note detail modal */}
      {selectedOrder && (
        <NoteModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />
      )}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Xác nhận đơn",
})

export default XacNhanDonPage
