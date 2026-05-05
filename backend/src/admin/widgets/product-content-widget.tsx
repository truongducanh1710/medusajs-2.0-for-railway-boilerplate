import { defineWidgetConfig } from "@medusajs/admin-sdk"
import React, { useEffect, useRef, useState } from "react"
import ProductPageBuilder from "../components/product-page-builder"

// ─── Version history types ────────────────────────────────────────────────────
type ContentVersion = {
  id: string          // timestamp-based unique ID
  savedAt: string     // ISO date string
  savedBy: string     // user email or name
  savedByAvatar: string // first letter
  label: string       // auto-label: "Lần lưu 1", or custom
  content: string     // page_content JSON
  size: number        // content byte size
}

const MAX_VERSIONS = 5

function buildVersionId() {
  return `v_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

function formatRelativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (mins < 1) return "vừa xong"
  if (mins < 60) return `${mins} phút trước`
  if (hours < 24) return `${hours} giờ trước`
  return `${days} ngày trước`
}

// ─── Version History Panel ────────────────────────────────────────────────────
function VersionHistoryPanel({
  versions,
  currentContent,
  onRestore,
  onClose,
}: {
  versions: ContentVersion[]
  currentContent: string
  onRestore: (v: ContentVersion) => void
  onClose: () => void
}) {
  const [selected, setSelected] = useState<ContentVersion | null>(null)
  const [restoring, setRestoring] = useState(false)

  const handleRestore = async (v: ContentVersion) => {
    if (!window.confirm(`Khôi phục phiên bản lưu lúc ${new Date(v.savedAt).toLocaleString("vi-VN")} bởi ${v.savedBy}?\n\nNội dung hiện tại sẽ được lưu vào lịch sử.`)) return
    setRestoring(true)
    await onRestore(v)
    setRestoring(false)
    onClose()
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}>
      <div style={{ background: "white", borderRadius: 16, width: 680, maxHeight: "85vh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: "18px 24px", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>🕐 Lịch sử phiên bản</div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>Tối đa {MAX_VERSIONS} phiên bản gần nhất. Click để xem trước, bấm "Khôi phục" để dùng lại.</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#6b7280" }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Version list */}
          <div style={{ width: 280, borderRight: "1px solid #e5e7eb", overflow: "y-auto", overflowY: "auto" }}>
            {/* Current */}
            <div style={{ padding: "12px 16px", background: "#f0fdf4", borderBottom: "1px solid #e5e7eb" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#15803d", textTransform: "uppercase", letterSpacing: 1 }}>● Hiện tại</div>
              <div style={{ fontSize: 12, color: "#374151", marginTop: 4 }}>{formatBytes(currentContent?.length || 0)}</div>
            </div>
            {versions.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>Chưa có phiên bản nào được lưu</div>
            ) : (
              versions.map((v, i) => (
                <div key={v.id}
                  onClick={() => setSelected(selected?.id === v.id ? null : v)}
                  style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6", cursor: "pointer", background: selected?.id === v.id ? "#eff6ff" : "white", transition: "background 0.15s" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: `hsl(${(v.savedBy.charCodeAt(0) * 47) % 360}, 60%, 55%)`, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                      {v.savedByAvatar}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#111827" }}>
                        Phiên bản {versions.length - i}
                      </div>
                      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 1 }}>{v.savedBy}</div>
                    </div>
                    <div style={{ fontSize: 10, color: "#9ca3af", textAlign: "right", flexShrink: 0 }}>
                      <div>{formatRelativeTime(v.savedAt)}</div>
                      <div>{formatBytes(v.size)}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 6 }}>
                    {new Date(v.savedAt).toLocaleString("vi-VN")}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Preview pane */}
          <div style={{ flex: 1, overflow: "auto", padding: 20, background: "#f9fafb" }}>
            {selected ? (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>Xem trước nội dung</div>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>Lưu bởi {selected.savedBy} — {new Date(selected.savedAt).toLocaleString("vi-VN")}</div>
                  </div>
                  <button onClick={() => handleRestore(selected)} disabled={restoring}
                    style={{ background: "#f97316", color: "white", border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: restoring ? "not-allowed" : "pointer" }}>
                    {restoring ? "Đang khôi phục..." : "↩ Khôi phục phiên bản này"}
                  </button>
                </div>
                <div style={{ background: "white", borderRadius: 8, border: "1px solid #e5e7eb", padding: 16, fontSize: 11, fontFamily: "monospace", color: "#374151", wordBreak: "break-all", maxHeight: 400, overflow: "auto", lineHeight: 1.6 }}>
                  {(() => {
                    try {
                      const d = JSON.parse(selected.content)
                      return d.html ? `HTML (${formatBytes(d.html.length)}):\n${d.html.slice(0, 800)}${d.html.length > 800 ? "..." : ""}` : selected.content.slice(0, 800)
                    } catch { return selected.content.slice(0, 800) }
                  })()}
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "#9ca3af" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>👈</div>
                <div style={{ fontSize: 13 }}>Chọn một phiên bản để xem trước</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Builds storefront link from current admin URL pattern
// Railway: backend = backend-xxx.railway.app, storefront = storefront-xxx.railway.app
// Local: localhost:9000 → localhost:8000
function getStorefrontBase(): string {
  if (typeof window === "undefined") return "http://localhost:8000"
  const host = window.location.host
  // Custom domain
  if (host === "api.phanviet.vn" || host === "phanviet.vn") return "https://www.phanviet.vn"
  // Railway pattern: replace "backend-production" with "storefront-production"
  if (host.includes("backend-") && host.includes("railway.app")) {
    return `https://${host.replace(/^backend-/, "storefront-")}`
  }
  // Local dev
  return host.includes(":") ? `http://${host.replace(":9000", ":8000")}` : `https://www.phanviet.vn`
}

function StorefrontLink({ handle }: { handle: string }) {
  const url = `${getStorefrontBase()}/vn/products/${handle}`
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      style={{ marginLeft: 10, color: "#f97316", fontWeight: 700, textDecoration: "none", fontSize: 12 }}
    >
      🔗 Xem trên storefront ↗
    </a>
  )
}

// ─── Types ───────────────────────────────────────────────────────────────────

type Benefit = { icon: string; title: string; desc: string }
type FAQItem = { q: string; a: string }
type GiftItem = { name: string; value: number; image?: string }
type ReviewItem = { name: string; location: string; rating: number; text: string; date: string }
type BundleOptionMeta = { qty: number; label: string; price: number; originalPrice: number; badge?: string; badgeColor?: string; gifts?: GiftItem[]; image?: string }
type VariantBundleConfig = { variantId: string; label: string; image?: string; options: BundleOptionMeta[] }

type Meta = {
  video_url?: string
  pain_1?: string; pain_2?: string; pain_3?: string
  solution_1?: string; solution_2?: string; solution_3?: string
  benefit_icon_1?: string; benefit_title_1?: string; benefit_desc_1?: string
  benefit_icon_2?: string; benefit_title_2?: string; benefit_desc_2?: string
  benefit_icon_3?: string; benefit_title_3?: string; benefit_desc_3?: string
  benefit_icon_4?: string; benefit_title_4?: string; benefit_desc_4?: string
  chat_lieu?: string; kich_thuoc?: string; xuat_xu?: string
  bao_hanh?: string; mau_sac?: string; trong_luong?: string
  reviews?: string
  faq?: string
  bundle_gifts?: string
  bundle_options?: string
  bundle_options_v2?: string
  page_content?: string
  fb_pixel_id?: string
  fb_capi_token?: string
  [key: string]: string | undefined
}

// ─── Helper Components ────────────────────────────────────────────────────────

const Input = ({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string
}) => (
  <div style={{ marginBottom: 8 }}>
    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 4 }}>
      {label}
    </label>
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: "100%", padding: "6px 10px", border: "1px solid #e5e7eb",
        borderRadius: 6, fontSize: 13, outline: "none", boxSizing: "border-box"
      }}
    />
  </div>
)

const Toggle = ({ label, enabled, onToggle, children }: {
  label: string; enabled: boolean; onToggle: () => void; children?: React.ReactNode
}) => (
  <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, marginBottom: 12, overflow: "visible" }}>
    <div
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px", background: enabled ? "#f0fdf4" : "#f9fafb",
        cursor: "pointer"
      }}
      onClick={onToggle}
    >
      <span style={{ fontWeight: 700, fontSize: 13, color: "#111827" }}>{label}</span>
      <div style={{
        width: 36, height: 20, borderRadius: 10, background: enabled ? "#22c55e" : "#d1d5db",
        position: "relative", transition: "background 0.2s"
      }}>
        <div style={{
          position: "absolute", top: 2, left: enabled ? 18 : 2,
          width: 16, height: 16, borderRadius: "50%", background: "white",
          transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)"
        }} />
      </div>
    </div>
    {enabled && children && (
      <div style={{ padding: "12px 14px", background: "white", borderTop: "1px solid #e5e7eb" }}>
        {children}
      </div>
    )}
  </div>
)

// ─── Main Widget ──────────────────────────────────────────────────────────────

function ImagePicker({
  value,
  onChange,
  productImages,
}: {
  value: string
  onChange: (url: string) => void
  productImages: Array<{ id: string; url: string }>
}) {
  const [showPicker, setShowPicker] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const extractUploadedUrl = (data: any) =>
    data?.files?.[0]?.url ||
    data?.files?.[0]?.location ||
    data?.uploads?.[0]?.url ||
    data?.uploads?.[0]?.location ||
    data?.url ||
    data?.file?.url ||
    data?.upload?.url ||
    ""

  const handleUpload = async (file: File) => {
    try {
      setUploading(true)
      const formData = new FormData()
      formData.append("files", file)
      const res = await fetch("/admin/uploads", {
        method: "POST",
        credentials: "include",
        body: formData,
      })
      const data = await res.json()
      const url = extractUploadedUrl(data)
      if (url) {
        onChange(url)
        setShowPicker(false)
      }
    } finally {
      setUploading(false)
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="URL ảnh (để trống = dùng thumbnail SP)"
          style={{
            flex: 1,
            padding: "6px 10px",
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            fontSize: 13,
            boxSizing: "border-box",
          }}
        />
        {productImages.length > 0 && (
          <button
            type="button"
            onClick={() => setShowPicker(v => !v)}
            style={{
              padding: "6px 10px",
              border: "1px solid #e5e7eb",
              borderRadius: 6,
              fontSize: 12,
              cursor: "pointer",
              background: "white",
              whiteSpace: "nowrap",
            }}
          >
            📷 Chọn ảnh ▾
          </button>
        )}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          style={{
            padding: "6px 10px",
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            fontSize: 12,
            cursor: "pointer",
            background: "white",
            whiteSpace: "nowrap",
            opacity: uploading ? 0.6 : 1,
          }}
        >
          {uploading ? "..." : "⬆️ Upload"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) void handleUpload(f)
            e.currentTarget.value = ""
          }}
        />
      </div>

      {value && (
        <img
          src={value}
          alt=""
          style={{
            marginTop: 6,
            width: 56,
            height: 56,
            objectFit: "cover",
            borderRadius: 6,
            border: "1px solid #e5e7eb",
          }}
        />
      )}

      {showPicker && productImages.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 50,
            background: "white",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            padding: 8,
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
            display: "grid",
            gridTemplateColumns: "repeat(4, 60px)",
            gap: 6,
            overflow: "visible",
          }}
        >
          {productImages.map(img => (
            <img
              key={img.id}
              src={img.url}
              alt=""
              onClick={() => {
                onChange(img.url)
                setShowPicker(false)
              }}
              style={{
                width: 60,
                height: 60,
                objectFit: "cover",
                borderRadius: 6,
                cursor: "pointer",
                border: value === img.url ? "2px solid #3b82f6" : "2px solid transparent",
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Product Image Upload Section ────────────────────────────────────────────

function ProductImageUpload({ productId, initialImages }: {
  productId: string
  initialImages: Array<{ id: string; url: string }>
}) {
  const [images, setImages] = useState(initialImages)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState("")
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const uploadFiles = async (files: FileList | File[]) => {
    setUploading(true)
    setError("")
    const uploaded: Array<{ id: string; url: string }> = []
    for (const file of Array.from(files)) {
      try {
        const formData = new FormData()
        formData.append("files", file)
        const res = await fetch("/admin/uploads", { method: "POST", credentials: "include", body: formData })
        const data = await res.json()
        const url = data?.files?.[0]?.url || data?.uploads?.[0]?.url || ""
        if (url) uploaded.push({ id: url, url })
      } catch {}
    }
    if (uploaded.length > 0) {
      setImages(prev => [...prev, ...uploaded])
    }
    setUploading(false)
  }

  const removeImage = (url: string) => {
    setImages(prev => prev.filter(img => img.url !== url))
  }

  const moveImage = (from: number, to: number) => {
    if (from === to) return
    setImages(prev => {
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }

  const saveImages = async () => {
    setSaving(true)
    setError("")
    try {
      const res = await fetch(`/admin/products/${productId}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images: images.map(img => ({ url: img.url })),
        }),
      })
      if (!res.ok) throw new Error("Lưu ảnh thất bại")
      // Revalidate via backend proxy (avoid CORS)
      fetch("/admin/revalidate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: ["products"] }),
      }).catch(() => {})
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, marginBottom: 16, overflow: "hidden" }}>
      <div style={{ background: "#fafafa", padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #e5e7eb" }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: "#111827" }}>🖼️ Ảnh sản phẩm (upload tối đa 5MB)</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {saved && <span style={{ fontSize: 12, color: "#22c55e", fontWeight: 600 }}>✓ Đã lưu!</span>}
          {error && <span style={{ fontSize: 12, color: "#ef4444" }}>{error}</span>}
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            style={{ padding: "5px 12px", border: "1px dashed #f97316", borderRadius: 6, fontSize: 12, cursor: "pointer", background: "white", color: "#f97316", fontWeight: 600 }}
          >
            {uploading ? "Đang upload..." : "⬆️ Chọn ảnh"}
          </button>
          <button
            onClick={saveImages}
            disabled={saving || images.length === 0}
            style={{ padding: "5px 12px", border: "none", borderRadius: 6, fontSize: 12, cursor: "pointer", background: "#f97316", color: "white", fontWeight: 700, opacity: images.length === 0 ? 0.5 : 1 }}
          >
            {saving ? "Đang lưu..." : "💾 Lưu ảnh"}
          </button>
        </div>
      </div>
      <div
        style={{ padding: 14, background: "white" }}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files) }}
      >
        {/* Drop zone khi chưa có ảnh */}
        {images.length === 0 && (
          <div style={{
            border: `2px dashed ${dragOver ? "#f97316" : "#d1d5db"}`,
            borderRadius: 8, padding: "32px 16px", textAlign: "center",
            color: "#9ca3af", fontSize: 13, background: dragOver ? "#fff7ed" : "#f9fafb",
            transition: "all 0.2s", cursor: "pointer"
          }} onClick={() => fileRef.current?.click()}>
            <div style={{ fontSize: 28, marginBottom: 6 }}>📸</div>
            <p style={{ margin: 0, fontWeight: 600 }}>Kéo thả ảnh vào đây hoặc click để chọn</p>
            <p style={{ margin: "4px 0 0", fontSize: 11 }}>JPG, PNG — tối đa 5MB mỗi ảnh</p>
          </div>
        )}
        {/* Grid ảnh đã có */}
        {images.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 8 }}>
            {images.map((img, i) => (
              <div key={img.url} style={{ position: "relative", borderRadius: 10 }}>
                <img
                  src={img.url}
                  alt=""
                  style={{
                    width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8,
                    border: "2px solid #e5e7eb", display: "block"
                  }}
                />
                {/* Nút di chuyển trái/phải */}
                <div style={{ position: "absolute", bottom: 4, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 2 }}>
                  {i > 0 && (
                    <button
                      onClick={() => moveImage(i, i - 1)}
                      style={{ width: 20, height: 20, borderRadius: 4, background: "rgba(0,0,0,0.6)", color: "white", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700, padding: 0, lineHeight: "20px" }}
                    >←</button>
                  )}
                  {i < images.length - 1 && (
                    <button
                      onClick={() => moveImage(i, i + 1)}
                      style={{ width: 20, height: 20, borderRadius: 4, background: "rgba(0,0,0,0.6)", color: "white", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700, padding: 0, lineHeight: "20px" }}
                    >→</button>
                  )}
                </div>
                {/* Nút xóa */}
                <button
                  onClick={() => removeImage(img.url)}
                  style={{ position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: "50%", background: "#ef4444", color: "white", border: "2px solid white", cursor: "pointer", fontSize: 13, fontWeight: 700, lineHeight: "18px", padding: 0, textAlign: "center", zIndex: 10 }}
                >×</button>
              </div>
            ))}
            {/* Add more */}
            <div
              onClick={() => fileRef.current?.click()}
              style={{ aspectRatio: "1", border: "2px dashed #d1d5db", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#9ca3af", fontSize: 24, background: "#f9fafb" }}
            >+</div>
          </div>
        )}
        <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 8, marginBottom: 0 }}>Dùng ← → để đổi thứ tự. Kéo file từ máy vào đây để upload.</p>
      </div>
      <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }}
        onChange={e => { if (e.target.files) { uploadFiles(e.target.files); e.target.value = "" } }} />
    </div>
  )
}

// ─── Main Widget ──────────────────────────────────────────────────────────────

const ProductContentWidget = ({ data }: { data: any }) => {
  const product = data
  const [meta, setMeta] = useState<Meta>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState("")
  const [builderOpen, setBuilderOpen] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [versions, setVersions] = useState<ContentVersion[]>([])
  const [currentUser, setCurrentUser] = useState({ email: "unknown", name: "?" })

  // Fetch current logged-in user
  useEffect(() => {
    fetch("/admin/me", { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        const u = d.user
        if (u) setCurrentUser({ email: u.email || "unknown", name: u.first_name || u.email?.split("@")[0] || "?" })
      })
      .catch(() => {})
  }, [])

  // Sections toggle state
  const [showVideo, setShowVideo] = useState(false)
  const [showPain, setShowPain] = useState(false)
  const [showBenefits, setShowBenefits] = useState(false)
  const [showSpecs, setShowSpecs] = useState(false)
  const [showReviews, setShowReviews] = useState(false)
  const [showFaq, setShowFaq] = useState(false)
  const [showBundleOptions, setShowBundleOptions] = useState(false)

  // Variant bundle state — fetch variants vì data prop không include
  const [productVariants, setProductVariants] = useState<Array<{ id: string; title: string }>>([])
  const isMultiVariant = productVariants.length > 1
  const [variantBundles, setVariantBundles] = useState<VariantBundleConfig[]>([])
  const [activeVariantTab, setActiveVariantTab] = useState(0)

  useEffect(() => {
    fetch(`/admin/products/${product.id}`, { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        const variants: Array<{ id: string; title: string }> = d.product?.variants || []
        console.log("[widget] fetched variants:", variants)
        const filtered = variants.filter(v => v.title !== "Default Title" && v.title !== "Mặc định" && v.title !== "default")
        setProductVariants(filtered.length > 0 ? filtered : variants)
      })
      .catch(e => { console.error("[widget] fetch variants error:", e) })
  }, [product.id])

  // FAQ & Bundle local state
  const [faqs, setFaqs] = useState<FAQItem[]>([{ q: "", a: "" }])
  const [bundleOptions, setBundleOptions] = useState<BundleOptionMeta[]>([
    { qty: 1, label: "1 SẢN PHẨM", price: 0, originalPrice: 0, gifts: [] },
    { qty: 2, label: "MUA 1 TẶNG 1", price: 0, originalPrice: 0, badge: "HÔM NAY THÔI", badgeColor: "bg-orange-500", gifts: [{ name: "", value: 0 }] },
    { qty: 3, label: "MUA 2 TẶNG 1", price: 0, originalPrice: 0, badge: "TIẾT KIỆM NHẤT 🔥", badgeColor: "bg-red-500", gifts: [{ name: "", value: 0 }] },
  ])
  const [reviews, setReviews] = useState<ReviewItem[]>([
    { name: "", location: "", rating: 5, text: "", date: "" }
  ])
  const productImages = Array.isArray(product?.images)
    ? product.images
        .map((img: any, index: number) => ({
          id: String(img?.id ?? index),
          url: String(img?.url ?? img?.image_url ?? img?.src ?? ""),
        }))
        .filter((img: { id: string; url: string }) => Boolean(img.url))
    : []

  useEffect(() => {
    const m = (product.metadata as Meta) || {}
    applyMeta(m)
    // Load version history
    try {
      const vv = m.page_content_versions ? JSON.parse(m.page_content_versions as string) : []
      setVersions(Array.isArray(vv) ? vv : [])
    } catch { setVersions([]) }
  }, [product.id])

  const setM = (key: string, val: string) => setMeta(prev => ({ ...prev, [key]: val }))

  const buildMeta = (overrides: Partial<Meta> = {}): Record<string, any> => {
    const m: Record<string, any> = { ...meta, ...overrides }
    // Medusa merge metadata — phải set null để xóa key trên server
    if (!showVideo) { m.video_url = null }
    if (!showPain) { m.pain_1 = null; m.pain_2 = null; m.pain_3 = null; m.solution_1 = null; m.solution_2 = null; m.solution_3 = null }
    if (!showBenefits) {
      for (let i = 1; i <= 4; i++) {
        m[`benefit_icon_${i}`] = null; m[`benefit_title_${i}`] = null; m[`benefit_desc_${i}`] = null
      }
    }
    if (!showSpecs) { m.chat_lieu = null; m.kich_thuoc = null; m.xuat_xu = null; m.bao_hanh = null; m.mau_sac = null; m.trong_luong = null }
    if (showReviews) m.reviews = JSON.stringify(reviews)
    else m.reviews = null
    if (showFaq) m.faq = JSON.stringify(faqs.filter((f: any) => f.q))
    else m.faq = null
    m.bundle_gifts = null
    if (showBundleOptions) {
      const sanitizeOpts = (opts: any[]) => opts.map((o: any) => ({
        qty: Number(o.qty) || 0,
        label: String(o.label || ""),
        price: Number(o.price) || 0,
        originalPrice: Number(o.originalPrice) || 0,
        badge: o.badge ? String(o.badge) : undefined,
        badgeColor: o.badgeColor ? String(o.badgeColor) : undefined,
        image: o.image ? String(o.image) : undefined,
        gifts: Array.isArray(o.gifts)
          ? o.gifts.map((g: any) => ({ name: String(g.name || ""), value: Number(g.value) || 0, image: g.image ? String(g.image) : undefined }))
          : [],
      }))
      if (isMultiVariant && variantBundles.length > 0) {
        m.bundle_options_v2 = JSON.stringify({ variants: variantBundles.map(vb => ({ ...vb, options: sanitizeOpts(vb.options) })) })
        m.bundle_options = null
      } else {
        m.bundle_options = JSON.stringify(sanitizeOpts(bundleOptions))
        m.bundle_options_v2 = null
      }
    } else { m.bundle_options = null; m.bundle_options_v2 = null }
    // Keep page_content unless explicitly cleared
    if (overrides.page_content !== undefined) {
      if (!overrides.page_content || !String(overrides.page_content).trim()) m.page_content = null
    } else if (!m.page_content || !String(m.page_content).trim()) {
      m.page_content = null
    }
    return m
  }

  const applyMeta = (m: Record<string, any>) => {
    // Lọc null ra khỏi meta state (null = đã xóa trên server)
    const clean: Meta = Object.fromEntries(Object.entries(m).filter(([, v]) => v !== null && v !== undefined)) as Meta
    setMeta(clean)
    setShowVideo(!!clean.video_url)
    setShowPain(!!(clean.pain_1 || clean.pain_2 || clean.pain_3))
    setShowBenefits(!!(clean.benefit_title_1))
    setShowSpecs(!!(clean.chat_lieu || clean.kich_thuoc || clean.xuat_xu || clean.bao_hanh))
    setShowReviews(!!clean.reviews)
    setShowFaq(!!clean.faq)
    setShowBundleOptions(!!(clean.bundle_options || clean.bundle_options_v2))
    if (clean.faq) { try { setFaqs(JSON.parse(clean.faq)) } catch {} }
    if (clean.reviews) { try { setReviews(JSON.parse(clean.reviews)) } catch {} }
    if (clean.bundle_options) { try { setBundleOptions(JSON.parse(clean.bundle_options)) } catch {} }
    if (clean.bundle_options_v2) { try { const v2 = JSON.parse(clean.bundle_options_v2); if (v2?.variants) setVariantBundles(v2.variants) } catch {} }
  }

  const save = async (overrides: Partial<Meta> = {}) => {
    setSaving(true)
    setError("")
    try {
      const finalMeta = buildMeta(overrides)
      const res = await fetch(`/admin/products/${product.id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: finalMeta })
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => "")
        let errMsg = errText
        try { const d = JSON.parse(errText); errMsg = d.message || d.error || JSON.stringify(d) } catch {}
        throw new Error(`Lưu thất bại (${res.status}): ${errMsg}`)
      }
      // Dùng finalMeta (đã xóa keys tắt) thay vì server response (Medusa merge metadata)
      applyMeta(finalMeta)
      // Revalidate storefront cache qua backend (tránh CORS)
      try {
        await fetch("/admin/revalidate", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tags: ["products"] }),
        })
      } catch {}
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const hasPageContent = Boolean(meta.page_content && meta.page_content.trim())
  const hasDraft = Boolean((meta as any).page_content_draft && (meta as any).page_content_draft.trim())

  // ── Core save to Medusa ──────────────────────────────────────────────────
  const patchProduct = async (patch: Record<string, any>) => {
    const isLarge = Object.keys(patch).some(k => k.startsWith("page_content"))

    if (isLarge) {
      const res = await fetch("/admin/product-content", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id, metadata: patch }),
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => "")
        let errMsg = errText
        try { const d = JSON.parse(errText); errMsg = d.message || d.error || JSON.stringify(d) } catch {}
        throw new Error(`Lỗi ${res.status}: ${errMsg}`)
      }
      return
    }

    // Small metadata — use standard Medusa route
    const res = await fetch(`/admin/products/${product.id}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: patch }),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => "")
      let errMsg = errText
      try { const d = JSON.parse(errText); errMsg = d.message || d.error || JSON.stringify(d) } catch {}
      throw new Error(`Lỗi ${res.status}: ${errMsg}`)
    }
  }

  const revalidate = () => fetch("/admin/revalidate", {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tags: ["products"] }),
  }).catch(() => {})

  // ── Page Builder: Lưu nháp (KHÔNG revalidate, KHÔNG đóng modal) ──────────
  const handleSaveDraft = async (content: string) => {
    await patchProduct({ page_content_draft: content })
    setMeta(prev => ({ ...prev, page_content_draft: content }))
    // NO revalidate — draft không lên storefront
  }

  // ── Page Builder: Xuất bản (copy draft → live, revalidate, add to history) ─
  const handlePublish = async (content: string) => {
    // Build version history — push live content vào lịch sử trước
    const newVersions = [...versions]
    const liveContent = meta.page_content
    if (liveContent && liveContent.trim()) {
      const newV: ContentVersion = {
        id: buildVersionId(),
        savedAt: new Date().toISOString(),
        savedBy: currentUser.email,
        savedByAvatar: (currentUser.name || currentUser.email || "?")[0].toUpperCase(),
        label: `Xuất bản ${newVersions.length + 1}`,
        content: liveContent,
        size: liveContent.length,
      }
      newVersions.unshift(newV)
      if (newVersions.length > MAX_VERSIONS) newVersions.splice(MAX_VERSIONS)
    }
    await patchProduct({
      page_content: content,          // live → lên storefront
      page_content_draft: null,       // xóa draft sau khi publish
      page_content_backup: null,      // clear old format
      page_content_versions: JSON.stringify(newVersions),
    })
    setVersions(newVersions)
    setMeta(prev => ({ ...prev, page_content: content, page_content_draft: undefined }))
    revalidate()  // storefront update
  }

  // ── Restore version ───────────────────────────────────────────────────────
  const handleRestoreVersion = async (v: ContentVersion) => {
    const newVersions = [...versions.filter(x => x.id !== v.id)]
    const liveContent = meta.page_content
    if (liveContent && liveContent.trim()) {
      newVersions.unshift({
        id: buildVersionId(),
        savedAt: new Date().toISOString(),
        savedBy: currentUser.email,
        savedByAvatar: (currentUser.name || currentUser.email || "?")[0].toUpperCase(),
        label: "Trước khi khôi phục",
        content: liveContent,
        size: liveContent.length,
      })
      if (newVersions.length > MAX_VERSIONS) newVersions.splice(MAX_VERSIONS)
    }
    await patchProduct({
      page_content: v.content,
      page_content_versions: JSON.stringify(newVersions),
    })
    setVersions(newVersions)
    setMeta(prev => ({ ...prev, page_content: v.content }))
    revalidate()
  }

  // ── Metadata save (non-page-builder fields) ───────────────────────────────
  const savePageContent = async (content: string | null, newVersions?: ContentVersion[]) => {
    setSaving(true)
    setError("")
    try {
      const patch: Record<string, any> = { page_content: content, page_content_backup: null }
      if (newVersions !== undefined) patch.page_content_versions = JSON.stringify(newVersions)
      await patchProduct(patch)
      if (content) revalidate()
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }
  const s: React.CSSProperties = { fontFamily: "Inter, sans-serif" }

  return (
    <div style={{ ...s, fontFamily: "Inter,system-ui,sans-serif", marginTop: 16 }}>
      {/* Version history modal */}
      {showVersions && (
        <VersionHistoryPanel
          versions={versions}
          currentContent={meta.page_content || ""}
          onRestore={handleRestoreVersion}
          onClose={() => setShowVersions(false)}
        />
      )}

      {/* ── HEADER BAR ── */}
      <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 12, padding: "14px 20px", marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 20 }}>📦</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, color: "#111827" }}>Nội dung trang sản phẩm</div>
              <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2, display: "flex", alignItems: "center", gap: 8 }}>
                {currentUser.email !== "unknown" && (
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 18, height: 18, borderRadius: "50%", background: "#f97316", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 10, fontWeight: 700 }}>
                      {(currentUser.name || "?")[0].toUpperCase()}
                    </span>
                    {currentUser.email}
                  </span>
                )}
                {product.handle && <StorefrontLink handle={product.handle} />}
              </div>
            </div>
          </div>

          {/* Status + save */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {saved && (
              <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                ✓ Đã lưu!
              </span>
            )}
            {error && (
              <span style={{ fontSize: 11, color: "#dc2626", maxWidth: 220, lineHeight: 1.3 }}>{error}</span>
            )}
            <button onClick={() => save()} disabled={saving}
              style={{ background: saving ? "#9ca3af" : "#f97316", color: "white", border: "none", borderRadius: 8, padding: "9px 20px", fontWeight: 700, fontSize: 13, cursor: saving ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}>
              {saving ? "Đang lưu..." : "💾 Lưu thay đổi"}
            </button>
          </div>
        </div>
      </div>

      {/* ── IMAGES ── */}
      <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20, marginBottom: 12 }}>
        <ProductImageUpload productId={product.id} initialImages={productImages} />
      </div>

      {/* ── PAGE BUILDER CARD ── */}
      <div style={{ background: hasPageContent ? "#fffbf5" : "white", border: `1px solid ${hasPageContent ? "#fed7aa" : "#e5e7eb"}`, borderRadius: 12, padding: 20, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: "#111827", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              🎨 Page Builder
              {hasPageContent && (
                <span style={{ background: "#22c55e", color: "white", borderRadius: 20, padding: "2px 8px", fontSize: 10, fontWeight: 700 }}>
                  🟢 LIVE
                </span>
              )}
              {hasDraft && (
                <span style={{ background: "#f59e0b", color: "white", borderRadius: 20, padding: "2px 8px", fontSize: 10, fontWeight: 700 }}>
                  ● NHÁP CHƯA ĐĂNG
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
              {hasDraft
                ? "Có nháp chưa xuất bản. Bấm 'Chỉnh sửa' → 'Xuất bản' để đưa lên storefront."
                : hasPageContent
                ? "Đang live trên storefront. Bấm 'Chỉnh sửa' để thay đổi."
                : "Kéo thả blocks để thiết kế layout. Lưu nháp trước, xuất bản khi sẵn sàng."}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0, marginLeft: 16 }}>
            {hasPageContent && (
              <button onClick={() => setShowVersions(true)}
                style={{ background: versions.length > 0 ? "#eff6ff" : "#f9fafb", color: versions.length > 0 ? "#1d4ed8" : "#6b7280", border: `1px solid ${versions.length > 0 ? "#bfdbfe" : "#e5e7eb"}`, borderRadius: 8, padding: "8px 12px", fontWeight: 600, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
                🕐 {versions.length > 0 ? `${versions.length} phiên bản` : "Lịch sử"}
              </button>
            )}
            {hasDraft && (
              <button onClick={async () => {
                if (!window.confirm("Xuất bản nháp hiện tại lên storefront?")) return
                setSaving(true)
                try { await handlePublish((meta as any).page_content_draft) }
                catch (e: any) { setError(e.message) }
                setSaving(false)
              }} disabled={saving}
                style={{ background: "#f59e0b", color: "white", border: "none", borderRadius: 8, padding: "8px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
                🚀 Xuất bản nháp
              </button>
            )}
            <button onClick={() => setBuilderOpen(true)}
              style={{ background: "#111827", color: "white", border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>
              {hasPageContent || hasDraft ? "✏️ Chỉnh sửa" : "🎨 Mở Editor"}
            </button>
            {hasPageContent && (
              <button
                onClick={async () => { if (window.confirm("Xóa toàn bộ nội dung Page Builder? Storefront sẽ fallback về metadata sections bên dưới.")) { await patchProduct({ page_content: null, page_content_draft: null, page_content_versions: null }); setMeta(prev => ({ ...prev, page_content: undefined, page_content_draft: undefined })); setVersions([]); revalidate() } }}
                disabled={saving}
                style={{ background: "white", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: 8, padding: "8px 12px", fontWeight: 600, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
                🗑 Xóa
              </button>
            )}
          </div>
        </div>

        {/* Version mini-list nếu có */}
        {hasPageContent && versions.length > 0 && (
          <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {versions.slice(0, 3).map((v, i) => (
              <div key={v.id} style={{ background: "#f3f4f6", borderRadius: 20, padding: "3px 10px", fontSize: 11, color: "#6b7280", display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 16, height: 16, borderRadius: "50%", background: `hsl(${(v.savedBy.charCodeAt(0) * 47) % 360},55%,55%)`, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 9, fontWeight: 700 }}>
                  {v.savedByAvatar}
                </span>
                {v.savedBy.split("@")[0]} · {formatRelativeTime(v.savedAt)}
              </div>
            ))}
            {versions.length > 3 && (
              <div style={{ background: "#f3f4f6", borderRadius: 20, padding: "3px 10px", fontSize: 11, color: "#6b7280" }}>
                +{versions.length - 3} phiên bản khác
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── METADATA SECTIONS (dimmed when page builder active) ── */}
      <div style={{ opacity: hasPageContent ? 0.5 : 1, pointerEvents: hasPageContent ? "none" : "auto", transition: "opacity 0.2s" }}>
        {hasPageContent && (
          <div style={{ background: "#fef9c3", border: "1px solid #fde047", borderRadius: 8, padding: "8px 14px", marginBottom: 10, fontSize: 12, color: "#92400e" }}>
            ⚠️ Page Builder đang active — các section bên dưới bị ẩn trên storefront. Xóa Page Builder để dùng lại.
          </div>
        )}

      {/* 1. Video */}
      <Toggle label="🎬 Video Demo" enabled={showVideo} onToggle={() => setShowVideo(!showVideo)}>
        <Input
          label="YouTube URL"
          value={meta.video_url || ""}
          onChange={v => setM("video_url", v)}
          placeholder="https://youtube.com/watch?v=..."
        />
      </Toggle>

      {/* 2. Pain Points */}
      <Toggle label="😤 Pain Points & Giải pháp" enabled={showPain} onToggle={() => setShowPain(!showPain)}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, color: "#ef4444", marginBottom: 8 }}>❌ Vấn đề khách hàng gặp</p>
            {[1, 2, 3].map(i => (
              <Input key={i} label={`Vấn đề ${i}`} value={meta[`pain_${i}` as keyof Meta] || ""}
                onChange={v => setM(`pain_${i}`, v)} placeholder="VD: Chảo cũ hay dính, khó rửa" />
            ))}
          </div>
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, color: "#22c55e", marginBottom: 8 }}>✅ Giải pháp của bạn</p>
            {[1, 2, 3].map(i => (
              <Input key={i} label={`Giải pháp ${i}`} value={meta[`solution_${i}` as keyof Meta] || ""}
                onChange={v => setM(`solution_${i}`, v)} placeholder="VD: Chống dính vượt trội, 0 dầu" />
            ))}
          </div>
        </div>
      </Toggle>

      {/* 3. Benefits */}
      <Toggle label="⭐ Điểm nổi bật (4 benefit)" enabled={showBenefits} onToggle={() => setShowBenefits(!showBenefits)}>
        {[1, 2, 3, 4].map(i => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "60px 1fr 1fr", gap: 8, marginBottom: 8 }}>
            <Input label={i === 1 ? "Icon" : ""} value={meta[`benefit_icon_${i}` as keyof Meta] || ""}
              onChange={v => setM(`benefit_icon_${i}`, v)} placeholder="🔥" />
            <Input label={i === 1 ? "Tiêu đề" : ""} value={meta[`benefit_title_${i}` as keyof Meta] || ""}
              onChange={v => setM(`benefit_title_${i}`, v)} placeholder="Chống dính vượt trội" />
            <Input label={i === 1 ? "Mô tả ngắn" : ""} value={meta[`benefit_desc_${i}` as keyof Meta] || ""}
              onChange={v => setM(`benefit_desc_${i}`, v)} placeholder="Ceramic cao cấp..." />
          </div>
        ))}
      </Toggle>

      {/* 4. Specs */}
      <Toggle label="📋 Thông số kỹ thuật" enabled={showSpecs} onToggle={() => setShowSpecs(!showSpecs)}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <Input label="Chất liệu" value={meta.chat_lieu || ""} onChange={v => setM("chat_lieu", v)} placeholder="Inox 304" />
          <Input label="Kích thước" value={meta.kich_thuoc || ""} onChange={v => setM("kich_thuoc", v)} placeholder="28cm x 8cm" />
          <Input label="Xuất xứ" value={meta.xuat_xu || ""} onChange={v => setM("xuat_xu", v)} placeholder="Việt Nam" />
          <Input label="Bảo hành" value={meta.bao_hanh || ""} onChange={v => setM("bao_hanh", v)} placeholder="12 tháng" />
          <Input label="Màu sắc" value={meta.mau_sac || ""} onChange={v => setM("mau_sac", v)} placeholder="Đen, Đỏ" />
          <Input label="Trọng lượng" value={meta.trong_luong || ""} onChange={v => setM("trong_luong", v)} placeholder="500g" />
        </div>
      </Toggle>

      {/* 5. Reviews */}
      <Toggle label="💬 Đánh giá khách hàng" enabled={showReviews} onToggle={() => setShowReviews(!showReviews)}>
        {reviews.map((r, i) => (
          <div key={i} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 10, marginBottom: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 60px", gap: 8, marginBottom: 8 }}>
              <Input label="Tên khách" value={r.name} onChange={v => setReviews(prev => prev.map((x, j) => j === i ? { ...x, name: v } : x))} placeholder="Nguyễn Thị Lan" />
              <Input label="Tỉnh/TP" value={r.location} onChange={v => setReviews(prev => prev.map((x, j) => j === i ? { ...x, location: v } : x))} placeholder="Hà Nội" />
              <Input label="Sao" value={String(r.rating)} onChange={v => setReviews(prev => prev.map((x, j) => j === i ? { ...x, rating: Number(v) } : x))} placeholder="5" />
            </div>
            <Input label="Nội dung đánh giá" value={r.text} onChange={v => setReviews(prev => prev.map((x, j) => j === i ? { ...x, text: v } : x))} placeholder="Sản phẩm rất tốt..." />
            <Input label="Ngày" value={r.date} onChange={v => setReviews(prev => prev.map((x, j) => j === i ? { ...x, date: v } : x))} placeholder="2 ngày trước" />
            {reviews.length > 1 && (
              <button onClick={() => setReviews(prev => prev.filter((_, j) => j !== i))}
                style={{ fontSize: 11, color: "#ef4444", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                Xóa
              </button>
            )}
          </div>
        ))}
        <button onClick={() => setReviews(prev => [...prev, { name: "", location: "", rating: 5, text: "", date: "" }])}
          style={{ fontSize: 12, color: "#f97316", background: "none", border: "1px dashed #f97316", borderRadius: 6, padding: "6px 12px", cursor: "pointer", width: "100%" }}>
          + Thêm đánh giá
        </button>
      </Toggle>

      {/* 6. FAQ */}
      <Toggle label="❓ Câu hỏi thường gặp (FAQ)" enabled={showFaq} onToggle={() => setShowFaq(!showFaq)}>
        {faqs.map((f, i) => (
          <div key={i} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 10, marginBottom: 8 }}>
            <Input label={`Câu hỏi ${i + 1}`} value={f.q}
              onChange={v => setFaqs(prev => prev.map((x, j) => j === i ? { ...x, q: v } : x))}
              placeholder="Sản phẩm có bảo hành không?" />
            <Input label="Trả lời" value={f.a}
              onChange={v => setFaqs(prev => prev.map((x, j) => j === i ? { ...x, a: v } : x))}
              placeholder="Bảo hành 12 tháng, đổi trả 7 ngày..." />
            {faqs.length > 1 && (
              <button onClick={() => setFaqs(prev => prev.filter((_, j) => j !== i))}
                style={{ fontSize: 11, color: "#ef4444", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                Xóa
              </button>
            )}
          </div>
        ))}
        <button onClick={() => setFaqs(prev => [...prev, { q: "", a: "" }])}
          style={{ fontSize: 12, color: "#f97316", background: "none", border: "1px dashed #f97316", borderRadius: 6, padding: "6px 12px", cursor: "pointer", width: "100%" }}>
          + Thêm câu hỏi
        </button>
      </Toggle>

      {/* 7. Bundle Options + Gifts per option */}
      <Toggle label="🛒 Gói Bundle & Quà tặng" enabled={showBundleOptions} onToggle={() => {
        if (!showBundleOptions && isMultiVariant && variantBundles.length === 0) {
          // Init variant bundles từ product variants
          setVariantBundles(productVariants.map(v => ({
            variantId: v.id,
            label: v.title,
            options: [
              { qty: 1, label: "1 SẢN PHẨM", price: 0, originalPrice: 0, gifts: [] },
              { qty: 2, label: "MUA 1 TẶNG 1", price: 0, originalPrice: 0, badge: "HÔM NAY THÔI", badgeColor: "bg-orange-500", gifts: [{ name: "", value: 0 }] },
            ]
          })))
        }
        setShowBundleOptions(!showBundleOptions)
      }}>
        <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 12 }}>
          Nhập giá từng gói (số nguyên, VD: 499000). Mỗi gói có thể có quà tặng riêng. Giá gốc là giá gạch đỏ.
        </p>

        {/* Multi-variant: Tab selector */}
        {isMultiVariant && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
              {(variantBundles.length > 0 ? variantBundles : productVariants.map(v => ({ variantId: v.id, label: v.title, options: [] }))).map((vb, vi) => (
                <button key={vb.variantId} onClick={() => setActiveVariantTab(vi)}
                  style={{ padding: "6px 14px", borderRadius: 20, border: "1.5px solid", fontSize: 12, fontWeight: 700, cursor: "pointer",
                    borderColor: activeVariantTab === vi ? "#f97316" : "#e5e7eb",
                    background: activeVariantTab === vi ? "#fff7ed" : "white",
                    color: activeVariantTab === vi ? "#f97316" : "#6b7280" }}>
                  {vb.label}
                </button>
              ))}
            </div>
            {/* Bundle options for active variant */}
            {variantBundles.length > 0 && variantBundles[activeVariantTab] && (() => {
              const vb = variantBundles[activeVariantTab]
              const setVbOptions = (newOpts: BundleOptionMeta[]) =>
                setVariantBundles(prev => prev.map((x, i) => i === activeVariantTab ? { ...x, options: newOpts } : x))
              const setVbImage = (url: string) =>
                setVariantBundles(prev => prev.map((x, i) => i === activeVariantTab ? { ...x, image: url } : x))
              return (
                <div>
                  {/* Ảnh đại diện cho loại này (dùng để gallery đổi ảnh khi chọn) */}
                  <div style={{ marginBottom: 12, padding: "10px 12px", background: "#f0f9ff", borderRadius: 8, border: "1px solid #bae6fd" }}>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#0369a1", marginBottom: 6 }}>
                      🖼️ Ảnh đại diện loại "{vb.label}" (gallery sẽ nhảy đến ảnh này khi khách chọn)
                    </label>
                    <ImagePicker value={vb.image || ""} onChange={setVbImage} productImages={productImages} />
                  </div>
                  {vb.options.map((opt, i) => {
                    const updateOpt = (patch: Partial<BundleOptionMeta>) =>
                      setVbOptions(vb.options.map((x, j) => j === i ? { ...x, ...patch } : x))
                    const optGifts: GiftItem[] = opt.gifts || []
                    return (
                      <div key={i} style={{ border: "1px solid #d1d5db", borderRadius: 10, marginBottom: 12, overflow: "visible" }}>
                        <div style={{ background: "#f9fafb", padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #e5e7eb" }}>
                          <span style={{ fontWeight: 700, fontSize: 13, color: "#374151" }}>GÓI {i + 1} — {vb.label}</span>
                          {vb.options.length > 1 && (
                            <button onClick={() => setVbOptions(vb.options.filter((_, j) => j !== i))}
                              style={{ fontSize: 13, color: "#ef4444", background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}>Xóa gói</button>
                          )}
                        </div>
                        <div style={{ padding: 12 }}>
                          <div style={{ display: "grid", gridTemplateColumns: "70px 1fr 130px 130px", gap: 8, marginBottom: 8 }}>
                            <Input label="Số lượng" value={String(opt.qty)} onChange={v => updateOpt({ qty: Number(v) })} placeholder="1" />
                            <Input label="Nhãn hiển thị" value={opt.label} onChange={v => updateOpt({ label: v })} placeholder="1 SẢN PHẨM" />
                            <Input label="Giá bán (đ)" value={String(opt.price || "")} onChange={v => updateOpt({ price: Number(v) })} placeholder="299000" />
                            <Input label="Giá gốc/gạch (đ)" value={String(opt.originalPrice || "")} onChange={v => updateOpt({ originalPrice: Number(v) })} placeholder="399000" />
                          </div>
                          <div style={{ marginBottom: 8 }}>
                            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 4 }}>Ảnh gói</label>
                            <ImagePicker value={opt.image || ""} onChange={v => updateOpt({ image: v })} productImages={productImages} />
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 150px", gap: 8, marginBottom: 10 }}>
                            <Input label="Badge (tùy chọn)" value={opt.badge || ""} onChange={v => updateOpt({ badge: v })} placeholder="HÔM NAY THÔI" />
                            <div style={{ marginBottom: 8 }}>
                              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 4 }}>Màu badge</label>
                              <select value={opt.badgeColor || ""} onChange={e => updateOpt({ badgeColor: e.target.value })}
                                style={{ width: "100%", padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: 6, fontSize: 13 }}>
                                <option value="">Không có</option>
                                <option value="bg-orange-500">Cam</option>
                                <option value="bg-red-500">Đỏ</option>
                                <option value="bg-blue-600">Xanh dương</option>
                                <option value="bg-green-500">Xanh lá</option>
                              </select>
                            </div>
                          </div>
                          <div style={{ borderTop: "1px dashed #e5e7eb", paddingTop: 10 }}>
                            <p style={{ fontSize: 12, fontWeight: 700, color: "#6b7280", marginBottom: 8 }}>🎁 Quà tặng kèm gói này</p>
                            {optGifts.map((g, gi) => (
                              <div key={gi} style={{ display: "grid", gridTemplateColumns: "1fr 120px auto", gap: 8, marginBottom: 6, alignItems: "end" }}>
                                <Input label={gi === 0 ? "Tên quà tặng" : ""} value={g.name}
                                  onChange={v => updateOpt({ gifts: optGifts.map((x, k) => k === gi ? { ...x, name: v } : x) })} placeholder="Túi đựng cao cấp" />
                                <Input label={gi === 0 ? "Giá trị (đ)" : ""} value={String(g.value || "")}
                                  onChange={v => updateOpt({ gifts: optGifts.map((x, k) => k === gi ? { ...x, value: Number(v) } : x) })} placeholder="89000" />
                                <button onClick={() => updateOpt({ gifts: optGifts.filter((_, k) => k !== gi) })}
                                  style={{ marginBottom: 8, fontSize: 18, color: "#ef4444", background: "none", border: "none", cursor: "pointer" }}>×</button>
                              </div>
                            ))}
                            <button onClick={() => updateOpt({ gifts: [...optGifts, { name: "", value: 0 }] })}
                              style={{ fontSize: 12, color: "#3b82f6", background: "none", border: "1px dashed #3b82f6", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>
                              + Thêm quà
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  <button onClick={() => setVbOptions([...vb.options, { qty: vb.options.length + 1, label: "", price: 0, originalPrice: 0, gifts: [] }])}
                    style={{ fontSize: 12, color: "#f97316", background: "none", border: "1px dashed #f97316", borderRadius: 6, padding: "6px 12px", cursor: "pointer", width: "100%" }}>
                    + Thêm gói cho {vb.label}
                  </button>
                </div>
              )
            })()}
          </div>
        )}

        {/* Single-variant: original UI */}
        {!isMultiVariant && bundleOptions.map((opt, i) => {
          const updateOpt = (patch: Partial<BundleOptionMeta>) =>
            setBundleOptions(prev => prev.map((x, j) => j === i ? { ...x, ...patch } : x))
          const optGifts: GiftItem[] = opt.gifts || []
          return (
            <div key={i} style={{ border: "1px solid #d1d5db", borderRadius: 10, marginBottom: 12, overflow: "visible" }}>
              {/* Option header */}
              <div style={{ background: "#f9fafb", padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #e5e7eb" }}>
                <span style={{ fontWeight: 700, fontSize: 13, color: "#374151" }}>GÓI {i + 1}</span>
                {bundleOptions.length > 1 && (
                  <button onClick={() => setBundleOptions(prev => prev.filter((_, j) => j !== i))}
                    style={{ fontSize: 13, color: "#ef4444", background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}>
                    Xóa gói
                  </button>
                )}
              </div>
              <div style={{ padding: 12 }}>
                {/* Row 1: qty, label, price, originalPrice */}
                <div style={{ display: "grid", gridTemplateColumns: "70px 1fr 130px 130px", gap: 8, marginBottom: 8 }}>
                  <Input label="Số lượng" value={String(opt.qty)} onChange={v => updateOpt({ qty: Number(v) })} placeholder="1" />
                  <Input label="Nhãn hiển thị" value={opt.label} onChange={v => updateOpt({ label: v })} placeholder="1 SẢN PHẨM" />
                  <Input label="Giá bán (đ)" value={String(opt.price || "")} onChange={v => updateOpt({ price: Number(v) })} placeholder="499000" />
                  <Input label="Giá gốc/gạch (đ)" value={String(opt.originalPrice || "")} onChange={v => updateOpt({ originalPrice: Number(v) })} placeholder="698000" />
                </div>
                {/* Row 2: image URL */}
                <div style={{ marginBottom: 8 }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 4 }}>Ảnh gói</label>
                  <ImagePicker
                    value={opt.image || ""}
                    onChange={v => updateOpt({ image: v })}
                    productImages={productImages}
                  />
                </div>

                {/* Row 3: badge, badge color */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 150px", gap: 8, marginBottom: 10 }}>
                  <Input label="Badge (tùy chọn)" value={opt.badge || ""} onChange={v => updateOpt({ badge: v })} placeholder="HÔM NAY THÔI" />
                  <div style={{ marginBottom: 8 }}>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 4 }}>Màu badge</label>
                    <select value={opt.badgeColor || ""}
                      onChange={e => updateOpt({ badgeColor: e.target.value })}
                      style={{ width: "100%", padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: 6, fontSize: 13 }}>
                      <option value="">Không có</option>
                      <option value="bg-orange-500">Cam</option>
                      <option value="bg-red-500">Đỏ</option>
                      <option value="bg-blue-600">Xanh dương</option>
                      <option value="bg-green-500">Xanh lá</option>
                    </select>
                  </div>
                </div>
                {/* Gifts for this option */}
                <div style={{ borderTop: "1px dashed #e5e7eb", paddingTop: 10 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: "#6b7280", marginBottom: 8 }}>🎁 Quà tặng kèm gói này</p>
                  {optGifts.length === 0 && (
                    <p style={{ fontSize: 11, color: "#9ca3af", marginBottom: 8 }}>Chưa có quà — gói này không kèm quà</p>
                  )}
                  {optGifts.map((g, gi) => (
                    <div key={gi} style={{ display: "grid", gridTemplateColumns: "1fr 120px auto", gap: 8, marginBottom: 6, alignItems: "end" }}>
                      <Input label={gi === 0 ? "Tên quà tặng" : ""} value={g.name}
                        onChange={v => updateOpt({ gifts: optGifts.map((x, k) => k === gi ? { ...x, name: v } : x) })}
                        placeholder="Túi đựng cao cấp" />
                      <Input label={gi === 0 ? "Giá trị (đ)" : ""} value={String(g.value || "")}
                        onChange={v => updateOpt({ gifts: optGifts.map((x, k) => k === gi ? { ...x, value: Number(v) } : x) })}
                        placeholder="89000" />
                      <button onClick={() => updateOpt({ gifts: optGifts.filter((_, k) => k !== gi) })}
                        style={{ marginBottom: 8, fontSize: 18, color: "#ef4444", background: "none", border: "none", cursor: "pointer" }}>
                        ×
                      </button>
                    </div>
                  ))}
                  <button onClick={() => updateOpt({ gifts: [...optGifts, { name: "", value: 0 }] })}
                    style={{ fontSize: 12, color: "#3b82f6", background: "none", border: "1px dashed #3b82f6", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>
                    + Thêm quà
                  </button>
                </div>
              </div>
            </div>
          )
        })}
        {!isMultiVariant && (
          <button onClick={() => setBundleOptions(prev => [...prev, { qty: prev.length + 1, label: "", price: 0, originalPrice: 0, gifts: [] }])}
            style={{ fontSize: 12, color: "#f97316", background: "none", border: "1px dashed #f97316", borderRadius: 6, padding: "6px 12px", cursor: "pointer", width: "100%" }}>
            + Thêm gói
          </button>
        )}
      </Toggle>

      </div>{/* end metadata wrapper */}

      <ProductPageBuilder
        open={builderOpen}
        productTitle={product.title || "Sản phẩm"}
        initialContent={(meta as any).page_content_draft || meta.page_content}
        hasLiveContent={hasPageContent}
        onClose={() => setBuilderOpen(false)}
        onSaveDraft={handleSaveDraft}
        onPublish={handlePublish}
      />

      {/* Facebook Pixel per product */}
      <div style={{ background: "#f0f4ff", border: "1px solid #c7d7fc", borderRadius: 10, padding: "14px 16px", marginTop: 12 }}>
        <p style={{ fontWeight: 700, fontSize: 14, color: "#1d4ed8", marginBottom: 10 }}>📊 Facebook Pixel (sản phẩm này)</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 3 }}>Pixel ID</label>
            <input
              type="text"
              value={meta.fb_pixel_id || ""}
              onChange={e => setMeta(m => ({ ...m, fb_pixel_id: e.target.value }))}
              placeholder="Ví dụ: 1234567890123456"
              style={{ width: "100%", padding: "6px 10px", border: "1px solid #c7d7fc", borderRadius: 6, fontSize: 13, boxSizing: "border-box" }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 3 }}>Access Token CAPI (server-side)</label>
            <input
              type="password"
              value={meta.fb_capi_token || ""}
              onChange={e => setMeta(m => ({ ...m, fb_capi_token: e.target.value }))}
              placeholder="EAAxxxx... (không lộ ra client)"
              style={{ width: "100%", padding: "6px 10px", border: "1px solid #c7d7fc", borderRadius: 6, fontSize: 13, boxSizing: "border-box" }}
            />
          </div>
          <p style={{ fontSize: 11, color: "#6b7280", margin: 0 }}>Pixel này sẽ fire thêm ViewContent, AddToCart, Purchase riêng cho sản phẩm này.</p>
        </div>
      </div>

      {/* Social Proof per product */}
      <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden", marginTop: 12 }}>
        <div style={{ background: "#f9fafb", padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #e5e7eb" }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>🔔 Social Proof Popup</span>
          <button
            onClick={() => setMeta(m => ({ ...m, social_proof_enabled: m.social_proof_enabled === "false" ? "true" : "false" }))}
            style={{ width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer", position: "relative", transition: "background 0.2s", background: meta.social_proof_enabled === "false" ? "#d1d5db" : "#22c55e", flexShrink: 0 }}
          >
            <span style={{ position: "absolute", top: 3, left: meta.social_proof_enabled === "false" ? 2 : 22, width: 18, height: 18, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.2)", transition: "left 0.2s", display: "block" }} />
          </button>
        </div>
        {meta.social_proof_enabled !== "false" && (
          <div style={{ padding: "12px 14px", display: "flex", gap: 16 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 4 }}>Hiện sau (giây)</label>
              <input
                type="number" min={3} max={120}
                value={meta.social_proof_delay || "12"}
                onChange={e => setMeta(m => ({ ...m, social_proof_delay: e.target.value }))}
                style={{ width: "100%", padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: 6, fontSize: 13 }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 4 }}>Lặp lại mỗi (giây)</label>
              <input
                type="number" min={10} max={300}
                value={meta.social_proof_interval || "30"}
                onChange={e => setMeta(m => ({ ...m, social_proof_interval: e.target.value }))}
                style={{ width: "100%", padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: 6, fontSize: 13 }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 4 }}>Hiển thị trong (giây)</label>
              <input
                type="number" min={2} max={30}
                value={meta.social_proof_display || "5"}
                onChange={e => setMeta(m => ({ ...m, social_proof_display: e.target.value }))}
                style={{ width: "100%", padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: 6, fontSize: 13 }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Save button bottom — sticky */}
      <div style={{ position: "sticky", bottom: 16, zIndex: 10, display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
        <button onClick={() => save()} disabled={saving}
          style={{ background: saving ? "#9ca3af" : "#f97316", color: "white", border: "none", borderRadius: 10, padding: "12px 28px", fontWeight: 800, fontSize: 14, cursor: saving ? "not-allowed" : "pointer", boxShadow: "0 4px 16px rgba(249,115,22,0.4)" }}>
          {saving ? "Đang lưu..." : "💾 Lưu tất cả thay đổi"}
        </button>
      </div>
    </div>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.after",
})

export default ProductContentWidget
