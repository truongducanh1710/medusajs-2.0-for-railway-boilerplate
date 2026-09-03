import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useEffect, useState, useRef, useContext, createContext, Fragment } from "react"
import { apiFetch, apiJson } from "../../lib/api-client"
import { withRouteGuard } from "../../components/route-guard"
import { useCurrentPermissions } from "../../lib/use-permissions"
import { useResizableColumns, ResizeHandle, type ColumnDef } from "../../lib/resizable-columns"

// ---- Currency display context ----
// Cho phép mọi Tab format tiền đúng theo market đang chọn (VN → VND, MY → MYR/VND quy đổi)
// mà không phải truyền prop qua từng lời gọi fmtVND() rải rác trong file.
const CurrencyCtx = createContext<{ market: Market; currencyMode: CurrencyMode; rate: number }>({
  market: "VN", currencyMode: "MYR", rate: 5800,
})

// ---- Helpers ----
function fmtVND(n: number | null | undefined) {
  if (n == null || isNaN(Number(n))) return "—"
  const v = Number(n)
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}tỷ`
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}tr`
  return new Intl.NumberFormat("vi-VN").format(Math.round(v)) + "đ"
}
// Ngưỡng %chi phí ads/doanh số — khớp quy ước ở tab Báo cáo MKT (carePctColor).
function carePctColor(pct: number | null): string {
  if (pct === null) return "#6b7280"
  if (pct < 30) return "#16a34a"
  if (pct <= 35) return "#d97706"
  return "#dc2626"
}
function fmtMYR(n: number) {
  return `RM ${new Intl.NumberFormat("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`
}
// Format tiền theo context hiện tại — dùng thay fmtVND() ở nơi hiển thị doanh thu/tiền chính.
// Lưu ý: Pancake shop Malaysia lưu total/cod ở đơn vị sen (RM × 100), giống convention payment
// API phổ biến — cần chia 100 trước khi hiển thị/quy đổi. Shop VN lưu nguyên đơn vị VND.
function useFmtMoney() {
  const { market, currencyMode, rate } = useContext(CurrencyCtx)
  return (n: number | null | undefined) => {
    if (n == null || isNaN(Number(n))) return "—"
    if (market !== "MY") return fmtVND(n)
    const myr = Number(n) / 100
    if (currencyMode === "MYR") return fmtMYR(myr)
    return fmtVND(myr * rate)
  }
}
function fmtNum(n: number | null | undefined) {
  if (n == null) return "—"
  return new Intl.NumberFormat("vi-VN").format(Number(n))
}
// % thay đổi so kỳ trước. null khi kỳ trước = 0 (không có mốc để so → tránh chia 0 / hiện "∞%").
function pctDelta(cur: number, prev: number): number | null {
  if (!prev || prev <= 0) return null
  return Math.round((cur - prev) / prev * 100)
}
function todayVN(): string {
  return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10)
}
function toISO(s: string, end = false): string {
  // VN +7 → start of day VN (00:00 ngày s) = 17:00 UTC ngày s-1; end of day VN (23:59:59.999) = 16:59:59.999 UTC ngày s.
  if (end) return `${s}T16:59:59.999Z`
  return `${addDays(s, -1)}T17:00:00.000Z`
}
function addDays(s: string, n: number): string {
  const d = new Date(s); d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}
// Lấy năm/tháng theo giờ VN từ chuỗi todayVN() (đã chuẩn qua toISOString).
// KHÔNG dùng getMonth()/getFullYear() trên Date đã +7h — nếu browser cũng ở +7
// thì offset bị cộng kép, cuối tháng nhảy sang tháng sau.
function thisMonthRange() {
  const t = todayVN()                         // YYYY-MM-DD (giờ VN)
  const y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7))
  const lastDay = new Date(y, m, 0).getDate()
  return {
    from: `${t.slice(0, 8)}01`,
    to: `${t.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`,
  }
}
function lastMonthRange() {
  const t = todayVN()
  let y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7)) - 1
  if (m === 0) { m = 12; y-- }
  const lastDay = new Date(y, m, 0).getDate()
  const mm = String(m).padStart(2, "0")
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(lastDay).padStart(2, "0")}` }
}

// ---- DeltaBadge ----
function Delta({ v, suffix = "%", invert = false }: { v: number | null; suffix?: string; invert?: boolean }) {
  if (v == null) return <span className="text-xs text-gray-300">—</span>
  const good = invert ? v < 0 : v > 0
  const cls = v === 0 ? "text-gray-400" : good ? "text-green-600" : "text-red-500"
  return <span className={`text-xs font-semibold ${cls}`}>{v > 0 ? "↑" : v < 0 ? "↓" : "="}{Math.abs(v)}{suffix}</span>
}

// ---- KPI Card ----
function KpiCard({ label, value, sub, delta, deltaSuffix, invertDelta, accent }:
  { label: string; value: string; sub?: string; delta?: number | null; deltaSuffix?: string; invertDelta?: boolean; accent?: string }) {
  return (
    <div className={`bg-white border rounded-xl p-5 shadow-sm ${accent ?? ""}`}>
      <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
      {delta != null && <div className="mt-1"><Delta v={delta} suffix={deltaSuffix ?? "%"} invert={invertDelta} /></div>}
    </div>
  )
}

// ---- Simple bar ----
function Bar({ pct, color = "bg-blue-500" }: { pct: number; color?: string }) {
  return (
    <div className="w-full h-2 bg-gray-100 rounded overflow-hidden">
      <div className={`h-full rounded ${color}`} style={{ width: `${Math.max(pct, 0)}%` }} />
    </div>
  )
}

// ---- Markdown renderer (simple) ----
function Markdown({ text }: { text: string }) {
  const lines = text.split("\n")
  return (
    <div className="text-sm text-gray-700 space-y-2 leading-relaxed">
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-1" />
        // Bold headings **...**
        const parts = line.split(/(\*\*[^*]+\*\*)/)
        return (
          <p key={i}>
            {parts.map((p, j) =>
              p.startsWith("**") && p.endsWith("**")
                ? <strong key={j} className="text-gray-900 font-semibold">{p.slice(2, -2)}</strong>
                : p
            )}
          </p>
        )
      })}
    </div>
  )
}

// ---- Period Selector ----
type Period = "today" | "7d" | "month" | "lastmonth" | "custom"
interface DateRange { from: string; to: string }
type Market = "VN" | "MY"
type CurrencyMode = "MYR" | "VND"

function detectPeriod(range: DateRange): Period {
  const today = todayVN()
  if (range.from === today && range.to === today) return "today"
  if (range.from === addDays(today, -6) && range.to === today) return "7d"
  const tm = thisMonthRange()
  if (range.from === tm.from && range.to === tm.to) return "month"
  const lm = lastMonthRange()
  if (range.from === lm.from && range.to === lm.to) return "lastmonth"
  return "custom"
}

function PeriodSelector({ range, onChange }: { range: DateRange; onChange: (r: DateRange) => void }) {
  const [active, setActive] = useState<Period>(() => detectPeriod(range))
  const [custom, setCustom] = useState({ from: range.from, to: range.to })

  function pick(p: Period) {
    setActive(p)
    const today = todayVN()
    if (p === "today")     return onChange({ from: today, to: today })
    if (p === "7d")        return onChange({ from: addDays(today, -6), to: today })
    if (p === "month")     return onChange(thisMonthRange())
    if (p === "lastmonth") return onChange(lastMonthRange())
  }

  const btns: { key: Period; label: string }[] = [
    { key: "today",     label: "Hôm nay" },
    { key: "7d",        label: "7 ngày" },
    { key: "month",     label: "Tháng này" },
    { key: "lastmonth", label: "Tháng trước" },
    { key: "custom",    label: "Tùy chọn" },
  ]

  return (
    <div className="flex flex-wrap gap-2 items-center">
      {btns.map(b => (
        <button key={b.key} onClick={() => pick(b.key)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            active === b.key ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}>{b.label}</button>
      ))}
      {active === "custom" && (
        <div className="flex gap-2 items-center ml-1">
          <input type="date" value={custom.from}
            onChange={e => setCustom(c => ({ ...c, from: e.target.value }))}
            className="border rounded-lg px-2 py-1 text-sm bg-white text-gray-900" />
          <span className="text-gray-400 text-sm">→</span>
          <input type="date" value={custom.to}
            onChange={e => setCustom(c => ({ ...c, to: e.target.value }))}
            className="border rounded-lg px-2 py-1 text-sm bg-white text-gray-900" />
          <button onClick={() => onChange(custom)}
            className="px-3 py-1.5 bg-violet-600 text-white rounded-lg text-sm">Áp dụng</button>
        </div>
      )}
      <span className="text-xs text-gray-400 ml-2">{range.from} → {range.to}</span>
    </div>
  )
}

// ---- AI Summary Block ----
function AISummaryBlock({ range }: { range: DateRange }) {
  const [summary, setSummary] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(true)
  const lastRange = useRef<string>("")

  async function generate() {
    const key = `${range.from}|${range.to}`
    if (key === lastRange.current && summary) { setOpen(true); return }
    setLoading(true); setError(null); setSummary(null); setOpen(true)
    try {
      const res = await apiFetch("/admin/pancake-sync/report/ai-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: toISO(range.from), to: toISO(range.to, true) }),
      })
      if (!res.ok) throw new Error(`Lỗi ${res.status}`)
      const d = await res.json()
      setSummary(d.summary)
      lastRange.current = key
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mb-4">
      <div className="flex items-center gap-3">
        <button onClick={generate} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl text-sm font-semibold shadow hover:opacity-90 disabled:opacity-60 transition-all">
          {loading ? <span className="animate-spin">⏳</span> : "🤖"} {loading ? "Đang phân tích…" : "Tạo báo cáo AI"}
        </button>
        {summary && !loading && (
          <button onClick={() => setOpen(o => !o)} className="text-xs text-gray-400 hover:text-gray-600">
            {open ? "Thu gọn ▲" : "Mở rộng ▼"}
          </button>
        )}
      </div>
      {error && <div className="mt-2 text-red-500 text-sm">Lỗi: {error}</div>}
      {summary && open && !loading && (
        <div className="mt-3 bg-gradient-to-br from-violet-50 to-indigo-50 border border-violet-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-semibold text-violet-600 bg-violet-100 px-2 py-0.5 rounded-full">DeepSeek AI</span>
            <span className="text-xs text-gray-400">Kỳ {range.from} → {range.to}</span>
          </div>
          <Markdown text={summary} />
        </div>
      )}
    </div>
  )
}

// ---- Exchange rate editor (tỷ giá MYR→VND theo tháng) ----
// Chọn thị trường + (chỉ khi Malaysia) đơn vị tiền và tỷ giá. Gom vào 1 chỗ để mọi tab
// đặt cạnh bộ lọc riêng của mình — VN không phải nhìn thấy tuỳ chọn MYR/tỷ giá vô nghĩa.
function MarketPicker({ market, onMarket, currencyMode, onCurrencyMode, month, rate, onRate }: {
  market: Market; onMarket: (m: Market) => void
  currencyMode: CurrencyMode; onCurrencyMode: (c: CurrencyMode) => void
  month: string; rate: number; onRate: (r: number) => void
}) {
  return (
    <>
      <select value={market} onChange={e => onMarket(e.target.value as Market)}
        className="border rounded-lg px-3 py-1.5 text-sm font-medium bg-white text-gray-900">
        <option value="VN">🇻🇳 Việt Nam</option>
        <option value="MY">🇲🇾 Malaysia (TikTok)</option>
      </select>
      {market === "MY" && (
        <>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            <button onClick={() => onCurrencyMode("MYR")}
              className={`px-2 py-1 text-xs rounded ${currencyMode === "MYR" ? "bg-white shadow font-semibold text-gray-900" : "text-gray-500"}`}>MYR</button>
            <button onClick={() => onCurrencyMode("VND")}
              className={`px-2 py-1 text-xs rounded ${currencyMode === "VND" ? "bg-white shadow font-semibold text-gray-900" : "text-gray-500"}`}>VND (quy đổi)</button>
          </div>
          <ExchangeRateEditor month={month} rate={rate} onSaved={onRate} />
        </>
      )}
    </>
  )
}

function ExchangeRateEditor({ month, rate, onSaved }: { month: string; rate: number; onSaved: (rate: number) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(String(rate))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  useEffect(() => { setValue(String(rate)) }, [rate])

  async function save() {
    const n = Number(value)
    if (!n || n <= 0) { setError("Tỷ giá phải > 0"); return }
    setSaving(true); setError(null)
    try {
      await apiJson("/admin/exchange-rate", "PUT", { month, rate: n })
      onSaved(n)
      setEditing(false)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5 bg-white border rounded-lg px-2 py-1">
        <span className="text-xs text-gray-400">1 RM =</span>
        <input
          type="number"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false) }}
          autoFocus
          className="w-20 text-xs border rounded px-1.5 py-0.5 bg-white text-gray-900"
        />
        <span className="text-xs text-gray-400">đ</span>
        <button onClick={save} disabled={saving}
          className="text-xs px-2 py-0.5 bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-50">
          {saving ? "…" : "Lưu"}
        </button>
        <button onClick={() => { setEditing(false); setValue(String(rate)) }}
          className="text-xs px-2 py-0.5 text-gray-400 hover:text-gray-600">Hủy</button>
        {error && <span className="text-xs text-red-500 ml-1">{error}</span>}
      </div>
    )
  }

  return (
    <div className="relative">
      <button onClick={() => setEditing(true)}
        className="flex items-center gap-1.5 text-xs text-gray-500 bg-gray-50 hover:bg-gray-100 border rounded-lg px-2.5 py-1.5">
        <span>1 RM = {new Intl.NumberFormat("vi-VN").format(rate)}đ</span>
        <span className="text-gray-400">({month})</span>
        <span className="text-violet-500">✎</span>
      </button>
      <button onClick={() => setShowHistory(v => !v)}
        className="ml-1 text-xs text-gray-400 hover:text-violet-600 underline">lịch sử</button>
      {showHistory && <ExchangeRateHistory onClose={() => setShowHistory(false)} />}
    </div>
  )
}

function ExchangeRateHistory({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null)
  useEffect(() => {
    apiJson("/admin/exchange-rate/list").then(d => setRows(d?.rows ?? [])).catch(() => setRows([]))
  }, [])
  return (
    <div className="absolute z-10 top-full left-0 mt-1 bg-white border rounded-lg shadow-lg p-3 w-56">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-600">Lịch sử tỷ giá</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
      </div>
      {rows == null && <div className="text-xs text-gray-400">Đang tải…</div>}
      {rows != null && rows.length === 0 && <div className="text-xs text-gray-400">Chưa có tháng nào được chỉnh</div>}
      {rows != null && rows.length > 0 && (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {rows.map(r => (
            <div key={r.month} className="flex justify-between text-xs">
              <span className="text-gray-500">{r.month}</span>
              <span className="font-medium text-gray-900">{new Intl.NumberFormat("vi-VN").format(Number(r.myr_to_vnd))}đ</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---- Overview Tab ----
function OverviewTab({ range, market, onRate, marketPicker }: {
  range: DateRange; market: Market; onRate?: (rate: number) => void; marketPicker?: React.ReactNode
}) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  // Top nhân sự lấy từ marketer-lng (đã chuẩn hoá attribution + handover + LNG). Chỉ VN;
  // MY trả not_supported → ẩn khối. Tách state riêng để không chặn render khối chính nếu chậm.
  const [mkt, setMkt] = useState<any>(null)
  // Bộ lọc phạm vi đơn: "all" (mọi đơn Pancake, gồm sàn TMĐT) hoặc "core" (chỉ đơn khớp LNG:
  // loại TikTok/Shopee + nháp/trùng/xóa). Mặc định all để giữ bức tranh toàn DN.
  const [sourceGroup, setSourceGroup] = useState<"all" | "core">("all")

  useEffect(() => {
    setLoading(true)
    const from = toISO(range.from), to = toISO(range.to, true)
    apiFetch(`/admin/pancake-sync/report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&market=${market}&source_group=${sourceGroup}`)
      .then(r => r.json()).then(d => {
        setData(d)
        if (d?.myr_to_vnd_rate) onRate?.(d.myr_to_vnd_rate)
      }).catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [range.from, range.to, market, sourceGroup])

  useEffect(() => {
    setMkt(null)
    apiJson(`/admin/pancake-sync/report/marketer-lng?from=${toISO(range.from)}&to=${toISO(range.to, true)}&market=${market}`)
      .then(setMkt).catch(() => setMkt(null))
  }, [range.from, range.to, market])

  const fmt = useFmtMoney()

  if (loading) return <div className="text-center py-16 text-gray-400">Đang tải…</div>
  if (!data) return <div className="text-center py-16 text-gray-400">Không có dữ liệu</div>

  const maxRev  = Math.max(...(data.by_day ?? []).map((d: any) => d.revenue), 1)

  // Doanh thu từng nguồn theo ngày — lấy từ by_source_day (có ở mọi market) để vẽ thanh
  // xếp chồng thay cho số đơn. Tách theo TOÀN BỘ nguồn (không chỉ TikTok/Shopee) để tổng
  // các mảnh luôn khớp doanh thu ngày — VN chủ yếu là Thủ công/Facebook.
  const trendSources: any[] = (data.by_source_day?.sources ?? [])
    .filter((s: any) => Number(s.total_revenue || 0) > 0)
    .sort((a: any, b: any) => Number(b.total_revenue) - Number(a.total_revenue))
  const stackByDate = new Map<string, { source: string; color: string; revenue: number }[]>()
  trendSources.forEach((s: any, i: number) => {
    const color = sourceColorOf(s.source, i)
    for (const cell of (s.per_day ?? [])) {
      const rev = Number(cell.revenue || 0)
      if (rev <= 0) continue
      const arr = stackByDate.get(cell.date) ?? []
      arr.push({ source: s.source, color, revenue: rev })
      stackByDate.set(cell.date, arr)
    }
  })

  return (
    <div className="space-y-5">
      {/* Chọn thị trường + bộ lọc phạm vi đơn */}
      <div className="flex items-center gap-2 text-sm flex-wrap">
        {marketPicker}
        <span className="text-gray-500 ml-1">Phạm vi:</span>
        <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
          <button
            onClick={() => setSourceGroup("all")}
            className={`px-3 py-1.5 whitespace-nowrap ${sourceGroup === "all" ? "bg-violet-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
            Toàn bộ
          </button>
          <button
            onClick={() => setSourceGroup("core")}
            className={`px-3 py-1.5 border-l border-gray-200 whitespace-nowrap ${sourceGroup === "core" ? "bg-violet-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
            Khớp LNG
          </button>
        </div>
        <span className="text-xs text-gray-400">
          {sourceGroup === "all" ? "Mọi đơn Pancake (gồm TikTok/Shopee, cả nháp)" : "Chỉ đơn tính LNG (loại sàn TMĐT + nháp/trùng/xóa)"}
        </span>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <KpiCard label="Đơn thành công" value={fmtNum(data.success_count)}
          sub={`/ ${fmtNum(data.total_orders)} tổng đơn`}
          delta={data.prev ? pctDelta(data.success_count, data.prev.success_count) : null} />
        <KpiCard label="Doanh thu COD" value={fmt(data.total_revenue)}
          sub={data.junk_count > 0
            ? `đã trừ ${fmtNum(data.junk_count)} đơn nháp hủy / trùng`
            : "đã trừ đơn nháp hủy / đơn trùng"}
          delta={data.prev ? pctDelta(data.total_revenue, data.prev.total_revenue) : null}
          accent="border-l-4 border-l-green-400" />
        <KpiCard label="Tỷ lệ thành công" value={`${data.success_rate}%`}
          sub={`Hoàn: ${data.return_rate}%`} />
        <KpiCard label="Đơn hoàn hủy" value={fmtNum((data.return_count ?? 0) + (data.cancel_count ?? 0))}
          sub={`Hoàn ${data.return_count} · Hủy ${data.cancel_count}`}
          accent={data.return_rate > 15 ? "border-l-4 border-l-red-400" : ""} />
        <KpiCard label="AOV (giao thành công)" value={
          data.success_count > 0 ? fmt((data.success_revenue ?? 0) / data.success_count) : "—"
        } sub="thực thu / đơn giao TC" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Chart by day */}
        <div className="lg:col-span-2 bg-white border rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-700">Doanh số theo ngày</h3>
            <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap justify-end">
              {trendSources.map((s: any, i: number) => (
                <span key={s.source} className="inline-flex items-center gap-1.5">
                  <i className="w-2.5 h-2.5 rounded-sm inline-block"
                    style={{ background: sourceColorOf(s.source, i) }} />
                  {SOURCE_LABELS[s.source] ?? s.source}
                </span>
              ))}
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto space-y-1.5">
            {(data.by_day ?? []).map((d: any) => {
              const segs = stackByDate.get(d.date) ?? []
              const sum = segs.reduce((a, s) => a + s.revenue, 0)
              // Bề rộng thanh tổng tỉ lệ với ngày cao nhất; các mục chia theo tỉ trọng doanh thu.
              const barPct = Math.round(d.revenue / maxRev * 100)
              return (
                <div key={d.date} className="flex items-center gap-2 text-xs">
                  <span className="text-gray-400 w-16 flex-shrink-0">{d.date.slice(5)}</span>
                  <div className="flex-1 h-5">
                    <div className="flex h-full rounded overflow-hidden bg-gray-100"
                      style={{ width: `${barPct}%`, minWidth: sum > 0 ? "2px" : undefined }}>
                      {segs.map(seg => {
                        const pct = sum > 0 ? seg.revenue / sum * 100 : 0
                        const label = SOURCE_LABELS[seg.source] ?? seg.source
                        return (
                          <div key={seg.source} className="h-full flex items-center overflow-hidden"
                            style={{ width: `${pct}%`, background: seg.color }}
                            // Mảnh quá nhỏ không đủ chỗ in số → vẫn xem được khi hover.
                            title={`${label}: ${fmt(seg.revenue)}`}>
                            {pct > 18 && (
                              <span className="px-1.5 text-white whitespace-nowrap">{fmt(seg.revenue)}</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                  <span className="text-gray-500 w-20 text-right flex-shrink-0 font-medium"
                    title={segs.map(s => `${SOURCE_LABELS[s.source] ?? s.source}: ${fmt(s.revenue)}`).join("\n")}>
                    {fmt(d.revenue)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* By source */}
        <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b font-semibold text-gray-700 text-sm">Theo nguồn</div>
          <div className="p-4 space-y-3">
            {(data.by_source ?? []).map((s: any) => {
              const pct = data.total_revenue > 0 ? Math.round(s.revenue / data.total_revenue * 100) : 0
              const dlt = s.prev_revenue != null ? pctDelta(s.revenue, s.prev_revenue) : null
              const labels: Record<string, string> = { medusa:"Website", facebook:"Facebook", zalo:"Zalo", tiktok:"TikTok", shopee:"Shopee", manual:"Thủ công", unknown:"Khác" }
              return (
                <div key={s.source}>
                  <div className="flex justify-between items-center text-xs mb-1">
                    <span className="font-medium text-gray-700 inline-flex items-center gap-1.5">
                      {labels[s.source] ?? s.source}
                      <Delta v={dlt} />
                    </span>
                    <span className="text-gray-500">{s.orders} đơn · {pct}% DT</span>
                  </div>
                  <Bar pct={pct} color="bg-violet-500" />
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Xu hướng doanh thu từng nguồn theo thời gian (mọi market) */}
      {data.by_source_day && <SourceTrendBlock data={data.by_source_day} />}

      {/* Doanh số theo sàn: TikTok vs Shopee (chỉ MY) */}
      {data.by_platform_day && <PlatformBreakdownBlock data={data.by_platform_day} />}

      {/* Doanh số theo gian hàng (chỉ MY — nhiều gian TikTok con) */}
      {data.by_shop_day && <ShopBreakdownBlock data={data.by_shop_day} totalRevenue={data.total_revenue} />}

      {/* Doanh số sản phẩm theo gian hàng (chỉ MY) */}
      {data.by_shop_day && data.by_product && (
        <ProductByShopBlock products={data.by_product} shops={data.by_shop_day.shops ?? []} />
      )}

      {/* Top nhân sự (MKT) + Top sản phẩm — gom về Tổng quan để 1 màn thấy hết.
          MY chưa hỗ trợ marketer-lng → chỉ hiện Top nhân sự cho VN. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {!mkt?.not_supported && <OverviewMarketerBlock mkt={mkt} totalRevenue={data.total_revenue} fmt={fmt} />}
        <OverviewProductBlock products={data.by_product ?? []} fmt={fmt} />
      </div>
    </div>
  )
}

// ---- Top nhân sự (rút gọn cho Tổng quan) — nguồn: marketer-lng ----
function OverviewMarketerBlock({ mkt, totalRevenue, fmt }: { mkt: any; totalRevenue: number; fmt: (n: any) => string }) {
  const rows = (mkt?.rows ?? [])
    .filter((r: any) => Number(r.revenue_total || 0) > 0)
    .sort((a: any, b: any) => Number(b.revenue_total) - Number(a.revenue_total))
    .slice(0, 8)
  return (
    <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b font-semibold text-gray-700 text-sm flex items-center justify-between">
        <span>Top nhân sự MKT</span>
        <span className="text-xs font-normal text-gray-400">theo doanh số · LNG thực</span>
      </div>
      {mkt == null ? (
        <div className="p-6 text-center text-sm text-gray-400 animate-pulse">Đang tải…</div>
      ) : rows.length === 0 ? (
        <div className="p-6 text-center text-sm text-gray-400">Không có dữ liệu</div>
      ) : (
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b text-xs text-gray-500">
            <tr>
              <th className="text-left px-4 py-2.5">NV MKT</th>
              <th className="text-right px-4 py-2.5">Doanh số</th>
              <th className="text-right px-4 py-2.5">LNG thực</th>
              <th className="text-right px-4 py-2.5">%LNG</th>
            </tr>
          </thead>
          <tbody className="divide-y text-gray-900">
            {rows.map((r: any) => {
              const lng = r.lng_thuc ?? r.lng ?? 0
              return (
                <tr key={r.mkt_name}>
                  <td className="px-4 py-2.5 font-medium text-gray-900">{r.mkt_name}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-green-700">{fmt(r.revenue_total)}</td>
                  <td className={`px-4 py-2.5 text-right font-semibold ${lng >= 0 ? "text-violet-700" : "text-red-500"}`}>{fmt(lng)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-500">{r.lng_pct != null ? `${r.lng_pct}%` : "—"}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      )}
    </div>
  )
}

// ---- Top sản phẩm (rút gọn cho Tổng quan) — nguồn: by_product của report ----
function OverviewProductBlock({ products, fmt }: { products: any[]; fmt: (n: any) => string }) {
  const rows = [...products].sort((a, b) => Number(b.revenue) - Number(a.revenue)).slice(0, 8)
  const totalRev = products.reduce((s, p) => s + Number(p.revenue || 0), 0)
  return (
    <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b font-semibold text-gray-700 text-sm flex items-center justify-between">
        <span>Top sản phẩm</span>
        <span className="text-xs font-normal text-gray-400">theo doanh số (giá niêm yết)</span>
      </div>
      {rows.length === 0 ? (
        <div className="p-6 text-center text-sm text-gray-400">Không có dữ liệu</div>
      ) : (
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b text-xs text-gray-500">
            <tr>
              <th className="text-left px-4 py-2.5">Sản phẩm</th>
              <th className="text-right px-4 py-2.5">SL</th>
              <th className="text-right px-4 py-2.5">Doanh số</th>
              <th className="text-right px-4 py-2.5">%</th>
            </tr>
          </thead>
          <tbody className="divide-y text-gray-900">
            {rows.map((p: any) => {
              const pct = totalRev > 0 ? Math.round(Number(p.revenue) / totalRev * 100) : 0
              return (
                <tr key={p.name}>
                  <td className="px-4 py-2.5 font-medium max-w-[220px] truncate text-gray-900" title={p.name}>{p.name}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-gray-900">{fmtNum(p.qty)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-green-700">{fmt(p.revenue)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-500">{pct}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      )}
    </div>
  )
}

// ---- Doanh số theo sàn: TikTok vs Shopee (bảng đơn giản, không cần biểu đồ theo ngày phức tạp) ----
const PLATFORM_COLORS: Record<string, string> = { TikTok: "#000000", Shopee: "#ee4d2d" }

// ---- Xu hướng doanh thu theo nguồn theo thời gian (line chart, mọi market) ----
const SOURCE_LABELS: Record<string, string> = {
  medusa: "Website", facebook: "Facebook", zalo: "Zalo", tiktok: "TikTok",
  shopee: "Shopee", manual: "Thủ công", unknown: "Khác",
}
const SOURCE_COLORS: Record<string, string> = {
  medusa: "#2563eb", facebook: "#1877f2", zalo: "#0068ff", tiktok: "#000000",
  shopee: "#ee4d2d", manual: "#7c3aed", unknown: "#6b7280",
}
const sourceColorOf = (src: string, i: number) =>
  SOURCE_COLORS[src] ?? SHOP_COLORS[i % SHOP_COLORS.length]

function SourceTrendBlock({ data }: { data: any }) {
  const fmt = useFmtMoney()
  const days: string[] = data.days ?? []
  const sources: any[] = (data.sources ?? []).filter((s: any) => Number(s.total_revenue || 0) > 0)
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  const visible = sources.filter(s => !hidden.has(s.source))
  const maxRev = Math.max(1, ...visible.flatMap(s => s.per_day.map((c: any) => Number(c.revenue || 0))))

  const W = 900, H = 220, PAD_L = 44, PAD_R = 12, PAD_T = 12, PAD_B = 24
  const plotW = W - PAD_L - PAD_R
  const plotH = H - PAD_T - PAD_B
  const xAt = (i: number) => days.length > 1 ? PAD_L + (i / (days.length - 1)) * plotW : PAD_L + plotW / 2
  const yAt = (v: number) => PAD_T + plotH - (v / maxRev) * plotH

  const toggle = (src: string) => setHidden(prev => {
    const next = new Set(prev)
    next.has(src) ? next.delete(src) : next.add(src)
    return next
  })

  // Gridlines: 4 mốc ngang
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => f * maxRev)

  return (
    <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b font-semibold text-gray-700 text-sm flex items-center justify-between">
        <span>Xu hướng doanh thu theo nguồn</span>
        <span className="text-xs font-normal text-gray-400">theo ngày · click tên nguồn để ẩn/hiện</span>
      </div>
      <div className="p-4">
        {/* Legend */}
        <div className="flex flex-wrap gap-3 mb-3">
          {sources.map((s, i) => {
            const isHidden = hidden.has(s.source)
            return (
              <button key={s.source} onClick={() => toggle(s.source)}
                className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border transition ${
                  isHidden ? "opacity-40 border-gray-200" : "border-gray-200 hover:bg-gray-50"
                }`}>
                <span className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ background: sourceColorOf(s.source, i) }} />
                {SOURCE_LABELS[s.source] ?? s.source}
                <span className="text-gray-400">· {fmt(s.total_revenue)}</span>
              </button>
            )
          })}
        </div>

        {days.length === 0 || visible.length === 0 ? (
          <div className="text-xs text-gray-400 text-center py-10">Chưa có dữ liệu</div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-56">
            {/* Gridlines + Y labels */}
            {yTicks.map((t, i) => (
              <g key={i}>
                <line x1={PAD_L} x2={W - PAD_R} y1={yAt(t)} y2={yAt(t)} stroke="#f1f5f9" strokeWidth={1} />
                <text x={PAD_L - 6} y={yAt(t) + 3} textAnchor="end" fontSize={9} fill="#9ca3af">
                  {t >= 1e6 ? `${(t / 1e6).toFixed(0)}tr` : t > 0 ? `${Math.round(t / 1000)}k` : "0"}
                </text>
              </g>
            ))}
            {/* X labels (thưa để không đè nhau) */}
            {days.map((d, i) => {
              const step = Math.ceil(days.length / 8)
              if (i % step !== 0 && i !== days.length - 1) return null
              return (
                <text key={d} x={xAt(i)} y={H - 6} textAnchor="middle" fontSize={9} fill="#9ca3af">
                  {d.slice(5)}
                </text>
              )
            })}
            {/* Lines per source */}
            {visible.map((s, i) => {
              const color = sourceColorOf(s.source, sources.indexOf(s))
              const points = s.per_day.map((c: any, idx: number) =>
                `${xAt(idx)},${yAt(Number(c.revenue || 0))}`
              ).join(" ")
              return (
                <g key={s.source}>
                  <polyline points={points} fill="none" stroke={color} strokeWidth={2}
                    strokeLinejoin="round" strokeLinecap="round" />
                  {s.per_day.map((c: any, idx: number) => (
                    <circle key={idx} cx={xAt(idx)} cy={yAt(Number(c.revenue || 0))} r={2.5} fill={color}>
                      <title>{`${SOURCE_LABELS[s.source] ?? s.source} · ${c.date}: ${fmt(c.revenue)} (${c.orders} đơn)`}</title>
                    </circle>
                  ))}
                </g>
              )
            })}
          </svg>
        )}
      </div>
    </div>
  )
}
function PlatformBreakdownBlock({ data }: { data: any }) {
  const fmt = useFmtMoney()
  const days: string[] = data.days ?? []
  const platforms: any[] = data.platforms ?? []
  const totalRev = platforms.reduce((s, p) => s + Number(p.total_revenue || 0), 0)
  const colorOf = (name: string) => PLATFORM_COLORS[name] ?? "#6b7280"

  return (
    <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b font-semibold text-gray-700 text-sm flex items-center justify-between">
        <span>Doanh số theo sàn</span>
        <span className="text-xs font-normal text-gray-400">TikTok vs Shopee</span>
      </div>

      {/* Tổng quan 2 sàn dạng thanh ngang */}
      <div className="p-4 space-y-3">
        {platforms.map(p => {
          const pct = totalRev > 0 ? Math.round(p.total_revenue / totalRev * 100) : 0
          return (
            <div key={p.platform}>
              <div className="flex justify-between text-xs mb-1">
                <span className="font-medium text-gray-700 inline-flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: colorOf(p.platform) }} />
                  {p.platform}
                </span>
                <span className="text-gray-500">{p.total_orders} đơn · {fmt(p.total_revenue)} · {pct}%</span>
              </div>
              <div className="w-full h-2 bg-gray-100 rounded overflow-hidden">
                <div className="h-full rounded" style={{ width: `${Math.max(pct, 0)}%`, background: colorOf(p.platform) }} />
              </div>
            </div>
          )
        })}
      </div>

      {/* Bảng theo ngày */}
      <div className="overflow-x-auto border-t">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b text-xs text-gray-500">
            <tr>
              <th className="text-left px-4 py-2.5">Sàn</th>
              {days.map(d => <th key={d} className="text-right px-3 py-2.5 whitespace-nowrap">{d.slice(5)}</th>)}
              <th className="text-right px-4 py-2.5">Tổng đơn</th>
              <th className="text-right px-4 py-2.5">Tổng COD</th>
            </tr>
          </thead>
          <tbody className="divide-y text-gray-900">
            {platforms.map(p => (
              <tr key={p.platform}>
                <td className="px-4 py-2.5 font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: colorOf(p.platform) }} />
                    {p.platform}
                  </span>
                </td>
                {p.per_day.map((cell: any) => (
                  <td key={cell.date} className="px-3 py-2.5 text-right text-gray-500 whitespace-nowrap">
                    {cell.orders > 0 ? fmt(cell.revenue) : "—"}
                  </td>
                ))}
                <td className="px-4 py-2.5 text-right font-mono">{fmtNum(p.total_orders)}</td>
                <td className="px-4 py-2.5 text-right font-semibold text-green-700">{fmt(p.total_revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---- Doanh số sản phẩm theo gian hàng (MY) — mỗi SP thuộc 1 shop, gắn chấm màu + tên shop ----
// Dropdown lọc sàn (Tất cả/TikTok/Shopee) để xem riêng SP đang bán trên từng sàn.
function ProductByShopBlock({ products, shops }: { products: any[]; shops: any[] }) {
  const fmt = useFmtMoney()
  const [platformFilter, setPlatformFilter] = useState<"all" | "tiktok" | "shopee">("all")
  // Map shop_name -> màu (khớp thứ tự với ShopBreakdownBlock)
  const colorOf = (shopName: string) => {
    const idx = shops.findIndex((s: any) => s.shop_name === shopName)
    return idx >= 0 ? SHOP_COLORS[idx % SHOP_COLORS.length] : "#9ca3af"
  }
  const filtered = platformFilter === "all"
    ? products
    : products.filter((p: any) => p.source === platformFilter)
  const totalRev = filtered.reduce((s, p) => s + Number(p.revenue || 0), 0)

  return (
    <div className="mt-5 bg-white border rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b font-semibold text-gray-700 text-sm flex items-center justify-between">
        <span>Doanh số sản phẩm theo gian hàng</span>
        <div className="flex items-center gap-2">
          <select value={platformFilter} onChange={e => setPlatformFilter(e.target.value as any)}
            className="border rounded-lg px-2 py-1 text-xs bg-white text-gray-900">
            <option value="all">Tất cả sàn</option>
            <option value="tiktok">TikTok</option>
            <option value="shopee">Shopee</option>
          </select>
          <span className="text-xs font-normal text-gray-400">giá niêm yết · top {filtered.length}</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b text-xs text-gray-500">
            <tr>
              <th className="text-left px-4 py-2.5">#</th>
              <th className="text-left px-4 py-2.5">Sản phẩm</th>
              <th className="text-left px-4 py-2.5">Gian hàng</th>
              <th className="text-right px-4 py-2.5">SL bán</th>
              <th className="text-right px-4 py-2.5">Doanh số</th>
              <th className="text-right px-4 py-2.5">%</th>
            </tr>
          </thead>
          <tbody className="divide-y text-gray-900">
            {filtered.map((p: any, i: number) => {
              const pct = totalRev > 0 ? Math.round(Number(p.revenue) / totalRev * 100) : 0
              const color = colorOf(p.shop_name || "")
              return (
                <tr key={p.name} className={i % 2 === 0 ? "" : "bg-gray-50/40"}>
                  <td className="px-4 py-2.5 text-gray-400 text-xs">{i + 1}</td>
                  <td className="px-4 py-2.5 font-medium max-w-xs truncate" title={p.name}>{p.name}</td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5 text-xs text-gray-600">
                      <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                      {p.shop_name || "(không rõ)"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">{fmtNum(p.qty)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-green-700">{fmt(p.revenue)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600">{pct}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---- Doanh số theo gian hàng TikTok (bảng + biểu đồ cột theo ngày) ----
const SHOP_COLORS = ["#7c3aed", "#2563eb", "#16a34a", "#ea580c", "#db2777", "#0891b2", "#ca8a04", "#4f46e5"]
function ShopBreakdownBlock({ data, totalRevenue }: { data: any; totalRevenue: number }) {
  const fmt = useFmtMoney()
  const days: string[] = data.days ?? []
  const shops: any[] = data.shops ?? []

  // Màu cố định theo thứ tự shop (doanh số cao → thấp)
  const shopColor = (i: number) => SHOP_COLORS[i % SHOP_COLORS.length]

  // Biểu đồ cột nhóm theo ngày: mỗi ngày 1 cụm, mỗi shop 1 cột màu.
  // maxRev để scale chiều cao cột.
  let maxDayRev = 1
  for (const d of days) {
    for (const s of shops) {
      const cell = s.per_day.find((p: any) => p.date === d)
      if (cell && cell.revenue > maxDayRev) maxDayRev = cell.revenue
    }
  }

  return (
    <div className="mt-5 bg-white border rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b font-semibold text-gray-700 text-sm flex items-center justify-between">
        <span>Doanh số theo gian hàng</span>
        <span className="text-xs font-normal text-gray-400">{shops.length} gian hàng TikTok</span>
      </div>

      {/* Legend */}
      <div className="px-5 pt-3 flex flex-wrap gap-3">
        {shops.map((s, i) => (
          <span key={s.shop_name} className="inline-flex items-center gap-1.5 text-xs text-gray-600">
            <span className="inline-block w-3 h-3 rounded" style={{ background: shopColor(i) }} />
            {s.shop_name}
          </span>
        ))}
      </div>

      {/* Grouped bar chart theo ngày */}
      <div className="px-5 py-4 overflow-x-auto">
        <div className="flex items-end gap-4" style={{ minHeight: 160 }}>
          {days.map(d => (
            <div key={d} className="flex flex-col items-center gap-1.5 flex-shrink-0">
              <div className="flex items-end gap-1 h-36">
                {shops.map((s, i) => {
                  const cell = s.per_day.find((p: any) => p.date === d)
                  const rev = cell?.revenue ?? 0
                  const h = Math.round(rev / maxDayRev * 140)
                  return (
                    <div key={s.shop_name} className="relative group">
                      <div className="w-4 rounded-t transition-all hover:opacity-80"
                        style={{ height: `${Math.max(h, rev > 0 ? 2 : 0)}px`, background: shopColor(i) }} />
                      {/* tooltip */}
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block whitespace-nowrap bg-gray-900 text-white text-[10px] rounded px-1.5 py-0.5 z-20">
                        {s.shop_name}: {fmt(rev)} · {cell?.orders ?? 0} đơn
                      </div>
                    </div>
                  )
                })}
              </div>
              <span className="text-[10px] text-gray-400">{d.slice(5)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Bảng số liệu */}
      <div className="overflow-x-auto border-t">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b text-xs text-gray-500">
            <tr>
              <th className="text-left px-4 py-2.5">Gian hàng</th>
              {days.map(d => <th key={d} className="text-right px-3 py-2.5 whitespace-nowrap">{d.slice(5)}</th>)}
              <th className="text-right px-4 py-2.5">Tổng đơn</th>
              <th className="text-right px-4 py-2.5">Tổng COD</th>
              <th className="text-right px-4 py-2.5">%</th>
            </tr>
          </thead>
          <tbody className="divide-y text-gray-900">
            {shops.map((s, i) => {
              const pct = totalRevenue > 0 ? Math.round(s.total_revenue / totalRevenue * 100) : 0
              return (
                <tr key={s.shop_name} className={i % 2 === 0 ? "" : "bg-gray-50/40"}>
                  <td className="px-4 py-2.5 font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: shopColor(i) }} />
                      {s.shop_name}
                    </span>
                  </td>
                  {s.per_day.map((p: any) => (
                    <td key={p.date} className="px-3 py-2.5 text-right text-gray-500 whitespace-nowrap">
                      {p.orders > 0 ? fmt(p.revenue) : "—"}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right font-mono">{fmtNum(s.total_orders)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-green-700">{fmt(s.total_revenue)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600">{pct}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---- Shipping Tab ----
function ShippingTab({ range, market }: { range: DateRange; market: Market }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const from = toISO(range.from), to = toISO(range.to, true)
    apiFetch(`/admin/pancake-sync/report/shipping?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&market=${market}`)
      .then(r => r.json()).then(setData).catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [range.from, range.to, market])

  const fmt = useFmtMoney()

  if (loading) return <div className="text-center py-16 text-gray-400">Đang tải…</div>
  if (!data) return <div className="text-center py-16 text-gray-400">Không có dữ liệu</div>

  const s = data.summary
  const maxDay = Math.max(...(data.by_day ?? []).map((d: any) => Number(d.total)), 1)

  return (
    <div className="space-y-5">
      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Đang giao" value={fmtNum(s.returning_now)}
          sub={`COD chờ thu: ${fmt(s.returning_now_cod)}`}
          accent="border-l-4 border-l-blue-400" />
        <KpiCard label="Giao thành công" value={fmtNum(s.delivered)}
          sub={fmt(s.delivered_cod)}
          accent="border-l-4 border-l-green-400" />
        <KpiCard label="Hoàn hàng" value={fmtNum(s.returned)}
          sub={`Tỷ lệ: ${s.return_rate}%`}
          accent={s.return_rate > 15 ? "border-l-4 border-l-orange-400" : ""} />
        <KpiCard label="Đã hủy" value={fmtNum(s.cancelled)}
          sub={`Tỷ lệ: ${s.cancel_rate}%`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Stacked bar by day */}
        <div className="lg:col-span-2 bg-white border rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-gray-700 mb-4 text-sm">Giao / Hoàn / Hủy theo ngày</h3>
          <div className="max-h-72 overflow-y-auto space-y-1.5">
            {(data.by_day ?? []).map((d: any) => {
              const tot = Number(d.total) || 1
              const dPct = Math.round(Number(d.delivered) / tot * 100)
              const rPct = Math.round(Number(d.returning) / tot * 100)
              const cPct = Math.round(Number(d.cancelled) / tot * 100)
              return (
                <div key={d.date} className="flex items-center gap-2 text-xs">
                  <span className="text-gray-400 w-14 flex-shrink-0">{String(d.date).slice(5)}</span>
                  <div className="flex-1 h-5 flex rounded overflow-hidden">
                    <div className="bg-green-400" style={{ width: `${dPct}%` }} title={`Giao: ${d.delivered}`} />
                    <div className="bg-orange-300" style={{ width: `${rPct}%` }} title={`Hoàn: ${d.returning}`} />
                    <div className="bg-gray-300" style={{ width: `${cPct}%` }} title={`Hủy: ${d.cancelled}`} />
                  </div>
                  <span className="text-gray-400 w-8 text-right">{d.total}</span>
                </div>
              )
            })}
          </div>
          <div className="flex gap-4 mt-3 text-xs text-gray-500">
            <span><span className="inline-block w-3 h-3 bg-green-400 rounded mr-1" />Giao thành công</span>
            <span><span className="inline-block w-3 h-3 bg-orange-300 rounded mr-1" />Hoàn</span>
            <span><span className="inline-block w-3 h-3 bg-gray-300 rounded mr-1" />Hủy</span>
          </div>
        </div>

        {/* Return tags */}
        <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b font-semibold text-gray-700 text-sm">Lý do hoàn (tags)</div>
          <div className="divide-y">
            {data.return_tags?.length ? data.return_tags.map((t: any) => (
              <div key={t.tag_name} className="flex justify-between px-4 py-2.5 text-sm">
                <span className="text-gray-700">{t.tag_name.replace(/^Hoan_/, "")}</span>
                <span className="font-semibold text-orange-600">{t.count}</span>
              </div>
            )) : <div className="px-4 py-4 text-sm text-gray-400">Không có data tag</div>}
          </div>
        </div>
      </div>

      {/* Top tỉnh hoàn */}
      {data.by_province?.length > 0 && (
        <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b font-semibold text-gray-700 text-sm">Tỉnh/thành có tỷ lệ hoàn cao</div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b text-xs text-gray-500">
              <tr>
                <th className="text-left px-4 py-2">Tỉnh/thành</th>
                <th className="text-right px-4 py-2">Tổng đơn</th>
                <th className="text-right px-4 py-2">Đơn hoàn</th>
                <th className="text-right px-4 py-2">Tỷ lệ hoàn</th>
              </tr>
            </thead>
            <tbody className="divide-y text-gray-900">
              {data.by_province.map((p: any) => (
                <tr key={p.province} className={Number(p.return_rate) > 20 ? "bg-orange-50" : ""}>
                  <td className="px-4 py-2.5 font-medium">{p.province}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{p.total}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-orange-600">{p.returned}</td>
                  <td className={`px-4 py-2.5 text-right font-bold ${Number(p.return_rate) > 20 ? "text-red-500" : "text-gray-700"}`}>
                    {p.return_rate}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---- Product Profit Tab ----
function ProductTab({ range, market }: { range: DateRange; market: Market }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const from = toISO(range.from), to = toISO(range.to, true)
    apiFetch(`/admin/pancake-sync/report/product-profit?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&market=${market}`)
      .then(r => r.json()).then(setData).catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [range.from, range.to, market])

  const fmt = useFmtMoney()

  if (loading) return <div className="text-center py-16 text-gray-400">Đang tải…</div>
  if (!data) return <div className="text-center py-16 text-gray-400">Không có dữ liệu</div>

  const s = data.summary

  return (
    <div className="space-y-5">
      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Doanh thu" value={fmt(s.total_revenue)} accent="border-l-4 border-l-green-400" />
        <KpiCard label="COGS (giá vốn)" value={fmtVND(s.total_cogs)} />
        <KpiCard label="Gross Profit" value={fmtVND(s.total_profit)}
          accent={s.total_profit > 0 ? "border-l-4 border-l-violet-400" : "border-l-4 border-l-red-400"} />
        <KpiCard label="Gross Margin" value={`${s.overall_margin}%`}
          sub={`${s.mapped_count}/${s.total_products} SP có giá vốn`} />
      </div>

      {/* Low stock alert */}
      {data.low_stock?.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="font-semibold text-amber-800 mb-2 text-sm">⚠️ Cần nhập thêm — tồn kho dưới 50 cái</div>
          <div className="flex flex-wrap gap-2">
            {data.low_stock.map((p: any) => (
              <span key={p.name} className="bg-amber-100 text-amber-800 text-xs px-2.5 py-1 rounded-full font-medium">
                {p.name} · còn {p.stock_qty}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Product table */}
      <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b font-semibold text-gray-700 text-sm">
          Top sản phẩm (đơn giao thành công)
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b text-xs text-gray-500">
              <tr>
                <th className="text-left px-4 py-2.5">#</th>
                <th className="text-left px-4 py-2.5">Sản phẩm</th>
                <th className="text-right px-4 py-2.5">SL bán</th>
                <th className="text-right px-4 py-2.5">Doanh thu</th>
                <th className="text-right px-4 py-2.5">Giá vốn/SP</th>
                <th className="text-right px-4 py-2.5">COGS</th>
                <th className="text-right px-4 py-2.5">Gross Profit</th>
                <th className="text-right px-4 py-2.5">Margin</th>
                <th className="text-right px-4 py-2.5">Tồn kho</th>
              </tr>
            </thead>
            <tbody className="divide-y text-gray-900">
              {(data.products ?? []).map((p: any, i: number) => {
                const isLow = p.stock_qty != null && p.stock_qty < 50
                return (
                  <tr key={p.name} className={isLow ? "bg-amber-50" : i % 2 === 0 ? "" : "bg-gray-50/40"}>
                    <td className="px-4 py-2.5 text-gray-400 text-xs">{i + 1}</td>
                    <td className="px-4 py-2.5 font-medium max-w-xs truncate">{p.name}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{fmtNum(p.qty_sold)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-green-700">{fmt(p.revenue)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-500">{p.avg_cost != null ? fmtVND(p.avg_cost) : "—"}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600">{p.cogs != null ? fmtVND(p.cogs) : "—"}</td>
                    <td className={`px-4 py-2.5 text-right font-semibold ${p.profit != null && p.profit >= 0 ? "text-violet-700" : "text-red-500"}`}>
                      {p.profit != null ? fmtVND(p.profit) : "—"}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-semibold ${p.margin != null ? (p.margin >= 20 ? "text-green-600" : p.margin < 0 ? "text-red-500" : "text-gray-700") : "text-gray-300"}`}>
                      {p.margin != null ? `${p.margin}%` : "—"}
                    </td>
                    <td className={`px-4 py-2.5 text-right ${isLow ? "text-amber-700 font-bold" : "text-gray-500"}`}>
                      {p.stock_qty != null ? `${p.stock_qty}${isLow ? " ⚠️" : ""}` : "—"}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Hoàn hủy + LNG theo SẢN PHẨM */}
      <ProductLngBlock range={range} market={market} />

      {/* Phân tích lý do hủy/hoàn theo SP */}
      <ProductCancelReasonsBlock range={range} market={market} />
    </div>
  )
}

// ---- Phân tích lý do hủy/hoàn theo SP (ma trận SP × tag lý do) ----
function ProductCancelReasonsBlock({ range, market }: { range: DateRange; market: Market }) {
  const [data, setData] = useState<{ rows: any[]; totals: any; reasons: { key: string; label: string; group: string }[]; not_supported?: boolean } | null>(null)
  const [loading, setLoading] = useState(false)
  const [sortKey, setSortKey] = useState<string>("tong")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  useEffect(() => {
    setLoading(true)
    apiJson(`/admin/pancake-sync/report/product-cancel-reasons?from=${toISO(range.from)}&to=${toISO(range.to, true)}&market=${market}`)
      .then(setData).finally(() => setLoading(false))
  }, [range.from, range.to, market])

  if (data?.not_supported) {
    return <div className="bg-white border rounded-xl p-6 text-center text-sm text-gray-400">Chưa hỗ trợ báo cáo này cho thị trường Malaysia</div>
  }

  const toggleSort = (k: string) => {
    if (sortKey === k) setSortDir(d => d === "desc" ? "asc" : "desc")
    else { setSortKey(k); setSortDir("desc") }
  }

  // Màu theo nhóm lý do
  const groupColor: Record<string, string> = {
    "Lý do hoàn": "#7c3aed", "Lý do từ Khách": "#dc2626",
    "Lỗi liên lạc": "#d97706", "Lỗi dữ liệu đơn": "#0891b2", "Khác": "#6b7280",
  }

  if (!data && !loading) return null

  // Gom reasons theo group để render header 2 tầng
  const groups: { group: string; reasons: { key: string; label: string }[] }[] = []
  for (const r of (data?.reasons ?? [])) {
    let g = groups.find(x => x.group === r.group)
    if (!g) { g = { group: r.group, reasons: [] }; groups.push(g) }
    g.reasons.push({ key: r.key, label: r.label })
  }
  const flatReasons = data?.reasons ?? []

  const cell = (v: number) => v > 0 ? fmtNum(v) : <span className="text-gray-300">0</span>

  const visibleRows = (data?.rows ?? [])
    .filter(r => Number(r.tong || 0) > 0)
    .sort((a, b) => {
      const av = Number(a[sortKey] ?? 0), bv = Number(b[sortKey] ?? 0)
      return sortDir === "desc" ? bv - av : av - bv
    })

  const renderRow = (row: any, isTotal = false) => (
    <tr key={isTotal ? "TỔNG" : (row.sp_code || row.sp_label)} className={isTotal ? "bg-violet-50 font-semibold border-t-2 border-violet-200" : "hover:bg-gray-50"}>
      <td className="px-3 py-2 text-sm whitespace-nowrap sticky left-0 bg-white border-r border-gray-100 z-10 font-medium max-w-xs truncate">
        {isTotal ? "TỔNG" : (row.sp_label || "—")}
      </td>
      <td className="px-3 py-2 text-sm text-right tabular-nums font-semibold text-red-600">{cell(row.tong_huy)}</td>
      <td className="px-3 py-2 text-sm text-right tabular-nums font-semibold text-violet-600">{cell(row.tong_hoan)}</td>
      {flatReasons.map(r => (
        <td key={r.key} className="px-3 py-2 text-sm text-right tabular-nums text-gray-700">{cell(row[r.key])}</td>
      ))}
    </tr>
  )

  return (
    <div className="bg-white border rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-gray-800">Lý do hủy / hoàn theo Sản phẩm</h3>
          <p className="text-xs text-gray-400 mt-0.5">Đơn hủy + hoàn · mỗi đơn 1 SP chính + 1 lý do ưu tiên</p>
        </div>
        {loading && <span className="text-xs text-gray-400 animate-pulse">Đang tải...</span>}
      </div>
      {data && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left border-collapse">
            <thead>
              {/* hàng nhóm */}
              <tr className="bg-gray-100 border-b border-gray-200">
                <th className="px-3 py-1.5 sticky left-0 bg-gray-100 z-10"></th>
                <th colSpan={2} className="px-3 py-1.5 text-xs font-bold text-gray-700 text-center border-l border-gray-200">Tổng</th>
                {groups.map(g => (
                  <th key={g.group} colSpan={g.reasons.length}
                    className="px-3 py-1.5 text-xs font-bold text-center border-l border-gray-200"
                    style={{ color: groupColor[g.group] ?? "#374151" }}>
                    {g.group}
                  </th>
                ))}
              </tr>
              {/* hàng cột */}
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-3 py-2 text-xs font-semibold text-gray-600 uppercase whitespace-nowrap sticky left-0 bg-gray-50 border-r border-gray-100 z-10">Sản phẩm</th>
                <th onClick={() => toggleSort("tong_huy")} className={`px-3 py-2 text-xs font-semibold uppercase text-right cursor-pointer hover:bg-gray-100 ${sortKey === "tong_huy" ? "text-violet-700" : "text-gray-600"}`}>
                  Hủy{sortKey === "tong_huy" ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                </th>
                <th onClick={() => toggleSort("tong_hoan")} className={`px-3 py-2 text-xs font-semibold uppercase text-right cursor-pointer hover:bg-gray-100 ${sortKey === "tong_hoan" ? "text-violet-700" : "text-gray-600"}`}>
                  Hoàn{sortKey === "tong_hoan" ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                </th>
                {flatReasons.map(r => (
                  <th key={r.key} onClick={() => toggleSort(r.key)}
                    className={`px-3 py-2 text-xs font-semibold whitespace-nowrap text-right cursor-pointer hover:bg-gray-100 ${sortKey === r.key ? "text-violet-700" : "text-gray-500"}`}>
                    {r.label}{sortKey === r.key ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-900">
              {data.totals && renderRow(data.totals, true)}
              {visibleRows.map(r => renderRow(r))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---- Hoàn hủy + LNG theo SP (gộp trong tab Sản phẩm) ----
type ProdRow = Record<string, any>
function ProductLngBlock({ range, market }: { range: DateRange; market: Market }) {
  const [data, setData] = useState<{ rows: ProdRow[]; totals: any; not_supported?: boolean } | null>(null)
  const [loading, setLoading] = useState(false)
  const [sub, setSub] = useState<"hoan_huy" | "thuc" | "tam_tinh">("thuc")
  const [sortKey, setSortKey] = useState<string>("lng_thuc")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  useEffect(() => {
    setLoading(true)
    apiJson(`/admin/pancake-sync/report/product-lng?from=${toISO(range.from)}&to=${toISO(range.to, true)}&market=${market}`)
      .then(setData).finally(() => setLoading(false))
  }, [range.from, range.to, market])

  if (data?.not_supported) {
    return <div className="bg-white border rounded-xl p-6 text-center text-sm text-gray-400">Chưa hỗ trợ báo cáo LNG cho thị trường Malaysia</div>
  }

  const toggleSort = (k: string) => {
    if (sortKey === k) setSortDir(d => d === "desc" ? "asc" : "desc")
    else { setSortKey(k); setSortDir("desc") }
  }

  const pctStr = (v: number | null) => v == null ? "—" : `${v}%`
  const money = (v: number) => fmtNum(Math.round(v || 0))

  // Bộ cột theo sub-tab. key trùng field trong row để sort.
  const colDefs: Record<string, { label: string; key: string; fmt: "num" | "money" | "pct" }[]> = {
    hoan_huy: [
      { label: "Đã nhận", key: "da_nhan", fmt: "num" },
      { label: "Đã hoàn", key: "da_hoan", fmt: "num" },
      { label: "Đang hoàn", key: "dang_hoan", fmt: "num" },
      { label: "Đã huỷ", key: "da_huy", fmt: "num" },
      { label: "Nháp/trùng", key: "don_nhap_trung", fmt: "num" },
      { label: "Đã xóa", key: "da_xoa", fmt: "num" },
      { label: "Đã gửi", key: "da_gui_hang", fmt: "num" },
      { label: "Mới", key: "moi", fmt: "num" },
      { label: "Chờ hàng", key: "cho_hang", fmt: "num" },
      { label: "Tổng đơn giao", key: "tong_don_giao", fmt: "num" },
      { label: "% Hoàn", key: "ty_le_hoan", fmt: "pct" },
      { label: "% Hủy", key: "ty_le_huy", fmt: "pct" },
      { label: "% Giao TC", key: "ty_le_giao", fmt: "pct" },
      { label: "Hoàn+Hủy", key: "hoan_huy", fmt: "pct" },
      { label: "DK hoàn hủy", key: "du_kien_hoan_huy", fmt: "pct" },
    ],
    thuc: [
      { label: "Doanh số", key: "revenue_total", fmt: "money" },
      { label: "Doanh thu TT", key: "revenue_delivered", fmt: "money" },
      { label: "Giá vốn", key: "cogs", fmt: "money" },
      { label: "%GV", key: "cogs_pct", fmt: "pct" },
      { label: "Vận chuyển", key: "ship_cost", fmt: "money" },
      { label: "%VC", key: "ship_pct", fmt: "pct" },
      { label: "Chi phí Ads", key: "ads_cost", fmt: "money" },
      { label: "%Ads", key: "ads_pct", fmt: "pct" },
      { label: "Fullfill", key: "fullfill", fmt: "money" },
      { label: "LNG THỰC", key: "lng_thuc", fmt: "money" },
      { label: "%LNG", key: "lng_pct", fmt: "pct" },
    ],
    tam_tinh: [
      { label: "Doanh số", key: "revenue_total", fmt: "money" },
      { label: "% DK Hoàn hủy", key: "du_kien_hoan_huy", fmt: "pct" },
      { label: "DT tạm tính", key: "revenue_tam_tinh", fmt: "money" },
      { label: "Giá vốn", key: "cogs_tam_tinh", fmt: "money" },
      { label: "%GV", key: "cogs_tt_pct", fmt: "pct" },
      { label: "Vận chuyển", key: "ship_tam_tinh", fmt: "money" },
      { label: "%VC", key: "ship_tt_pct", fmt: "pct" },
      { label: "Chi phí Ads", key: "ads_cost", fmt: "money" },
      { label: "%Ads", key: "ads_tt_pct", fmt: "pct" },
      { label: "Fullfill", key: "fullfill_tam_tinh", fmt: "money" },
      { label: "LNG TẠM TÍNH", key: "lng_tam_tinh", fmt: "money" },
      { label: "%LNG", key: "lng_tt_pct", fmt: "pct" },
    ],
  }
  const cols = colDefs[sub]

  const cellVal = (row: ProdRow, c: { key: string; fmt: string }) => {
    const v = row[c.key]
    if (c.fmt === "pct") return pctStr(v)
    if (c.fmt === "money") return money(v)
    return fmtNum(v ?? 0)
  }
  const cellCls = (row: ProdRow, c: { key: string }) => {
    if (c.key === "lng_thuc" || c.key === "lng_tam_tinh")
      return `font-bold ${(row[c.key] ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`
    if (c.key === "ship_cost" || c.key === "ship_tam_tinh") return "text-amber-700"
    if (c.key === "du_kien_hoan_huy") return "text-rose-600"
    if (c.key.endsWith("_pct")) return "text-gray-400"
    return "text-gray-700"
  }

  const visibleRows = (data?.rows ?? [])
    .filter(r => Number(r.revenue_total || 0) > 0 || Number(r.ads_cost || 0) > 0 || Number(r.total_orders || 0) > 0)
    .sort((a, b) => {
      const av = Number(a[sortKey] ?? 0), bv = Number(b[sortKey] ?? 0)
      return sortDir === "desc" ? bv - av : av - bv
    })

  const renderRow = (row: ProdRow, isTotal = false) => (
    <tr key={isTotal ? "TỔNG" : (row.sp_code || row.sp_label)} className={isTotal ? "bg-violet-50 font-semibold border-t-2 border-violet-200" : "hover:bg-gray-50"}>
      <td className="px-3 py-2 text-sm whitespace-nowrap sticky left-0 bg-white border-r border-gray-100 z-10 font-medium max-w-xs truncate">
        {isTotal ? "TỔNG" : (row.sp_label || "—")}
      </td>
      {cols.map(c => (
        <td key={c.key} className={`px-3 py-2 text-sm text-right tabular-nums ${cellCls(row, c)}`}>{cellVal(row, c)}</td>
      ))}
    </tr>
  )

  const subBtn = (key: "hoan_huy" | "thuc" | "tam_tinh", label: string, defaultSort: string) => (
    <button onClick={() => { setSub(key); setSortKey(defaultSort); setSortDir("desc") }}
      className={`px-3 py-1 text-xs rounded-md font-medium ${sub === key ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
      {label}
    </button>
  )

  return (
    <div className="bg-white border rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-semibold text-gray-800">Hoàn hủy & LNG theo Sản phẩm</h3>
        <div className="flex items-center gap-2">
          {subBtn("hoan_huy", "Hoàn hủy", "tong_don_giao")}
          {subBtn("thuc", "LNG Thực", "lng_thuc")}
          {subBtn("tam_tinh", "LNG Tạm tính", "lng_tam_tinh")}
          {loading && <span className="text-xs text-gray-400 animate-pulse">Đang tải...</span>}
        </div>
      </div>
      {!data && !loading && <div className="p-8 text-center text-gray-400 text-sm">Chọn khoảng thời gian để xem dữ liệu</div>}
      {data && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-3 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap sticky left-0 bg-gray-50 border-r border-gray-100 z-10">Sản phẩm</th>
                {cols.map(c => (
                  <th key={c.key} onClick={() => toggleSort(c.key)}
                    className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wide whitespace-nowrap text-right cursor-pointer select-none hover:bg-gray-100 ${sortKey === c.key ? "text-violet-700" : "text-gray-600"}`}>
                    {c.label}{sortKey === c.key ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-900">
              {data.totals && renderRow(data.totals, true)}
              {visibleRows.map(r => renderRow(r))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---- Sale Tab (giữ nguyên logic cũ) ----
function SaleTab({ range, market }: { range: DateRange; market: Market }) {
  const [perfData, setPerfData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [dateOverride, setDateOverride] = useState(todayVN())
  const [useRange, setUseRange] = useState(false)

  useEffect(() => {
    setLoading(true)
    const date = useRange ? range.from : dateOverride
    apiFetch(`/admin/pancake-sync/report/sale-performance?date=${date}&market=${market}`)
      .then(r => r.json()).then(setPerfData).catch(() => setPerfData(null))
      .finally(() => setLoading(false))
  }, [dateOverride, useRange, range.from, market])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input type="checkbox" checked={useRange} onChange={e => setUseRange(e.target.checked)} className="rounded" />
          Dùng period chung
        </label>
        {!useRange && (
          <input type="date" value={dateOverride}
            onChange={e => setDateOverride(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm bg-white text-gray-900" />
        )}
        {perfData && (
          <span className="text-sm text-gray-400">
            {perfData.summary?.total_orders} đơn · {perfData.summary?.total_confirmed} đã xác nhận · {perfData.summary?.overall_confirm_rate}%
          </span>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Đang tải…</div>
      ) : !perfData || !perfData.sales?.length ? (
        <div className="text-center py-12 text-gray-400">Không có dữ liệu</div>
      ) : (
        <>
          {/* Funnel */}
          {perfData.summary?.total_orders > 0 && (
            <div className="bg-white border rounded-xl p-5 shadow-sm">
              <h3 className="font-semibold text-gray-700 mb-4 text-sm">Funnel tổng</h3>
              {(() => {
                const total = perfData.summary.total_orders
                const confirmed = perfData.summary.total_confirmed
                const cancelled = perfData.sales.reduce((s: number, x: any) => s + (x.cancelled || 0), 0)
                return (
                  <div className="space-y-2">
                    {[
                      { label: "Đơn vào", v: total, pct: 100, color: "bg-blue-500" },
                      { label: "Đã xác nhận", v: confirmed, pct: Math.round(confirmed / total * 100), color: "bg-green-500" },
                      { label: "Hủy/Hoàn", v: cancelled, pct: Math.round(cancelled / total * 100), color: "bg-gray-400" },
                    ].map(st => (
                      <div key={st.label} className="flex items-center gap-3">
                        <div className="w-24 text-sm text-gray-600">{st.label}</div>
                        <div className="flex-1 relative h-7 bg-gray-100 rounded overflow-hidden">
                          <div className={`absolute inset-y-0 left-0 ${st.color} rounded`}
                            style={{ width: `${Math.max(st.pct, 2)}%` }} />
                          <span className="absolute inset-y-0 flex items-center pl-3 text-xs text-white z-10">
                            {st.v} ({st.pct}%)
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>
          )}

          {/* Sale table */}
          <div className="bg-white border rounded-xl shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b text-xs">
                <tr>
                  {["Sale","Tổng","Còn chờ","KNM 1","KNM 2","KNM 3+","Đã xác nhận","Hủy","Tỷ lệ XN"].map(h => (
                    <th key={h} className="px-4 py-2.5 font-semibold text-gray-600 text-left last:text-right">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y text-gray-900">
                {perfData.sales.map((s: any) => (
                  <tr key={s.sale_name} className={s.no_action > 3 ? "bg-red-50/60" : ""}>
                    <td className="px-4 py-2.5 font-semibold text-gray-900">{s.sale_name}</td>
                    <td className="px-3 py-2.5 font-mono">{s.total}</td>
                    <td className={`px-3 py-2.5 font-mono font-semibold ${s.no_action > 3 ? "text-red-600" : s.no_action > 0 ? "text-orange-500" : "text-gray-400"}`}>{s.no_action}</td>
                    <td className="px-3 py-2.5 font-mono text-yellow-700">{s.knm_1 || "—"}</td>
                    <td className="px-3 py-2.5 font-mono text-orange-600">{s.knm_2 || "—"}</td>
                    <td className="px-3 py-2.5 font-mono font-bold text-red-600">{s.knm_3_plus > 0 ? `${s.knm_3_plus} ⚠️` : "—"}</td>
                    <td className="px-3 py-2.5 font-mono text-green-700 font-semibold">{s.confirmed || "—"}</td>
                    <td className="px-3 py-2.5 font-mono text-gray-400">{s.cancelled || "—"}</td>
                    <td className={`px-4 py-2.5 text-right font-bold ${s.confirm_rate >= 30 ? "text-green-600" : s.confirm_rate < 10 && s.total >= 5 ? "text-red-500" : "text-gray-700"}`}>
                      {s.confirm_rate}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Bảng tình trạng vận đơn theo Sale (hoàn/hủy/giao) — dùng period chung, khớp tab NV MKT */}
          <SaleStatusTable range={range} market={market} />

          {/* Bảng chỉ số KPI theo Sale (Tổng data, TC, doanh thu, Sale chốt/Up/Cross) */}
          <SaleKpiTable range={range} market={market} />
        </>
      )}
    </div>
  )
}

// ---- Bảng chỉ số KPI theo Sale (để tính thưởng hàng tháng) ----
// Nguồn: report/sale-kpi. Sale chốt/Up/Cross đếm doanh thu đơn giao TC có tag Pancake.
function SaleKpiTable({ range, market }: { range: DateRange; market: Market }) {
  const [data, setData] = useState<{ rows: any[]; summary: any; not_supported?: boolean } | null>(null)
  const [loading, setLoading] = useState(false)
  const fmt = useFmtMoney()

  useEffect(() => {
    setLoading(true)
    apiJson(`/admin/pancake-sync/report/sale-kpi?from=${toISO(range.from)}&to=${toISO(range.to, true)}&market=${market}`)
      .then(setData).finally(() => setLoading(false))
  }, [range.from, range.to, market])

  if (data?.not_supported) return null

  const cols: { key: string; label: string; money?: boolean }[] = [
    { key: "tong_data", label: "Tổng data" },
    { key: "don_thanh_cong", label: "Đơn thành công" },
    { key: "tong_doanh_thu", label: "Tổng doanh thu", money: true },
    { key: "doanh_thu_thuc", label: "Doanh thu thực", money: true },
    { key: "sale_chot", label: "Sale chốt", money: true },
    { key: "up_sale", label: "Up sale", money: true },
    { key: "cross_sale", label: "Cross sale", money: true },
  ]

  const renderRow = (row: any, isTotal = false) => (
    <tr key={row.sale_name} className={isTotal ? "bg-violet-50 font-semibold border-t-2 border-violet-200" : "hover:bg-gray-50"}>
      <td className="px-3 py-2 text-sm whitespace-nowrap sticky left-0 bg-white border-r border-gray-100 z-10 font-medium">{row.sale_name}</td>
      {cols.map(c => (
        <td key={c.key} className="px-3 py-2 text-sm text-right tabular-nums text-gray-700">
          {c.money ? fmt(row[c.key]) : fmtNum(row[c.key])}
        </td>
      ))}
    </tr>
  )

  return (
    <div className="bg-white border rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-semibold text-gray-800">Chỉ số KPI theo Sale</h3>
        <div className="flex items-center gap-2">
          {loading && <span className="text-xs text-gray-400 animate-pulse">Đang tải...</span>}
          <span className="text-xs text-gray-400">Sale chốt / Up / Cross = DT đơn giao TC có tag Pancake</span>
        </div>
      </div>
      {data && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-3 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap sticky left-0 bg-gray-50 border-r border-gray-100 z-10">Sale</th>
                {cols.map(c => (
                  <th key={c.key} className="px-3 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap text-right">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-900">
              {renderRow(data.summary, true)}
              {data.rows.map(r => renderRow(r))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---- Bảng tình trạng vận đơn theo Sale (song song NV MKT, gom theo sale_name) ----
// Nguồn: report/sale-status — CÙNG excludeCond với marketer-performance nên TỔNG khớp tab NV MKT.
function SaleStatusTable({ range, market }: { range: DateRange; market: Market }) {
  const [data, setData] = useState<{ rows: any[]; summary: any; not_supported?: boolean } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    apiJson(`/admin/pancake-sync/report/sale-status?from=${toISO(range.from)}&to=${toISO(range.to, true)}&market=${market}`)
      .then(setData).finally(() => setLoading(false))
  }, [range.from, range.to, market])

  if (data?.not_supported) return null

  // Cột đầy đủ, KHỚP 1-1 với bảng NV MKT.
  const cols: { key: string; label: string; pct?: boolean }[] = [
    { key: "da_nhan", label: "Đã nhận" },
    { key: "da_hoan", label: "Đã hoàn" },
    { key: "dang_hoan", label: "Đang hoàn" },
    { key: "da_huy", label: "Đã huỷ" },
    { key: "don_nhap_trung", label: "Đơn nháp, trùng Hủy" },
    { key: "da_xoa", label: "Đã xóa" },
    { key: "da_gui_hang", label: "Đã gửi hàng" },
    { key: "moi", label: "Mới" },
    { key: "cho_hang", label: "Chờ hàng" },
    { key: "da_xac_nhan", label: "Đã xác nhận" },
    { key: "dang_dong_hang", label: "Đang đóng hàng" },
    { key: "cho_chuyen_hang", label: "Chờ chuyển hàng" },
    { key: "tong_don_giao", label: "Tổng đơn giao" },
    { key: "ty_le_hoan", label: "Tỷ lệ hoàn", pct: true },
    { key: "ty_le_huy", label: "Tỷ lệ hủy", pct: true },
    { key: "ty_le_giao", label: "Tỷ lệ giao TC", pct: true },
    { key: "hoan_huy", label: "Hoàn + Hủy", pct: true },
    { key: "du_kien_hoan_huy", label: "Dự kiến hoàn hủy", pct: true },
  ]

  const renderRow = (row: any, isTotal = false) => (
    <tr key={row.sale_name} className={isTotal ? "bg-violet-50 font-semibold border-t-2 border-violet-200" : "hover:bg-gray-50"}>
      <td className="px-3 py-2 text-sm whitespace-nowrap sticky left-0 bg-white border-r border-gray-100 z-10 font-medium">{row.sale_name}</td>
      {cols.map(c => {
        const v = row[c.key] as number
        const isBad = (c.key === "ty_le_hoan" || c.key === "ty_le_huy") && v > 15
        const isGood = c.key === "ty_le_giao" && v >= 60
        return (
          <td key={c.key} className={`px-3 py-2 text-sm text-right tabular-nums ${isBad ? "text-red-600 font-semibold" : isGood ? "text-green-600" : "text-gray-700"}`}>
            {c.pct ? `${v}%` : fmtNum(v)}
          </td>
        )
      })}
    </tr>
  )

  return (
    <div className="bg-white border rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-semibold text-gray-800">Tình trạng Vận đơn theo Sale</h3>
        {loading && <span className="text-xs text-gray-400 animate-pulse">Đang tải...</span>}
      </div>
      {data && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-3 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap sticky left-0 bg-gray-50 border-r border-gray-100 z-10">Sale</th>
                {cols.map(c => (
                  <th key={c.key} className="px-3 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap text-right">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-900">
              {renderRow(data.summary, true)}
              {data.rows.map(r => renderRow(r))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---- NV MKT Tab ----
type MktRow = {
  marketer: string
  da_nhan: number; da_hoan: number; dang_hoan: number; da_huy: number
  don_nhap_trung: number; da_xoa: number; da_gui_hang: number; moi: number
  cho_hang: number; da_xac_nhan: number; dang_dong_hang: number
  cho_chuyen_hang: number; tong_giao: number; tong_don_giao: number
  hoan_huy: number; du_kien_hoan_huy: number
  ty_le_hoan: number; ty_le_huy: number; ty_le_giao: number
}

function NvMktTab({ range, market }: { range: DateRange; market: Market }) {
  const [data, setData] = useState<{ rows: MktRow[]; summary: MktRow; not_supported?: boolean } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    apiJson(`/admin/pancake-sync/report/marketer-performance?from=${toISO(range.from)}&to=${toISO(range.to, true)}&market=${market}`)
      .then(setData).finally(() => setLoading(false))
  }, [range.from, range.to, market])

  if (data?.not_supported) {
    return <div className="bg-white border rounded-xl p-6 text-center text-sm text-gray-400">Chưa hỗ trợ báo cáo này cho thị trường Malaysia</div>
  }

  const cols: { key: keyof MktRow; label: string; pct?: boolean }[] = [
    { key: "da_nhan",         label: "Đã nhận" },
    { key: "da_hoan",         label: "Đã hoàn" },
    { key: "dang_hoan",       label: "Đang hoàn" },
    { key: "da_huy",          label: "Đã huỷ" },
    { key: "don_nhap_trung",  label: "Đơn nháp, trùng Hủy" },
    { key: "da_xoa",          label: "Đã xóa" },
    { key: "da_gui_hang",     label: "Đã gửi hàng" },
    { key: "moi",             label: "Mới" },
    { key: "cho_hang",        label: "Chờ hàng" },
    { key: "da_xac_nhan",     label: "Đã xác nhận" },
    { key: "dang_dong_hang",  label: "Đang đóng hàng" },
    { key: "cho_chuyen_hang", label: "Chờ chuyển hàng" },
    { key: "tong_don_giao",   label: "Tổng đơn giao" },
    { key: "ty_le_hoan",      label: "Tỷ lệ hoàn", pct: true },
    { key: "ty_le_huy",       label: "Tỷ lệ hủy",  pct: true },
    { key: "ty_le_giao",      label: "Tỷ lệ giao TC", pct: true },
    { key: "hoan_huy",        label: "Hoàn + Hủy", pct: true },
    { key: "du_kien_hoan_huy", label: "Dự kiến hoàn hủy", pct: true },
  ]

  const renderRow = (row: MktRow, isTotal = false) => (
    <tr key={row.marketer} className={isTotal ? "bg-violet-50 font-semibold border-t-2 border-violet-200" : "hover:bg-gray-50"}>
      <td className="px-3 py-2 text-sm whitespace-nowrap sticky left-0 bg-white border-r border-gray-100 z-10 font-medium">
        {row.marketer}
      </td>
      {cols.map(c => {
        const v = row[c.key] as number
        const isBad = (c.key === "ty_le_hoan" || c.key === "ty_le_huy") && v > 15
        const isGood = c.key === "ty_le_giao" && v >= 60
        return (
          <td key={c.key} className={`px-3 py-2 text-sm text-right tabular-nums ${isBad ? "text-red-600 font-semibold" : isGood ? "text-green-600" : "text-gray-700"}`}>
            {c.pct ? `${v}%` : fmtNum(v)}
          </td>
        )
      })}
    </tr>
  )

  return (
    <div className="bg-white border rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-semibold text-gray-800">Tình trạng Vận đơn theo NV MKT</h3>
        {loading && <span className="text-xs text-gray-400 animate-pulse">Đang tải...</span>}
      </div>
      {!data && !loading && <div className="p-8 text-center text-gray-400 text-sm">Chọn khoảng thời gian để xem dữ liệu</div>}
      {data && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-3 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap sticky left-0 bg-gray-50 border-r border-gray-100 z-10">NV MKT</th>
                {cols.map(c => (
                  <th key={c.key} className="px-3 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap text-right">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-900">
              {renderRow(data.summary, true)}
              {data.rows.map(r => renderRow(r))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---- LNG theo MKT Tab ----
type LngRow = {
  mkt_name: string
  total_orders: number
  revenue_total: number
  revenue_delivered: number
  cogs: number
  ship_cost: number
  ads_cost: number
  fullfill: number
  lng: number
  lng_thuc: number
  cogs_pct: number | null
  ship_pct: number | null
  ads_pct: number | null
  fullfill_pct: number | null
  lng_pct: number | null
  // khối tạm tính
  du_kien_hoan_huy: number
  revenue_tam_tinh: number
  cogs_tam_tinh: number
  ship_tam_tinh: number
  fullfill_tam_tinh: number
  lng_tam_tinh: number
  cogs_tt_pct: number | null
  ship_tt_pct: number | null
  ads_tt_pct: number | null
  fullfill_tt_pct: number | null
  lng_tt_pct: number | null
  cp_thuc?: number | null
  lng_thuc_kt?: number | null
  cp_thuc_pct?: number | null
}

function LngTab({ range, market }: { range: DateRange; market: Market }) {
  const [data, setData] = useState<{ rows: LngRow[]; totals: any; mapped_pct: number; cost_mapped: number; cost_total: number; has_accounting?: boolean; not_supported?: boolean } | null>(null)
  const [loading, setLoading] = useState(false)
  const [sub, setSub] = useState<"thuc" | "tam_tinh">("thuc")
  const [sortKey, setSortKey] = useState<keyof LngRow>(sub === "thuc" ? "lng_thuc" : "lng_tam_tinh")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const toggleSort = (k: keyof LngRow) => {
    if (sortKey === k) setSortDir(d => d === "desc" ? "asc" : "desc")
    else { setSortKey(k); setSortDir("desc") }
  }

  useEffect(() => {
    setLoading(true)
    apiJson(`/admin/pancake-sync/report/marketer-lng?from=${toISO(range.from)}&to=${toISO(range.to, true)}&market=${market}`)
      .then(setData).finally(() => setLoading(false))
  }, [range.from, range.to, market])

  if (data?.not_supported) {
    return <div className="bg-white border rounded-xl p-6 text-center text-sm text-gray-400">Chưa hỗ trợ báo cáo LNG cho thị trường Malaysia</div>
  }

  const pctStr = (v: number | null) => v == null ? "—" : `${v}%`
  const money = (v: number) => fmtNum(Math.round(v || 0))

  // Mỗi sub-tab có bộ cột riêng: định nghĩa value/className để renderRow chạy chung.
  type Cell = { val: string; cls?: string; tip?: string }
  const hasAcc = !!data?.has_accounting

  // Báo cáo theo SP: giá vốn gồm cả quà tặng kèm (combo). Tooltip tách rõ SP / quà,
  // vì %GV combo cao hơn hẳn bán lẻ và người xem cần biết phần chênh đến từ đâu.
  const giftTip = (row: LngRow): string | undefined => {
    const gd = (row as any).gift_detail as { label: string; qty: number; unit_cost: number | null; cost: number }[] | undefined
    if (!gd?.length) return undefined
    const lines = gd.map(d => `  · ${d.label} ×${d.qty} = ${d.unit_cost == null ? "CHƯA CÓ GIÁ VỐN" : money(d.cost) + "đ"}`)
    return [
      `Giá vốn SP: ${money((row as any).cogs_sp ?? 0)}đ`,
      `Quà tặng kèm: ${money((row as any).cogs_gift ?? 0)}đ`,
      ...lines,
    ].join("\n")
  }
  const buildCells = (row: LngRow): Cell[] => {
    if (sub === "thuc") {
      const cells: Cell[] = [
        { val: money(row.revenue_total) },
        { val: money(row.revenue_delivered) },
        { val: money(row.cogs) + (((row as any).cogs_gift ?? 0) > 0 ? " 🎁" : ""), tip: giftTip(row) },
        { val: pctStr(row.cogs_pct), cls: "text-gray-400", tip: giftTip(row) },
        { val: money(row.ship_cost), cls: "text-amber-700" },
        { val: pctStr(row.ship_pct), cls: "text-gray-400" },
        { val: money(row.ads_cost) },
        { val: pctStr(row.ads_pct), cls: "text-gray-400" },
        { val: money(row.fullfill) },
        { val: pctStr(row.fullfill_pct), cls: "text-gray-400" },
        { val: money(row.lng_thuc ?? row.lng), cls: `font-bold ${(row.lng_thuc ?? row.lng) >= 0 ? "text-green-600" : "text-red-600"}` },
        { val: pctStr(row.lng_pct), cls: (row.lng_pct ?? 0) >= 0 ? "text-green-600" : "text-red-600" },
      ]
      // Cột CP thực kế toán (chỉ khi tháng đã nhập chi phí) — chèn ngay sau cột Ads.
      if (hasAcc) {
        const lngKt = (row as any).lng_thuc_kt
        cells.splice(8, 0,
          { val: (row as any).cp_thuc != null ? money((row as any).cp_thuc) : "—", cls: "text-violet-700 font-medium" },
          { val: pctStr((row as any).cp_thuc_pct), cls: "text-gray-400" },
        )
        cells.push(
          { val: lngKt != null ? money(lngKt) : "—", cls: `font-bold ${(lngKt ?? 0) >= 0 ? "text-green-700" : "text-red-600"}` },
        )
      }
      return cells
    }
    // tạm tính
    return [
      { val: money(row.revenue_total) },
      { val: pctStr(row.du_kien_hoan_huy), cls: "text-rose-600" },
      { val: money(row.revenue_tam_tinh) },
      { val: money(row.cogs_tam_tinh) },
      { val: pctStr(row.cogs_tt_pct), cls: "text-gray-400" },
      { val: money(row.ship_tam_tinh), cls: "text-amber-700" },
      { val: pctStr(row.ship_tt_pct), cls: "text-gray-400" },
      { val: money(row.ads_cost) },
      { val: pctStr(row.ads_tt_pct), cls: "text-gray-400" },
      { val: money(row.fullfill_tam_tinh) },
      { val: money(row.lng_tam_tinh), cls: `font-bold ${row.lng_tam_tinh >= 0 ? "text-green-600" : "text-red-600"}` },
      { val: pctStr(row.lng_tt_pct), cls: (row.lng_tt_pct ?? 0) >= 0 ? "text-green-600" : "text-red-600" },
    ]
  }

  const renderRow = (row: LngRow, isTotal = false) => (
    <tr key={row.mkt_name} className={isTotal ? "bg-violet-50 font-semibold border-t-2 border-violet-200" : "hover:bg-gray-50"}>
      <td className="px-3 py-2 text-sm whitespace-nowrap sticky left-0 bg-white border-r border-gray-100 z-10 font-medium">
        {isTotal ? "TỔNG" : row.mkt_name}
      </td>
      {buildCells(row).map((c, i) => (
        <td key={i} title={c.tip} className={`px-3 py-2 text-sm text-right tabular-nums ${c.cls ?? "text-gray-700"}${c.tip ? " cursor-help" : ""}`}>{c.val}</td>
      ))}
    </tr>
  )

  // heads gắn sort key trùng field trong LngRow để click header sort được.
  const heads: { label: string; key: keyof LngRow }[] = sub === "thuc"
    ? [
        { label: "Doanh số", key: "revenue_total" },
        { label: "Doanh thu TT", key: "revenue_delivered" },
        { label: "Giá vốn", key: "cogs" },
        { label: "%GV", key: "cogs_pct" },
        { label: "Vận chuyển", key: "ship_cost" },
        { label: "%VC", key: "ship_pct" },
        { label: "Chi phí Ads", key: "ads_cost" },
        { label: "%Ads", key: "ads_pct" },
        ...(hasAcc ? [
          { label: "CP thực (KT)", key: "cp_thuc" as keyof LngRow },
          { label: "%CP thực", key: "cp_thuc_pct" as keyof LngRow },
        ] : []),
        { label: "Fullfill", key: "fullfill" },
        { label: "%FF", key: "fullfill_pct" },
        { label: "LNG THỰC", key: "lng_thuc" },
        { label: "%LNG", key: "lng_pct" },
        ...(hasAcc ? [{ label: "LNG THỰC (KT)", key: "lng_thuc_kt" as keyof LngRow }] : []),
      ]
    : [
        { label: "Doanh số", key: "revenue_total" },
        { label: "% DK Hoàn hủy", key: "du_kien_hoan_huy" },
        { label: "DT tạm tính", key: "revenue_tam_tinh" },
        { label: "Giá vốn", key: "cogs_tam_tinh" },
        { label: "%GV", key: "cogs_tt_pct" },
        { label: "Vận chuyển", key: "ship_tam_tinh" },
        { label: "%VC", key: "ship_tt_pct" },
        { label: "Chi phí Ads", key: "ads_cost" },
        { label: "%Ads", key: "ads_tt_pct" },
        { label: "Fullfill", key: "fullfill_tam_tinh" },
        { label: "LNG TẠM TÍNH", key: "lng_tam_tinh" },
        { label: "%LNG", key: "lng_tt_pct" },
      ]

  // Ẩn dòng marketer toàn 0 (không doanh số lẫn ads), rồi sort theo cột đang chọn.
  const visibleRows = (data?.rows ?? [])
    .filter(r => Number(r.revenue_total || 0) > 0 || Number(r.ads_cost || 0) > 0)
    .sort((a, b) => {
      const av = Number(a[sortKey] ?? 0), bv = Number(b[sortKey] ?? 0)
      return sortDir === "desc" ? bv - av : av - bv
    })

  const totalRow: LngRow | null = data ? (() => {
    const t = data.totals
    const p = (part: number, whole: number) => whole > 0 ? Math.round(part / whole * 10000) / 100 : null
    return {
      mkt_name: "TỔNG",
      ...t,
      lng_thuc: t.lng_thuc ?? t.lng,
      cogs_pct: p(t.cogs, t.revenue_delivered),
      ship_pct: p(t.ship_cost, t.revenue_delivered),
      ads_pct: p(t.ads_cost, t.revenue_total),
      fullfill_pct: p(t.fullfill, t.revenue_delivered),
      lng_pct: p(t.lng, t.revenue_delivered),
      cogs_tt_pct: p(t.cogs_tam_tinh, t.revenue_tam_tinh),
      ship_tt_pct: p(t.ship_tam_tinh, t.revenue_tam_tinh),
      ads_tt_pct: p(t.ads_cost, t.revenue_total),
      fullfill_tt_pct: p(t.fullfill_tam_tinh, t.revenue_tam_tinh),
      lng_tt_pct: p(t.lng_tam_tinh, t.revenue_tam_tinh),
      cp_thuc_pct: t.cp_thuc != null ? p(t.cp_thuc, t.revenue_total) : null,
    } as LngRow
  })() : null

  const subBtn = (key: "thuc" | "tam_tinh", label: string) => (
    <button onClick={() => { setSub(key); setSortKey(key === "thuc" ? "lng_thuc" : "lng_tam_tinh"); setSortDir("desc") }}
      className={`px-3 py-1 text-xs rounded-md font-medium ${sub === key ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
      {label}
    </button>
  )

  return (
    <div className="space-y-4">
    <LngTrendChart range={range} market={market} />
    <div className="bg-white border rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-gray-800">Lợi nhuận gộp (LNG) theo NV MKT</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {sub === "thuc"
              ? "LNG thực = Doanh thu đã nhận − (Giá vốn + Vận chuyển + Ads + Fullfill 5.000đ/đơn)"
              : "LNG tạm tính = DT tạm tính (= doanh số × (1 − % dự kiến hoàn hủy)) − (Giá vốn + Vận chuyển + Ads + Fullfill)"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {subBtn("thuc", "Thực")}
          {subBtn("tam_tinh", "Tạm tính")}
          {loading && <span className="text-xs text-gray-400 animate-pulse">Đang tải...</span>}
        </div>
      </div>
      {data && (data.mapped_pct < 100) && (
        <div className="px-5 py-2 bg-amber-50 border-b border-amber-100 text-xs text-amber-700">
          ⚠️ Giá vốn mới map được <b>{data.mapped_pct}%</b> số lượng SP đã giao
          ({data.cost_mapped}/{data.cost_total} sản phẩm trong bảng giá vốn có mã liên kết).
          Phần chưa map tính giá vốn = 0 → LNG có thể cao hơn thực tế.
        </div>
      )}
      {!data && !loading && <div className="p-8 text-center text-gray-400 text-sm">Chọn khoảng thời gian để xem dữ liệu</div>}
      {data && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-3 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap sticky left-0 bg-gray-50 border-r border-gray-100 z-10">NV MKT</th>
                {heads.map(h => (
                  <th key={h.key as string}
                    onClick={() => toggleSort(h.key)}
                    className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wide whitespace-nowrap text-right cursor-pointer select-none hover:bg-gray-100 ${sortKey === h.key ? "text-violet-700" : "text-gray-600"}`}>
                    {h.label}{sortKey === h.key ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-900">
              {totalRow && renderRow(totalRow, true)}
              {visibleRows.map(r => renderRow(r))}
            </tbody>
          </table>
        </div>
      )}
    </div>
    <PlatformLngTable range={range} market={market} sub={sub} heads={heads} buildCells={buildCells} />
    </div>
  )
}

// ---- Bảng LNG theo NỀN TẢNG chạy ads (Facebook / Google) ----
// Dùng LẠI heads + buildCells của LngTab để 2 bảng cùng bộ cột và cùng cách hiển thị;
// chỉ đổi nguồn API (platform-lng) và nhãn cột đầu. Backend tính 2 báo cáo trên cùng
// grain (MKT × nền tảng) nên TỔNG của bảng này khớp tuyệt đối với bảng theo NV MKT.
function PlatformLngTable({ range, market, sub, heads, buildCells }: {
  range: DateRange
  market: Market
  sub: "thuc" | "tam_tinh"
  heads: { label: string; key: keyof LngRow }[]
  buildCells: (row: LngRow) => { val: string; cls?: string }[]
}) {
  const [data, setData] = useState<{ rows: any[]; totals: any; cost_chung?: number | null; has_accounting?: boolean; not_supported?: boolean } | null>(null)
  const [loading, setLoading] = useState(false)
  const fmt = useFmtMoney()

  useEffect(() => {
    setLoading(true)
    apiJson(`/admin/pancake-sync/report/platform-lng?from=${toISO(range.from)}&to=${toISO(range.to, true)}&market=${market}`)
      .then(setData).finally(() => setLoading(false))
  }, [range.from, range.to, market])

  if (data?.not_supported) return null

  const PLATFORM_STYLE: Record<string, string> = {
    facebook: "text-blue-600",
    google: "text-red-500",
  }

  const renderRow = (row: any, isTotal = false) => (
    <tr key={isTotal ? "__total" : row.platform} className={isTotal ? "bg-violet-50 font-semibold border-t-2 border-violet-200" : "hover:bg-gray-50"}>
      <td className={`px-3 py-2 text-sm whitespace-nowrap sticky left-0 border-r border-gray-100 z-10 font-medium ${isTotal ? "bg-violet-50 text-gray-900" : `bg-white ${PLATFORM_STYLE[row.platform] ?? "text-gray-900"}`}`}>
        {isTotal ? "TỔNG" : row.platform_label}
      </td>
      {buildCells(row as LngRow).map((c, i) => (
        <td key={i} className={`px-3 py-2 text-sm text-right tabular-nums ${c.cls ?? "text-gray-700"}`}>{c.val}</td>
      ))}
    </tr>
  )

  const totalRow = data ? { ...data.totals, platform: "__total" } : null

  return (
    <div className="bg-white border rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-gray-800">Lợi nhuận gộp (LNG) theo nền tảng</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Cùng công thức và cùng tập đơn với bảng trên, chỉ đổi chiều gom nhóm — tổng 2 bảng luôn khớp.
            Chi phí Ads: Facebook lấy từ FB Ads API, Google từ sheet GG Ads.
          </p>
        </div>
        {loading && <span className="text-xs text-gray-400 animate-pulse">Đang tải...</span>}
      </div>
      {!data && !loading && <div className="p-8 text-center text-gray-400 text-sm">Chọn khoảng thời gian để xem dữ liệu</div>}
      {data && (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-3 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap sticky left-0 bg-gray-50 border-r border-gray-100 z-10">NỀN TẢNG</th>
                  {heads.map(h => (
                    <th key={h.key as string}
                      className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide whitespace-nowrap text-right text-gray-600">
                      {h.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-900">
                {totalRow && renderRow(totalRow, true)}
                {(data.rows ?? []).map(r => renderRow(r))}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-2 border-t bg-gray-50 text-xs text-gray-500">
            Đơn có marker Google (gclid, gad_campaignid…) tính vào Google Ads; phần còn lại — kể cả đơn
            không xác định được nguồn — tính vào Facebook Ads.
            {sub === "thuc" && data.has_accounting && (data.cost_chung ?? 0) > 0 && (
              <> Cột CP thực (KT) ở đây chỉ gồm tiền nạp tài khoản (FB + Google); chi phí chung
                (NL/ITY/ZALO…) <b>{fmt(data.cost_chung ?? 0)}</b> không thuộc nền tảng nào nên không
                được chia vào 2 dòng — vì vậy tổng CP thực bảng này nhỏ hơn bảng theo NV MKT đúng bằng
                khoản đó.</>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ---- Bảng LNG THỰC + TẠM TÍNH theo NGÀY (độc lập, không cộng dồn) ----
// Mỗi dòng = 1 ngày, tính riêng cho đơn TẠO ngày đó. LNG thực = chỉ đơn đã nhận (tiền
// đã về); LNG tạm tính = thực + dự phóng đơn treo (công thức B). Ngày gần nhất: LNG thực
// thấp/âm (đơn chưa kịp giao xong) còn tạm tính đã dự phóng nên phản ánh đúng hơn.
function LngTrendChart({ range, market }: { range: DateRange; market: Market }) {
  const [data, setData] = useState<{ rows: any[]; not_supported?: boolean } | null>(null)
  const [loading, setLoading] = useState(false)
  const fmt = useFmtMoney()

  useEffect(() => {
    setLoading(true)
    apiJson(`/admin/pancake-sync/report/lng-by-day?from=${toISO(range.from)}&to=${toISO(range.to, true)}&market=${market}`)
      .then(setData).finally(() => setLoading(false))
  }, [range.from, range.to, market])

  if (data?.not_supported) return null
  const rows = data?.rows ?? []
  if (!rows.length) return null

  const maxAbs = Math.max(...rows.map(r => Math.abs(r.lng_tam_tinh)), 1)
  // Xu hướng: so LNG tạm tính trung bình nửa cuối kỳ vs nửa đầu → tốt lên hay tệ đi.
  const mid = Math.floor(rows.length / 2)
  const avg = (arr: any[]) => arr.length ? arr.reduce((s, r) => s + r.lng_tam_tinh, 0) / arr.length : 0
  const trendUp = avg(rows.slice(mid)) >= avg(rows.slice(0, mid))

  const moneyCls = (v: number) => v >= 0 ? "text-green-700" : "text-red-600"

  return (
    <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-gray-800">LNG theo ngày (Thực & Tạm tính)</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Mỗi dòng = đơn TẠO ngày đó (độc lập, không cộng dồn). LNG thực = tiền đã về (đơn đã nhận);
            tạm tính = thực + dự phóng đơn treo.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {loading && <span className="text-xs text-gray-400 animate-pulse">Đang tải...</span>}
          <span className={`text-xs font-semibold ${trendUp ? "text-green-600" : "text-red-600"}`}>
            {trendUp ? "↗ Nửa cuối kỳ tốt hơn" : "↘ Nửa cuối kỳ đang giảm"}
          </span>
        </div>
      </div>
      <div className="overflow-x-auto max-h-96 overflow-y-auto">
        <table className="min-w-full text-left border-collapse">
          <thead className="sticky top-0 bg-gray-50 z-10">
            <tr className="border-b border-gray-200 text-xs text-gray-600 uppercase tracking-wide">
              <th className="px-3 py-2.5 font-semibold sticky left-0 bg-gray-50 border-r border-gray-100">Ngày</th>
              <th className="px-3 py-2.5 font-semibold text-right">Doanh số</th>
              <th className="px-3 py-2.5 font-semibold text-right">%Chi phí</th>
              <th className="px-3 py-2.5 font-semibold text-right">LNG thực</th>
              <th className="px-3 py-2.5 font-semibold text-right">%LNG thực</th>
              <th className="px-3 py-2.5 font-semibold text-right">LNG tạm tính</th>
              <th className="px-3 py-2.5 font-semibold text-right">%LNG TT</th>
              <th className="px-3 py-2.5 font-semibold text-right">ROAS</th>
              <th className="px-3 py-2.5 font-semibold text-right w-40">Xu hướng (tạm tính)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-gray-900">
            {rows.map(r => {
              const neg = r.lng_tam_tinh < 0
              const w = Math.round(Math.abs(r.lng_tam_tinh) / maxAbs * 100)
              return (
                <tr key={r.date} className="hover:bg-gray-50 text-sm">
                  <td className="px-3 py-2 whitespace-nowrap sticky left-0 bg-white border-r border-gray-100 font-medium text-gray-700">{r.date.slice(5)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{fmt(r.revenue_mkt)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium" style={{ color: carePctColor(r.ads_pct_of_revenue_mkt) }}>
                    {r.ads_pct_of_revenue_mkt != null ? `${r.ads_pct_of_revenue_mkt}%` : "—"}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums font-medium ${moneyCls(r.lng_thuc)}`}>{fmt(r.lng_thuc)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-400">{r.lng_thuc_pct}%</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-semibold ${moneyCls(r.lng_tam_tinh)}`}>{fmt(r.lng_tam_tinh)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-400">{r.lng_pct}%</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500">{r.roas != null ? `${r.roas}x` : "—"}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center">
                      <div className="w-1/2 flex justify-end">{neg && <div className="h-3 bg-red-400 rounded-l" style={{ width: `${w}%` }} />}</div>
                      <div className="w-px h-4 bg-gray-300 flex-shrink-0" />
                      <div className="w-1/2 flex justify-start">{!neg && <div className="h-3 bg-green-500 rounded-r" style={{ width: `${w}%` }} />}</div>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="px-5 py-2 border-t text-[10px] text-gray-400">
        LNG thực = DT đã nhận − (giá vốn + vận chuyển + ads + fullfill). Ngày gần nhất LNG thực thấp/âm là bình thường (đơn chưa kịp giao xong) — xem cột tạm tính.
      </div>
    </div>
  )
}

// ---- Đơn lỗi Tab ----
function ErrorsTab({ range, market }: { range: DateRange; market: Market }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    apiJson(`/admin/pancake-sync/report/lng-errors?from=${toISO(range.from)}&to=${toISO(range.to, true)}&market=${market}`)
      .then(setData).finally(() => setLoading(false))
  }, [range.from, range.to, market])

  if (!data && loading) return <div className="p-8 text-center text-gray-400 text-sm animate-pulse">Đang tải...</div>
  if (!data) return <div className="p-8 text-center text-gray-400 text-sm">Chọn khoảng thời gian để xem dữ liệu</div>
  if (data.not_supported) {
    return <div className="bg-white border rounded-xl p-6 text-center text-sm text-gray-400">Chưa hỗ trợ báo cáo này cho thị trường Malaysia</div>
  }

  const nm = data.no_marketer, nc = data.no_cost, ul = data.unlinked_cost

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border rounded-xl p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Đơn chưa có marketer</div>
          <div className="text-2xl font-bold text-red-600 mt-1">{fmtNum(nm.count)}</div>
          <div className="text-xs text-gray-400 mt-0.5">≈ {fmtNum(nm.total_amount)}đ doanh thu</div>
        </div>
        <div className="bg-white border rounded-xl p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">SP chưa có giá vốn</div>
          <div className="text-2xl font-bold text-amber-600 mt-1">{fmtNum(nc.count)}</div>
          <div className="text-xs text-gray-400 mt-0.5">SP trong đơn đã giao</div>
        </div>
        <div className="bg-white border rounded-xl p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">SP giá vốn chưa liên kết mã</div>
          <div className="text-2xl font-bold text-violet-600 mt-1">{fmtNum(ul.count)}</div>
          <div className="text-xs text-gray-400 mt-0.5">Lệch tên với danh mục SP</div>
        </div>
      </div>

      {/* 1. Đơn chưa có marketer */}
      <div className="bg-white border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b">
          <h3 className="font-semibold text-gray-800">① Đơn chưa có marketer ({fmtNum(nm.count)})</h3>
          <p className="text-xs text-gray-400 mt-0.5">Marketer rỗng / không quy được từ UTM → bị gom vào "KHÁC", lệch doanh số theo NV MKT.</p>
        </div>
        {nm.orders.length === 0 ? (
          <div className="p-6 text-center text-gray-400 text-sm">✓ Không có đơn lỗi</div>
        ) : (
          <div className="overflow-x-auto max-h-96">
            <table className="min-w-full text-left border-collapse text-sm">
              <thead className="sticky top-0">
                <tr className="bg-gray-50 border-b">
                  {["Mã đơn", "Khách", "Tỉnh", "Trạng thái", "Tiền", "Tạo lúc", "UTM camp", ""].map(h => (
                    <th key={h} className="px-3 py-2 text-xs font-semibold text-gray-600 uppercase whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-900">
                {nm.orders.map((o: any) => (
                  <tr key={o.system_id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-xs">{o.system_id}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{o.customer_name || "—"}</td>
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{o.province || "—"}</td>
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{o.status_name || o.status}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(o.amount)}</td>
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{o.created}</td>
                    <td className="px-3 py-2 text-gray-400 text-xs max-w-[160px] truncate" title={o.utm_campaign || ""}>{o.utm_campaign || "—"}</td>
                    <td className="px-3 py-2">
                      {o.order_link && (
                        <a href={o.order_link} target="_blank" rel="noreferrer" className="text-violet-600 hover:underline text-xs whitespace-nowrap">Mở đơn ↗</a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 2. SP chưa có giá vốn */}
      <div className="bg-white border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b">
          <h3 className="font-semibold text-gray-800">② SP chưa có giá vốn ({fmtNum(nc.count)})</h3>
          <p className="text-xs text-gray-400 mt-0.5">SP bán ra (đơn giao TC) nhưng không map được giá vốn → tính COGS = 0, LNG bị thổi cao.</p>
        </div>
        {nc.products.length === 0 ? (
          <div className="p-6 text-center text-gray-400 text-sm">✓ Tất cả SP đã có giá vốn</div>
        ) : (
          <div className="overflow-x-auto max-h-80">
            <table className="min-w-full text-left border-collapse text-sm">
              <thead className="sticky top-0">
                <tr className="bg-gray-50 border-b">
                  {["Mã SP (display_id)", "Tên SP", "SL đã bán", "Số đơn"].map(h => (
                    <th key={h} className="px-3 py-2 text-xs font-semibold text-gray-600 uppercase whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-900">
                {nc.products.map((p: any, i: number) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-xs">{p.display_id || "—"}</td>
                    <td className="px-3 py-2">{p.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(p.qty_sold)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">{fmtNum(p.order_count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 3. SP giá vốn chưa liên kết mã */}
      <div className="bg-white border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b">
          <h3 className="font-semibold text-gray-800">③ SP trong bảng giá vốn chưa liên kết mã ({fmtNum(ul.count)})</h3>
          <p className="text-xs text-gray-400 mt-0.5">Có giá TB trong bảng giá vốn nhưng tên không khớp danh mục SP → không nối được vào đơn. Sửa tên cho khớp hoặc chọn lại SP ở cột nhóm.</p>
        </div>
        {ul.products.length === 0 ? (
          <div className="p-6 text-center text-gray-400 text-sm">✓ Tất cả đã liên kết</div>
        ) : (
          <div className="overflow-x-auto max-h-80">
            <table className="min-w-full text-left border-collapse text-sm">
              <thead className="sticky top-0">
                <tr className="bg-gray-50 border-b">
                  {["Tên SP (trong bảng giá vốn)", "Giá TB/sp"].map(h => (
                    <th key={h} className="px-3 py-2 text-xs font-semibold text-gray-600 uppercase whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-900">
                {ul.products.map((p: any, i: number) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-2">{p.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-violet-600 font-medium">{fmtNum(p.gia_tb)}đ</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ---- URL state helpers ----
function getSearchParams() {
  return new URLSearchParams(typeof window !== "undefined" ? window.location.search : "")
}
function pushState(tab: string, range: DateRange, market: string) {
  const p = new URLSearchParams()
  p.set("tab", tab)
  p.set("from", range.from)
  p.set("to", range.to)
  p.set("market", market)
  history.replaceState(null, "", `?${p.toString()}`)
}

// ================= Tab "Tổng 2 thị trường" =================
// Gộp VN + MY về VND (MY quy đổi sẵn ở API /report/combined). Chiều tách dữ liệu
// đổi theo phạm vi đang chọn:
//   all → VN vs Malaysia            (2 mảng, xem bức tranh toàn DN)
//   vn  → Facebook / TikTok / Shopee (Facebook = phần còn lại sau khi trừ 2 sàn)
//   my  → TikTok Shop / Shopee
type Scope = "all" | "vn" | "my"

// Series của từng phạm vi: key trong payload + nhãn + màu. Thứ tự = thứ tự xếp chồng
// (phần tử đầu nằm dưới cùng của area/bar).
const SCOPE_SERIES: Record<Scope, { key: string; label: string; color: string }[]> = {
  all: [
    { key: "my", label: "Malaysia", color: "#d97706" },
    { key: "vn", label: "Việt Nam", color: "#2563eb" },
  ],
  vn: [
    { key: "vn_sp", label: "Shopee", color: "#ee4d2d" },
    { key: "vn_tt", label: "TikTok", color: "#111827" },
    { key: "vn_fb", label: "Facebook", color: "#1877f2" },
  ],
  my: [
    { key: "my_sp", label: "Shopee", color: "#ee4d2d" },
    { key: "my_tt", label: "TikTok Shop", color: "#111827" },
  ],
}
const SCOPE_TOTAL_KEY: Record<Scope, string> = { all: "total", vn: "vn", my: "my" }
const SCOPE_HINT: Record<Scope, string> = {
  all: "Gộp 2 thị trường — Malaysia đã quy đổi sang VND.",
  vn: "Việt Nam — Facebook là phần còn lại sau khi trừ TikTok và Shopee.",
  my: "Malaysia — 2 sàn TikTok Shop và Shopee, đã quy đổi sang VND.",
}
const DOW_LABEL = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"]
const DOW_FULL = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"]

// Thang đo "số đẹp": chọn bước 1/2/2.5/4/5 × 10^n gần nhất để nhãn trục Y là số tròn
// (0 · 40 · 80 · 120tr) thay vì chia đều ra 87.3tr lẻ.
function niceScale(max: number, div = 4): { top: number; ticks: number[] } {
  const raw = max / div
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / mag
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 4 ? 4 : n <= 5 ? 5 : 10) * mag
  const top = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = 0; v <= top + step * 0.01; v += step) ticks.push(v)
  return { top, ticks }
}

// Thứ trong tuần từ "YYYY-MM-DD". Parse thủ công theo UTC — new Date(chuỗi trần)
// hiểu là UTC rồi getDay() lại đọc theo giờ máy, lệch 1 ngày ở múi +7.
function dowOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}
function isWeekend(date: string): boolean {
  const w = dowOf(date)
  return w === 0 || w === 6
}

function CombinedTab({ range }: { range: DateRange }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState<Scope>("all")
  const [showSetting, setShowSetting] = useState(false)
  const { has } = useCurrentPermissions()
  const canEditTarget = has("page.bao-cao.target-edit")

  function load() {
    setLoading(true)
    apiJson(`/admin/pancake-sync/report/combined?from=${toISO(range.from)}&to=${toISO(range.to, true)}`)
      .then(setData).catch(() => setData(null))
      .finally(() => setLoading(false))
  }
  useEffect(load, [range.from, range.to])

  if (loading) return <div className="text-center py-16 text-gray-400">Đang tải…</div>
  if (!data) return <div className="text-center py-16 text-gray-400">Không có dữ liệu</div>

  const days: any[] = data.days ?? []
  const totals = data.totals ?? {}
  const tTotals = data.target?.totals ?? {}
  const hasTarget = !!data.target?.has_target
  const series = SCOPE_SERIES[scope]
  const totalKey = SCOPE_TOTAL_KEY[scope]
  const scopeTotal = Number(totals[totalKey] ?? 0)
  const scopeTarget = Number(tTotals[totalKey] ?? 0)

  return (
    <div className="space-y-5">
      {/* Phạm vi: xem chung hoặc soi riêng từng thị trường */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm text-gray-500">Phạm vi:</span>
        <div className="max-w-full overflow-x-auto">
        <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden bg-white">
          {([
            { k: "all" as Scope, label: "Tổng 2 thị trường", dot: "" },
            { k: "vn" as Scope, label: "Việt Nam", dot: "#2563eb" },
            { k: "my" as Scope, label: "Malaysia", dot: "#d97706" },
          ]).map((s, i) => (
            <button key={s.k} onClick={() => setScope(s.k)}
              className={`px-3.5 py-1.5 text-sm inline-flex items-center gap-2 whitespace-nowrap ${i > 0 ? "border-l border-gray-200" : ""} ${
                scope === s.k ? "bg-violet-600 text-white font-semibold" : "bg-white text-gray-600 hover:bg-gray-50"
              }`}>
              {s.dot && <i className="w-2 h-2 rounded-full inline-block"
                style={{ background: scope === s.k ? "#fff" : s.dot }} />}
              {s.label}
            </button>
          ))}
        </div>
        </div>
        <span className="text-xs text-gray-400">{SCOPE_HINT[scope]}</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-gray-400">1 RM = {fmtNum(data.myr_to_vnd_rate)}đ</span>
          {canEditTarget && (
            <button onClick={() => setShowSetting(true)}
              className="text-sm px-3 py-1.5 border border-gray-200 rounded-lg bg-white text-gray-700 hover:bg-gray-50">
              🎯 Cài kế hoạch
            </button>
          )}
        </div>
      </div>

      {/* KPI 3 thị trường — mờ đi cái không thuộc phạm vi đang chọn */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <CombinedKpi label="Việt Nam" value={totals.vn} target={tTotals.vn} hasTarget={hasTarget}
          sub={`${fmtNum(totals.orders_vn)} đơn`} color="#2563eb"
          dim={scope === "my"} days={days} seriesKey="vn" />
        <CombinedKpi label="Malaysia" value={totals.my} target={tTotals.my} hasTarget={hasTarget}
          sub={`${fmtNum(totals.orders_my)} đơn · quy đổi VND`} color="#d97706"
          dim={scope === "vn"} days={days} seriesKey="my" />
        <CombinedKpi label="Tổng 2 thị trường" value={totals.total} target={tTotals.total} hasTarget={hasTarget}
          sub={`${fmtNum(totals.orders)} đơn · VN ${pctOf(totals.vn, totals.total)}% · MY ${pctOf(totals.my, totals.total)}%`}
          color="#7c3aed" dim={false} days={days} seriesKey="total" />
      </div>

      {/* Xu hướng theo ngày (area xếp chồng) */}
      <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b flex items-center justify-between gap-3 flex-wrap">
          <h3 className="font-semibold text-gray-700 text-sm">Xu hướng doanh số theo ngày</h3>
          <SeriesLegend series={series} />
        </div>
        <div className="p-4">
          <StackedAreaChart days={days} series={series} totalKey={totalKey} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Nhịp theo thứ trong tuần */}
        <div className="lg:col-span-2 bg-white border rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b flex items-center justify-between gap-3 flex-wrap">
            <h3 className="font-semibold text-gray-700 text-sm">Doanh số trung bình theo thứ</h3>
            <span className="text-xs text-gray-400">tìm ngày mạnh / ngày yếu</span>
          </div>
          <div className="p-4">
            <DowChart days={days} series={series} />
          </div>
        </div>

        {/* Cơ cấu */}
        <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b">
            <h3 className="font-semibold text-gray-700 text-sm">Cơ cấu doanh số</h3>
          </div>
          <div className="p-4">
            <DonutChart series={series} totals={totals} total={scopeTotal} />
          </div>
        </div>
      </div>

      {/* Bảng chi tiết theo ngày */}
      <CombinedDayTable days={days} series={series} totalKey={totalKey}
        targetDays={data.target?.days ?? []} hasTarget={hasTarget}
        totals={totals} targetTotals={tTotals} scopeTotal={scopeTotal} scopeTarget={scopeTarget} />

      {showSetting && (
        <TargetSettingModal month={range.to.slice(0, 7)}
          onClose={() => setShowSetting(false)}
          onSaved={() => { setShowSetting(false); load() }} />
      )}
    </div>
  )
}

function pctOf(part: any, whole: any): number {
  const w = Number(whole || 0)
  if (w <= 0) return 0
  return Math.round(Number(part || 0) / w * 100)
}

function SeriesLegend({ series }: { series: { label: string; color: string }[] }) {
  // Đảo thứ tự để chú thích đọc từ trên xuống khớp thứ tự xếp chồng nhìn thấy.
  return (
    <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
      {[...series].reverse().map(s => (
        <span key={s.label} className="inline-flex items-center gap-1.5">
          <i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: s.color }} />{s.label}
        </span>
      ))}
    </div>
  )
}

function CombinedKpi({ label, value, target, hasTarget, sub, color, dim, days, seriesKey }: {
  label: string; value: any; target: any; hasTarget: boolean; sub: string
  color: string; dim: boolean; days: any[]; seriesKey: string
}) {
  const v = Number(value || 0)
  const t = Number(target || 0)
  const pct = t > 0 ? Math.round(v / t * 100) : null
  const pctColor = pct == null ? "#6b7280" : pct >= 100 ? "#16a34a" : pct >= 80 ? "#d97706" : "#dc2626"
  return (
    <div className={`bg-white border rounded-xl p-5 shadow-sm transition-opacity ${dim ? "opacity-40" : ""}`}
      style={{ borderTop: `3px solid ${color}` }}>
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold mt-1 text-gray-900">{fmtVND(v)}</div>
      <div className="text-xs text-gray-400 mt-0.5">{sub}</div>
      {hasTarget && (
        <div className="mt-2 pt-2 border-t border-dashed border-gray-200 flex items-center justify-between text-xs">
          <span className="text-gray-400">KH {t > 0 ? fmtVND(t) : "—"}</span>
          {pct != null
            ? <span className="font-semibold" style={{ color: pctColor }}>{pct}% hoàn thành</span>
            : <span className="text-gray-300">—</span>}
        </div>
      )}
      <div className="mt-2"><Sparkline days={days} k={seriesKey} color={color} /></div>
    </div>
  )
}

function Sparkline({ days, k, color }: { days: any[]; k: string; color: string }) {
  if (!days.length) return null
  const W = 200, H = 34
  const vals = days.map(d => Number(d[k] ?? 0))
  const max = Math.max(...vals, 1)
  const step = days.length > 1 ? W / (days.length - 1) : 0
  const yOf = (v: number) => H - 3 - (v / max) * (H - 9)
  const pts = vals.map((v, i) => `${(i * step).toFixed(1)},${yOf(v).toFixed(1)}`)
  const lastX = (vals.length - 1) * step
  const id = `spark-${k}`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`M0,${H} L${pts.join(" L")} L${lastX.toFixed(1)},${H} Z`} fill={`url(#${id})`} />
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.8}
        strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

// Vùng xếp chồng "sắc nét" (thiết kế 2a): đỉnh nhọn đúng giá trị ngày thay vì bo mượt,
// mỗi lớp có viền màu 1.5px và đường phân cách trắng giữa hai lớp, nên ranh giới đọc rõ
// ngay cả khi lớp dưới mỏng. Vẽ quét trái → phải một lần khi mở tab.
function StackedAreaChart({ days, series, totalKey }: { days: any[]; series: any[]; totalKey: string }) {
  const [hover, setHover] = useState<number | null>(null)
  // Đổi key để ép React thay <g>, animation CSS chạy lại từ đầu khi bấm "Chạy lại".
  const [runId, setRunId] = useState(0)
  if (!days.length) return <div className="text-center text-gray-400 text-sm py-10">Chưa có dữ liệu</div>

  const W = 1190, H = 300, ML = 58, MR = 12, MT = 22, MB = 42
  const pw = W - ML - MR, ph = H - MT - MB
  const N = days.length
  const pitch = pw / N
  const maxDay = Math.max(...days.map(d => Number(d[totalKey] ?? 0)), 1)
  const sc = niceScale(maxDay, 4)
  const y = (v: number) => MT + ph - (v / sc.top) * ph
  // xA trải điểm từ mép trái tới mép phải (biểu đồ vùng), xBar là tâm ô ngày (nhãn/hover).
  const xA = (i: number) => ML + (N > 1 ? (pw / (N - 1)) * i : pw / 2)
  const xBar = (i: number) => ML + pitch * i + pitch / 2
  const poly = (pts: [number, number][]) =>
    pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ")

  // Biên tích luỹ của từng lớp — dùng chung cho vùng, viền và chấm hover.
  const cum = days.map(d => {
    let acc = 0
    return series.map(s => (acc += Number(d[s.key] ?? 0)))
  })

  // Vẽ từ lớp trên cùng xuống: lớp sau đè lên lớp trước nên không cần tính hiệu.
  const areas: any[] = [], lines: any[] = [], seps: any[] = []
  for (let j = series.length - 1; j >= 0; j--) {
    const pts = days.map((_, i) => [xA(i), y(cum[i][j])] as [number, number])
    const p = poly(pts)
    areas.push({ key: series[j].key, d: `${p} L${xA(N - 1).toFixed(1)} ${y(0)} L${ML} ${y(0)} Z`, fill: series[j].color })
    if (j > 0) seps.push({ key: series[j].key, d: poly(days.map((_, i) => [xA(i), y(cum[i][j - 1])] as [number, number])) })
    lines.push({ key: series[j].key, d: p, stroke: series[j].color })
  }

  const peakI = days.reduce((b, d, i, arr) => (Number(d[totalKey] ?? 0) > Number(arr[b][totalKey] ?? 0) ? i : b), 0)
  const hv = hover != null ? days[hover] : null

  return (
    <div className="relative" style={{ width: "100%" }}>
      <style>{`
        @keyframes pvWipeIn { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        @keyframes pvAnnIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @media (prefers-reduced-motion: reduce) {
          .pv-reveal, .pv-ann { animation: none !important; }
        }
      `}</style>

      <div className="flex justify-end mb-1">
        <button onClick={() => setRunId(r => r + 1)}
          className="text-xs px-2.5 py-1 rounded-md text-violet-600 bg-violet-50 border border-violet-200 hover:bg-violet-100">
          Chạy lại hiệu ứng
        </button>
      </div>

      <div style={{ position: "relative", width: "100%", aspectRatio: `${W} / ${H}` }}
        onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" shapeRendering="geometricPrecision"
          style={{ display: "block", position: "absolute", inset: 0 }}
          role="img" aria-label="Biểu đồ vùng xếp chồng doanh số theo ngày">
          <defs>
            <clipPath id={`pvReveal-${runId}`}>
              <rect x={ML - 2} y={0} width={pw + 4} height={H}
                style={{ transformBox: "fill-box", transformOrigin: "left center",
                  animation: "pvWipeIn 900ms cubic-bezier(0.22,0.7,0.2,1) both" }} />
            </clipPath>
          </defs>

          {/* Nền: ô cuối tuần ngả vàng, ô đang hover xanh nhạt */}
          {days.map((d, i) => {
            const isHover = i === hover
            if (!isHover && !isWeekend(d.date)) return null
            return <rect key={d.date} x={ML + pitch * i} y={MT} width={pitch} height={ph}
              fill={isHover ? "#eef2ff" : "#faf8f4"} />
          })}

          {sc.ticks.map((v: number) => (
            <line key={v} x1={ML} y1={y(v)} x2={W - MR} y2={y(v)}
              stroke={v === 0 ? "#d1d5db" : "#f1f2f4"} strokeWidth={1} shapeRendering="crispEdges" />
          ))}

          <g key={runId} className="pv-reveal" clipPath={`url(#pvReveal-${runId})`}>
            {areas.map(a => <path key={a.key} d={a.d} fill={a.fill} />)}
            {seps.map(s => <path key={s.key} d={s.d} fill="none" stroke="#ffffff" strokeWidth={2.6} strokeLinejoin="round" />)}
            {lines.map(l => <path key={l.key} d={l.d} fill="none" stroke={l.stroke} strokeWidth={1.5} strokeLinejoin="round" />)}
          </g>

          {hover != null && (
            <g pointerEvents="none">
              <line x1={xA(hover)} y1={MT} x2={xA(hover)} y2={MT + ph} stroke="#4b5563" strokeWidth={1} shapeRendering="crispEdges" />
              {series.map((s, j) => (
                <circle key={s.key} cx={xA(hover)} cy={y(cum[hover][j])} r={3.6} fill="#ffffff" stroke={s.color} strokeWidth={2.2} />
              ))}
            </g>
          )}

          {/* Vùng bắt chuột phủ kín từng ô ngày */}
          {days.map((d, i) => (
            <rect key={d.date} x={ML + pitch * i} y={MT} width={pitch} height={ph}
              fill="transparent" onMouseEnter={() => setHover(i)} />
          ))}
        </svg>

        {/* Trục Y + nhãn ngày đặt bằng HTML để chữ luôn sắc nét, không co giãn theo SVG */}
        <div style={{ position: "absolute", left: 0, top: 0, width: `${48 / W * 100}%`,
          textAlign: "right", fontSize: "0.62rem", color: "#c4c9d2" }}>triệu ₫</div>
        {sc.ticks.map((v: number) => (
          <div key={v} style={{ position: "absolute", left: 0, top: `${(y(v) - 7) / H * 100}%`,
            width: `${48 / W * 100}%`, textAlign: "right", fontSize: "0.66rem", lineHeight: "14px", color: "#9ca3af" }}>
            {(v / 1e6).toFixed(1)}
          </div>
        ))}
        {days.map((d, i) => (
          <div key={d.date} style={{ position: "absolute", left: `${(xBar(i) - 18) / W * 100}%`,
            top: `${(MT + ph + 8) / H * 100}%`, width: `${36 / W * 100}%`, textAlign: "center" }}>
            <div style={{ fontSize: "0.6rem", lineHeight: "12px",
              color: isWeekend(d.date) ? "#9ca3af" : "#4b5563", fontWeight: isWeekend(d.date) ? 500 : 550 }}>
              {d.date.slice(8)}
            </div>
            <div style={{ fontSize: "0.54rem", lineHeight: "12px", color: isWeekend(d.date) ? "#c0c5cd" : "#9ca3af" }}>
              {DOW_LABEL[dowOf(d.date)]}
            </div>
          </div>
        ))}

        {/* Badge đỉnh — hiện sau khi nét vẽ quét xong */}
        <div key={`ann-${runId}`} className="pv-ann" style={{ position: "absolute", inset: 0, pointerEvents: "none",
          animation: "pvAnnIn 420ms ease 720ms both" }}>
          <div style={{ position: "absolute", left: `${Math.min(xA(peakI) - 60, W - 150) / W * 100}%`,
            top: `${(y(Number(days[peakI][totalKey] ?? 0)) - 27) / H * 100}%`,
            fontSize: "0.66rem", fontWeight: 650, color: "#111827", background: "#ffffff",
            border: "1px solid #d1d5db", borderRadius: 6, padding: "2px 7px", lineHeight: "15px", whiteSpace: "nowrap" }}>
            Đỉnh {days[peakI].date.slice(8)}/{days[peakI].date.slice(5, 7)} · {fmtVND(days[peakI][totalKey])}
          </div>
        </div>

        {/* Tooltip nền tối */}
        {hv && (
          <div style={{ position: "absolute",
            left: `${(xBar(hover!) + (hover! > N / 2 ? -16 - 210 : 16)) / W * 100}%`,
            top: `${Math.max(MT, Math.min(y(Number(hv[totalKey] ?? 0)) - 12, MT + ph - (62 + series.length * 21))) / H * 100}%`,
            width: `${210 / W * 100}%`, minWidth: 168, boxSizing: "border-box", padding: "10px 12px", borderRadius: 8,
            background: "rgba(17,24,39,0.96)", boxShadow: "0 6px 20px rgba(16,24,40,0.18)", pointerEvents: "none", zIndex: 10 }}>
            <div style={{ fontSize: "0.72rem", fontWeight: 600, color: "#f9fafb", marginBottom: 8 }}>
              {DOW_FULL[dowOf(hv.date)]}, {hv.date.slice(8)}/{hv.date.slice(5, 7)}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {[...series].reverse().map(s => (
                <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.7rem" }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: "inline-block", flex: "none" }} />
                  <span style={{ color: "#d1d5db", flex: 1 }}>{s.label}</span>
                  <span style={{ color: "#ffffff", fontWeight: 550 }}>{fmtVND(hv[s.key])}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
              marginTop: 8, paddingTop: 8, borderTop: "1px solid #374151" }}>
              <span style={{ fontSize: "0.7rem", color: "#9ca3af" }}>Tổng ngày</span>
              <span style={{ fontSize: "0.76rem", color: "#ffffff", fontWeight: 650 }}>{fmtVND(hv[totalKey])}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
// Cột xếp chồng theo thứ trong tuần (T2…CN), lấy trung bình mỗi thứ.
function DowChart({ days, series }: { days: any[]; series: any[] }) {
  const ORDER = [1, 2, 3, 4, 5, 6, 0] // T2 → CN
  const buckets = ORDER.map(dow => {
    const rows = days.filter(d => dowOf(d.date) === dow)
    const avg: Record<string, number> = {}
    for (const s of series) {
      avg[s.key] = rows.length ? rows.reduce((a, r) => a + Number(r[s.key] ?? 0), 0) / rows.length : 0
    }
    const total = series.reduce((a, s) => a + avg[s.key], 0)
    return { dow, avg, total, n: rows.length }
  })
  const max = Math.max(...buckets.map(b => b.total), 1)
  const best = buckets.reduce((a, b) => (b.total > a.total ? b : a), buckets[0])
  const W = 620, H = 200, BASE = 150, BW = 52, GAP = 30, PLOT_H = 130

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Doanh số trung bình theo thứ trong tuần">
      {[0, 0.25, 0.5, 0.75, 1].map((f, i) => (
        <g key={f}>
          <line x1={40} y1={BASE - f * PLOT_H} x2={W - 6} y2={BASE - f * PLOT_H}
            stroke={i === 0 ? "#d4d4d8" : "#f1f1f3"} strokeWidth={1} />
          {(i === 0 || i === 2 || i === 4) && (
            <text x={36} y={BASE - f * PLOT_H + 3.5} fontSize={10} fill="#9ca3af" textAnchor="end">
              {i === 0 ? "0" : fmtVND(max * f)}
            </text>
          )}
        </g>
      ))}
      {buckets.map((b, i) => {
        const x = 48 + i * (BW + GAP)
        const isBest = b.dow === best.dow && b.total > 0
        let y = BASE
        // Vẽ từ dưới lên; chỉ đoạn trên cùng bo góc để cả cột trông liền một khối.
        const segs = series.map(s => {
          const h = (b.avg[s.key] / max) * PLOT_H
          y -= h
          return { key: s.key, color: s.color, y, h: Math.max(h, 0) }
        })
        const topY = y
        return (
          <g key={b.dow}>
            <title>{`${DOW_LABEL[b.dow]} · TB ${fmtVND(b.total)} · ${b.n} ngày`}</title>
            {segs.map((sg, si) => (
              <rect key={sg.key} x={x} y={sg.y} width={BW} height={sg.h} fill={sg.color}
                rx={si === segs.length - 1 ? 4 : 0}
                opacity={isBest ? 1 : 0.82} />
            ))}
            {/* Ngày mạnh nhất trong tuần: ghi số ngay trên đầu cột */}
            {isBest && (
              <text x={x + BW / 2} y={topY - 6} fontSize={10} textAnchor="middle"
                fill="#111827" fontWeight={700}>{fmtVND(b.total)}</text>
            )}
            <text x={x + BW / 2} y={BASE + 18} fontSize={11} textAnchor="middle"
              fill={isBest ? "#111827" : b.dow === 0 ? "#d97706" : "#9ca3af"}
              fontWeight={isBest || b.dow === 0 ? 700 : 400}>
              {DOW_LABEL[b.dow]}
            </text>
            {!isBest && (
              <text x={x + BW / 2} y={BASE + 32} fontSize={9} textAnchor="middle" fill="#c7c7cc">
                {fmtVND(b.total)}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

// Donut tỉ trọng — dùng stroke-dasharray trên circle, không cần path arc.
function DonutChart({ series, totals, total }: { series: any[]; totals: any; total: number }) {
  const R = 58, C = 2 * Math.PI * R
  let offset = 0
  const arcs = [...series].reverse().map(s => {
    const v = Number(totals[s.key] ?? 0)
    const frac = total > 0 ? v / total : 0
    const arc = { ...s, v, frac, len: frac * C, rot: -90 + (offset / C) * 360 }
    offset += frac * C
    return arc
  })
  // Khe hở nhỏ giữa các mảng để ranh giới rõ mà không cần viền trắng dày.
  const GAP = arcs.length > 1 ? 2 : 0
  return (
    <div className="flex flex-col items-center gap-3">
      <svg viewBox="0 0 160 160" width={160} height={160} role="img" aria-label="Tỉ trọng doanh số">
        <circle cx={80} cy={80} r={R} fill="none" stroke="#f1f1f3" strokeWidth={24} />
        {arcs.map(a => (
          <circle key={a.key} cx={80} cy={80} r={R} fill="none" stroke={a.color} strokeWidth={24}
            strokeLinecap="butt"
            strokeDasharray={`${Math.max(a.len - GAP, 0).toFixed(2)} ${(C - Math.max(a.len - GAP, 0)).toFixed(2)}`}
            transform={`rotate(${a.rot.toFixed(2)} 80 80)`}>
            <title>{`${a.label}: ${fmtVND(a.v)} · ${Math.round(a.frac * 100)}%`}</title>
          </circle>
        ))}
        <text x={80} y={77} textAnchor="middle" fontSize={17} fontWeight={700} fill="#111827">{fmtVND(total)}</text>
        <text x={80} y={94} textAnchor="middle" fontSize={9.5} fill="#9ca3af">tổng kỳ</text>
      </svg>
      <div className="flex flex-col gap-1.5 w-full">
        {arcs.map(a => (
          <div key={a.key} className="flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 text-gray-600">
              <i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: a.color }} />{a.label}
            </span>
            <span className="text-gray-500">{fmtVND(a.v)} · {Math.round(a.frac * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function CombinedDayTable({ days, series, totalKey, targetDays, hasTarget, totals, targetTotals, scopeTotal, scopeTarget }: {
  days: any[]; series: any[]; totalKey: string; targetDays: any[]; hasTarget: boolean
  totals: any; targetTotals: any; scopeTotal: number; scopeTarget: number
}) {
  // Lọc theo nền tảng: null = tất cả (dùng totalKey gộp), ngược lại dùng chính key của nền tảng.
  // days/targetDays đều có sẵn field theo từng key nên chỉ cần đổi key là mọi phép tính chạy theo.
  const [platform, setPlatform] = useState<string | null>(null)
  const activeKey = platform ?? totalKey
  const activeSeries = platform ? series.filter(s => s.key === platform) : series
  const activeLabel = platform ? series.find(s => s.key === platform)?.label ?? "" : "Tất cả"

  const targetByDate = new Map<string, any>(targetDays.map((d: any) => [d.date, d]))
  const maxTotal = Math.max(...days.map(d => Number(d[activeKey] ?? 0)), 1)
  const best = days.reduce((a, d) => (Number(d[activeKey] ?? 0) > Number(a?.[activeKey] ?? -1) ? d : a), null as any)
  const worst = days.reduce((a, d) => (Number(d[activeKey] ?? 0) < Number(a?.[activeKey] ?? Infinity) ? d : a), null as any)
  const pctDone = (v: number, t: number) => (t > 0 ? Math.round(v / t * 100) : null)
  const doneColor = (p: number | null) => p == null ? "#9ca3af" : p >= 100 ? "#16a34a" : p >= 80 ? "#d97706" : "#dc2626"

  const viewTotal = Number(totals[activeKey] ?? 0)
  const viewTarget = Number(targetTotals[activeKey] ?? 0)

  // Lũy kế chênh lệch: cum(n) = (thực hiện n − kế hoạch n) + cum(n−1).
  // Chỉ cộng đến hôm nay — ngày tương lai chưa có doanh số nên lũy kế của chúng vô nghĩa.
  const today = todayVN()
  const cumByDate = new Map<string, number>()
  const cumTargetByDate = new Map<string, number>()
  let running = 0
  let runningTarget = 0
  for (const d of days) {
    if (d.date > today) break
    running += Number(d[activeKey] ?? 0) - Number(targetByDate.get(d.date)?.[activeKey] ?? 0)
    runningTarget += Number(targetByDate.get(d.date)?.[activeKey] ?? 0)
    cumByDate.set(d.date, running)
    cumTargetByDate.set(d.date, runningTarget)
  }
  const cumToDate = running
  const cumTargetToDate = runningTarget

  // Tô màu lũy kế theo % hoàn thành lũy kế (cùng ngưỡng với cột % HT), không chỉ theo dấu âm/dương.
  const cumColor = (cum: number | null, target: number) =>
    cum == null ? "#9ca3af" : doneColor(pctDone(cum + target, target))

  // Tiến độ từng nền tảng tính đến hôm nay — dùng cho nhãn cảnh báo trên nút lọc.
  const platformPct = new Map<string, number | null>()
  for (const s of series) {
    let done = 0, plan = 0
    for (const d of days) {
      if (d.date > today) break
      done += Number(d[s.key] ?? 0)
      plan += Number(targetByDate.get(d.date)?.[s.key] ?? 0)
    }
    platformPct.set(s.key, pctDone(done, plan))
  }

  return (
    <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <h3 className="font-semibold text-gray-700 text-sm">Chi tiết theo ngày</h3>
          <div className="flex gap-1 text-xs">
            {[{ key: null as string | null, label: "Tất cả" }, ...series.map(s => ({ key: s.key as string | null, label: s.label }))].map(opt => {
              const on = platform === opt.key
              const pct = opt.key ? platformPct.get(opt.key) ?? null : null
              return (
                <button key={opt.key ?? "__all"} type="button" onClick={() => setPlatform(opt.key)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 border transition-colors ${
                    on ? "bg-violet-600 border-violet-600 text-white font-semibold" : "border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                  title={opt.key && pct != null ? `Đạt ${pct}% kế hoạch lũy kế đến hôm nay` : undefined}>
                  {opt.label}
                  {opt.key && pct != null && (
                    <i className="w-1.5 h-1.5 rounded-full inline-block"
                      style={{ background: on ? "#ffffff" : doneColor(pct) }} />
                  )}
                </button>
              )
            })}
          </div>
        </div>
        <div className="flex gap-2 text-xs text-gray-500">
          {best && <span className="border rounded-full px-2.5 py-0.5">Cao nhất: {best.date.slice(8)}/{best.date.slice(5, 7)} · {fmtVND(best[activeKey])}</span>}
          {worst && <span className="border rounded-full px-2.5 py-0.5">Thấp nhất: {worst.date.slice(8)}/{worst.date.slice(5, 7)} · {fmtVND(worst[activeKey])}</span>}
        </div>
      </div>
      <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
        <table className="w-full text-sm" style={{ fontVariantNumeric: "tabular-nums" }}>
          <thead className="sticky top-0 bg-white z-10">
            <tr className="text-xs uppercase tracking-wide text-gray-500 border-b">
              <th className="text-left px-3 py-2 font-semibold">Ngày</th>
              {[...activeSeries].reverse().map(s => (
                <th key={s.key} className="text-right px-3 py-2 font-semibold" style={{ color: s.color }}>{s.label}</th>
              ))}
              {!platform && <th className="text-right px-3 py-2 font-semibold">Tổng ngày</th>}
              {hasTarget && <th className="text-right px-3 py-2 font-semibold">Kế hoạch</th>}
              {hasTarget && <th className="text-right px-3 py-2 font-semibold">% HT</th>}
              {hasTarget && (
                <th className="text-right px-3 py-2 font-semibold" title="Lũy kế chênh lệch thực hiện so với kế hoạch, cộng dồn từ đầu kỳ đến ngày đó">
                  Lũy kế
                </th>
              )}
              <th className="text-right px-3 py-2 font-semibold w-48">Cơ cấu</th>
            </tr>
          </thead>
          <tbody className="text-gray-900">
            {days.map(d => {
              const dayTotal = Number(d[activeKey] ?? 0)
              const t = Number(targetByDate.get(d.date)?.[activeKey] ?? 0)
              const p = pctDone(dayTotal, t)
              const cum = cumByDate.has(d.date) ? cumByDate.get(d.date)! : null
              const barPct = Math.round(dayTotal / maxTotal * 100)
              return (
                <tr key={d.date} className={`border-b border-gray-50 hover:bg-violet-50/40 ${isWeekend(d.date) ? "bg-amber-50/40" : ""}`}>
                  <td className={`px-3 py-1.5 text-xs ${isWeekend(d.date) ? "text-amber-600 font-semibold" : "text-gray-500"}`}>
                    {d.date.slice(8)}/{d.date.slice(5, 7)} · {DOW_LABEL[dowOf(d.date)]}
                  </td>
                  {[...activeSeries].reverse().map(s => (
                    <td key={s.key} className={`text-right px-3 py-1.5${platform ? " font-semibold" : ""}`}>{fmtVND(d[s.key])}</td>
                  ))}
                  {!platform && <td className="text-right px-3 py-1.5 font-semibold">{fmtVND(dayTotal)}</td>}
                  {hasTarget && <td className="text-right px-3 py-1.5 text-gray-400">{t > 0 ? fmtVND(t) : "—"}</td>}
                  {hasTarget && (
                    <td className="text-right px-3 py-1.5 font-semibold" style={{ color: doneColor(p) }}>
                      {p != null ? `${p}%` : "—"}
                    </td>
                  )}
                  {hasTarget && (
                    <td className="text-right px-3 py-1.5 font-semibold"
                      style={{ color: cumColor(cum, cumTargetByDate.get(d.date) ?? 0) }}
                      title={cum == null ? "Chưa tới ngày" : `Chênh lệch ngày: ${fmtVND(dayTotal - t)} · Đạt ${pctDone(cum + (cumTargetByDate.get(d.date) ?? 0), cumTargetByDate.get(d.date) ?? 0) ?? "—"}% kế hoạch lũy kế`}>
                      {cum == null ? "—" : `${cum >= 0 ? "+" : "−"}${fmtVND(Math.abs(cum))}`}
                    </td>
                  )}
                  <td className="px-3 py-1.5">
                    <div className="flex justify-end">
                      <span className="flex h-4 rounded overflow-hidden bg-gray-100"
                        style={{ width: `${barPct}%`, minWidth: dayTotal > 0 ? "2px" : undefined }}>
                        {activeSeries.map(s => {
                          const v = Number(d[s.key] ?? 0)
                          const w = dayTotal > 0 ? v / dayTotal * 100 : 0
                          return <i key={s.key} className="h-full block" style={{ width: `${w}%`, background: s.color }}
                            title={`${s.label}: ${fmtVND(v)}`} />
                        })}
                      </span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="sticky bottom-0 text-gray-900">
            <tr className="bg-violet-50 font-bold border-t-2 border-gray-200">
              <td className="px-3 py-2 text-xs">Tổng kỳ{platform ? ` · ${activeLabel}` : ""}</td>
              {[...activeSeries].reverse().map(s => (
                <td key={s.key} className="text-right px-3 py-2">{fmtVND(totals[s.key])}</td>
              ))}
              {!platform && <td className="text-right px-3 py-2">{fmtVND(scopeTotal)}</td>}
              {hasTarget && <td className="text-right px-3 py-2">{viewTarget > 0 ? fmtVND(viewTarget) : "—"}</td>}
              {hasTarget && (
                <td className="text-right px-3 py-2" style={{ color: doneColor(pctDone(viewTotal, viewTarget)) }}>
                  {pctDone(viewTotal, viewTarget) != null ? `${pctDone(viewTotal, viewTarget)}%` : "—"}
                </td>
              )}
              {hasTarget && (
                <td className="text-right px-3 py-2"
                  style={{ color: cumColor(cumToDate, cumTargetToDate) }}
                  title={`Lũy kế tính đến hôm nay — không tính kế hoạch của các ngày chưa tới. Đạt ${pctDone(cumToDate + cumTargetToDate, cumTargetToDate) ?? "—"}% kế hoạch lũy kế.`}>
                  {`${cumToDate >= 0 ? "+" : "−"}${fmtVND(Math.abs(cumToDate))}`}
                </td>
              )}
              <td className="px-3 py-2">
                <div className="flex justify-end">
                  <span className="flex h-4 rounded overflow-hidden bg-gray-100 w-full">
                    {activeSeries.map(s => {
                      const w = viewTotal > 0 ? Number(totals[s.key] ?? 0) / viewTotal * 100 : 0
                      return <i key={s.key} className="h-full block" style={{ width: `${w}%`, background: s.color }} />
                    })}
                  </span>
                </div>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {!hasTarget && (
        <div className="px-5 py-2.5 text-xs text-gray-400 border-t">
          Chưa đặt kế hoạch cho kỳ này — bấm <b>Cài kế hoạch</b> ở trên để nhập target theo ngày.
        </div>
      )}
    </div>
  )
}

// ---- Modal cài kế hoạch doanh số theo ngày × nền tảng ----
const TARGET_FIELDS: { key: string; market: "VN" | "MY"; label: string; color: string }[] = [
  { key: "vn_fb", market: "VN", label: "Facebook", color: "#1877f2" },
  { key: "vn_tt", market: "VN", label: "TikTok", color: "#111827" },
  { key: "vn_sp", market: "VN", label: "Shopee", color: "#ee4d2d" },
  { key: "my_tt", market: "MY", label: "TikTok Shop", color: "#111827" },
  { key: "my_sp", market: "MY", label: "Shopee", color: "#ee4d2d" },
]

function TargetSettingModal({ month, onClose, onSaved }: { month: string; onClose: () => void; onSaved: () => void }) {
  const [m, setM] = useState(month)
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [quick, setQuick] = useState<Record<string, string>>({ vn_fb: "", vn_tt: "", vn_sp: "", my_tt: "", my_sp: "" })
  const [skipWeekend, setSkipWeekend] = useState(false)

  useEffect(() => {
    setLoading(true); setDirty(false); setMsg(null)
    apiJson(`/admin/pancake-sync/report/targets?month=${m}`)
      .then(d => setRows(d.days ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [m])

  const parseMoney = (s: string) => Number(String(s).replace(/[^\d]/g, "")) || 0
  const colTotal = (k: string) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0)
  const vnTotal = colTotal("vn_fb") + colTotal("vn_tt") + colTotal("vn_sp")
  const myTotal = colTotal("my_tt") + colTotal("my_sp")

  function setCell(date: string, k: string, val: string) {
    setRows(rs => rs.map(r => (r.date === date ? { ...r, [k]: parseMoney(val) } : r)))
    setDirty(true)
  }

  function applyQuick() {
    const vals: Record<string, number> = {}
    for (const f of TARGET_FIELDS) vals[f.key] = parseMoney(quick[f.key] ?? "")
    let n = 0
    setRows(rs => rs.map(r => {
      if (skipWeekend && isWeekend(r.date)) return r
      n++
      return { ...r, ...vals }
    }))
    setDirty(true)
    setMsg(`Đã điền ${skipWeekend ? "ngày thường" : "toàn bộ ngày"} — chưa lưu.`)
  }

  async function save() {
    setSaving(true); setMsg(null)
    try {
      await apiJson("/admin/pancake-sync/report/targets", "PUT", { month: m, days: rows })
      setDirty(false)
      setMsg("Đã lưu kế hoạch.")
      onSaved()
    } catch (e: any) {
      setMsg(e?.message ?? "Lưu thất bại")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget && !dirty) onClose() }}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[92vh] flex flex-col">
        <div className="px-5 py-4 border-b flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-bold text-gray-800">Cài đặt kế hoạch doanh số</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Target theo ngày × nền tảng · Malaysia nhập bằng VND đã quy đổi
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input type="month" value={m} onChange={e => setM(e.target.value)}
              className="border rounded-lg px-2.5 py-1.5 text-sm bg-white text-gray-900" />
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none px-2">×</button>
          </div>
        </div>

        {/* Nhập nhanh */}
        <div className="px-5 py-4 border-b bg-gray-50/60 space-y-3">
          <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Nhập nhanh — điền đều cả tháng</div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {TARGET_FIELDS.map(f => (
              <div key={f.key}>
                <label className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                  <span className={`text-[10px] font-bold px-1.5 rounded ${f.market === "VN" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}`}>
                    {f.market}
                  </span>
                  <i className="w-2 h-2 rounded-sm inline-block" style={{ background: f.color }} />
                  {f.label}
                </label>
                <input type="text" inputMode="numeric" value={quick[f.key]}
                  onChange={e => setQuick(q => ({ ...q, [f.key]: e.target.value }))}
                  placeholder="0"
                  className="w-full border rounded-lg px-2 py-1.5 text-sm text-right bg-white text-gray-900" />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <label className="inline-flex items-center gap-2 text-xs text-gray-500">
              <input type="checkbox" checked={skipWeekend} onChange={e => setSkipWeekend(e.target.checked)} />
              Bỏ qua T7 &amp; CN (chỉ điền ngày thường)
            </label>
            <button onClick={applyQuick}
              className="px-4 py-1.5 bg-violet-600 text-white rounded-lg text-sm font-semibold hover:bg-violet-700">
              Áp dụng cho cả tháng
            </button>
          </div>
        </div>

        {/* Bảng nhập theo ngày */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="text-center py-16 text-gray-400">Đang tải…</div>
          ) : (
            <table className="w-full text-sm" style={{ fontVariantNumeric: "tabular-nums" }}>
              <thead className="sticky top-0 bg-white z-10 shadow-sm">
                <tr className="text-[11px] uppercase tracking-wide text-gray-500 border-b">
                  <th className="text-left px-3 py-2 font-semibold">Ngày</th>
                  <th className="text-center px-3 py-1 font-semibold text-blue-600" colSpan={3}>Việt Nam</th>
                  <th className="text-center px-3 py-1 font-semibold text-amber-600 border-l" colSpan={2}>Malaysia</th>
                  <th className="text-right px-3 py-2 font-semibold border-l">Tổng ngày</th>
                </tr>
                <tr className="text-[11px] text-gray-400 border-b">
                  <th />
                  <th className="text-right px-3 pb-1.5 font-medium">Facebook</th>
                  <th className="text-right px-3 pb-1.5 font-medium">TikTok</th>
                  <th className="text-right px-3 pb-1.5 font-medium">Shopee</th>
                  <th className="text-right px-3 pb-1.5 font-medium border-l">TikTok Shop</th>
                  <th className="text-right px-3 pb-1.5 font-medium">Shopee</th>
                  <th className="border-l" />
                </tr>
              </thead>
              <tbody className="text-gray-900">
                {rows.map(r => {
                  const rowTotal = TARGET_FIELDS.reduce((a, f) => a + Number(r[f.key] ?? 0), 0)
                  return (
                    <tr key={r.date} className={`border-b border-gray-50 ${isWeekend(r.date) ? "bg-amber-50/40" : ""}`}>
                      <td className={`px-3 py-1 text-xs whitespace-nowrap ${isWeekend(r.date) ? "text-amber-600 font-semibold" : "text-gray-500"}`}>
                        {r.date.slice(8)}/{r.date.slice(5, 7)} · {DOW_LABEL[dowOf(r.date)]}
                      </td>
                      {TARGET_FIELDS.map(f => (
                        <td key={f.key} className={`px-2 py-1 ${f.key === "my_tt" ? "border-l" : ""}`}>
                          <input type="text" inputMode="numeric"
                            value={Number(r[f.key] ?? 0) ? fmtNum(r[f.key]) : ""}
                            placeholder="0"
                            onChange={e => setCell(r.date, f.key, e.target.value)}
                            className="w-full border rounded px-1.5 py-1 text-xs text-right bg-white text-gray-900" />
                        </td>
                      ))}
                      <td className="text-right px-3 py-1 text-xs font-semibold border-l text-gray-900">{fmtVND(rowTotal)}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="sticky bottom-0 text-gray-900">
                <tr className="bg-violet-50 font-bold border-t-2 text-xs">
                  <td className="px-3 py-2">Tổng tháng</td>
                  {TARGET_FIELDS.map(f => (
                    <td key={f.key} className={`text-right px-3 py-2 ${f.key === "my_tt" ? "border-l" : ""}`}>
                      {fmtVND(colTotal(f.key))}
                    </td>
                  ))}
                  <td className="text-right px-3 py-2 border-l">{fmtVND(vnTotal + myTotal)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {/* Thanh lưu */}
        <div className="px-5 py-3 border-t flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs">
            <span className="text-gray-400">
              VN {fmtVND(vnTotal)} · MY {fmtVND(myTotal)} · Tổng <b className="text-gray-700">{fmtVND(vnTotal + myTotal)}</b>
            </span>
            {msg && <span className="ml-3 text-violet-600">{msg}</span>}
            {dirty && !msg && <span className="ml-3 text-amber-600">Có thay đổi chưa lưu.</span>}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-1.5 border rounded-lg text-sm text-gray-700 hover:bg-gray-50">Đóng</button>
            <button onClick={save} disabled={saving || !dirty}
              className="px-4 py-1.5 bg-violet-600 text-white rounded-lg text-sm font-semibold hover:bg-violet-700 disabled:opacity-50">
              {saving ? "Đang lưu…" : "Lưu kế hoạch"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Tab "Sàn TMĐT" — LNG đơn TikTok Shop / Shopee.
 * Các báo cáo LNG khác chỉ lấy đơn ads (source manual/facebook/...) nên toàn bộ đơn sàn
 * không xuất hiện ở đâu. Doanh thu ở đây là tiền THỰC NHẬN (sàn đã trừ phí + khuyến mãi).
 */
// Cột bảng "LNG theo ngày" — id trùng với sort key để header dùng chung một chỗ.
type DayColId = "date" | "platform" | "orders" | "huyHoan" | "gross" | "fee" | "feePct" | "rev" | "cogs" | "cogsPct" | "fullfill" | "ads_cost" | "adsMetric" | "lng" | "pct"
const SANTMDT_DAY_COLS: ColumnDef<DayColId>[] = [
  { id: "date",      label: "Ngày",             default: 130, min: 90 },
  { id: "platform",  label: "Sàn",              default: 110, min: 80 },
  { id: "orders",    label: "Đơn",              default: 70,  min: 55 },
  { id: "huyHoan",   label: "Huỷ/Hoàn",         default: 110, min: 80 },
  { id: "gross",     label: "DT trước phí sàn", default: 140, min: 90 },
  { id: "fee",       label: "Phí sàn",          default: 120, min: 80 },
  { id: "feePct",    label: "%Phí",             default: 80,  min: 60 },
  { id: "rev",       label: "DT thực nhận",     default: 130, min: 90 },
  { id: "cogs",      label: "Giá vốn",          default: 120, min: 80 },
  { id: "cogsPct",   label: "%GV",              default: 75,  min: 55 },
  { id: "fullfill",  label: "Fullfill",         default: 110, min: 80 },
  { id: "ads_cost",  label: "Ads",              default: 120, min: 80 },
  { id: "adsMetric", label: "%Ads",             default: 85,  min: 60 },
  { id: "lng",       label: "LNG sau ads",      default: 140, min: 90 },
  { id: "pct",       label: "%LNG",             default: 85,  min: 60 },
]

/**
 * Drill-down 1 dòng của bảng "LNG theo ngày": danh sách ĐƠN của ngày đó kèm giá vốn,
 * DT trước phí sàn, DT thực nhận, LNG. Mở khi bấm vào dòng ngày.
 *
 * mode truyền theo đúng mode bảng đang xem (Thực / Tạm tính) để tổng ở đây khớp dòng
 * ngày — đổi mode ở bảng rồi mở lại sẽ ra bộ đơn khác.
 */
function DayOrdersModal({
  date, platform, market, mode, dayRow, onClose,
}: {
  date: string
  platform: "tiktok" | "shopee"
  market: Market
  mode: "tt" | "thuc"
  dayRow: any
  onClose: () => void
}) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  // Phản hồi "đã copy" cho ID vừa bấm — nhân sự copy liên tục nhiều đơn nên cần biết
  // cái nào vừa lấy. Tự tắt sau 1,2s.
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const copyId = (v: string) => {
    navigator.clipboard?.writeText(v).then(() => {
      setCopiedId(v)
      setTimeout(() => setCopiedId(c => (c === v ? null : c)), 1200)
    }).catch(() => { /* trình duyệt chặn clipboard — bỏ qua, user bôi đen tay được */ })
  }

  useEffect(() => {
    setLoading(true); setErr(null)
    apiFetch(`/admin/pancake-sync/report/marketplace-lng/day-orders`
      + `?date=${date}&platform=${platform}&market=${market}&mode=${mode}`)
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setData(d) })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }, [date, platform, market, mode])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const money = (n: any) => fmtVND(Number(n || 0))
  const pctCell = (v: any, good?: boolean) =>
    v == null ? <span className="text-gray-300">—</span>
      : <span className={good == null ? "text-gray-600" : good ? "text-green-600" : "text-red-600"}>{v}%</span>
  const timeVN = (iso: any) => {
    if (!iso) return ""
    const s = String(iso)
    const m = s.match(/T(\d{2}:\d{2})/)
    return m ? m[1] : ""
  }

  const orders: any[] = data?.orders ?? []
  const t = data?.totals ?? {}

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-6xl max-h-[92vh] flex flex-col">
        <div className="px-5 py-4 border-b flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-bold text-gray-800">
              Chi tiết đơn — {date.split("-").reverse().join("/")} ·{" "}
              {platform === "tiktok" ? "TikTok Shop" : "Shopee"} ·{" "}
              {mode === "tt" ? "Tạm tính" : "Thực"}
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {mode === "tt"
                ? "Gồm cả đơn đã xác nhận cho đi nhưng chưa giao xong."
                : "Chỉ đơn đã giao thành công."}
              {" "}Tiền ads chia <b>trung bình mỗi đơn</b> (sàn không có spend theo đơn).
              {" "}Bấm 1 đơn để xem từng sản phẩm.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none px-2">×</button>
        </div>

        {loading && <div className="p-10 text-center text-gray-400 text-sm animate-pulse">Đang tải...</div>}
        {err && <div className="p-6 text-center text-sm text-red-600">⚠ {err}</div>}

        {!loading && !err && data && (
          <>
            <div className="px-5 py-3 border-b bg-gray-50/60 grid grid-cols-2 md:grid-cols-5 gap-3 text-[12.5px]">
              <div>
                <div className="text-gray-400">Số đơn</div>
                <div className="font-semibold text-gray-900">{fmtNum(t.orders)}</div>
              </div>
              <div>
                <div className="text-gray-400">DT trước phí sàn</div>
                <div className="font-semibold text-gray-700">{money(t.revenue_gross)}</div>
              </div>
              <div>
                <div className="text-gray-400">DT thực nhận</div>
                <div className="font-semibold text-green-700">{money(t.revenue)}</div>
              </div>
              <div>
                <div className="text-gray-400">
                  Ads cả ngày{data.ads_missing && <span className="ml-1 text-amber-600">⚠ chưa điền</span>}
                </div>
                <div className="font-semibold text-gray-700">
                  {money(data.ads_cost_day)}
                  <span className="ml-1 font-normal text-[11px] text-gray-400">
                    ≈ {money(data.ads_per_order)}/đơn
                  </span>
                </div>
              </div>
              <div>
                <div className="text-gray-400">LNG sau ads</div>
                <div className={`font-semibold ${Number(t.lng_sau_ads) >= 0 ? "text-violet-700" : "text-red-500"}`}>
                  {money(t.lng_sau_ads)}
                </div>
              </div>
            </div>

            {/* Số ở đây gộp từ chính đơn của ngày, còn dòng bảng ngày gộp theo dòng hàng —
                lệch vài đồng do làm tròn phần chia doanh thu là bình thường. */}
            {dayRow && (
              <div className="px-5 py-2 border-b text-[11.5px] text-gray-400">
                Dòng ngày tương ứng: DT thực nhận {money(dayRow[mode === "tt" ? "revenue_tt" : "revenue_delivered"])}
                {" · "}LNG sau ads {money(dayRow[mode === "tt" ? "lng_tt_sau_ads" : "lng_sau_ads"])}
                {" — chênh vài đồng so với tổng bên trên là do làm tròn khi chia doanh thu cho từng sản phẩm."}
              </div>
            )}

            {/* SP đốt tiền ads mà ngày đó không bán được cái nào. Khoản này không đơn
                nào gánh nên tổng các dòng đơn thấp hơn dòng ngày đúng bằng nó — nói
                đích danh mã SP thay vì dồn sang đơn khác gánh hộ. */}
            {(data.ads_no_order ?? []).length > 0 && (
              <div className="px-5 py-2.5 border-b bg-amber-50 text-[12px] text-amber-800">
                <b>Chạy ads nhưng không ra đơn nào trong ngày — {money(data.ads_unallocated)}</b>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  {(data.ads_no_order ?? []).map((p: any) => (
                    <span key={p.product_code}>
                      {p.product_name || p.product_code}
                      {p.product_name && (
                        <span className="text-amber-600 font-mono text-[10.5px]"> {p.product_code}</span>
                      )}
                      {" · "}<b>{money(p.ads_cost)}</b>
                    </span>
                  ))}
                </div>
                <div className="mt-1 text-amber-600">
                  Khoản này nằm trong "Ads cả ngày" nhưng không chia được cho đơn nào,
                  nên tổng LNG các dòng dưới đây cao hơn dòng ngày đúng bằng số đó.
                </div>
              </div>
            )}

            <div className="overflow-auto flex-1">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b text-xs text-gray-500 sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2.5"
                      title="ID tra được trên POS — bấm vào số để copy, dán thẳng vào ô tìm kiếm của POS">
                      Đơn (ID trên POS)
                    </th>
                    <th className="text-left px-3 py-2.5">Khách</th>
                    <th className="text-left px-3 py-2.5" title="Sản phẩm trong đơn — bấm dòng để xem giá vốn từng món">Sản phẩm</th>
                    <th className="text-right px-3 py-2.5">SL</th>
                    <th className="text-right px-3 py-2.5" title="Tiền khách trả, đã trừ khuyến mãi, CHƯA trừ phí sàn">DT trước phí sàn</th>
                    <th className="text-right px-3 py-2.5" title="Phí sàn giữ lại">Phí sàn</th>
                    <th className="text-right px-3 py-2.5" title="Đã trừ cả khuyến mãi và phí sàn">DT thực nhận</th>
                    <th className="text-right px-3 py-2.5">Giá vốn</th>
                    <th className="text-right px-3 py-2.5" title="Giá vốn ÷ doanh thu có giá vốn">%GV</th>
                    <th className="text-right px-3 py-2.5" title="Chi phí đóng gói 6.000đ/đơn — chỉ tính đơn đã tra được giá vốn">Fullfill</th>
                    <th className="text-right px-3 py-2.5" title="Chi phí ads cả ngày chia đều số đơn">Ads (TB)</th>
                    <th className="text-right px-3 py-2.5">LNG sau ads</th>
                    <th className="text-right px-3 py-2.5">%LNG</th>
                  </tr>
                </thead>
                <tbody className="divide-y text-gray-900">
                  {orders.length === 0 && (
                    <tr><td colSpan={13} className="px-4 py-6 text-center text-gray-400 text-sm">Không có đơn nào</td></tr>
                  )}
                  {orders.map((o: any) => {
                    const open = !!expanded[o.order_id]
                    return (
                      <Fragment key={o.order_id}>
                        <tr className={`cursor-pointer hover:bg-gray-50 ${o.missing_cost ? "bg-amber-50/40" : ""}`}
                          onClick={() => setExpanded(s => ({ ...s, [o.order_id]: !s[o.order_id] }))}>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span className="text-gray-400 mr-1">{open ? "▾" : "▸"}</span>
                            {/* ID tra trên POS. Bấm để copy — mục đích chính của cột này là
                                dán vào ô tìm kiếm của POS, nên đừng bắt bôi đen thủ công. */}
                            {o.pos_id ? (
                              <button type="button"
                                onClick={e => { e.stopPropagation(); copyId(o.pos_id) }}
                                title={`Bấm để copy — tìm trên POS bằng số này (nội bộ #${o.order_id})`}
                                className="font-mono text-[12px] text-gray-800 hover:text-violet-700 hover:underline">
                                {copiedId === o.pos_id ? "✓ đã copy" : o.pos_id}
                              </button>
                            ) : (
                              <span className="font-mono text-[12px] text-gray-700"
                                title="Đơn này chưa có ID POS trong dữ liệu đã đồng bộ">
                                #{o.order_id}
                              </span>
                            )}
                            {timeVN(o.created_at) && (
                              <span className="ml-1.5 text-[11px] text-gray-400">{timeVN(o.created_at)}</span>
                            )}
                            {o.missing_cost && (
                              <span className="ml-1.5 text-[10.5px] text-amber-600"
                                title="Đơn có sản phẩm chưa khai giá vốn — LNG chỉ tính trên phần đã khai">
                                ⚠ thiếu giá vốn
                              </span>
                            )}
                            {/* Đơn 0đ = hàng gửi affiliate. Không có nhãn thì nhìn cột LNG
                                âm đỏ dễ tưởng đơn lỗ, trong khi đó là chi phí marketing. */}
                            {Number(o.revenue || 0) === 0 && (
                              <span className="ml-1.5 text-[10.5px] text-sky-600"
                                title="Đơn affiliate — hàng gửi KOL/reviewer nên không có doanh thu. Số LNG âm ở đây là giá vốn hàng gửi + suất ads được chia, không phải lỗ do bán.">
                                🎁 affiliate
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-gray-600 max-w-[180px] truncate"
                            title={`${o.customer_name}${o.province ? " · " + o.province : ""}${o.status_name ? " · " + o.status_name : ""}`}>
                            {o.customer_name || <span className="text-gray-300">—</span>}
                          </td>
                          {/* Tên SP gộp sẵn ở dòng đơn — trước đây phải bấm mở mới thấy,
                              mà phần lớn đơn chỉ có 1 món nên mở ra chỉ để đọc một dòng. */}
                          <td className="px-3 py-2.5 text-gray-700 max-w-[230px] truncate"
                            title={(o.items ?? []).map((it: any) => `${it.sp_label}${it.qty > 1 ? ` ×${it.qty}` : ""}`).join(" · ")}>
                            {(o.items ?? []).length === 0
                              ? <span className="text-gray-300">—</span>
                              : (o.items ?? []).map((it: any) => it.sp_label).join(" · ")}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-gray-700">{fmtNum(o.qty)}</td>
                          <td className="px-3 py-2.5 text-right text-gray-600">{money(o.revenue_gross)}</td>
                          <td className="px-3 py-2.5 text-right text-gray-500">{money(o.fee_marketplace)}</td>
                          <td className="px-3 py-2.5 text-right font-semibold text-green-700">{money(o.revenue)}</td>
                          <td className="px-3 py-2.5 text-right text-gray-700">{money(o.cogs)}</td>
                          <td className="px-3 py-2.5 text-right">{pctCell(o.cogs_pct)}</td>
                          <td className="px-3 py-2.5 text-right text-gray-600">{money(o.fullfill)}</td>
                          <td className="px-3 py-2.5 text-right text-gray-500">{money(o.ads_cost)}</td>
                          <td className={`px-3 py-2.5 text-right font-semibold ${Number(o.lng_sau_ads) >= 0 ? "text-violet-700" : "text-red-500"}`}>
                            {money(o.lng_sau_ads)}
                          </td>
                          <td className="px-3 py-2.5 text-right">{pctCell(o.lng_sau_ads_pct, Number(o.lng_sau_ads) >= 0)}</td>
                        </tr>
                        {open && (
                          <tr className="bg-gray-50/70">
                            <td colSpan={13} className="px-8 py-2.5">
                              {/* Mọi cách định danh đơn — mỗi hệ thống tra bằng một số khác nhau. */}
                              <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-gray-500">
                                {o.pos_id && (
                                  <span>ID trên POS:{" "}
                                    <button type="button" onClick={() => copyId(o.pos_id)}
                                      className="font-mono text-gray-700 hover:text-violet-700 hover:underline"
                                      title="Bấm để copy">{o.pos_id}</button>
                                  </span>
                                )}
                                <span>ID nội bộ:{" "}
                                  <button type="button" onClick={() => copyId(o.order_id)}
                                    className="font-mono text-gray-700 hover:text-violet-700 hover:underline"
                                    title="Bấm để copy">{o.order_id}</button>
                                </span>
                                {o.tracking_code && (
                                  <span>Mã vận đơn:{" "}
                                    <button type="button" onClick={() => copyId(o.tracking_code)}
                                      className="font-mono text-gray-700 hover:text-violet-700 hover:underline"
                                      title="Bấm để copy">{o.tracking_code}</button>
                                  </span>
                                )}
                                {o.status_name && <span>Trạng thái: <b className="text-gray-700">{o.status_name}</b></span>}
                              </div>
                              <table className="w-full text-[12.5px]">
                                <thead className="text-gray-400">
                                  <tr>
                                    <th className="text-left py-1">Sản phẩm</th>
                                    <th className="text-right py-1 w-16">SL</th>
                                    <th className="text-right py-1 w-28">Vốn/sp</th>
                                    <th className="text-right py-1 w-32">Giá vốn</th>
                                    <th className="text-right py-1 w-36" title="Doanh thu thực nhận chia theo tỷ trọng giá niêm yết của dòng hàng">DT phân bổ</th>
                                  </tr>
                                </thead>
                                <tbody className="text-gray-700">
                                  {o.items.map((it: any, i: number) => (
                                    <tr key={i}>
                                      <td className="py-1">
                                        {it.sp_label}
                                        {it.sp_code && <span className="ml-1.5 text-[11px] text-gray-400">{it.sp_code}</span>}
                                        {it.missing_cost && <span className="ml-1.5 text-[11px] text-amber-600">⚠ chưa khai giá vốn</span>}
                                      </td>
                                      <td className="text-right py-1 font-mono">{fmtNum(it.qty)}</td>
                                      <td className="text-right py-1">{it.unit_cost > 0 ? money(it.unit_cost) : <span className="text-gray-300">—</span>}</td>
                                      <td className="text-right py-1">{it.item_cost > 0 ? money(it.item_cost) : <span className="text-gray-300">—</span>}</td>
                                      <td className="text-right py-1">{money(it.revenue)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
                {orders.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold text-gray-900">
                      <td className="px-4 py-2.5" colSpan={2}>Tổng {orders.length} đơn</td>
                      <td className="px-3 py-2.5 text-right font-mono">{fmtNum(t.qty)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-600">{money(t.revenue_gross)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-500">{money(t.fee_marketplace)}</td>
                      <td className="px-3 py-2.5 text-right text-green-700">{money(t.revenue)}</td>
                      <td className="px-3 py-2.5 text-right">{money(t.cogs)}</td>
                      <td className="px-3 py-2.5 text-right">{pctCell(t.cogs_pct)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-600">{money(t.ads_cost)}</td>
                      <td className={`px-3 py-2.5 text-right ${Number(t.lng_sau_ads) >= 0 ? "text-violet-700" : "text-red-500"}`}>
                        {money(t.lng_sau_ads)}
                      </td>
                      <td className="px-3 py-2.5 text-right">{pctCell(t.lng_sau_ads_pct, Number(t.lng_sau_ads) >= 0)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {Number(t.revenue_no_cost) > 0 && (
              <div className="px-5 py-2.5 border-t bg-amber-50 text-[12px] text-amber-800">
                ⚠ {money(t.revenue_no_cost)} doanh thu thuộc sản phẩm <b>chưa khai giá vốn</b> —
                phần này bị loại khỏi LNG và khỏi mẫu số %GV/%LNG, nên số lãi ở đây chỉ đại diện
                cho phần doanh thu đã có giá vốn.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function MarketplaceLngTab({ range, market }: { range: DateRange; market: Market }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [showMissing, setShowMissing] = useState(false)
  const [dayPlatform, setDayPlatform] = useState<"all" | "tiktok" | "shopee">("all")
  // Đơn sàn mất vài ngày mới giao xong nên ngày gần đây nhìn số "thực" luôn tưởng lỗ
  // nặng (ads tiêu hết rồi, doanh thu chưa kịp về). Mặc định xem tạm tính.
  const [dayMode, setDayMode] = useState<"tt" | "thuc">("tt")
  // Cùng 1 cột hiển thị được 2 cách đo hiệu quả ads — bấm tiêu đề để đổi, đỡ phải
  // thêm cột mới. %Ads = ads/doanh thu; ROAS = doanh thu/ads (nghịch đảo).
  const [adsMetric, setAdsMetric] = useState<"pct" | "roas">("pct")
  const { colWidths, onResizeMouseDown, resetColWidths, totalWidth } =
    useResizableColumns("santmdt-lng-ngay.col-widths.v1", SANTMDT_DAY_COLS)
  const [daySort, setDaySort] = useState<{ key: string; dir: 1 | -1 }>({ key: "date", dir: -1 })
  // Dòng ngày đang mở drill-down (xem chi tiết từng đơn của ngày × sàn đó).
  const [dayDetail, setDayDetail] = useState<any | null>(null)

  useEffect(() => {
    setLoading(true); setErr(null)
    apiFetch(`/admin/pancake-sync/report/marketplace-lng?from=${range.from}&to=${range.to}&market=${market}`)
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setData(d) })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }, [range.from, range.to, market])

  if (loading) return <div className="p-8 text-center text-gray-400 text-sm animate-pulse">Đang tải...</div>
  if (err) return <div className="p-6 text-center text-sm text-red-600">⚠ {err}</div>
  if (!data) return null

  const rows: any[] = data.rows ?? []
  const cov = data.coverage ?? {}
  const shown = showMissing ? rows : rows.filter(r => !r.missing_cost)
  const money = (n: any) => fmtVND(Number(n || 0))
  const pctCell = (v: any, good?: boolean) =>
    v == null ? <span className="text-gray-300">—</span>
      : <span className={good == null ? "text-gray-600" : good ? "text-green-600" : "text-red-600"}>{v}%</span>

  // ROAS = doanh thu ÷ chi phí ads. Ads = 0 thì không chia được (chưa điền hoặc
  // ngày không chạy ads) — trả "—" thay vì Infinity.
  const roasCell = (revenue: any, ads: any) => {
    const a = Number(ads || 0), r = Number(revenue || 0)
    if (a <= 0) return <span className="text-gray-300">—</span>
    const v = Math.round(r / a * 100) / 100
    return <span className={v >= 1 ? "text-green-600" : "text-red-600"}>{v.toFixed(2)}</span>
  }

  const WEEKDAY_VN = ["CN", "Th2", "Th3", "Th4", "Th5", "Th6", "Th7"]
  const dayLabel = (iso: string) => {
    const d = new Date(iso + "T00:00:00Z")
    const dd = String(d.getUTCDate()).padStart(2, "0")
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0")
    return `${dd}/${mm} (${WEEKDAY_VN[d.getUTCDay()]})`
  }

  const byDayRaw: any[] = data.by_day ?? []
  const byDayFiltered = dayPlatform === "all" ? byDayRaw : byDayRaw.filter((r: any) => r.platform === dayPlatform)
  // Mỗi mode đọc bộ field riêng: "thực" = chỉ đơn đã giao, "tạm tính" = thêm đơn đang đi.
  const M = dayMode === "tt"
    ? { orders: "orders_tt", gross: "revenue_gross_tt", fee: "fee_tt", feePct: "fee_tt_pct",
        rev: "revenue_tt", cogs: "cogs_tt",
        cogsPct: "cogs_tt_pct", fullfill: "fullfill_tt", adsGrossPct: "ads_gross_pct_tt",
        lng: "lng_tt_sau_ads", pct: "lng_tt_sau_ads_pct" }
    : { orders: "da_nhan", gross: "revenue_gross", fee: "fee_marketplace", feePct: "fee_pct",
        rev: "revenue_delivered", cogs: "cogs",
        cogsPct: "cogs_pct", fullfill: "fullfill", adsGrossPct: "ads_gross_pct",
        lng: "lng_sau_ads", pct: "lng_sau_ads_pct" }
  // Cột hiển thị đổi theo mode, nên sort key cũng phải map sang field tương ứng —
  // nếu không, bấm "LNG sau ads" ở mode tạm tính sẽ sort theo số của mode thực.
  const SORT_ALIAS: Record<string, string> = {
    orders: M.orders, gross: M.gross, rev: M.rev, cogs: M.cogs,
    cogsPct: M.cogsPct, fee: M.fee, feePct: M.feePct, fullfill: M.fullfill,
    adsGrossPct: M.adsGrossPct, lng: M.lng, pct: M.pct,
    huyHoan: "da_huy",
  }
  const byDay = [...byDayFiltered].sort((a: any, b: any) => {
    const key = SORT_ALIAS[daySort.key] ?? daySort.key
    const av = a[key], bv = b[key]
    if (av === bv) return a.date === b.date ? a.platform.localeCompare(b.platform) : (a.date < b.date ? 1 : -1)
    return (av > bv ? 1 : -1) * daySort.dir
  })
  const dayTotal = byDayFiltered.reduce((acc: any, r: any) => {
    acc.orders += Number(r[M.orders] || 0)
    acc.huy += Number(r.da_huy || 0)
    acc.hoan += Number(r.da_hoan || 0) + Number(r.dang_hoan || 0)
    acc.nhan += Number(r.da_nhan || 0)
    acc.gross += Number(r[M.gross] || 0)
    acc.rev += Number(r[M.rev] || 0)
    acc.cogs += Number(r[M.cogs] || 0)
    acc.fee += Number(r[M.fee] || 0)
    acc.fullfill += Number(r[M.fullfill] || 0)
    acc.ads_cost += Number(r.ads_cost || 0)
    acc.lng += Number(r[M.lng] || 0)
    // Mẫu số cho %GV và %LNG là doanh thu CÓ giá vốn — phần chưa khai giá vốn bị loại
    // khỏi LNG nên cũng không được nằm ở mẫu số, nếu không %  sẽ bị pha loãng.
    acc.rev_costed += Number(dayMode === "tt" ? (r.revenue_costed_tt || 0) : (r.revenue_costed || 0))
    acc.pending += Number(r.orders_pending || 0)
    if (r.ads_missing) acc.ads_missing_days += 1
    return acc
  }, { orders: 0, huy: 0, hoan: 0, nhan: 0, gross: 0, rev: 0, cogs: 0, fee: 0, fullfill: 0, ads_cost: 0, lng: 0, rev_costed: 0, pending: 0, ads_missing_days: 0 })
  const toggleDaySort = (key: string) =>
    setDaySort(s => s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: -1 })
  const sortIcon = (key: string) => daySort.key !== key ? "" : (daySort.dir === -1 ? " ▼" : " ▲")

  return (
    <div className="space-y-4">
      {data.myr_to_vnd_rate && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-[12.5px] text-blue-800">
          💱 Đơn Malaysia lưu bằng RM — mọi số tiền ở đây đã <b>quy về VND</b> theo tỷ giá{" "}
          <b>{fmtNum(data.myr_to_vnd_rate)}đ/RM</b> để so sánh được với giá vốn và chi phí ads (đều là VND).
        </div>
      )}

      {/* Cảnh báo đơn thiếu thông tin — đặt TRÊN các thẻ số để không ai đọc LNG trước
          khi biết số đó đang thiếu gì. Bấm 1 ngày để mở thẳng chi tiết đơn của ngày đó. */}
      {(() => {
        const di = data.data_issues
        if (!di) return null
        const problems = [
          di.missing_cost?.orders > 0 && {
            key: "cost",
            icon: "🏷️",
            title: `${fmtNum(di.missing_cost.orders)} đơn có sản phẩm chưa khai giá vốn`,
            detail: <>Kéo theo {money(di.missing_cost.revenue)} doanh thu <b>không được tính vào LNG</b> —
              số lãi đang thấp hơn thực tế. Khai giá vốn ở trang <b>Giá vốn</b>; nếu là mã combo do POS
              sinh thêm thì báo kỹ thuật khai thành phần.</>,
            days: di.missing_cost.days, total: di.missing_cost.total_days,
          },
          di.ads_missing?.total_days > 0 && {
            key: "ads",
            icon: "📢",
            title: `${fmtNum(di.ads_missing.total_days)} ngày chưa điền chi phí ads`,
            detail: <>Các ngày này đang tính lãi <b>như thể không tốn tiền quảng cáo</b> nên LNG
              đẹp giả tạo. Điền ở trang <b>Nhập chi phí</b>.</>,
            days: di.ads_missing.days, total: di.ads_missing.total_days,
          },
        ].filter(Boolean) as any[]

        if (problems.length === 0) return null

        return (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 space-y-3">
            <div className="text-[13px] font-semibold text-red-800">
              ⚠ Có đơn thiếu thông tin — số LNG bên dưới chưa phản ánh đúng thực tế
            </div>
            {problems.map(p => (
              <div key={p.key} className="text-[12.5px] text-red-900/90">
                <div className="font-semibold">{p.icon} {p.title}</div>
                <div className="mt-0.5 text-red-800/85">{p.detail}</div>
                {p.days?.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11.5px] text-red-700/70">Ngày cần xử lý:</span>
                    {p.days.map((d: any) => (
                      <button key={`${d.date}-${d.platform}`} type="button"
                        onClick={() => {
                          // Mở đúng dòng ngày đó trong bảng bên dưới.
                          const row = (data.by_day ?? []).find(
                            (r: any) => r.date === d.date && r.platform === d.platform)
                          if (row) setDayDetail(row)
                        }}
                        title={`${d.platform === "tiktok" ? "TikTok Shop" : "Shopee"} — ${fmtNum(d.n)} đơn. Bấm để xem chi tiết.`}
                        className="rounded-md border border-red-300 bg-white px-2 py-0.5 text-[11.5px] font-medium text-red-700 hover:bg-red-100">
                        {d.date.slice(8, 10)}/{d.date.slice(5, 7)}
                        <span className="ml-1 text-red-400">{d.platform === "tiktok" ? "TT" : "SP"}</span>
                        <span className="ml-1 font-semibold">{fmtNum(d.n)}</span>
                      </button>
                    ))}
                    {p.total > p.days.length && (
                      <span className="text-[11.5px] text-red-700/70">…và {p.total - p.days.length} ngày nữa</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      })()}

      {/* Đơn affiliate — thông tin, KHÔNG phải lỗi. Để riêng khỏi banner đỏ để cảnh báo
          thật không bị loãng, nhưng vẫn nêu vì giá vốn hàng tặng là chi phí thật. */}
      {data.affiliate?.orders > 0 && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-[12.5px] text-sky-900">
          <div className="font-semibold">
            🎁 {fmtNum(data.affiliate.orders)} đơn affiliate (doanh thu 0đ)
            {data.affiliate.cogs > 0 && <> — giá vốn hàng gửi {money(data.affiliate.cogs)}</>}
          </div>
          <div className="mt-0.5 text-sky-800/85">
            Hàng gửi KOL/reviewer nên không có doanh thu — <b>đây là bình thường, không phải lỗi</b>.
            Nhưng chúng vẫn mang giá vốn thật và vẫn được chia một suất ads, nên đang
            <b> kéo LNG và %GV của ngày xuống</b>. Khi đọc số, nhớ trừ phần này ra.
          </div>
          {data.affiliate.days?.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[11.5px] text-sky-700/70">Ngày có đơn affiliate:</span>
              {data.affiliate.days.map((d: any) => (
                <button key={`aff-${d.date}-${d.platform}`} type="button"
                  onClick={() => {
                    const row = (data.by_day ?? []).find(
                      (r: any) => r.date === d.date && r.platform === d.platform)
                    if (row) setDayDetail(row)
                  }}
                  title={`${d.platform === "tiktok" ? "TikTok Shop" : "Shopee"} — ${fmtNum(d.n)} đơn affiliate. Bấm để xem chi tiết.`}
                  className="rounded-md border border-sky-300 bg-white px-2 py-0.5 text-[11.5px] font-medium text-sky-700 hover:bg-sky-100">
                  {d.date.slice(8, 10)}/{d.date.slice(5, 7)}
                  <span className="ml-1 text-sky-400">{d.platform === "tiktok" ? "TT" : "SP"}</span>
                  <span className="ml-1 font-semibold">{fmtNum(d.n)}</span>
                </button>
              ))}
              {data.affiliate.total_days > data.affiliate.days.length && (
                <span className="text-[11.5px] text-sky-700/70">
                  …và {data.affiliate.total_days - data.affiliate.days.length} ngày nữa
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {cov.pct != null && cov.pct < 100 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          <b>Giá vốn phủ {cov.pct}% doanh thu.</b>{" "}
          Còn {money(cov.revenue_no_cost)} doanh thu từ {cov.missing_products} sản phẩm chưa khai giá vốn —
          phần này <b>không được tính vào LNG</b> (tránh lãi ảo). Khai thêm ở trang Giá vốn để số đầy đủ hơn.
          {cov.pct != null && cov.pct < 20 && (
            <div className="mt-1.5 font-semibold">
              ⚠ Mức phủ quá thấp — con số LNG bên dưới chỉ đại diện cho {cov.pct}% doanh thu,
              chưa dùng để kết luận lãi/lỗ được.
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(data.by_platform ?? []).map((p: any) => (
          <div key={p.platform} className="bg-white border rounded-xl p-5 shadow-sm"
            style={{ borderTop: `3px solid ${p.platform === "tiktok" ? "#111827" : "#ee4d2d"}` }}>
            <div className="text-xs text-gray-500 uppercase tracking-wide">{p.platform_label}</div>
            <div className="text-2xl font-bold mt-1 text-gray-900">{money(p.revenue_delivered)}</div>
            <div className="text-xs text-gray-400 mt-0.5">{fmtNum(p.da_nhan)} đơn giao thành công</div>
            <div className="mt-2 pt-2 border-t border-dashed border-gray-200 space-y-1 text-xs">
              <div className="flex justify-between"><span className="text-gray-400">Phí sàn giữ</span><span className="text-gray-700">{money(p.fee_marketplace)}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Giá vốn</span><span className="text-gray-700">{money(p.cogs)} {pctCell(p.cogs_pct)}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">LNG trước ads</span><span className="text-gray-700">{money(p.lng)} {pctCell(p.lng_pct)}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Chi phí ads</span><span className="text-gray-700">{money(p.ads_cost)} {pctCell(p.ads_pct)}</span></div>
              <div className="flex justify-between font-semibold pt-1 border-t border-dashed border-gray-200">
                <span className="text-gray-500">LNG sau ads</span>
                <span className={p.lng_sau_ads >= 0 ? "text-green-600" : "text-red-600"}>{money(p.lng_sau_ads)} ({p.lng_sau_ads_pct}%)</span>
              </div>
            </div>
          </div>
        ))}
        {data.totals && (
          <div className="bg-white border rounded-xl p-5 shadow-sm" style={{ borderTop: "3px solid #7c3aed" }}>
            <div className="text-xs text-gray-500 uppercase tracking-wide">Tổng 2 sàn</div>
            <div className="text-2xl font-bold mt-1 text-gray-900">{money(data.totals.revenue_delivered)}</div>
            <div className="text-xs text-gray-400 mt-0.5">{fmtNum(data.totals.da_nhan)} đơn · huỷ {fmtNum(data.totals.da_huy)}</div>
            <div className="mt-2 pt-2 border-t border-dashed border-gray-200 space-y-1 text-xs">
              <div className="flex justify-between"><span className="text-gray-400">Phí sàn giữ</span><span className="text-gray-700">{money(data.totals.fee_marketplace)}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Giá vốn</span><span className="text-gray-700">{money(data.totals.cogs)} {pctCell(data.totals.cogs_pct)}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">LNG trước ads</span><span className="text-gray-700">{money(data.totals.lng)} {pctCell(data.totals.lng_pct)}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Chi phí ads</span><span className="text-gray-700">{money(data.totals.ads_cost)} {pctCell(data.totals.ads_pct)}</span></div>
              <div className="flex justify-between font-semibold pt-1 border-t border-dashed border-gray-200">
                <span className="text-gray-500">LNG sau ads</span>
                <span className={data.totals.lng_sau_ads >= 0 ? "text-green-600" : "text-red-600"}>{money(data.totals.lng_sau_ads)} ({data.totals.lng_sau_ads_pct}%)</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold text-gray-800">
              LNG theo ngày {dayMode === "tt" ? "(Tạm tính)" : "(Thực)"}
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {dayMode === "tt"
                ? "Gồm cả đơn đã xác nhận cho đi nhưng chưa giao xong. Đơn huỷ/hoàn KHÔNG tính vào doanh thu."
                : "Chỉ đơn đã giao thành công — tiền chắc chắn về. Đơn huỷ/hoàn KHÔNG tính vào doanh thu."}
              {" "}<b>Bấm vào 1 dòng ngày để xem chi tiết từng đơn</b> của ngày đó.
              {" "}Dấu 🏷️ = đơn chưa khai giá vốn, 🎁 = đơn affiliate 0đ (di chuột để xem).
              {" "}Bấm tiêu đề cột để sắp xếp; riêng cột <b>{adsMetric === "pct" ? "%Ads" : "ROAS"}</b> bấm để đổi cách tính.
              {" "}Kéo mép cột để đổi độ rộng —{" "}
              <button type="button" onClick={resetColWidths}
                className="underline hover:text-gray-600">đặt lại</button>.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1">
              {([["tt", "Tạm tính"], ["thuc", "Thực"]] as const).map(([k, label]) => (
                <button key={k} type="button" onClick={() => setDayMode(k)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                    dayMode === k ? "bg-gray-900 text-white border-gray-900"
                                  : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              {([["all", "Cả 2 sàn"], ["tiktok", "TikTok"], ["shopee", "Shopee"]] as const).map(([k, label]) => (
                <button key={k} type="button" onClick={() => setDayPlatform(k)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                    dayPlatform === k ? "bg-violet-600 text-white border-violet-600"
                                      : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="text-sm" style={{ tableLayout: "fixed", width: `${totalWidth}px`, minWidth: "100%" }}>
            <colgroup>
              {SANTMDT_DAY_COLS.map(c => <col key={c.id} style={{ width: `${colWidths[c.id]}px` }} />)}
            </colgroup>
            <thead className="bg-gray-50 border-b text-xs text-gray-500 select-none">
              <tr>
                {SANTMDT_DAY_COLS.map(c => {
                  const alignLeft = c.id === "date" || c.id === "platform"
                  const base = `relative ${alignLeft ? "text-left px-4" : "text-right px-3"} py-2.5`
                  // Cột "Sàn" không sort (chỉ là nhãn), cột %Ads bấm để đổi cách tính.
                  if (c.id === "platform") {
                    return <th key={c.id} className={base}>{c.label}<ResizeHandle onMouseDown={onResizeMouseDown(c.id)} /></th>
                  }
                  if (c.id === "adsMetric") {
                    return (
                      <th key={c.id} className={base}>
                        <button type="button"
                          onClick={() => setAdsMetric(m => m === "pct" ? "roas" : "pct")}
                          title={adsMetric === "pct"
                            ? "Chi phí ads ÷ DT trước phí sàn — bấm để đổi sang ROAS"
                            : "DT trước phí sàn ÷ chi phí ads — bấm để đổi sang %Ads"}
                          className="inline-flex items-center gap-1 hover:text-gray-700 cursor-pointer">
                          {adsMetric === "pct" ? "%Ads" : "ROAS"}
                          <span className="text-[9px] text-gray-400">⇄</span>
                        </button>
                        <ResizeHandle onMouseDown={onResizeMouseDown(c.id)} />
                      </th>
                    )
                  }
                  const titles: Partial<Record<DayColId, string>> = {
                    huyHoan: "Số đơn huỷ + hoàn (và % trên số đơn đã ngã ngũ). Không tính vào doanh thu.",
                    gross: "Tiền khách trả (đã trừ khuyến mãi, CHƯA trừ phí sàn)",
                    rev: "Tiền thực nhận — đã trừ cả khuyến mãi và phí sàn",
                    cogsPct: "Giá vốn ÷ doanh thu có giá vốn",
                    fee: "Phí sàn giữ lại. Ở mode Tạm tính, đơn dưới 15 ngày dùng mức ước tính 30% vì Pancake chưa nhận đủ số đối soát.",
                    feePct: "Phí sàn ÷ DT trước phí sàn (tiền khách trả)",
                  }
                  return (
                    <th key={c.id} className={`${base} cursor-pointer hover:text-gray-700`}
                      title={titles[c.id]} onClick={() => toggleDaySort(c.id)}>
                      {c.label}{sortIcon(c.id)}
                      <ResizeHandle onMouseDown={onResizeMouseDown(c.id)} />
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody className="divide-y text-gray-900">
              {byDay.length === 0 && (
                <tr><td colSpan={SANTMDT_DAY_COLS.length} className="px-4 py-6 text-center text-gray-400 text-sm">Không có dữ liệu</td></tr>
              )}
              {byDay.map((r: any) => {
                const lngVal = Number(r[M.lng] || 0)
                const pctVal = r[M.pct]
                const lngBad = Number(r[M.rev] || 0) > 0 && pctVal != null && pctVal < -20
                // Ở mode "thực", ngày còn nhiều đơn đang đi thì số chưa chín — nhắc để
                // không kết luận nhầm là lỗ.
                const pending = Number(r.orders_pending || 0)
                const notRipe = dayMode === "thuc" && pending > 0
                return (
                  <tr key={`${r.date}-${r.platform}`}
                    onClick={() => setDayDetail(r)}
                    title="Bấm để xem chi tiết từng đơn của ngày này"
                    className={`cursor-pointer hover:bg-violet-50/60 ${
                      lngBad ? "bg-red-50/60" : r.ads_missing ? "bg-amber-50/50" : ""}`}>
                    <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap overflow-hidden">
                      {dayLabel(r.date)}
                      {notRipe && (
                        <span className="ml-1.5 text-[10.5px] text-gray-400"
                          title={`Còn ${pending} đơn đã cho đi nhưng chưa giao xong — số "thực" của ngày này chưa đủ chín`}>
                          ⏳{pending}
                        </span>
                      )}
                      {Number(r.orders_missing_cost || 0) > 0 && (
                        <span className="ml-1.5 text-[10.5px] text-amber-600"
                          title={`${r.orders_missing_cost} đơn có SP chưa khai giá vốn — LNG ngày này đang thấp hơn thực tế`}>
                          🏷️{r.orders_missing_cost}
                        </span>
                      )}
                      {Number(r.orders_zero_revenue || 0) > 0 && (
                        <span className="ml-1.5 text-[10.5px] text-sky-600"
                          title={`${r.orders_zero_revenue} đơn affiliate (doanh thu 0đ) — hàng gửi KOL, không phải lỗi; vẫn mang giá vốn nên kéo LNG ngày này xuống`}>
                          🎁{r.orders_zero_revenue}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 overflow-hidden">
                      <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${
                        r.platform === "tiktok" ? "bg-gray-900 text-white" : "bg-orange-100 text-orange-700"
                      }`}>{r.platform_label}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-gray-900">{fmtNum(r[M.orders])}</td>
                    <td className="px-3 py-2.5 text-right">
                      {(() => {
                        // Đơn huỷ/hoàn KHÔNG nằm trong doanh thu — cột này chỉ để thấy
                        // quy mô thất thoát và biết dòng nào tạm tính đáng tin.
                        const huy = Number(r.da_huy || 0)
                        const hoan = Number(r.da_hoan || 0) + Number(r.dang_hoan || 0)
                        const tong = huy + hoan
                        if (tong === 0) return <span className="text-gray-300">—</span>
                        // Mẫu số: số đơn đã ngã ngũ (nhận/huỷ/hoàn) — đơn còn đang đi
                        // chưa biết kết quả nên không tính vào.
                        const ngaNgu = Number(r.da_nhan || 0) + tong
                        const pctHuy = ngaNgu > 0 ? Math.round(tong / ngaNgu * 1000) / 10 : null
                        const nang = pctHuy != null && pctHuy >= 30
                        return (
                          <span title={`Huỷ ${huy} · Hoàn ${hoan} — trên ${ngaNgu} đơn đã ngã ngũ`}>
                            <span className={nang ? "font-semibold text-red-600" : "text-gray-700"}>{fmtNum(tong)}</span>
                            {pctHuy != null && (
                              <span className={`ml-1 text-[11px] ${nang ? "text-red-500" : "text-gray-400"}`}>
                                {pctHuy}%
                              </span>
                            )}
                          </span>
                        )
                      })()}
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-600">{money(r[M.gross])}</td>
                    <td className="px-3 py-2.5 text-right text-gray-600">{money(r[M.fee])}</td>
                    <td className="px-3 py-2.5 text-right">{pctCell(r[M.feePct])}</td>
                    <td className="px-3 py-2.5 text-right font-semibold text-green-700">{money(r[M.rev])}</td>
                    <td className="px-3 py-2.5 text-right text-gray-700">{money(r[M.cogs])}</td>
                    <td className="px-3 py-2.5 text-right">{pctCell(r[M.cogsPct])}</td>
                    <td className="px-3 py-2.5 text-right text-gray-600">{money(r[M.fullfill])}</td>
                    <td className="px-3 py-2.5 text-right text-gray-700">
                      {r.ads_missing
                        ? <span className="text-amber-600" title="Chưa điền chi phí ads cho ngày này">⚠ chưa điền</span>
                        : money(r.ads_cost)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {r.ads_missing
                        ? <span className="text-gray-300">—</span>
                        : adsMetric === "pct"
                          ? pctCell(r[M.adsGrossPct])
                          : roasCell(r[M.gross], r.ads_cost)}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-semibold ${lngVal >= 0 ? "text-violet-700" : "text-red-500"}`}>
                      {lngBad && <span title="Lỗ nặng: LNG sau ads dưới -20% doanh thu">🔴 </span>}
                      {money(lngVal)}
                    </td>
                    <td className="px-3 py-2.5 text-right">{pctCell(pctVal, lngVal >= 0)}</td>
                  </tr>
                )
              })}
            </tbody>
            {byDay.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold text-gray-900">
                  <td className="px-4 py-2.5" colSpan={2}>
                    Tổng {byDay.length} dòng
                    {dayTotal.ads_missing_days > 0 && (
                      <span className="ml-2 font-normal text-amber-600">
                        (⚠ {dayTotal.ads_missing_days} dòng chưa điền ads)
                      </span>
                    )}
                    {dayMode === "thuc" && dayTotal.pending > 0 && (
                      <span className="ml-2 font-normal text-gray-500">
                        (⏳ {fmtNum(dayTotal.pending)} đơn chưa giao xong — xem Tạm tính)
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono">{fmtNum(dayTotal.orders)}</td>
                  <td className="px-3 py-2.5 text-right">
                    {(() => {
                      const tong = dayTotal.huy + dayTotal.hoan
                      if (tong === 0) return <span className="text-gray-300">—</span>
                      const ngaNgu = dayTotal.nhan + tong
                      const p = ngaNgu > 0 ? Math.round(tong / ngaNgu * 1000) / 10 : null
                      return (
                        <span title={`Huỷ ${dayTotal.huy} · Hoàn ${dayTotal.hoan} — trên ${ngaNgu} đơn đã ngã ngũ`}>
                          {fmtNum(tong)}
                          {p != null && <span className="ml-1 text-[11px] font-normal text-gray-500">{p}%</span>}
                        </span>
                      )
                    })()}
                  </td>
                  <td className="px-3 py-2.5 text-right text-gray-600">{money(dayTotal.gross)}</td>
                  <td className="px-3 py-2.5 text-right text-gray-600">{money(dayTotal.fee)}</td>
                  <td className="px-3 py-2.5 text-right">
                    {pctCell(dayTotal.gross > 0 ? Math.round(dayTotal.fee / dayTotal.gross * 10000) / 100 : null)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-green-700">{money(dayTotal.rev)}</td>
                  <td className="px-3 py-2.5 text-right">{money(dayTotal.cogs)}</td>
                  <td className="px-3 py-2.5 text-right">
                    {/* Mẫu số là doanh thu CÓ giá vốn (rev_costed), khớp cách tính từng dòng */}
                    {pctCell(dayTotal.rev_costed > 0 ? Math.round(dayTotal.cogs / dayTotal.rev_costed * 10000) / 100 : null)}
                  </td>
                  <td className="px-3 py-2.5 text-right">{money(dayTotal.fullfill)}</td>
                  <td className="px-3 py-2.5 text-right">{money(dayTotal.ads_cost)}</td>
                  <td className="px-3 py-2.5 text-right">
                    {adsMetric === "pct"
                      ? pctCell(dayTotal.gross > 0 ? Math.round(dayTotal.ads_cost / dayTotal.gross * 10000) / 100 : null)
                      : roasCell(dayTotal.gross, dayTotal.ads_cost)}
                  </td>
                  <td className={`px-3 py-2.5 text-right ${dayTotal.lng >= 0 ? "text-violet-700" : "text-red-500"}`}>
                    {money(dayTotal.lng)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {pctCell(
                      dayTotal.rev_costed > 0 ? Math.round(dayTotal.lng / dayTotal.rev_costed * 10000) / 100 : null,
                      dayTotal.lng >= 0,
                    )}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {dayDetail && (
        <DayOrdersModal
          date={dayDetail.date}
          platform={dayDetail.platform}
          market={market}
          mode={dayMode}
          dayRow={dayDetail}
          onClose={() => setDayDetail(null)}
        />
      )}

      <div className="bg-white border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold text-gray-800">LNG theo sản phẩm</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Doanh thu = tiền thực nhận (sàn đã trừ phí + khuyến mãi). Mỗi dòng hàng tính giá vốn riêng.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
            <input type="checkbox" checked={showMissing} onChange={e => setShowMissing(e.target.checked)} />
            Hiện cả SP chưa khai giá vốn ({rows.filter(r => r.missing_cost).length})
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b text-xs text-gray-500">
              <tr>
                <th className="text-left px-4 py-2.5">Sàn</th>
                <th className="text-left px-4 py-2.5">Sản phẩm</th>
                <th className="text-right px-3 py-2.5">SL</th>
                <th className="text-right px-3 py-2.5">Đơn</th>
                <th className="text-right px-3 py-2.5">Phí sàn</th>
                <th className="text-right px-3 py-2.5">DT thực nhận</th>
                <th className="text-right px-3 py-2.5">Giá vốn</th>
                <th className="text-right px-3 py-2.5">%GV</th>
                <th className="text-right px-3 py-2.5">LNG</th>
                <th className="text-right px-3 py-2.5">%LNG</th>
              </tr>
            </thead>
            <tbody className="divide-y text-gray-900">
              {shown.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-6 text-center text-gray-400 text-sm">Không có dữ liệu</td></tr>
              )}
              {shown.map((r, i) => (
                <tr key={`${r.platform}-${r.sp_code ?? r.sp_label}-${i}`} className={r.missing_cost ? "bg-amber-50/50" : ""}>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                      r.platform === "tiktok" ? "bg-gray-900 text-white" : "bg-orange-100 text-orange-700"
                    }`}>{r.platform === "tiktok" ? "TikTok" : "Shopee"}</span>
                  </td>
                  <td className="px-4 py-2.5 max-w-[260px]">
                    <div className="truncate text-gray-900" title={r.sp_label}>{r.sp_label}</div>
                    {r.sp_code && <div className="text-[10.5px] text-gray-400 font-mono">{r.sp_code}</div>}
                    {r.missing_cost && <div className="text-[10.5px] text-amber-600">⚠ chưa khai giá vốn</div>}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-gray-900">{fmtNum(r.delivered_qty)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-gray-900">{fmtNum(r.da_nhan)}</td>
                  <td className="px-3 py-2.5 text-right text-gray-500">{money(r.fee_marketplace)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-green-700">{money(r.revenue_delivered)}</td>
                  <td className="px-3 py-2.5 text-right text-gray-700">{r.missing_cost ? "—" : money(r.cogs)}</td>
                  <td className="px-3 py-2.5 text-right">{r.missing_cost ? <span className="text-gray-300">—</span> : pctCell(r.cogs_pct)}</td>
                  <td className={`px-3 py-2.5 text-right font-semibold ${r.lng >= 0 ? "text-violet-700" : "text-red-500"}`}>
                    {r.missing_cost ? "—" : money(r.lng)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {r.missing_cost ? <span className="text-gray-300">—</span> : pctCell(r.lng_pct, r.lng >= 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-2.5 border-t bg-gray-50 text-[11px] text-gray-500">
          LNG ở bảng theo sản phẩm <b>chưa trừ ads</b> — chi phí ads chỉ điền được theo (ngày × sàn),
          không tách tới từng sản phẩm. Xem LNG sau ads ở thẻ tổng hoặc bảng theo ngày phía trên.
          Ship do sàn trả (không tính). Fullfill 6.000đ/đơn.
        </div>
      </div>
    </div>
  )
}

// ---- Main Page ----
type TabKey = "overview" | "combined" | "shipping" | "product" | "sale" | "nv-mkt" | "lng" | "sanTMDT" | "errors" | "marketing"

const VALID_TABS: TabKey[] = ["overview", "combined", "shipping", "product", "sale", "nv-mkt", "lng", "sanTMDT", "errors", "marketing"]

// Quyền hẹp mở riêng từng tab. page.bao-cao.view vẫn thấy TẤT CẢ tab như trước —
// đây chỉ là đường vào cho nhân sự KHÔNG có quyền xem full báo cáo.
// Tab không liệt kê ở đây = chỉ page.bao-cao.view mới xem được.
const TAB_PERMS: Partial<Record<TabKey, string>> = {
  sanTMDT: "page.bao-cao.sanTMDT",
}

const BaoCaoPage = () => {
  const initParams = getSearchParams()
  const initTab = (VALID_TABS.includes(initParams.get("tab") as TabKey) ? initParams.get("tab") : "overview") as TabKey
  const initRange: DateRange = (initParams.get("from") && initParams.get("to"))
    ? { from: initParams.get("from")!, to: initParams.get("to")! }
    : thisMonthRange()

  const initMarket = (initParams.get("market") === "MY" ? "MY" : "VN") as Market

  const { has, loading: permLoading } = useCurrentPermissions()
  // Xem full → mọi tab. Ngược lại chỉ những tab có quyền hẹp tương ứng.
  const canSeeAll = has("page.bao-cao.view")
  const allowedTabs = VALID_TABS.filter(t => canSeeAll || (TAB_PERMS[t] ? has(TAB_PERMS[t]!) : false))

  const [tab, setTab] = useState<TabKey>(initTab)
  const [range, setRange] = useState<DateRange>(initRange)
  const [market, setMarket] = useState<Market>(initMarket)
  const [currencyMode, setCurrencyMode] = useState<CurrencyMode>("MYR")
  const [myrRate, setMyrRate] = useState<number>(5800)

  // Quyền tải sau lần render đầu, nên phải ép lại tab khi biết quyền thật:
  // nhân sự gõ tay ?tab=lng sẽ bị đẩy về tab đầu tiên họ được xem.
  useEffect(() => {
    if (permLoading || allowedTabs.length === 0) return
    if (!allowedTabs.includes(tab)) {
      setTab(allowedTabs[0])
      pushState(allowedTabs[0], range, market)
    }
  }, [permLoading, allowedTabs.join(","), tab])

  // Chưa biết quyền thì KHÔNG render tab nào. Trước đây render luôn tab mặc định
  // ("overview") ngay lần đầu: người chỉ có page.bao-cao.sanTMDT bị OverviewTab gọi
  // /pancake-sync/report → 403 → apiFetch alert + đá về /app/mkt-chat, nên không bao
  // giờ vào được tab Sàn TMĐT dù đã cấp đúng quyền.
  if (permLoading) {
    return (
      <div className="p-3 sm:p-6 max-w-7xl">
        <div className="text-center py-16 text-gray-400 text-sm animate-pulse">Đang tải…</div>
      </div>
    )
  }
  if (allowedTabs.length === 0) {
    return (
      <div className="p-3 sm:p-6 max-w-7xl">
        <div className="text-center py-16 text-gray-500 text-sm">
          Bạn chưa được cấp quyền xem báo cáo nào.
        </div>
      </div>
    )
  }
  // Quyền đã biết nhưng effect ép tab chạy sau render này — render tab hợp lệ ngay
  // để không loé một tab cấm rồi mới đổi.
  const activeTab: TabKey = allowedTabs.includes(tab) ? tab : allowedTabs[0]

  function changeTab(t: TabKey) {
    if (!allowedTabs.includes(t)) return
    setTab(t)
    pushState(t, range, market)
  }
  function changeRange(r: DateRange) {
    setRange(r)
    pushState(tab, r, market)
  }
  function changeMarket(m: Market) {
    setMarket(m)
    pushState(tab, range, m)
  }

  const marketPicker = (
    <MarketPicker
      market={market} onMarket={changeMarket}
      currencyMode={currencyMode} onCurrencyMode={setCurrencyMode}
      month={range.to.slice(0, 7)} rate={myrRate} onRate={setMyrRate}
    />
  )

  const tabs: { key: TabKey; label: string; icon: string }[] = [
    { key: "overview",  label: "Tổng quan",   icon: "📊" },
    { key: "combined",  label: "Tổng 2 TT",   icon: "🌏" },
    { key: "shipping",  label: "Vận đơn",     icon: "🚚" },
    { key: "product",   label: "Sản phẩm & Lợi nhuận", icon: "💰" },
    { key: "sale",      label: "Sale & Funnel", icon: "🎯" },
    { key: "nv-mkt",   label: "NV MKT",        icon: "📦" },
    { key: "lng",       label: "LNG theo MKT", icon: "💵" },
    { key: "sanTMDT",   label: "Sàn TMĐT",     icon: "🛒" },
    { key: "errors",    label: "Đơn lỗi",      icon: "⚠️" },
    { key: "marketing", label: "MKT",          icon: "📣" },
  ]

  return (
    <div className="p-3 sm:p-6 max-w-7xl">
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Báo cáo</h1>
          <p className="text-gray-400 text-sm mt-0.5">Dashboard quản lý · dữ liệu từ Pancake POS</p>
        </div>
      </div>

      {/* Period selector. Chọn thị trường nằm trong từng tab (cạnh bộ lọc Phạm vi) —
          gần chỗ số liệu đổi theo nó, thay vì tách rời trên đầu trang. */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PeriodSelector range={range} onChange={changeRange} />
      </div>

      {/* AI Summary */}
      {canSeeAll && <AISummaryBlock range={range} />}

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-gray-200 overflow-x-auto">
        {tabs.filter(t => allowedTabs.includes(t.key)).map(t => (
          <button key={t.key} onClick={() => changeTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
              activeTab === t.key
                ? "text-violet-600 border-b-2 border-violet-600 bg-violet-50/50"
                : "text-gray-500 hover:text-gray-700 border-b-2 border-transparent"
            }`}>
            <span className="mr-1.5">{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      <CurrencyCtx.Provider value={{ market, currencyMode, rate: myrRate }}>
        {/* Tổng quan nhúng picker vào hàng "Phạm vi"; các tab khác chưa có hàng lọc
            riêng nên hiện picker ở đây. "Tổng 2 TT" gộp cả 2 thị trường và MKT là
            trang riêng → không cần chọn thị trường. */}
        {activeTab !== "overview" && activeTab !== "combined" && activeTab !== "marketing" && (
          <div className="mb-4 flex flex-wrap items-center gap-3">{marketPicker}</div>
        )}
        {activeTab === "overview"  && <OverviewTab range={range} market={market} onRate={setMyrRate} marketPicker={marketPicker} />}
        {/* Gộp 2 thị trường → luôn hiển thị VND, không phụ thuộc dropdown market. */}
        {activeTab === "combined"  && <CombinedTab range={range} />}
        {activeTab === "shipping"  && <ShippingTab range={range} market={market} />}
        {activeTab === "product"   && <ProductTab range={range} market={market} />}
        {activeTab === "sale"      && <SaleTab range={range} market={market} />}
        {activeTab === "nv-mkt"   && <NvMktTab range={range} market={market} />}
        {activeTab === "lng"      && <LngTab range={range} market={market} />}
        {activeTab === "sanTMDT"  && <MarketplaceLngTab range={range} market={market} />}
        {activeTab === "errors"   && <ErrorsTab range={range} market={market} />}
      </CurrencyCtx.Provider>
      {activeTab === "marketing" && (
        <div className="bg-white border rounded-xl p-10 text-center space-y-4">
          <div className="text-5xl">📣</div>
          <h3 className="font-semibold text-gray-700 text-lg">Báo cáo Marketing</h3>
          <p className="text-sm text-gray-500">Chi tiết MKT, camp ads, ROAS, lịch hẹn — xem trong trang chuyên biệt.</p>
          <a href="/app/bao-cao-mkt"
            className="inline-block px-6 py-2.5 bg-violet-600 text-white rounded-xl font-semibold text-sm hover:bg-violet-700 transition-colors">
            Mở trang MKT →
          </a>
        </div>
      )}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Báo cáo", rank: 1,
})

export default withRouteGuard(BaoCaoPage)