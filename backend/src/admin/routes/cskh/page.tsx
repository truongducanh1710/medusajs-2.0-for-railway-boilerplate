import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useEffect, useMemo, useRef, useState } from "react"
import { apiFetch } from "../../lib/api-client"
import { useResizableColumns, type ColumnDef as ResizableColDef } from "../../lib/resizable-columns"
import { useCurrentPermissions } from "../../lib/use-permissions"

// ============ Helpers ============

function todayVN(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)
}

function formatTime(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatVND(v: number | string | null): string {
  if (!v) return "—"
  return new Intl.NumberFormat("vi-VN").format(Number(v)) + "đ"
}

function elapsedLabel(iso: string | null): string {
  if (!iso) return ""
  const ms = Date.now() - new Date(iso).getTime()
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  if (h >= 24) return `${Math.floor(h / 24)}n ${h % 24}h`
  return h > 0 ? `${h}h${m}m` : `${m}m`
}

function isCallTimeOverdue(callTime: string | null): boolean {
  if (!callTime) return false
  return new Date(callTime).getTime() < Date.now()
}

function isCallTimeSoon(callTime: string | null): boolean {
  if (!callTime) return false
  const diff = new Date(callTime).getTime() - Date.now()
  return diff > 0 && diff < 3600000
}

// ============ Badges ============

function UrgencyBadge({ urgency }: { urgency: string | null }) {
  const map: Record<string, { label: string; cls: string }> = {
    critical: { label: "🚨 Khẩn", cls: "bg-red-100 text-red-700 animate-pulse" },
    high:     { label: "🔴 Cao",  cls: "bg-orange-100 text-orange-700" },
    medium:   { label: "🟡 TB",   cls: "bg-yellow-100 text-yellow-700" },
    low:      { label: "🟢 Thấp", cls: "bg-green-100 text-green-700" },
  }
  const s = urgency ? (map[urgency] ?? { label: urgency, cls: "bg-gray-100 text-gray-600" }) : null
  if (!s) return null
  return <span className={`text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${s.cls}`}>{s.label}</span>
}

function StatusBadge({ status, statusName }: { status: number; statusName: string }) {
  const cls =
    status === 2 ? "bg-blue-100 text-blue-700" :
    status === 4 ? "bg-purple-100 text-purple-700" :
    "bg-gray-100 text-gray-600"
  return <span className={`text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${cls}`}>{statusName}</span>
}

function CallTimeBadge({ callTime }: { callTime: string | null }) {
  if (!callTime) return <span className="text-gray-400 text-xs">—</span>
  const overdue = isCallTimeOverdue(callTime)
  const soon = isCallTimeSoon(callTime)
  const label = formatTime(callTime)
  if (overdue) return <span className="text-xs font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded">⏰ {label} QUÁ GIỜ</span>
  if (soon)    return <span className="text-xs font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded">⏳ {label}</span>
  return <span className="text-xs text-gray-700 bg-gray-100 px-2 py-0.5 rounded">{label}</span>
}

function MissingHoanTagBadge({ missing }: { missing: boolean }) {
  if (!missing) return null
  return <span className="text-xs font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded">⚠️ Chưa gắn lý do hoàn</span>
}

// ============ Row background ============

function getRowCls(order: any): string {
  if (order.urgency === "critical") return "bg-red-50 border-l-4 border-red-500"
  if (order.missing_hoan_tag)       return "bg-red-50 border-l-4 border-red-400"
  if (order.urgency === "high")     return "bg-orange-50 border-l-4 border-orange-400"
  if (isCallTimeOverdue(order.call_time)) return "bg-orange-50 border-l-4 border-orange-300"
  if (order.category === "dang_hoan")     return "bg-purple-50 border-l-4 border-purple-300"
  if (order.category === "tre_giao")      return "bg-yellow-50 border-l-4 border-yellow-300"
  if (order.row_type === "plain")         return "bg-gray-50"
  return ""
}

// ============ Summary bar ============

function SummaryBar({
  orders, activeTab, onTabChange, onRefresh, loading, analyzedAt, onAnalyze, analyzing,
}: {
  orders: any[]
  activeTab: string
  onTabChange: (t: string) => void
  onRefresh: () => void
  loading: boolean
  analyzedAt: string | null
  onAnalyze: () => void
  analyzing: boolean
}) {
  const counts = useMemo(() => ({
    su_co: orders.filter(o => o.category === "su_co").length,
    dang_hoan: orders.filter(o => o.category === "dang_hoan").length,
    tre_giao: orders.filter(o => o.category === "tre_giao").length,
    binh_thuong: orders.filter(o => o.category === "binh_thuong").length,
    missing_hoan: orders.filter(o => o.missing_hoan_tag).length,
  }), [orders])

  const tabs = [
    { key: "su_co",      label: "🔴 Giao không thành", count: counts.su_co },
    { key: "dang_hoan",  label: "🟣 Đang hoàn về",     count: counts.dang_hoan },
    { key: "tre_giao",   label: "🟠 Trễ giao",         count: counts.tre_giao },
    { key: "binh_thuong",label: "🔵 Đang giao",        count: counts.binh_thuong },
    { key: "all",        label: "Tất cả",              count: orders.length },
  ]

  return (
    <div className="mb-4">
      <div className="flex items-center gap-3 flex-wrap mb-3">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => onTabChange(t.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              activeTab === t.key
                ? "bg-ui-bg-base-pressed border-ui-border-strong text-ui-fg-base shadow-sm"
                : "bg-ui-bg-subtle border-ui-border-base text-ui-fg-subtle hover:bg-ui-bg-base"
            }`}
          >
            {t.label}
            <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs font-bold ${
              t.count > 0 ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-500"
            }`}>{t.count}</span>
          </button>
        ))}
        {counts.missing_hoan > 0 && (
          <span className="text-xs font-bold text-red-600 bg-red-50 px-2 py-1 rounded border border-red-200">
            ⚠️ {counts.missing_hoan} đơn hoàn chưa gắn lý do
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={onAnalyze}
            disabled={analyzing}
            className="px-3 py-1.5 text-sm bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-50"
          >
            {analyzing ? "⏳ Đang phân tích..." : "🤖 Phân tích AI"}
          </button>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="px-3 py-1.5 text-sm bg-ui-bg-base border border-ui-border-base rounded hover:bg-ui-bg-subtle disabled:opacity-50"
          >
            {loading ? "⏳" : "↻"} Làm mới
          </button>
          {analyzedAt && (
            <span className="text-xs text-ui-fg-muted">Phân tích lúc {analyzedAt}</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ============ Main page ============

export default function CskhPage() {
  const { has, loading: permLoading } = useCurrentPermissions()

  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [analyzedAt, setAnalyzedAt] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(Date.now())

  // Filter state
  const [careFilter, setCareFilter] = useState<string>("")
  const [careList, setCareList] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState(() => {
    const p = new URLSearchParams(window.location.search)
    return p.get("tab") || "su_co"
  })

  const cancelRef = useRef(false)

  // Countdown tick mỗi 30s
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  // Auto-refresh 10 phút
  useEffect(() => {
    const id = setInterval(fetchOrders, 10 * 60 * 1000)
    return () => clearInterval(id)
  }, [careFilter])

  async function fetchOrders() {
    cancelRef.current = false
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({ limit: "200" })
      if (careFilter) qs.set("care", careFilter)

      const data = await apiFetch(`/admin/cskh/orders?${qs}`)
      if (cancelRef.current) return

      const list = data.orders ?? []
      setOrders(list)
      setAnalyzedAt(formatTime(new Date().toISOString()))

      // Build care list from orders
      const cares = Array.from(new Set(list.map((o: any) => o.care_name).filter(Boolean))) as string[]
      setCareList(cares.sort())
    } catch (e: any) {
      if (!cancelRef.current) setError(e.message)
    } finally {
      if (!cancelRef.current) setLoading(false)
    }
  }

  async function triggerAnalyze() {
    setAnalyzing(true)
    try {
      await apiFetch("/admin/cskh/analyze", {
        method: "POST",
        body: JSON.stringify({ care: careFilter || undefined }),
      })
      // Đợi 15s rồi reload
      setTimeout(fetchOrders, 15_000)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setTimeout(() => setAnalyzing(false), 15_000)
    }
  }

  useEffect(() => {
    fetchOrders()
    return () => { cancelRef.current = true }
  }, [careFilter])

  function handleTabChange(tab: string) {
    setActiveTab(tab)
    window.history.replaceState(null, "", `?tab=${tab}`)
  }

  // Lọc theo tab
  const filtered = useMemo(() => {
    if (activeTab === "all") return orders
    if (activeTab === "missing_hoan") return orders.filter(o => o.missing_hoan_tag)
    return orders.filter(o => o.category === activeTab)
  }, [orders, activeTab])

  // Columns
  const columns: ResizableColDef[] = [
    { key: "id",         label: "Mã đơn",         defaultWidth: 90  },
    { key: "customer",   label: "Khách + SĐT",     defaultWidth: 180 },
    { key: "province",   label: "Tỉnh/TP",         defaultWidth: 110 },
    { key: "care",       label: "CSKH",            defaultWidth: 100 },
    { key: "status",     label: "Trạng thái",      defaultWidth: 110 },
    { key: "delivery",   label: "Lần giao",        defaultWidth: 70  },
    { key: "shipper",    label: "Bưu tá + SĐT",    defaultWidth: 180 },
    { key: "last_ship",  label: "Cập nhật ship",   defaultWidth: 200 },
    { key: "cod",        label: "COD",             defaultWidth: 90  },
    { key: "step",       label: "🤖 Đang ở bước",  defaultWidth: 240 },
    { key: "action",     label: "🤖 Việc tiếp theo",defaultWidth: 220 },
    { key: "call_time",  label: "Gọi lúc",         defaultWidth: 110 },
  ]

  const { colWidths, onMouseDown } = useResizableColumns(columns, "cskh.col-widths.v1")

  if (permLoading) return <div className="p-6 text-ui-fg-muted">Đang kiểm tra quyền...</div>
  if (!has("page.cskh.view")) return <div className="p-6 text-red-500">Bạn không có quyền xem trang này.</div>

  return (
    <div className="p-4">
      <div className="flex items-center gap-4 mb-4">
        <h1 className="text-xl font-bold text-ui-fg-base">CSKH — Theo dõi vận đơn</h1>
        <select
          value={careFilter}
          onChange={e => setCareFilter(e.target.value)}
          className="px-3 py-1.5 border border-ui-border-base rounded text-sm bg-ui-bg-base text-ui-fg-base"
        >
          <option value="">Tất cả CSKH</option>
          {careList.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <SummaryBar
        orders={orders}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onRefresh={fetchOrders}
        loading={loading}
        analyzedAt={analyzedAt}
        onAnalyze={triggerAnalyze}
        analyzing={analyzing}
      />

      {error && (
        <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>
      )}

      {loading && !orders.length ? (
        <div className="p-8 text-center text-ui-fg-muted">Đang tải...</div>
      ) : (
        <div className="overflow-x-auto rounded border border-ui-border-base">
          <table className="w-full text-sm border-collapse" style={{ minWidth: 1400 }}>
            <thead className="bg-ui-bg-subtle sticky top-0 z-10">
              <tr>
                {columns.map((col, i) => (
                  <th
                    key={col.key}
                    className="text-left px-3 py-2 text-ui-fg-subtle font-medium border-b border-ui-border-base select-none relative whitespace-nowrap"
                    style={{ width: colWidths[i] }}
                  >
                    {col.label}
                    {i < columns.length - 1 && (
                      <div
                        onMouseDown={onMouseDown(i)}
                        className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-ui-border-strong"
                      />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={columns.length} className="text-center py-12 text-ui-fg-muted">
                    {activeTab === "su_co" ? "Không có đơn giao không thành 🎉" : "Không có đơn nào"}
                  </td>
                </tr>
              )}
              {filtered.map((order: any) => (
                <tr
                  key={order.id}
                  className={`border-b border-ui-border-base cursor-pointer hover:brightness-95 transition-all ${getRowCls(order)}`}
                  onClick={() => { window.location.href = `/app/pancake-orders/${order.id}` }}
                >
                  {/* Mã đơn */}
                  <td className="px-3 py-2 font-mono text-xs text-ui-fg-base whitespace-nowrap">
                    #{order.id}
                    {order.urgency === "critical" && <span className="ml-1 text-red-600 animate-pulse">🚨</span>}
                  </td>

                  {/* Khách */}
                  <td className="px-3 py-2">
                    <div className="font-medium text-ui-fg-base text-xs leading-tight">{order.customer_name}</div>
                    <div
                      className="text-xs text-ui-fg-muted font-mono mt-0.5 cursor-pointer hover:text-blue-600"
                      onClick={e => {
                        e.stopPropagation()
                        navigator.clipboard.writeText(order.customer_phone ?? "")
                      }}
                      title="Click để copy"
                    >
                      {order.customer_phone}
                    </div>
                  </td>

                  {/* Tỉnh */}
                  <td className="px-3 py-2 text-xs text-ui-fg-subtle whitespace-nowrap">{order.province ?? "—"}</td>

                  {/* CSKH */}
                  <td className="px-3 py-2 text-xs text-ui-fg-base whitespace-nowrap">{order.care_name ?? "—"}</td>

                  {/* Trạng thái */}
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex flex-col gap-1">
                      <StatusBadge status={order.status} statusName={order.status_name} />
                      <MissingHoanTagBadge missing={order.missing_hoan_tag} />
                    </div>
                  </td>

                  {/* Lần giao */}
                  <td className="px-3 py-2 text-center">
                    <span className={`text-sm font-bold ${Number(order.count_of_delivery) >= 3 ? "text-red-600" : "text-ui-fg-base"}`}>
                      {order.count_of_delivery ?? "—"}
                    </span>
                  </td>

                  {/* Bưu tá */}
                  <td className="px-3 py-2">
                    {order.delivery_name ? (
                      <>
                        <div className="text-xs font-medium text-ui-fg-base leading-tight">{order.delivery_name}</div>
                        <div
                          className="text-xs text-ui-fg-muted font-mono mt-0.5 cursor-pointer hover:text-blue-600"
                          onClick={e => {
                            e.stopPropagation()
                            navigator.clipboard.writeText(order.delivery_tel ?? "")
                          }}
                          title="Click để copy"
                        >
                          {order.delivery_tel}
                        </div>
                      </>
                    ) : <span className="text-xs text-ui-fg-muted">—</span>}
                  </td>

                  {/* Cập nhật ship */}
                  <td className="px-3 py-2">
                    {order.last_delivery_status ? (
                      <>
                        <div className="text-xs text-ui-fg-base leading-tight line-clamp-2">{order.last_delivery_status}</div>
                        <div className="text-xs text-ui-fg-muted mt-0.5">{formatDateTime(order.last_delivery_at)}</div>
                      </>
                    ) : <span className="text-xs text-ui-fg-muted">—</span>}
                  </td>

                  {/* COD */}
                  <td className="px-3 py-2 text-right text-xs font-medium text-ui-fg-base whitespace-nowrap">
                    {formatVND(order.cod_amount)}
                  </td>

                  {/* AI: Đang ở bước */}
                  <td className="px-3 py-2">
                    {order.current_step ? (
                      <div className="text-xs text-ui-fg-base leading-snug line-clamp-3">{order.current_step}</div>
                    ) : order.row_type === "plain" ? (
                      <span className="text-xs text-ui-fg-muted italic">Logic cứng — không cần AI</span>
                    ) : (
                      <span className="text-xs text-ui-fg-muted italic">Chưa phân tích</span>
                    )}
                  </td>

                  {/* AI: Việc tiếp theo */}
                  <td className="px-3 py-2">
                    {order.next_action ? (
                      <div className="text-xs text-orange-700 font-medium leading-snug line-clamp-2">{order.next_action}</div>
                    ) : <span className="text-xs text-ui-fg-muted">—</span>}
                  </td>

                  {/* Gọi lúc */}
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex flex-col gap-1">
                      <CallTimeBadge callTime={order.call_time} />
                      {order.urgency && <UrgencyBadge urgency={order.urgency} />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 text-xs text-ui-fg-muted">
        Hiển thị {filtered.length} / {orders.length} đơn •
        AI đã phân tích: {orders.filter(o => o.analyzed_at).length} đơn •
        Chỉ đơn Manual/Facebook/Zalo
      </div>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "CSKH Vận đơn",
})
