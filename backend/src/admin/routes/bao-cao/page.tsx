import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useEffect, useState, useRef } from "react"
import { apiFetch } from "../../lib/api-client"

// ---- Helpers ----
function fmtVND(n: number | null | undefined) {
  if (n == null || isNaN(Number(n))) return "—"
  const v = Number(n)
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}tỷ`
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}tr`
  return new Intl.NumberFormat("vi-VN").format(Math.round(v)) + "đ"
}
function fmtNum(n: number | null | undefined) {
  if (n == null) return "—"
  return new Intl.NumberFormat("vi-VN").format(Number(n))
}
function todayVN(): string {
  return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10)
}
function toISO(s: string, end = false): string {
  return end ? `${s}T16:59:59.999Z` : `${s}T17:00:00.000Z`
  // VN +7 → start of day VN = 17:00 UTC prev day, end of day = 16:59 UTC
}
function addDays(s: string, n: number): string {
  const d = new Date(s); d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}
function thisMonthRange() {
  const now = new Date(Date.now() + 7 * 3600000)
  const y = now.getFullYear(), m = now.getMonth() + 1
  const from = `${y}-${String(m).padStart(2,"0")}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const to = `${y}-${String(m).padStart(2,"0")}-${String(lastDay).padStart(2,"0")}`
  return { from, to }
}
function lastMonthRange() {
  const now = new Date(Date.now() + 7 * 3600000)
  let y = now.getFullYear(), m = now.getMonth()
  if (m === 0) { m = 12; y-- }
  const from = `${y}-${String(m).padStart(2,"0")}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const to = `${y}-${String(m).padStart(2,"0")}-${String(lastDay).padStart(2,"0")}`
  return { from, to }
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

function PeriodSelector({ range, onChange }: { range: DateRange; onChange: (r: DateRange) => void }) {
  const [active, setActive] = useState<Period>("month")
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

// ---- Overview Tab ----
function OverviewTab({ range }: { range: DateRange }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const from = toISO(range.from), to = toISO(range.to, true)
    apiFetch(`/admin/pancake-sync/report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .then(r => r.json()).then(setData).catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [range.from, range.to])

  if (loading) return <div className="text-center py-16 text-gray-400">Đang tải…</div>
  if (!data) return <div className="text-center py-16 text-gray-400">Không có dữ liệu</div>

  const maxDay = Math.max(...(data.by_day ?? []).map((d: any) => d.orders), 1)
  const maxRev  = Math.max(...(data.by_day ?? []).map((d: any) => d.revenue), 1)

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <KpiCard label="Đơn thành công" value={fmtNum(data.success_count)}
          sub={`/ ${fmtNum(data.total_orders)} tổng đơn`} />
        <KpiCard label="Doanh thu COD" value={fmtVND(data.total_revenue)}
          accent="border-l-4 border-l-green-400" />
        <KpiCard label="Tỷ lệ thành công" value={`${data.success_rate}%`}
          sub={`Hoàn: ${data.return_rate}%`} />
        <KpiCard label="Đơn hoàn hủy" value={fmtNum((data.return_count ?? 0) + (data.cancel_count ?? 0))}
          sub={`Hoàn ${data.return_count} · Hủy ${data.cancel_count}`}
          accent={data.return_rate > 15 ? "border-l-4 border-l-red-400" : ""} />
        <KpiCard label="AOV (giao thành công)" value={
          data.success_count > 0 ? fmtVND(data.total_revenue / data.success_count) : "—"
        } />
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
                <span className="text-gray-400 w-20 text-right flex-shrink-0">{fmtVND(d.revenue)}</span>
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
              const labels: Record<string, string> = { medusa:"Website", facebook:"Facebook", zalo:"Zalo", tiktok:"TikTok", shopee:"Shopee", manual:"Thủ công", unknown:"Khác" }
              return (
                <div key={s.source}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium text-gray-700">{labels[s.source] ?? s.source}</span>
                    <span className="text-gray-500">{s.orders} đơn · {pct}%</span>
                  </div>
                  <Bar pct={pct} color="bg-violet-500" />
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---- Shipping Tab ----
function ShippingTab({ range }: { range: DateRange }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const from = toISO(range.from), to = toISO(range.to, true)
    apiFetch(`/admin/pancake-sync/report/shipping?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .then(r => r.json()).then(setData).catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [range.from, range.to])

  if (loading) return <div className="text-center py-16 text-gray-400">Đang tải…</div>
  if (!data) return <div className="text-center py-16 text-gray-400">Không có dữ liệu</div>

  const s = data.summary
  const maxDay = Math.max(...(data.by_day ?? []).map((d: any) => Number(d.total)), 1)

  return (
    <div className="space-y-5">
      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Đang giao" value={fmtNum(s.returning_now)}
          sub={`COD chờ thu: ${fmtVND(s.returning_now_cod)}`}
          accent="border-l-4 border-l-blue-400" />
        <KpiCard label="Giao thành công" value={fmtNum(s.delivered)}
          sub={fmtVND(s.delivered_cod)}
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
function ProductTab({ range }: { range: DateRange }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const from = toISO(range.from), to = toISO(range.to, true)
    apiFetch(`/admin/pancake-sync/report/product-profit?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .then(r => r.json()).then(setData).catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [range.from, range.to])

  if (loading) return <div className="text-center py-16 text-gray-400">Đang tải…</div>
  if (!data) return <div className="text-center py-16 text-gray-400">Không có dữ liệu</div>

  const s = data.summary

  return (
    <div className="space-y-5">
      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Doanh thu" value={fmtVND(s.total_revenue)} accent="border-l-4 border-l-green-400" />
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
                    <td className="px-4 py-2.5 text-right font-semibold text-green-700">{fmtVND(p.revenue)}</td>
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
    </div>
  )
}

// ---- Sale Tab (giữ nguyên logic cũ) ----
function SaleTab({ range }: { range: DateRange }) {
  const [perfData, setPerfData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [dateOverride, setDateOverride] = useState(todayVN())
  const [useRange, setUseRange] = useState(false)

  useEffect(() => {
    setLoading(true)
    const date = useRange ? range.from : dateOverride
    apiFetch(`/admin/pancake-sync/report/sale-performance?date=${date}`)
      .then(r => r.json()).then(setPerfData).catch(() => setPerfData(null))
      .finally(() => setLoading(false))
  }, [dateOverride, useRange, range.from])

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
        </>
      )}
    </div>
  )
}

// ---- Main Page ----
type TabKey = "overview" | "shipping" | "product" | "sale" | "marketing"

const BaoCaoPage = () => {
  const [tab, setTab] = useState<TabKey>("overview")
  const [range, setRange] = useState<DateRange>(thisMonthRange())

  const tabs: { key: TabKey; label: string; icon: string }[] = [
    { key: "overview",  label: "Tổng quan",   icon: "📊" },
    { key: "shipping",  label: "Vận đơn",     icon: "🚚" },
    { key: "product",   label: "Sản phẩm & Lợi nhuận", icon: "💰" },
    { key: "sale",      label: "Sale & Funnel", icon: "🎯" },
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

      {/* Period selector */}
      <div className="mb-4">
        <PeriodSelector range={range} onChange={setRange} />
      </div>

      {/* AI Summary */}
      <AISummaryBlock range={range} />

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-gray-200 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
              tab === t.key
                ? "text-violet-600 border-b-2 border-violet-600 bg-violet-50/50"
                : "text-gray-500 hover:text-gray-700 border-b-2 border-transparent"
            }`}>
            <span className="mr-1.5">{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {tab === "overview"  && <OverviewTab range={range} />}
      {tab === "shipping"  && <ShippingTab range={range} />}
      {tab === "product"   && <ProductTab range={range} />}
      {tab === "sale"      && <SaleTab range={range} />}
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
  label: "Báo cáo",
})

export default BaoCaoPage
