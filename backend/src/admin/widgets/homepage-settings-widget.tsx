import { defineWidgetConfig } from "@medusajs/admin-sdk"
import React, { useEffect, useRef, useState } from "react"

type MediaFile = { id: string; url: string }

function MediaPicker({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState<MediaFile[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const loadMedia = async () => {
    setLoading(true)
    try {
      const res = await fetch("/admin/uploads?limit=50", { credentials: "include" })
      const data = await res.json()
      setFiles(data.files ?? [])
    } catch {}
    setLoading(false)
  }

  const handleOpen = () => {
    setOpen(true)
    loadMedia()
  }

  const handleUpload = async (file: File) => {
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append("files", file)
      const res = await fetch("/admin/uploads", {
        method: "POST",
        credentials: "include",
        body: formData,
      })
      const data = await res.json()
      const url = data.files?.[0]?.url
      if (url) {
        onChange(url)
        setOpen(false)
      }
      loadMedia()
    } catch {}
    setUploading(false)
  }

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="URL ảnh hoặc chọn từ Media..."
          style={{ flex: 1, padding: "7px 12px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 13, outline: "none" }}
        />
        <button
          onClick={handleOpen}
          style={{ padding: "7px 12px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 12, cursor: "pointer", background: "white", whiteSpace: "nowrap" }}
        >
          📁 Media
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          style={{ padding: "7px 12px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 12, cursor: "pointer", background: "white", whiteSpace: "nowrap" }}
        >
          {uploading ? "..." : "⬆️ Upload"}
        </button>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f) }} />
      </div>

      {value && (
        <img src={value} alt="" style={{ marginTop: 8, height: 72, width: 128, objectFit: "cover", borderRadius: 8, border: "1px solid #e5e7eb" }} />
      )}

      {open && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setOpen(false)}>
          <div style={{ background: "white", borderRadius: 12, padding: 20, width: 600, maxHeight: "80vh", overflow: "auto" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>📁 Chọn ảnh từ Media</h3>
              <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer" }}>✕</button>
            </div>
            {loading ? (
              <p style={{ textAlign: "center", color: "#6b7280" }}>Đang tải...</p>
            ) : files.length === 0 ? (
              <p style={{ textAlign: "center", color: "#6b7280" }}>Chưa có ảnh nào. Upload ảnh trước.</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                {files.map(f => (
                  <img key={f.id} src={f.url} alt=""
                    onClick={() => { onChange(f.url); setOpen(false) }}
                    style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8, cursor: "pointer", border: value === f.url ? "3px solid #f97316" : "2px solid transparent" }} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const FIELDS = [
  { key: "hero_image", label: "🖼️ Ảnh Hero Banner (ảnh nền toàn màn hình)", type: "image" },
  { key: "cat1_image", label: "📦 Ảnh Danh mục 1", type: "image" },
  { key: "cat2_image", label: "📦 Ảnh Danh mục 2", type: "image" },
  { key: "cat3_image", label: "📦 Ảnh Danh mục 3", type: "image" },
  { key: "promo_image", label: "🎯 Ảnh Banner Khuyến mãi", type: "image" },
  { key: "hero_badge", label: "✨ Badge nhỏ (VD: THƯƠNG HIỆU GIA DỤNG VIỆT)", type: "text" },
  { key: "hero_title_top", label: "Tiêu đề dòng 1 (VD: Nâng tầm)", type: "text" },
  { key: "hero_title_middle", label: "Tiêu đề dòng 2 (VD: không gian)", type: "text" },
  { key: "hero_title_bottom", label: "Tiêu đề dòng 3 — màu cam (VD: sống của bạn)", type: "text" },
  { key: "hero_description", label: "Mô tả ngắn dưới tiêu đề", type: "text" },
  { key: "promo_title", label: "Tiêu đề banner khuyến mãi", type: "text" },
  { key: "promo_desc", label: "Mô tả banner khuyến mãi", type: "text" },
]

function HomepageSettingsWidget() {
  const [meta, setMeta] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string>("")
  const [storeId, setStoreId] = useState<string>("")
  const [loadError, setLoadError] = useState<string>("")

  useEffect(() => {
    fetch("/admin/stores", { credentials: "include" })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(data => {
        const store = data.stores?.[0] ?? data.store
        if (store) {
          setStoreId(store.id)
          setMeta((store.metadata as Record<string, string>) ?? {})
        } else {
          setLoadError("Không tìm thấy store")
        }
      })
      .catch(e => setLoadError(e.message))
  }, [])

  const save = async () => {
    setSaving(true)
    setSaveError("")
    try {
      // Medusa v2: POST /admin/stores (no ID in path, single store)
      const res = await fetch(`/admin/stores`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: meta }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        setSaveError(`Lỗi ${res.status}: ${errData.message || errData.error || res.statusText}`)
      } else {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      }
    } catch (e: any) {
      setSaveError(e.message)
    }
    setSaving(false)
  }

  return (
    <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 12, padding: 24, marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>🏠 Cài đặt Trang chủ</h2>
        <button
          onClick={save}
          disabled={saving}
          style={{ background: saved ? "#22c55e" : "#f97316", color: "white", border: "none", borderRadius: 8, padding: "8px 20px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}
        >
          {saved ? "✅ Đã lưu!" : saving ? "Đang lưu..." : "💾 Lưu"}
        </button>
      </div>
      {loadError && (
        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#dc2626" }}>
          ⚠️ Lỗi load store: {loadError} {!storeId && "— Store ID chưa có, không thể lưu"}
        </div>
      )}
      {saveError && (
        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#dc2626" }}>
          ❌ Lưu thất bại: {saveError}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {FIELDS.map(field => (
          <div key={field.key}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
              {field.label}
            </label>
            {field.type === "image" ? (
              <MediaPicker
                value={meta[field.key] ?? ""}
                onChange={v => setMeta(m => ({ ...m, [field.key]: v }))}
              />
            ) : (
              <input
                type="text"
                value={meta[field.key] ?? ""}
                onChange={e => setMeta(m => ({ ...m, [field.key]: e.target.value }))}
                style={{ width: "100%", padding: "7px 12px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box" }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export const config = defineWidgetConfig({
  zone: "store.details.after",
})

export default HomepageSettingsWidget
