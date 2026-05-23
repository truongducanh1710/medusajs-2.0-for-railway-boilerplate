import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useState, useEffect, useCallback } from "react"
import { apiFetch } from "../../lib/api-client"

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function dur(ms: number | null): string {
  if (!ms) return "—"
  if (ms < 1000) return `${ms}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m${s % 60}s`
}

const STATUS_NAMES: Record<number, string> = {
  0: "Chờ xử lý", 1: "Sale đã chốt", 2: "Đang giao", 3: "Giao thành công",
  4: "Đang hoàn về", 5: "Đã hoàn về kho", 6: "Đã hủy", 7: "Đã xóa",
  8: "Đang đóng hàng", 9: "Chờ chuyển hàng", 11: "Chờ hàng",
}

// ---- Stats Panel ----

function StatsPanel({ stats }: { stats: any }) {
  if (!stats) return null
  const lastSync = stats.last_sync_at ? fmt(stats.last_sync_at) : "Chưa có"
  const cron = stats.cron_24h ?? {}
  const wh = stats.webhook_24h ?? {}

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 24 }}>
      {[
        { label: "Lần sync cuối", value: lastSync, color: "#10b981" },
        { label: "Cron chạy (24h)", value: cron.total_runs ?? "—", sub: `avg ${dur(Math.round(cron.avg_duration_ms))}` },
        { label: "Đơn đã sync (24h)", value: cron.total_orders ?? "—", sub: `+${cron.total_created ?? 0} mới / ~${cron.total_updated ?? 0} update` },
        { label: "Lỗi cron (24h)", value: cron.total_errors ?? "—", color: Number(cron.total_errors) > 0 ? "#ef4444" : undefined },
        { label: "Webhook (24h)", value: wh.total_events ?? "—", sub: `✓ ${wh.success ?? 0} / ⚠ ${wh.fallback ?? 0} fallback / ✗ ${wh.failed ?? 0}` },
      ].map((card) => (
        <div key={card.label} style={{ background: "#1a1a2e", border: "1px solid #2d2d44", borderRadius: 8, padding: "12px 16px" }}>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>{card.label}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: card.color ?? "#f9fafb" }}>{card.value}</div>
          {card.sub && <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{card.sub}</div>}
        </div>
      ))}
    </div>
  )
}

// ---- Status Distribution ----

function StatusTable({ counts }: { counts: any[] }) {
  if (!counts?.length) return null
  const total = counts.reduce((s: number, r: any) => s + Number(r.count), 0)
  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: "#d1d5db", marginBottom: 10 }}>Phân bố đơn trong DB</h3>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {counts.map((r: any) => {
          const pct = total > 0 ? Math.round(Number(r.count) / total * 100) : 0
          const name = STATUS_NAMES[Number(r.status)] ?? r.status_name ?? `Status ${r.status}`
          return (
            <div key={r.status} style={{ background: "#111827", border: "1px solid #374151", borderRadius: 6, padding: "6px 12px", fontSize: 13 }}>
              <span style={{ color: "#9ca3af" }}>{name}: </span>
              <span style={{ color: "#f9fafb", fontWeight: 600 }}>{Number(r.count).toLocaleString()}</span>
              <span style={{ color: "#6b7280", marginLeft: 4 }}>({pct}%)</span>
            </div>
          )
        })}
      </div>
      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>Tổng: {total.toLocaleString()} đơn</div>
    </div>
  )
}

// ---- Cron Log Table ----

function CronLogTable({ logs }: { logs: any[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  if (!logs?.length) return <div style={{ color: "#6b7280", padding: 16, textAlign: "center" }}>Chưa có log cron nào</div>

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #374151", color: "#9ca3af" }}>
            {["Thời gian", "Loại", "Thời lượng", "Tổng đơn", "Update", "Tạo mới", "Lỗi", ""].map(h => (
              <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 500 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {logs.map((log: any) => (
            <>
              <tr
                key={log.id}
                style={{ borderBottom: "1px solid #1f2937", cursor: "pointer" }}
                onClick={() => setExpanded(expanded === log.id ? null : log.id)}
              >
                <td style={{ padding: "8px 12px", color: "#d1d5db" }}>{fmt(log.started_at)}</td>
                <td style={{ padding: "8px 12px" }}>
                  <span style={{
                    background: log.run_type === "nightly final" ? "#7c3aed22" : "#065f4622",
                    color: log.run_type === "nightly final" ? "#a78bfa" : "#34d399",
                    padding: "2px 8px", borderRadius: 4, fontSize: 11
                  }}>
                    {log.run_type}
                  </span>
                </td>
                <td style={{ padding: "8px 12px", color: "#9ca3af" }}>{dur(log.duration_ms)}</td>
                <td style={{ padding: "8px 12px", color: "#f9fafb", fontWeight: 600 }}>{log.total_orders}</td>
                <td style={{ padding: "8px 12px", color: "#60a5fa" }}>{log.total_updated}</td>
                <td style={{ padding: "8px 12px", color: "#34d399" }}>{log.total_created}</td>
                <td style={{ padding: "8px 12px", color: log.total_errors > 0 ? "#f87171" : "#6b7280" }}>{log.total_errors}</td>
                <td style={{ padding: "8px 12px", color: "#6b7280" }}>{expanded === log.id ? "▲" : "▼"}</td>
              </tr>
              {expanded === log.id && (
                <tr key={`${log.id}-detail`} style={{ background: "#111827" }}>
                  <td colSpan={8} style={{ padding: "8px 12px" }}>
                    <div style={{ fontSize: 12, color: "#9ca3af" }}>
                      <strong style={{ color: "#d1d5db" }}>Chi tiết theo status:</strong>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                        {(Array.isArray(log.statuses) ? log.statuses : []).map((s: any) => (
                          <span key={s.status} style={{ background: "#1f2937", borderRadius: 4, padding: "2px 8px" }}>
                            {STATUS_NAMES[s.status] ?? `Status ${s.status}`}: {s.total} đơn
                            {s.updated > 0 && <span style={{ color: "#60a5fa" }}> ↑{s.updated}</span>}
                            {s.created > 0 && <span style={{ color: "#34d399" }}> +{s.created}</span>}
                            {s.errors > 0 && <span style={{ color: "#f87171" }}> ✗{s.errors}</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---- Webhook Log Table ----

function WebhookLogTable({ logs }: { logs: any[] }) {
  if (!logs?.length) return <div style={{ color: "#6b7280", padding: 16, textAlign: "center" }}>Chưa có webhook log nào</div>

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #374151", color: "#9ca3af" }}>
            {["Thời gian", "Order ID", "Status", "API fetch", "Upsert", "Fallback", "Duration", "Lỗi"].map(h => (
              <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 500 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {logs.map((log: any) => (
            <tr key={log.id} style={{ borderBottom: "1px solid #1f2937" }}>
              <td style={{ padding: "8px 12px", color: "#d1d5db" }}>{fmt(log.received_at)}</td>
              <td style={{ padding: "8px 12px" }}>
                <a href={`/app/pancake-orders/${log.pancake_order_id}`} style={{ color: "#60a5fa" }}>#{log.pancake_order_id}</a>
              </td>
              <td style={{ padding: "8px 12px", color: "#9ca3af" }}>{log.status_name || `${log.pancake_status}`}</td>
              <td style={{ padding: "8px 12px" }}>
                {log.api_fetch_success === null ? <span style={{ color: "#6b7280" }}>—</span>
                  : log.api_fetch_success ? <span style={{ color: "#34d399" }}>✓</span>
                  : <span style={{ color: "#f87171" }}>✗</span>}
              </td>
              <td style={{ padding: "8px 12px" }}>
                {log.upsert_success === null ? <span style={{ color: "#6b7280" }}>—</span>
                  : log.upsert_success ? <span style={{ color: "#34d399" }}>✓</span>
                  : <span style={{ color: "#f87171" }}>✗</span>}
              </td>
              <td style={{ padding: "8px 12px", color: log.fallback_used ? "#f59e0b" : "#6b7280" }}>
                {log.fallback_used ? "⚠ fallback" : "—"}
              </td>
              <td style={{ padding: "8px 12px", color: "#9ca3af" }}>{dur(log.duration_ms)}</td>
              <td style={{ padding: "8px 12px", color: "#f87171", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {log.error_message ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---- Main Page ----

export default function CronLogPage() {
  const [tab, setTab] = useState<"cron" | "webhook">("cron")
  const [stats, setStats] = useState<any>(null)
  const [cronLogs, setCronLogs] = useState<any[]>([])
  const [webhookLogs, setWebhookLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [statsRes, cronRes, webhookRes] = await Promise.all([
        apiFetch("/admin/pancake-sync/logs/stats"),
        apiFetch("/admin/pancake-sync/logs?type=cron&limit=50"),
        apiFetch("/admin/pancake-sync/logs?type=webhook&limit=100"),
      ])
      setStats(await statsRes.json())
      const cronData = await cronRes.json()
      setCronLogs(cronData.logs ?? [])
      const whData = await webhookRes.json()
      setWebhookLogs(whData.logs ?? [])
      setLastRefresh(new Date())
    } catch (e) {
      console.error("Failed to load logs", e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Auto-refresh mỗi 30s
  useEffect(() => {
    const t = setInterval(fetchData, 30_000)
    return () => clearInterval(t)
  }, [fetchData])

  const p = (n: number) => String(n).padStart(2, "0")
  const refreshStr = `${p(lastRefresh.getHours())}:${p(lastRefresh.getMinutes())}:${p(lastRefresh.getSeconds())}`

  return (
    <div style={{ padding: "24px 32px", background: "#0f0f1a", minHeight: "100vh", color: "#f9fafb" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Cron & Webhook Monitor</h1>
          <div style={{ fontSize: 12, color: "#6b7280" }}>Cập nhật lúc {refreshStr} · tự động refresh 30s</div>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          style={{
            background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 6,
            padding: "8px 16px", cursor: loading ? "not-allowed" : "pointer", fontSize: 13, opacity: loading ? 0.6 : 1
          }}
        >
          {loading ? "Đang tải..." : "↻ Refresh"}
        </button>
      </div>

      <StatsPanel stats={stats} />
      <StatusTable counts={stats?.status_counts ?? []} />

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #374151", marginBottom: 16 }}>
        {(["cron", "webhook"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: "none", border: "none", borderBottom: tab === t ? "2px solid #3b82f6" : "2px solid transparent",
              color: tab === t ? "#60a5fa" : "#9ca3af", padding: "8px 20px", cursor: "pointer",
              fontSize: 14, fontWeight: tab === t ? 600 : 400, marginBottom: -1,
            }}
          >
            {t === "cron" ? `Cron Log (${cronLogs.length})` : `Webhook Log (${webhookLogs.length})`}
          </button>
        ))}
      </div>

      {tab === "cron" ? <CronLogTable logs={cronLogs} /> : <WebhookLogTable logs={webhookLogs} />}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Cron Monitor",
})
