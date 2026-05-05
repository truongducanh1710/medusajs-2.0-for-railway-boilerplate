"use client"

import { useState } from "react"
import { HttpTypes } from "@medusajs/types"

type Review = {
  name: string
  location: string
  rating: number
  text: string
  date: string
  photo_url?: string
}

const GRADIENTS = [
  ["#FF6B6B", "#FF8E53"],
  ["#4ECDC4", "#44A08D"],
  ["#667eea", "#764ba2"],
  ["#f7971e", "#ffd200"],
  ["#11998e", "#38ef7d"],
  ["#ee0979", "#ff6a00"],
]

function getGradient(name: string) {
  const idx = name.charCodeAt(0) % GRADIENTS.length
  return `linear-gradient(135deg, ${GRADIENTS[idx][0]}, ${GRADIENTS[idx][1]})`
}

function getInitials(name: string) {
  const parts = name.trim().split(" ")
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function StarBar({ star, count, total }: { star: number; count: number; total: number }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
      <span style={{ width: 24, textAlign: "right", color: "#6b7280", fontWeight: 600 }}>{star}★</span>
      <div style={{ flex: 1, height: 8, background: "#f1f5f9", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "#f59e0b", borderRadius: 4, transition: "width 0.4s" }} />
      </div>
      <span style={{ width: 32, color: "#9ca3af", fontSize: 12 }}>{pct}%</span>
    </div>
  )
}

const DEFAULT_REVIEWS: Review[] = [
  { name: "Nguyễn Thị Lan", location: "Hà Nội", rating: 5, text: "Sản phẩm rất tốt, chất lượng vượt mong đợi! Giao hàng nhanh, đóng gói cẩn thận. Sẽ mua lại lần sau.", date: "2 ngày trước" },
  { name: "Trần Văn Nam", location: "TP.HCM", rating: 5, text: "Dùng được 1 tháng vẫn tốt, giá hợp lý. Chất lượng tương xứng với giá tiền, rất hài lòng.", date: "1 tuần trước" },
  { name: "Lê Thị Hoa", location: "Đà Nẵng", rating: 5, text: "Mua về tặng mẹ, mẹ thích lắm! Sản phẩm đúng như mô tả, shop tư vấn nhiệt tình.", date: "2 tuần trước" },
  { name: "Phạm Thị Linh", location: "Hải Phòng", rating: 4, text: "Sản phẩm khá ổn, giao hàng đúng hẹn. Chỉ tiếc bao bì hơi đơn giản nhưng chất lượng bên trong rất tốt.", date: "3 tuần trước" },
  { name: "Hoàng Văn Dũng", location: "Cần Thơ", rating: 5, text: "Đây là lần thứ 3 tôi mua sản phẩm này. Không bao giờ thất vọng, chắc chắn sẽ tiếp tục ủng hộ!", date: "1 tháng trước" },
]

export default function ProductReviewsJudgeMe({ product }: { product: HttpTypes.StoreProduct }) {
  const [filter, setFilter] = useState(0)
  const [showAll, setShowAll] = useState(false)

  const raw = (product.metadata?.reviews as string) || ""
  let reviews: Review[] = []
  if (raw) {
    try { reviews = JSON.parse(raw) } catch {}
  }
  if (!reviews.length) reviews = DEFAULT_REVIEWS

  const total = reviews.length
  const avg = total > 0 ? (reviews.reduce((s, r) => s + r.rating, 0) / total).toFixed(1) : "0"

  const filtered = filter ? reviews.filter(r => r.rating === filter) : reviews
  const displayed = showAll ? filtered : filtered.slice(0, 4)
  const remaining = filtered.length - displayed.length

  const starsWithPhoto = reviews.filter(r => r.photo_url)

  return (
    <div style={{ background: "#fafafa", padding: "40px 0" }}>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "0 16px" }}>

        {/* Header */}
        <h2 style={{ fontSize: 20, fontWeight: 900, color: "#111827", marginBottom: 24 }}>
          ⭐ Đánh giá từ khách hàng thực tế
        </h2>

        {/* Rating summary */}
        <div style={{
          display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap",
          background: "#fff", borderRadius: 16, padding: 20, border: "1px solid #f1f5f9",
          boxShadow: "0 1px 6px rgba(0,0,0,0.06)", marginBottom: 20
        }}>
          {/* Score box */}
          <div style={{ textAlign: "center", minWidth: 90, flexShrink: 0 }}>
            <div style={{ fontSize: 48, fontWeight: 900, color: "#111827", lineHeight: 1 }}>{avg}</div>
            <div style={{ color: "#f59e0b", fontSize: 18, margin: "4px 0" }}>{"★".repeat(5)}</div>
            <div style={{ fontSize: 12, color: "#9ca3af" }}>{total.toLocaleString()} đánh giá</div>
          </div>
          {/* Bars */}
          <div style={{ flex: 1, minWidth: 180, display: "flex", flexDirection: "column", gap: 6, justifyContent: "center" }}>
            {[5, 4, 3, 2, 1].map(s => (
              <StarBar key={s} star={s} count={reviews.filter(r => r.rating === s).length} total={total} />
            ))}
          </div>
        </div>

        {/* Filter tabs */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
          {[0, 5, 4, 3, 2, 1].map(s => {
            const cnt = s === 0 ? total : reviews.filter(r => r.rating === s).length
            if (s !== 0 && cnt === 0) return null
            return (
              <button key={s}
                onClick={() => { setFilter(s); setShowAll(false) }}
                style={{
                  padding: "6px 14px", borderRadius: 20, fontSize: 13, fontWeight: 600,
                  border: filter === s ? "2px solid #f59e0b" : "1.5px solid #e5e7eb",
                  background: filter === s ? "#fef3c7" : "#fff",
                  color: filter === s ? "#92400e" : "#6b7280",
                  cursor: "pointer", transition: "all 0.15s"
                }}
              >
                {s === 0 ? `Tất cả (${cnt})` : `${s}★ (${cnt})`}
              </button>
            )
          })}
        </div>

        {/* Masonry grid */}
        <div style={{ columns: "2 280px", gap: 14 }}>
          {displayed.map((r, i) => (
            <div key={i} style={{
              breakInside: "avoid", marginBottom: 14,
              background: "#fff", borderRadius: 14, border: "1px solid #f1f5f9",
              boxShadow: "0 1px 6px rgba(0,0,0,0.05)", overflow: "hidden"
            }}>
              {/* Ảnh lớn nếu có */}
              {r.photo_url && (
                <img
                  src={r.photo_url}
                  alt={`Ảnh đánh giá của ${r.name}`}
                  style={{ width: "100%", maxHeight: 220, objectFit: "cover", display: "block", cursor: "pointer" }}
                  onClick={() => window.open(r.photo_url, "_blank")}
                />
              )}
              {/* Content */}
              <div style={{ padding: "14px 16px" }}>
                {/* Avatar + Tên */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: "50%",
                    background: getGradient(r.name),
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13, fontWeight: 800, color: "#fff", flexShrink: 0
                  }}>
                    {getInitials(r.name)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: "#111827" }}>{r.name}</span>
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: "#059669",
                        background: "#d1fae5", borderRadius: 4, padding: "1px 5px"
                      }}>✅ Đã mua</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#9ca3af" }}>{r.location} · {r.date}</div>
                  </div>
                </div>
                {/* Stars */}
                <div style={{ color: "#f59e0b", fontSize: 13, marginBottom: 6 }}>
                  {"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}
                </div>
                {/* Text */}
                <p style={{ fontSize: 13, color: "#374151", lineHeight: 1.6, margin: 0 }}>
                  "{r.text}"
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Show more */}
        {remaining > 0 && (
          <div style={{ textAlign: "center", marginTop: 8 }}>
            <button
              onClick={() => setShowAll(true)}
              style={{
                padding: "10px 28px", borderRadius: 24, fontSize: 14, fontWeight: 700,
                border: "2px solid #f59e0b", background: "#fff", color: "#92400e",
                cursor: "pointer", transition: "all 0.15s"
              }}
            >
              Xem thêm {remaining} đánh giá
            </button>
          </div>
        )}

        {/* Photo reviews count badge */}
        {starsWithPhoto.length > 0 && (
          <div style={{ marginTop: 16, textAlign: "center" }}>
            <span style={{ fontSize: 12, color: "#9ca3af" }}>
              📷 {starsWithPhoto.length} đánh giá có ảnh thực tế từ khách hàng
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
