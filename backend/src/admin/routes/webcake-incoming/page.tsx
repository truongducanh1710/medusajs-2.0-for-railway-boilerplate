import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useState, useEffect, useCallback } from "react"
import { apiFetch } from "../../lib/api-client"

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const STATUS_COLORS: Record<string, string> = {
  new: "#f59e0b",
  contacted: "#60a5fa",
  converted: "#34d399",
}

const STATUS_LABELS: Record<string, string> = {
  new: "Mới",
  contacted: "Đã liên hệ",
  converted: "Đã chốt",
}

export default function WebcakeIncomingPage() {
  const [leads, setLeads] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(new Date())
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const fetchLeads = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch("/admin/webcake-leads?limit=100")
      const data = await res.json()
      setLeads(data.leads ?? [])
      setTotal(data.total ?? 0)
      setLastRefresh(new Date())
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchLeads() }, [fetchLeads])
  useEffect(() => {
    const t = setInterval(fetchLeads, 15_000)
    return () => clearInterval(t)
  }, [fetchLeads])

  const updateStatus = async (id: string, status: string) => {
    setUpdatingId(id)
    try {
      await apiFetch("/admin/webcake-leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      })
      setLeads(prev => prev.map(l => l.id === id ? { ...l, status } : l))
    } catch (e) {
      console.error(e)
    } finally {
      setUpdatingId(null)
    }
  }

  const p = (n: number) => String(n).padStart(2, "0")
  const refreshStr = `${p(lastRefresh.getHours())}:${p(lastRefresh.getMinutes())}:${p(lastRefresh.getSeconds())}`
  const countNew = leads.filter(l => l.status === "new").length
  const countContacted = leads.filter(l => l.status === "contacted").length
  const countConverted = leads.filter(l => l.status === "converted").length

  return (
    <div style={{ padding: "24px 32px", background: "#0f0f1a", minHeight: "100vh", color: "#f9fafb" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Đơn đổ về từ Webcake</h1>
          <div style={{ fontSize: 12, color: "#6b7280" }}>Landing page leads · cập nhật lúc {refreshStr} · tự động 15s</div>
        </div>
        <button onClick={fetchLeads} disabled={loading} style={{
          background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 6,
          padding: "8px 16px", cursor: loading ? "not-allowed" : "pointer", fontSize: 13, opacity: loading ? 0.6 : 1
        }}>
          {loading ? "Đang tải..." : "↻ Refresh"}
        </button>
      </div>

      {/* Summary */}
      <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
        {[
          { label: "Tổng leads", value: total, color: "#f9fafb" },
          { label: "Mới", value: countNew, color: "#f59e0b" },
          { label: "Đã liên hệ", value: countContacted, color: "#60a5fa" },
          { label: "Đã chốt", value: countConverted, color: "#34d399" },
        ].map(c => (
          <div key={c.label} style={{ background: "#1a1a2e", border: "1px solid #2d2d44", borderRadius: 8, padding: "10px 20px", minWidth: 120 }}>
            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>{c.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      {leads.length === 0 && !loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "#6b7280" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
          <div style={{ fontSize: 16 }}>Chưa có lead nào từ Webcake</div>
          <div style={{ fontSize: 13, marginTop: 8 }}>Khi khách điền form trên landing page, sẽ hiện ở đây trong vài giây</div>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #374151", color: "#9ca3af" }}>
                {["Thời gian", "Họ tên", "Số điện thoại", "Trạng thái", "Nguồn", "Raw data"].map(h => (
                  <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 500, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leads.map((lead: any) => (
                <tr key={lead.id} style={{ borderBottom: "1px solid #1f2937" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#111827")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  <td style={{ padding: "10px 12px", color: "#d1d5db", whiteSpace: "nowrap" }}>{fmt(lead.created_at)}</td>
                  <td style={{ padding: "10px 12px", fontWeight: 600, color: "#f9fafb" }}>{lead.full_name || "—"}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <a href={`tel:${lead.phone_number}`} style={{ color: "#60a5fa", textDecoration: "none" }}>
                      {lead.phone_number || "—"}
                    </a>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <select
                      value={lead.status}
                      disabled={updatingId === lead.id}
                      onChange={e => updateStatus(lead.id, e.target.value)}
                      style={{
                        background: "#1f2937",
                        border: `1px solid ${STATUS_COLORS[lead.status] ?? "#374151"}`,
                        borderRadius: 4,
                        padding: "2px 8px",
                        fontSize: 12,
                        color: STATUS_COLORS[lead.status] ?? "#d1d5db",
                        cursor: "pointer",
                      }}
                    >
                      {Object.entries(STATUS_LABELS).map(([val, lbl]) => (
                        <option key={val} value={val}>{lbl}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: "10px 12px", color: "#9ca3af", fontSize: 11, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {lead.source_url || "—"}
                  </td>
                  <td style={{ padding: "10px 12px", color: "#6b7280", fontSize: 11, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {JSON.stringify(lead.raw)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Webcake incoming",
})
