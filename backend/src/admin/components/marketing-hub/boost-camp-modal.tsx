import { useEffect, useState } from "react"
import { apiJson } from "../../lib/api-client"
import { SKU_LIST, toCampCode, matchSkuByName, parseAdsCode, buildCampaignName } from "../../lib/camp-naming"

export type BoostTarget = {
  postId: string          // fb_scheduled_post.id (UUID DB)
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

const CTA_OPTS = [
  { v: "SHOP_NOW", l: "Mua ngay" },
  { v: "GET_OFFER", l: "Nhận ưu đãi" },
  { v: "LEARN_MORE", l: "Tìm hiểu thêm" },
  { v: "ORDER_NOW", l: "Đặt hàng ngay" },
]

export function BoostCampModal({ target, onClose, onDone }: { target: BoostTarget; onClose: () => void; onDone?: () => void }) {
  const [mode, setMode] = useState<"existing_adset" | "new_campaign">("existing_adset")
  const [accounts, setAccounts] = useState<Account[]>([])
  const [accId, setAccId] = useState("")
  const [meta, setMeta] = useState<{ audiences: Audience[]; pixels: Pixel[]; campaigns: Campaign[] }>({ audiences: [], pixels: [], campaigns: [] })
  const [loadingMeta, setLoadingMeta] = useState(false)

  // Mode A
  const [campId, setCampId] = useState("")
  const [adsetId, setAdsetId] = useState("")

  // Mode B
  const [skuCode, setSkuCode] = useState(matchSkuByName(target.productName || ""))
  const [audience, setAudience] = useState("30ALL")
  const [budget, setBudget] = useState(500000)
  const [pixelId, setPixelId] = useState("")
  const [ctaUrl, setCtaUrl] = useState("")
  const [ctaType, setCtaType] = useState("GET_OFFER")
  const [ageMin, setAgeMin] = useState(25)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [funnel, setFunnel] = useState<"" | "top" | "middle" | "bottom">("")

  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState<string[]>([])
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  // Load accounts
  useEffect(() => {
    apiJson("/admin/fb-content/boost/meta")
      .then(d => {
        setAccounts(d.accounts || [])
        if ((d.accounts || []).length === 1) setAccId(d.accounts[0].id)
      })
      .catch(e => setError("Lỗi tải ad accounts: " + e.message))
  }, [])

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

  const canSubmit = accId && (
    mode === "existing_adset" ? adsetId : (budget >= 50000)
  )

  const submit = async () => {
    if (!canSubmit || submitting) return
    setSubmitting(true); setError(null); setProgress([]); setResult(null)
    try {
      const body: any = { mode, post_id: target.postId, ad_account_id: accId }
      if (mode === "existing_adset") {
        body.adset_id = adsetId
        setProgress(["Tạo Creative…"])
      } else {
        Object.assign(body, {
          campaign_name: campNamePreview,
          sku_code: skuCode, ads_code: adsCode, audience,
          daily_budget: budget, pixel_id: pixelId,
          excluded_audience_ids: [...excluded],
          cta_url: ctaUrl, cta_type: ctaType, age_min: ageMin,
        })
        setProgress(["Tạo Campaign…"])
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
              <div style={{ display: "flex", background: "#F3F4F6", borderRadius: 8, padding: 2, gap: 2 }}>
                {([["existing_adset", "⭐ Vào Camp có sẵn"], ["new_campaign", "Tạo Camp mới"]] as const).map(([m, l]) => (
                  <button key={m} onClick={() => setMode(m)} style={{ flex: 1, background: mode === m ? "#FFFFFF" : "transparent", border: "none", borderRadius: 6, padding: "7px 8px", fontSize: 12, fontWeight: 600, cursor: "pointer", color: mode === m ? "#111827" : "#6B7280", boxShadow: mode === m ? "0 1px 3px rgba(0,0,0,0.1)" : "none" }}>{l}</button>
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

              {error && <div style={{ fontSize: 12, color: "#DC2626", background: "#FEE2E2", border: "1px solid #FECACA", borderRadius: 8, padding: "8px 12px" }}>⚠️ {error}</div>}

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
