import { useEffect, useMemo, useState } from "react"
import { apiJson } from "../../lib/api-client"
import { SKU_LIST, toCampCode, matchSkuByName, parseAdsCode, buildCampaignName } from "../../lib/camp-naming"

/**
 * Tab "🚀 Lên Camp" — 1 luồng duy nhất: chọn video nguyên liệu (Drive) từ Marketing Hub
 * rồi lên camp dark post ngay, không cần đăng Page trước. Gom về đây thay 2 nút cũ
 * (Báo cáo MKT "Tạo Camp" + Marketing Hub "Lên Camp" từng bài) để MKT chỉ có 1 đường.
 */

type VideoRow = {
  id: string; vdCode: string; sp: string; productCode?: string
  nguoiLam: string; ngayDang: string; link: string; trangThai: string
  starred?: boolean; aiScore?: number | null
}
type MktUser = { email: string; name: string; mkt_code: string | null }
type Product = { id: number; name: string; code: string }
type Account = { id: string; name: string; mkt_name: string; account_status: number }
type Audience = { id: string; name: string; subtype: string }
type Pixel = { id: string; name: string }
type Page = { page_id: string; page_name: string }

const CTA_OPTS = [
  { v: "SHOP_NOW", l: "Mua ngay" },
  { v: "GET_OFFER", l: "Nhận ưu đãi" },
  { v: "LEARN_MORE", l: "Tìm hiểu thêm" },
  { v: "ORDER_NOW", l: "Đặt hàng ngay" },
]

const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 5, display: "block" }
const inp: React.CSSProperties = { width: "100%", background: "#FFFFFF", color: "#111827", border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 10px", fontSize: 13, outline: "none" }
const groupBox: React.CSSProperties = { border: "1px solid #E5E7EB", borderRadius: 10, background: "#FFFFFF", overflow: "hidden" }
const groupHead: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "#F9FAFB", borderBottom: "1px solid #E5E7EB", fontSize: 12, fontWeight: 700, color: "#374151" }
const groupBody: React.CSSProperties = { padding: 14, display: "flex", flexDirection: "column", gap: 10 }
const fixedLine: React.CSSProperties = { fontSize: 11, color: "#9CA3AF", padding: "8px 14px", background: "#FAFAFA", borderTop: "1px solid #F3F4F6" }

export function LenCampTab({ mktCode, isAdmin }: { mktCode: string | null; isAdmin: boolean }) {
  // ── Pane trái: chọn video ──
  const [videos, setVideos] = useState<VideoRow[]>([])
  const [loadingVideos, setLoadingVideos] = useState(true)
  const [mktUsers, setMktUsers] = useState<MktUser[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [mktFilter, setMktFilter] = useState("")
  const [productFilter, setProductFilter] = useState("")
  const [q, setQ] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    apiJson("/admin/marketing-video").then(d => setVideos(d.rows || [])).catch(() => {}).finally(() => setLoadingVideos(false))
    apiJson("/admin/permissions/mkt-users").then(d => setMktUsers(d.users || [])).catch(() => {})
    apiJson("/admin/marketing-video/products").then(d => setProducts(d.products || [])).catch(() => {})
  }, [])

  const codeToName = useMemo(() => {
    const m: Record<string, string> = {}
    for (const u of mktUsers) if (u.mkt_code) m[u.mkt_code] = u.name
    return m
  }, [mktUsers])

  const filteredVideos = videos.filter(v => {
    if (!v.link) return false // cần link Drive để dark post
    if (mktFilter && v.nguoiLam !== (codeToName[mktFilter] || mktFilter)) return false
    if (productFilter && v.productCode !== productFilter) return false
    if (q) {
      const s = q.toLowerCase()
      if (!v.vdCode.toLowerCase().includes(s) && !v.sp.toLowerCase().includes(s)) return false
    }
    return true
  })

  const selectedVideos = filteredVideos.filter(v => selected.has(v.id)).length
    ? videos.filter(v => selected.has(v.id))
    : []

  const toggleSelect = (id: string) => setSelected(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  // Cảnh báo khác sản phẩm — camp mẫu gom cùng 1 SP
  const distinctProducts = new Set(selectedVideos.map(v => v.productCode || v.sp))
  const mixedProducts = distinctProducts.size > 1

  return (
    <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 16, padding: 20, alignItems: "start" }}>
      <VideoPicker
        videos={filteredVideos}
        loading={loadingVideos}
        mktUsers={mktUsers}
        products={products}
        mktFilter={mktFilter} setMktFilter={setMktFilter}
        productFilter={productFilter} setProductFilter={setProductFilter}
        q={q} setQ={setQ}
        selected={selected} toggleSelect={toggleSelect}
        isAdmin={isAdmin}
      />
      <LenCampForm
        selectedVideos={selectedVideos}
        mixedProducts={mixedProducts}
        mktCode={mktCode}
        onDone={() => { setSelected(new Set()); apiJson("/admin/marketing-video").then(d => setVideos(d.rows || [])) }}
      />
    </div>
  )
}

// ── Pane trái: chọn video ────────────────────────────────────────────────────
function VideoPicker(props: {
  videos: VideoRow[]; loading: boolean; mktUsers: MktUser[]; products: Product[]
  mktFilter: string; setMktFilter: (v: string) => void
  productFilter: string; setProductFilter: (v: string) => void
  q: string; setQ: (v: string) => void
  selected: Set<string>; toggleSelect: (id: string) => void
  isAdmin: boolean
}) {
  const { videos, loading, mktUsers, products, mktFilter, setMktFilter, productFilter, setProductFilter, q, setQ, selected, toggleSelect, isAdmin } = props
  return (
    <div style={{ ...groupBox, display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 180px)" }}>
      <div style={{ padding: 12, borderBottom: "1px solid #E5E7EB", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: "#111827" }}>Chọn video ({selected.size} đã chọn)</div>
        <div style={{ display: "flex", gap: 6 }}>
          {isAdmin && (
            <select value={mktFilter} onChange={e => setMktFilter(e.target.value)} style={{ ...inp, flex: 1 }}>
              <option value="">Tất cả MKT</option>
              {mktUsers.filter(u => u.mkt_code).map(u => <option key={u.mkt_code!} value={u.mkt_code!}>{u.name}</option>)}
            </select>
          )}
          <select value={productFilter} onChange={e => setProductFilter(e.target.value)} style={{ ...inp, flex: 1 }}>
            <option value="">Tất cả SP</option>
            {products.map(p => <option key={p.id} value={p.code}>{p.name}</option>)}
          </select>
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="⌕ tìm VD / sản phẩm…" style={inp} />
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading && <div style={{ padding: 30, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>Đang tải…</div>}
        {!loading && videos.length === 0 && (
          <div style={{ padding: 30, textAlign: "center", color: "#9CA3AF", fontSize: 12 }}>
            Không có video nào có link Drive.
          </div>
        )}
        {videos.map(v => (
          <label key={v.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", borderBottom: "1px solid #F3F4F6", cursor: "pointer" }}
            onMouseEnter={e => (e.currentTarget.style.background = "#F9FAFB")}
            onMouseLeave={e => (e.currentTarget.style.background = "none")}>
            <input type="checkbox" checked={selected.has(v.id)} onChange={() => toggleSelect(v.id)} style={{ marginTop: 3 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 18 }}>🎬</span>
                <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: "#1654B8" }}>{v.vdCode}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#111827" }} className="line-clamp-1">{v.sp || "—"}</span>
                {v.starred && <span style={{ fontSize: 11 }}>⭐{v.aiScore ?? ""}</span>}
              </div>
              <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 2 }}>
                {v.nguoiLam} {v.ngayDang ? `· ${v.ngayDang}` : ""}
              </div>
            </div>
          </label>
        ))}
      </div>
      <div style={{ padding: "8px 12px", borderTop: "1px solid #E5E7EB", fontSize: 11, color: "#9CA3AF" }}>{videos.length} video</div>
    </div>
  )
}

// ── Pane phải: form lên camp ─────────────────────────────────────────────────
function LenCampForm({ selectedVideos, mixedProducts, mktCode, onDone }: {
  selectedVideos: VideoRow[]; mixedProducts: boolean; mktCode: string | null; onDone: () => void
}) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [pages, setPages] = useState<Page[]>([])
  const [accId, setAccId] = useState("")
  const [meta, setMeta] = useState<{ audiences: Audience[]; pixels: Pixel[] }>({ audiences: [], pixels: [] })
  const [loadingMeta, setLoadingMeta] = useState(false)

  const [skuCode, setSkuCode] = useState("")
  const [audience, setAudience] = useState("30ALL")
  const [budget, setBudget] = useState(500000)
  const [pixelId, setPixelId] = useState("")
  const [ageMin, setAgeMin] = useState(25)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [funnel, setFunnel] = useState<"" | "top" | "middle" | "bottom">("")

  const [pageId, setPageId] = useState("")
  const [message, setMessage] = useState("")
  const [ctaType, setCtaType] = useState("SHOP_NOW")
  const [link, setLink] = useState("")
  const [overrides, setOverrides] = useState<Map<string, { message?: string; link?: string; cta_type?: string }>>(new Map())
  const [editingId, setEditingId] = useState<string | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState<{ vdCode: string; state: "wait" | "ok" | "err"; note?: string }[]>([])
  const [phase, setPhase] = useState("")
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiJson("/admin/fb-content/boost/meta").then(d => {
      setAccounts(d.accounts || [])
      if ((d.accounts || []).length === 1) setAccId(d.accounts[0].id)
      if (d.pages?.length) setPages(d.pages)
    }).catch(e => setError("Lỗi tải ad accounts: " + e.message))
  }, [])

  useEffect(() => {
    if (!accId) return
    setLoadingMeta(true)
    setMeta({ audiences: [], pixels: [] })
    setPixelId("")
    apiJson(`/admin/fb-content/boost/meta?account_id=${accId}`)
      .then(d => {
        setMeta({ audiences: d.audiences || [], pixels: d.pixels || [] })
        if ((d.pixels || []).length === 1) setPixelId(d.pixels[0].id)
      })
      .catch(e => setError("Lỗi tải dữ liệu account: " + e.message))
      .finally(() => setLoadingMeta(false))
  }, [accId])

  // Tự gợi ý mã SP theo video đã chọn
  useEffect(() => {
    if (selectedVideos.length === 0) return
    const guess = matchSkuByName(selectedVideos[0].sp || "")
    if (guess) setSkuCode(guess)
  }, [selectedVideos.map(v => v.id).join(",")])

  const selectedAcc = accounts.find(a => a.id === accId)
  const adsCode = selectedAcc ? parseAdsCode(selectedAcc.name) : "ADS"
  const vdCodes = selectedVideos.map(v => v.vdCode)
  const adsetNamePreview = vdCodes.length <= 1 ? (vdCodes[0] || "VD") : joinVdCodesPreview(vdCodes)
  const campNamePreview = buildCampaignName({
    skuCode: skuCode || "PHVVN",
    mktCode: mktCode || "MKT",
    productName: selectedVideos[0]?.sp || "SP",
    adsCode, audience, vdCode: adsetNamePreview,
  })

  const toggleExcl = (id: string) => setExcluded(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  const applyFunnel = (f: "top" | "middle" | "bottom") => {
    setFunnel(f)
    const auds = meta.audiences
    const find = (re: RegExp) => auds.filter(a => re.test(a.name)).map(a => a.id)
    const purchaseIds = find(/^PUR_|PURCH|MUA HÀNG|ĐÃ MUA/i)
    if (f === "top") { setAudience("BROAD"); setExcluded(new Set(purchaseIds)) }
    else if (f === "middle") { setAudience("RETARGET"); setExcluded(new Set(purchaseIds)) }
    else { setAudience("UPSELL"); setExcluded(new Set()) }
  }

  const setOverride = (id: string, patch: Partial<{ message: string; link: string; cta_type: string }>) => {
    setOverrides(prev => {
      const n = new Map(prev)
      n.set(id, { ...n.get(id), ...patch })
      return n
    })
  }

  const canSubmit = accId && pageId && message.trim() && link.trim() && pixelId && selectedVideos.length > 0 && budget >= 50000

  const submit = async () => {
    if (!canSubmit || submitting) return
    setSubmitting(true); setError(null); setResult(null)
    setProgress(selectedVideos.map(v => ({ vdCode: v.vdCode, state: "wait" })))
    setPhase(selectedVideos.length > 1 ? "Upload video…" : "Upload video…")
    try {
      const videosPayload = selectedVideos.map(v => {
        const ov = overrides.get(v.id) || {}
        return {
          vd_code: v.vdCode,
          drive_url: v.link,
          message: ov.message,
          cta_type: ov.cta_type,
          link: ov.link,
        }
      })
      setPhase("Tạo camp…")
      const d = await apiJson("/admin/fb-content/boost", "POST", {
        mode: "dark_post_raw_video",
        ad_account_id: accId,
        page_id: pageId,
        message, cta_type: ctaType, link,
        videos: videosPayload,
        campaign_name: campNamePreview,
        sku_code: skuCode, ads_code: adsCode, audience,
        daily_budget: budget, pixel_id: pixelId,
        excluded_audience_ids: [...excluded],
        age_min: ageMin,
        product_name: selectedVideos[0]?.sp,
        adset_name: adsetNamePreview,
      })
      setPhase("Xong")
      setProgress(prev => prev.map(p => {
        const ok = (d.ads || []).some((a: any) => a.vd_code === p.vdCode)
        const err = (d.errors || []).find((e: any) => e.vd_code === p.vdCode)
        return { vdCode: p.vdCode, state: ok ? "ok" : "err", note: err?.error }
      }))
      setResult(d)
      onDone()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (result) {
    return (
      <div style={{ ...groupBox, padding: 30, textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
        <div style={{ fontWeight: 700, fontSize: 16, color: "#059669", marginBottom: 8 }}>
          Đã tạo {result.ads?.length || 0} quảng cáo (PAUSED)
        </div>
        {result.campaign_name && <div style={{ fontFamily: "monospace", fontSize: 12, color: "#1654B8", background: "#EFF6FF", borderRadius: 6, padding: "6px 10px", marginBottom: 12, wordBreak: "break-all" }}>{result.campaign_name}</div>}
        {result.errors?.length > 0 && (
          <div style={{ fontSize: 12, color: "#DC2626", background: "#FEE2E2", borderRadius: 8, padding: "8px 12px", marginBottom: 12, textAlign: "left" }}>
            {result.errors.map((e: any) => <div key={e.vd_code}>⚠️ {e.vd_code}: {e.error}</div>)}
          </div>
        )}
        <a href={result.adsmanager_url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", background: "#1877F2", color: "#fff", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>↗ Mở AdsManager (review + bật)</a>
        <div style={{ marginTop: 14 }}>
          <button onClick={() => setResult(null)} style={{ background: "none", border: "1px solid #E5E7EB", borderRadius: 8, padding: "7px 18px", fontSize: 13, cursor: "pointer", color: "#4B5563" }}>Tạo camp khác</button>
        </div>
      </div>
    )
  }

  if (submitting) {
    return (
      <div style={{ ...groupBox, padding: 30 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>{phase}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {progress.map(p => (
            <div key={p.vdCode} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <span>{p.state === "wait" ? "⏳" : p.state === "ok" ? "✅" : "❌"}</span>
              <span style={{ fontFamily: "monospace" }}>{p.vdCode}</span>
              {p.note && <span style={{ color: "#DC2626", fontSize: 11 }}>{p.note}</span>}
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 14 }}>Upload + xử lý video có thể mất vài phút, đừng tắt trang.</div>
      </div>
    )
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {selectedVideos.length === 0 && (
        <div style={{ ...groupBox, padding: 30, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>
          ← Chọn ít nhất 1 video ở bên trái để bắt đầu lên camp.
        </div>
      )}

      {selectedVideos.length > 0 && (
        <>
          <div>
            <label style={lbl}>Tài khoản quảng cáo</label>
            <select value={accId} onChange={e => setAccId(e.target.value)} style={inp}>
              <option value="">— Chọn ad account —</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}{a.account_status !== 1 ? " (tắt)" : ""}</option>)}
            </select>
          </div>

          {mixedProducts && (
            <div style={{ fontSize: 12, color: "#92400E", background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 12px" }}>
              ⚠️ Các video đang chọn khác sản phẩm — camp mẫu thường gom video cùng 1 SP vào 1 camp.
            </div>
          )}

          {accId && !loadingMeta && (
            <>
              {/* ① CHIẾN DỊCH */}
              <div style={groupBox}>
                <div style={groupHead}><span>① CHIẾN DỊCH</span><span style={{ color: "#9CA3AF", fontWeight: 500 }}>2 field</span></div>
                <div style={groupBody}>
                  <div>
                    <label style={lbl}>Tên Campaign (tự sinh)</label>
                    <div style={{ fontFamily: "monospace", fontSize: 11.5, color: "#1654B8", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, padding: "8px 10px", wordBreak: "break-all", lineHeight: 1.5 }}>{campNamePreview}</div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <label style={lbl}>Mã SP (POS)</label>
                      <select value={skuCode} onChange={e => setSkuCode(e.target.value)} style={inp}>
                        <option value="">— Chọn mã SP —</option>
                        {SKU_LIST.map(s => <option key={s.pos} value={toCampCode(s.pos)}>{toCampCode(s.pos)} · {s.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={lbl}>Ngân sách/ngày (đ)</label>
                      <input type="number" value={budget} onChange={e => setBudget(Number(e.target.value))} style={inp} />
                    </div>
                  </div>
                </div>
                <div style={fixedLine}>🔒 Mục tiêu Doanh số · Ngân sách cấp camp (CBO) · Giá thầu thấp nhất · PAUSED</div>
              </div>

              {/* ② NHÓM QUẢNG CÁO */}
              <div style={groupBox}>
                <div style={groupHead}><span>② NHÓM QUẢNG CÁO</span><span style={{ fontFamily: "monospace", color: "#9CA3AF", fontWeight: 500 }}>{adsetNamePreview}</span></div>
                <div style={groupBody}>
                  <div>
                    <label style={lbl}>Tầng phễu (chọn để gợi ý loại trừ)</label>
                    <div style={{ display: "flex", gap: 6 }}>
                      {([["top", "❄️ Lạnh", "Khách mới, loại trừ người đã mua"], ["middle", "🔥 Ấm", "Retarget người quan tâm chưa mua"], ["bottom", "💎 Nóng", "Upsell người đã mua"]] as const).map(([f, label, desc]) => (
                        <button key={f} type="button" onClick={() => applyFunnel(f)} title={desc}
                          style={{ flex: 1, background: funnel === f ? "#1877F2" : "#F3F4F6", color: funnel === f ? "#fff" : "#4B5563", border: "none", borderRadius: 8, padding: "8px 6px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{label}</button>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <label style={lbl}>Pixel</label>
                      <select value={pixelId} onChange={e => setPixelId(e.target.value)} style={inp}>
                        <option value="">— Chọn pixel —</option>
                        {meta.pixels.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={lbl}>Tuổi tối thiểu (gợi ý)</label>
                      <input type="number" value={ageMin} onChange={e => setAgeMin(Number(e.target.value))} style={inp} />
                    </div>
                  </div>
                  <div style={{ fontSize: 10.5, color: "#9CA3AF" }}>Advantage+ vẫn có thể phân phối ngoài khoảng tuổi này.</div>
                  <div>
                    <label style={lbl}>Loại trừ đối tượng ({excluded.size} chọn)</label>
                    <div style={{ maxHeight: 140, overflowY: "auto", border: "1px solid #E5E7EB", borderRadius: 8, background: "#fff" }}>
                      {meta.audiences.length === 0 && <div style={{ padding: 10, fontSize: 12, color: "#9CA3AF" }}>Không có audience</div>}
                      {meta.audiences.map(a => (
                        <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderBottom: "1px solid #F3F4F6", cursor: "pointer", fontSize: 12 }}>
                          <input type="checkbox" checked={excluded.has(a.id)} onChange={() => toggleExcl(a.id)} />
                          <span style={{ flex: 1, color: "#374151" }}>{a.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
                <div style={fixedLine}>🔒 Việt Nam · Advantage+ Audience · vị trí tự động · Chuyển đổi ngoài trang</div>
                <div style={fixedLine}>🔒 Đo lường: 7 ngày click · 1 ngày xem · 1 ngày xem video</div>
              </div>

              {/* ③ QUẢNG CÁO */}
              <div style={groupBox}>
                <div style={groupHead}><span>③ QUẢNG CÁO</span><span style={{ color: "#9CA3AF", fontWeight: 500 }}>{selectedVideos.length} ad</span></div>
                <div style={groupBody}>
                  <div>
                    <label style={lbl}>Facebook Page</label>
                    <select value={pageId} onChange={e => setPageId(e.target.value)} style={inp}>
                      <option value="">— Chọn page —</option>
                      {pages.map(p => <option key={p.page_id} value={p.page_id}>{p.page_name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>Nội dung bài (caption chung)</label>
                    <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3} placeholder="Nội dung quảng cáo…" style={{ ...inp, resize: "vertical" }} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <label style={lbl}>Nút CTA</label>
                      <select value={ctaType} onChange={e => setCtaType(e.target.value)} style={inp}>
                        {CTA_OPTS.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={lbl}>Link trang đích</label>
                      <input value={link} onChange={e => setLink(e.target.value)} placeholder="https://giadungphanviet.shop/..." style={inp} />
                    </div>
                  </div>

                  {selectedVideos.length > 1 && (
                    <div style={{ borderTop: "1px dashed #E5E7EB", paddingTop: 10 }}>
                      <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 6 }}>Áp caption/CTA/link chung cho {selectedVideos.length} video — sửa riêng nếu cần</div>
                      {selectedVideos.map(v => {
                        const hasOverride = overrides.has(v.id)
                        return (
                          <div key={v.id} style={{ marginBottom: 6 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                              <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{v.vdCode}</span>
                              <button type="button" onClick={() => setEditingId(editingId === v.id ? null : v.id)}
                                style={{ background: "none", border: "none", color: hasOverride ? "#1877F2" : "#9CA3AF", fontSize: 11, cursor: "pointer" }}>
                                {hasOverride ? "● đã sửa riêng" : "✎ sửa riêng"}
                              </button>
                            </div>
                            {editingId === v.id && (
                              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6, padding: 8, background: "#F9FAFB", borderRadius: 8 }}>
                                <textarea placeholder={`Caption riêng cho ${v.vdCode} (để trống = dùng chung)`}
                                  defaultValue={overrides.get(v.id)?.message || ""}
                                  onChange={e => setOverride(v.id, { message: e.target.value || undefined })}
                                  rows={2} style={{ ...inp, resize: "vertical", fontSize: 12 }} />
                                <input placeholder="Link riêng (để trống = dùng chung)"
                                  defaultValue={overrides.get(v.id)?.link || ""}
                                  onChange={e => setOverride(v.id, { link: e.target.value || undefined })}
                                  style={{ ...inp, fontSize: 12 }} />
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
                <div style={fixedLine}>🔒 UTM tự gắn · tên ad = mã VD · PAUSED</div>
              </div>

              {error && <div style={{ fontSize: 12, color: "#DC2626", background: "#FEE2E2", border: "1px solid #FECACA", borderRadius: 8, padding: "8px 12px" }}>⚠️ {error}</div>}

              <button onClick={submit} disabled={!canSubmit} style={{
                background: canSubmit ? "#10b981" : "#D1D5DB", color: "#fff", border: "none", borderRadius: 10,
                padding: "12px 20px", fontSize: 14, fontWeight: 700, cursor: canSubmit ? "pointer" : "not-allowed",
              }}>
                🚀 Tạo Camp ({selectedVideos.length} ad)
              </button>
            </>
          )}
        </>
      )}
    </div>
  )
}

/** Gộp nhiều mã VD giống cách camp mẫu đặt tên adset: VD111 + VD112 + VD113V → "VD111112113V". */
function joinVdCodesPreview(vdCodes: string[]): string {
  if (vdCodes.length <= 1) return vdCodes[0] || "VD"
  const prefix = vdCodes[0].match(/^[A-Za-z]+/)?.[0] || "VD"
  const nums = vdCodes.map(v => v.replace(/^[A-Za-z]+/, ""))
  return prefix + nums.join("")
}
