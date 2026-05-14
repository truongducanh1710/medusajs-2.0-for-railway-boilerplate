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
  // month is 1-indexed for display, 0-indexed for Date
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

// ---- CSS bar chart ----

function BarChart({ data }: { data: Array<{ date: string; orders: number; revenue: number }> }) {
  const maxOrders = Math.max(...data.map((d) => d.orders), 1)
  const maxRevenue = Math.max(...data.map((d) => d.revenue), 1)

  return (
    <div className="space-y-2">
      {data.map((d) => {
        const pct = Math.round((d.orders / maxOrders) * 100)
        const revPct = Math.round((d.revenue / maxRevenue) * 100)
        const dateLabel = d.date.slice(5) // MM-DD
        return (
          <div key={d.date} className="flex items-center gap-2">
            <span className="text-xs text-gray-500 w-12 text-right flex-shrink-0">
              {dateLabel}
            </span>
            <div className="flex-1 relative h-5">
              {/* Revenue bar (lighter, behind) */}
              <div
                className="absolute inset-y-0 left-0 bg-blue-100 rounded"
                style={{ width: `${revPct}%` }}
              />
              {/* Orders bar (darker, on top) */}
              <div
                className="absolute inset-y-0 left-0 bg-blue-500 rounded opacity-80"
                style={{ width: `${pct}%` }}
              />
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

// ---- Component ----

const BaoCaoPage = () => {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1) // 1-12
  const [report, setReport] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<"overview" | "source" | "product" | "sale">("overview")
  const [perfDate, setPerfDate] = useState(todayVN)
  const [perfData, setPerfData] = useState<any>(null)
  const [perfLoading, setPerfLoading] = useState(false)

  const fetchPerf = async (date: string) => {
    setPerfLoading(true)
    try {
      const res = await apiFetch(`/admin/pancake-sync/report/sale-performance?date=${date}`)
      if (!res.ok) throw new Error(`Lỗi ${res.status}`)
      setPerfData(await res.json())
    } catch {
      setPerfData(null)
    } finally {
      setPerfLoading(false)
    }
  }

  useEffect(() => { if (view === "sale") fetchPerf(perfDate) }, [view, perfDate])

  const fetchReport = async (y: number, m: number) => {
    setLoading(true)
    setError(null)
    try {
      const { from, to } = getMonthRange(y, m)
      const res = await apiFetch(
        `/admin/pancake-sync/report?from=${encodeURIComponent(toISO(from))}&to=${encodeURIComponent(toISO(to))}`
      )
      if (!res.ok) throw new Error(`Lỗi ${res.status}`)
      const data = await res.json()
      setReport(data)
    } catch (err: any) {
      setError(err.message)
      setReport(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchReport(year, month) }, [year, month])

  const months = Array.from({ length: 12 }, (_, i) => i + 1)
  const currentYear = now.getFullYear()
  const years = [currentYear - 1, currentYear, currentYear + 1]

  return (
    <div className="p-6 max-w-6xl">
      <h1 className="text-2xl font-bold mb-2">Báo cáo doanh thu</h1>
      <p className="text-gray-500 text-sm mb-6">
        Số liệu từ Pancake POS, đồng bộ qua pancake_order.
      </p>

      {/* Month/Year picker */}
      <div className="flex items-center gap-3 mb-6">
        <select
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          {months.map((m) => (
            <option key={m} value={m}>Tháng {m}</option>
          ))}
        </select>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <span className="text-sm text-gray-400">
          {report ? `${report.total_orders} đơn · ${formatCompact(report.total_revenue)}` : ""}
        </span>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400">Đang tải báo cáo...</div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      ) : report ? (
        <>
          {/* Stats cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <div className="text-3xl font-bold text-gray-900">{report.total_orders}</div>
              <div className="text-sm text-gray-500 mt-1">Tổng đơn</div>
              <div className="text-xs text-gray-400 mt-0.5">
                {report.success_count} thành công · {report.cancel_count} hủy
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <div className="text-3xl font-bold text-green-700">
                {formatCompact(report.total_revenue)}
              </div>
              <div className="text-sm text-gray-500 mt-1">Doanh thu</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <div className="text-3xl font-bold text-blue-700">{report.success_rate}%</div>
              <div className="text-sm text-gray-500 mt-1">Tỷ lệ thành công</div>
              <div className="text-xs text-gray-400 mt-0.5">
                {report.success_count}/{report.total_orders} đơn
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <div className="text-3xl font-bold text-purple-700">{report.return_rate}%</div>
              <div className="text-sm text-gray-500 mt-1">Tỷ lệ hoàn</div>
              <div className="text-xs text-gray-400 mt-0.5">
                {report.return_count} đơn hoàn
              </div>
            </div>
          </div>

          {/* View tabs */}
          <div className="flex gap-2 mb-4 border-b border-gray-200 pb-2">
            {([
              { key: "overview", label: "Tổng quan theo ngày" },
              { key: "source", label: "Theo nguồn" },
              { key: "product", label: "Top sản phẩm" },
              { key: "sale", label: "Hiệu suất Sale" },
            ] as const).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setView(tab.key)}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                  view === tab.key
                    ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50/50"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Overview: bar chart + by-day table */}
          {view === "overview" && (
            <div className="space-y-6">
              {/* Bar chart */}
              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <h2 className="font-semibold text-gray-700 mb-4">Đơn hàng theo ngày</h2>
                {report.by_day?.length > 0 ? (
                  <div className="max-h-96 overflow-y-auto">
                    <BarChart data={report.by_day} />
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">Không có dữ liệu</p>
                )}
              </div>

              {/* By day table */}
              {report.by_day?.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="text-left px-4 py-2 font-semibold text-gray-600">Ngày</th>
                        <th className="text-right px-4 py-2 font-semibold text-gray-600">Đơn</th>
                        <th className="text-right px-4 py-2 font-semibold text-gray-600">Doanh thu</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {report.by_day.map((d: any) => (
                        <tr key={d.date}>
                          <td className="px-4 py-2 text-gray-700">{d.date}</td>
                          <td className="px-4 py-2 text-right font-mono text-gray-900">{d.orders}</td>
                          <td className="px-4 py-2 text-right font-semibold text-gray-900">
                            {formatVND(d.revenue)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Source breakdown */}
          {view === "source" && (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Nguồn</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600">Đơn</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600">Doanh thu</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600">Tỷ trọng</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {report.by_source?.map((s: any) => {
                    const pct =
                      report.total_revenue > 0
                        ? Math.round((s.revenue / report.total_revenue) * 100)
                        : 0
                    return (
                      <tr key={s.source}>
                        <td className="px-4 py-2.5">
                          <span className="font-semibold text-gray-800">
                            {sourceLabel(s.source)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-gray-900">
                          {s.orders}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-gray-900">
                          {formatVND(s.revenue)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-blue-500 rounded-full"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-500 w-8">{pct}%</span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Hiệu suất Sale */}
          {view === "sale" && (
            <div className="space-y-4">
              {/* Date picker riêng cho tab này */}
              <div className="flex items-center gap-3">
                <input
                  type="date"
                  value={perfDate}
                  onChange={(e) => setPerfDate(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                <button
                  onClick={() => fetchPerf(perfDate)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition-colors"
                >
                  🔄 Làm mới
                </button>
                {perfData && (
                  <span className="text-sm text-gray-400">
                    {perfData.summary.total_orders} đơn · {perfData.summary.total_confirmed} xác nhận · tỷ lệ {perfData.summary.overall_confirm_rate}%
                  </span>
                )}
              </div>

              {perfLoading ? (
                <div className="text-center py-12 text-gray-400">Đang tải...</div>
              ) : !perfData || perfData.sales.length === 0 ? (
                <div className="text-center py-12 text-gray-400">Không có dữ liệu cho ngày này</div>
              ) : (
                <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Sale</th>
                        <th className="text-center px-3 py-3 font-semibold text-gray-600">Tổng</th>
                        <th className="text-center px-3 py-3 font-semibold text-gray-600">Chưa t/đ</th>
                        <th className="text-center px-3 py-3 font-semibold text-gray-600">Đã gọi</th>
                        <th className="text-center px-3 py-3 font-semibold text-gray-600">KNM 1</th>
                        <th className="text-center px-3 py-3 font-semibold text-gray-600">KNM 2</th>
                        <th className="text-center px-3 py-3 font-semibold text-gray-600">KNM 3+</th>
                        <th className="text-center px-3 py-3 font-semibold text-gray-600">Xác nhận</th>
                        <th className="text-center px-3 py-3 font-semibold text-gray-600">Hủy</th>
                        <th className="text-right px-4 py-3 font-semibold text-gray-600">Tỷ lệ XN</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {perfData.sales.map((s: any) => {
                        const needsPush = s.no_action > 3
                        const isGood = s.confirm_rate >= 30 && s.total >= 3
                        const isBad = s.confirm_rate < 10 && s.total >= 5
                        return (
                          <tr key={s.sale_name} className={needsPush ? "bg-red-50/60" : ""}>
                            <td className="px-4 py-3 font-semibold text-gray-800">{s.sale_name}</td>
                            <td className="px-3 py-3 text-center font-mono text-gray-700">{s.total}</td>
                            <td className={`px-3 py-3 text-center font-mono font-semibold ${s.no_action > 3 ? "text-red-600" : s.no_action > 0 ? "text-orange-500" : "text-gray-400"}`}>
                              {s.no_action}
                              {s.overdue > 0 && <span className="text-xs ml-1">⏰</span>}
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
                              {s.confirm_rate}%
                              {isGood && " ✓"}
                              {isBad && s.total >= 5 && " ↓"}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot className="bg-gray-50 border-t border-gray-200">
                      <tr>
                        <td className="px-4 py-2 font-semibold text-gray-600">Tổng cộng</td>
                        <td className="px-3 py-2 text-center font-mono font-semibold">{perfData.summary.total_orders}</td>
                        <td className="px-3 py-2 text-center font-mono text-red-600 font-semibold">
                          {perfData.sales.reduce((s: number, x: any) => s + x.no_action, 0)}
                        </td>
                        <td className="px-3 py-2 text-center font-mono">
                          {perfData.sales.reduce((s: number, x: any) => s + x.called, 0)}
                        </td>
                        <td className="px-3 py-2 text-center font-mono text-yellow-700">
                          {perfData.sales.reduce((s: number, x: any) => s + x.knm_1, 0)}
                        </td>
                        <td className="px-3 py-2 text-center font-mono text-orange-600">
                          {perfData.sales.reduce((s: number, x: any) => s + x.knm_2, 0)}
                        </td>
                        <td className="px-3 py-2 text-center font-mono text-red-600 font-bold">
                          {perfData.sales.reduce((s: number, x: any) => s + x.knm_3_plus, 0)}
                        </td>
                        <td className="px-3 py-2 text-center font-mono text-green-700 font-semibold">
                          {perfData.summary.total_confirmed}
                        </td>
                        <td className="px-3 py-2 text-center font-mono text-gray-400">
                          {perfData.sales.reduce((s: number, x: any) => s + x.cancelled, 0)}
                        </td>
                        <td className="px-4 py-2 text-right font-semibold text-gray-700">
                          {perfData.summary.overall_confirm_rate}%
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Top products */}
          {view === "product" && (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 w-10">#</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Sản phẩm</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600">SL đã bán</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600">Doanh thu</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {report.by_product?.map((p: any, i: number) => (
                    <tr key={p.name}>
                      <td className="px-4 py-2.5 text-gray-400 font-mono text-xs">
                        {i + 1}
                      </td>
                      <td className="px-4 py-2.5 font-semibold text-gray-800 max-w-xs truncate">
                        {p.name}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-gray-900">
                        {p.qty}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold text-gray-900">
                        {formatVND(p.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Báo cáo",
})

export default BaoCaoPage
