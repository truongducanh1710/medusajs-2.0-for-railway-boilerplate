import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useEffect, useMemo, useRef, useState } from "react"
import { apiFetch } from "../../lib/api-client"

// ============ Formatters ============

function formatVND(amount: number) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(amount)) + "đ"
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function todayVN(): string {
  const d = new Date(Date.now() + 7 * 3600 * 1000)
  return d.toISOString().slice(0, 10)
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00+07:00`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function startOfMonth(): string {
  const d = new Date(Date.now() + 7 * 3600 * 1000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`
}

// ============ Badges ============

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
  return <span className={`text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${s.cls}`}>{s.label}</span>
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
  return <span className={`text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${s.cls}`}>{s.label}</span>
}

// Mapping đúng theo Pancake (verify bằng status_name thật từ API)
const STATUS_VI: Record<number, string> = {
  0: "Chờ xử lý", 1: "Sale đã chốt", 2: "Đang giao", 3: "Giao thành công",
  4: "Đang hoàn về", 5: "Đã hoàn về kho", 6: "Đã hủy", 7: "Đã xóa",
  11: "Chờ hàng", [-1]: "Đã hủy", [-2]: "Hoàn hàng",
}

function getPancakeStatusLabel(status: number): string {
  return STATUS_VI[status] ?? `Trạng thái ${status}`
}

function getPancakeStatusCls(status: number): string {
  // Xanh lá = giao thành công (revenue thực thu)
  if (status === 3) return "bg-green-100 text-green-700"
  // Đỏ = hủy/xóa/hoàn về kho (mất tiền)
  if (status === 7 || status === -1 || status === 5 || status === 6) return "bg-red-100 text-red-700"
  // Tím = hoàn hàng manual / đang hoàn về
  if (status === -2 || status === 4) return "bg-purple-100 text-purple-700"
  // Xanh dương = đang vận chuyển
  if (status === 2) return "bg-blue-100 text-blue-700"
  // Vàng = chờ xử lý
  if (status === 0 || status === 11) return "bg-yellow-100 text-yellow-700"
  // Cam = sale đã chốt, chưa lên kho
  if (status === 1) return "bg-orange-100 text-orange-700"
  return "bg-gray-100 text-gray-600"
}

function SourceBadge({ source }: { source: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    medusa: { label: "🌐 Website", cls: "bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300" },
    facebook: { label: "📘 Facebook", cls: "bg-blue-100 text-blue-800 ring-1 ring-blue-300" },
    zalo: { label: "💬 Zalo", cls: "bg-sky-100 text-sky-800 ring-1 ring-sky-300" },
    tiktok: { label: "🎵 TikTok", cls: "bg-pink-100 text-pink-800 ring-1 ring-pink-300" },
    shopee: { label: "🛒 Shopee", cls: "bg-orange-100 text-orange-800 ring-1 ring-orange-300" },
    manual: { label: "✏️ Webcake", cls: "bg-yellow-100 text-yellow-800 ring-1 ring-yellow-300" },
    unknown: { label: "❓ Khác", cls: "bg-gray-100 text-gray-600 ring-1 ring-gray-300" },
  }
  const s = map[source] || { label: source, cls: "bg-gray-100 text-gray-600" }
  return <span className={`text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${s.cls}`}>{s.label}</span>
}

// ============ Constants ============

const LIMIT = 50

const SOURCES = [
  { value: "all", label: "Tất cả nguồn" },
  { value: "medusa", label: "Website" },
  { value: "facebook", label: "Facebook" },
  { value: "zalo", label: "Zalo" },
  { value: "tiktok", label: "TikTok" },
  { value: "shopee", label: "Shopee" },
  { value: "manual", label: "Webcake" },
  { value: "unknown", label: "Khác" },
]

type SortDir = "asc" | "desc"

type Filters = {
  date_from: string
  date_to: string
  source: string
  sale: string
  marketer: string
  province: string
  status: number[]   // [] = tất cả
  q: string
  min_total: string  // string để control input dễ
  max_total: string
  sort_by: string
  sort_dir: SortDir
  offset: number
}

const DEFAULT_FILTERS: Filters = {
  date_from: "",
  date_to: "",
  source: "all",
  sale: "all",
  marketer: "all",
  province: "all",
  status: [],
  q: "",
  min_total: "",
  max_total: "",
  sort_by: "pancake_created_at",
  sort_dir: "desc",
  offset: 0,
}

// ============ URL state helpers ============

function filtersToParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams()
  if (f.date_from) p.set("date_from", f.date_from)
  if (f.date_to)   p.set("date_to", f.date_to)
  if (f.source && f.source !== "all") p.set("source", f.source)
  if (f.sale && f.sale !== "all")     p.set("sale", f.sale)
  if (f.marketer && f.marketer !== "all") p.set("marketer", f.marketer)
  if (f.province && f.province !== "all") p.set("province", f.province)
  if (f.status.length) p.set("status", f.status.join(","))
  if (f.q) p.set("q", f.q)
  if (f.min_total) p.set("min_total", f.min_total)
  if (f.max_total) p.set("max_total", f.max_total)
  if (f.sort_by !== DEFAULT_FILTERS.sort_by) p.set("sort_by", f.sort_by)
  if (f.sort_dir !== DEFAULT_FILTERS.sort_dir) p.set("sort_dir", f.sort_dir)
  if (f.offset > 0) p.set("offset", String(f.offset))
  return p
}

function paramsToFilters(p: URLSearchParams): Filters {
  return {
    date_from: p.get("date_from") || "",
    date_to:   p.get("date_to") || "",
    source:    p.get("source") || "all",
    sale:      p.get("sale") || "all",
    marketer:  p.get("marketer") || "all",
    province:  p.get("province") || "all",
    status:    (p.get("status") || "").split(",").map((s) => Number(s)).filter((n) => !isNaN(n)),
    q:         p.get("q") || "",
    min_total: p.get("min_total") || "",
    max_total: p.get("max_total") || "",
    sort_by:   p.get("sort_by") || DEFAULT_FILTERS.sort_by,
    sort_dir:  (p.get("sort_dir") === "asc" ? "asc" : "desc") as SortDir,
    offset:    Number(p.get("offset")) || 0,
  }
}

// ============ Component ============

const DonHangPage = () => {
  const [filters, setFilters] = useState<Filters>(() =>
    paramsToFilters(new URLSearchParams(typeof window !== "undefined" ? window.location.search : ""))
  )
  const [searchInput, setSearchInput] = useState(filters.q)
  const [minInput, setMinInput] = useState(filters.min_total)
  const [maxInput, setMaxInput] = useState(filters.max_total)

  const [orders, setOrders] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [medusaStatuses, setMedusaStatuses] = useState<Record<string, any>>({})
  const [facets, setFacets] = useState<{
    sales: string[]; marketers: string[]; provinces: string[];
    statuses: { value: number; label: string; count: number }[];
    total: number
  }>({ sales: [], marketers: [], provinces: [], statuses: [], total: 0 })
  const [statusOpen, setStatusOpen] = useState(false)
  const statusDropdownRef = useRef<HTMLDivElement>(null)

  // Sync URL when filters change (dùng history API thay vì react-router để tránh import external)
  useEffect(() => {
    if (typeof window === "undefined") return
    const p = filtersToParams(filters)
    const newSearch = p.toString()
    const currentSearch = window.location.search.replace(/^\?/, "")
    if (newSearch !== currentSearch) {
      const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : "")
      window.history.replaceState(null, "", newUrl)
    }
  }, [filters])

  // Fetch facets theo date range (debounce 300ms để tránh spam)
  useEffect(() => {
    const id = setTimeout(() => {
      const params = new URLSearchParams()
      if (filters.date_from) params.set("from", `${filters.date_from}T00:00:00+07:00`)
      if (filters.date_to)   params.set("to",   `${filters.date_to}T23:59:59+07:00`)
      const url = params.toString()
        ? `/admin/pancake-sync/orders/facets?${params}`
        : "/admin/pancake-sync/orders/facets"
      apiFetch(url)
        .then((r) => r.ok ? r.json() : null)
        .then((d) => { if (d) setFacets(d) })
        .catch(() => {})
    }, 300)
    return () => clearTimeout(id)
  }, [filters.date_from, filters.date_to])

  // Fetch orders when filters change
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams()
    params.set("limit", String(LIMIT))
    params.set("offset", String(filters.offset))
    if (filters.date_from) params.set("from", `${filters.date_from}T00:00:00+07:00`)
    if (filters.date_to)   params.set("to",   `${filters.date_to}T23:59:59+07:00`)
    if (filters.source !== "all")   params.set("source", filters.source)
    if (filters.sale !== "all")     params.set("sale", filters.sale)
    if (filters.marketer !== "all") params.set("marketer", filters.marketer)
    if (filters.province !== "all") params.set("province", filters.province)
    if (filters.status.length)      params.set("status", filters.status.join(","))
    if (filters.q)                  params.set("q", filters.q)
    if (filters.min_total)          params.set("min_total", filters.min_total)
    if (filters.max_total)          params.set("max_total", filters.max_total)
    params.set("sort_by", filters.sort_by)
    params.set("sort_dir", filters.sort_dir)

    apiFetch(`/admin/pancake-sync/orders?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        const list = data.orders || []
        setOrders(list)
        setTotal(data.count || 0)
        const medusaIds = list.map((o: any) => o.medusa_order_id).filter(Boolean) as string[]
        if (medusaIds.length > 0) fetchMedusaStatuses(medusaIds)
        else setMedusaStatuses({})
      })
      .catch((e) => console.error(e))
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [filters])

  const fetchMedusaStatuses = async (ids: string[]) => {
    try {
      const fields = ["id", "display_id", "payment_status", "fulfillment_status"].join(",")
      const res = await apiFetch(`/admin/orders?limit=200&fields=${encodeURIComponent(fields)}&order=-created_at`)
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
    } catch {}
  }

  // Close status dropdown on outside click
  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(e.target as Node)) {
        setStatusOpen(false)
      }
    }
    if (statusOpen) document.addEventListener("mousedown", onClickOutside)
    return () => document.removeEventListener("mousedown", onClickOutside)
  }, [statusOpen])

  // ===== Handlers =====
  const update = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch, offset: patch.offset ?? 0 }))

  const applySearch = () => update({ q: searchInput, min_total: minInput, max_total: maxInput })

  const setPreset = (preset: "today" | "7d" | "30d" | "month") => {
    const today = todayVN()
    if (preset === "today")  update({ date_from: today, date_to: today })
    if (preset === "7d")     update({ date_from: shiftDate(today, -6), date_to: today })
    if (preset === "30d")    update({ date_from: shiftDate(today, -29), date_to: today })
    if (preset === "month")  update({ date_from: startOfMonth(), date_to: today })
  }

  const resetAll = () => {
    setSearchInput(""); setMinInput(""); setMaxInput("")
    setFilters({ ...DEFAULT_FILTERS })
  }

  const toggleStatus = (val: number) => {
    setFilters((f) => {
      const next = f.status.includes(val) ? f.status.filter((s) => s !== val) : [...f.status, val]
      return { ...f, status: next, offset: 0 }
    })
  }

  const handleSort = (col: string) => {
    setFilters((f) => {
      if (f.sort_by !== col) return { ...f, sort_by: col, sort_dir: "desc", offset: 0 }
      if (f.sort_dir === "desc") return { ...f, sort_dir: "asc", offset: 0 }
      // 3rd click → reset
      return { ...f, sort_by: DEFAULT_FILTERS.sort_by, sort_dir: DEFAULT_FILTERS.sort_dir, offset: 0 }
    })
  }

  const sortIcon = (col: string) => {
    if (filters.sort_by !== col) return <span className="text-gray-300 ml-1">↕</span>
    return <span className="text-blue-600 ml-1">{filters.sort_dir === "desc" ? "↓" : "↑"}</span>
  }

  // ===== Applied filter badges =====
  const appliedBadges = useMemo(() => {
    const list: { label: string; onRemove: () => void }[] = []
    if (filters.date_from || filters.date_to) {
      const lbl = filters.date_from === filters.date_to
        ? filters.date_from
        : `${filters.date_from || "..."} → ${filters.date_to || "..."}`
      list.push({ label: `📅 ${lbl}`, onRemove: () => update({ date_from: "", date_to: "" }) })
    }
    if (filters.source !== "all") list.push({ label: `Nguồn: ${filters.source}`, onRemove: () => update({ source: "all" }) })
    if (filters.sale !== "all")   list.push({ label: `Sale: ${filters.sale}`,    onRemove: () => update({ sale: "all" }) })
    if (filters.marketer !== "all") list.push({ label: `Marketer: ${filters.marketer}`, onRemove: () => update({ marketer: "all" }) })
    if (filters.province !== "all") list.push({ label: `Tỉnh: ${filters.province}`, onRemove: () => update({ province: "all" }) })
    if (filters.status.length) {
      const names = filters.status.map((s) => getPancakeStatusLabel(s)).join(", ")
      list.push({ label: `TT: ${names}`, onRemove: () => update({ status: [] }) })
    }
    if (filters.q) list.push({ label: `🔍 "${filters.q}"`, onRemove: () => { setSearchInput(""); update({ q: "" }) } })
    if (filters.min_total || filters.max_total) {
      const lbl = `${filters.min_total ? formatVND(Number(filters.min_total)) : "..."} - ${filters.max_total ? formatVND(Number(filters.max_total)) : "..."}`
      list.push({ label: `💰 ${lbl}`, onRemove: () => { setMinInput(""); setMaxInput(""); update({ min_total: "", max_total: "" }) } })
    }
    return list
  }, [filters])

  const totalPages = Math.ceil(total / LIMIT)
  const currentPage = Math.floor(filters.offset / LIMIT) + 1

  const statusLabel =
    filters.status.length === 0 ? "Tất cả" :
    filters.status.length <= 2  ? filters.status.map((s) => getPancakeStatusLabel(s)).join(", ") :
    `${filters.status.length} trạng thái`

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-5">
        <div>
          <h1 className="text-2xl font-bold">Đơn hàng</h1>
          <p className="text-gray-500 text-sm mt-1">
            {loading ? "Đang tải..." : `${total.toLocaleString("vi-VN")} đơn hàng`}
          </p>
        </div>
        <div className="flex gap-3">
          <a href="/app/pancake-sync" className="text-sm text-blue-600 hover:underline self-center">Đồng bộ Pancake →</a>
          <a href="/app/orders" className="text-sm text-gray-500 hover:underline self-center">Bảng mặc định</a>
        </div>
      </div>

      {/* ===== Filter bar row 1: date + dropdowns ===== */}
      <div className="flex flex-wrap gap-2 items-center mb-2">
        <input
          type="date"
          value={filters.date_from}
          onChange={(e) => update({ date_from: e.target.value })}
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white"
        />
        <span className="text-gray-400">→</span>
        <input
          type="date"
          value={filters.date_to}
          onChange={(e) => update({ date_to: e.target.value })}
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white"
        />
        <div className="flex gap-1">
          <button onClick={() => setPreset("today")}  className="px-2 py-1.5 text-xs border rounded hover:bg-gray-50">Hôm nay</button>
          <button onClick={() => setPreset("7d")}     className="px-2 py-1.5 text-xs border rounded hover:bg-gray-50">7d</button>
          <button onClick={() => setPreset("30d")}    className="px-2 py-1.5 text-xs border rounded hover:bg-gray-50">30d</button>
          <button onClick={() => setPreset("month")}  className="px-2 py-1.5 text-xs border rounded hover:bg-gray-50">Tháng này</button>
        </div>

        <span className="text-gray-300 mx-1">|</span>

        <select value={filters.source} onChange={(e) => update({ source: e.target.value })}
                className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white">
          {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>

        <select value={filters.sale} onChange={(e) => update({ sale: e.target.value })}
                className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white">
          <option value="all">Tất cả sale</option>
          {facets.sales.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <select value={filters.marketer} onChange={(e) => update({ marketer: e.target.value })}
                className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white">
          <option value="all">Tất cả marketer</option>
          {facets.marketers.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <select value={filters.province} onChange={(e) => update({ province: e.target.value })}
                className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white">
          <option value="all">Tất cả tỉnh</option>
          {facets.provinces.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Multi-select status */}
        <div className="relative" ref={statusDropdownRef}>
          <button
            onClick={() => setStatusOpen((o) => !o)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white hover:bg-gray-50 min-w-[140px] text-left"
          >
            Trạng thái: <span className="font-medium">{statusLabel}</span>
          </button>
          {statusOpen && (
            <div className="absolute top-full mt-1 left-0 z-20 bg-white border rounded-lg shadow-lg p-2 min-w-[240px] max-h-80 overflow-y-auto">
              <div className="flex gap-2 mb-2 pb-2 border-b">
                <button onClick={() => update({ status: facets.statuses.map((s) => s.value) })} className="text-xs text-blue-600 hover:underline">Tất cả</button>
                <button onClick={() => update({ status: [] })} className="text-xs text-gray-500 hover:underline">Bỏ chọn</button>
              </div>
              {facets.statuses.map((s) => (
                <label key={s.value} className="flex items-center gap-2 py-1 px-1 hover:bg-gray-50 rounded cursor-pointer text-sm">
                  <input type="checkbox" checked={filters.status.includes(s.value)} onChange={() => toggleStatus(s.value)} />
                  <span className={`text-xs px-2 py-0.5 rounded-full ${getPancakeStatusCls(s.value)}`}>{s.label}</span>
                  <span className="text-xs text-gray-400 ml-auto">{s.count}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <button onClick={resetAll} className="ml-auto px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded">
          Xoá lọc
        </button>
      </div>

      {/* ===== Filter bar row 2: search + price ===== */}
      <form
        onSubmit={(e) => { e.preventDefault(); applySearch() }}
        className="flex flex-wrap gap-2 items-center mb-3"
      >
        <input
          type="text"
          placeholder="🔍 Tìm SĐT / tên KH / #POS / mã vận đơn..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white flex-1 min-w-[280px] focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <input
          type="number"
          placeholder="Min ₫"
          value={minInput}
          onChange={(e) => setMinInput(e.target.value)}
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white w-28"
        />
        <span className="text-gray-400">-</span>
        <input
          type="number"
          placeholder="Max ₫"
          value={maxInput}
          onChange={(e) => setMaxInput(e.target.value)}
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white w-28"
        />
        <button type="submit" className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700">
          Tìm
        </button>
      </form>

      {/* ===== Status tabs (single-select) ===== */}
      {facets.statuses.length > 0 && (
        <div className="flex items-center gap-0 mb-3 border-b border-gray-200 overflow-x-auto">
          {/* "Tất cả" tab */}
          <button
            onClick={() => update({ status: [] })}
            className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 transition-colors ${
              filters.status.length === 0
                ? "border-blue-600 text-blue-600 font-semibold"
                : "border-transparent text-gray-600 hover:text-gray-800 hover:bg-gray-50"
            }`}
          >
            Tất cả
            <span className="ml-1.5 text-xs text-gray-500">
              {facets.total?.toLocaleString("vi-VN") ?? 0}
            </span>
          </button>

          {facets.statuses.map((s) => {
            const isActive = filters.status.length === 1 && filters.status[0] === s.value
            return (
              <button
                key={s.value}
                onClick={() => update({ status: isActive ? [] : [s.value] })}
                className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 transition-colors flex items-center gap-1.5 ${
                  isActive
                    ? "border-blue-600 text-blue-600 font-semibold"
                    : "border-transparent text-gray-600 hover:text-gray-800 hover:bg-gray-50"
                }`}
              >
                <span className={`inline-block w-2 h-2 rounded-full ${getPancakeStatusCls(s.value).split(" ")[0]}`} />
                {s.label}
                <span className="text-xs text-gray-500">{s.count.toLocaleString("vi-VN")}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* ===== Applied badges ===== */}
      {appliedBadges.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3 items-center">
          <span className="text-xs text-gray-500">Đang lọc:</span>
          {appliedBadges.map((b, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-full pl-2 pr-1 py-0.5">
              {b.label}
              <button onClick={b.onRemove} className="hover:bg-blue-200 rounded-full w-4 h-4 flex items-center justify-center">×</button>
            </span>
          ))}
        </div>
      )}

      {/* ===== Table ===== */}
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
                    <th
                      className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort("pancake_created_at")}
                    >
                      Ngày đặt{sortIcon("pancake_created_at")}
                    </th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Tên khách</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">SĐT</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Tỉnh/TP</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Sản phẩm</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Marketer</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Sale</th>
                    <th
                      className="text-right px-4 py-3 font-semibold text-gray-600 whitespace-nowrap cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort("total")}
                    >
                      Tổng tiền{sortIcon("total")}
                    </th>
                    <th
                      className="text-center px-4 py-3 font-semibold text-gray-600 whitespace-nowrap cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort("status")}
                    >
                      TT POS{sortIcon("status")}
                    </th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Thanh toán</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Giao hàng</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {orders.map((order) => {
                    const medusaInfo = order.medusa_order_id ? medusaStatuses[order.medusa_order_id] : null
                    const items: any[] = Array.isArray(order.items) ? order.items : []
                    const firstItem = items[0]
                    const itemTitle = firstItem
                      ? firstItem.name + (items.length > 1 ? ` +${items.length - 1}` : "")
                      : "—"
                    const detailUrl = order.medusa_order_id
                      ? `/app/orders/${order.medusa_order_id}`
                      : `/app/pancake-orders/${order.id}`

                    return (
                      <tr key={order.id}
                          className="hover:bg-blue-50 cursor-pointer transition-colors"
                          onClick={() => window.location.href = detailUrl}>
                        <td className="px-4 py-3 font-mono font-bold text-gray-900">
                          #{order.id}
                          {medusaInfo?.display_id && (
                            <span className="text-gray-400 font-normal ml-1 text-xs">(MD#{medusaInfo.display_id})</span>
                          )}
                        </td>
                        <td className="px-4 py-3"><SourceBadge source={order.source} /></td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                          {formatDate(order.pancake_created_at || order.synced_at || order.created_at)}
                        </td>
                        <td className="px-4 py-3 font-semibold text-gray-900 whitespace-nowrap">{order.customer_name || "—"}</td>
                        <td
                          className="px-4 py-3 text-gray-600 whitespace-nowrap"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (order.customer_phone) {
                              navigator.clipboard.writeText(order.customer_phone)
                              const el = e.currentTarget
                              const orig = el.textContent
                              el.textContent = "✓ Đã copy!"
                              el.classList.add("text-green-600")
                              setTimeout(() => { el.textContent = orig; el.classList.remove("text-green-600") }, 1200)
                            }
                          }}
                          title="Bấm để copy SĐT"
                          style={{ cursor: "copy" }}
                        >
                          {order.customer_phone || "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{order.province || "—"}</td>
                        <td className="px-4 py-3 text-gray-600 max-w-[200px] truncate" title={itemTitle}>{itemTitle}</td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap text-xs">{order.marketer_name || "—"}</td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap text-xs">{order.sale_name || "—"}</td>
                        <td className="px-4 py-3 text-right font-bold text-gray-900 whitespace-nowrap">{formatVND(order.total)}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${getPancakeStatusCls(order.status)}`}>
                            {order.status_name || getPancakeStatusLabel(order.status)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {medusaInfo ? <PaymentBadge status={medusaInfo.payment_status} /> : <span className="text-xs text-gray-400">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {medusaInfo ? <FulfillmentBadge status={medusaInfo.fulfillment_status} /> : <span className="text-xs text-gray-400">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <a href={detailUrl} onClick={(e) => e.stopPropagation()} className="text-blue-600 hover:underline whitespace-nowrap text-xs">
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
                Trang {currentPage}/{totalPages} — {total.toLocaleString("vi-VN")} đơn
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setFilters((f) => ({ ...f, offset: Math.max(0, f.offset - LIMIT) }))}
                  disabled={filters.offset === 0}
                  className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ← Trước
                </button>
                <button
                  onClick={() => setFilters((f) => ({ ...f, offset: f.offset + LIMIT }))}
                  disabled={filters.offset + LIMIT >= total}
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
