import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useEffect, useState } from "react"
import { apiJson } from "../../lib/api-client"

interface Feature {
  key: string
  enabled: boolean
  model: string | null
  provider: string | null
  notes: string | null
  updated_by: string | null
  updated_at: string | null
}

interface ModelOption {
  id: string
  label: string
  provider: string
  costPer1M: number
}

interface EnvStatus {
  DEEPSEEK_API_KEY: boolean
  OPENROUTER_API_KEY: boolean
}

const FEATURE_META: Record<string, { label: string; desc: string; icon: string; scheduleInfo?: string }> = {
  camp_ai_agent: {
    label: "Camp AI Agent",
    desc: "Phân tích & đề xuất tối ưu Facebook Ads campaign tự động",
    icon: "🤖",
    scheduleInfo: "Chạy mỗi 4 giờ",
  },
  camp_ai_evaluator: {
    label: "Camp AI Evaluator",
    desc: "Model phụ chấm điểm chất lượng recommendation của agent chính",
    icon: "🔍",
    scheduleInfo: "Chạy sau mỗi lần agent kết thúc",
  },
  cskh_analysis: {
    label: "CSKH Analysis",
    desc: "Phân tích đơn hàng & đề xuất action cho team CSKH",
    icon: "💬",
  },
}

function ToggleSwitch({ enabled, onChange, disabled }: { enabled: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => !disabled && onChange(!enabled)}
      disabled={disabled}
      style={{
        width: 48, height: 26, borderRadius: 13, border: "none", cursor: disabled ? "not-allowed" : "pointer",
        background: enabled ? "#7c3aed" : "#d1d5db",
        position: "relative", transition: "background 0.2s", flexShrink: 0,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span style={{
        position: "absolute", top: 3, left: enabled ? 25 : 3,
        width: 20, height: 20, borderRadius: "50%", background: "#fff",
        transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,.2)",
        display: "block",
      }} />
    </button>
  )
}

function FeatureCard({
  feature, models, envStatus, onSave,
}: {
  feature: Feature
  models: ModelOption[]
  envStatus: EnvStatus
  onSave: (key: string, patch: Partial<Feature>) => Promise<void>
}) {
  const meta = FEATURE_META[feature.key] ?? { label: feature.key, desc: "", icon: "⚙️" }
  const [saving, setSaving] = useState(false)
  const [localModel, setLocalModel] = useState(feature.model ?? "")
  const [dirty, setDirty] = useState(false)

  const currentModelMeta = models.find(m => m.id === (localModel || feature.model))
  const needsOpenRouter = currentModelMeta?.provider === "openrouter"
  const needsDeepSeek = currentModelMeta?.provider === "deepseek"
  const keyMissing = (needsOpenRouter && !envStatus.OPENROUTER_API_KEY) || (needsDeepSeek && !envStatus.DEEPSEEK_API_KEY)

  async function handleToggle(val: boolean) {
    setSaving(true)
    await onSave(feature.key, { enabled: val })
    setSaving(false)
  }

  async function handleModelSave() {
    setSaving(true)
    const m = models.find(x => x.id === localModel)
    await onSave(feature.key, { model: localModel, provider: m?.provider ?? null })
    setDirty(false)
    setSaving(false)
  }

  return (
    <div style={{
      border: `1.5px solid ${feature.enabled ? "#e5e7eb" : "#f3f4f6"}`,
      borderRadius: 12, padding: "20px 24px",
      background: feature.enabled ? "#fff" : "#fafafa",
      opacity: feature.enabled ? 1 : 0.7,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 28 }}>{meta.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: "#111827" }}>{meta.label}</span>
            {feature.enabled
              ? <span style={{ background: "#dcfce7", color: "#16a34a", borderRadius: 99, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>● BẬT</span>
              : <span style={{ background: "#f3f4f6", color: "#6b7280", borderRadius: 99, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>● TẮT</span>
            }
            {keyMissing && (
              <span style={{ background: "#fef2f2", color: "#dc2626", borderRadius: 99, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>⚠ API Key thiếu</span>
            )}
          </div>
          <div style={{ fontSize: 13, color: "#6b7280", marginTop: 3 }}>{meta.desc}</div>
          {meta.scheduleInfo && (
            <div style={{ fontSize: 11, color: "#a78bfa", marginTop: 2 }}>⏱ {meta.scheduleInfo}</div>
          )}
        </div>
        <ToggleSwitch enabled={feature.enabled} onChange={handleToggle} disabled={saving} />
      </div>

      {/* Model selector */}
      <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 8 }}>Model AI</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select
            value={localModel}
            onChange={e => { setLocalModel(e.target.value); setDirty(true) }}
            style={{ border: "1px solid #d1d5db", borderRadius: 7, padding: "6px 10px", fontSize: 12, minWidth: 260, background: "#fff" }}
          >
            <option value="">(mặc định)</option>
            {models.map(m => (
              <option key={m.id} value={m.id}>
                {m.label} — ${m.costPer1M}/1M tokens ({m.provider})
              </option>
            ))}
          </select>
          {dirty && (
            <button onClick={handleModelSave} disabled={saving}
              style={{ background: "#7c3aed", color: "#fff", border: "none", borderRadius: 7, padding: "6px 16px", cursor: saving ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700 }}>
              {saving ? "Đang lưu…" : "Lưu model"}
            </button>
          )}
          {currentModelMeta && !dirty && (
            <span style={{ fontSize: 11, color: "#6b7280" }}>
              ~${currentModelMeta.costPer1M}/1M tokens · {currentModelMeta.provider}
            </span>
          )}
        </div>

        {/* Env key status */}
        <div style={{ display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
          {(["DEEPSEEK_API_KEY", "OPENROUTER_API_KEY"] as const).map(k => (
            <span key={k} style={{
              fontSize: 11, borderRadius: 5, padding: "2px 8px",
              background: envStatus[k] ? "#f0fdf4" : "#fef2f2",
              color: envStatus[k] ? "#16a34a" : "#dc2626",
              fontWeight: 600,
            }}>
              {envStatus[k] ? "✓" : "✗"} {k}
            </span>
          ))}
        </div>

        {/* Last updated */}
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

export default function AiSettingsPage() {
  const [features, setFeatures] = useState<Feature[]>([])
  const [models, setModels] = useState<ModelOption[]>([])
  const [envStatus, setEnvStatus] = useState<EnvStatus>({ DEEPSEEK_API_KEY: false, OPENROUTER_API_KEY: false })
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  async function load() {
    setLoading(true)
    try {
      const d = await apiJson("/admin/ai-config", "GET")
      setFeatures(d.features ?? [])
      setModels(d.available_models ?? [])
      setEnvStatus(d.env_status ?? {})
    } catch {}
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
          : "Đã lưu cấu hình"
        )
      }
    } catch (err: any) {
      showToast("Lỗi: " + err.message)
    }
  }

  const enabledCount = features.filter(f => f.enabled).length

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, right: 24, zIndex: 9999,
          background: "#111827", color: "#fff", borderRadius: 8,
          padding: "10px 20px", fontSize: 13, fontWeight: 600,
          boxShadow: "0 4px 20px rgba(0,0,0,.25)",
        }}>
          {toast}
        </div>
      )}

      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: "#111827" }}>⚙️ AI Settings</h1>
        <p style={{ fontSize: 13, color: "#6b7280", margin: "4px 0 0" }}>
          Quản lý các tính năng AI — bật/tắt và chọn model cho từng feature
        </p>
      </div>

      {/* Summary bar */}
      <div style={{
        display: "flex", gap: 16, marginBottom: 24, padding: "12px 20px",
        background: "#f9fafb", borderRadius: 10, border: "1px solid #e5e7eb",
        flexWrap: "wrap", alignItems: "center",
      }}>
        <div style={{ fontSize: 13, color: "#374151" }}>
          <span style={{ fontWeight: 700, color: "#7c3aed" }}>{enabledCount}</span>/{features.length} features đang bật
        </div>
        <div style={{ height: 16, width: 1, background: "#e5e7eb" }} />
        <div style={{ fontSize: 12, color: envStatus.DEEPSEEK_API_KEY ? "#16a34a" : "#dc2626", fontWeight: 600 }}>
          {envStatus.DEEPSEEK_API_KEY ? "✓" : "✗"} DeepSeek API Key
        </div>
        <div style={{ fontSize: 12, color: envStatus.OPENROUTER_API_KEY ? "#16a34a" : "#dc2626", fontWeight: 600 }}>
          {envStatus.OPENROUTER_API_KEY ? "✓" : "✗"} OpenRouter API Key
        </div>
        <button onClick={load} style={{ marginLeft: "auto", background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 12 }}>
          ↻ Refresh
        </button>
      </div>

      {loading ? (
        <div style={{ color: "#9ca3af", textAlign: "center", padding: 48, fontSize: 14 }}>Đang tải…</div>
      ) : features.length === 0 ? (
        <div style={{ color: "#9ca3af", textAlign: "center", padding: 48, fontSize: 14 }}>
          Chưa có feature nào. Migration chưa chạy?
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {features.map(f => (
            <FeatureCard key={f.key} feature={f} models={models} envStatus={envStatus} onSave={handleSave} />
          ))}
        </div>
      )}

      {/* Info note */}
      <div style={{ marginTop: 24, padding: "12px 16px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, fontSize: 12, color: "#92400e" }}>
        💡 Thay đổi model có hiệu lực ngay lần chạy tiếp theo. Tắt feature không dừng run đang chạy dở — chỉ ngăn lần sau.
        API Keys được set trong <strong>Railway Variables</strong>, không thể thay đổi từ đây.
      </div>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "AI Settings",
  icon: "cog-six-tooth",
})
