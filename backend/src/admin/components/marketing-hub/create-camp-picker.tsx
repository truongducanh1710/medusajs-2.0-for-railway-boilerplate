import { useEffect, useState } from "react"
import { apiJson } from "../../lib/api-client"
import type { BoostTarget } from "./boost-camp-modal"

const MKT_CODES = ["KIENLB", "ANHNT", "XUANLT", "NAMDV", "DUPD", "LINHMT"]

/**
 * Bước 1 của luồng "Tạo Camp": chọn 1 video đã đăng FB (có post_id).
 * Sau khi chọn → gọi onPick(BoostTarget) để mở BoostCampModal.
 */
export function CreateCampPicker({ mktCode, isAdmin, onPick, onClose }: {
  mktCode: string | null
  isAdmin: boolean
  onPick: (t: BoostTarget) => void
  onClose: () => void
}) {
  const [posts, setPosts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState("")
  const [mktFilter, setMktFilter] = useState("")

  const load = () => {
    setLoading(true)
    apiJson("/admin/fb-content?posts=1&only_posted=1")
      .then(d => setPosts(d.posts || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const filtered = posts.filter(p => {
    if (mktFilter && (p.maker || "") !== mktFilter) return false
    if (q) {
      const s = q.toLowerCase()
      if (!(p.vd_code || "").toLowerCase().includes(s) &&
          !(p.product || "").toLowerCase().includes(s) &&
          !(p.page_name || "").toLowerCase().includes(s)) return false
    }
    return true
  })

  const inp: React.CSSProperties = { background: "#FFFFFF", color: "#111827", border: "1px solid #E5E7EB", borderRadius: 8, padding: "7px 10px", fontSize: 13, outline: "none" }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 9000 }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 560, maxWidth: "94vw", maxHeight: "84vh", background: "#FFFFFF", borderRadius: 14, boxShadow: "0 12px 40px rgba(0,0,0,0.25)", zIndex: 9001, display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #E5E7EB", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: "#111827" }}>🚀 Tạo Camp — Chọn video</div>
            <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>Chỉ hiện video đã đăng Facebook (có bài để chạy ads)</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#9CA3AF" }}>✕</button>
        </div>

        {/* Filter */}
        <div style={{ padding: "12px 20px", borderBottom: "1px solid #E5E7EB", display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 8, flex: 1 }}>
            <span style={{ padding: "0 8px", color: "#9CA3AF" }}>⌕</span>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm VD / sản phẩm / page…" style={{ flex: 1, background: "none", border: "none", outline: "none", padding: "7px 8px 7px 0", fontSize: 13 }} />
          </div>
          {isAdmin && (
            <select value={mktFilter} onChange={e => setMktFilter(e.target.value)} style={inp}>
              <option value="">Tất cả MKT</option>
              {MKT_CODES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {loading && <div style={{ padding: 30, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>Đang tải…</div>}
          {!loading && filtered.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>
              Không có video nào đã đăng FB.<br />
              <span style={{ fontSize: 12 }}>Đăng video lên FB ở Marketing Hub trước khi tạo camp.</span>
            </div>
          )}
          {filtered.map(p => {
            const boosted = p.boost_status === "active"
            const dateStr = p.published_at ? new Date(p.published_at).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }) : ""
            return (
              <button key={p.id} onClick={() => onPick({ postId: p.id, pageName: p.page_name, vdCode: p.vd_code, productName: p.product || "", mktCode })}
                style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "11px 20px", background: "none", border: "none", borderBottom: "1px solid #F3F4F6", cursor: "pointer", textAlign: "left" }}
                onMouseEnter={e => (e.currentTarget.style.background = "#F9FAFB")}
                onMouseLeave={e => (e.currentTarget.style.background = "none")}>
                <span style={{ fontSize: 20 }}>🎬</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                    <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: "#1654B8" }}>{p.vd_code || "VD?"}</span>
                    <span style={{ color: "#111827", fontSize: 13, fontWeight: 600 }} className="line-clamp-1">{p.product || "—"}</span>
                    {boosted && <span style={{ background: "#DCFCE7", color: "#059669", borderRadius: 10, padding: "1px 7px", fontSize: 10, fontWeight: 700 }}>✓ Đã lên camp</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "#9CA3AF" }}>
                    {p.page_name} {dateStr ? `· đăng ${dateStr}` : ""} {p.maker ? `· ${p.maker}` : ""}
                  </div>
                </div>
                <span style={{ color: "#1877F2", fontSize: 13, fontWeight: 600 }}>Chọn →</span>
              </button>
            )
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: "10px 20px", borderTop: "1px solid #E5E7EB", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#9CA3AF" }}>{filtered.length} video</span>
          <button onClick={onClose} style={{ background: "#F3F4F6", color: "#4B5563", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, cursor: "pointer" }}>Đóng</button>
        </div>
      </div>
    </>
  )
}
