import { useEffect, useRef, useState } from "react"
import { apiJson } from "../../lib/api-client"
import { useCurrentPermissions } from "../../lib/use-permissions"
import { PageStatsTab } from "./page-stats-tab"

type MktPage = {
  id: string; mkt_code: string; page_name: string; page_link: string
  sp_chay: string; pancake: string; hoat_dong: string
  share_anhtd: string; pos: string; bm: string; share_hoan: string; ghi_chu: string
}

type MktProduct = { id: number; name: string; code: string; active: boolean }

const STATUS_OPTS = ["ĐÃ THÊM", "CHƯA", "CẦN THÊM", "N/A"]
const HOAT_DONG_OPTS = ["ĐANG CHẠY", "TẠM DỪNG", "ĐÃ DỪNG"]

function SpChayMultiSelect({ value, products, onSave, canEdit }: {
  value: string; products: MktProduct[]; onSave: (v: string) => void; canEdit: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [search, setSearch] = useState("")

  // Parse comma-separated string → array of names (trimmed, non-empty)
  const selected = value ? value.split(",").map(s => s.trim()).filter(Boolean) : []

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setSearch("") } }
    document.addEventListener("mousedown", fn)
    return () => document.removeEventListener("mousedown", fn)
  }, [])

  const toggle = (name: string) => {
    const next = selected.includes(name) ? selected.filter(s => s !== name) : [...selected, name]
    onSave(next.join(", "))
  }

  const filtered = products.filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.code || "").toLowerCase().includes(search.toLowerCase())
  )

  if (!canEdit) {
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
        {selected.length === 0
          ? <span style={{ color: "#9CA3AF", fontSize: 11 }}>—</span>
          : selected.map(s => (
            <span key={s} style={{ background: "#EEF2FF", color: "#4338CA", borderRadius: 10, padding: "1px 7px", fontSize: 11, fontWeight: 600 }}>{s}</span>
          ))}
      </div>
    )
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div
        onClick={() => { setOpen(o => !o); setSearch("") }}
        style={{ cursor: "pointer", minHeight: 24, display: "flex", flexWrap: "wrap", gap: 3, alignItems: "center", border: open ? "1px solid #93C5FD" : "1px solid transparent", borderRadius: 6, padding: "2px 4px", background: open ? "#F0F6FF" : "transparent" }}
      >
        {selected.length === 0
          ? <span style={{ color: "#9CA3AF", fontSize: 11 }}>— chọn SP</span>
          : selected.map(s => (
            <span key={s} style={{ background: "#EEF2FF", color: "#4338CA", borderRadius: 10, padding: "1px 7px", fontSize: 11, fontWeight: 600 }}>{s}</span>
          ))}
        <span style={{ color: "#9CA3AF", fontSize: 9, marginLeft: "auto" }}>▾</span>
      </div>

      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 700, background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, boxShadow: "0 6px 24px rgba(0,0,0,0.12)", padding: "6px 0", minWidth: 220, maxHeight: 280, display: "flex", flexDirection: "column" }}>
          {/* Search */}
          <div style={{ padding: "4px 8px 6px" }}>
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Tìm SP..."
              style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "4px 8px", fontSize: 12, outline: "none", boxSizing: "border-box" }}
            />
          </div>
          {/* Selected summary */}
          {selected.length > 0 && (
            <div style={{ padding: "2px 10px 6px", borderBottom: "1px solid #F3F4F6", display: "flex", gap: 4, flexWrap: "wrap" }}>
              {selected.map(s => (
                <span key={s} onClick={() => toggle(s)} style={{ background: "#4338CA", color: "#fff", borderRadius: 10, padding: "1px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                  {s} ✕
                </span>
              ))}
            </div>
          )}
          {/* List */}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {filtered.length === 0 && <div style={{ padding: "8px 12px", color: "#9CA3AF", fontSize: 12 }}>Không tìm thấy</div>}
            {filtered.map(p => {
              const checked = selected.includes(p.name)
              return (
                <button key={p.id} onClick={() => toggle(p.name)}
                  style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 12px", background: checked ? "#EEF2FF" : "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                  <span style={{ width: 14, height: 14, border: `2px solid ${checked ? "#4338CA" : "#D1D5DB"}`, borderRadius: 3, background: checked ? "#4338CA" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {checked && <span style={{ color: "#fff", fontSize: 9, lineHeight: 1 }}>✓</span>}
                  </span>
                  <span style={{ fontSize: 12, color: "#111827" }}>{p.name}</span>
                  {p.code && <span style={{ fontSize: 10, color: "#9CA3AF", marginLeft: "auto" }}>{p.code}</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ val }: { val: string }) {
  const map: Record<string, { c: string; bg: string }> = {
    "ĐÃ THÊM":   { c: "#059669", bg: "#DCFCE7" },
    "CHƯA":      { c: "#D97706", bg: "#FEF3C7" },
    "CẦN THÊM":  { c: "#2563EB", bg: "#DBEAFE" },
    "N/A":       { c: "#9CA3AF", bg: "#F3F4F6" },
    "ĐANG CHẠY": { c: "#059669", bg: "#DCFCE7" },
    "TẠM DỪNG":  { c: "#D97706", bg: "#FEF3C7" },
    "ĐÃ DỪNG":   { c: "#DC2626", bg: "#FEE2E2" },
  }
  const s = map[val] || { c: "#6B7280", bg: "#F3F4F6" }
  return (
    <span style={{ background: s.bg, color: s.c, borderRadius: 20, padding: "2px 8px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
      {val || "—"}
    </span>
  )
}

function InlineSelect({ value, opts, onSave }: { value: string; opts: string[]; onSave: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", fn)
    return () => document.removeEventListener("mousedown", fn)
  }, [])
  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <div onClick={() => setOpen(o => !o)} style={{ cursor: "pointer" }}>
        <StatusBadge val={value} />
      </div>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 600, background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, boxShadow: "0 4px 16px rgba(0,0,0,0.10)", padding: "4px 0", minWidth: 130 }}>
          {opts.map(o => (
            <button key={o} onClick={() => { onSave(o); setOpen(false) }}
              style={{ display: "block", width: "100%", padding: "6px 12px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
              <StatusBadge val={o} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function LinkCell({ value, onSave, canEdit }: { value: string; onSave: (v: string) => void; canEdit: boolean }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value || "")
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (editing) ref.current?.focus() }, [editing])
  if (editing) return (
    <input ref={ref} value={val}
      onChange={e => setVal(e.target.value)}
      onBlur={() => { onSave(val); setEditing(false) }}
      onKeyDown={e => { if (e.key === "Enter") { onSave(val); setEditing(false) } if (e.key === "Escape") setEditing(false) }}
      placeholder="https://fb.com/…"
      style={{ background: "#F0F6FF", color: "#111827", border: "1px solid #93C5FD", borderRadius: 6, padding: "3px 7px", fontSize: 11, outline: "none", width: 130 }} />
  )
  if (value) return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <a href={value} target="_blank" rel="noopener noreferrer" style={{ color: "#1877F2", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>↗ FB</a>
      {canEdit && <span onClick={() => setEditing(true)} style={{ color: "#9CA3AF", fontSize: 10, cursor: "pointer" }}>✎</span>}
    </div>
  )
  return canEdit
    ? <span onClick={() => setEditing(true)} style={{ color: "#9CA3AF", fontSize: 11, cursor: "pointer", borderBottom: "1px dashed #D1D5DB" }}>+ Link</span>
    : <span style={{ color: "#9CA3AF" }}>—</span>
}

export function QuanLyPageTab() {
  const { isSuper, has } = useCurrentPermissions()
  const canEdit = isSuper || has("page.marketing-video.edit")

  const [innerTab, setInnerTab] = useState<"danh-sach" | "thong-ke">("danh-sach")
  const [pages, setPages] = useState<MktPage[]>([])
  const [products, setProducts] = useState<MktProduct[]>([])
  const [fbPageNames, setFbPageNames] = useState<Set<string>>(new Set())
  const [mktCodes, setMktCodes] = useState<string[]>([])
  const [filterMkt, setFilterMkt] = useState("all")
  const [filterHoatDong, setFilterHoatDong] = useState("all")
  const [q, setQ] = useState("")
  const [toast, setToast] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ mkt_code: "", page_name: "", page_link: "", sp_chay: "", pancake: "CHƯA", hoat_dong: "ĐANG CHẠY", share_anhtd: "CHƯA", pos: "CHƯA", bm: "CHƯA", share_hoan: "CHƯA", ghi_chu: "" })
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const load = () => apiJson("/admin/mkt-pages").then(d => setPages(d.pages || [])).catch(() => {})
  useEffect(() => {
    load()
    apiJson("/admin/marketing-video/products").then(d => setProducts(d.products || [])).catch(() => {})
    apiJson("/admin/fb-content?all=true").then(d => {
      const names = new Set<string>((d.pages || []).map((p: any) => p.page_name?.toLowerCase().trim()))
      setFbPageNames(names)
    }).catch(() => {})
    apiJson("/admin/permissions/mkt-users").then(d => setMktCodes((d.users || []).map((u: any) => u.mkt_code).filter(Boolean))).catch(() => {})
  }, [])

  const patch = async (id: string, field: string, val: string) => {
    await apiJson(`/admin/mkt-pages/${id}`, "PATCH", { [field]: val })
    setPages(prev => prev.map(p => p.id === id ? { ...p, [field]: val } : p))
  }

  const addPage = async () => {
    if (!draft.page_name.trim()) return
    await apiJson("/admin/mkt-pages", "POST", draft)
    setAdding(false)
    setDraft({ mkt_code: "", page_name: "", page_link: "", sp_chay: "", pancake: "CHƯA", hoat_dong: "ĐANG CHẠY", share_anhtd: "CHƯA", pos: "CHƯA", bm: "CHƯA", share_hoan: "CHƯA", ghi_chu: "" })
    setToast("Đã thêm page")
    load()
  }

  const deletePage = async (id: string) => {
    await apiJson(`/admin/mkt-pages/${id}`, "DELETE")
    setDeleteId(null)
    setToast("Đã xóa")
    load()
  }

  const filtered = pages.filter(p => {
    if (filterMkt !== "all" && p.mkt_code !== filterMkt) return false
    if (filterHoatDong !== "all" && p.hoat_dong !== filterHoatDong) return false
    if (q && !p.page_name.toLowerCase().includes(q.toLowerCase()) && !p.sp_chay.toLowerCase().includes(q.toLowerCase())) return false
    return true
  })

  // Group theo mkt_code
  const grouped: Record<string, MktPage[]> = {}
  for (const p of filtered) {
    ;(grouped[p.mkt_code] = grouped[p.mkt_code] || []).push(p)
  }

  const inp: React.CSSProperties = { background: "#FFFFFF", color: "#111827", border: "1px solid #E5E7EB", borderRadius: 8, padding: "6px 10px", fontSize: 12, outline: "none" }
  const cellInp: React.CSSProperties = { background: "#F0F6FF", color: "#111827", border: "1px solid #93C5FD", borderRadius: 6, padding: "4px 8px", fontSize: 12, outline: "none", width: "100%" }

  const COLS = [
    { label: "#", w: 36 }, { label: "MKT", w: 80 }, { label: "Tên Page", w: 180 },
    { label: "Link Page", w: 90 }, { label: "Trên FB", w: 90 },
    { label: "SP Chạy", w: 160 }, { label: "Pancake", w: 100 }, { label: "Hoạt động", w: 110 },
    { label: "Share ANHTD", w: 110 }, { label: "POS", w: 90 }, { label: "BM", w: 90 },
    { label: "Share A Hoàn", w: 110 }, { label: "Ghi chú", w: 0 }, { label: "", w: 60 },
  ]

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {toast && (
        <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999, background: "#1877F2", color: "#fff", borderRadius: 12, padding: "12px 18px", fontSize: 13, fontWeight: 500 }}>
          ✓ {toast}
        </div>
      )}

      {/* Inner tab bar */}
      <div style={{ display: "flex", borderBottom: "1px solid #E5E7EB" }}>
        {[{ id: "danh-sach", label: "📋 Danh sách" }, { id: "thong-ke", label: "📈 Thống kê" }].map(t => (
          <button key={t.id} onClick={() => setInnerTab(t.id as any)}
            style={{ padding: "9px 16px", background: "none", border: "none", borderBottom: innerTab === t.id ? "2px solid #1877F2" : "2px solid transparent", color: innerTab === t.id ? "#1877F2" : "#4B5563", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
            {t.label}
          </button>
        ))}
      </div>

      {innerTab === "thong-ke" && <PageStatsTab />}
      {innerTab === "danh-sach" && <>

      {/* Filter bar */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 8, flex: "1 1 180px" }}>
          <span style={{ margin: "0 0 0 10px", color: "#9CA3AF", fontSize: 13 }}>⌕</span>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm tên page, sản phẩm…" style={{ flex: 1, background: "none", border: "none", outline: "none", padding: "7px 10px", fontSize: 12, color: "#111827" }} />
        </div>
        <select value={filterMkt} onChange={e => setFilterMkt(e.target.value)} style={inp}>
          <option value="all">Tất cả MKT</option>
          {mktCodes.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterHoatDong} onChange={e => setFilterHoatDong(e.target.value)} style={inp}>
          <option value="all">Tất cả trạng thái</option>
          {HOAT_DONG_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <span style={{ color: "#9CA3AF", fontSize: 12, marginLeft: "auto" }}>{filtered.length} / {pages.length} page</span>
      </div>

      {/* Table */}
      <div style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.07)", display: "flex", flexDirection: "column", minHeight: "calc(100vh - 300px)" }}>
        <div style={{ overflowX: "auto", flex: 1 }}>
          <table style={{ width: "100%", minWidth: 1200, borderCollapse: "collapse", tableLayout: "fixed" }}>
            <colgroup>
              {COLS.map((c, i) => <col key={i} style={{ width: c.w || undefined }} />)}
            </colgroup>
            <thead>
              <tr style={{ background: "#F0F1F5" }}>
                {COLS.map((c, i) => (
                  <th key={i} style={{ padding: "9px 10px", textAlign: "left", color: "#9CA3AF", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #E5E7EB", whiteSpace: "nowrap" }}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(grouped).map(([mkt, mktPages]) => (
                <>
                  {/* Group header */}
                  <tr key={`h-${mkt}`} style={{ background: "#F8FAFC" }}>
                    <td colSpan={14} style={{ padding: "6px 12px", borderBottom: "1px solid #E5E7EB" }}>
                      <span style={{ background: "#1877F2", color: "#fff", borderRadius: 6, padding: "2px 10px", fontSize: 12, fontWeight: 700, fontFamily: "monospace" }}>{mkt}</span>
                      <span style={{ color: "#9CA3AF", fontSize: 11, marginLeft: 8 }}>{mktPages.length} page</span>
                    </td>
                  </tr>
                  {mktPages.map((p, idx) => (
                    <tr key={p.id} className="hover-bg" style={{ borderBottom: "1px solid #F3F4F6" }}>
                      <td style={{ padding: "8px 10px", color: "#9CA3AF", fontSize: 11 }}>{idx + 1}</td>
                      <td style={{ padding: "8px 10px" }}>
                        <span style={{ background: "#EFF6FF", color: "#1877F2", borderRadius: 6, padding: "2px 7px", fontSize: 11, fontWeight: 700, fontFamily: "monospace" }}>{p.mkt_code}</span>
                      </td>
                      <td style={{ padding: "8px 10px" }}>
                        <span className="line-clamp-1" style={{ color: "#111827", fontSize: 12 }}>{p.page_name}</span>
                      </td>
                      {/* Link Page */}
                      <td style={{ padding: "8px 10px" }}>
                        <LinkCell value={p.page_link} onSave={v => patch(p.id, "page_link", v)} canEdit={canEdit} />
                      </td>
                      {/* Trên FB API */}
                      <td style={{ padding: "8px 10px" }}>
                        {fbPageNames.size === 0
                          ? <span style={{ color: "#9CA3AF", fontSize: 11 }}>…</span>
                          : fbPageNames.has(p.page_name?.toLowerCase().trim())
                            ? <span style={{ background: "#DCFCE7", color: "#059669", borderRadius: 20, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>✓ Có</span>
                            : <span style={{ background: "#FEE2E2", color: "#DC2626", borderRadius: 20, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>✗ Thiếu</span>
                        }
                      </td>
                      <td style={{ padding: "8px 10px" }}>
                        <SpChayMultiSelect value={p.sp_chay || ""} products={products} canEdit={canEdit} onSave={v => patch(p.id, "sp_chay", v)} />
                      </td>
                      {/* Status cells — click để đổi */}
                      {canEdit ? <>
                        <td style={{ padding: "8px 10px" }}><InlineSelect value={p.pancake} opts={STATUS_OPTS} onSave={v => patch(p.id, "pancake", v)} /></td>
                        <td style={{ padding: "8px 10px" }}><InlineSelect value={p.hoat_dong} opts={HOAT_DONG_OPTS} onSave={v => patch(p.id, "hoat_dong", v)} /></td>
                        <td style={{ padding: "8px 10px" }}><InlineSelect value={p.share_anhtd} opts={STATUS_OPTS} onSave={v => patch(p.id, "share_anhtd", v)} /></td>
                        <td style={{ padding: "8px 10px" }}><InlineSelect value={p.pos} opts={STATUS_OPTS} onSave={v => patch(p.id, "pos", v)} /></td>
                        <td style={{ padding: "8px 10px" }}><InlineSelect value={p.bm} opts={STATUS_OPTS} onSave={v => patch(p.id, "bm", v)} /></td>
                        <td style={{ padding: "8px 10px" }}><InlineSelect value={p.share_hoan} opts={STATUS_OPTS} onSave={v => patch(p.id, "share_hoan", v)} /></td>
                      </> : <>
                        {["pancake","hoat_dong","share_anhtd","pos","bm","share_hoan"].map(f => (
                          <td key={f} style={{ padding: "8px 10px" }}><StatusBadge val={(p as any)[f]} /></td>
                        ))}
                      </>}
                      <td style={{ padding: "8px 10px" }}>
                        <span className="line-clamp-1" style={{ color: "#6B7280", fontSize: 11 }}>{p.ghi_chu || "—"}</span>
                      </td>
                      <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                        {canEdit && (
                          <div style={{ position: "relative", display: "inline-block" }}>
                            <button onClick={() => setDeleteId(deleteId === p.id ? null : p.id)}
                              style={{ background: "none", border: "1px solid #E5E7EB", borderRadius: 6, padding: "3px 7px", fontSize: 12, cursor: "pointer", color: "#EF4444" }}>🗑</button>
                            {deleteId === p.id && (
                              <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 500, background: "#FFF", border: "1px solid #FECACA", borderRadius: 10, boxShadow: "0 4px 16px rgba(0,0,0,0.10)", padding: "10px 14px", minWidth: 140, whiteSpace: "nowrap" }}>
                                <div style={{ color: "#111827", fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Xóa page này?</div>
                                <div style={{ display: "flex", gap: 6 }}>
                                  <button onClick={() => deletePage(p.id)} style={{ background: "#EF4444", color: "#fff", border: "none", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Xóa</button>
                                  <button onClick={() => setDeleteId(null)} style={{ background: "#F3F4F6", color: "#6B7280", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer" }}>Hủy</button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </>
              ))}
              {filtered.length === 0 && !adding && (
                <tr><td colSpan={14} style={{ padding: 30, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>Chưa có page nào</td></tr>
              )}
              {/* Add row */}
              {adding && canEdit && (
                <tr style={{ background: "#F0F6FF", borderTop: "2px solid #93C5FD" }}>
                  <td style={{ padding: "8px 10px", color: "#9CA3AF" }}>✦</td>
                  <td style={{ padding: "8px 10px" }}>
                    <select value={draft.mkt_code} onChange={e => setDraft(p => ({ ...p, mkt_code: e.target.value }))} style={cellInp}>
                      {mktCodes.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    <input value={draft.page_name} onChange={e => setDraft(p => ({ ...p, page_name: e.target.value }))} placeholder="Tên page *" style={cellInp} autoFocus />
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    <input value={draft.page_link} onChange={e => setDraft(p => ({ ...p, page_link: e.target.value }))} placeholder="https://fb.com/…" style={cellInp} />
                  </td>
                  <td style={{ padding: "8px 10px" }}>{/* Trên FB — auto khi lưu */}</td>
                  <td style={{ padding: "8px 10px" }}>
                    <SpChayMultiSelect value={draft.sp_chay} products={products} canEdit={true} onSave={v => setDraft(p => ({ ...p, sp_chay: v }))} />
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    <select value={draft.pancake} onChange={e => setDraft(p => ({ ...p, pancake: e.target.value }))} style={cellInp}>
                      {STATUS_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    <select value={draft.hoat_dong} onChange={e => setDraft(p => ({ ...p, hoat_dong: e.target.value }))} style={cellInp}>
                      {HOAT_DONG_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    <select value={draft.share_anhtd} onChange={e => setDraft(p => ({ ...p, share_anhtd: e.target.value }))} style={cellInp}>
                      {STATUS_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    <select value={draft.pos} onChange={e => setDraft(p => ({ ...p, pos: e.target.value }))} style={cellInp}>
                      {STATUS_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    <select value={draft.bm} onChange={e => setDraft(p => ({ ...p, bm: e.target.value }))} style={cellInp}>
                      {STATUS_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    <select value={draft.share_hoan} onChange={e => setDraft(p => ({ ...p, share_hoan: e.target.value }))} style={cellInp}>
                      {STATUS_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    <input value={draft.ghi_chu} onChange={e => setDraft(p => ({ ...p, ghi_chu: e.target.value }))} placeholder="Ghi chú" style={cellInp}
                      onKeyDown={e => { if (e.key === "Enter") addPage(); if (e.key === "Escape") setAdding(false) }} />
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    <div style={{ display: "flex", gap: 5 }}>
                      <button onClick={addPage} style={{ background: "#1877F2", color: "#fff", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✓</button>
                      <button onClick={() => setAdding(false)} style={{ background: "#F3F4F6", color: "#6B7280", border: "none", borderRadius: 6, padding: "4px 8px", fontSize: 12, cursor: "pointer" }}>✕</button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {canEdit && (
          <div style={{ padding: "9px 12px", borderTop: "1px solid #E5E7EB", background: "#F0F1F5", display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={() => setAdding(a => !a)}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, background: adding ? "#FEE2E2" : "none", border: adding ? "1px solid #FECACA" : "none", borderRadius: 6, cursor: "pointer", color: adding ? "#DC2626" : "#4B5563", fontSize: 12, fontWeight: 500, padding: adding ? "3px 8px" : "0" }}>
              {adding ? "✕ Hủy" : "＋ Thêm page"}
            </button>
            {adding && <span style={{ color: "#93C5FD", fontSize: 11 }}>Enter để lưu · Esc để hủy</span>}
          </div>
        )}
      </div>
      </>}
    </div>
  )
}
