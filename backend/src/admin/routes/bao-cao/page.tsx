import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useEffect, useState, useRef, useContext, createContext } from "react"
import { apiFetch, apiJson } from "../../lib/api-client"
import { withRouteGuard } from "../../components/route-guard"

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
      <div className="text-2xl font-bold">{value}</div>
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
            className="border rounded-lg px-2 py-1 text-sm" />
          <span className="text-gray-400 text-sm">→</span>
          <input type="date" value={custom.to}
            onChange={e => setCustom(c => ({ ...c, to: e.target.value }))}
            className="border rounded-lg px-2 py-1 text-sm" />
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
          className="w-20 text-xs border rounded px-1.5 py-0.5"
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
              <span className="font-medium">{new Intl.NumberFormat("vi-VN").format(Number(r.myr_to_vnd))}đ</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---- Overview Tab ----
function OverviewTab({ range, market, onRate }: { range: DateRange; market: Market; onRate?: (rate: number) => void }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  // Top nhân sự lấy từ marketer-lng (đã chuẩn hoá attribution + handover + LNG). Chỉ VN;
  // MY trả not_supported → ẩn khối. Tách state riêng để không chặn render khối chính nếu chậm.
  const [mkt, setMkt] = useState<any>(null)

  useEffect(() => {
    setLoading(true)
    const from = toISO(range.from), to = toISO(range.to, true)
    apiFetch(`/admin/pancake-sync/report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&market=${market}`)
      .then(r => r.json()).then(d => {
        setData(d)
        if (d?.myr_to_vnd_rate) onRate?.(d.myr_to_vnd_rate)
      }).catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [range.from, range.to, market])

  useEffect(() => {
    setMkt(null)
    apiJson(`/admin/pancake-sync/report/marketer-lng?from=${toISO(range.from)}&to=${toISO(range.to, true)}&market=${market}`)
      .then(setMkt).catch(() => setMkt(null))
  }, [range.from, range.to, market])

  const fmt = useFmtMoney()

  if (loading) return <div className="text-center py-16 text-gray-400">Đang tải…</div>
  if (!data) return <div className="text-center py-16 text-gray-400">Không có dữ liệu</div>

  const maxDay = Math.max(...(data.by_day ?? []).map((d: any) => d.orders), 1)
  const maxRev  = Math.max(...(data.by_day ?? []).map((d: any) => d.revenue), 1)

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <KpiCard label="Đơn thành công" value={fmtNum(data.success_count)}
          sub={`/ ${fmtNum(data.total_orders)} tổng đơn`}
          delta={data.prev ? pctDelta(data.success_count, data.prev.success_count) : null} />
        <KpiCard label="Doanh thu COD" value={fmt(data.total_revenue)}
          sub="gồm mọi trạng thái"
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
          <h3 className="font-semibold text-gray-700 mb-4">Đơn hàng theo ngày</h3>
          <div className="max-h-80 overflow-y-auto space-y-1.5">
            {(data.by_day ?? []).map((d: any) => (
              <div key={d.date} className="flex items-center gap-2 text-xs">
                <span className="text-gray-400 w-16 flex-shrink-0">{d.date.slice(5)}</span>
                <div className="flex-1 relative h-5">
                  <div className="absolute inset-y-0 left-0 bg-blue-100 rounded"
                    style={{ width: `${Math.round(d.revenue / maxRev * 100)}%` }} />
                  <div className="absolute inset-y-0 left-0 bg-blue-500 rounded opacity-80"
                    style={{ width: `${Math.round(d.orders / maxDay * 100)}%` }} />
                  <span className="absolute inset-y-0 flex items-center pl-2 text-white text-xs z-10">
                    {d.orders} đơn
                  </span>
                </div>
                <span className="text-gray-400 w-20 text-right flex-shrink-0">{fmt(d.revenue)}</span>
              </div>
            ))}
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
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b text-xs text-gray-500">
            <tr>
              <th className="text-left px-4 py-2.5">NV MKT</th>
              <th className="text-right px-4 py-2.5">Doanh số</th>
              <th className="text-right px-4 py-2.5">LNG thực</th>
              <th className="text-right px-4 py-2.5">%LNG</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r: any) => {
              const lng = r.lng_thuc ?? r.lng ?? 0
              return (
                <tr key={r.mkt_name}>
                  <td className="px-4 py-2.5 font-medium">{r.mkt_name}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-green-700">{fmt(r.revenue_total)}</td>
                  <td className={`px-4 py-2.5 text-right font-semibold ${lng >= 0 ? "text-violet-700" : "text-red-500"}`}>{fmt(lng)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-500">{r.lng_pct != null ? `${r.lng_pct}%` : "—"}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
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
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b text-xs text-gray-500">
            <tr>
              <th className="text-left px-4 py-2.5">Sản phẩm</th>
              <th className="text-right px-4 py-2.5">SL</th>
              <th className="text-right px-4 py-2.5">Doanh số</th>
              <th className="text-right px-4 py-2.5">%</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((p: any) => {
              const pct = totalRev > 0 ? Math.round(Number(p.revenue) / totalRev * 100) : 0
              return (
                <tr key={p.name}>
                  <td className="px-4 py-2.5 font-medium max-w-[220px] truncate" title={p.name}>{p.name}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{fmtNum(p.qty)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-green-700">{fmt(p.revenue)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-500">{pct}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ---- Doanh số theo sàn: TikTok vs Shopee (bảng đơn giản, không cần biểu đồ theo ngày phức tạp) ----
const PLATFORM_COLORS: Record<string, string> = { TikTok: "#000000", Shopee: "#ee4d2d" }
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
          <tbody className="divide-y">
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
            className="border rounded-lg px-2 py-1 text-xs bg-white">
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
          <tbody className="divide-y">
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
          <tbody className="divide-y">
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
            <tbody className="divide-y">
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
            <tbody className="divide-y">
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
      <div className="px-5 py-3 border-b flex items-center justify-between">
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
            <tbody className="divide-y divide-gray-100">
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
      <div className="px-5 py-3 border-b flex items-center justify-between">
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
            <tbody className="divide-y divide-gray-100">
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
            className="border rounded-lg px-3 py-1.5 text-sm" />
        )}
        {perfData && (
          <span className="text-sm text-gray-400">
            {perfData.summary?.total_orders} đơn · {perfData.summary?.total_confirmed} lên kho · {perfData.summary?.overall_confirm_rate}%
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
                      { label: "Lên kho", v: confirmed, pct: Math.round(confirmed / total * 100), color: "bg-green-500" },
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
                  {["Sale","Tổng","Còn chờ","KNM 1","KNM 2","KNM 3+","Lên kho","Hủy","Tỷ lệ"].map(h => (
                    <th key={h} className="px-4 py-2.5 font-semibold text-gray-600 text-left last:text-right">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {perfData.sales.map((s: any) => (
                  <tr key={s.sale_name} className={s.no_action > 3 ? "bg-red-50/60" : ""}>
                    <td className="px-4 py-2.5 font-semibold">{s.sale_name}</td>
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
        </>
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

  const cols: { key: string; label: string; pct?: boolean }[] = [
    { key: "da_nhan", label: "Đã nhận" },
    { key: "da_hoan", label: "Đã hoàn" },
    { key: "dang_hoan", label: "Đang hoàn" },
    { key: "da_huy", label: "Đã huỷ" },
    { key: "don_nhap_trung", label: "Nháp/trùng hủy" },
    { key: "da_gui_hang", label: "Đã gửi hàng" },
    { key: "moi", label: "Mới" },
    { key: "cho_hang", label: "Chờ hàng" },
    { key: "da_xac_nhan", label: "Đã xác nhận" },
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
      <div className="px-5 py-3 border-b flex items-center justify-between">
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
            <tbody className="divide-y divide-gray-100">
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
      <div className="px-5 py-3 border-b flex items-center justify-between">
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
            <tbody className="divide-y divide-gray-100">
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
}

function LngTab({ range, market }: { range: DateRange; market: Market }) {
  const [data, setData] = useState<{ rows: LngRow[]; totals: any; mapped_pct: number; cost_mapped: number; cost_total: number; not_supported?: boolean } | null>(null)
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
  type Cell = { val: string; cls?: string }
  const buildCells = (row: LngRow): Cell[] => {
    if (sub === "thuc") {
      return [
        { val: money(row.revenue_total) },
        { val: money(row.revenue_delivered) },
        { val: money(row.cogs) },
        { val: pctStr(row.cogs_pct), cls: "text-gray-400" },
        { val: money(row.ship_cost), cls: "text-amber-700" },
        { val: pctStr(row.ship_pct), cls: "text-gray-400" },
        { val: money(row.ads_cost) },
        { val: pctStr(row.ads_pct), cls: "text-gray-400" },
        { val: money(row.fullfill) },
        { val: pctStr(row.fullfill_pct), cls: "text-gray-400" },
        { val: money(row.lng_thuc ?? row.lng), cls: `font-bold ${(row.lng_thuc ?? row.lng) >= 0 ? "text-green-600" : "text-red-600"}` },
        { val: pctStr(row.lng_pct), cls: (row.lng_pct ?? 0) >= 0 ? "text-green-600" : "text-red-600" },
      ]
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
        <td key={i} className={`px-3 py-2 text-sm text-right tabular-nums ${c.cls ?? "text-gray-700"}`}>{c.val}</td>
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
        { label: "Fullfill", key: "fullfill" },
        { label: "%FF", key: "fullfill_pct" },
        { label: "LNG THỰC", key: "lng_thuc" },
        { label: "%LNG", key: "lng_pct" },
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
    } as LngRow
  })() : null

  const subBtn = (key: "thuc" | "tam_tinh", label: string) => (
    <button onClick={() => { setSub(key); setSortKey(key === "thuc" ? "lng_thuc" : "lng_tam_tinh"); setSortDir("desc") }}
      className={`px-3 py-1 text-xs rounded-md font-medium ${sub === key ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
      {label}
    </button>
  )

  return (
    <div className="bg-white border rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b flex items-center justify-between">
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
            <tbody className="divide-y divide-gray-100">
              {totalRow && renderRow(totalRow, true)}
              {visibleRows.map(r => renderRow(r))}
            </tbody>
          </table>
        </div>
      )}
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
              <tbody className="divide-y divide-gray-100">
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
              <tbody className="divide-y divide-gray-100">
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
              <tbody className="divide-y divide-gray-100">
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

// ---- Main Page ----
type TabKey = "overview" | "shipping" | "product" | "sale" | "nv-mkt" | "lng" | "errors" | "marketing"

const VALID_TABS: TabKey[] = ["overview", "shipping", "product", "sale", "nv-mkt", "lng", "errors", "marketing"]

const BaoCaoPage = () => {
  const initParams = getSearchParams()
  const initTab = (VALID_TABS.includes(initParams.get("tab") as TabKey) ? initParams.get("tab") : "overview") as TabKey
  const initRange: DateRange = (initParams.get("from") && initParams.get("to"))
    ? { from: initParams.get("from")!, to: initParams.get("to")! }
    : thisMonthRange()

  const initMarket = (initParams.get("market") === "MY" ? "MY" : "VN") as Market

  const [tab, setTab] = useState<TabKey>(initTab)
  const [range, setRange] = useState<DateRange>(initRange)
  const [market, setMarket] = useState<Market>(initMarket)
  const [currencyMode, setCurrencyMode] = useState<CurrencyMode>("MYR")
  const [myrRate, setMyrRate] = useState<number>(5800)

  function changeTab(t: TabKey) {
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

  const tabs: { key: TabKey; label: string; icon: string }[] = [
    { key: "overview",  label: "Tổng quan",   icon: "📊" },
    { key: "shipping",  label: "Vận đơn",     icon: "🚚" },
    { key: "product",   label: "Sản phẩm & Lợi nhuận", icon: "💰" },
    { key: "sale",      label: "Sale & Funnel", icon: "🎯" },
    { key: "nv-mkt",   label: "NV MKT",        icon: "📦" },
    { key: "lng",       label: "LNG theo MKT", icon: "💵" },
    { key: "errors",    label: "Đơn lỗi",      icon: "⚠️" },
    { key: "marketing", label: "MKT",          icon: "📣" },
  ]

  return (
    <div className="p-6 max-w-7xl">
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Báo cáo</h1>
          <p className="text-gray-400 text-sm mt-0.5">Dashboard quản lý · dữ liệu từ Pancake POS</p>
        </div>
      </div>

      {/* Period selector + Market selector */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PeriodSelector range={range} onChange={changeRange} />
        <select value={market} onChange={e => changeMarket(e.target.value as Market)}
          className="border rounded-lg px-3 py-1.5 text-sm font-medium bg-white">
          <option value="VN">🇻🇳 Việt Nam</option>
          <option value="MY">🇲🇾 Malaysia (TikTok)</option>
        </select>
        {market === "MY" && (
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            <button onClick={() => setCurrencyMode("MYR")}
              className={`px-2 py-1 text-xs rounded ${currencyMode === "MYR" ? "bg-white shadow font-semibold" : "text-gray-500"}`}>MYR</button>
            <button onClick={() => setCurrencyMode("VND")}
              className={`px-2 py-1 text-xs rounded ${currencyMode === "VND" ? "bg-white shadow font-semibold" : "text-gray-500"}`}>VND (quy đổi)</button>
          </div>
        )}
        {market === "MY" && (
          <ExchangeRateEditor month={range.to.slice(0, 7)} rate={myrRate} onSaved={setMyrRate} />
        )}
      </div>

      {/* AI Summary */}
      <AISummaryBlock range={range} />

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-gray-200 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.key} onClick={() => changeTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
              tab === t.key
                ? "text-violet-600 border-b-2 border-violet-600 bg-violet-50/50"
                : "text-gray-500 hover:text-gray-700 border-b-2 border-transparent"
            }`}>
            <span className="mr-1.5">{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      <CurrencyCtx.Provider value={{ market, currencyMode, rate: myrRate }}>
        {tab === "overview"  && <OverviewTab range={range} market={market} onRate={setMyrRate} />}
        {tab === "shipping"  && <ShippingTab range={range} market={market} />}
        {tab === "product"   && <ProductTab range={range} market={market} />}
        {tab === "sale"      && <SaleTab range={range} market={market} />}
        {tab === "nv-mkt"   && <NvMktTab range={range} market={market} />}
        {tab === "lng"      && <LngTab range={range} market={market} />}
        {tab === "errors"   && <ErrorsTab range={range} market={market} />}
      </CurrencyCtx.Provider>
      {tab === "marketing" && (
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