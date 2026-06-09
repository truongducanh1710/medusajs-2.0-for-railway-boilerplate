import { useEffect, useState } from "react"
import { apiJson } from "../../lib/api-client"
import { SKU_LIST, toCampCode, matchSkuByName, parseAdsCode, buildCampaignName } from "../../lib/camp-naming"

export type BoostTarget = {
  postId?: string         // fb_scheduled_post.id (UUID DB) — không bắt buộc với mode C/D
  pageName?: string
  vdCode?: string
  productName?: string
  mktCode?: string | null
}

type Account = { id: string; name: string; mkt_name: string; account_status: number }
type Audience = { id: string; name: string; subtype: string }
type Pixel = { id: string; name: string }
type Adset = { id: string; name: string; status: string }
type Campaign = { id: string; name: string; status: string; adsets: Adset[] }
type Page = { page_id: string; page_name: string }

const CTA_OPTS = [
  { v: "SHOP_NOW", l: "Mua ngay" },
  { v: "GET_OFFER", l: "Nhận ưu đãi" },
  { v: "LEARN_MORE", l: "Tìm hiểu thêm" },
  { v: "ORDER_NOW", l: "Đặt hàng ngay" },
]

type Mode = "existing_adset" | "new_campaign" | "from_ad_id" | "unpublished_post"

export function BoostCampModal({ target, onClose, onDone }: { target: BoostTarget; onClose: () => void; onDone?: () => void }) {
  const [mode, setMode] = useState<Mode>(target.postId ? "existing_adset" : "from_ad_id")
  const [accounts, setAccounts] = useState<Account[]>([])
  const [accId, setAccId] = useState("")
  const [meta, setMeta] = useState<{ audiences: Audience[]; pixels: Pixel[]; campaigns: Campaign[] }>({ audiences: [], pixels: [], campaigns: [] })
  const [loadingMeta, setLoadingMeta] = useState(false)

  // Mode A — vào adset có sẵn
  const [campId, setCampId] = useState("")
  const [adsetId, setAdsetId] = useState("")

  // Mode B — camp mới từ bài đã đăng
  const [skuCode, setSkuCode] = useState(matchSkuByName(target.productName || ""))
  const [audience, setAudience] = useState("30ALL")
  const [budget, setBudget] = useState(500000)
  const [pixelId, setPixelId] = useState("")
  const [ctaUrl, setCtaUrl] = useState("")
  const [ctaType, setCtaType] = useState("GET_OFFER")
  const [ageMin, setAgeMin] = useState(25)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [funnel, setFunnel] = useState<"" | "top" | "middle" | "bottom">("")

  // Mode C — từ ad ID cũ
  const [sourceAdId, setSourceAdId] = useState("")
  const [sourceAdInfo, setSourceAdInfo] = useState<any>(null)
  const [loadingAdInfo, setLoadingAdInfo] = useState(false)
  const [adIdMode, setAdIdMode] = useState<"existing_adset" | "new_campaign">("existing_adset")

  // Mode D — dark post (video/ảnh chưa đăng)
  const [pages, setPages] = useState<Page[]>([])
  const [darkPageId, setDarkPageId] = useState("")
  const [darkMessage, setDarkMessage] = useState("")
  const [darkVideoId, setDarkVideoId] = useState("")
  const [darkImageUrl, setDarkImageUrl] = useState("")
  const [darkLink, setDarkLink] = useState("")
  const [darkVdCode, setDarkVdCode] = useState(target.vdCode || "")
  const [darkAdsetMode, setDarkAdsetMode] = useState<"existing_adset" | "new_campaign">("new_campaign")

  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState<string[]>([])
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  // Load accounts + pages
  useEffect(() => {
    apiJson("/admin/fb-content/boost/meta")
      .then(d => {
        setAccounts(d.accounts || [])
        if ((d.accounts || []).length === 1) setAccId(d.accounts[0].id)
        if (d.pages?.length) setPages(d.pages)
      })
      .catch(e => setError("Lỗi tải ad accounts: " + e.message))
  }, [])

  // Preview ad nguồn (mode C) khi nhập ad ID
  useEffect(() => {
    const id = sourceAdId.trim()
    if (!id || id.length < 10) { setSourceAdInfo(null); return }
    const t = setTimeout(() => {
      setLoadingAdInfo(true)
      apiJson(`/admin/fb-content/boost?ad_id=${id}`)
        .then(d => setSourceAdInfo(d))
        .catch(e => setSourceAdInfo({ error: e.message }))
        .finally(() => setLoadingAdInfo(false))
    }, 600)
    return () => clearTimeout(t)
  }, [sourceAdId])

  // Load meta khi chọn account
  useEffect(() => {
    if (!accId) return
    setLoadingMeta(true)
    setMeta({ audiences: [], pixels: [], campaigns: [] })
    setCampId(""); setAdsetId(""); setPixelId("")
    apiJson(`/admin/fb-content/boost/meta?account_id=${accId}`)
      .then(d => {
        setMeta({ audiences: d.audiences || [], pixels: d.pixels || [], campaigns: d.campaigns || [] })
        if ((d.pixels || []).length === 1) setPixelId(d.pixels[0].id)
      })
      .catch(e => setError("Lỗi tải dữ liệu account: " + e.message))
      .finally(() => setLoadingMeta(false))
  }, [accId])

  const selectedAcc = accounts.find(a => a.id === accId)
  const adsCode = selectedAcc ? parseAdsCode(selectedAcc.name) : "ADS"
  const adsetsOfCamp = meta.campaigns.find(c => c.id === campId)?.adsets || []

  // Preview tên camp (mode B)
  const campNamePreview = buildCampaignName({
    skuCode: skuCode || "PHVVN",
    mktCode: target.mktCode || "MKT",
    productName: target.productName || "SP",
    adsCode,
    audience,
    vdCode: target.vdCode || "VD",
  })

  const toggleExcl = (id: string) => setExcluded(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  // Gợi ý tầng phễu: tự set audience + tick loại trừ theo bản chất
  const applyFunnel = (f: "top" | "middle" | "bottom") => {
    setFunnel(f)
    const auds = meta.audiences
    const find = (re: RegExp) => auds.filter(a => re.test(a.name)).map(a => a.id)
    const purchaseIds = find(/^PUR_|PURCH|MUA HÀNG|ĐÃ MUA/i)
    if (f === "top") {
      // Lạnh: broad + loại trừ người đã mua
      setAudience("BROAD")
      setExcluded(new Set(purchaseIds))
    } else if (f === "middle") {
      // Ấm: retarget — vẫn loại trừ đã mua (chốt người quan tâm chưa mua)
      setAudience("RETARGET")
      setExcluded(new Set(purchaseIds))
    } else {
      // Nóng: upsell người đã mua → KHÔNG loại trừ
      setAudience("UPSELL")
      setExcluded(new Set())
    }
  }

  const canSubmit = accId && (() => {
    if (mode === "existing_adset") return !!adsetId
    if (mode === "new_campaign") return budget >= 50000
    if (mode === "from_ad_id") return !!sourceAdId && !sourceAdInfo?.error && (adIdMode === "existing_adset" ? !!adsetId : budget >= 50000)
    if (mode === "unpublished_post") return !!darkPageId && !!darkMessage && (darkAdsetMode === "existing_adset" ? !!adsetId : budget >= 50000)
    return false
  })()

  const submit = async () => {
    if (!canSubmit || submitting) return
    setSubmitting(true); setError(null); setProgress([]); setResult(null)
    try {
      const body: any = { mode, ad_account_id: accId }

      if (mode === "existing_adset") {
        body.post_id = target.postId
        body.adset_id = adsetId
        setProgress(["Tạo Creative…"])
      } else if (mode === "new_campaign") {
        body.post_id = target.postId
        Object.assign(body, {
          campaign_name: campNamePreview,
          sku_code: skuCode, ads_code: adsCode, audience,
          daily_budget: budget, pixel_id: pixelId,
          excluded_audience_ids: [...excluded],
          cta_url: ctaUrl, cta_type: ctaType, age_min: ageMin,
        })
        setProgress(["Tạo Campaign…"])
      } else if (mode === "from_ad_id") {
        body.source_ad_id = sourceAdId.trim()
        if (adIdMode === "existing_adset") {
          body.adset_id = adsetId
          setProgress(["Clone creative từ ad cũ…"])
        } else {
          Object.assign(body, {
            campaign_name: campNamePreview,
            daily_budget: budget, pixel_id: pixelId,
            excluded_audience_ids: [...excluded],
            age_min: ageMin,
          })
          setProgress(["Clone creative + tạo camp mới…"])
        }
      } else if (mode === "unpublished_post") {
        Object.assign(body, {
          page_id: darkPageId,
          message: darkMessage,
          vd_code: darkVdCode,
          video_id: darkVideoId || undefined,
          image_url: darkImageUrl || undefined,
          link: darkLink || undefined,
        })
        if (darkAdsetMode === "existing_adset") {
          body.adset_id = adsetId
          setProgress(["Tạo dark post…", "Tạo Creative…"])
        } else {
          Object.assign(body, {
            campaign_name: campNamePreview,
            sku_code: skuCode, ads_code: adsCode, audience,
            daily_budget: budget, pixel_id: pixelId,
            excluded_audience_ids: [...excluded],
            age_min: ageMin,
            product_name: target.productName,
          })
          setProgress(["Tạo dark post…", "Tạo Campaign…"])
        }
      }

      const d = await apiJson("/admin/fb-content/boost", "POST", body)
      setProgress(p => [...p, "Hoàn tất ✓"])
      setResult(d)
      onDone?.()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 5, display: "block" }
  const inp: React.CSSProperties = { width: "100%", background: "#FFFFFF", color: "#111827", border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 10px", fontSize: 13, outline: "none" }

  return (
    <>
      {/* Overlay mờ */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", zIndex: 9000 }} />
      {/* Panel slide-in */}
      <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 420, maxWidth: "92vw", background: "#F9FAFB", boxShadow: "-4px 0 24px rgba(0,0,0,0.12)", zIndex: 9001, display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #E5E7EB", background: "#FFFFFF", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: "#111827" }}>🚀 Lên Camp</div>
            <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>
              {target.vdCode} · {target.productName} {target.pageName ? `· ${target.pageName}` : ""}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#9CA3AF" }}>✕</button>
        </div>

        {/* Body scroll */}
        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
          {result ? (
            // ── Kết quả thành công ──
            <div style={{ textAlign: "center", padding: "30px 10px" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#059669", marginBottom: 8 }}>Đã tạo thành công (PAUSED)</div>
              {result.campaign_name && <div style={{ fontFamily: "monospace", fontSize: 12, color: "#1654B8", background: "#EFF6FF", borderRadius: 6, padding: "6px 10px", marginBottom: 12, wordBreak: "break-all" }}>{result.campaign_name}</div>}
              <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 16 }}>
                {result.campaign_id && <div>Campaign: {result.campaign_id}</div>}
                {result.adset_id && <div>Ad Set: {result.adset_id}</div>}
                <div>Ad: {result.ad_id}</div>
              </div>
              <a href={result.adsmanager_url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", background: "#1877F2", color: "#fff", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>↗ Mở AdsManager (review + bật)</a>
              <div style={{ marginTop: 14 }}>
                <button onClick={onClose} style={{ background: "none", border: "1px solid #E5E7EB", borderRadius: 8, padding: "7px 18px", fontSize: 13, cursor: "pointer", color: "#4B5563" }}>Đóng</button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Mode tabs */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", background: "#F3F4F6", borderRadius: 8, padding: 2, gap: 2 }}>
                {([
                  ["existing_adset",  "⭐ Camp cũ",   !!target.postId],
                  ["new_campaign",    "✨ Camp mới",   !!target.postId],
                  ["from_ad_id",      "🔁 Ad cũ",     true],
                  ["unpublished_post","🌑 Dark post",  true],
                ] as [Mode, string, boolean][]).map(([m, l, enabled]) => (
                  <button key={m} onClick={() => enabled && setMode(m as Mode)} title={!enabled ? "Cần chọn video đã đăng FB" : undefined}
                    style={{ background: mode === m ? "#FFFFFF" : "transparent", border: "none", borderRadius: 6, padding: "7px 4px", fontSize: 11, fontWeight: 600, cursor: enabled ? "pointer" : "not-allowed", color: mode === m ? "#111827" : enabled ? "#6B7280" : "#D1D5DB", boxShadow: mode === m ? "0 1px 3px rgba(0,0,0,0.1)" : "none", whiteSpace: "nowrap" }}>{l}</button>
                ))}
              </div>

              {/* Ad Account */}
              <div>
                <label style={lbl}>Tài khoản quảng cáo</label>
                <select value={accId} onChange={e => setAccId(e.target.value)} style={inp}>
                  <option value="">— Chọn ad account —</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name}{a.account_status !== 1 ? " (tắt)" : ""}</option>)}
                </select>
                {accounts.length === 0 && <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 4 }}>Không có account nào được gán cho bạn</div>}
              </div>

              {loadingMeta && <div style={{ fontSize: 12, color: "#9CA3AF", textAlign: "center", padding: 10 }}>Đang tải dữ liệu account…</div>}

              {accId && !loadingMeta && mode === "existing_adset" && (
                <>
                  <div>
                    <label style={lbl}>Campaign</label>
                    <select value={campId} onChange={e => { setCampId(e.target.value); setAdsetId("") }} style={inp}>
                      <option value="">— Chọn campaign —</option>
                      {meta.campaigns.map(c => <option key={c.id} value={c.id}>[{c.status === "ACTIVE" ? "▶" : "⏸"}] {c.name}</option>)}
                    </select>
                  </div>
                  {campId && (
                    <div>
                      <label style={lbl}>Ad Set (ad sẽ thêm vào đây)</label>
                      <select value={adsetId} onChange={e => setAdsetId(e.target.value)} style={inp}>
                        <option value="">— Chọn ad set —</option>
                        {adsetsOfCamp.map(a => <option key={a.id} value={a.id}>[{a.status === "ACTIVE" ? "▶" : "⏸"}] {a.name}</option>)}
                      </select>
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: "#6B7280", background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 12px" }}>
                    Ad mới sẽ tạo <b>PAUSED</b>. Vào AdsManager review rồi bật tay.
                  </div>
                </>
              )}

              {accId && !loadingMeta && mode === "new_campaign" && (
                <>
                  {/* Tên camp preview */}
                  <div>
                    <label style={lbl}>Tên Campaign (tự sinh)</label>
                    <div style={{ fontFamily: "monospace", fontSize: 11.5, color: "#1654B8", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, padding: "8px 10px", wordBreak: "break-all", lineHeight: 1.5 }}>{campNamePreview}</div>
                  </div>
                  {/* Gợi ý tầng phễu — chọn để tự set audience + loại trừ */}
                  <div>
                    <label style={lbl}>Tầng phễu (chọn để gợi ý loại trừ)</label>
                    <div style={{ display: "flex", gap: 6 }}>
                      {([
                        ["top", "❄️ Lạnh", "Khách mới, loại trừ người đã mua"],
                        ["middle", "🔥 Ấm", "Retarget người quan tâm chưa mua"],
                        ["bottom", "💎 Nóng", "Upsell người đã mua"],
                      ] as const).map(([f, label, desc]) => (
                        <button key={f} type="button" onClick={() => applyFunnel(f)} title={desc}
                          style={{ flex: 1, background: funnel === f ? "#1877F2" : "#F3F4F6", color: funnel === f ? "#fff" : "#4B5563", border: "none", borderRadius: 8, padding: "8px 6px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                          {label}
                        </button>
                      ))}
                    </div>
                    {funnel && (
                      <div style={{ fontSize: 11, color: "#6B7280", marginTop: 5, background: "#F9FAFB", borderRadius: 6, padding: "6px 10px" }}>
                        {funnel === "top" && "❄️ Khách lạnh: nhắm rộng + Advantage+, đã tự loại trừ người MUA HÀNG để khỏi đốt tiền."}
                        {funnel === "middle" && "🔥 Khách ấm: chạy lại người đã xem/thêm giỏ, vẫn loại trừ người đã mua để chốt đơn mới."}
                        {funnel === "bottom" && "💎 Khách nóng: upsell người đã mua sản phẩm khác — KHÔNG loại trừ."}
                      </div>
                    )}
                  </div>
                  {/* Mã SP */}
                  <div>
                    <label style={lbl}>Mã SP (POS)</label>
                    <select value={skuCode} onChange={e => setSkuCode(e.target.value)} style={inp}>
                      <option value="">— Chọn mã SP —</option>
                      {SKU_LIST.map(s => <option key={s.pos} value={toCampCode(s.pos)}>{toCampCode(s.pos)} · {s.name}</option>)}
                    </select>
                  </div>
                  {/* Audience + budget */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <label style={lbl}>Đối tượng (audience)</label>
                      <input value={audience} onChange={e => setAudience(e.target.value)} placeholder="30ALL" style={inp} />
                    </div>
                    <div>
                      <label style={lbl}>Ngân sách/ngày (đ)</label>
                      <input type="number" value={budget} onChange={e => setBudget(Number(e.target.value))} style={inp} />
                    </div>
                  </div>
                  {/* Pixel */}
                  <div>
                    <label style={lbl}>Pixel</label>
                    <select value={pixelId} onChange={e => setPixelId(e.target.value)} style={inp}>
                      <option value="">— Chọn pixel —</option>
                      {meta.pixels.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  {/* URL + CTA */}
                  <div>
                    <label style={lbl}>URL trang đích</label>
                    <input value={ctaUrl} onChange={e => setCtaUrl(e.target.value)} placeholder="https://giadungphanviet.shop/..." style={inp} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <label style={lbl}>Nút CTA</label>
                      <select value={ctaType} onChange={e => setCtaType(e.target.value)} style={inp}>
                        {CTA_OPTS.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={lbl}>Tuổi tối thiểu</label>
                      <input type="number" value={ageMin} onChange={e => setAgeMin(Number(e.target.value))} style={inp} />
                    </div>
                  </div>
                  {/* Loại trừ audiences */}
                  <div>
                    <label style={lbl}>Loại trừ đối tượng ({excluded.size} chọn)</label>
                    <div style={{ maxHeight: 160, overflowY: "auto", border: "1px solid #E5E7EB", borderRadius: 8, background: "#fff" }}>
                      {meta.audiences.length === 0 && <div style={{ padding: 10, fontSize: 12, color: "#9CA3AF" }}>Không có audience</div>}
                      {meta.audiences.map(a => (
                        <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderBottom: "1px solid #F3F4F6", cursor: "pointer", fontSize: 12 }}>
                          <input type="checkbox" checked={excluded.has(a.id)} onChange={() => toggleExcl(a.id)} />
                          <span style={{ flex: 1, color: "#374151" }}>{a.name}</span>
                          <span style={{ fontSize: 10, color: "#9CA3AF" }}>{a.subtype}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: "#6B7280", background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 12px" }}>
                    Campaign + Ad tạo <b>PAUSED</b>. Review trên AdsManager rồi bật.
                  </div>
                </>
              )}

              {/* ── MODE C: Từ Ad ID cũ ── */}
              {mode === "from_ad_id" && (
                <>
                  <div>
                    <label style={lbl}>FB Ad ID nguồn</label>
                    <input value={sourceAdId} onChange={e => setSourceAdId(e.target.value)} placeholder="123456789012345" style={inp} />
                    {loadingAdInfo && <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 4 }}>Đang tải thông tin ad…</div>}
                    {sourceAdInfo && !sourceAdInfo.error && (
                      <div style={{ marginTop: 6, fontSize: 11, background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 6, padding: "6px 10px", lineHeight: 1.6 }}>
                        <b>{sourceAdInfo.ad_name}</b><br />
                        Camp: {sourceAdInfo.campaign?.name}<br />
                        Adset: {sourceAdInfo.adset?.name}
                      </div>
                    )}
                    {sourceAdInfo?.error && <div style={{ fontSize: 11, color: "#DC2626", marginTop: 4 }}>⚠️ {sourceAdInfo.error}</div>}
                  </div>

                  {/* Ad Account */}
                  <div>
                    <label style={lbl}>Tài khoản quảng cáo đích</label>
                    <select value={accId} onChange={e => setAccId(e.target.value)} style={inp}>
                      <option value="">— Chọn ad account —</option>
                      {accounts.map(a => <option key={a.id} value={a.id}>{a.name}{a.account_status !== 1 ? " (tắt)" : ""}</option>)}
                    </select>
                  </div>

                  {accId && !loadingMeta && (
                    <>
                      <div style={{ display: "flex", background: "#F3F4F6", borderRadius: 8, padding: 2, gap: 2 }}>
                        {([["existing_adset", "⭐ Vào adset có sẵn"], ["new_campaign", "Tạo camp mới"]] as const).map(([m, l]) => (
                          <button key={m} onClick={() => setAdIdMode(m)} style={{ flex: 1, background: adIdMode === m ? "#FFFFFF" : "transparent", border: "none", borderRadius: 6, padding: "7px 8px", fontSize: 12, fontWeight: 600, cursor: "pointer", color: adIdMode === m ? "#111827" : "#6B7280", boxShadow: adIdMode === m ? "0 1px 3px rgba(0,0,0,0.1)" : "none" }}>{l}</button>
                        ))}
                      </div>

                      {adIdMode === "existing_adset" && (
                        <>
                          <div>
                            <label style={lbl}>Campaign</label>
                            <select value={campId} onChange={e => { setCampId(e.target.value); setAdsetId("") }} style={inp}>
                              <option value="">— Chọn campaign —</option>
                              {meta.campaigns.map(c => <option key={c.id} value={c.id}>[{c.status === "ACTIVE" ? "▶" : "⏸"}] {c.name}</option>)}
                            </select>
                          </div>
                          {campId && (
                            <div>
                              <label style={lbl}>Ad Set</label>
                              <select value={adsetId} onChange={e => setAdsetId(e.target.value)} style={inp}>
                                <option value="">— Chọn ad set —</option>
                                {(meta.campaigns.find(c => c.id === campId)?.adsets || []).map(a => <option key={a.id} value={a.id}>[{a.status === "ACTIVE" ? "▶" : "⏸"}] {a.name}</option>)}
                              </select>
                            </div>
                          )}
                        </>
                      )}

                      {adIdMode === "new_campaign" && (
                        <>
                          <div>
                            <label style={lbl}>Tên Campaign (tùy chỉnh)</label>
                            <input placeholder={`${sourceAdInfo?.campaign?.name || "PHVVN"} - clone`} style={inp} id="cAdIdName" />
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                            <div><label style={lbl}>Ngân sách/ngày (đ)</label><input type="number" value={budget} onChange={e => setBudget(Number(e.target.value))} style={inp} /></div>
                            <div><label style={lbl}>Tuổi tối thiểu</label><input type="number" value={ageMin} onChange={e => setAgeMin(Number(e.target.value))} style={inp} /></div>
                          </div>
                          <div>
                            <label style={lbl}>Pixel</label>
                            <select value={pixelId} onChange={e => setPixelId(e.target.value)} style={inp}>
                              <option value="">— Chọn pixel —</option>
                              {meta.pixels.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                          </div>
                          {meta.audiences.length > 0 && (
                            <div>
                              <label style={lbl}>Loại trừ đối tượng ({excluded.size} chọn)</label>
                              <div style={{ maxHeight: 120, overflowY: "auto", border: "1px solid #E5E7EB", borderRadius: 8, background: "#fff" }}>
                                {meta.audiences.map(a => (
                                  <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", borderBottom: "1px solid #F3F4F6", cursor: "pointer", fontSize: 12 }}>
                                    <input type="checkbox" checked={excluded.has(a.id)} onChange={() => toggleExcl(a.id)} />
                                    <span style={{ flex: 1 }}>{a.name}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </>
                  )}
                  <div style={{ fontSize: 12, color: "#6B7280", background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 12px" }}>
                    Creative được clone từ ad nguồn. Ad mới tạo <b>PAUSED</b>.
                  </div>
                </>
              )}

              {/* ── MODE D: Dark post (video/ảnh chưa đăng) ── */}
              {mode === "unpublished_post" && (
                <>
                  <div>
                    <label style={lbl}>Facebook Page</label>
                    <select value={darkPageId} onChange={e => setDarkPageId(e.target.value)} style={inp}>
                      <option value="">— Chọn page —</option>
                      {pages.map((p: any) => <option key={p.page_id} value={p.page_id}>{p.page_name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>Nội dung bài (caption)</label>
                    <textarea value={darkMessage} onChange={e => setDarkMessage(e.target.value)} rows={3} placeholder="Nội dung quảng cáo…" style={{ ...inp, resize: "vertical" }} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <label style={lbl}>Video ID (nếu dùng video)</label>
                      <input value={darkVideoId} onChange={e => setDarkVideoId(e.target.value)} placeholder="FB Video ID" style={inp} />
                    </div>
                    <div>
                      <label style={lbl}>VD Code</label>
                      <input value={darkVdCode} onChange={e => setDarkVdCode(e.target.value)} placeholder="VD1001" style={inp} />
                    </div>
                  </div>
                  <div>
                    <label style={lbl}>URL ảnh (nếu dùng ảnh, không dùng video)</label>
                    <input value={darkImageUrl} onChange={e => setDarkImageUrl(e.target.value)} placeholder="https://..." style={inp} />
                  </div>
                  <div>
                    <label style={lbl}>Link trang đích (tùy chọn)</label>
                    <input value={darkLink} onChange={e => setDarkLink(e.target.value)} placeholder="https://giadungphanviet.shop/..." style={inp} />
                  </div>

                  {/* Ad Account */}
                  <div>
                    <label style={lbl}>Tài khoản quảng cáo</label>
                    <select value={accId} onChange={e => setAccId(e.target.value)} style={inp}>
                      <option value="">— Chọn ad account —</option>
                      {accounts.map(a => <option key={a.id} value={a.id}>{a.name}{a.account_status !== 1 ? " (tắt)" : ""}</option>)}
                    </select>
                  </div>

                  {accId && !loadingMeta && (
                    <>
                      <div style={{ display: "flex", background: "#F3F4F6", borderRadius: 8, padding: 2, gap: 2 }}>
                        {([["existing_adset", "⭐ Vào adset có sẵn"], ["new_campaign", "Tạo camp mới"]] as const).map(([m, l]) => (
                          <button key={m} onClick={() => setDarkAdsetMode(m)} style={{ flex: 1, background: darkAdsetMode === m ? "#FFFFFF" : "transparent", border: "none", borderRadius: 6, padding: "7px 8px", fontSize: 12, fontWeight: 600, cursor: "pointer", color: darkAdsetMode === m ? "#111827" : "#6B7280", boxShadow: darkAdsetMode === m ? "0 1px 3px rgba(0,0,0,0.1)" : "none" }}>{l}</button>
                        ))}
                      </div>

                      {darkAdsetMode === "existing_adset" && (
                        <>
                          <div>
                            <label style={lbl}>Campaign</label>
                            <select value={campId} onChange={e => { setCampId(e.target.value); setAdsetId("") }} style={inp}>
                              <option value="">— Chọn campaign —</option>
                              {meta.campaigns.map(c => <option key={c.id} value={c.id}>[{c.status === "ACTIVE" ? "▶" : "⏸"}] {c.name}</option>)}
                            </select>
                          </div>
                          {campId && (
                            <div>
                              <label style={lbl}>Ad Set</label>
                              <select value={adsetId} onChange={e => setAdsetId(e.target.value)} style={inp}>
                                <option value="">— Chọn ad set —</option>
                                {(meta.campaigns.find(c => c.id === campId)?.adsets || []).map(a => <option key={a.id} value={a.id}>[{a.status === "ACTIVE" ? "▶" : "⏸"}] {a.name}</option>)}
                              </select>
                            </div>
                          )}
                        </>
                      )}

                      {darkAdsetMode === "new_campaign" && (
                        <>
                          <div>
                            <label style={lbl}>Tầng phễu</label>
                            <div style={{ display: "flex", gap: 6 }}>
                              {([["top","❄️ Lạnh"],["middle","🔥 Ấm"],["bottom","💎 Nóng"]] as const).map(([f,label]) => (
                                <button key={f} type="button" onClick={() => applyFunnel(f)} style={{ flex: 1, background: funnel === f ? "#1877F2" : "#F3F4F6", color: funnel === f ? "#fff" : "#4B5563", border: "none", borderRadius: 8, padding: "7px 6px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{label}</button>
                              ))}
                            </div>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                            <div><label style={lbl}>Mã SP</label>
                              <select value={skuCode} onChange={e => setSkuCode(e.target.value)} style={inp}>
                                <option value="">— Chọn —</option>
                                {SKU_LIST.map(s => <option key={s.pos} value={toCampCode(s.pos)}>{toCampCode(s.pos)} · {s.name}</option>)}
                              </select>
                            </div>
                            <div><label style={lbl}>Ngân sách/ngày (đ)</label><input type="number" value={budget} onChange={e => setBudget(Number(e.target.value))} style={inp} /></div>
                          </div>
                          <div>
                            <label style={lbl}>Pixel</label>
                            <select value={pixelId} onChange={e => setPixelId(e.target.value)} style={inp}>
                              <option value="">— Chọn pixel —</option>
                              {meta.pixels.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                          </div>
                        </>
                      )}
                    </>
                  )}
                  <div style={{ fontSize: 12, color: "#6B7280", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, padding: "8px 12px" }}>
                    🌑 Dark post: bài đăng ẩn (không hiện trên trang), chỉ dùng cho quảng cáo. Ad tạo <b>PAUSED</b>.
                  </div>
                </>
              )}

              {error &&<div style={{ fontSize: 12, color: "#DC2626", background: "#FEE2E2", border: "1px solid #FECACA", borderRadius: 8, padding: "8px 12px" }}>⚠️ {error}</div>}

              {progress.length > 0 && (
                <div style={{ fontSize: 12, color: "#1877F2", background: "#EFF6FF", borderRadius: 8, padding: "8px 12px" }}>
                  {progress.map((p, i) => <div key={i}>{p}</div>)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {!result && (
          <div style={{ padding: "14px 20px", borderTop: "1px solid #E5E7EB", background: "#FFFFFF", display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={onClose} style={{ background: "#F3F4F6", color: "#4B5563", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, cursor: "pointer" }}>Hủy</button>
            <button onClick={submit} disabled={!canSubmit || submitting} style={{ background: (!canSubmit || submitting) ? "#93C5FD" : "#1877F2", color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 700, cursor: (!canSubmit || submitting) ? "not-allowed" : "pointer" }}>
              {submitting ? "Đang tạo…" : "🚀 Tạo Ad"}
            </button>
          </div>
        )}
      </div>
    </>
  )
}
