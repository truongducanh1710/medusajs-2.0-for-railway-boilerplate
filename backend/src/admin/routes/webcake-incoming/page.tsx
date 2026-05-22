import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useState, useEffect, useCallback } from "react"
import { apiFetch } from "../../lib/api-client"

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const STATUS_NAMES: Record<number, string> = {
  0: "Chờ xử lý", 1: "Sale đã chốt", 2: "Đang giao", 3: "Giao thành công",
  4: "Đang hoàn về", 5: "Đã hoàn về kho", 6: "Đã hủy", 7: "Đã xóa",
}

export default function WebcakeIncomingPage() {
  const [logs, setLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(new Date())

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch("/admin/pancake-sync/logs?type=webhook&limit=100")
      const data = await res.json()
      setLogs(data.logs ?? [])
      setLastRefresh(new Date())
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchLogs() }, [fetchLogs])
  useEffect(() => {
    const t = setInterval(fetchLogs, 15_000)
    return () => clearInterval(t)
  }, [fetchLogs])

  const p = (n: number) => String(n).padStart(2, "0")
  const refreshStr = `${p(lastRefresh.getHours())}:${p(lastRefresh.getMinutes())}:${p(lastRefresh.getSeconds())}`
  const total = logs.length
  const success = logs.filter(l => l.upsert_success).length
  const fallback = logs.filter(l => l.fallback_used).length
  const failed = logs.filter(l => l.error_message).length

  return (
    <div style={{ padding: "24px 32px", background: "#0f0f1a", minHeight: "100vh", color: "#f9fafb" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Đơn đổ về từ Webcake</h1>
          <div style={{ fontSize: 12, color: "#6b7280" }}>Webhook nhận được · cập nhật lúc {refreshStr} · tự động 15s</div>
        </div>
        <button onClick={fetchLogs} disabled={loading} style={{
          background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 6,
          padding: "8px 16px", cursor: loading ? "not-allowed" : "pointer", fontSize: 13, opacity: loading ? 0.6 : 1
        }}>
          {loading ? "Đang tải..." : "↻ Refresh"}
        </button>
      </div>

      {/* Summary */}
      <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
        {[
          { label: "Tổng webhook", value: total, color: "#f9fafb" },
          { label: "Thành công", value: success, color: "#34d399" },
          { label: "Fallback (API chậm)", value: fallback, color: "#f59e0b" },
          { label: "Lỗi", value: failed, color: failed > 0 ? "#f87171" : "#6b7280" },
        ].map(c => (
          <div key={c.label} style={{ background: "#1a1a2e", border: "1px solid #2d2d44", borderRadius: 8, padding: "10px 20px", minWidth: 120 }}>
            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>{c.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      {logs.length === 0 && !loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "#6b7280" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
          <div style={{ fontSize: 16 }}>Chưa có webhook nào từ Webcake</div>
          <div style={{ fontSize: 13, marginTop: 8 }}>Khi khách đặt đơn trên landing page, sẽ hiện ở đây trong vài giây</div>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #374151", color: "#9ca3af" }}>
                {["Thời gian", "Mã đơn", "Trạng thái", "API fetch", "Lưu DB", "Fallback", "Thời lượng", "Lỗi"].map(h => (
                  <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 500, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((log: any) => (
                <tr key={log.id} style={{ borderBottom: "1px solid #1f2937" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#111827")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  <td style={{ padding: "10px 12px", color: "#d1d5db", whiteSpace: "nowrap" }}>{fmt(log.received_at)}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <a href={`/app/pancake-orders/${log.pancake_order_id}`}
                      style={{ color: "#60a5fa", fontWeight: 600, textDecoration: "none" }}>
                      #{log.pancake_order_id}
                    </a>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <span style={{
                      background: "#1f2937", borderRadius: 4, padding: "2px 8px", fontSize: 12,
                      color: log.pancake_status === 3 ? "#34d399" : log.pancake_status === 2 ? "#60a5fa" : "#d1d5db"
                    }}>
                      {log.status_name || STATUS_NAMES[log.pancake_status] || `Status ${log.pancake_status}`}
                    </span>
                  </td>
                  <td style={{ padding: "10px 12px", textAlign: "center" }}>
                    {log.api_fetch_success === null ? <span style={{ color: "#6b7280" }}>—</span>
                      : log.api_fetch_success ? <span style={{ color: "#34d399", fontSize: 16 }}>✓</span>
                      : <span style={{ color: "#f87171", fontSize: 16 }}>✗</span>}
                  </td>
                  <td style={{ padding: "10px 12px", textAlign: "center" }}>
                    {log.upsert_success === null ? <span style={{ color: "#6b7280" }}>—</span>
                      : log.upsert_success ? <span style={{ color: "#34d399", fontSize: 16 }}>✓</span>
                      : <span style={{ color: "#f87171", fontSize: 16 }}>✗</span>}
                  </td>
                  <td style={{ padding: "10px 12px", textAlign: "center" }}>
                    {log.fallback_used
                      ? <span style={{ color: "#f59e0b", fontSize: 12 }}>⚠ fallback</span>
                      : <span style={{ color: "#374151" }}>—</span>}
                  </td>
                  <td style={{ padding: "10px 12px", color: "#9ca3af", whiteSpace: "nowrap" }}>
                    {log.duration_ms ? `${log.duration_ms}ms` : "—"}
                  </td>
                  <td style={{ padding: "10px 12px", color: "#f87171", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {log.error_message || "—"}
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
