import { defineWidgetConfig } from "@medusajs/admin-sdk"
import React, { useEffect, useRef, useState } from "react"
import ProductPageBuilder from "../components/product-page-builder"

// Builds storefront link from current admin URL pattern
// Railway: backend = backend-xxx.railway.app, storefront = storefront-xxx.railway.app
// Local: localhost:9000 → localhost:8000
function getStorefrontBase(): string {
  if (typeof window === "undefined") return "http://localhost:8000"
  const host = window.location.host
  // Railway pattern: replace "backend-production" with "storefront-production"
  if (host.includes("backend-") && host.includes("railway.app")) {
    return `https://${host.replace(/^backend-/, "storefront-")}`
  }
  // Local dev
  return host.replace(":9000", ":8000").includes(":")
    ? `http://${host.replace(":9000", ":8000")}`
    : `https://${host}`
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

function ProductImageUpload({ productId, initialImages, initialThumbnail }: {
  productId: string
  initialImages: Array<{ id: string; url: string }>
  initialThumbnail: string
}) {
  const [images, setImages] = useState(initialImages)
  const [thumbnail, setThumbnail] = useState(initialThumbnail)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState("")
  const [dragOver, setDragOver] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const dragIndexRef = useRef<number | null>(null)
  const dropIndexRef = useRef<number | null>(null)
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
      setImages(prev => {
        const next = [...prev, ...uploaded]
        if (!thumbnail && next.length > 0) setThumbnail(next[0].url)
        return next
      })
    }
    setUploading(false)
  }

  const removeImage = (url: string) => {
    setImages(prev => prev.filter(img => img.url !== url))
    if (thumbnail === url) setThumbnail(images.find(img => img.url !== url)?.url || "")
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
          thumbnail: thumbnail || undefined,
          images: images.map(img => ({ url: img.url })),
        }),
      })
      if (!res.ok) throw new Error("Lưu ảnh thất bại")
      // Revalidate storefront cache
      try {
        const storefrontBase = getStorefrontBase()
        await fetch(`${storefrontBase}/api/revalidate`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-revalidate-secret": "phanviet-revalidate" },
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))", gap: 8 }}>
            {images.map((img, i) => (
              <div
                key={img.url}
                draggable
                onDragStart={e => {
                  e.dataTransfer.effectAllowed = "move"
                  e.dataTransfer.setData("text/plain", String(i))
                  dragIndexRef.current = i
                  setDragIndex(i)
                }}
                onDragOver={e => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = "move"
                  dropIndexRef.current = i
                  setDropIndex(i)
                }}
                onDrop={(e: React.DragEvent) => {
                  e.preventDefault()
                  const from = dragIndexRef.current
                  const to = dropIndexRef.current
                  if (from !== null && to !== null && from !== to) moveImage(from, to)
                  dragIndexRef.current = null
                  dropIndexRef.current = null
                  setDragIndex(null)
                  setDropIndex(null)
                }}
                onDragEnd={() => {
                  dragIndexRef.current = null
                  dropIndexRef.current = null
                  setDragIndex(null)
                  setDropIndex(null)
                }}
                style={{
                  position: "relative",
                  opacity: dragIndex === i ? 0.4 : 1,
                  outline: dropIndex === i && dragIndex !== i ? "2px dashed #f97316" : "none",
                  borderRadius: 10,
                  cursor: "grab",
                }}
              >
                <img
                  src={img.url}
                  alt=""
                  onClick={() => setThumbnail(img.url)}
                  style={{
                    width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8,
                    border: thumbnail === img.url ? "3px solid #f97316" : "2px solid #e5e7eb",
                    cursor: "pointer", display: "block", pointerEvents: dragIndex !== null ? "none" : "auto"
                  }}
                />
                {thumbnail === img.url && (
                  <div style={{ position: "absolute", top: 4, left: 4, background: "#f97316", color: "white", fontSize: 9, fontWeight: 800, padding: "2px 5px", borderRadius: 4 }}>
                    THUMB
                  </div>
                )}
                {/* Drag handle */}
                <div style={{ position: "absolute", bottom: 4, left: 4, background: "rgba(0,0,0,0.45)", color: "white", fontSize: 10, padding: "1px 4px", borderRadius: 3, userSelect: "none" }}>
                  ⠿
                </div>
                <button
                  onClick={(e: React.MouseEvent) => { e.stopPropagation(); removeImage(img.url) }}
                  onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
                  onDragStart={(e: React.DragEvent) => e.preventDefault()}
                  style={{ position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: "50%", background: "#ef4444", color: "white", border: "2px solid white", cursor: "pointer", fontSize: 13, fontWeight: 700, lineHeight: "18px", padding: 0, textAlign: "center", zIndex: 10 }}
                >
                  ×
                </button>
              </div>
            ))}
            {/* Add more */}
            <div
              onClick={() => fileRef.current?.click()}
              style={{ aspectRatio: "1", border: "2px dashed #d1d5db", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#9ca3af", fontSize: 24, background: "#f9fafb" }}
            >
              +
            </div>
          </div>
        )}
        <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 8, marginBottom: 0 }}>Click ảnh để đặt làm thumbnail (viền cam). Kéo ảnh để đổi thứ tự. Kéo file từ máy vào đây để upload.</p>
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

  // Sections toggle state
  const [showVideo, setShowVideo] = useState(false)
  const [showPain, setShowPain] = useState(false)
  const [showBenefits, setShowBenefits] = useState(false)
  const [showSpecs, setShowSpecs] = useState(false)
  const [showReviews, setShowReviews] = useState(false)
  const [showFaq, setShowFaq] = useState(false)
  const [showBundleOptions, setShowBundleOptions] = useState(false)

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
    applyMeta((product.metadata as Meta) || {})
  }, [product.id])

  const setM = (key: string, val: string) => setMeta(prev => ({ ...prev, [key]: val }))

  const buildMeta = (overrides: Partial<Meta> = {}): Meta => {
    const m: Meta = { ...meta, ...overrides }
    if (!showVideo) { delete m.video_url }
    if (!showPain) { delete m.pain_1; delete m.pain_2; delete m.pain_3; delete m.solution_1; delete m.solution_2; delete m.solution_3 }
    if (!showBenefits) {
      for (let i = 1; i <= 4; i++) {
        delete m[`benefit_icon_${i}`]; delete m[`benefit_title_${i}`]; delete m[`benefit_desc_${i}`]
      }
    }
    if (!showSpecs) { delete m.chat_lieu; delete m.kich_thuoc; delete m.xuat_xu; delete m.bao_hanh; delete m.mau_sac; delete m.trong_luong }
    if (showReviews) m.reviews = JSON.stringify(reviews)
    else delete m.reviews
    if (showFaq) m.faq = JSON.stringify(faqs.filter(f => f.q))
    else delete m.faq
    delete m.bundle_gifts
    if (showBundleOptions) {
      const sanitized = bundleOptions.map(o => ({
        qty: Number(o.qty) || 0,
        label: String(o.label || ""),
        price: Number(o.price) || 0,
        originalPrice: Number(o.originalPrice) || 0,
        badge: o.badge ? String(o.badge) : undefined,
        badgeColor: o.badgeColor ? String(o.badgeColor) : undefined,
        image: o.image ? String(o.image) : undefined,
        gifts: Array.isArray(o.gifts)
          ? o.gifts.map(g => ({ name: String(g.name || ""), value: Number(g.value) || 0, image: g.image ? String(g.image) : undefined }))
          : [],
      }))
      m.bundle_options = JSON.stringify(sanitized)
    } else delete m.bundle_options
    // Keep page_content unless explicitly cleared — never auto-delete it
    if (overrides.page_content !== undefined) {
      if (!overrides.page_content.trim()) delete m.page_content
    } else if (!m.page_content || !m.page_content.trim()) {
      delete m.page_content
    }
    return m
  }

  const applyMeta = (m: Meta) => {
    setMeta(m)
    setShowVideo(!!m.video_url)
    setShowPain(!!(m.pain_1 || m.pain_2 || m.pain_3))
    setShowBenefits(!!(m.benefit_title_1))
    setShowSpecs(!!(m.chat_lieu || m.kich_thuoc || m.xuat_xu || m.bao_hanh))
    setShowReviews(!!m.reviews)
    setShowFaq(!!m.faq)
    setShowBundleOptions(!!m.bundle_options)
    if (m.faq) { try { setFaqs(JSON.parse(m.faq)) } catch {} }
    if (m.reviews) { try { setReviews(JSON.parse(m.reviews)) } catch {} }
    if (m.bundle_options) { try { setBundleOptions(JSON.parse(m.bundle_options)) } catch {} }
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
      if (!res.ok) throw new Error("Lưu thất bại")
      // Sync state từ server response để tránh stale state
      const saved_data = await res.json()
      const serverMeta: Meta = saved_data?.product?.metadata || saved_data?.metadata || finalMeta
      applyMeta(serverMeta)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const hasPageContent = Boolean(meta.page_content && meta.page_content.trim())
  const handlePageBuilderSave = async (content: string) => {
    // Update meta state first so subsequent saves don't overwrite page_content
    setMeta(prev => ({ ...prev, page_content: content }))
    await save({ page_content: content })
    setBuilderOpen(false)
  }
  const s: React.CSSProperties = { fontFamily: "Inter, sans-serif" }

  return (
    <div style={{ ...s, padding: 20, background: "white", borderRadius: 12, border: "1px solid #e5e7eb", marginTop: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#111827" }}>
            📦 Nội dung trang sản phẩm
          </h3>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>
            Quản lý các section hiển thị trên trang sản phẩm
            {product.handle && (
              <StorefrontLink handle={product.handle} />
            )}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {saved && <span style={{ fontSize: 12, color: "#22c55e", fontWeight: 600 }}>✓ Đã lưu!</span>}
          {error && <span style={{ fontSize: 12, color: "#ef4444" }}>{error}</span>}
          {hasPageContent && (
            <span style={{ fontSize: 12, color: "#f97316", fontWeight: 600 }}>
              🎨 Page Builder
            </span>
          )}
          <button
            onClick={() => setBuilderOpen(true)}
            style={{
              background: "#111827",
              color: "white",
              border: "none",
              borderRadius: 8,
              padding: "8px 14px",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            🎨 Mở Page Builder
          </button>
          {hasPageContent && (
            <button
              onClick={() => save({ page_content: "" })}
              disabled={saving}
              style={{
                background: "#fff7ed",
                color: "#c2410c",
                border: "1px solid #fdba74",
                borderRadius: 8,
                padding: "8px 14px",
                fontWeight: 700,
                fontSize: 13,
                cursor: saving ? "not-allowed" : "pointer",
              }}
            >
              Xóa Page Builder
            </button>
          )}
          <button
            onClick={() => save()}
            disabled={saving}
            style={{
              background: saving ? "#9ca3af" : "#f97316", color: "white",
              border: "none", borderRadius: 8, padding: "8px 16px",
              fontWeight: 700, fontSize: 13, cursor: saving ? "not-allowed" : "pointer"
            }}
          >
            {saving ? "Đang lưu..." : "💾 Lưu thay đổi"}
          </button>
        </div>
      </div>

      {/* 0. Ảnh sản phẩm */}
      <ProductImageUpload
        productId={product.id}
        initialImages={productImages}
        initialThumbnail={product.thumbnail || ""}
      />

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
      <Toggle label="🛒 Gói Bundle & Quà tặng" enabled={showBundleOptions} onToggle={() => setShowBundleOptions(!showBundleOptions)}>
        <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 12 }}>
          Nhập giá từng gói (số nguyên, VD: 499000). Mỗi gói có thể có quà tặng riêng. Giá gốc là giá gạch đỏ.
        </p>
        {bundleOptions.map((opt, i) => {
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
        <button onClick={() => setBundleOptions(prev => [...prev, { qty: prev.length + 1, label: "", price: 0, originalPrice: 0, gifts: [] }])}
          style={{ fontSize: 12, color: "#f97316", background: "none", border: "1px dashed #f97316", borderRadius: 6, padding: "6px 12px", cursor: "pointer", width: "100%" }}>
          + Thêm gói
        </button>
      </Toggle>

      <ProductPageBuilder
        open={builderOpen}
        productTitle={product.title || "Sản phẩm"}
        initialContent={meta.page_content}
        onClose={() => setBuilderOpen(false)}
        onSave={handlePageBuilderSave}
      />

      {/* Facebook Pixel per product */}
      <div style={{ background: "#f0f4ff", border: "1px solid #c7d7fc", borderRadius: 10, padding: "14px 16px", marginTop: 8 }}>
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

      {/* Save button bottom */}
      <div style={{ textAlign: "right", marginTop: 8 }}>
        <button
          onClick={() => save()}
          disabled={saving}
          style={{
            background: saving ? "#9ca3af" : "#f97316", color: "white",
            border: "none", borderRadius: 8, padding: "10px 24px",
            fontWeight: 700, fontSize: 14, cursor: saving ? "not-allowed" : "pointer"
          }}
        >
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
