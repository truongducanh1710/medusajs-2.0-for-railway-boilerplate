import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useState, useEffect, useCallback } from "react"
import { apiFetch } from "../../lib/api-client"
import { useCurrentPermissions } from "../../lib/use-permissions"

const MKT_LIST = ["KIENLB", "ANHNT", "NAMDV", "XUANLT", "LINHMT", "DUPD"]
const MKT_COLORS: Record<string, string> = {
  KIENLB: "#60a5fa", ANHNT: "#f472b6", NAMDV: "#34d399",
  XUANLT: "#fb923c", LINHMT: "#a78bfa", DUPD: "#facc15",
}
const mktColor = (name: string) => MKT_COLORS[name] ?? "#9ca3af"

function fmtDt(iso: string): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false,
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
}

function extractMkt(campName: string): string {
  if (!campName) return "?"
  const parts = campName.split("_")
  for (const p of parts.slice(1)) {
    if (/^[A-Z]{3,8}$/.test(p.trim())) return p.trim()
  }
  return "?"
}

function ActionBadge({ action }: { action: string }) {
  const cfg: Record<string, { label: string; bg: string; color: string }> = {
    pause:      { label: "Tắt",     bg: "#fef3c7", color: "#d97706" },
    activate:   { label: "Bật",     bg: "#dcfce7", color: "#16a34a" },
    set_budget: { label: "Budget",  bg: "#ede9fe", color: "#7c3aed" },
  }
  const c = cfg[action] ?? { label: action, bg: "#f3f4f6", color: "#374151" }
  return <span style={{ background: c.bg, color: c.color, padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600 }}>{c.label}</span>
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { color: string }> = {
    pending:   { color: "#2563eb" },
    done:      { color: "#16a34a" },
    failed:    { color: "#dc2626" },
    cancelled: { color: "#6b7280" },
  }
  const c = cfg[status] ?? { color: "#6b7280" }
  return <span style={{ color: c.color, fontWeight: 600, fontSize: 12 }}>{status}</span>
}

export default function CampJobsPage() {
  const { isSuper, has } = useCurrentPermissions()
  const canControl = has("page.bao-cao.camp-control") || isSuper

  const [tab, setTab] = useState<"schedules" | "logs">("schedules")

  // Schedules state
  const [schedules, setSchedules] = useState<any[]>([])
  const [schedTotal, setSchedTotal] = useState(0)
  const [schedLoading, setSchedLoading] = useState(false)
  const [schedStatus, setSchedStatus] = useState("")
  const [schedMkt, setSchedMkt] = useState("")
  const [schedOffset, setSchedOffset] = useState(0)
  const SCHED_LIMIT = 50

  // Logs state
  const [logs, setLogs] = useState<any[]>([])
  const [logsTotal, setLogsTotal] = useState(0)
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsMkt, setLogsMkt] = useState("")
  const [logsAction, setLogsAction] = useState("")
  const [logsFrom, setLogsFrom] = useState("")
  const [logsTo, setLogsTo] = useState(new Date().toISOString().slice(0, 10))
  const [logsOffset, setLogsOffset] = useState(0)
  const LOGS_LIMIT = 100

  // Cancel schedule
  const [cancelling, setCancelling] = useState<string | null>(null)

  const fetchSchedules = useCallback(async () => {
    setSchedLoading(true)
    try {
      const p = new URLSearchParams({ limit: String(SCHED_LIMIT), offset: String(schedOffset) })
      if (schedStatus) p.set("status", schedStatus)
      if (schedMkt) p.set("mkt", schedMkt)
      const res = await apiFetch(`/admin/pancake-sync/report/camp-control/all-schedules?${p}`)
      const data = await res.json()
      setSchedules(data.schedules ?? [])
      setSchedTotal(data.total ?? 0)
    } catch { /* ignore */ } finally { setSchedLoading(false) }
  }, [schedStatus, schedMkt, schedOffset])

  const fetchLogs = useCallback(async () => {
    setLogsLoading(true)
    try {
      const p = new URLSearchParams({ limit: String(LOGS_LIMIT), offset: String(logsOffset) })
      if (logsMkt) p.set("mkt", logsMkt)
      if (logsAction) p.set("action", logsAction)
      if (logsFrom) p.set("from", logsFrom)
      if (logsTo) p.set("to", logsTo)
      const res = await apiFetch(`/admin/pancake-sync/report/camp-control/all-logs?${p}`)
      const data = await res.json()
      setLogs(data.logs ?? [])
      setLogsTotal(data.total ?? 0)
    } catch { /* ignore */ } finally { setLogsLoading(false) }
  }, [logsMkt, logsAction, logsFrom, logsTo, logsOffset])

  useEffect(() => { if (tab === "schedules") fetchSchedules() }, [tab, fetchSchedules])
  useEffect(() => { if (tab === "logs") fetchLogs() }, [tab, fetchLogs])

  const cancelSchedule = async (id: string) => {
    if (!confirm("Huỷ lịch hẹn này?")) return
    setCancelling(id)
    try {
      await apiFetch(`/admin/pancake-sync/report/camp-control/schedule/${id}`, { method: "DELETE" })
      await fetchSchedules()
    } finally { setCancelling(null) }
  }

  const thStyle: React.CSSProperties = { padding: "10px 12px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "#6b7280", borderBottom: "2px solid #e5e7eb", whiteSpace: "nowrap" }
  const tdStyle: React.CSSProperties = { padding: "10px 12px", fontSize: 13, borderBottom: "1px solid #f3f4f6" }

  return (
    <div style={{ padding: "24px 32px", background: "#f8fafc", minHeight: "100vh" }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>Quản lý hẹn giờ & lịch sử thao tác</h1>
        <div style={{ fontSize: 13, color: "#64748b" }}>Camp schedules + audit log mọi hành động bật/tắt/budget</div>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "2px solid #e5e7eb" }}>
        {([["schedules", "⏰ Lịch hẹn giờ"], ["logs", "📋 Lịch sử hành động"]] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{ padding: "10px 20px", fontWeight: 600, fontSize: 13, border: "none", cursor: "pointer",
              borderBottom: tab === key ? "2px solid #2563eb" : "2px solid transparent",
              marginBottom: -2, background: "transparent",
              color: tab === key ? "#2563eb" : "#64748b" }}>
            {label}
          </button>
        ))}
      </div>

      {/* ========== SCHEDULES TAB ========== */}
      {tab === "schedules" && (
        <div>
          {/* Filters */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
            <select value={schedStatus} onChange={e => { setSchedStatus(e.target.value); setSchedOffset(0) }}
              style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: "7px 12px", fontSize: 13, background: "#fff", color: "#0f172a" }}>
              <option value="">Tất cả trạng thái</option>
              <option value="pending">Pending</option>
              <option value="done">Done</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <select value={schedMkt} onChange={e => { setSchedMkt(e.target.value); setSchedOffset(0) }}
              style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: "7px 12px", fontSize: 13, background: "#fff", color: "#0f172a" }}>
              <option value="">Tất cả MKT</option>
              {MKT_LIST.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <button onClick={fetchSchedules} disabled={schedLoading}
              style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 13, cursor: "pointer", opacity: schedLoading ? 0.6 : 1 }}>
              {schedLoading ? "..." : "↻ Refresh"}
            </button>
            <span style={{ fontSize: 12, color: "#94a3b8", marginLeft: 8 }}>{schedTotal} lịch hẹn</span>
          </div>

          {/* Table */}
          <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e5e7eb", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  <th style={thStyle}>Campaign</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>MKT</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Hành động</th>
                  <th style={thStyle}>Hẹn lúc (VN)</th>
                  <th style={thStyle}>Thực hiện lúc</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Trạng thái</th>
                  <th style={thStyle}>Tạo bởi</th>
                  <th style={thStyle}>Ghi chú</th>
                  {canControl && <th style={{ ...thStyle, textAlign: "center" }}>Huỷ</th>}
                </tr>
              </thead>
              <tbody>
                {schedules.length === 0 ? (
                  <tr><td colSpan={9} style={{ ...tdStyle, textAlign: "center", color: "#94a3b8", padding: 40 }}>Không có dữ liệu</td></tr>
                ) : schedules.map(s => {
                  const mkt = extractMkt(s.campaign_name)
                  return (
                    <tr key={s.id} style={{ transition: "background 0.1s" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
                      onMouseLeave={e => (e.currentTarget.style.background = "")}>
                      <td style={{ ...tdStyle, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.campaign_name}>
                        {s.campaign_name}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "center", fontWeight: 700, color: mktColor(mkt) }}>{mkt}</td>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        <ActionBadge action={s.action} />
                        {s.action === "set_budget" && s.payload?.daily_budget && (
                          <div style={{ fontSize: 10, color: "#6b7280", marginTop: 2 }}>{Number(s.payload.daily_budget).toLocaleString("vi-VN")}đ</div>
                        )}
                      </td>
                      <td style={{ ...tdStyle, fontWeight: 600, color: s.status === "pending" ? "#2563eb" : "#374151" }}>{fmtDt(s.scheduled_at)}</td>
                      <td style={{ ...tdStyle, color: "#64748b" }}>{s.executed_at ? fmtDt(s.executed_at) : "—"}</td>
                      <td style={{ ...tdStyle, textAlign: "center" }}><StatusBadge status={s.status} /></td>
                      <td style={{ ...tdStyle, color: "#64748b", fontSize: 12 }}>{s.created_by_email?.split("@")[0]}</td>
                      <td style={{ ...tdStyle, color: "#dc2626", fontSize: 12, maxWidth: 180 }}>{s.error_message ?? ""}</td>
                      {canControl && (
                        <td style={{ ...tdStyle, textAlign: "center" }}>
                          {s.status === "pending" && (
                            <button onClick={() => cancelSchedule(s.id)} disabled={cancelling === s.id}
                              style={{ background: "#fee2e2", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: 4, padding: "3px 10px", fontSize: 12, cursor: "pointer", opacity: cancelling === s.id ? 0.5 : 1 }}>
                              {cancelling === s.id ? "..." : "Huỷ"}
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {schedTotal > SCHED_LIMIT && (
            <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "center" }}>
              <button disabled={schedOffset === 0} onClick={() => setSchedOffset(Math.max(0, schedOffset - SCHED_LIMIT))}
                style={{ padding: "6px 16px", border: "1px solid #e2e8f0", borderRadius: 6, cursor: schedOffset === 0 ? "not-allowed" : "pointer", opacity: schedOffset === 0 ? 0.4 : 1, background: "#fff" }}>← Trước</button>
              <span style={{ fontSize: 13, color: "#64748b", lineHeight: "34px" }}>{Math.floor(schedOffset / SCHED_LIMIT) + 1} / {Math.ceil(schedTotal / SCHED_LIMIT)}</span>
              <button disabled={schedOffset + SCHED_LIMIT >= schedTotal} onClick={() => setSchedOffset(schedOffset + SCHED_LIMIT)}
                style={{ padding: "6px 16px", border: "1px solid #e2e8f0", borderRadius: 6, cursor: schedOffset + SCHED_LIMIT >= schedTotal ? "not-allowed" : "pointer", opacity: schedOffset + SCHED_LIMIT >= schedTotal ? 0.4 : 1, background: "#fff" }}>Sau →</button>
            </div>
          )}
        </div>
      )}

      {/* ========== LOGS TAB ========== */}
      {tab === "logs" && (
        <div>
          {/* Filters */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
            <select value={logsMkt} onChange={e => { setLogsMkt(e.target.value); setLogsOffset(0) }}
              style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: "7px 12px", fontSize: 13, background: "#fff", color: "#0f172a" }}>
              <option value="">Tất cả MKT</option>
              {MKT_LIST.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={logsAction} onChange={e => { setLogsAction(e.target.value); setLogsOffset(0) }}
              style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: "7px 12px", fontSize: 13, background: "#fff", color: "#0f172a" }}>
              <option value="">Tất cả hành động</option>
              <option value="pause">Tắt camp</option>
              <option value="activate">Bật camp</option>
              <option value="set_budget">Chỉnh budget</option>
            </select>
            <input type="date" value={logsFrom} onChange={e => { setLogsFrom(e.target.value); setLogsOffset(0) }}
              placeholder="Từ ngày"
              style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: "7px 10px", fontSize: 13, background: "#fff", color: "#0f172a" }} />
            <input type="date" value={logsTo} onChange={e => { setLogsTo(e.target.value); setLogsOffset(0) }}
              style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: "7px 10px", fontSize: 13, background: "#fff", color: "#0f172a" }} />
            <button onClick={fetchLogs} disabled={logsLoading}
              style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 13, cursor: "pointer", opacity: logsLoading ? 0.6 : 1 }}>
              {logsLoading ? "..." : "↻ Refresh"}
            </button>
            <span style={{ fontSize: 12, color: "#94a3b8", marginLeft: 8 }}>{logsTotal} hành động</span>
          </div>

          {/* Table */}
          <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e5e7eb", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  <th style={thStyle}>Thời gian</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>MKT</th>
                  <th style={thStyle}>Campaign</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Hành động</th>
                  <th style={thStyle}>Trước</th>
                  <th style={thStyle}>Sau</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Nguồn</th>
                  <th style={thStyle}>Người thực hiện</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Kết quả</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr><td colSpan={9} style={{ ...tdStyle, textAlign: "center", color: "#94a3b8", padding: 40 }}>Chưa có lịch sử thao tác</td></tr>
                ) : logs.map(log => {
                  const mkt = extractMkt(log.campaign_name)
                  const oldV = log.old_value ?? {}
                  const newV = log.new_value ?? {}
                  return (
                    <tr key={log.id}
                      onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
                      onMouseLeave={e => (e.currentTarget.style.background = "")}>
                      <td style={{ ...tdStyle, color: "#64748b", fontSize: 12, whiteSpace: "nowrap" }}>{fmtDt(log.created_at)}</td>
                      <td style={{ ...tdStyle, textAlign: "center", fontWeight: 700, color: mktColor(mkt) }}>{mkt}</td>
                      <td style={{ ...tdStyle, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }} title={log.campaign_name}>{log.campaign_name}</td>
                      <td style={{ ...tdStyle, textAlign: "center" }}><ActionBadge action={log.action} /></td>
                      <td style={{ ...tdStyle, fontSize: 12, color: "#64748b" }}>
                        {log.action === "set_budget"
                          ? (oldV.daily_budget ? Number(oldV.daily_budget).toLocaleString("vi-VN") + "đ" : "—")
                          : (oldV.status ?? "—")}
                      </td>
                      <td style={{ ...tdStyle, fontSize: 12, fontWeight: 600, color: "#0f172a" }}>
                        {log.action === "set_budget"
                          ? (newV.daily_budget ? Number(newV.daily_budget).toLocaleString("vi-VN") + "đ" : "—")
                          : (newV.status ?? "—")}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4,
                          background: log.source === "manual" ? "#dbeafe" : "#fef3c7",
                          color: log.source === "manual" ? "#1d4ed8" : "#92400e" }}>
                          {log.source === "manual" ? "Manual" : "Auto"}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, fontSize: 12, color: "#64748b" }}>{log.user_email?.split("@")[0]}</td>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        {log.success
                          ? <span style={{ color: "#16a34a", fontSize: 16 }}>✓</span>
                          : <span style={{ color: "#dc2626", fontSize: 16 }} title={log.fb_response?.error?.message}>✗</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {logsTotal > LOGS_LIMIT && (
            <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "center" }}>
              <button disabled={logsOffset === 0} onClick={() => setLogsOffset(Math.max(0, logsOffset - LOGS_LIMIT))}
                style={{ padding: "6px 16px", border: "1px solid #e2e8f0", borderRadius: 6, cursor: logsOffset === 0 ? "not-allowed" : "pointer", opacity: logsOffset === 0 ? 0.4 : 1, background: "#fff" }}>← Trước</button>
              <span style={{ fontSize: 13, color: "#64748b", lineHeight: "34px" }}>{Math.floor(logsOffset / LOGS_LIMIT) + 1} / {Math.ceil(logsTotal / LOGS_LIMIT)}</span>
              <button disabled={logsOffset + LOGS_LIMIT >= logsTotal} onClick={() => setLogsOffset(logsOffset + LOGS_LIMIT)}
                style={{ padding: "6px 16px", border: "1px solid #e2e8f0", borderRadius: 6, cursor: logsOffset + LOGS_LIMIT >= logsTotal ? "not-allowed" : "pointer", opacity: logsOffset + LOGS_LIMIT >= logsTotal ? 0.4 : 1, background: "#fff" }}>Sau →</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Camp Jobs",
  icon: () => null,
})
