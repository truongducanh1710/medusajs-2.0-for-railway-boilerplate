import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useEffect, useRef, useState } from "react"
import { apiJson } from "../../lib/api-client"

// ─── Types ────────────────────────────────────────────────────────────────────

interface Feature {
  key: string; enabled: boolean; model: string | null
  provider: string | null; notes: string | null
  updated_by: string | null; updated_at: string | null
}
interface ModelOption { id: string; label: string; provider: string; costPer1M: number }
interface EnvStatus { DEEPSEEK_API_KEY: boolean; OPENROUTER_API_KEY: boolean; GEMINI_API_KEY: boolean; MINIMAX_API_KEY: boolean }

interface UsageSummary {
  total_cost_usd: number; total_tokens: number; total_calls: number
  by_feature: { feature: string; calls: number; total_tokens: number; cost_usd: number }[]
  by_model:   { model: string; provider: string; calls: number; total_tokens: number; cost_usd: number }[]
  by_day:     { day: string; cost_usd: number; total_tokens: number; calls: number }[]
}
interface UsageLog {
  id: number; feature: string; run_id: string | null; model: string; provider: string
  prompt_tokens: number; completion_tokens: number; total_tokens: number
  cost_usd: number; context: any; created_at: string
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const FEATURE_META: Record<string, { label: string; desc: string; icon: string; scheduleInfo?: string }> = {
  camp_ai_agent:    { label: "Camp AI Agent",    desc: "Phân tích & đề xuất tối ưu Facebook Ads campaign tự động", icon: "🤖", scheduleInfo: "Chạy mỗi 4 giờ" },
  camp_ai_evaluator:{ label: "Camp AI Evaluator",desc: "Model phụ chấm điểm chất lượng recommendation của agent chính", icon: "🔍", scheduleInfo: "Chạy sau mỗi lần agent kết thúc" },
  cskh_analysis:    { label: "CSKH Analysis",    desc: "Phân tích đơn hàng & đề xuất action cho team CSKH", icon: "💬" },
  video_analysis:   { label: "Video Analysis",   desc: "Phân tích video ads — transcribe + chấm điểm bán hàng (Gemini/MiniMax)", icon: "🎬" },
}

const FEATURE_COLORS: Record<string, string> = {
  camp_ai_agent: "#7c3aed", camp_ai_evaluator: "#2563eb", cskh_analysis: "#059669", video_analysis: "#dc6f2a",
}

function fmtCost(n: number) {
  if (n === 0) return "$0"
  if (n < 0.001) return `$${(n * 1000).toFixed(3)}m`
  return `$${Number(n).toFixed(4)}`
}
function fmtTokens(n: number) {
  if (!n) return "0"
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
function fmtDate(s: string) {
  return new Date(s).toLocaleString("vi-VN", { hour12: false })
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function ToggleSwitch({ enabled, onChange, disabled }: { enabled: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button onClick={() => !disabled && onChange(!enabled)} disabled={disabled}
      style={{ width: 48, height: 26, borderRadius: 13, border: "none", cursor: disabled ? "not-allowed" : "pointer",
        background: enabled ? "#7c3aed" : "#d1d5db", position: "relative", transition: "background 0.2s",
        flexShrink: 0, opacity: disabled ? 0.6 : 1 }}>
      <span style={{ position: "absolute", top: 3, left: enabled ? 25 : 3, width: 20, height: 20,
        borderRadius: "50%", background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,.2)", display: "block" }} />
    </button>
  )
}

function FeatureCard({ feature, models, envStatus, onSave }: {
  feature: Feature; models: ModelOption[]; envStatus: EnvStatus
  onSave: (key: string, patch: Partial<Feature>) => Promise<void>
}) {
  const meta = FEATURE_META[feature.key] ?? { label: feature.key, desc: "", icon: "⚙️" }
  const [saving, setSaving] = useState(false)
  const [localModel, setLocalModel] = useState(feature.model ?? "")
  const [dirty, setDirty] = useState(false)

  const currentModelMeta = models.find(m => m.id === (localModel || feature.model))
  const needsOpenRouter = currentModelMeta?.provider === "openrouter"
  const needsDeepSeek   = currentModelMeta?.provider === "deepseek"
  const keyMissing = (needsOpenRouter && !envStatus.OPENROUTER_API_KEY) || (needsDeepSeek && !envStatus.DEEPSEEK_API_KEY)

  async function handleToggle(val: boolean) {
    setSaving(true); await onSave(feature.key, { enabled: val }); setSaving(false)
  }
  async function handleModelSave() {
    setSaving(true)
    const m = models.find(x => x.id === localModel)
    await onSave(feature.key, { model: localModel, provider: m?.provider ?? null })
    setDirty(false); setSaving(false)
  }

  return (
    <div style={{ border: `1.5px solid ${feature.enabled ? "#e5e7eb" : "#f3f4f6"}`, borderRadius: 12,
      padding: "20px 24px", background: feature.enabled ? "#fff" : "#fafafa", opacity: feature.enabled ? 1 : 0.7 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 28 }}>{meta.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: "#111827" }}>{meta.label}</span>
            {feature.enabled
              ? <span style={{ background: "#dcfce7", color: "#16a34a", borderRadius: 99, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>● BẬT</span>
              : <span style={{ background: "#f3f4f6", color: "#6b7280", borderRadius: 99, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>● TẮT</span>}
            {keyMissing && <span style={{ background: "#fef2f2", color: "#dc2626", borderRadius: 99, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>⚠ API Key thiếu</span>}
          </div>
          <div style={{ fontSize: 13, color: "#6b7280", marginTop: 3 }}>{meta.desc}</div>
          {meta.scheduleInfo && <div style={{ fontSize: 11, color: "#a78bfa", marginTop: 2 }}>⏱ {meta.scheduleInfo}</div>}
        </div>
        <ToggleSwitch enabled={feature.enabled} onChange={handleToggle} disabled={saving} />
      </div>
      <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 8 }}>Model AI</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select value={localModel} onChange={e => { setLocalModel(e.target.value); setDirty(true) }}
            style={{ border: "1px solid #d1d5db", borderRadius: 7, padding: "6px 10px", fontSize: 12, minWidth: 260, background: "#fff" }}>
            <option value="">(mặc định)</option>
            {models.map(m => <option key={m.id} value={m.id}>{m.label} — ${m.costPer1M}/1M tokens ({m.provider})</option>)}
          </select>
          {dirty && (
            <button onClick={handleModelSave} disabled={saving}
              style={{ background: "#7c3aed", color: "#fff", border: "none", borderRadius: 7, padding: "6px 16px", cursor: saving ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700 }}>
              {saving ? "Đang lưu…" : "Lưu model"}
            </button>
          )}
          {currentModelMeta && !dirty && <span style={{ fontSize: 11, color: "#6b7280" }}>~${currentModelMeta.costPer1M}/1M tokens · {currentModelMeta.provider}</span>}
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
          {(["DEEPSEEK_API_KEY", "OPENROUTER_API_KEY", "GEMINI_API_KEY", "MINIMAX_API_KEY"] as const).map(k => (
            <span key={k} style={{ fontSize: 11, borderRadius: 5, padding: "2px 8px",
              background: envStatus[k] ? "#f0fdf4" : "#fef2f2", color: envStatus[k] ? "#16a34a" : "#dc2626", fontWeight: 600 }}>
              {envStatus[k] ? "✓" : "✗"} {k}
            </span>
          ))}
        </div>
        {feature.updated_at && (
          <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 8 }}>
            Cập nhật lần cuối: {new Date(feature.updated_at).toLocaleString("vi-VN")}
            {feature.updated_by && ` bởi ${feature.updated_by}`}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Cost Bar Chart (CSS only) ─────────────────────────────────────────────────

function DayBarChart({ byDay }: { byDay: UsageSummary["by_day"] }) {
  if (!byDay.length) return <div style={{ color: "#9ca3af", fontSize: 12, textAlign: "center", padding: 16 }}>Chưa có dữ liệu</div>
  const max = Math.max(...byDay.map(d => Number(d.cost_usd)), 0.000001)
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 80, marginTop: 8 }}>
      {byDay.map(d => {
        const h = Math.max(2, Math.round((Number(d.cost_usd) / max) * 72))
        const label = d.day?.slice(5) // MM-DD
        return (
          <div key={d.day} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}
            title={`${d.day}: ${fmtCost(Number(d.cost_usd))} · ${d.calls} calls`}>
            <div style={{ width: "100%", height: h, background: "#7c3aed", borderRadius: "3px 3px 0 0", opacity: 0.8 }} />
            <div style={{ fontSize: 9, color: "#9ca3af", transform: "rotate(-30deg)", transformOrigin: "top center", whiteSpace: "nowrap" }}>{label}</div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Usage Tab ─────────────────────────────────────────────────────────────────

function UsageTab() {
  const [days, setDays] = useState(7)
  const [filterFeature, setFilterFeature] = useState("")
  const [data, setData] = useState<{ summary: UsageSummary; logs: UsageLog[]; total: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const LIMIT = 30
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function load(d = days, f = filterFeature, p = page) {
    setLoading(true)
    try {
      const params = new URLSearchParams({ days: String(d), limit: String(LIMIT), offset: String(p * LIMIT) })
      if (f) params.set("feature", f)
      const res = await apiJson(`/admin/ai-usage?${params}`, "GET")
      setData(res)
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // Auto-refresh 30s
  useEffect(() => {
    intervalRef.current = setInterval(() => load(), 30_000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [days, filterFeature, page])

  function handleFilter(d: number, f: string) {
    setDays(d); setFilterFeature(f); setPage(0); load(d, f, 0)
  }

  const summary = data?.summary
  const logs = data?.logs ?? []

  return (
    <div>
      {/* Filter bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        {[7, 14, 30].map(d => (
          <button key={d} onClick={() => handleFilter(d, filterFeature)}
            style={{ padding: "5px 14px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12, fontWeight: days === d ? 700 : 400,
              background: days === d ? "#7c3aed" : "#fff", color: days === d ? "#fff" : "#374151", cursor: "pointer" }}>
            {d} ngày
          </button>
        ))}
        <select value={filterFeature} onChange={e => handleFilter(days, e.target.value)}
          style={{ border: "1px solid #d1d5db", borderRadius: 6, padding: "5px 10px", fontSize: 12 }}>
          <option value="">Tất cả feature</option>
          {Object.entries(FEATURE_META).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
        </select>
        <button onClick={() => load()} style={{ marginLeft: "auto", background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 12 }}>
          ↻ Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Tổng chi phí", value: fmtCost(Number(summary?.total_cost_usd ?? 0)), sub: `${days} ngày qua`, color: "#7c3aed" },
          { label: "Tổng tokens",  value: fmtTokens(Number(summary?.total_tokens ?? 0)), sub: `${summary?.total_calls ?? 0} lần gọi`, color: "#2563eb" },
          { label: "Trung bình/call", value: summary?.total_calls ? fmtCost(Number(summary.total_cost_usd) / summary.total_calls) : "$0", sub: "cost per call", color: "#059669" },
        ].map(c => (
          <div key={c.label} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "14px 18px" }}>
            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>{c.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: c.color }}>{c.value}</div>
            <div style={{ fontSize: 11, color: "#9ca3af" }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Video Analysis cost card — chỉ hiện khi có data */}
      {(() => {
        const vidFeature = summary?.by_feature?.find(f => f.feature === "video_analysis")
        if (!vidFeature || !vidFeature.calls) return null
        // Mỗi video = 2 calls (transcribe + analyze)
        const vidsAnalyzed = Math.round(vidFeature.calls / 2)
        const costPerVid = vidsAnalyzed > 0 ? Number(vidFeature.cost_usd) / vidsAnalyzed : 0
        const costPerVidVnd = Math.round(costPerVid * 25500)
        return (
          <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 10, padding: "14px 18px", marginBottom: 20, display: "flex", gap: 32, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 20 }}>🎬</span>
            <div>
              <div style={{ fontSize: 11, color: "#92400e", fontWeight: 600, marginBottom: 2 }}>Video Analysis</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#dc6f2a" }}>{fmtCost(Number(vidFeature.cost_usd))}</div>
              <div style={{ fontSize: 11, color: "#9ca3af" }}>{vidFeature.calls} API calls · {vidsAnalyzed} video</div>
            </div>
            <div style={{ borderLeft: "1px solid #fed7aa", paddingLeft: 24 }}>
              <div style={{ fontSize: 11, color: "#92400e", fontWeight: 600, marginBottom: 2 }}>Chi phí/video</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#dc6f2a" }}>{fmtCost(costPerVid)}</div>
              <div style={{ fontSize: 11, color: "#9ca3af" }}>≈ {costPerVidVnd.toLocaleString("vi-VN")} đ/video</div>
            </div>
            <div style={{ borderLeft: "1px solid #fed7aa", paddingLeft: 24 }}>
              <div style={{ fontSize: 11, color: "#92400e", fontWeight: 600, marginBottom: 2 }}>Tokens trung bình/video</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#dc6f2a" }}>{vidsAnalyzed > 0 ? fmtTokens(Math.round(Number(vidFeature.total_tokens) / vidsAnalyzed)) : "—"}</div>
              <div style={{ fontSize: 11, color: "#9ca3af" }}>tổng {fmtTokens(Number(vidFeature.total_tokens))} tokens</div>
            </div>
          </div>
        )
      })()}

      {/* By feature + chart */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
        {/* By feature */}
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 10 }}>Chi phí theo Feature</div>
          {(summary?.by_feature ?? []).length === 0 && <div style={{ color: "#9ca3af", fontSize: 12 }}>Chưa có dữ liệu</div>}
          {(summary?.by_feature ?? []).map(f => {
            const meta = FEATURE_META[f.feature]
            const color = FEATURE_COLORS[f.feature] ?? "#6b7280"
            const pct = summary?.total_cost_usd ? (Number(f.cost_usd) / Number(summary.total_cost_usd)) * 100 : 0
            return (
              <div key={f.feature} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                  <span style={{ color: "#374151" }}>{meta?.icon} {meta?.label ?? f.feature}</span>
                  <span style={{ fontWeight: 700, color }}>{fmtCost(Number(f.cost_usd))} <span style={{ fontWeight: 400, color: "#9ca3af" }}>({f.calls} calls)</span></span>
                </div>
                <div style={{ height: 4, background: "#f3f4f6", borderRadius: 2 }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 2 }} />
                </div>
              </div>
            )
          })}
        </div>

        {/* Day chart */}
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 6 }}>Chi phí theo ngày (USD)</div>
          <DayBarChart byDay={summary?.by_day ?? []} />
        </div>
      </div>

      {/* By model */}
      {(summary?.by_model ?? []).length > 0 && (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 10 }}>Chi phí theo Model</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {(summary?.by_model ?? []).map(m => (
              <div key={m.model} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 14px", fontSize: 12 }}>
                <div style={{ fontWeight: 700, color: "#374151" }}>{m.model}</div>
                <div style={{ color: "#6b7280", fontSize: 11 }}>{m.provider} · {m.calls} calls · {fmtTokens(Number(m.total_tokens))} tokens</div>
                <div style={{ color: "#7c3aed", fontWeight: 700, marginTop: 2 }}>{fmtCost(Number(m.cost_usd))}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Log table */}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>Log chi tiết ({data?.total ?? 0} bản ghi)</div>
          {loading && <span style={{ fontSize: 11, color: "#9ca3af" }}>Đang tải…</span>}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f9fafb" }}>
                {["Feature", "Model", "Prompt", "Completion", "Total", "Chi phí", "Context", "Thời gian"].map(h => (
                  <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "#6b7280", fontWeight: 600, whiteSpace: "nowrap", borderBottom: "1px solid #f3f4f6" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 24, textAlign: "center", color: "#9ca3af" }}>Chưa có log</td></tr>
              )}
              {logs.map(log => {
                const meta = FEATURE_META[log.feature]
                const color = FEATURE_COLORS[log.feature] ?? "#6b7280"
                const ctx = log.context ? (typeof log.context === "string" ? JSON.parse(log.context) : log.context) : {}
                const ctxStr = Object.entries(ctx).map(([k, v]) => `${k}:${v}`).join(" ").slice(0, 40)
                return (
                  <tr key={log.id} style={{ borderBottom: "1px solid #f9fafb" }}>
                    <td style={{ padding: "7px 12px" }}>
                      <span style={{ background: color + "18", color, borderRadius: 5, padding: "2px 7px", fontWeight: 600, fontSize: 11 }}>
                        {meta?.icon} {meta?.label ?? log.feature}
                      </span>
                    </td>
                    <td style={{ padding: "7px 12px", color: "#374151", whiteSpace: "nowrap" }}>{log.model.split("/").pop()}</td>
                    <td style={{ padding: "7px 12px", color: "#6b7280", textAlign: "right" }}>{fmtTokens(log.prompt_tokens)}</td>
                    <td style={{ padding: "7px 12px", color: "#6b7280", textAlign: "right" }}>{fmtTokens(log.completion_tokens)}</td>
                    <td style={{ padding: "7px 12px", color: "#374151", textAlign: "right", fontWeight: 600 }}>{fmtTokens(log.total_tokens)}</td>
                    <td style={{ padding: "7px 12px", color: "#7c3aed", fontWeight: 700, textAlign: "right" }}>{fmtCost(Number(log.cost_usd))}</td>
                    <td style={{ padding: "7px 12px", color: "#9ca3af", fontSize: 11 }}>{ctxStr}</td>
                    <td style={{ padding: "7px 12px", color: "#9ca3af", whiteSpace: "nowrap" }}>{fmtDate(log.created_at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        {(data?.total ?? 0) > LIMIT && (
          <div style={{ padding: "10px 16px", borderTop: "1px solid #f3f4f6", display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button disabled={page === 0} onClick={() => { const p = page - 1; setPage(p); load(days, filterFeature, p) }}
              style={{ padding: "4px 12px", borderRadius: 5, border: "1px solid #d1d5db", background: "#fff", cursor: page === 0 ? "not-allowed" : "pointer", fontSize: 12, opacity: page === 0 ? 0.4 : 1 }}>
              ← Trước
            </button>
            <span style={{ fontSize: 12, color: "#6b7280", alignSelf: "center" }}>Trang {page + 1} / {Math.ceil((data?.total ?? 0) / LIMIT)}</span>
            <button disabled={(page + 1) * LIMIT >= (data?.total ?? 0)} onClick={() => { const p = page + 1; setPage(p); load(days, filterFeature, p) }}
              style={{ padding: "4px 12px", borderRadius: 5, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer", fontSize: 12, opacity: (page + 1) * LIMIT >= (data?.total ?? 0) ? 0.4 : 1 }}>
              Sau →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AiSettingsPage() {
  const [tab, setTab] = useState<"config" | "usage">("config")
  const [features, setFeatures] = useState<Feature[]>([])
  const [models, setModels] = useState<ModelOption[]>([])
  const [envStatus, setEnvStatus] = useState<EnvStatus>({ DEEPSEEK_API_KEY: false, OPENROUTER_API_KEY: false, GEMINI_API_KEY: false, MINIMAX_API_KEY: false })
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  async function load() {
    setLoading(true)
    try {
      const d = await apiJson("/admin/ai-config", "GET")
      setFeatures(d.features ?? []); setModels(d.available_models ?? []); setEnvStatus(d.env_status ?? {})
    } catch { }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleSave(key: string, patch: Partial<Feature>) {
    try {
      const d = await apiJson("/admin/ai-config", "PATCH", { key, ...patch })
      if (d.ok) {
        setFeatures(fs => fs.map(f => f.key === key ? { ...f, ...d.feature } : f))
        showToast(patch.enabled !== undefined
          ? `${FEATURE_META[key]?.label ?? key} đã ${patch.enabled ? "BẬT" : "TẮT"}`
          : "Đã lưu cấu hình")
      }
    } catch (err: any) { showToast("Lỗi: " + err.message) }
  }

  const enabledCount = features.filter(f => f.enabled).length

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
      {toast && (
        <div style={{ position: "fixed", top: 20, right: 24, zIndex: 9999, background: "#111827", color: "#fff",
          borderRadius: 8, padding: "10px 20px", fontSize: 13, fontWeight: 600, boxShadow: "0 4px 20px rgba(0,0,0,.25)" }}>
          {toast}
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: "#111827" }}>⚙️ AI Settings</h1>
        <p style={{ fontSize: 13, color: "#6b7280", margin: "4px 0 0" }}>
          Quản lý tính năng AI — cấu hình, theo dõi hoạt động và chi phí
        </p>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 0, marginBottom: 24, borderBottom: "1px solid #e5e7eb" }}>
        {([["config", "⚙️ Cấu hình"], ["usage", "📊 Log & Chi phí"]] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: "9px 20px", border: "none", background: "none", cursor: "pointer", fontSize: 13, fontWeight: tab === t ? 700 : 400,
              color: tab === t ? "#7c3aed" : "#6b7280", borderBottom: tab === t ? "2px solid #7c3aed" : "2px solid transparent",
              marginBottom: -1 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === "config" && (
        <>
          {/* Summary bar */}
          <div style={{ display: "flex", gap: 16, marginBottom: 24, padding: "12px 20px", background: "#f9fafb",
            borderRadius: 10, border: "1px solid #e5e7eb", flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ fontSize: 13, color: "#374151" }}>
              <span style={{ fontWeight: 700, color: "#7c3aed" }}>{enabledCount}</span>/{features.length} features đang bật
            </div>
            <div style={{ height: 16, width: 1, background: "#e5e7eb" }} />
            {(["DEEPSEEK_API_KEY", "OPENROUTER_API_KEY", "GEMINI_API_KEY", "MINIMAX_API_KEY"] as const).map(k => (
              <div key={k} style={{ fontSize: 12, color: envStatus[k] ? "#16a34a" : "#dc2626", fontWeight: 600 }}>
                {envStatus[k] ? "✓" : "✗"} {k.replace("_API_KEY", "")}
              </div>
            ))}
            <button onClick={load} style={{ marginLeft: "auto", background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 12 }}>
              ↻ Refresh
            </button>
          </div>

          {loading ? (
            <div style={{ color: "#9ca3af", textAlign: "center", padding: 48, fontSize: 14 }}>Đang tải…</div>
          ) : features.length === 0 ? (
            <div style={{ color: "#9ca3af", textAlign: "center", padding: 48, fontSize: 14 }}>Chưa có feature nào. Migration chưa chạy?</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {features.map(f => <FeatureCard key={f.key} feature={f} models={models} envStatus={envStatus} onSave={handleSave} />)}
            </div>
          )}

          <div style={{ marginTop: 24, padding: "12px 16px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, fontSize: 12, color: "#92400e" }}>
            💡 Thay đổi model có hiệu lực ngay lần chạy tiếp theo. Tắt feature không dừng run đang chạy dở — chỉ ngăn lần sau.
            API Keys được set trong <strong>Railway Variables</strong>, không thể thay đổi từ đây.
          </div>
        </>
      )}

      {tab === "usage" && <UsageTab />}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "AI Settings", rank: 17,
  icon: "cog-six-tooth",
})
