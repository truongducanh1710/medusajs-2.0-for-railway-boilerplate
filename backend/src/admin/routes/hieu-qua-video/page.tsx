import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useEffect, useState } from "react"
import { apiFetch, apiJson } from "../../lib/api-client"

const TOKENS_CSS = `
.hqv-scope { --bg:#F4F5F9; --bg-card:#FFFFFF; --bg-subtle:#F0F1F5; --border:#E5E7EB;
  --text-1:#111827; --text-2:#4B5563; --text-3:#9CA3AF; --accent:#1877F2;
  --shadow-sm:0 1px 3px rgba(0,0,0,0.07),0 1px 2px rgba(0,0,0,0.04); color:var(--text-1); }
.hqv-scope .hover-bg:hover{background:rgba(0,0,0,0.035) !important;}
`

const PERSON_COLORS: Record<string, string> = { "Hậu": "#1877F2", "Khải": "#10B981", "Quân": "#F59E0B" }
const fmtVnd = (n: number) => (n || 0).toLocaleString("vi-VN")

// Đánh giá nhanh: hook tốt >40%, CPM thấp tốt. Trả màu.
function hookColor(r: number) { return r >= 40 ? "#16A34A" : r >= 20 ? "#D97706" : "#DC2626" }
function ctrColor(r: number) { return r >= 1.5 ? "#16A34A" : r >= 0.8 ? "#D97706" : "#DC2626" }

const HieuQuaVideoPage = () => {
  const [from, setFrom] = useState("2026-06-01")
  const [to, setTo] = useState("2026-06-30")
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [canSync, setCanSync] = useState(false)

  const load = () => {
    setLoading(true)
    apiJson(`/admin/pancake-sync/report/video-performance?from=${from}&to=${to}`)
      .then(d => { setRows(d.rows || []); setLoading(false) })
      .catch(e => { setMsg("Lỗi: " + e.message); setLoading(false) })
  }
  useEffect(() => {
    load()
    apiFetch("/admin/permissions/me").then(r => r.json()).then(d => {
      const perms = d.permissions
      setCanSync(d.is_super || (Array.isArray(perms) && perms.includes("page.bao-cao.camp-control")))
    }).catch(() => {})
  }, [])

  const syncToday = async () => {
    setSyncing(true); setMsg(null)
    try {
      const d = await apiJson(`/admin/pancake-sync/report/video-performance`, "POST", {})
      setMsg(`Đã sync ${d.synced} ad (${d.withVd} có VD-code), lỗi ${d.errors}`)
      load()
    } catch (e: any) { setMsg("Lỗi sync: " + e.message) }
    setSyncing(false)
  }

  const inpSt: React.CSSProperties = { background: "var(--bg-card)", color: "var(--text-1)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", fontSize: 12, outline: "none" }

  return (
    <div className="hqv-scope" style={{ background: "var(--bg)", margin: -24, minHeight: "calc(100vh - 56px)", padding: 20 }}>
      <style>{TOKENS_CSS}</style>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: "var(--text-1)" }}>Hiệu quả Video qua Quảng cáo</h1>
        <p style={{ fontSize: 13, color: "var(--text-3)", marginTop: 4 }}>Mỗi video (VD-code) tổng hợp spend, CTR, CPM, hook rate, thruplay từ tất cả ad/tài khoản đang chạy.</p>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
        <span style={{ color: "var(--text-3)" }}>📅</span>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inpSt} />
        <span style={{ color: "var(--text-3)" }}>→</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={inpSt} />
        <button onClick={load} style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 8, padding: "6px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{loading ? "Đang tải…" : "Tải dữ liệu"}</button>
        {canSync && <button onClick={syncToday} disabled={syncing} style={{ background: "var(--bg-card)", color: "var(--text-2)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{syncing ? "Đang sync…" : "↻ Sync ad hôm nay"}</button>}
        {msg && <span style={{ fontSize: 12, color: "var(--text-2)" }}>{msg}</span>}
      </div>

      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 1000, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--bg-subtle)" }}>
                {["VD", "Người làm", "Sản phẩm", "Loại", "Ad/TK", "Spend", "CTR", "CPM", "Hook 3s", "Thruplay"].map((h, i) => (
                  <th key={i} style={{ padding: "9px 12px", textAlign: i >= 4 ? "right" : "left", color: "var(--text-3)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={r.vdCode} className="hover-bg" style={{ borderBottom: idx < rows.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <td style={{ padding: "9px 12px", color: "#1654B8", fontSize: 12, fontWeight: 700, fontFamily: "monospace" }}>{r.vdCode}</td>
                  <td style={{ padding: "9px 12px" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 18, height: 18, borderRadius: "50%", background: PERSON_COLORS[r.maker] || "#6B7280", color: "#fff", fontSize: 9, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{(r.maker || "?")[0]}</span>
                      <span style={{ fontSize: 12, color: "var(--text-1)" }}>{r.maker}</span>
                    </span>
                  </td>
                  <td style={{ padding: "9px 12px", color: "var(--text-1)", fontSize: 12, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.product}</td>
                  <td style={{ padding: "9px 12px", color: "var(--text-2)", fontSize: 12 }}>{r.videoType}</td>
                  <td style={{ padding: "9px 12px", textAlign: "right", color: "var(--text-3)", fontSize: 12 }}>{r.adCount}/{r.accountCount}</td>
                  <td style={{ padding: "9px 12px", textAlign: "right", color: "var(--text-1)", fontSize: 12, fontWeight: 600 }}>{fmtVnd(r.spend)}</td>
                  <td style={{ padding: "9px 12px", textAlign: "right", color: ctrColor(r.ctr), fontSize: 12, fontWeight: 600 }}>{r.ctr}%</td>
                  <td style={{ padding: "9px 12px", textAlign: "right", color: "var(--text-2)", fontSize: 12 }}>{fmtVnd(r.cpm)}</td>
                  <td style={{ padding: "9px 12px", textAlign: "right", color: hookColor(r.hookRate), fontSize: 12, fontWeight: 600 }}>{r.hookRate}%</td>
                  <td style={{ padding: "9px 12px", textAlign: "right", color: "var(--text-2)", fontSize: 12 }}>{r.thruplayRate}%</td>
                </tr>
              ))}
              {rows.length === 0 && !loading && (
                <tr><td colSpan={10} style={{ padding: 30, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
                  Chưa có dữ liệu. Bấm "Sync ad hôm nay" để kéo insights từ FB (tên ad cần chứa VD-code).
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export const config = defineRouteConfig({ label: "Hiệu quả Video" })

export default HieuQuaVideoPage
