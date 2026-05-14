import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useEffect, useState } from "react"
import { apiFetch } from "../../lib/api-client"

// ---- Helpers ----

function formatVND(amount: number) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(amount)) + "đ"
}

function formatCompact(amount: number): string {
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(1)}tỷ`
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}tr`
  return formatVND(amount)
}

function getMonthRange(year: number, month: number): { from: Date; to: Date } {
  const from = new Date(year, month - 1, 1)
  const to = new Date(year, month, 0, 23, 59, 59)
  return { from, to }
}

function toISO(d: Date): string {
  return d.toISOString()
}

function todayVN(): string {
  const d = new Date()
  const vn = new Date(d.getTime() + 7 * 3600 * 1000)
  return vn.toISOString().slice(0, 10)
}

// ---- Source labels ----

const SOURCE_LABELS: Record<string, string> = {
  medusa: "Website",
  facebook: "Facebook",
  zalo: "Zalo",
  tiktok: "TikTok",
  shopee: "Shopee",
  manual: "Thủ công",
  unknown: "Khác",
}

function sourceLabel(src: string): string {
  return SOURCE_LABELS[src] ?? src
}

// ---- Delta badge ----

function DeltaBadge({ value, suffix = "%" }: { value: number | null; suffix?: string }) {
  if (value === null) return <span className="text-xs text-gray-400">—</span>
  const sign = value > 0 ? "↑" : value < 0 ? "↓" : "="
  const cls =
    value > 0 ? "text-green-600" :
    value < 0 ? "text-red-600" : "text-gray-400"
  return (
    <span className={`text-xs font-medium ${cls}`}>
      {sign} {Math.abs(value)}{suffix}
    </span>
  )
}

// ---- CSS bar chart ----

function BarChart({ data }: { data: Array<{ date: string; orders: number; revenue: number }> }) {
  const maxOrders = Math.max(...data.map((d) => d.orders), 1)
  const maxRevenue = Math.max(...data.map((d) => d.revenue), 1)

  return (
    <div className="space-y-2">
      {data.map((d) => {
        const pct = Math.round((d.orders / maxOrders) * 100)
        const revPct = Math.round((d.revenue / maxRevenue) * 100)
        const dateLabel = d.date.slice(5)
        return (
          <div key={d.date} className="flex items-center gap-2">
            <span className="text-xs text-gray-500 w-12 text-right flex-shrink-0">
              {dateLabel}
            </span>
            <div className="flex-1 relative h-5">
              <div className="absolute inset-y-0 left-0 bg-blue-100 rounded" style={{ width: `${revPct}%` }} />
              <div className="absolute inset-y-0 left-0 bg-blue-500 rounded opacity-80" style={{ width: `${pct}%` }} />
              <span className="absolute inset-y-0 left-0 flex items-center pl-2 text-xs font-mono text-white z-10">
                {d.orders} đơn
              </span>
            </div>
            <span className="text-xs text-gray-400 w-24 text-right flex-shrink-0">
              {formatCompact(d.revenue)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ---- Mini 7d chart ----

function Mini7dChart({ data }: { data: Array<{ date: string; orders: number; confirm_rate: number }> }) {
  if (!data?.length) return null
  const maxOrders = Math.max(...data.map((d) => d.orders), 1)
  return (
    <div className="flex items-end gap-1 h-32">
      {data.map((d) => {
        const h = Math.round((d.orders / maxOrders) * 100)
        return (
          <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full flex-1 flex items-end">
              <div
                className="w-full bg-blue-500 rounded-t hover:bg-blue-600 transition-colors"
                style={{ height: `${h}%` }}
                title={`${d.date}: ${d.orders} đơn · ${d.confirm_rate}% chốt`}
              />
            </div>
            <div className="text-xs text-gray-500">{d.date.slice(8)}</div>
            <div className="text-xs font-mono text-gray-700">{d.orders}</div>
          </div>
        )
      })}
    </div>
  )
}

// ---- Component ----

type TabKey = "dashboard" | "funnel" | "shipping" | "revenue" | "marketing"

const BaoCaoPage = () => {
  const now = new Date()
  const [view, setView] = useState<TabKey>("dashboard")

  // Dashboard
  const [dashDate, setDashDate] = useState(todayVN)
  const [dash, setDash] = useState<any>(null)
  const [dashLoading, setDashLoading] = useState(false)

  // Revenue tab (month-based, dùng /report)
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [report, setReport] = useState<any>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState<string | null>(null)

  // Funnel/Sale tab
  const [perfDate, setPerfDate] = useState(todayVN)
  const [perfData, setPerfData] = useState<any>(null)
  const [perfLoading, setPerfLoading] = useState(false)

  const fetchDashboard = async (date: string) => {
    setDashLoading(true)
    try {
      const res = await apiFetch(`/admin/pancake-sync/report/dashboard?date=${date}`)
      if (!res.ok) throw new Error(`Lỗi ${res.status}`)
      setDash(await res.json())
    } catch {
      setDash(null)
    } finally {
      setDashLoading(false)
    }
  }

  const fetchReport = async (y: number, m: number) => {
    setReportLoading(true); setReportError(null)
    try {
      const { from, to } = getMonthRange(y, m)
      const res = await apiFetch(
        `/admin/pancake-sync/report?from=${encodeURIComponent(toISO(from))}&to=${encodeURIComponent(toISO(to))}`
      )
      if (!res.ok) throw new Error(`Lỗi ${res.status}`)
      setReport(await res.json())
    } catch (err: any) {
      setReportError(err.message); setReport(null)
    } finally { setReportLoading(false) }
  }

  const fetchPerf = async (date: string) => {
    setPerfLoading(true)
    try {
      const res = await apiFetch(`/admin/pancake-sync/report/sale-performance?date=${date}`)
      if (!res.ok) throw new Error(`Lỗi ${res.status}`)
      setPerfData(await res.json())
    } catch {
      setPerfData(null)
    } finally { setPerfLoading(false) }
  }

  useEffect(() => { if (view === "dashboard") fetchDashboard(dashDate) }, [view, dashDate])
  useEffect(() => { if (view === "revenue")   fetchReport(year, month) }, [view, year, month])
  useEffect(() => { if (view === "funnel")    fetchPerf(perfDate) }, [view, perfDate])

  const months = Array.from({ length: 12 }, (_, i) => i + 1)
  const currentYear = now.getFullYear()
  const years = [currentYear - 1, currentYear, currentYear + 1]

  const tabs: Array<{ key: TabKey; label: string; icon: string }> = [
    { key: "dashboard", label: "Dashboard",   icon: "📊" },
    { key: "funnel",    label: "Funnel & Sale", icon: "🎯" },
    { key: "shipping",  label: "Vận đơn",     icon: "🚚" },
    { key: "revenue",   label: "Doanh thu & Sản phẩm", icon: "💰" },
    { key: "marketing", label: "Marketing ROI", icon: "📣" },
  ]

  return (
    <div className="p-6 max-w-7xl">
      <h1 className="text-2xl font-bold mb-2">Báo cáo</h1>
      <p className="text-gray-500 text-sm mb-6">
        Bảng điều khiển vận hành cho lead — dữ liệu từ Pancake POS.
      </p>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setView(tab.key)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
              view === tab.key
                ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50/50"
                : "text-gray-500 hover:text-gray-700 border-b-2 border-transparent"
            }`}
          >
            <span className="mr-1.5">{tab.icon}</span>{tab.label}
          </button>
        ))}
      </div>

      {/* ===================== TAB 1: DASHBOARD ===================== */}
      {view === "dashboard" && (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <input
              type="date"
              value={dashDate}
              onChange={(e) => setDashDate(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <button
              onClick={() => fetchDashboard(dashDate)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
            >
              🔄 Làm mới
            </button>
            {dash && (
              <span className="text-xs text-gray-400">
                So sánh với hôm trước · dữ liệu thời gian thực
              </span>
            )}
          </div>

          {dashLoading ? (
            <div className="text-center py-16 text-gray-400">Đang tải...</div>
          ) : !dash ? (
            <div className="text-center py-16 text-gray-400">Không có dữ liệu</div>
          ) : (
            <>
              {/* KPI Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white border rounded-xl p-5 shadow-sm">
                  <div className="text-xs text-gray-500 uppercase tracking-wide">Đơn vào</div>
                  <div className="text-3xl font-bold mt-1">{dash.kpis.orders_today}</div>
                  <div className="mt-1"><DeltaBadge value={dash.kpis.orders_delta} /></div>
                </div>
                <div className="bg-white border rounded-xl p-5 shadow-sm">
                  <div className="text-xs text-gray-500 uppercase tracking-wide">Doanh thu (chốt)</div>
                  <div className="text-3xl font-bold text-green-700 mt-1">{formatCompact(dash.kpis.revenue_today)}</div>
                  <div className="mt-1"><DeltaBadge value={dash.kpis.revenue_delta} /></div>
                </div>
                <div className="bg-white border rounded-xl p-5 shadow-sm">
                  <div className="text-xs text-gray-500 uppercase tracking-wide">Tỉ lệ chốt</div>
                  <div className="text-3xl font-bold text-blue-700 mt-1">{dash.kpis.confirm_rate_today}%</div>
                  <div className="mt-1"><DeltaBadge value={dash.kpis.confirm_rate_delta_pp} suffix="pp" /></div>
                </div>
                <div className={`border rounded-xl p-5 shadow-sm ${dash.kpis.overdue_count > 0 ? "bg-red-50 border-red-200" : "bg-white"}`}>
                  <div className="text-xs text-gray-500 uppercase tracking-wide">Đơn quá 24h</div>
                  <div className={`text-3xl font-bold mt-1 ${dash.kpis.overdue_count > 0 ? "text-red-600" : "text-gray-400"}`}>
                    {dash.kpis.overdue_count}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">chưa gọi</div>
                </div>
              </div>

              {/* Alerts */}
              {(dash.alerts.overdue.count > 0 || dash.alerts.sale_drops.length > 0) && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-2">
                  <div className="font-semibold text-red-700 flex items-center gap-2">
                    ⚠️ Cần xử lý ngay
                  </div>
                  {dash.alerts.overdue.count > 0 && (
                    <div className="text-sm text-red-700">
                      <span className="font-semibold">{dash.alerts.overdue.count} đơn</span> quá 24h chưa gọi
                      {dash.alerts.overdue.by_sale.length > 0 && (
                        <span className="text-red-600/80">
                          {" — "}{dash.alerts.overdue.by_sale.slice(0, 5).map((s: any) => `${s.sale_name}: ${s.count}`).join(", ")}
                        </span>
                      )}
                      <a href="/app/uu-tien-goi" className="ml-2 underline font-medium">→ Mở Bảng ưu tiên</a>
                    </div>
                  )}
                  {dash.alerts.sale_drops.map((s: any) => (
                    <div key={s.sale_name} className="text-sm text-red-700">
                      Sale <span className="font-semibold">{s.sale_name}</span> hôm nay chốt {s.today_rate}% — thấp hơn TB tuần ({s.week_rate}%) · {s.today_orders} đơn
                    </div>
                  ))}
                </div>
              )}

              {/* Mini chart + Quick links */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2 bg-white border rounded-xl p-5 shadow-sm">
                  <h3 className="font-semibold text-gray-700 mb-3">Đơn vào 7 ngày gần nhất</h3>
                  <Mini7dChart data={dash.mini_chart} />
                </div>
                <div className="bg-white border rounded-xl p-5 shadow-sm space-y-2">
                  <h3 className="font-semibold text-gray-700 mb-2">Truy cập nhanh</h3>
                  <a href="/app/uu-tien-goi" className="block px-3 py-2 rounded-lg hover:bg-violet-50 text-sm border">
                    🎯 Ưu tiên gọi <span className="float-right text-violet-600 font-semibold">{dash.quick.priority_count}</span>
                  </a>
                  <a href="/app/xac-nhan-don" className="block px-3 py-2 rounded-lg hover:bg-blue-50 text-sm border">
                    ✅ Xác nhận đơn
                  </a>
                  <a href="/app/don-hang" className="block px-3 py-2 rounded-lg hover:bg-gray-50 text-sm border">
                    📋 Tất cả đơn hàng
                  </a>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ===================== TAB 2: FUNNEL & SALE ===================== */}
      {view === "funnel" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <input
              type="date"
              value={perfDate}
              onChange={(e) => setPerfDate(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm"
            />
            <button onClick={() => fetchPerf(perfDate)} className="px-3 py-2 border rounded-lg text-sm hover:bg-gray-50">
              🔄 Làm mới
            </button>
            {perfData && (
              <span className="text-sm text-gray-400">
                {perfData.summary.total_orders} đơn · {perfData.summary.total_confirmed} lên kho · {perfData.summary.overall_confirm_rate}%
              </span>
            )}
          </div>

          {/* Funnel viz đơn giản */}
          {perfData && perfData.summary.total_orders > 0 && (
            <div className="bg-white border rounded-xl p-5 shadow-sm">
              <h3 className="font-semibold text-gray-700 mb-4">Funnel ngày {perfDate}</h3>
              {(() => {
                const total = perfData.summary.total_orders
                const knm   = perfData.sales.reduce((s: number, x: any) => s + x.knm_1 + x.knm_2 + x.knm_3_plus + x.called, 0)
                const confirmed = perfData.summary.total_confirmed
                const cancelled = perfData.sales.reduce((s: number, x: any) => s + x.cancelled, 0)
                const stages = [
                  { label: "Đơn vào", value: total, pct: 100 },
                  { label: "Đã liên hệ", value: knm, pct: Math.round(knm / total * 100) },
                  { label: "Lên kho (chốt)", value: confirmed, pct: Math.round(confirmed / total * 100) },
                  { label: "Hủy/Hoàn", value: cancelled, pct: Math.round(cancelled / total * 100) },
                ]
                return (
                  <div className="space-y-2">
                    {stages.map((s, i) => (
                      <div key={s.label} className="flex items-center gap-3">
                        <div className="w-32 text-sm text-gray-600 flex-shrink-0">{s.label}</div>
                        <div className="flex-1 relative h-8 bg-gray-100 rounded">
                          <div
                            className={`absolute inset-y-0 left-0 rounded ${
                              i === 0 ? "bg-blue-500" :
                              i === 1 ? "bg-blue-400" :
                              i === 2 ? "bg-green-500" : "bg-gray-400"
                            }`}
                            style={{ width: `${Math.max(s.pct, 2)}%` }}
                          />
                          <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-xs font-mono text-white z-10">
                            {s.value} ({s.pct}%)
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>
          )}

          {/* Bảng sale */}
          {perfLoading ? (
            <div className="text-center py-12 text-gray-400">Đang tải...</div>
          ) : !perfData || perfData.sales.length === 0 ? (
            <div className="text-center py-12 text-gray-400">Không có dữ liệu cho ngày này</div>
          ) : (
            <div className="bg-white border rounded-xl shadow-sm overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Sale</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-600">Tổng</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-600">Còn chờ</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-600">Đã gọi</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-600">KNM 1</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-600">KNM 2</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-600">KNM 3+</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-600">Lên kho</th>
                    <th className="text-center px-3 py-3 font-semibold text-gray-600">Hủy</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600">Tỷ lệ lên kho</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {perfData.sales.map((s: any) => {
                    const needsPush = s.no_action > 3
                    const isGood = s.confirm_rate >= 30 && s.total >= 3
                    const isBad = s.confirm_rate < 10 && s.total >= 5
                    return (
                      <tr key={s.sale_name} className={needsPush ? "bg-red-50/60" : ""}>
                        <td className="px-4 py-3 font-semibold">{s.sale_name}</td>
                        <td className="px-3 py-3 text-center font-mono">{s.total}</td>
                        <td className={`px-3 py-3 text-center font-mono font-semibold ${s.no_action > 3 ? "text-red-600" : s.no_action > 0 ? "text-orange-500" : "text-gray-400"}`}>
                          {s.no_action}{s.overdue > 0 && <span className="text-xs ml-1">⏰</span>}
                        </td>
                        <td className="px-3 py-3 text-center font-mono text-gray-600">{s.called}</td>
                        <td className="px-3 py-3 text-center font-mono text-yellow-700">{s.knm_1 || "—"}</td>
                        <td className="px-3 py-3 text-center font-mono text-orange-600">{s.knm_2 || "—"}</td>
                        <td className="px-3 py-3 text-center font-mono font-bold text-red-600">
                          {s.knm_3_plus > 0 ? <span>{s.knm_3_plus} ⚠️</span> : "—"}
                        </td>
                        <td className="px-3 py-3 text-center font-mono text-green-700 font-semibold">{s.confirmed || "—"}</td>
                        <td className="px-3 py-3 text-center font-mono text-gray-400">{s.cancelled || "—"}</td>
                        <td className={`px-4 py-3 text-right font-semibold ${isGood ? "text-green-600" : isBad ? "text-red-500" : "text-gray-700"}`}>
                          {s.confirm_rate}%{isGood && " ✓"}{isBad && " ↓"}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ===================== TAB 3: SHIPPING (placeholder Phase 2) ===================== */}
      {view === "shipping" && (
        <div className="bg-white border rounded-xl p-8 text-center text-gray-400">
          <div className="text-4xl mb-3">🚚</div>
          <h3 className="font-semibold text-gray-600 mb-1">Vận đơn & Tỉ lệ hoàn</h3>
          <p className="text-sm">Phân tích đơn sau khi lên kho — đang giao, đã hoàn tất, hoàn hàng theo tỉnh/sale/sản phẩm.</p>
          <p className="text-xs mt-3 text-gray-400">Sẽ phát triển ở Phase 2.</p>
        </div>
      )}

      {/* ===================== TAB 4: REVENUE & PRODUCT ===================== */}
      {view === "revenue" && (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="border rounded-lg px-3 py-2 text-sm">
              {months.map((m) => <option key={m} value={m}>Tháng {m}</option>)}
            </select>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="border rounded-lg px-3 py-2 text-sm">
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <span className="text-sm text-gray-400">
              {report ? `${report.total_orders} đơn · ${formatCompact(report.total_revenue)}` : ""}
            </span>
          </div>

          {reportLoading ? (
            <div className="text-center py-16 text-gray-400">Đang tải báo cáo...</div>
          ) : reportError ? (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{reportError}</div>
          ) : report ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white border rounded-xl p-5 shadow-sm">
                  <div className="text-3xl font-bold">{report.total_orders}</div>
                  <div className="text-sm text-gray-500 mt-1">Tổng đơn</div>
                  <div className="text-xs text-gray-400">{report.success_count} thành công · {report.cancel_count} hủy</div>
                </div>
                <div className="bg-white border rounded-xl p-5 shadow-sm">
                  <div className="text-3xl font-bold text-green-700">{formatCompact(report.total_revenue)}</div>
                  <div className="text-sm text-gray-500 mt-1">Doanh thu</div>
                  <div className="text-xs text-gray-400">
                    AOV: {report.success_count > 0 ? formatCompact(report.total_revenue / report.success_count) : "—"}
                  </div>
                </div>
                <div className="bg-white border rounded-xl p-5 shadow-sm">
                  <div className="text-3xl font-bold text-blue-700">{report.success_rate}%</div>
                  <div className="text-sm text-gray-500 mt-1">Tỷ lệ thành công</div>
                </div>
                <div className="bg-white border rounded-xl p-5 shadow-sm">
                  <div className="text-3xl font-bold text-purple-700">{report.return_rate}%</div>
                  <div className="text-sm text-gray-500 mt-1">Tỷ lệ hoàn</div>
                  <div className="text-xs text-gray-400">{report.return_count} đơn hoàn</div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Bar chart by day */}
                <div className="bg-white border rounded-xl p-5 shadow-sm">
                  <h3 className="font-semibold text-gray-700 mb-3">Đơn hàng theo ngày</h3>
                  {report.by_day?.length > 0 ? (
                    <div className="max-h-96 overflow-y-auto">
                      <BarChart data={report.by_day} />
                    </div>
                  ) : <p className="text-sm text-gray-400">Không có dữ liệu</p>}
                </div>

                {/* By source */}
                <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b font-semibold text-gray-700">Theo nguồn</div>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="text-left px-4 py-2 font-semibold text-gray-600">Nguồn</th>
                        <th className="text-right px-4 py-2 font-semibold text-gray-600">Đơn</th>
                        <th className="text-right px-4 py-2 font-semibold text-gray-600">Doanh thu</th>
                        <th className="text-right px-4 py-2 font-semibold text-gray-600">%</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {report.by_source?.map((s: any) => {
                        const pct = report.total_revenue > 0 ? Math.round((s.revenue / report.total_revenue) * 100) : 0
                        return (
                          <tr key={s.source}>
                            <td className="px-4 py-2 font-semibold">{sourceLabel(s.source)}</td>
                            <td className="px-4 py-2 text-right font-mono">{s.orders}</td>
                            <td className="px-4 py-2 text-right font-semibold">{formatCompact(s.revenue)}</td>
                            <td className="px-4 py-2 text-right text-xs text-gray-500">{pct}%</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Top products */}
              <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b font-semibold text-gray-700">Top sản phẩm</div>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 w-10">#</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Sản phẩm</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">SL đã bán</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Doanh thu</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {report.by_product?.map((p: any, i: number) => (
                      <tr key={p.name}>
                        <td className="px-4 py-2.5 text-gray-400 font-mono text-xs">{i + 1}</td>
                        <td className="px-4 py-2.5 font-semibold max-w-md truncate">{p.name}</td>
                        <td className="px-4 py-2.5 text-right font-mono">{p.qty}</td>
                        <td className="px-4 py-2.5 text-right font-semibold">{formatVND(p.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* ===================== TAB 5: MARKETING (placeholder Phase 3) ===================== */}
      {view === "marketing" && (
        <div className="bg-white border rounded-xl p-8 text-center text-gray-400">
          <div className="text-4xl mb-3">📣</div>
          <h3 className="font-semibold text-gray-600 mb-1">Marketing ROI</h3>
          <p className="text-sm">Chi phí ads vs doanh thu theo nguồn — ROAS, CPA.</p>
          <p className="text-xs mt-3 text-gray-400">Sẽ phát triển ở Phase 3 (form nhập tay + MCP Meta Ads).</p>
        </div>
      )}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Báo cáo",
})

export default BaoCaoPage
