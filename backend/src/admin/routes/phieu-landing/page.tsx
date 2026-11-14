import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useCallback, useEffect, useState } from "react"
import { apiJson } from "../../lib/api-client"
import { withRouteGuard } from "../../components/route-guard"

type Step = { key: string; label: string }
type Row = { group: string; events: Record<string, number>; avg_sec: number | null }
type Data = { handle: string; from: string; to: string; group: string; steps: Step[]; handles: { handle: string; n: number }[]; rows: Row[] }

const vnDay = (back = 0) => new Date(Date.now() + 7 * 3600e3 - back * 864e5).toISOString().slice(0, 10)
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) + "%" : "—")
const fmtSec = (s: number | null) => (s == null ? "—" : s < 60 ? `${s}s` : `${Math.floor(s / 60)}p${s % 60}s`)

function PhieuLandingPage() {
  const [handle, setHandle] = useState("")
  const [from, setFrom] = useState(vnDay())
  const [to, setTo] = useState(vnDay())
  const [group, setGroup] = useState("none")
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState("")
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setErr("")
    try {
      const qs = new URLSearchParams({ from, to, group, ...(handle ? { handle } : {}) })
      const d = await apiJson(`/admin/funnel?${qs}`)
      setData(d); if (!handle && d.handle) setHandle(d.handle)
    } catch (e: any) { setErr(e?.message || "Lỗi tải dữ liệu") }
    setLoading(false)
  }, [handle, from, to, group])

  useEffect(() => { load() }, [load])

  const steps = data?.steps ?? []
  const quick = (b: number, e: number) => { setFrom(vnDay(b)); setTo(vnDay(e)) }

  return (
    <div style={{ padding: 20, maxWidth: 1300 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Phễu landing</h1>
      <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 14 }}>
        Mỗi bước tính số phiên khác nhau (1 người vào trang = 1 phiên). % là so với bước "Vào trang". Thời gian ở trang lấy lúc khách rời trang.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <select value={handle} onChange={(e) => setHandle(e.target.value)} style={inp}>
          {(data?.handles ?? []).map((h) => <option key={h.handle} value={h.handle}>{h.handle} ({h.n} phiên/30 ngày)</option>)}
          {!data?.handles?.length && <option value="">Chưa có dữ liệu</option>}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={inp} />
        <span>→</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={inp} />
        <button style={btn} onClick={() => quick(0, 0)}>Hôm nay</button>
        <button style={btn} onClick={() => quick(1, 1)}>Hôm qua</button>
        <button style={btn} onClick={() => quick(6, 0)}>7 ngày</button>
        <select value={group} onChange={(e) => setGroup(e.target.value)} style={inp}>
          <option value="none">Gộp tất cả</option>
          <option value="ad">Theo video (tên ad)</option>
          <option value="campaign">Theo camp</option>
        </select>
        <button style={{ ...btn, background: "#2563eb", color: "#fff" }} onClick={load}>{loading ? "Đang tải…" : "Tải lại"}</button>
      </div>

      {err && <div style={{ color: "#dc2626", marginBottom: 10 }}>{err}</div>}

      <div style={{ overflowX: "auto" }}>
        <table style={tbl}>
          <thead>
            <tr>
              <th style={th}>{group === "ad" ? "Video" : group === "campaign" ? "Camp" : ""}</th>
              {steps.map((s) => <th key={s.key} style={{ ...th, textAlign: "right" }}>{s.label}</th>)}
              <th style={{ ...th, textAlign: "right" }}>TG ở trang</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((r) => {
              const base = r.events.view ?? 0
              return (
                <tr key={r.group}>
                  <td style={{ ...td, maxWidth: 360, wordBreak: "break-all", fontWeight: 600 }}>{r.group}</td>
                  {steps.map((s, i) => {
                    const n = r.events[s.key] ?? 0
                    const prev = i ? r.events[steps[i - 1].key] ?? 0 : 0
                    const drop = i > 0 && prev > 0 && n / prev < 0.4
                    return (
                      <td key={s.key} style={{ ...td, textAlign: "right", background: drop ? "#fef2f2" : undefined }}>
                        <div style={{ fontWeight: 700 }}>{n}</div>
                        {i > 0 && <div style={{ fontSize: 11, color: "#6b7280" }}>{pct(n, base)}</div>}
                      </td>
                    )
                  })}
                  <td style={{ ...td, textAlign: "right" }}>{fmtSec(r.avg_sec)}</td>
                </tr>
              )
            })}
            {data && !data.rows.length && <tr><td style={td} colSpan={steps.length + 2}>Chưa có lượt vào trang trong khoảng này.</td></tr>}
          </tbody>
        </table>
      </div>
      <p style={{ color: "#6b7280", fontSize: 12, marginTop: 8 }}>Ô đỏ: còn dưới 40% so với bước liền trước — chỗ khách rơi nhiều.</p>
    </div>
  )
}

const inp: React.CSSProperties = { padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13 }
const btn: React.CSSProperties = { padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, background: "#fff", cursor: "pointer" }
const tbl: React.CSSProperties = { width: "100%", borderCollapse: "collapse", border: "1px solid #e5e7eb", fontSize: 13 }
const th: React.CSSProperties = { padding: "6px 10px", background: "#f3f4f6", borderBottom: "1px solid #e5e7eb", fontWeight: 600, whiteSpace: "nowrap" }
const td: React.CSSProperties = { padding: "6px 10px", borderBottom: "1px solid #f3f4f6", verticalAlign: "middle" }

export const config = defineRouteConfig({ label: "Phễu landing" })

export default withRouteGuard(PhieuLandingPage)
