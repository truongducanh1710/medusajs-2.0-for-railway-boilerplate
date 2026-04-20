import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { useEffect, useState } from "react"
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
type BundleOptionMeta = { qty: number; label: string; price: number; originalPrice: number; badge?: string; badgeColor?: string; gifts?: GiftItem[] }

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
  <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, marginBottom: 12, overflow: "hidden" }}>
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

  useEffect(() => {
    const m: Meta = (product.metadata as Meta) || {}
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
    if (showBundleOptions) m.bundle_options = JSON.stringify(bundleOptions)
    else delete m.bundle_options
    // Keep page_content unless explicitly cleared — never auto-delete it
    if (overrides.page_content !== undefined) {
      if (!overrides.page_content.trim()) delete m.page_content
    } else if (!m.page_content || !m.page_content.trim()) {
      delete m.page_content
    }
    return m
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
            onClick={save}
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
            <div key={i} style={{ border: "1px solid #d1d5db", borderRadius: 10, marginBottom: 12, overflow: "hidden" }}>
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
                {/* Row 2: badge, badge color */}
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

      {/* Save button bottom */}
      <div style={{ textAlign: "right", marginTop: 8 }}>
        <button
          onClick={save}
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
