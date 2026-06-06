import { useState, useEffect } from "react"
import { apiFetch } from "../../lib/api-client"
import { T, pageColorFn } from "./tokens"

type PageStat = {
  page_id: string
  page_name: string
  fan_count: number
  new_fans_7d: number
  reach_7d: number
  engaged_7d: number
  post_count_7d: number
  total_posts: number
  total_likes: number
  total_reach: number
  synced_at: string | null
  category: string | null
}

function fmt(n: number | string | null) {
  const num = typeof n === "string" ? parseInt(n) : (n ?? 0)
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M"
  if (num >= 1000) return (num / 1000).toFixed(1) + "k"
  return String(num)
}

function fmtDate(d: string | null) {
  if (!d) return "—"
  return new Date(d).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
}

const th: React.CSSProperties = {
  padding: "9px 14px", textAlign: "left", color: T.text3, fontSize: 10,
  fontWeight: 700, textTransform: "uppercase", borderBottom: `1px solid ${T.border}`,
  background: T.subtle, whiteSpace: "nowrap",
}
const td: React.CSSProperties = {
  padding: "10px 14px", fontSize: 12, color: T.text2,
  borderBottom: `1px solid ${T.border}`, verticalAlign: "middle",
}

function Delta({ val }: { val: number }) {
  if (!val) return null
  return (
    <span style={{ fontSize: 10, color: val > 0 ? "#059669" : "#DC2626", marginLeft: 4 }}>
      {val > 0 ? "▲" : "▼"}{fmt(Math.abs(val))}
    </span>
  )
}

export function PageStatsTab() {
  const [pages, setPages] = useState<PageStat[]>([])
  const [syncedAt, setSyncedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [syncLog, setSyncLog] = useState<string[]>([])
  const [showLog, setShowLog] = useState(false)

  const addLog = (msg: string) => setSyncLog(prev => [`[${new Date().toLocaleTimeString("vi-VN")}] ${msg}`, ...prev].slice(0, 30))

  const load = () => {
    setLoading(true)
    apiFetch("/admin/fb-content/page-stats")
      .then(r => r.json())
      .then(d => { setPages(d.pages ?? []); setSyncedAt(d.synced_at ?? null) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const refresh = async () => {
    setSyncing(true)
    setSyncLog([])
    setShowLog(true)
    addLog("Bắt đầu sync thống kê page từ Facebook...")
    try {
      addLog("→ Gọi POST /admin/fb-content/page-stats")
      const res = await apiFetch("/admin/fb-content/page-stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      addLog(`← HTTP ${res.status}`)
      const r = await res.json()
      addLog(`Response: ${JSON.stringify(r)}`)
      if (r.ok) {
        addLog(`✅ Sync xong: ${r.synced}/${r.total} page`)
        if (r.errors?.length) r.errors.forEach((e: string) => addLog(`⚠️ ${e}`))
        showToast(`Đã sync ${r.synced} page`)
        load()
      } else {
        addLog(`❌ Lỗi: ${r.error}`)
        showToast(`Lỗi: ${r.error}`)
      }
    } catch (e: any) {
      addLog(`❌ Exception: ${e.message}`)
      showToast("Sync thất bại")
    } finally {
      setSyncing(false)
    }
  }

  // KPI tổng
  const totalFans    = pages.reduce((s, p) => s + (p.fan_count || 0), 0)
  const totalReach7d = pages.reduce((s, p) => s + (p.reach_7d || 0), 0)
  const totalEng7d   = pages.reduce((s, p) => s + (p.engaged_7d || 0), 0)
  const totalPosts7d = pages.reduce((s, p) => s + (p.post_count_7d || 0), 0)

  return (
    <div style={{ padding: "0 0 32px" }}>
      {toast && (
        <div style={{ position: "fixed", bottom: 24, right: 24, background: "#111827", color: "#fff", borderRadius: 10, padding: "10px 18px", fontSize: 13, zIndex: 9999 }}>
          {toast}
        </div>
      )}

      {/* KPI Cards */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        {[
          { label: "Tổng page", value: String(pages.length), icon: "📋" },
          { label: "Tổng Fans", value: fmt(totalFans), icon: "👥" },
          { label: "Reach 7 ngày", value: fmt(totalReach7d), icon: "👁" },
          { label: "Engaged 7 ngày", value: fmt(totalEng7d), icon: "❤️" },
          { label: "Bài/7 ngày", value: String(totalPosts7d), icon: "📝" },
        ].map(k => (
          <div key={k.label} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: "14px 20px", minWidth: 110, flex: 1 }}>
            <div style={{ fontSize: 20 }}>{k.icon}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: T.text1 }}>{k.value}</div>
            <div style={{ fontSize: 11, color: T.text3 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, justifyContent: "flex-end" }}>
        {syncedAt && <span style={{ fontSize: 11, color: T.text3 }}>Cập nhật: {fmtDate(syncedAt)}</span>}
        <button onClick={() => setShowLog(v => !v)}
          style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 7, padding: "6px 12px", fontSize: 11, color: T.text3, cursor: "pointer" }}>
          {showLog ? "Ẩn log" : "🔍 Log"}
        </button>
        <button onClick={refresh} disabled={syncing}
          style={{ background: T.accent, color: "#fff", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 12, cursor: syncing ? "not-allowed" : "pointer", opacity: syncing ? 0.7 : 1 }}>
          {syncing ? "⏳ Đang sync..." : "↻ Refresh"}
        </button>
      </div>

      {/* Log panel */}
      {showLog && (
        <div style={{ background: "#0f172a", borderRadius: 10, padding: "12px 16px", marginBottom: 12, fontFamily: "monospace", fontSize: 11 }}>
          <div style={{ color: "#94a3b8", marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
            <span>🔍 Sync Log</span>
            <button onClick={() => setSyncLog([])} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 11 }}>Xóa</button>
          </div>
          {syncLog.length === 0
            ? <div style={{ color: "#475569" }}>Chưa có log</div>
            : syncLog.map((l, i) => (
              <div key={i} style={{ color: l.includes("❌") ? "#f87171" : l.includes("✅") ? "#4ade80" : l.includes("⚠️") ? "#fbbf24" : l.includes("→") || l.includes("←") ? "#60a5fa" : "#e2e8f0", padding: "1px 0" }}>
                {l}
              </div>
            ))
          }
        </div>
      )}

      {/* Table */}
      <div style={{ overflowX: "auto", background: T.card, border: `1px solid ${T.border}`, borderRadius: 12 }}>
        <table style={{ width: "100%", minWidth: 800, borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 200 }}>Trang</th>
              <th style={{ ...th, width: 120 }}>Fans</th>
              <th style={{ ...th, width: 100 }}>Reach 7d</th>
              <th style={{ ...th, width: 100 }}>Engaged 7d</th>
              <th style={{ ...th, width: 80 }}>Bài/7d</th>
              <th style={{ ...th, width: 100 }}>Tổng Likes</th>
              <th style={{ ...th, width: 120 }}>Tổng Reach</th>
              <th style={{ ...th, width: 120 }}>Cập nhật</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ ...td, textAlign: "center", padding: 32, color: T.text3 }}>Đang tải...</td></tr>
            ) : pages.length === 0 ? (
              <tr><td colSpan={8} style={{ ...td, textAlign: "center", padding: 32, color: T.text3 }}>Chưa có dữ liệu — bấm Refresh để sync từ Facebook</td></tr>
            ) : pages.map(p => {
              const color = pageColorFn(p.page_id)
              const fbUrl = `https://www.facebook.com/${p.page_id}`
              return (
                <tr key={p.page_id}>
                  <td style={td}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 28, height: 28, borderRadius: "50%", background: color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                        {(p.page_name || "?")[0]}
                      </div>
                      <div>
                        <div style={{ fontSize: 12, color: T.text1, fontWeight: 500 }}>{p.page_name}</div>
                        {p.category && <div style={{ fontSize: 10, color: T.text3 }}>{p.category}</div>}
                      </div>
                      <a href={fbUrl} target="_blank" rel="noreferrer"
                        style={{ marginLeft: "auto", fontSize: 10, padding: "2px 7px", borderRadius: 5, background: T.accentSubtle, color: T.accent, textDecoration: "none", whiteSpace: "nowrap" }}>
                        ↗ FB
                      </a>
                    </div>
                  </td>
                  <td style={td}>
                    <span style={{ fontWeight: 700, color: T.text1 }}>{fmt(p.fan_count)}</span>
                    <Delta val={p.new_fans_7d} />
                  </td>
                  <td style={{ ...td, fontWeight: 600, color: p.reach_7d > 10000 ? "#7C3AED" : T.text2 }}>{p.reach_7d > 0 ? fmt(p.reach_7d) : "—"}</td>
                  <td style={{ ...td, fontWeight: 600, color: p.engaged_7d > 1000 ? "#1877F2" : T.text2 }}>{p.engaged_7d > 0 ? fmt(p.engaged_7d) : "—"}</td>
                  <td style={{ ...td, textAlign: "center" }}>{p.post_count_7d || "—"}</td>
                  <td style={{ ...td, textAlign: "right" }}>{fmt(p.total_likes)}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{fmt(p.total_reach)}</td>
                  <td style={{ ...td, fontSize: 11, color: T.text3 }}>{fmtDate(p.synced_at)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
