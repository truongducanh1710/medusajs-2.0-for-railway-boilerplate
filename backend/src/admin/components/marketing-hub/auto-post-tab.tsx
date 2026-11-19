import { useEffect, useMemo, useState } from "react"
import { apiJson } from "../../lib/api-client"
import { useCurrentPermissions } from "../../lib/use-permissions"

type Rule = {
  page_id: string; page_name: string; product_codes: string[]; post_time: string
  enabled: boolean; rot_idx: number; updated_by: string | null; updated_at: string
}
type LogRow = {
  id: string; page_id: string; page_name: string; day: string; product_code: string | null
  vd_code: string | null; post_id: string | null; status: string; attempts: number; error: string | null; updated_at: string
}
type Stock = { product_code: string; videos: number; fresh: number; captions: number }
type Preview = {
  page_id: string; product_code: string | null; caption: string | null; reason?: string
  video: { vd_code: string } | null; stock?: Stock[]
}
type Product = { code: string; name: string; active: boolean }
type FbPage = { page_id: string; page_name: string }

const card: React.CSSProperties = { background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 16 }
const th: React.CSSProperties = { padding: "8px 10px", textAlign: "left", fontSize: 12, color: "#6B7280", fontWeight: 600, borderBottom: "1px solid #E5E7EB", whiteSpace: "nowrap" }
const td: React.CSSProperties = { padding: "8px 10px", fontSize: 13, borderBottom: "1px solid #F3F4F6", verticalAlign: "top" }
const btn = (bg: string, fg = "#fff"): React.CSSProperties => ({ background: bg, color: fg, border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" })
const chip: React.CSSProperties = { background: "#EEF2FF", color: "#4338CA", borderRadius: 10, padding: "1px 8px", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }

/** VN date "YYYY-MM-DD" for today. */
const vnToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
/** Log `day` comes back as a UTC-midnight timestamp of the VN date → take the date part as-is. */
const dayOf = (d: string) => String(d).slice(0, 10)
const fmtDay = (d: string) => { const [y, m, dd] = dayOf(d).split("-"); return `${dd}/${m}` }
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" })

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  published: { label: "Đã đăng", bg: "#D1FAE5", fg: "#059669" },
  running:   { label: "Đang đăng", bg: "#DBEAFE", fg: "#1D4ED8" },
  failed:    { label: "Lỗi", bg: "#FEE2E2", fg: "#DC2626" },
}

function ProductPicker({ products, value, onChange }: { products: Product[]; value: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState("")
  const list = products.filter(p => p.active && (!q || `${p.code} ${p.name}`.toLowerCase().includes(q.toLowerCase())))
  const toggle = (c: string) => onChange(value.includes(c) ? value.filter(x => x !== c) : [...value, c])
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
        {value.length === 0 && <span style={{ color: "#9CA3AF", fontSize: 12 }}>Chưa chọn sản phẩm</span>}
        {value.map((c, i) => (
          <span key={c} style={{ ...chip, cursor: "pointer" }} onClick={() => toggle(c)} title="Bấm để bỏ">
            {value.length > 1 ? `${i + 1}. ` : ""}{products.find(p => p.code === c)?.name || c} ✕
          </span>
        ))}
      </div>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm sản phẩm..." style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "5px 8px", fontSize: 12, boxSizing: "border-box" }} />
      <div style={{ maxHeight: 160, overflowY: "auto", border: "1px solid #F3F4F6", borderRadius: 6, marginTop: 4 }}>
        {list.map(p => (
          <label key={p.code} style={{ display: "flex", gap: 6, alignItems: "center", padding: "4px 8px", fontSize: 12, cursor: "pointer" }}>
            <input type="checkbox" checked={value.includes(p.code)} onChange={() => toggle(p.code)} />
            {p.name} <span style={{ color: "#9CA3AF" }}>{p.code}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

type Draft = { page_id: string; product_codes: string[]; post_time: string; enabled: boolean }

function RuleEditor({ draft, pages, products, isNew, onCancel, onSave }: {
  draft: Draft; pages: FbPage[]; products: Product[]; isNew: boolean
  onCancel: () => void; onSave: (d: Draft) => Promise<void>
}) {
  const [d, setD] = useState<Draft>(draft)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState("")
  const save = async () => {
    if (!d.page_id) return setErr("Chọn page")
    if (!d.product_codes.length) return setErr("Chọn ít nhất 1 sản phẩm")
    setSaving(true); setErr("")
    try { await onSave(d) } catch (e: any) { setErr(e.message) } finally { setSaving(false) }
  }
  return (
    <div style={{ ...card, borderColor: "#93C5FD", background: "#F8FBFF", display: "grid", gridTemplateColumns: "minmax(200px,1fr) minmax(260px,2fr) 140px", gap: 16 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Page</div>
        {isNew ? (
          <select value={d.page_id} onChange={e => setD({ ...d, page_id: e.target.value })} style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #E5E7EB", fontSize: 13 }}>
            <option value="">— chọn page —</option>
            {pages.map(p => <option key={p.page_id} value={p.page_id}>{p.page_name}</option>)}
          </select>
        ) : <div style={{ fontSize: 13 }}>{pages.find(p => p.page_id === d.page_id)?.page_name || d.page_id}</div>}
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
          Sản phẩm <span style={{ color: "#6B7280", fontWeight: 400 }}>(1 SP = đăng mãi SP đó; nhiều SP = mỗi ngày 1 SP, xoay theo thứ tự)</span>
        </div>
        <ProductPicker products={products} value={d.product_codes} onChange={v => setD({ ...d, product_codes: v })} />
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Giờ đăng (VN)</div>
        <input type="time" value={d.post_time} onChange={e => setD({ ...d, post_time: e.target.value })} style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #E5E7EB", fontSize: 13 }} />
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, marginTop: 10 }}>
          <input type="checkbox" checked={d.enabled} onChange={e => setD({ ...d, enabled: e.target.checked })} /> Đang bật
        </label>
        <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
          <button onClick={save} disabled={saving} style={btn("#1877F2")}>{saving ? "Đang lưu..." : "Lưu"}</button>
          <button onClick={onCancel} style={btn("#F3F4F6", "#374151")}>Huỷ</button>
        </div>
        {err && <div style={{ color: "#DC2626", fontSize: 12, marginTop: 6 }}>{err}</div>}
      </div>
    </div>
  )
}

export function AutoPostTab() {
  const { isSuper, has } = useCurrentPermissions()
  const canEdit = isSuper || has("page.fb-content.post")
  const [rules, setRules] = useState<Rule[]>([])
  const [log, setLog] = useState<LogRow[]>([])
  const [preview, setPreview] = useState<Preview[]>([])
  const [pages, setPages] = useState<FbPage[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [editing, setEditing] = useState<string | null>(null) // page_id or "new"

  const load = async () => {
    setLoading(true); setError("")
    try {
      const d = await apiJson("/admin/fb-content/auto-post?preview=1")
      setRules(d?.rules || []); setLog(d?.log || []); setPreview(d?.preview || [])
    } catch (e: any) { setError(e.message) } finally { setLoading(false) }
  }
  useEffect(() => {
    load()
    apiJson("/admin/fb-content").then(d => setPages(d?.pages || [])).catch(() => {})
    apiJson("/admin/marketing-video/products").then(d => setProducts(d?.products || [])).catch(() => {})
  }, [])

  const productName = (c: string | null) => (c && products.find(p => p.code === c)?.name) || c || "—"
  const today = vnToday()
  const todayLog = useMemo(() => new Map(log.filter(l => dayOf(l.day) === today).map(l => [l.page_id, l])), [log, today])
  const previewOf = (pid: string) => preview.find(p => p.page_id === pid)

  const save = async (d: Draft) => {
    await apiJson("/admin/fb-content/auto-post", "POST", d)
    setEditing(null); await load()
  }
  const toggle = async (r: Rule) => {
    await apiJson("/admin/fb-content/auto-post", "POST", { page_id: r.page_id, product_codes: r.product_codes, post_time: r.post_time, enabled: !r.enabled })
    await load()
  }
  const remove = async (r: Rule) => {
    if (!confirm(`Xoá cấu hình tự đăng của page "${r.page_name}"?`)) return
    await apiJson(`/admin/fb-content/auto-post?page_id=${encodeURIComponent(r.page_id)}`, "DELETE")
    await load()
  }

  const usedPageIds = new Set(rules.map(r => r.page_id))
  const freePages = pages.filter(p => !usedPageIds.has(p.page_id))

  // Log grouped by day (newest first)
  const days = useMemo(() => {
    const m = new Map<string, LogRow[]>()
    for (const l of log) { const k = dayOf(l.day); if (!m.has(k)) m.set(k, []); m.get(k)!.push(l) }
    return [...m.entries()]
  }, [log])

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ ...card, background: "#F9FAFB", fontSize: 13, color: "#374151", lineHeight: 1.6 }}>
        Mỗi page bật ở đây được <b>tự đăng 1 video/ngày</b> vào giờ đã đặt. Hệ thống lấy video đã làm xong của sản phẩm, ưu tiên video page <b>chưa đăng lần nào</b>,
        và dùng lại caption đã từng đăng cho sản phẩm đó (ưu tiên caption page chưa dùng). Đăng lỗi sẽ tự thử lại tối đa 3 lần và báo trong chuông thông báo.
      </div>

      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Cấu hình theo page</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={load} style={btn("#F3F4F6", "#374151")}>↻ Tải lại</button>
            {canEdit && editing !== "new" && <button onClick={() => setEditing("new")} style={btn("#1877F2")}>+ Thêm page</button>}
          </div>
        </div>

        {editing === "new" && (
          <div style={{ marginBottom: 12 }}>
            <RuleEditor isNew pages={freePages} products={products}
              draft={{ page_id: "", product_codes: [], post_time: "11:00", enabled: true }}
              onCancel={() => setEditing(null)} onSave={save} />
          </div>
        )}

        {error && <div style={{ color: "#DC2626", fontSize: 13, marginBottom: 8 }}>{error}</div>}
        {loading && rules.length === 0 ? <div style={{ color: "#6B7280", fontSize: 13 }}>Đang tải...</div> : rules.length === 0 ? (
          <div style={{ color: "#6B7280", fontSize: 13 }}>Chưa có page nào tự đăng.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={th}>Giờ</th><th style={th}>Page</th><th style={th}>Sản phẩm</th>
                <th style={th}>Hôm nay</th><th style={th}>Bài tiếp theo</th><th style={th}>Kho</th><th style={th}></th>
              </tr></thead>
              <tbody>
                {rules.map(r => {
                  if (editing === r.page_id) return (
                    <tr key={r.page_id}><td colSpan={7} style={{ padding: 8 }}>
                      <RuleEditor isNew={false} pages={pages.length ? pages : [{ page_id: r.page_id, page_name: r.page_name }]} products={products}
                        draft={{ page_id: r.page_id, product_codes: r.product_codes, post_time: r.post_time, enabled: r.enabled }}
                        onCancel={() => setEditing(null)} onSave={save} />
                    </td></tr>
                  )
                  const tl = todayLog.get(r.page_id)
                  const pv = previewOf(r.page_id)
                  const st = tl ? STATUS[tl.status] || { label: tl.status, bg: "#F3F4F6", fg: "#374151" } : null
                  const rotating = r.product_codes.length > 1
                  return (
                    <tr key={r.page_id} style={{ opacity: r.enabled ? 1 : 0.55 }}>
                      <td style={{ ...td, fontWeight: 700 }}>{r.post_time}</td>
                      <td style={{ ...td, maxWidth: 220 }}>{r.page_name}{!r.enabled && <div style={{ fontSize: 11, color: "#9CA3AF" }}>Đang tắt</div>}</td>
                      <td style={td}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 3, maxWidth: 280 }}>
                          {r.product_codes.map((c, i) => (
                            <span key={c} style={{ ...chip, ...(rotating && i === r.rot_idx % r.product_codes.length ? { background: "#4338CA", color: "#fff" } : {}) }}>
                              {productName(c)}
                            </span>
                          ))}
                        </div>
                        {rotating && <div style={{ fontSize: 11, color: "#6B7280", marginTop: 3 }}>Xoay vòng · ô đậm = lượt kế tiếp</div>}
                      </td>
                      <td style={td}>
                        {st ? (
                          <div>
                            <span style={{ background: st.bg, color: st.fg, borderRadius: 20, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>{st.label}</span>
                            <div style={{ fontSize: 11, color: "#6B7280", marginTop: 3 }}>
                              {tl!.vd_code} · {fmtTime(tl!.updated_at)}
                              {tl!.post_id && <> · <a href={`https://www.facebook.com/${tl!.post_id}`} target="_blank" rel="noreferrer">xem</a></>}
                            </div>
                            {tl!.error && <div style={{ fontSize: 11, color: "#DC2626", maxWidth: 200 }}>{tl!.error}</div>}
                          </div>
                        ) : <span style={{ fontSize: 12, color: "#9CA3AF" }}>{r.enabled ? `Chờ ${r.post_time}` : "—"}</span>}
                      </td>
                      <td style={{ ...td, maxWidth: 280 }}>
                        {pv?.video ? (
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600 }}>{pv.video.vd_code} · {productName(pv.product_code)}</div>
                            <div style={{ fontSize: 11, color: "#6B7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={pv.caption || ""}>{pv.caption}</div>
                          </div>
                        ) : <span style={{ fontSize: 12, color: "#DC2626" }}>{pv?.reason || "—"}</span>}
                      </td>
                      <td style={td}>
                        {(pv?.stock || []).map(s => (
                          <div key={s.product_code} style={{ fontSize: 11, whiteSpace: "nowrap", color: s.fresh <= 3 || s.captions <= 3 ? "#B45309" : "#374151" }}
                            title={`${s.videos} video dùng được, ${s.fresh} video page chưa đăng, ${s.captions} caption`}>
                            {rotating && <b>{productName(s.product_code).split(" ").slice(0, 2).join(" ")}: </b>}
                            {s.fresh} video mới · {s.captions} caption{s.fresh <= 3 || s.captions <= 3 ? " ⚠" : ""}
                          </div>
                        ))}
                      </td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>
                        {canEdit && <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => toggle(r)} style={btn(r.enabled ? "#FEF3C7" : "#D1FAE5", r.enabled ? "#92400E" : "#065F46")}>{r.enabled ? "Tắt" : "Bật"}</button>
                          <button onClick={() => setEditing(r.page_id)} style={btn("#F3F4F6", "#374151")}>Sửa</button>
                          <button onClick={() => remove(r)} style={btn("#FEE2E2", "#B91C1C")}>Xoá</button>
                        </div>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div style={{ fontSize: 11, color: "#6B7280", marginTop: 8 }}>
              Kho: "video mới" = video page chưa đăng lần nào; hết thì hệ thống đăng lại video cũ nhất. ⚠ = sắp hết, nên bổ sung video/caption.
            </div>
          </div>
        )}
      </div>

      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Nhật ký 14 ngày</div>
        {days.length === 0 ? <div style={{ color: "#6B7280", fontSize: 13 }}>Chưa có bài tự đăng.</div> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={th}>Ngày</th><th style={th}>Page</th><th style={th}>Sản phẩm</th><th style={th}>Video</th><th style={th}>Kết quả</th><th style={th}>Giờ</th></tr></thead>
              <tbody>
                {days.flatMap(([day, rows]) => rows.map((l, i) => {
                  const st = STATUS[l.status] || { label: l.status, bg: "#F3F4F6", fg: "#374151" }
                  return (
                    <tr key={l.id}>
                      <td style={{ ...td, fontWeight: 600 }}>{i === 0 ? fmtDay(day) : ""}</td>
                      <td style={td}>{l.page_name}</td>
                      <td style={td}>{productName(l.product_code)}</td>
                      <td style={td}>{l.post_id ? <a href={`https://www.facebook.com/${l.post_id}`} target="_blank" rel="noreferrer">{l.vd_code}</a> : l.vd_code || "—"}</td>
                      <td style={td}>
                        <span style={{ background: st.bg, color: st.fg, borderRadius: 20, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>{st.label}</span>
                        {l.attempts > 1 && <span style={{ fontSize: 11, color: "#6B7280" }}> · lần {l.attempts}</span>}
                        {l.error && <div style={{ fontSize: 11, color: "#DC2626" }}>{l.error}</div>}
                      </td>
                      <td style={td}>{fmtTime(l.updated_at)}</td>
                    </tr>
                  )
                }))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
