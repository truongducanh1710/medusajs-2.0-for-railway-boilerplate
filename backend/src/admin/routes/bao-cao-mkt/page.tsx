import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useState, useEffect, useCallback } from "react"
import { apiFetch } from "../../lib/api-client"
import { useCurrentPermissions } from "../../lib/use-permissions"

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
  const [campDate, setCampDate] = useState(new Date().toISOString().slice(0, 10))
  const { isSuper, mktCode, has } = useCurrentPermissions()
  const canControl = has("page.bao-cao.camp-control") || isSuper
  const [editingBudget, setEditingBudget] = useState<string | null>(null)
  const [budgetValue, setBudgetValue] = useState<string>("")
  const [scheduleModalCamp, setScheduleModalCamp] = useState<any>(null)
  const [actingCampId, setActingCampId] = useState<string | null>(null)
  const [sortCol, setSortCol] = useState<string>("spend")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [filterStatus, setFilterStatus] = useState<string>("")

  const ownerOf = (camp: any) => isSuper || (canControl && mktCode === camp.mkt_name)

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
      const res = await apiFetch(`/admin/pancake-sync/report/mkt-campaign?date=${campDate}${mktParam}`)
      const data = await res.json()
      setCampRows(data.rows ?? [])
    } catch (e) {
      console.error(e)
    } finally {
      setCampLoading(false)
    }
  }, [campDate, campMktFilter])

  const toggleStatus = useCallback(async (camp: any) => {
    const action = camp.effective_status === "ACTIVE" ? "pause" : "activate"
    if (!confirm(`${action === "pause" ? "Tắt" : "Bật"} camp "${camp.campaign_name}"?`)) return
    setActingCampId(camp.campaign_id)
    try {
      const res = await apiFetch("/admin/pancake-sync/report/camp-control/toggle", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign_id: camp.campaign_id, action }),
      })
      const data = await res.json()
      if (!res.ok) { alert("Lỗi: " + (data.error || "unknown")); return }
      await fetchCampData()
    } finally { setActingCampId(null) }
  }, [fetchCampData])

  const saveBudget = useCallback(async (camp: any) => {
    const budget = Number(budgetValue)
    if (!budget || budget < 50000) { alert("Ngân sách phải >= 50.000đ"); return }
    setActingCampId(camp.campaign_id)
    try {
      const res = await apiFetch("/admin/pancake-sync/report/camp-control/budget", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign_id: camp.campaign_id, daily_budget: budget }),
      })
      const data = await res.json()
      if (!res.ok) { alert("Lỗi: " + (data.error || "unknown")); return }
      setEditingBudget(null)
      await fetchCampData()
    } finally { setActingCampId(null) }
  }, [budgetValue, fetchCampData])

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
            <input type="date" value={campDate} onChange={e => setCampDate(e.target.value)}
              style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 6, padding: "6px 10px", color: t.inputText, fontSize: 13 }} />
            <select value={campMktFilter} onChange={e => setCampMktFilter(e.target.value)}
              style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 6, padding: "6px 10px", color: t.inputText, fontSize: 13 }}>
              <option value="">Tất cả MKT</option>
              {[...MKT_ORDER, ...mktNames.filter(m => !MKT_ORDER.includes(m) && m !== "KHÁC")].map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 6, padding: "6px 10px", color: t.inputText, fontSize: 13 }}>
              <option value="">Tất cả trạng thái</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="PAUSED">PAUSED</option>
            </select>
            <button onClick={fetchCampData} disabled={campLoading} style={{
              background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 6,
              padding: "8px 16px", cursor: campLoading ? "not-allowed" : "pointer", fontSize: 13, opacity: campLoading ? 0.6 : 1
            }}>
              {campLoading ? "Đang tải..." : "↻ Refresh"}
            </button>
          </div>
          {(() => {
            const sortedCamps = [...campRows]
              .filter(r => !filterStatus || r.effective_status === filterStatus)
              .sort((a, b) => {
                const colMap: Record<string, (x: any) => number> = {
                  spend: x => Number(x.spend),
                  impressions: x => Number(x.impressions),
                  clicks: x => Number(x.clicks),
                  cpm: x => Number(x.impressions) > 0 ? Number(x.spend) / Number(x.impressions) * 1000 : 0,
                  cpc: x => Number(x.clicks) > 0 ? Number(x.spend) / Number(x.clicks) : 0,
                  cod_total: x => Number(x.cod_total),
                  care_pct: x => x.care_pct !== null ? Number(x.care_pct) : -1,
                  daily_budget: x => Number(x.daily_budget ?? 0),
                }
                const strColMap: Record<string, (x: any) => string> = {
                  effective_status: x => x.effective_status ?? "",
                  mkt_name: x => x.mkt_name ?? "",
                }
                colMap["ctr"] = x => Number(x.impressions) > 0 ? Number(x.clicks) / Number(x.impressions) * 100 : 0
                if (sortCol in strColMap) {
                  const sf = strColMap[sortCol]
                  return sortDir === "desc" ? sf(b).localeCompare(sf(a)) : sf(a).localeCompare(sf(b))
                }
                const fn = colMap[sortCol] ?? ((x: any) => Number(x.spend))
                return sortDir === "desc" ? fn(b) - fn(a) : fn(a) - fn(b)
              })
            const MKT_COLORS: Record<string, string> = {
              KIENLB: "#60a5fa", ANHNT: "#f472b6", NAMDV: "#34d399",
              XUANLT: "#fb923c", LINHMT: "#a78bfa", DUPD: "#facc15",
            }
            const mktColor = (name: string) => MKT_COLORS[name] ?? "#9ca3af"
            // Spend: đỏ nếu tiêu > 80% budget, vàng 60-80%
            const spendColor = (spd: number, budget: number) => {
              if (!budget) return t.amber
              const pct = spd / budget
              if (pct >= 0.8) return t.red
              if (pct >= 0.6) return t.amber
              return t.green
            }
            // CPM: xanh <300k, vàng 300-500k, đỏ >500k (VND)
            const cpmColor = (cpm: number | null) => {
              if (cpm === null) return t.textMuted
              if (cpm < 300000) return t.green
              if (cpm < 500000) return t.amber
              return t.red
            }
            // CPC: xanh <8k, vàng 8-15k, đỏ >15k (VND)
            const cpcColor = (cpc: number | null) => {
              if (cpc === null) return t.textMuted
              if (cpc < 8000) return t.green
              if (cpc < 15000) return t.amber
              return t.red
            }
            // CTR: xanh >5%, vàng 3-5%, đỏ <3%
            const ctrColor = (ctr: number) => {
              if (ctr >= 5) return t.green
              if (ctr >= 3) return t.amber
              return t.red
            }
            const mkSortTh = (col: string, label: string, align: "left" | "center" | "right" = "right") => (
              <th onClick={() => { if (sortCol === col) setSortDir(d => d === "desc" ? "asc" : "desc"); else { setSortCol(col); setSortDir("desc") } }}
                style={{ padding: "10px 12px", textAlign: align, fontWeight: 600, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>
                {label} <span style={{ fontSize: 10, opacity: sortCol === col ? 1 : 0.4 }}>{sortCol === col ? (sortDir === "desc" ? "▼" : "▲") : "↕"}</span>
              </th>
            )
            return (
          <>
          {sortedCamps.length === 0 && !campLoading ? (
            <div style={{ textAlign: "center", padding: 60, color: t.textMuted }}>Không có dữ liệu{filterStatus ? ` trạng thái ${filterStatus}` : ""}</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 6 }}>
                {filterStatus ? `${sortedCamps.length}/${campRows.length} camp` : `${campRows.length} camp`}
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid ${t.thead}`, color: t.theadText }}>
                    <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600 }}>Campaign</th>
                    {mkSortTh("effective_status", "Status", "center")}
                    {mkSortTh("mkt_name", "MKT", "center")}
                    {mkSortTh("daily_budget", "Budget")}
                    {mkSortTh("spend", "Spend")}
                    {mkSortTh("impressions", "Impr")}
                    {mkSortTh("clicks", "Clicks")}
                    {mkSortTh("cpm", "CPM")}
                    {mkSortTh("cpc", "CPC")}
                    {mkSortTh("ctr", "CTR%")}
                    {mkSortTh("cod_total", "COD")}
                    <th style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600 }}>Đơn</th>
                    {mkSortTh("care_pct", "% Care")}
                    {canControl && <th style={{ padding: "10px 12px", textAlign: "center", fontWeight: 600 }}>⏰</th>}
                  </tr>
                </thead>
                <tbody>
                  {sortedCamps.map((row: any) => {
                    const imp = Number(row.impressions)
                    const clk = Number(row.clicks)
                    const spd = Number(row.spend)
                    const bdg = Number(row.daily_budget ?? 0)
                    const cpm = imp > 0 ? Math.round(spd / imp * 1000) : null
                    const cpc = clk > 0 ? Math.round(spd / clk) : null
                    const ctr = imp > 0 ? Math.round(clk / imp * 10000) / 100 : null
                    return (
                      <tr key={row.campaign_id} style={{ borderBottom: `1px solid ${t.rowBorder}` }}
                        onMouseEnter={e => (e.currentTarget.style.background = t.rowHover)}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                      >
                        <td style={{ padding: "10px 12px", color: t.text, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          title={row.campaign_name}>
                          {row.campaign_name}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "center" }}>
                          {(() => {
                            const st = row.effective_status as string | null
                            if (!st) return <span style={{ color: t.textMuted, fontSize: 11 }}>—</span>
                            const isActive = st === "ACTIVE"
                            const isPaused = st === "PAUSED"
                            const canToggle = ownerOf(row) && (isActive || isPaused)
                            const acting = actingCampId === row.campaign_id
                            const trackColor = isActive ? "#1877f2" : dark ? "#374151" : "#d1d5db"
                            const knobColor = "#ffffff"
                            return (
                              <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                <div
                                  onClick={() => canToggle && !acting && toggleStatus(row)}
                                  title={!canToggle ? (canControl ? `Camp của MKT ${row.mkt_name}` : "") : isActive ? "Click để pause" : "Click để bật"}
                                  style={{
                                    width: 36, height: 20, borderRadius: 10,
                                    background: acting ? (dark ? "#4b5563" : "#9ca3af") : trackColor,
                                    position: "relative", cursor: canToggle && !acting ? "pointer" : "default",
                                    opacity: acting ? 0.6 : canToggle ? 1 : 0.5,
                                    transition: "background 0.2s",
                                    flexShrink: 0,
                                  }}>
                                  <div style={{
                                    width: 14, height: 14, borderRadius: "50%", background: knobColor,
                                    position: "absolute", top: 3,
                                    left: isActive ? 18 : 4,
                                    transition: "left 0.2s",
                                    boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                                  }} />
                                </div>
                                <span style={{ fontSize: 10, color: isActive ? "#1877f2" : (dark ? "#6b7280" : "#9ca3af"), fontWeight: 600, minWidth: 40 }}>
                                  {acting ? "..." : isActive ? "ACTIVE" : isPaused ? "PAUSED" : st}
                                </span>
                              </div>
                            )
                          })()}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "center", fontWeight: 700, color: mktColor(row.mkt_name) }}>{row.mkt_name || "KHÁC"}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>
                          {editingBudget === row.campaign_id ? (
                            <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                              <input type="number" min={50000} max={50000000} step={50000}
                                value={budgetValue} autoFocus
                                onChange={(e) => setBudgetValue(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") saveBudget(row); if (e.key === "Escape") setEditingBudget(null) }}
                                style={{ width: 100, background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 4, padding: "2px 6px", color: t.inputText, fontSize: 12 }} />
                              <button onClick={() => saveBudget(row)} disabled={actingCampId === row.campaign_id}
                                style={{ background: t.green, color: "#fff", border: "none", borderRadius: 4, padding: "2px 6px", fontSize: 11, cursor: "pointer" }}>✓</button>
                              <button onClick={() => setEditingBudget(null)}
                                style={{ background: "transparent", color: t.textMuted, border: "none", padding: "2px 4px", fontSize: 11, cursor: "pointer" }}>✕</button>
                            </span>
                          ) : (
                            <span
                              onClick={() => { if (ownerOf(row)) { setEditingBudget(row.campaign_id); setBudgetValue(String(row.daily_budget || 0)) } }}
                              title={ownerOf(row) ? "Click để sửa" : ""}
                              style={{ color: t.textMuted, cursor: ownerOf(row) ? "pointer" : "default", borderBottom: ownerOf(row) ? `1px dotted ${t.textMuted}` : "none" }}>
                              {row.daily_budget ? fmtMoney(Number(row.daily_budget)) : "—"}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600 }}>
                          <span style={{ color: spendColor(spd, bdg) }} title={bdg ? `${Math.round(spd/bdg*100)}% budget` : ""}>
                            {fmtMoney(spd)}
                          </span>
                          {bdg > 0 && <div style={{ fontSize: 10, color: t.textMuted }}>{Math.round(spd/bdg*100)}%</div>}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right", color: t.textMuted }}>{imp.toLocaleString("vi-VN")}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", color: t.textMuted }}>{clk.toLocaleString("vi-VN")}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600, color: cpmColor(cpm) }}>{cpm !== null ? fmtMoney(cpm) : "—"}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600, color: cpcColor(cpc) }}>{cpc !== null ? fmtMoney(cpc) : "—"}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600, color: ctr !== null ? ctrColor(ctr) : t.textMuted }}>
                          {ctr !== null ? ctr + "%" : "—"}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>
                          <div style={{ color: t.green, fontWeight: 600 }}>{fmtMoney(Number(row.cod_total))}</div>
                          <div style={{ fontSize: 11, color: t.textMuted }}>{fmtMoney(Number(row.cod_delivered))} giao</div>
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontSize: 12 }}>
                          <span style={{ color: t.green }}>{row.delivered ?? 0}&#10003;</span>
                          {" · "}
                          <span style={{ color: t.red }}>{row.cancelled ?? 0}&#10007;</span>
                          {Number(row.total_orders) > 0 && <div style={{ fontSize: 10, color: t.textMuted }}>{row.total_orders} tổng</div>}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: carePctColor(row.care_pct !== null ? Number(row.care_pct) : null) }}>
                          {row.care_pct !== null ? Number(row.care_pct) + "%" : "—"}
                        </td>
                        {canControl && (
                          <td style={{ padding: "10px 12px", textAlign: "center" }}>
                            <button onClick={() => setScheduleModalCamp(row)} disabled={!ownerOf(row)}
                              title={ownerOf(row) ? "Hẹn giờ + xem log" : `Camp của MKT ${row.mkt_name}`}
                              style={{ background: "transparent", border: `1px solid ${t.cardBorder}`, color: ownerOf(row) ? t.amber : t.textMuted, padding: "2px 8px", borderRadius: 4, fontSize: 13, cursor: ownerOf(row) ? "pointer" : "not-allowed", opacity: ownerOf(row) ? 1 : 0.5 }}>
                              ⏰
                            </button>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  {(() => {
                    const totSpend = sortedCamps.reduce((s: number, r: any) => s + Number(r.spend), 0)
                    const totImp = sortedCamps.reduce((s: number, r: any) => s + Number(r.impressions), 0)
                    const totClk = sortedCamps.reduce((s: number, r: any) => s + Number(r.clicks), 0)
                    const totCod = sortedCamps.reduce((s: number, r: any) => s + Number(r.cod_total), 0)
                    const totCpm = totImp > 0 ? Math.round(totSpend / totImp * 1000) : null
                    const totCpc = totClk > 0 ? Math.round(totSpend / totClk) : null
                    const totCtr = totImp > 0 ? Math.round(totClk / totImp * 10000) / 100 : null
                    const totCarePct = totCod > 0 ? Math.round(totSpend / totCod * 10000) / 100 : null
                    return (
                      <tr style={{ borderTop: `2px solid ${t.thead}`, background: t.tfoot }}>
                        <td colSpan={3} style={{ padding: "10px 12px", fontWeight: 700, color: t.text }}>TỔNG ({sortedCamps.length} camps)</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", color: t.textMuted, fontWeight: 600 }}>
                          {fmtMoney(sortedCamps.reduce((s: number, r: any) => s + Number(r.daily_budget ?? 0), 0))}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right", color: t.amber, fontWeight: 700 }}>{fmtMoney(totSpend)}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", color: t.textMuted }}>{totImp.toLocaleString("vi-VN")}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", color: t.textMuted }}>{totClk.toLocaleString("vi-VN")}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: cpmColor(totCpm) }}>{totCpm !== null ? fmtMoney(totCpm) : "—"}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: cpcColor(totCpc) }}>{totCpc !== null ? fmtMoney(totCpc) : "—"}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: totCtr !== null ? ctrColor(totCtr) : t.textMuted }}>{totCtr !== null ? totCtr + "%" : "—"}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", color: t.green, fontWeight: 700 }}>{fmtMoney(totCod)}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", color: t.textMuted }}>
                          {sortedCamps.reduce((s: number, r: any) => s + Number(r.delivered ?? 0), 0)}&#10003;
                          {" · "}
                          {sortedCamps.reduce((s: number, r: any) => s + Number(r.cancelled ?? 0), 0)}&#10007;
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: carePctColor(totCarePct) }}>
                          {totCarePct !== null ? totCarePct + "%" : "—"}
                        </td>
                        {canControl && <td></td>}
                      </tr>
                    )
                  })()}
                </tfoot>
              </table>
            </div>
          )}
          </>
          )})()}
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

      {scheduleModalCamp && (
        <ScheduleModal
          camp={scheduleModalCamp}
          onClose={() => setScheduleModalCamp(null)}
          t={t}
          onChanged={fetchCampData}
        />
      )}
    </div>
  )
}

function ScheduleModal({ camp, onClose, t, onChanged }: { camp: any; onClose: () => void; t: any; onChanged: () => void }) {
  const [action, setAction] = useState<"pause" | "activate" | "set_budget">("pause")
  const [scheduledAt, setScheduledAt] = useState<string>(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000)
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  })
  const [budget, setBudget] = useState<string>(String(camp.daily_budget || 500000))
  const [schedules, setSchedules] = useState<any[]>([])
  const [logs, setLogs] = useState<any[]>([])
  const [submitting, setSubmitting] = useState(false)

  const reload = useCallback(async () => {
    const [sr, lr] = await Promise.all([
      apiFetch(`/admin/pancake-sync/report/camp-control/schedule?campaign_id=${camp.campaign_id}`).then(r => r.json()).catch(() => ({ schedules: [] })),
      apiFetch(`/admin/pancake-sync/report/camp-control/log?campaign_id=${camp.campaign_id}&limit=10`).then(r => r.json()).catch(() => ({ logs: [] })),
    ])
    setSchedules(sr.schedules || [])
    setLogs(lr.logs || [])
  }, [camp.campaign_id])

  useEffect(() => { reload() }, [reload])

  const submit = async () => {
    setSubmitting(true)
    try {
      const payload: any = { campaign_id: camp.campaign_id, action, scheduled_at: new Date(scheduledAt).toISOString() }
      if (action === "set_budget") payload.payload = { daily_budget: Number(budget) }
      const res = await apiFetch("/admin/pancake-sync/report/camp-control/schedule", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) { alert("Lỗi: " + (data.error || "unknown")); return }
      await reload()
      await onChanged()
    } finally { setSubmitting(false) }
  }

  const cancel = async (id: string) => {
    if (!confirm("Huỷ schedule này?")) return
    const res = await apiFetch(`/admin/pancake-sync/report/camp-control/schedule/${id}`, { method: "DELETE" })
    const data = await res.json()
    if (!res.ok) { alert("Lỗi: " + (data.error || "unknown")); return }
    await reload()
  }

  const fmtTime = (iso: string) => new Date(iso).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" })

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: 8, padding: 20, maxWidth: 720, width: "92%", maxHeight: "90vh", overflow: "auto", color: t.text }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>⏰ Hẹn giờ thao tác</div>
            <div style={{ fontSize: 12, color: t.textMuted, maxWidth: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{camp.campaign_name}</div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: t.text, fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ background: t.cronBg, padding: 12, borderRadius: 6, marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: t.text }}>Tạo schedule mới</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select value={action} onChange={e => setAction(e.target.value as any)}
              style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 4, padding: "6px 10px", color: t.inputText, fontSize: 13 }}>
              <option value="pause">⏸ Tắt camp</option>
              <option value="activate">▶ Bật camp</option>
              <option value="set_budget">💰 Đổi ngân sách</option>
            </select>
            <input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)}
              style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 4, padding: "6px 10px", color: t.inputText, fontSize: 13 }} />
            {action === "set_budget" && (
              <input type="number" min={50000} step={50000} value={budget} onChange={e => setBudget(e.target.value)}
                placeholder="Ngân sách mới"
                style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 4, padding: "6px 10px", color: t.inputText, fontSize: 13, width: 130 }} />
            )}
            <button onClick={submit} disabled={submitting}
              style={{ background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 4, padding: "6px 14px", fontSize: 13, cursor: submitting ? "wait" : "pointer", opacity: submitting ? 0.6 : 1 }}>
              {submitting ? "..." : "Tạo"}
            </button>
          </div>
          <div style={{ fontSize: 11, color: t.textMuted, marginTop: 6 }}>Cron chạy mỗi phút — sai số tối đa 1 phút</div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Schedules ({schedules.length})</div>
          {schedules.length === 0 ? (
            <div style={{ fontSize: 12, color: t.textMuted, padding: 12, textAlign: "center" }}>Chưa có schedule nào</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {schedules.map((s: any) => {
                const color = s.status === "done" ? t.green : s.status === "failed" ? t.red : s.status === "cancelled" ? t.textMuted : t.amber
                return (
                  <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: t.cronBg, borderRadius: 4, fontSize: 12 }}>
                    <span style={{ background: color + "22", color, padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 600 }}>{s.status}</span>
                    <span style={{ color: t.text, minWidth: 80 }}>
                      {s.action === "pause" ? "⏸ Tắt" : s.action === "activate" ? "▶ Bật" : `💰 ${(s.payload?.daily_budget ?? 0).toLocaleString("vi-VN")}đ`}
                    </span>
                    <span style={{ color: t.textMuted, flex: 1 }}>{fmtTime(s.scheduled_at)}</span>
                    <span style={{ color: t.textMuted, fontSize: 10 }}>{s.created_by_email}</span>
                    {s.status === "pending" && (
                      <button onClick={() => cancel(s.id)} style={{ background: "transparent", border: "none", color: t.red, cursor: "pointer", fontSize: 14 }}>✕</button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Lịch sử thao tác ({logs.length})</div>
          {logs.length === 0 ? (
            <div style={{ fontSize: 12, color: t.textMuted, padding: 12, textAlign: "center" }}>Chưa có thao tác nào</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {logs.map((l: any) => (
                <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", fontSize: 11 }}>
                  <span style={{ color: l.success ? t.green : t.red }}>{l.success ? "✓" : "✗"}</span>
                  <span style={{ color: t.text, minWidth: 80 }}>
                    {l.action === "pause" ? "⏸ Tắt" : l.action === "activate" ? "▶ Bật" : `💰 ${(l.new_value?.daily_budget ?? 0).toLocaleString("vi-VN")}đ`}
                  </span>
                  <span style={{ color: t.textMuted, fontSize: 10 }}>{l.source}</span>
                  <span style={{ color: t.textMuted, flex: 1 }}>{fmtTime(l.created_at)}</span>
                  <span style={{ color: t.textMuted, fontSize: 10 }}>{l.user_email}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Doanh số MKT",
})
