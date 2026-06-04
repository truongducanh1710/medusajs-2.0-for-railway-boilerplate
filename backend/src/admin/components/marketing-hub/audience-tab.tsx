import { useEffect, useState } from "react"
import { apiJson } from "../../lib/api-client"

type Account = { id: string; name: string; mkt_name: string }
type Audience = { id: string; name: string; subtype: string; audience_group: string }
type Pixel = { id: string; name: string }

// Giải thích bản chất từng nhóm tệp — để MKT hiểu
const GROUP_INFO: Record<string, { label: string; c: string; bg: string; icon: string; desc: string }> = {
  hot:       { label: "Nóng (Retarget)", c: "#DC2626", bg: "#FEE2E2", icon: "🔥", desc: "Người đã tương tác (xem SP, thêm giỏ, xem video, điền form) — chạy lại để chốt đơn" },
  exclude:   { label: "Loại trừ (Đã mua)", c: "#6B7280", bg: "#F3F4F6", icon: "🚫", desc: "Người ĐÃ MUA — loại trừ khi chạy camp lạnh/ấm để khỏi đốt tiền vào khách cũ" },
  lookalike: { label: "Lookalike (Mở rộng)", c: "#7C3AED", bg: "#EDE9FE", icon: "✨", desc: "Tệp tương tự người mua — FB tìm khách mới giống khách đã mua, mở rộng chất lượng" },
  other:     { label: "Khác / Chưa phân loại", c: "#9CA3AF", bg: "#F9FAFB", icon: "❓", desc: "Tên không theo chuẩn — nên dọn hoặc đổi tên" },
}

export function AudienceTab({ isAdmin, mktCode }: { isAdmin: boolean; mktCode: string | null }) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [accId, setAccId] = useState("")
  const [auds, setAuds] = useState<Audience[]>([])
  const [pixels, setPixels] = useState<Pixel[]>([])
  const [summary, setSummary] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  // Form tạo bộ chuẩn
  const [showCreate, setShowCreate] = useState(false)
  const [newSp, setNewSp] = useState("")
  const [newPixel, setNewPixel] = useState("")
  const [creating, setCreating] = useState(false)
  const [createResult, setCreateResult] = useState<any>(null)

  useEffect(() => {
    apiJson("/admin/fb-content/boost/meta")
      .then(d => { setAccounts(d.accounts || []); if ((d.accounts || []).length === 1) setAccId(d.accounts[0].id) })
      .catch(() => {})
  }, [])

  const load = () => {
    if (!accId) return
    setLoading(true)
    apiJson(`/admin/fb-content/audiences?account_id=${accId}`)
      .then(d => { setAuds(d.audiences || []); setPixels(d.pixels || []); setSummary(d.summary || {}) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [accId])

  const createSet = async () => {
    if (!newSp.trim() || !newPixel) { setToast("Nhập tên SP + chọn pixel"); return }
    setCreating(true); setCreateResult(null)
    try {
      const d = await apiJson("/admin/fb-content/audiences", "POST", { account_id: accId, sku_sp: newSp, pixel_id: newPixel })
      setCreateResult(d)
      setToast(`Đã tạo ${d.created.length} tệp` + (d.errors.length ? `, ${d.errors.length} lỗi` : ""))
      load()
    } catch (e: any) { setToast("Lỗi: " + e.message) }
    finally { setCreating(false) }
  }

  // Group audiences theo nhóm
  const grouped: Record<string, Audience[]> = { hot: [], exclude: [], lookalike: [], other: [] }
  for (const a of auds) (grouped[a.audience_group] || grouped.other).push(a)

  const inp: React.CSSProperties = { background: "#FFFFFF", color: "#111827", border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 10px", fontSize: 13, outline: "none" }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {toast && <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999, background: "#1877F2", color: "#fff", borderRadius: 12, padding: "12px 18px", fontSize: 13, fontWeight: 500 }}>✓ {toast}</div>}

      {/* Giải thích nhanh tầng phễu */}
      <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 12, padding: "12px 16px", fontSize: 12, color: "#1e40af", lineHeight: 1.6 }}>
        <b>Tệp đối tượng là gì?</b> FB ghi nhớ người tương tác với web/video qua pixel. Bạn dùng tệp này để:
        <b> 🔥 chạy lại</b> người quan tâm · <b>🚫 loại trừ</b> người đã mua (khỏi tốn tiền) · <b>✨ mở rộng</b> tìm khách giống người mua.
      </div>

      {/* Chọn account + summary */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <select value={accId} onChange={e => setAccId(e.target.value)} style={inp}>
          <option value="">— Chọn tài khoản —</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        {accId && Object.entries(GROUP_INFO).filter(([k]) => k !== "other").map(([k, info]) => (
          <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: info.bg, color: info.c, borderRadius: 20, padding: "3px 10px", fontSize: 12, fontWeight: 600 }}>
            {info.icon} {summary[k] || 0}
          </span>
        ))}
        <button onClick={() => setShowCreate(s => !s)} disabled={!accId} style={{ marginLeft: "auto", background: accId ? "#10b981" : "#9CA3AF", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: accId ? "pointer" : "not-allowed" }}>
          ＋ Tạo bộ tệp chuẩn cho SP
        </button>
      </div>

      {/* Form tạo bộ chuẩn */}
      {showCreate && accId && (
        <div style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Tạo bộ tệp chuẩn (5 tệp 1 lần)</div>
          <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 12 }}>
            Hệ thống tự tạo: <b>PUR</b> (đã mua 90d) · <b>ATC</b> (thêm giỏ 14d) · <b>VC</b> (xem SP 30d) · <b>REG</b> (điền form 30d) · <b>LAL</b> (lookalike người mua). Đặt tên chuẩn tự động.
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 200px" }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", display: "block", marginBottom: 4 }}>TÊN SP (viết tắt gợi nhớ)</label>
              <input value={newSp} onChange={e => setNewSp(e.target.value)} placeholder="VD: CHẢO VÀNG" style={{ ...inp, width: "100%" }} />
            </div>
            <div style={{ flex: "1 1 200px" }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", display: "block", marginBottom: 4 }}>PIXEL</label>
              <select value={newPixel} onChange={e => setNewPixel(e.target.value)} style={{ ...inp, width: "100%" }}>
                <option value="">— Chọn pixel —</option>
                {pixels.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <button onClick={createSet} disabled={creating} style={{ background: creating ? "#93C5FD" : "#1877F2", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: creating ? "wait" : "pointer" }}>
              {creating ? "Đang tạo…" : "🚀 Tạo bộ tệp"}
            </button>
          </div>
          {createResult && (
            <div style={{ marginTop: 12, fontSize: 12 }}>
              {createResult.created.map((c: any) => <div key={c.id} style={{ color: "#059669" }}>✓ {c.name}</div>)}
              {createResult.errors.map((e: any, i: number) => <div key={i} style={{ color: "#DC2626" }}>✗ {e.name}: {e.error}</div>)}
            </div>
          )}
        </div>
      )}

      {loading && <div style={{ padding: 30, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>Đang tải tệp…</div>}
      {!accId && <div style={{ padding: 40, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>Chọn tài khoản để xem tệp đối tượng</div>}

      {/* Danh sách theo nhóm */}
      {accId && !loading && (["hot", "exclude", "lookalike", "other"] as const).map(g => {
        const list = grouped[g]; if (!list.length) return null
        const info = GROUP_INFO[g]
        return (
          <div key={g} style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "10px 16px", background: info.bg, borderBottom: "1px solid #E5E7EB" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 700, color: info.c, fontSize: 14 }}>{info.icon} {info.label}</span>
                <span style={{ color: "#6B7280", fontSize: 12 }}>({list.length})</span>
              </div>
              <div style={{ fontSize: 11, color: info.c, marginTop: 3, opacity: 0.85 }}>{info.desc}</div>
            </div>
            <div>
              {list.map((a, i) => (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", borderBottom: i < list.length - 1 ? "1px solid #F3F4F6" : "none" }}>
                  <span style={{ fontSize: 13, color: "#111827", flex: 1 }}>{a.name}</span>
                  <span style={{ fontSize: 10, color: "#9CA3AF", fontFamily: "monospace" }}>{a.subtype}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
