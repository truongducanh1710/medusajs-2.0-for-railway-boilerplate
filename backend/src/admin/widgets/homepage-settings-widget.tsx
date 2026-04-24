import { defineWidgetConfig } from "@medusajs/admin-sdk"
import React, { useEffect, useRef, useState } from "react"

// ── Image upload + picker ──────────────────────────────────────────────────
function ImageField({ label, hint, value, onChange }: {
  label: string
  hint?: string
  value: string
  onChange: (url: string) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [pickOpen, setPickOpen] = useState(false)
  const [mediaFiles, setMediaFiles] = useState<Array<{ id: string; url: string }>>([])
  const [loadingMedia, setLoadingMedia] = useState(false)

  const openPicker = async () => {
    setPickOpen(true)
    setLoadingMedia(true)
    try {
      const res = await fetch("/admin/uploads?limit=50", { credentials: "include" })
      const data = await res.json()
      setMediaFiles(data.files ?? [])
    } catch {}
    setLoadingMedia(false)
  }

  const handleUpload = async (file: File) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("files", file)
      const res = await fetch("/admin/uploads", { method: "POST", credentials: "include", body: fd })
      const data = await res.json()
      const url = data.files?.[0]?.url
      if (url) onChange(url)
    } catch {}
    setUploading(false)
  }

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 4 }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 6 }}>{hint}</div>}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="URL ảnh..."
          style={{ flex: 1, padding: "7px 10px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 12, outline: "none" }}
        />
        <button onClick={openPicker}
          style={{ padding: "7px 10px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 11, cursor: "pointer", background: "white", whiteSpace: "nowrap" }}>
          📁 Media
        </button>
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          style={{ padding: "7px 10px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 11, cursor: "pointer", background: "white", whiteSpace: "nowrap" }}>
          {uploading ? "..." : "⬆️ Upload"}
        </button>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f) }} />
      </div>
      {value && (
        <img src={value} alt="" style={{ marginTop: 6, height: 64, borderRadius: 6, border: "1px solid #e5e7eb", objectFit: "cover", maxWidth: 160 }} />
      )}

      {pickOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setPickOpen(false)}>
          <div style={{ background: "white", borderRadius: 12, padding: 20, width: 580, maxHeight: "80vh", overflow: "auto" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
              <strong>📁 Chọn ảnh</strong>
              <button onClick={() => setPickOpen(false)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer" }}>✕</button>
            </div>
            {loadingMedia ? <p style={{ color: "#6b7280", textAlign: "center" }}>Đang tải...</p> :
              mediaFiles.length === 0 ? <p style={{ color: "#6b7280", textAlign: "center" }}>Chưa có ảnh nào</p> : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
                  {mediaFiles.map(f => (
                    <img key={f.id} src={f.url} alt=""
                      onClick={() => { onChange(f.url); setPickOpen(false) }}
                      style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8, cursor: "pointer",
                        border: value === f.url ? "3px solid #f97316" : "2px solid transparent" }} />
                  ))}
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  )
}

function TextField({ label, hint, value, onChange, multiline }: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  multiline?: boolean
}) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 4 }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 6 }}>{hint}</div>}
      {multiline ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} rows={2}
          style={{ width: "100%", padding: "7px 10px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 12, outline: "none", resize: "vertical", boxSizing: "border-box" }} />
      ) : (
        <input type="text" value={value} onChange={e => onChange(e.target.value)}
          style={{ width: "100%", padding: "7px 10px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 12, outline: "none", boxSizing: "border-box" }} />
      )}
    </div>
  )
}

// ── Section card wrapper ───────────────────────────────────────────────────
function Section({ title, badge, children }: { title: string; badge?: string; children: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden", marginBottom: 16 }}>
      <div style={{ background: "#f9fafb", padding: "10px 16px", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid #e5e7eb" }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: "#111827" }}>{title}</span>
        {badge && <span style={{ background: "#fef3c7", color: "#92400e", borderRadius: 20, padding: "2px 8px", fontSize: 10, fontWeight: 700 }}>{badge}</span>}
      </div>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>{children}</div>
    </div>
  )
}

// ── Main widget ────────────────────────────────────────────────────────────
function HomepageSettingsWidget() {
  const [meta, setMeta] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState("")
  const [loadError, setLoadError] = useState("")

  const set = (key: string) => (v: string) => setMeta(m => ({ ...m, [key]: v }))
  const val = (key: string) => meta[key] ?? ""

  useEffect(() => {
    fetch("/admin/stores", { credentials: "include" })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(data => {
        const store = data.stores?.[0] ?? data.store
        if (store) setMeta((store.metadata as Record<string, string>) ?? {})
        else setLoadError("Không tìm thấy store")
      })
      .catch(e => setLoadError(e.message))
  }, [])

  const save = async () => {
    setSaving(true)
    setSaveError("")
    try {
      const res = await fetch("/admin/stores", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: meta }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setSaveError(`Lỗi ${res.status}: ${d.message || d.error || res.statusText}`)
      } else {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
        // Revalidate storefront cache
        fetch("/admin/revalidate", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tags: ["store", "homepage"] }),
        }).catch(() => {})
      }
    } catch (e: any) {
      setSaveError(e.message)
    }
    setSaving(false)
  }

  return (
    <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 12, padding: 24, marginTop: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>🏠 Cài đặt Trang chủ</h2>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>Thay đổi ảnh, text trên trang chủ storefront</p>
        </div>
        <button onClick={save} disabled={saving}
          style={{ background: saved ? "#22c55e" : "#f97316", color: "white", border: "none", borderRadius: 8, padding: "10px 24px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
          {saved ? "✅ Đã lưu!" : saving ? "Đang lưu..." : "💾 Lưu thay đổi"}
        </button>
      </div>

      {loadError && (
        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#dc2626" }}>
          ⚠️ Lỗi load: {loadError}
        </div>
      )}
      {saveError && (
        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#dc2626" }}>
          ❌ {saveError}
        </div>
      )}

      {/* Visual map */}
      <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10, padding: 14, marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#0369a1", marginBottom: 10 }}>📐 Sơ đồ trang chủ — bấm vào khu vực để biết field tương ứng</div>
        <div style={{ fontFamily: "monospace", fontSize: 11, color: "#374151", lineHeight: 1.8 }}>
          <div style={{ border: "2px solid #f97316", borderRadius: 6, padding: "6px 10px", marginBottom: 4, background: "#fff7ed" }}>
            🖼️ <strong>Hero Banner</strong> — ảnh nền toàn màn hình (hero_image)
            <br />
            <span style={{ marginLeft: 20 }}>✨ Badge: <em>hero_badge</em></span><br />
            <span style={{ marginLeft: 20 }}>📝 Tiêu đề: <em>hero_title_top</em> + <em>hero_title_middle</em> + <em>hero_title_bottom</em> (cam)</span><br />
            <span style={{ marginLeft: 20 }}>📄 Mô tả: <em>hero_description</em></span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, marginBottom: 4 }}>
            {["cat1_image", "cat2_image", "cat3_image"].map((k, i) => (
              <div key={k} style={{ border: "1px solid #6366f1", borderRadius: 6, padding: "5px 8px", background: "#eef2ff", fontSize: 10 }}>
                📦 Danh mục {i + 1}<br /><em>{k}</em>
              </div>
            ))}
          </div>
          <div style={{ border: "2px solid #ef4444", borderRadius: 6, padding: "6px 10px", background: "#fef2f2" }}>
            🎯 <strong>Banner Khuyến mãi</strong> — (promo_image = ảnh nền mờ bên phải)
            <br />
            <span style={{ marginLeft: 20 }}>📝 Tiêu đề: <em>promo_title</em> &nbsp;|&nbsp; Mô tả: <em>promo_desc</em></span>
          </div>
        </div>
      </div>

      {/* Section 1: Hero Banner */}
      <Section title="🖼️ Section 1 — Hero Banner (ảnh nền toàn màn hình)" badge="Ảnh to nhất">
        <ImageField label="Ảnh nền Hero" hint="Ảnh full màn hình phía sau tiêu đề. Khuyến nghị: 1920×870px, chủ thể nằm phía phải." value={val("hero_image")} onChange={set("hero_image")} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <TextField label="✨ Badge nhỏ trên tiêu đề" hint='VD: "THƯƠNG HIỆU GIA DỤNG VIỆT"' value={val("hero_badge")} onChange={set("hero_badge")} />
          <TextField label="📄 Mô tả ngắn" hint="Dòng mô tả nhỏ bên dưới tiêu đề" value={val("hero_description")} onChange={set("hero_description")} multiline />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <TextField label='Tiêu đề dòng 1 — trắng' hint='VD: "Nâng tầm"' value={val("hero_title_top")} onChange={set("hero_title_top")} />
          <TextField label='Tiêu đề dòng 2 — trắng' hint='VD: "không gian"' value={val("hero_title_middle")} onChange={set("hero_title_middle")} />
          <TextField label='Tiêu đề dòng 3 — màu cam 🟠' hint='VD: "sống của bạn"' value={val("hero_title_bottom")} onChange={set("hero_title_bottom")} />
        </div>
      </Section>

      {/* Section 2: Category images */}
      <Section title="📦 Section 2 — 3 Danh mục nổi bật (grid ảnh lớn)">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <ImageField label="Danh mục 1 (trái)" hint="Khuyến nghị: 600×500px" value={val("cat1_image")} onChange={set("cat1_image")} />
          <ImageField label="Danh mục 2 (giữa)" hint="Khuyến nghị: 600×500px" value={val("cat2_image")} onChange={set("cat2_image")} />
          <ImageField label="Danh mục 3 (phải)" hint="Khuyến nghị: 600×500px" value={val("cat3_image")} onChange={set("cat3_image")} />
        </div>
      </Section>

      {/* Section 3: Promo banner */}
      <Section title="🎯 Section 3 — Banner Khuyến mãi (nền cam đỏ)">
        <ImageField label="Ảnh trang trí bên phải banner" hint="Ảnh mờ 20% opacity, nằm góc phải. VD: ảnh sản phẩm nổi bật. 600×400px." value={val("promo_image")} onChange={set("promo_image")} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
          <TextField label="Tiêu đề banner" hint='VD: "ƯU ĐÃI ĐẶC BIỆT"' value={val("promo_title")} onChange={set("promo_title")} />
          <TextField label="Mô tả banner" hint='VD: "Giảm giá lên đến 50%..."' value={val("promo_desc")} onChange={set("promo_desc")} multiline />
        </div>
      </Section>

      {/* Save button bottom */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
        <button onClick={save} disabled={saving}
          style={{ background: saved ? "#22c55e" : "#f97316", color: "white", border: "none", borderRadius: 8, padding: "10px 28px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
          {saved ? "✅ Đã lưu!" : saving ? "Đang lưu..." : "💾 Lưu thay đổi"}
        </button>
      </div>
    </div>
  )
}

export const config = defineWidgetConfig({
  zone: "store.details.after",
})

export default HomepageSettingsWidget
