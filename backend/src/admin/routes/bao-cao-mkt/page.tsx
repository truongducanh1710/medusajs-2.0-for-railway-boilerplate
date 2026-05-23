import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useState, useEffect, useCallback } from "react"
import { apiFetch } from "../../lib/api-client"

function fmtMoney(n: number): string {
  return n.toLocaleString("vi-VN") + "đ"
}

function fmtDate(iso: string): string {
  const parts = iso.slice(0, 10).split("-")
  return `${parts[2]}/${parts[1]}`
}

function carePctColor(pct: number | null): string {
  if (pct === null) return "#6b7280"
  if (pct < 30) return "#16a34a"
  if (pct <= 35) return "#d97706"
  return "#dc2626"
}

const MKT_ORDER = ["KIENLB", "ANHNT", "XUANLT", "NAMDV", "DUPD", "LINHMT", "NGUYEN MAI"]

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
  const [syncing, setSyncing] = useState(false)
  const [mktNames, setMktNames] = useState<string[]>([])
  const [cronStatus, setCronStatus] = useState<any>(null)
  const [dark, setDark] = useState(true)
  const [activeTab, setActiveTab] = useState<"mkt" | "camp">("mkt")
  const [campRows, setCampRows] = useState<any[]>([])
  const [campMktFilter, setCampMktFilter] = useState<string>("")
  const [campLoading, setCampLoading] = useState(false)

  // Theme tokens
  const t = dark ? {
    bg: "#0f0f1a", card: "#1a1a2e", cardBorder: "#2d2d44",
    text: "#f9fafb", textMuted: "#6b7280", textSub: "#9ca3af",
    rowHover: "#111827", rowBorder: "#1f2937", thead: "#374151",
    inputBg: "#1a1a2e", inputBorder: "#374151", inputText: "#f9fafb",
    tfoot: "#111827", theadText: "#9ca3af", empty: "#374151",
    green: "#34d399", blue: "#60a5fa", purple: "#818cf8",
    red: "#f87171", amber: "#f59e0b", cronBg: "#111827",
  } : {
    bg: "#f1f5f9", card: "#ffffff", cardBorder: "#cbd5e1",
    text: "#0f172a", textMuted: "#475569", textSub: "#334155",
    rowHover: "#e2e8f0", rowBorder: "#cbd5e1", thead: "#94a3b8",
    inputBg: "#ffffff", inputBorder: "#94a3b8", inputText: "#0f172a",
    tfoot: "#e2e8f0", theadText: "#1e293b", empty: "#94a3b8",
    green: "#15803d", blue: "#1d4ed8", purple: "#6d28d9",
    red: "#b91c1c", amber: "#b45309", cronBg: "#e2e8f0",
  }

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch(`/admin/pancake-sync/report/mkt?from=${from}&to=${to}&group_by=${groupBy}`)
      const data = await res.json()
      setRows(data.rows ?? [])
      setSummary(data.summary ?? {})
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

  const syncCost = useCallback(async () => {
    setSyncing(true)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const res = await apiFetch("/admin/pancake-sync/report/mkt-cost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: today }),
      })
      const data = await res.json()
      if (data.ok) {
        alert(`✓ Đã sync ${data.synced} campaigns cho ngày ${data.date}`)
        await fetchData()
      } else {
        alert("Lỗi sync: " + (data.error ?? "unknown"))
      }
    } catch (e: any) {
      alert("Lỗi: " + e.message)
    } finally {
      setSyncing(false)
    }
  }, [fetchData])

  const fetchCronStatus = useCallback(async () => {
    try {
      const res = await apiFetch("/admin/pancake-sync/report/mkt-cost-status")
      const data = await res.json()
      setCronStatus(data)
    } catch { /* ignore */ }
  }, [])

  const fetchCampData = useCallback(async () => {
    setCampLoading(true)
    try {
      const mktParam = campMktFilter ? `&mkt=${campMktFilter}` : ""
      const res = await apiFetch(`/admin/pancake-sync/report/mkt-campaign?from=${from}&to=${to}${mktParam}`)
      const data = await res.json()
      setCampRows(data.rows ?? [])
    } catch (e) {
      console.error(e)
    } finally {
      setCampLoading(false)
    }
  }, [from, to, campMktFilter])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => { if (activeTab === "camp") fetchCampData() }, [activeTab, fetchCampData])
  useEffect(() => {
    fetchCronStatus()
    const interval = setInterval(fetchCronStatus, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetchCronStatus])

  const byDate: Record<string, Record<string, any>> = {}
  for (const row of rows) {
    const d = row.date
    if (!byDate[d]) byDate[d] = {}
    byDate[d][row.mkt_name] = row
  }
  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a))

  const totalRevenue = Object.values(summary).reduce((s: number, m: any) => s + (m.revenue_total || 0), 0)
  const totalCost = Object.values(summary).reduce((s: number, m: any) => s + (m.ads_cost || 0), 0)
  const totalCarePct = totalRevenue > 0 ? Math.round(totalCost / totalRevenue * 10000) / 100 : null

  return (
    <div style={{ padding: "24px 32px", background: t.bg, minHeight: "100vh", color: t.text, transition: "background 0.2s, color 0.2s" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>COD theo MKT</h1>
          <div style={{ fontSize: 12, color: t.textMuted }}>Đơn Webcake · Chi phí Facebook Ads</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 6, padding: "6px 10px", color: t.inputText, fontSize: 13 }} />
          <span style={{ color: t.textMuted }}>→</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 6, padding: "6px 10px", color: t.inputText, fontSize: 13 }} />
          <select value={groupBy} onChange={e => setGroupBy(e.target.value as any)}
            style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 6, padding: "6px 10px", color: t.inputText, fontSize: 13 }}>
            <option value="day">Theo ngày</option>
            <option value="month">Theo tháng</option>
          </select>
          <button onClick={() => setDark(d => !d)} style={{
            background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: 6,
            padding: "8px 12px", cursor: "pointer", fontSize: 13, color: t.text
          }}>
            {dark ? "☀ Sáng" : "☾ Tối"}
          </button>
          <button onClick={fetchData} disabled={loading} style={{
            background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 6,
            padding: "8px 16px", cursor: loading ? "not-allowed" : "pointer", fontSize: 13, opacity: loading ? 0.6 : 1
          }}>
            {loading ? "Đang tải..." : "↻ Refresh"}
          </button>
          <button onClick={syncCost} disabled={syncing} style={{
            background: dark ? "#065f46" : "#d1fae5", color: t.green, border: `1px solid ${t.green}44`, borderRadius: 6,
            padding: "8px 16px", cursor: syncing ? "not-allowed" : "pointer", fontSize: 13, opacity: syncing ? 0.6 : 1
          }}>
            {syncing ? "Đang sync..." : "↓ Sync chi phí hôm nay"}
          </button>
        </div>
      </div>

      {/* Cron Status Bar */}
      {cronStatus && (() => {
        const s = cronStatus
        const color = s.status === "ok" ? t.green : s.status === "warning" ? t.amber : s.status === "error" ? t.red : t.textMuted
        const icon = s.status === "ok" ? "●" : s.status === "warning" ? "⚠" : s.status === "error" ? "✕" : "○"
        const label = s.status === "ok" ? "Cron đang hoạt động" : s.status === "warning" ? "Cron chậm" : s.status === "error" ? "Cron có thể bị lỗi" : "Chưa có data"
        const lastTime = s.last_updated
          ? new Date(s.last_updated).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
          : "—"
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12, background: t.cronBg, borderRadius: 8, padding: "8px 16px", fontSize: 12, flexWrap: "wrap" }}>
            <span style={{ color, fontWeight: 700 }}>{icon} {label}</span>
            <span style={{ color: t.textMuted }}>Sync lần cuối: <span style={{ color: t.text }}>{lastTime}</span> ({s.minutes_ago !== null ? `${s.minutes_ago} phút trước` : "—"})</span>
            <span style={{ color: t.textMuted }}>Hôm nay: <span style={{ color: t.blue }}>{s.campaigns_today} campaigns</span> · <span style={{ color: t.purple }}>{s.accounts_with_data}/{s.accounts_active} accounts</span></span>
            {s.missing_accounts > 0 && (
              <span style={{ color: t.red }}>⚠ {s.missing_accounts} account chưa có data hôm nay</span>
            )}
          </div>
        )
      })()}

      {/* Tab toggle */}
      <div style={{ display: "flex", gap: 0, marginBottom: 16, borderBottom: `1px solid ${t.cardBorder}` }}>
        {(["mkt", "camp"] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            background: "none", border: "none", cursor: "pointer",
            padding: "8px 20px", fontSize: 14, fontWeight: activeTab === tab ? 700 : 400,
            color: activeTab === tab ? t.blue : t.textMuted,
            borderBottom: activeTab === tab ? `2px solid ${t.blue}` : "2px solid transparent",
            marginBottom: -1,
          }}>
            {tab === "mkt" ? "Theo MKT" : "Theo Camp"}
          </button>
        ))}
      </div>

      {/* Summary cards */}
      <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: 8, padding: "10px 20px", minWidth: 150 }}>
          <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 4 }}>Tổng COD</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: t.green }}>{fmtMoney(totalRevenue)}</div>
          {totalCost > 0 && (
            <>
              <div style={{ fontSize: 12, color: t.amber, marginTop: 2 }}>Chi phí: {fmtMoney(totalCost)}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: carePctColor(totalCarePct), marginTop: 2 }}>
                % Care: {totalCarePct !== null ? totalCarePct + "%" : "—"}
              </div>
            </>
          )}
        </div>
        {mktNames.filter(m => m !== "KHÁC").map(mkt => {
          const s = summary[mkt] || {}
          const pct = s.care_pct ?? null
          return (
            <div key={mkt} style={{ background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: 8, padding: "10px 20px", minWidth: 150 }}>
              <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 4 }}>{mkt}</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: t.blue }}>{fmtMoney(s.revenue_total || 0)}</div>
              <div style={{ fontSize: 11, marginTop: 2 }}>
                <span style={{ color: t.green }}>{s.delivered || 0} giao</span>
                {" · "}
                <span style={{ color: t.blue }}>{s.new_orders || 0} chờ</span>
                {" · "}
                <span style={{ color: t.purple }}>{s.confirmed || 0} xác nhận</span>
                {" · "}
                <span style={{ color: t.red }}>{s.cancelled || 0} hủy</span>
              </div>
              {(s.ads_cost || 0) > 0 && (
                <>
                  <div style={{ fontSize: 11, color: t.amber, marginTop: 3 }}>Chi phí: {fmtMoney(s.ads_cost || 0)}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: carePctColor(pct), marginTop: 1 }}>
                    {pct !== null ? pct + "%" : "—"}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>

      {/* Camp tab content */}
      {activeTab === "camp" && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
            <select value={campMktFilter} onChange={e => setCampMktFilter(e.target.value)}
              style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 6, padding: "6px 10px", color: t.inputText, fontSize: 13 }}>
              <option value="">Tất cả MKT</option>
              {[...MKT_ORDER, ...mktNames.filter(m => !MKT_ORDER.includes(m) && m !== "KHÁC")].map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <button onClick={fetchCampData} disabled={campLoading} style={{
              background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 6,
              padding: "8px 16px", cursor: campLoading ? "not-allowed" : "pointer", fontSize: 13, opacity: campLoading ? 0.6 : 1
            }}>
              {campLoading ? "Đang tải..." : "↻ Refresh"}
            </button>
          </div>
          {campRows.length === 0 && !campLoading ? (
            <div style={{ textAlign: "center", padding: 60, color: t.textMuted }}>Không có dữ liệu</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid ${t.thead}`, color: t.theadText }}>
                    <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600 }}>Campaign</th>
                    <th style={{ padding: "10px 12px", textAlign: "center", fontWeight: 600 }}>MKT</th>
                    <th style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600 }}>Spend</th>
                    <th style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600 }}>Impressions</th>
                    <th style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600 }}>Clicks</th>
                    <th style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600 }}>Đơn</th>
                    <th style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600 }}>COD tổng</th>
                    <th style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600 }}>COD giao</th>
                    <th style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600 }}>% Care</th>
                  </tr>
                </thead>
                <tbody>
                  {campRows.map((row: any) => (
                    <tr key={row.campaign_id} style={{ borderBottom: `1px solid ${t.rowBorder}` }}
                      onMouseEnter={e => (e.currentTarget.style.background = t.rowHover)}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                    >
                      <td style={{ padding: "10px 12px", color: t.text, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        title={row.campaign_name}>
                        {row.campaign_name}
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "center", color: t.blue, fontWeight: 600 }}>{row.mkt_name || "KHÁC"}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", color: t.amber, fontWeight: 600 }}>{fmtMoney(Number(row.spend))}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", color: t.textMuted }}>{Number(row.impressions).toLocaleString("vi-VN")}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", color: t.textMuted }}>{Number(row.clicks).toLocaleString("vi-VN")}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right" }}>
                        <span style={{ color: t.green }}>{row.delivered}&#10003;</span>
                        {" · "}
                        <span style={{ color: t.red }}>{row.cancelled}&#10007;</span>
                        {row.total_orders > 0 && <div style={{ fontSize: 10, color: t.textMuted }}>{row.total_orders} tổng</div>}
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "right", color: t.green, fontWeight: 600 }}>{fmtMoney(Number(row.cod_total))}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", color: t.green }}>{fmtMoney(Number(row.cod_delivered))}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: carePctColor(row.care_pct) }}>
                        {row.care_pct !== null ? row.care_pct + "%" : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: `2px solid ${t.thead}`, background: t.tfoot }}>
                    <td colSpan={2} style={{ padding: "10px 12px", fontWeight: 700, color: t.text }}>TỔNG</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: t.amber, fontWeight: 700 }}>
                      {fmtMoney(campRows.reduce((s: number, r: any) => s + Number(r.spend), 0))}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: t.textMuted }}>
                      {campRows.reduce((s: number, r: any) => s + Number(r.impressions), 0).toLocaleString("vi-VN")}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: t.textMuted }}>
                      {campRows.reduce((s: number, r: any) => s + Number(r.clicks), 0).toLocaleString("vi-VN")}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: t.green }}>
                      {campRows.reduce((s: number, r: any) => s + Number(r.total_orders), 0)} đơn
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: t.green, fontWeight: 700 }}>
                      {fmtMoney(campRows.reduce((s: number, r: any) => s + Number(r.cod_total), 0))}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: t.green }}>
                      {fmtMoney(campRows.reduce((s: number, r: any) => s + Number(r.cod_delivered), 0))}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: carePctColor((() => {
                      const totalSpend = campRows.reduce((s: number, r: any) => s + Number(r.spend), 0)
                      const totalCod = campRows.reduce((s: number, r: any) => s + Number(r.cod_total), 0)
                      return totalCod > 0 ? Math.round(totalSpend / totalCod * 10000) / 100 : null
                    })()) }}>
                      {(() => {
                        const totalSpend = campRows.reduce((s: number, r: any) => s + Number(r.spend), 0)
                        const totalCod = campRows.reduce((s: number, r: any) => s + Number(r.cod_total), 0)
                        const pct = totalCod > 0 ? Math.round(totalSpend / totalCod * 10000) / 100 : null
                        return pct !== null ? pct + "%" : "—"
                      })()}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === "mkt" && (rows.length === 0 && !loading ? (
        <div style={{ textAlign: "center", padding: 60, color: t.textMuted }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
          <div>Không có dữ liệu trong khoảng thời gian này</div>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${t.thead}`, color: t.theadText }}>
                <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap" }}>Ngày</th>
                {mktNames.map(mkt => (
                  <th key={mkt} style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600, whiteSpace: "nowrap", color: mkt === "KHÁC" ? t.textMuted : t.text }}>
                    {mkt}
                  </th>
                ))}
                <th style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600, color: t.green }}>TỔNG</th>
              </tr>
            </thead>
            <tbody>
              {dates.map(date => {
                const dayRevenue = mktNames.reduce((s, m) => s + Number(byDate[date][m]?.revenue_total || 0), 0)
                const dayCost = mktNames.reduce((s, m) => s + Number(byDate[date][m]?.ads_cost || 0), 0)
                const dayCarePct = dayRevenue > 0 && dayCost > 0 ? Math.round(dayCost / dayRevenue * 10000) / 100 : null
                return (
                  <tr key={date} style={{ borderBottom: `1px solid ${t.rowBorder}` }}
                    onMouseEnter={e => (e.currentTarget.style.background = t.rowHover)}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    <td style={{ padding: "10px 12px", color: t.text, fontWeight: 600 }}>
                      {groupBy === "month" ? date.slice(0, 7) : fmtDate(date)}
                    </td>
                    {mktNames.map(mkt => {
                      const cell = byDate[date][mkt]
                      const pct = cell?.care_pct ?? null
                      return (
                        <td key={mkt} style={{ padding: "10px 12px", textAlign: "right" }}>
                          {cell ? (
                            <div>
                              <div style={{ color: t.green, fontWeight: 600 }}>
                                {fmtMoney(Number(cell.revenue_total))}
                              </div>
                              <div style={{ fontSize: 11, marginTop: 2 }}>
                                <span style={{ color: t.green }}>{cell.delivered ?? 0}&#10003;</span>
                                {" · "}
                                <span style={{ color: t.blue }}>{cell.new_orders ?? 0}&#9675;</span>
                                {" · "}
                                <span style={{ color: t.purple }}>{cell.confirmed ?? 0}&#9654;</span>
                                {" · "}
                                <span style={{ color: t.red }}>{cell.cancelled ?? 0}&#10007;</span>
                              </div>
                              {Number(cell.ads_cost) > 0 && (
                                <div style={{ fontSize: 11, marginTop: 2 }}>
                                  <span style={{ color: t.amber }}>{fmtMoney(Number(cell.ads_cost))}</span>
                                  {" · "}
                                  <span style={{ color: carePctColor(pct), fontWeight: 600 }}>
                                    {pct !== null ? pct + "%" : "—"}
                                  </span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <span style={{ color: t.empty }}>—</span>
                          )}
                        </td>
                      )
                    })}
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>
                      <div style={{ color: t.green, fontWeight: 700 }}>{fmtMoney(dayRevenue)}</div>
                      {dayCost > 0 && (
                        <div style={{ fontSize: 11, marginTop: 2 }}>
                          <span style={{ color: t.amber }}>{fmtMoney(dayCost)}</span>
                          {" · "}
                          <span style={{ color: carePctColor(dayCarePct), fontWeight: 600 }}>
                            {dayCarePct !== null ? dayCarePct + "%" : "—"}
                          </span>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: `2px solid ${t.thead}`, background: t.tfoot }}>
                <td style={{ padding: "10px 12px", fontWeight: 700, color: t.text }}>TỔNG</td>
                {mktNames.map(mkt => {
                  const s = summary[mkt] || {}
                  const pct = s.care_pct ?? null
                  return (
                    <td key={mkt} style={{ padding: "10px 12px", textAlign: "right" }}>
                      <div style={{ color: t.green, fontWeight: 700 }}>{fmtMoney(s.revenue_total || 0)}</div>
                      <div style={{ fontSize: 11, color: t.textMuted }}>{s.delivered || 0} đơn</div>
                      {(s.ads_cost || 0) > 0 && (
                        <div style={{ fontSize: 11, marginTop: 2 }}>
                          <span style={{ color: t.amber }}>{fmtMoney(s.ads_cost || 0)}</span>
                          {" · "}
                          <span style={{ color: carePctColor(pct), fontWeight: 600 }}>
                            {pct !== null ? pct + "%" : "—"}
                          </span>
                        </div>
                      )}
                    </td>
                  )
                })}
                <td style={{ padding: "10px 12px", textAlign: "right" }}>
                  <div style={{ color: t.green, fontWeight: 700 }}>{fmtMoney(totalRevenue)}</div>
                  {totalCost > 0 && (
                    <div style={{ fontSize: 11, marginTop: 2 }}>
                      <span style={{ color: t.amber }}>{fmtMoney(totalCost)}</span>
                      {" · "}
                      <span style={{ color: carePctColor(totalCarePct), fontWeight: 600 }}>
                        {totalCarePct !== null ? totalCarePct + "%" : "—"}
                      </span>
                    </div>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ))}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Doanh số MKT",
})
