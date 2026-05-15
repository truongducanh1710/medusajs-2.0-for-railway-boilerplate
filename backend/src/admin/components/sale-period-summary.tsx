import { useEffect, useState } from "react"
import { apiFetch } from "../lib/api-client"

function formatVND(n: number) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}tỷ`
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}tr`
  if (n >= 1_000)         return `${(n / 1_000).toFixed(0)}k`
  return new Intl.NumberFormat("vi-VN").format(Math.round(n)) + "đ"
}

type Range = "7d" | "14d" | "30d"

type SaleRow = {
  sale_name: string
  total: number
  confirmed: number
  cancelled: number
  no_action: number
  knm_1: number
  knm_2: number
  knm_3_plus: number
  confirm_rate: number
  revenue: number
  avg_per_day: number
}

type ApiResponse = {
  from: string
  to: string
  day_count: number
  sales: SaleRow[]
  summary: {
    total_orders: number
    total_confirmed: number
    total_cancelled: number
    total_knm: number
    total_no_action: number
    total_revenue: number
    overall_confirm_rate: number
    avg_orders_per_day: number
  }
}

/**
 * Block "Tổng kết X ngày" cho sale xem hiệu suất gần đây.
 * Dùng chung ở /xac-nhan-don và /uu-tien-goi.
 */
export default function SalePeriodSummary({ defaultSeller = "" }: { defaultSeller?: string }) {
  const [range, setRange] = useState<Range>("7d")
  const [seller, setSeller] = useState(defaultSeller)
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(true)

  useEffect(() => { setSeller(defaultSeller) }, [defaultSeller])

  useEffect(() => {
    if (!expanded) return
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams({ range })
    if (seller) params.set("seller", seller)
    apiFetch(`/admin/pancake-sync/report/sale-performance?${params}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (!cancelled) setData(d) })
      .catch(() => { if (!cancelled) setData(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [range, seller, expanded])

  // Sort by confirmed DESC để sale top hiện trước
  const sales = data?.sales ? [...data.sales].sort((a, b) => b.confirmed - a.confirmed) : []
  const filteredSales = seller ? sales.filter((s) => s.sale_name === seller) : sales

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b">
        <button
          onClick={() => setExpanded((e) => !e)}
          className="text-sm font-semibold text-gray-700 hover:text-gray-900 flex items-center gap-1.5"
        >
          <span className="text-xs">{expanded ? "▼" : "▶"}</span>
          📊 Tổng kết hiệu suất
        </button>

        <div className="flex gap-1 border rounded-lg p-0.5 bg-gray-50">
          {(["7d", "14d", "30d"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                range === r ? "bg-white shadow-sm font-semibold text-gray-800" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {r === "7d" ? "7 ngày" : r === "14d" ? "14 ngày" : "30 ngày"}
            </button>
          ))}
        </div>

        {data && (
          <span className="text-xs text-gray-500">
            {data.from} → {data.to} · TB {data.summary.avg_orders_per_day} đơn/ngày
          </span>
        )}

        {seller && (
          <span className="ml-auto text-xs bg-violet-50 text-violet-700 border border-violet-200 rounded-full px-2 py-0.5">
            Chỉ xem: <b>{seller}</b>
            <button onClick={() => setSeller("")} className="ml-1 hover:bg-violet-100 rounded-full px-1">×</button>
          </span>
        )}
      </div>

      {expanded && (
        <>
          {loading ? (
            <div className="text-center py-6 text-gray-400 text-sm">Đang tải...</div>
          ) : !data || data.summary.total_orders === 0 ? (
            <div className="text-center py-6 text-gray-400 text-sm">Không có dữ liệu</div>
          ) : (
            <>
              {/* KPI cards */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-4 border-b">
                <div>
                  <div className="text-xs text-gray-500 uppercase tracking-wide">Tổng đơn</div>
                  <div className="text-2xl font-bold mt-0.5">{data.summary.total_orders.toLocaleString("vi-VN")}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 uppercase tracking-wide">Lên kho</div>
                  <div className="text-2xl font-bold mt-0.5 text-green-700">{data.summary.total_confirmed.toLocaleString("vi-VN")}</div>
                  <div className="text-xs text-gray-400">{data.summary.overall_confirm_rate}%</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 uppercase tracking-wide">Hủy/Hoàn</div>
                  <div className="text-2xl font-bold mt-0.5 text-red-600">{data.summary.total_cancelled.toLocaleString("vi-VN")}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 uppercase tracking-wide">Chưa tác động</div>
                  <div className="text-2xl font-bold mt-0.5 text-orange-600">{data.summary.total_no_action.toLocaleString("vi-VN")}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 uppercase tracking-wide">Doanh thu</div>
                  <div className="text-2xl font-bold mt-0.5 text-blue-700">{formatVND(data.summary.total_revenue)}</div>
                </div>
              </div>

              {/* Table per sale */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium text-gray-600">Sale</th>
                      <th className="text-center px-3 py-2 font-medium text-gray-600">Tổng</th>
                      <th className="text-center px-3 py-2 font-medium text-gray-600">TB/ngày</th>
                      <th className="text-center px-3 py-2 font-medium text-gray-600">Lên kho</th>
                      <th className="text-center px-3 py-2 font-medium text-gray-600">Hủy</th>
                      <th className="text-center px-3 py-2 font-medium text-gray-600">Chưa tác động</th>
                      <th className="text-center px-3 py-2 font-medium text-gray-600">KNM</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">Tỷ lệ chốt</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">Doanh thu</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredSales.map((s) => {
                      const isGood = s.confirm_rate >= 30 && s.total >= 5
                      const isBad = s.confirm_rate < 10 && s.total >= 10
                      return (
                        <tr key={s.sale_name} className="hover:bg-gray-50">
                          <td className="px-4 py-2 font-semibold">
                            <button
                              onClick={() => setSeller(seller === s.sale_name ? "" : s.sale_name)}
                              className={`hover:underline ${seller === s.sale_name ? "text-violet-600" : ""}`}
                              title="Click để lọc theo sale này"
                            >
                              {s.sale_name}
                            </button>
                          </td>
                          <td className="px-3 py-2 text-center font-mono">{s.total}</td>
                          <td className="px-3 py-2 text-center font-mono text-gray-500">{s.avg_per_day}</td>
                          <td className="px-3 py-2 text-center font-mono text-green-700 font-semibold">{s.confirmed || "—"}</td>
                          <td className="px-3 py-2 text-center font-mono text-red-600">{s.cancelled || "—"}</td>
                          <td className={`px-3 py-2 text-center font-mono ${s.no_action > 5 ? "text-red-600 font-bold" : "text-orange-500"}`}>
                            {s.no_action || "—"}
                          </td>
                          <td className="px-3 py-2 text-center font-mono text-yellow-700">
                            {(s.knm_1 + s.knm_2 + s.knm_3_plus) || "—"}
                          </td>
                          <td className={`px-4 py-2 text-right font-semibold ${
                            isGood ? "text-green-600" : isBad ? "text-red-500" : "text-gray-700"
                          }`}>
                            {s.confirm_rate}%{isGood && " ✓"}{isBad && " ↓"}
                          </td>
                          <td className="px-4 py-2 text-right font-semibold text-blue-700">
                            {s.revenue > 0 ? formatVND(s.revenue) : "—"}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
