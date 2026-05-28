import { useState, useCallback } from "react"
import { apiJson } from "../../lib/api-client"

const BASE = "/admin/live-view"

function fmtTime(dt: string) {
  if (!dt) return "—"
  const d = new Date(dt)
  return d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false })
}

function fmtDuration(secs: number) {
  if (!secs) return "—"
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m${secs % 60}s`
}

function shortUrl(url: string) {
  try {
    const u = new URL(url)
    return u.pathname + (u.search ? u.search.slice(0, 30) : "")
  } catch {
    return url.slice(0, 50)
  }
}

function shortId(id: string) {
  return id ? id.slice(0, 8) + "…" : "—"
}

function deviceIcon(d: string) {
  if (d === "mobile") return "📱"
  if (d === "tablet") return "📟"
  return "💻"
}

type Session = {
  id: string; visitor_id: string; session_id: string
  first_seen: string; last_seen: string
  current_url: string; last_url: string
  utm_source: string; utm_campaign: string
  device_type: string; province: string; ip: string
  has_cart: boolean; pageview_count: number
}

type PageRow = { url: string; views: number; visitors: number }
type SourceRow = { utm_source: string; utm_campaign: string; views: number; visitors: number }
type Pageview = { session_id: string; url: string; title: string; created_at: string; time_on_prev_page: number }

const TODAY = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" })

export default function LiveViewPage() {
  const [stats, setStats] = useState<any>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [topPages, setTopPages] = useState<PageRow[]>([])
  const [topSources, setTopSources] = useState<SourceRow[]>([])
  const [loading, setLoading] = useState(false)
  const [from, setFrom] = useState(TODAY)
  const [to, setTo] = useState(TODAY)
  const [activeOnly, setActiveOnly] = useState(false)
  const [historyVisitor, setHistoryVisitor] = useState<string | null>(null)
  const [history, setHistory] = useState<Pageview[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = `from=${from}&to=${to}${activeOnly ? "&active=1" : ""}`
      const [s, sess, pages, sources] = await Promise.all([
        apiJson(`${BASE}/stats`),
        apiJson(`${BASE}/sessions?${params}&limit=200`),
        apiJson(`${BASE}/top-pages?from=${from}&to=${to}&limit=20`),
        apiJson(`${BASE}/top-sources?from=${from}&to=${to}&limit=20`),
      ])
      setStats(s)
      setSessions(sess.sessions ?? [])
      setTopPages(pages.rows ?? [])
      setTopSources(sources.rows ?? [])
    } catch (e: any) {
      alert("Lỗi: " + e.message)
    } finally {
      setLoading(false)
    }
  }, [from, to, activeOnly])

  const loadHistory = useCallback(async (visitorId: string) => {
    setHistoryVisitor(visitorId)
    setHistoryLoading(true)
    try {
      const data = await apiJson(`${BASE}/visitor/${visitorId}?limit=200`)
      setHistory(data.history ?? [])
    } catch {
      setHistory([])
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  const setRange = (days: number) => {
    const end = new Date()
    const start = new Date()
    start.setDate(start.getDate() - (days - 1))
    setFrom(start.toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }))
    setTo(end.toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }))
  }

  return (
    <div style={{ padding: 20, fontFamily: "sans-serif", fontSize: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>🔍 Live View</h1>
        <button onClick={() => setRange(1)} style={btnStyle}>Hôm nay</button>
        <button onClick={() => setRange(3)} style={btnStyle}>3 ngày</button>
        <button onClick={() => setRange(7)} style={btnStyle}>7 ngày</button>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputStyle} />
        <span>→</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputStyle} />
        <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
          <input type="checkbox" checked={activeOnly} onChange={e => setActiveOnly(e.target.checked)} />
          Chỉ online
        </label>
        <button onClick={load} disabled={loading} style={{ ...btnStyle, background: "#3b82f6", color: "#fff", padding: "6px 18px" }}>
          {loading ? "…" : "↻ Refresh"}
        </button>
      </div>

      {stats && (
        <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          <StatBox label="Visitor online (10p)" value={stats.active_visitors} color="#22c55e" />
          <StatBox label="Session hôm nay" value={stats.total_sessions_today} color="#3b82f6" />
          <StatBox label="Đang có giỏ hàng" value={stats.active_with_cart} color="#f59e0b" />
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
        <div>
          <h3 style={{ marginBottom: 8 }}>📄 Top trang xem ({from} → {to})</h3>
          <table style={tableStyle}>
            <thead><tr><th style={th}>URL</th><th style={th}>Lượt xem</th><th style={th}>Visitors</th></tr></thead>
            <tbody>
              {topPages.map((r, i) => (
                <tr key={i} style={{ background: i % 2 ? "#f9fafb" : "#fff" }}>
                  <td style={td} title={r.url}>{shortUrl(r.url)}</td>
                  <td style={{ ...td, textAlign: "right" }}>{r.views}</td>
                  <td style={{ ...td, textAlign: "right" }}>{r.visitors}</td>
                </tr>
              ))}
              {topPages.length === 0 && <tr><td colSpan={3} style={{ ...td, color: "#9ca3af", textAlign: "center" }}>Chưa có data — bấm Refresh</td></tr>}
            </tbody>
          </table>
        </div>
        <div>
          <h3 style={{ marginBottom: 8 }}>📣 Top nguồn traffic ({from} → {to})</h3>
          <table style={tableStyle}>
            <thead><tr><th style={th}>Nguồn</th><th style={th}>Campaign</th><th style={th}>Lượt xem</th><th style={th}>Visitors</th></tr></thead>
            <tbody>
              {topSources.map((r, i) => (
                <tr key={i} style={{ background: i % 2 ? "#f9fafb" : "#fff" }}>
                  <td style={td}>{r.utm_source || "—"}</td>
                  <td style={td} title={r.utm_campaign}>{r.utm_campaign ? r.utm_campaign.slice(0, 30) : "—"}</td>
                  <td style={{ ...td, textAlign: "right" }}>{r.views}</td>
                  <td style={{ ...td, textAlign: "right" }}>{r.visitors}</td>
                </tr>
              ))}
              {topSources.length === 0 && <tr><td colSpan={4} style={{ ...td, color: "#9ca3af", textAlign: "center" }}>Chưa có data — bấm Refresh</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 style={{ marginBottom: 8 }}>👥 Danh sách session ({sessions.length})</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={th}>Visitor</th>
                <th style={th}>TB</th>
                <th style={th}>Tỉnh</th>
                <th style={th}>Trang hiện tại</th>
                <th style={th}>UTM Source</th>
                <th style={th}>Campaign</th>
                <th style={th}>PV</th>
                <th style={th}>Giỏ</th>
                <th style={th}>Lần cuối</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s, i) => (
                <tr key={s.id} style={{ background: i % 2 ? "#f9fafb" : "#fff" }}>
                  <td style={td} title={s.visitor_id}>{shortId(s.visitor_id)}</td>
                  <td style={{ ...td, textAlign: "center" }}>{deviceIcon(s.device_type)}</td>
                  <td style={td}>{s.province || "—"}</td>
                  <td style={td} title={s.current_url}>{shortUrl(s.current_url || s.last_url)}</td>
                  <td style={td}>{s.utm_source || "—"}</td>
                  <td style={td} title={s.utm_campaign}>{s.utm_campaign ? s.utm_campaign.slice(0, 25) : "—"}</td>
                  <td style={{ ...td, textAlign: "right" }}>{s.pageview_count}</td>
                  <td style={{ ...td, textAlign: "center" }}>{s.has_cart ? "🛒" : ""}</td>
                  <td style={td}>{fmtTime(s.last_seen)}</td>
                  <td style={td}>
                    <button onClick={() => loadHistory(s.visitor_id)} style={{ ...btnStyle, padding: "2px 8px", fontSize: 12 }}>Xem</button>
                  </td>
                </tr>
              ))}
              {sessions.length === 0 && (
                <tr><td colSpan={10} style={{ ...td, color: "#9ca3af", textAlign: "center" }}>Chưa có session — bấm Refresh</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {historyVisitor && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 8, padding: 24, width: "90%", maxWidth: 700, maxHeight: "80vh", overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>Lịch sử visitor: {shortId(historyVisitor)}</h3>
              <button onClick={() => setHistoryVisitor(null)} style={{ ...btnStyle, background: "#ef4444", color: "#fff" }}>✕ Đóng</button>
            </div>
            {historyLoading ? <p>Đang tải…</p> : (
              <table style={tableStyle}>
                <thead><tr><th style={th}>Thời gian</th><th style={th}>URL</th><th style={th}>Tiêu đề</th><th style={th}>Thời gian ở trang trước</th></tr></thead>
                <tbody>
                  {history.map((p, i) => (
                    <tr key={p.session_id + i} style={{ background: i % 2 ? "#f9fafb" : "#fff" }}>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtTime(p.created_at)}</td>
                      <td style={td} title={p.url}>{shortUrl(p.url)}</td>
                      <td style={td}>{p.title?.slice(0, 40) || "—"}</td>
                      <td style={{ ...td, textAlign: "right" }}>{fmtDuration(p.time_on_prev_page)}</td>
                    </tr>
                  ))}
                  {history.length === 0 && <tr><td colSpan={4} style={{ ...td, textAlign: "center", color: "#9ca3af" }}>Không có dữ liệu</td></tr>}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function StatBox({ label, value, color }: { label: string; value: any; color: string }) {
  return (
    <div style={{ background: "#fff", border: `2px solid ${color}`, borderRadius: 8, padding: "12px 20px", minWidth: 150 }}>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value ?? "—"}</div>
      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{label}</div>
    </div>
  )
}

const btnStyle: React.CSSProperties = { cursor: "pointer", padding: "4px 10px", border: "1px solid #d1d5db", borderRadius: 6, background: "#f9fafb", fontSize: 13 }
const inputStyle: React.CSSProperties = { border: "1px solid #d1d5db", borderRadius: 6, padding: "4px 8px", fontSize: 13 }
const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", border: "1px solid #e5e7eb", fontSize: 13 }
const th: React.CSSProperties = { padding: "6px 10px", background: "#f3f4f6", borderBottom: "1px solid #e5e7eb", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap" }
const td: React.CSSProperties = { padding: "5px 10px", borderBottom: "1px solid #f3f4f6", verticalAlign: "middle" }
