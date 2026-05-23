import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useState, useEffect, useCallback } from "react"
import { apiFetch } from "../../lib/api-client"

function fmtMoney(n: number): string {
  return n.toLocaleString("vi-VN") + "đ"
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}`
}

const MKT_ORDER = ["KIENLB", "ANHNT", "XUANLT", "NAMDV", "DUPD", "LINHMT"]

function getThisMonthRange() {
  const now = new Date()
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`
  const to = now.toISOString().slice(0, 10)
  return { from, to }
}

export default function BaoCaoMktPage() {
  const { from: defaultFrom, to: defaultTo } = getThisMonthRange()
  const [from, setFrom] = useState(defaultFrom)
  const [to, setTo] = useState(defaultTo)
  const [groupBy, setGroupBy] = useState<"day" | "month">("day")
  const [rows, setRows] = useState<any[]>([])
  const [summary, setSummary] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)
  const [mktNames, setMktNames] = useState<string[]>([])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch(
        `/admin/pancake-sync/report/mkt?from=${from}&to=${to}&group_by=${groupBy}`
      )
      const data = await res.json()
      setRows(data.rows ?? [])
      setSummary(data.summary ?? {})
      // Sort MKT names: ưu tiên thứ tự chuẩn, còn lại append sau
      const names = Object.keys(data.summary ?? {})
      const sorted = [
        ...MKT_ORDER.filter(m => names.includes(m)),
        ...names.filter(m => !MKT_ORDER.includes(m) && m !== "KHÁC"),
        ...(names.includes("KHÁC") ? ["KHÁC"] : []),
      ]
      setMktNames(sorted)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [from, to, groupBy])

  useEffect(() => { fetchData() }, [fetchData])

  // Group rows by date
  const byDate: Record<string, Record<string, any>> = {}
  for (const row of rows) {
    const d = row.date
    if (!byDate[d]) byDate[d] = {}
    byDate[d][row.mkt_name] = row
  }
  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a))

  const totalRevenue = Object.values(summary).reduce((s: number, m: any) => s + (m.revenue_delivered || 0), 0)

  return (
    <div style={{ padding: "24px 32px", background: "#0f0f1a", minHeight: "100vh", color: "#f9fafb" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Doanh số theo MKT</h1>
          <div style={{ fontSize: 12, color: "#6b7280" }}>Đơn Webcake · nhóm theo UTM campaign</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            style={{ background: "#1a1a2e", border: "1px solid #374151", borderRadius: 6, padding: "6px 10px", color: "#f9fafb", fontSize: 13 }} />
          <span style={{ color: "#6b7280" }}>→</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            style={{ background: "#1a1a2e", border: "1px solid #374151", borderRadius: 6, padding: "6px 10px", color: "#f9fafb", fontSize: 13 }} />
          <select value={groupBy} onChange={e => setGroupBy(e.target.value as any)}
            style={{ background: "#1a1a2e", border: "1px solid #374151", borderRadius: 6, padding: "6px 10px", color: "#f9fafb", fontSize: 13 }}>
            <option value="day">Theo ngày</option>
            <option value="month">Theo tháng</option>
          </select>
          <button onClick={fetchData} disabled={loading} style={{
            background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 6,
            padding: "8px 16px", cursor: loading ? "not-allowed" : "pointer", fontSize: 13, opacity: loading ? 0.6 : 1
          }}>
            {loading ? "Đang tải..." : "↻ Refresh"}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <div style={{ background: "#1a1a2e", border: "1px solid #2d2d44", borderRadius: 8, padding: "10px 20px", minWidth: 140 }}>
          <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>Tổng doanh số giao</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#34d399" }}>{fmtMoney(totalRevenue)}</div>
        </div>
        {mktNames.filter(m => m !== "KHÁC").map(mkt => {
          const s = summary[mkt] || {}
          return (
            <div key={mkt} style={{ background: "#1a1a2e", border: "1px solid #2d2d44", borderRadius: 8, padding: "10px 20px", minWidth: 140 }}>
              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>{mkt}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#60a5fa" }}>{fmtMoney(s.revenue_delivered || 0)}</div>
              <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
                {s.delivered || 0} giao / {s.total_orders || 0} tổng
              </div>
            </div>
          )
        })}
      </div>

      {/* Table: rows = dates, cols = MKT */}
      {rows.length === 0 && !loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "#6b7280" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
          <div>Không có dữ liệu trong khoảng thời gian này</div>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #374151", color: "#9ca3af" }}>
                <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap" }}>Ngày</th>
                {mktNames.map(mkt => (
                  <th key={mkt} style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600, whiteSpace: "nowrap", color: mkt === "KHÁC" ? "#6b7280" : "#f9fafb" }}>
                    {mkt}
                  </th>
                ))}
                <th style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600, color: "#34d399" }}>TỔNG</th>
              </tr>
            </thead>
            <tbody>
              {dates.map(date => {
                const dayTotal = mktNames.reduce((s, m) => s + Number(byDate[date][m]?.revenue_delivered || 0), 0)
                return (
                  <tr key={date} style={{ borderBottom: "1px solid #1f2937" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#111827")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    <td style={{ padding: "10px 12px", color: "#d1d5db", fontWeight: 600 }}>
                      {groupBy === "month" ? date.slice(0, 7) : fmtDate(date)}
                    </td>
                    {mktNames.map(mkt => {
                      const cell = byDate[date][mkt]
                      return (
                        <td key={mkt} style={{ padding: "10px 12px", textAlign: "right" }}>
                          {cell ? (
                            <div>
                              <div style={{ color: "#34d399", fontWeight: 600 }}>
                                {fmtMoney(Number(cell.revenue_delivered))}
                              </div>
                              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                                {cell.delivered}✓ {cell.pending > 0 && <span style={{ color: "#f59e0b" }}>{cell.pending}⏳</span>} {cell.cancelled > 0 && <span style={{ color: "#f87171" }}>{cell.cancelled}✗</span>}
                              </div>
                            </div>
                          ) : (
                            <span style={{ color: "#374151" }}>—</span>
                          )}
                        </td>
                      )
                    })}
                    <td style={{ padding: "10px 12px", textAlign: "right", color: "#34d399", fontWeight: 700 }}>
                      {fmtMoney(dayTotal)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {/* Footer summary */}
            <tfoot>
              <tr style={{ borderTop: "2px solid #374151", background: "#111827" }}>
                <td style={{ padding: "10px 12px", fontWeight: 700, color: "#f9fafb" }}>TỔNG</td>
                {mktNames.map(mkt => {
                  const s = summary[mkt] || {}
                  return (
                    <td key={mkt} style={{ padding: "10px 12px", textAlign: "right" }}>
                      <div style={{ color: "#34d399", fontWeight: 700 }}>{fmtMoney(s.revenue_delivered || 0)}</div>
                      <div style={{ fontSize: 11, color: "#6b7280" }}>{s.delivered || 0} đơn</div>
                    </td>
                  )
                })}
                <td style={{ padding: "10px 12px", textAlign: "right", color: "#34d399", fontWeight: 700 }}>
                  {fmtMoney(totalRevenue)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Doanh số MKT",
})
