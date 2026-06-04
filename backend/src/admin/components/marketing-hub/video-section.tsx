import { useEffect, useRef, useState } from "react"
import { apiFetch, apiJson } from "../../lib/api-client"

const STATUS_VARS: Record<string, { c: string; bg: string }> = {
  "Cần làm":   { c: "#6B7280",  bg: "#F3F4F6" },
  "Đang làm":  { c: "#2563EB", bg: "#DBEAFE" },
  "Chờ duyệt": { c: "#D97706",  bg: "#FEF3C7" },
  "Xong":      { c: "#16A34A",  bg: "#DCFCE7" },
  "Đã đăng":   { c: "#059669",  bg: "#D1FAE5" },
  "Lỗi":       { c: "#DC2626",   bg: "#FEE2E2" },
}
const ALL_STATUSES = ["Cần làm", "Đang làm", "Chờ duyệt", "Xong", "Đã đăng", "Lỗi"]
const PERSON_COLORS: Record<string, string> = { "Hậu": "#1877F2", "Khải": "#10B981", "Quân": "#F59E0B" }
const VT_COLORS: Record<string, string> = { "Video AI": "#1877F2", "Real": "#10B981", "Review": "#F59E0B" }

type VideoRow = {
  id: string; vdCode: string; ngayDang: string; postDate?: string | null
  nguon: string; nguoiLam: string; sp: string; productCode?: string
  loaiVideo: string; link: string; trangThai: string; ghiChu: string; createdBy?: string
}

// ============================================================================
// Small components
// ============================================================================
function StatusPill({ status, onClick }: { status: string; onClick?: () => void }) {
  const v = STATUS_VARS[status] || STATUS_VARS["Cần làm"]
  return (
    <span onClick={onClick} style={{ color: v.c, background: v.bg, cursor: onClick ? "pointer" : "default", display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 500, borderRadius: 20, padding: "2px 8px", fontSize: 12, whiteSpace: "nowrap", userSelect: "none" }}>
      {onClick && <span style={{ fontSize: 8 }}>▼</span>}
      {status}
    </span>
  )
}

function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const bg = PERSON_COLORS[name] || "#6B7280"
  return (
    <div style={{ width: size, height: size, background: bg, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, flexShrink: 0, fontSize: size * 0.42 }}>
      {(name || "?")[0].toUpperCase()}
    </div>
  )
}

function VideoTypeChip({ type }: { type: string }) {
  const c = VT_COLORS[type] || "#6B7280"
  return <span style={{ background: c + "18", color: c, border: `1px solid ${c}28`, borderRadius: 6, padding: "2px 7px", fontSize: 11, fontWeight: 600 }}>{type}</span>
}

function MiniBarChart({ data }: { data: { label: string; value: number; color?: string }[] }) {
  const max = Math.max(...data.map(d => d.value), 1)
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 80 }}>
        {data.map((d, i) => {
          const bh = Math.max(Math.round((d.value / max) * 64), 4)
          return (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", gap: 3 }}>
              <span style={{ color: "#111827", fontSize: 11, fontWeight: 700 }}>{d.value}</span>
              <div style={{ width: "100%", height: bh, background: d.color || "#1877F2", borderRadius: "4px 4px 0 0", opacity: 0.85 }} />
            </div>
          )
        })}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        {data.map((d, i) => <div key={i} style={{ flex: 1, textAlign: "center", color: "#9CA3AF", fontSize: 10 }}>{d.label}</div>)}
      </div>
    </div>
  )
}

function Toast({ msg, onDone }: { msg: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 2500); return () => clearTimeout(t) }, [])
  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999, background: "#1877F2", color: "#fff", boxShadow: "0 4px 16px rgba(0,0,0,0.10),0 2px 4px rgba(0,0,0,0.05)", borderRadius: 12, padding: "12px 18px", fontSize: 13, fontWeight: 500 }}>
      ✓ {msg}
    </div>
  )
}

// ============================================================================
// Tab: Bảng
// ============================================================================
const LOAI_LIST = ["Video AI", "Real", "Review"]

type QuickAdd = { sp: string; nguoiLam: string; loaiVideo: string; link: string; ghiChu: string }

function BangTab({ rows, reload, onDangFB }: { rows: VideoRow[]; reload: () => void; onDangFB: (r: VideoRow) => void }) {
  const [editId, setEditId] = useState<string | null>(null)
  const [filters, setFilters] = useState({ nguoi: "all", sp: "all", tts: "all", q: "" })
  const [toast, setToast] = useState<string | null>(null)
  const [newRowId, setNewRowId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [spList, setSpList] = useState<string[]>([])
  const [nguoiList, setNguoiList] = useState<string[]>([])
  const [draft, setDraft] = useState<QuickAdd>({ sp: "", nguoiLam: "", loaiVideo: LOAI_LIST[0], link: "", ghiChu: "" })
  const spRef = useRef<HTMLSelectElement>(null)

  // Fetch products từ Medusa + mkt users một lần khi mount
  useEffect(() => {
    apiFetch("/admin/products?limit=100&fields=id,title,handle")
      .then(r => r.json())
      .then(d => {
        const titles = (d.products || []).map((p: any) => p.title).filter(Boolean)
        setSpList(titles)
      })
      .catch(() => {})

    apiJson("/admin/permissions/mkt-users")
      .then(d => {
        const names = (d.users || []).map((u: any) => u.mkt_code || u.name).filter(Boolean)
        setNguoiList(names)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const fn = () => setEditId(null)
    document.addEventListener("click", fn)
    return () => document.removeEventListener("click", fn)
  }, [])

  useEffect(() => {
    if (adding) spRef.current?.focus()
  }, [adding])

  const openAdd = () => {
    setDraft({ sp: spList[0] || "", nguoiLam: nguoiList[0] || "", loaiVideo: LOAI_LIST[0], link: "", ghiChu: "" })
    setAdding(true)
  }

  const cancelAdd = () => setAdding(false)

  const saveRow = async () => {
    if (saving) return
    setSaving(true)
    try {
      const res = await apiJson(`/admin/marketing-video`, "POST", { ...draft, link: draft.link || "", trangThai: "Cần làm" })
      setAdding(false)
      const id = res?.row?.id || res?.id || null
      if (id) {
        setNewRowId(id)
        setTimeout(() => setNewRowId(null), 2000)
      }
      setToast("Đã thêm: " + draft.sp)
      reload()
    } catch (e: any) {
      setToast("Lỗi: " + e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); saveRow() }
    if (e.key === "Escape") cancelAdd()
  }

  const updateStatus = async (id: string, s: string) => {
    setEditId(null)
    try { await apiJson(`/admin/marketing-video/${id}`, "PATCH", { trangThai: s }); reload() }
    catch (e: any) { setToast("Lỗi: " + e.message) }
  }

  const filtered = rows.filter(r => {
    if (filters.nguoi !== "all" && r.nguoiLam !== filters.nguoi) return false
    if (filters.sp !== "all" && r.sp !== filters.sp) return false
    if (filters.tts !== "all" && r.trangThai !== filters.tts) return false
    if (filters.q && !r.sp.toLowerCase().includes(filters.q.toLowerCase()) && !(r.ghiChu || "").toLowerCase().includes(filters.q.toLowerCase())) return false
    return true
  })

  const inp: React.CSSProperties = { background: "#FFFFFF", color: "#111827", border: "1px solid #E5E7EB", borderRadius: 8, padding: "6px 10px", fontSize: 12, outline: "none" }
  const cellInp: React.CSSProperties = { background: "#F0F6FF", color: "#111827", border: "1px solid #93C5FD", borderRadius: 6, padding: "4px 8px", fontSize: 12, outline: "none", width: "100%" }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {toast && <Toast msg={toast} onDone={() => setToast(null)} />}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 8, flex: "1 1 180px" }}>
          <span style={{ margin: "0 0 0 10px", color: "#9CA3AF", fontSize: 13 }}>⌕</span>
          <input value={filters.q} onChange={e => setFilters(p => ({ ...p, q: e.target.value }))} placeholder="Tìm sản phẩm, ghi chú…" style={{ flex: 1, background: "none", border: "none", outline: "none", padding: "7px 10px", fontSize: 12, color: "#111827" }} />
        </div>
        <select value={filters.nguoi} onChange={e => setFilters(p => ({ ...p, nguoi: e.target.value }))} style={inp}>
          <option value="all">Tất cả người</option>
          {nguoiList.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={filters.sp} onChange={e => setFilters(p => ({ ...p, sp: e.target.value }))} style={inp}>
          <option value="all">Tất cả SP</option>
          {spList.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filters.tts} onChange={e => setFilters(p => ({ ...p, tts: e.target.value }))} style={inp}>
          <option value="all">Trạng thái</option>
          {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span style={{ color: "#9CA3AF", fontSize: 12, marginLeft: "auto" }}>{filtered.length} / {rows.length} dòng</span>
      </div>

      <div style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.07),0 1px 2px rgba(0,0,0,0.04)" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 1020, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F0F1F5" }}>
                {["#", "VD", "Ngày", "Nguồn", "Người làm", "Sản phẩm", "Loại", "Link", "Trạng thái", "Ghi chú", ""].map((h, i) => (
                  <th key={i} style={{ padding: "9px 12px", textAlign: "left", color: "#9CA3AF", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", borderBottom: "1px solid #E5E7EB", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, idx) => (
                <tr key={row.id} className="hover-bg" style={{ borderBottom: idx < filtered.length - 1 ? "1px solid #E5E7EB" : "none", transition: "background 0.4s", background: newRowId === row.id ? "#EFF6FF" : undefined }}>
                  <td style={{ padding: "9px 12px", color: "#9CA3AF", fontSize: 12 }}>{idx + 1}</td>
                  <td style={{ padding: "9px 12px", color: "#1654B8", fontSize: 11, fontWeight: 700, fontFamily: "monospace" }}>{row.vdCode}</td>
                  <td style={{ padding: "9px 12px", color: "#4B5563", fontSize: 12, whiteSpace: "nowrap" }}>{row.ngayDang || "—"}</td>
                  <td style={{ padding: "9px 12px" }}>
                    <span style={{ background: row.nguon === "Team" ? "#DBEAFE" : "#F0F1F5", color: row.nguon === "Team" ? "#1e40af" : "#4B5563", fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 20 }}>{row.nguon}</span>
                  </td>
                  <td style={{ padding: "9px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <Avatar name={row.nguoiLam} size={22} />
                      <span style={{ color: "#111827", fontSize: 13, fontWeight: 500 }}>{row.nguoiLam}</span>
                    </div>
                  </td>
                  <td style={{ padding: "9px 12px", maxWidth: 170 }}><span className="line-clamp-1" style={{ color: "#111827", fontSize: 12 }}>{row.sp}</span></td>
                  <td style={{ padding: "9px 12px" }}><VideoTypeChip type={row.loaiVideo} /></td>
                  <td style={{ padding: "9px 12px" }}>
                    {row.link ? <a href={row.link} target="_blank" rel="noopener noreferrer" style={{ color: "#1877F2", fontSize: 12, fontWeight: 500, textDecoration: "none" }}>↗ Drive</a> : <span style={{ color: "#9CA3AF", fontSize: 12 }}>—</span>}
                  </td>
                  <td style={{ padding: "9px 12px" }}>
                    <div style={{ position: "relative", display: "inline-block" }} onClick={e => e.stopPropagation()}>
                      <StatusPill status={row.trangThai} onClick={() => setEditId(editId === row.id ? null : row.id)} />
                      {editId === row.id && (
                        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 500, background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 10, boxShadow: "0 4px 16px rgba(0,0,0,0.10),0 2px 4px rgba(0,0,0,0.05)", padding: "4px 0", minWidth: 130 }}>
                          {ALL_STATUSES.map(s => (
                            <button key={s} onClick={() => updateStatus(row.id, s)} className="hover-bg" style={{ display: "flex", alignItems: "center", padding: "6px 10px", width: "100%", background: "none", border: "none", cursor: "pointer" }}>
                              <StatusPill status={s} />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: "9px 12px", maxWidth: 150 }}><span className="line-clamp-1" style={{ color: "#4B5563", fontSize: 12 }}>{row.ghiChu || "—"}</span></td>
                  <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>
                    {(row.trangThai === "Xong" || row.trangThai === "Chờ duyệt") && (
                      <button onClick={() => onDangFB(row)} style={{ background: "#1877F2", color: "#fff", border: "none", borderRadius: 7, padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Đăng FB</button>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && !adding && (
                <tr><td colSpan={11} style={{ padding: "30px", textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>Chưa có dữ liệu</td></tr>
              )}
              {/* ── Inline quick-add row ── */}
              {adding && (
                <tr style={{ background: "#F0F6FF", borderTop: "2px solid #93C5FD" }} onKeyDown={handleKeyDown}>
                  <td style={{ padding: "8px 12px", color: "#9CA3AF", fontSize: 12 }}>✦</td>
                  <td style={{ padding: "8px 12px", color: "#93C5FD", fontSize: 11, fontFamily: "monospace" }}>mới</td>
                  <td style={{ padding: "8px 12px", color: "#9CA3AF", fontSize: 12 }}>hôm nay</td>
                  <td style={{ padding: "8px 12px" }}>
                    <span style={{ background: "#DBEAFE", color: "#1e40af", fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 20 }}>Team</span>
                  </td>
                  <td style={{ padding: "8px 12px", minWidth: 110 }}>
                    <select value={draft.nguoiLam} onChange={e => setDraft(p => ({ ...p, nguoiLam: e.target.value }))} style={cellInp}>
                      {nguoiList.length === 0 && <option value="">Đang tải…</option>}
                      {nguoiList.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "8px 12px", minWidth: 200 }}>
                    <select ref={spRef} value={draft.sp} onChange={e => setDraft(p => ({ ...p, sp: e.target.value }))} style={cellInp}>
                      {spList.length === 0 && <option value="">Đang tải…</option>}
                      {spList.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "8px 12px", minWidth: 110 }}>
                    <select value={draft.loaiVideo} onChange={e => setDraft(p => ({ ...p, loaiVideo: e.target.value }))} style={cellInp}>
                      {LOAI_LIST.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "8px 12px", minWidth: 160 }}>
                    <input value={draft.link} onChange={e => setDraft(p => ({ ...p, link: e.target.value }))} placeholder="Drive link…" style={cellInp} />
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    <StatusPill status="Cần làm" />
                  </td>
                  <td style={{ padding: "8px 12px", minWidth: 160 }}>
                    <input value={draft.ghiChu} onChange={e => setDraft(p => ({ ...p, ghiChu: e.target.value }))} placeholder="Ghi chú (tuỳ chọn)…" style={cellInp} />
                  </td>
                  <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", gap: 5 }}>
                      <button onClick={saveRow} disabled={saving} style={{ background: saving ? "#93C5FD" : "#1877F2", color: "#fff", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 700, cursor: saving ? "wait" : "pointer" }}>
                        {saving ? "…" : "✓"}
                      </button>
                      <button onClick={cancelAdd} style={{ background: "#F3F4F6", color: "#6B7280", border: "none", borderRadius: 6, padding: "4px 8px", fontSize: 12, cursor: "pointer" }}>✕</button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "9px 12px", borderTop: "1px solid #E5E7EB", background: "#F0F1F5", display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={adding ? cancelAdd : openAdd} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: adding ? "#FEE2E2" : "none", border: adding ? "1px solid #FECACA" : "none", borderRadius: 6, cursor: "pointer", color: adding ? "#DC2626" : "#4B5563", fontSize: 12, fontWeight: 500, padding: adding ? "3px 8px" : "0" }}>
            {adding ? "✕ Hủy" : "＋ Thêm dòng"}
          </button>
          {adding && <span style={{ color: "#93C5FD", fontSize: 11 }}>Enter để lưu · Esc để hủy</span>}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Tab: Kanban (kéo thả đổi status)
// ============================================================================
function KanbanTab({ rows, reload }: { rows: VideoRow[]; reload: () => void }) {
  const [dragId, setDragId] = useState<string | null>(null)
  const cols = [
    { id: "Cần làm", c: "#6B7280", bg: "#F3F4F6" },
    { id: "Đang làm", c: "#2563EB", bg: "#DBEAFE" },
    { id: "Chờ duyệt", c: "#D97706", bg: "#FEF3C7" },
    { id: "Xong", c: "#16A34A", bg: "#DCFCE7" },
    { id: "Đã đăng", c: "#059669", bg: "#D1FAE5" },
  ]
  const drop = async (status: string) => {
    if (!dragId) return
    const id = dragId; setDragId(null)
    try { await apiJson(`/admin/marketing-video/${id}`, "PATCH", { trangThai: status }); reload() } catch {}
  }
  return (
    <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 12 }}>
      {cols.map(col => {
        const colRows = rows.filter(r => r.trangThai === col.id)
        return (
          <div key={col.id} style={{ minWidth: 210, width: 210, flexShrink: 0 }}
            onDragOver={e => e.preventDefault()} onDrop={() => drop(col.id)}>
            <div style={{ background: col.bg, borderRadius: 10, padding: "7px 12px", marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: col.c, fontWeight: 700, fontSize: 12 }}>{col.id}</span>
              <span style={{ background: col.c, color: "#fff", borderRadius: 20, padding: "1px 7px", fontSize: 11, fontWeight: 700 }}>{colRows.length}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 40 }}>
              {colRows.map(row => (
                <div key={row.id} draggable onDragStart={() => setDragId(row.id)} className="hover-lift"
                  style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderLeft: `3px solid ${col.c}`, borderRadius: 10, padding: "10px 12px", cursor: "grab", boxShadow: "0 1px 3px rgba(0,0,0,0.07),0 1px 2px rgba(0,0,0,0.04)", transition: "transform 0.15s, box-shadow 0.15s", opacity: dragId === row.id ? 0.5 : 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6, marginBottom: 8 }}>
                    <span style={{ color: "#111827", fontWeight: 600, fontSize: 12, lineHeight: 1.4 }}>{row.sp.replace(/SP\d+ - /, "")}</span>
                    <VideoTypeChip type={row.loaiVideo} />
                  </div>
                  {row.ghiChu && <p className="line-clamp-2" style={{ color: "#9CA3AF", fontSize: 11, marginBottom: 8 }}>{row.ghiChu}</p>}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <Avatar name={row.nguoiLam} size={20} />
                      <span style={{ color: "#4B5563", fontSize: 11 }}>{row.nguoiLam}</span>
                    </div>
                    <span style={{ color: "#9CA3AF", fontSize: 11 }}>{row.ngayDang}</span>
                  </div>
                </div>
              ))}
              {colRows.length === 0 && <div style={{ border: "2px dashed #E5E7EB", borderRadius: 10, padding: "22px 12px", textAlign: "center", color: "#9CA3AF", fontSize: 12 }}>Trống</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ============================================================================
// Tab: Theo người — lấy từ users có role marketing + mkt_code
// ============================================================================
type MktUser = { email: string; name: string; mkt_code: string | null }

function TheoNguoiTab({ rows, myEmail }: { rows: VideoRow[]; myEmail: string }) {
  const [showAll, setShowAll] = useState(true)
  const [mktUsers, setMktUsers] = useState<MktUser[]>([])

  useEffect(() => {
    apiJson(`/admin/permissions/mkt-users`)
      .then(d => setMktUsers(d.users || []))
      .catch(() => {})
  }, [])

  const visibleRows = showAll ? rows : rows.filter(r => r.createdBy === myEmail)

  // Ghép rows với mktUsers theo field nguoiLam (maker) — match theo name hoặc mkt_code
  const usersToShow = mktUsers.length > 0
    ? (showAll ? mktUsers : mktUsers.filter(u => u.email === myEmail))
    : []

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {[["Tất cả", true], ["Của tôi", false]].map(([label, val]) => (
          <button key={String(label)} onClick={() => setShowAll(val as boolean)} style={{ background: showAll === val ? "#1877F2" : "#FFFFFF", color: showAll === val ? "#fff" : "#4B5563", border: `1px solid ${showAll === val ? "#1877F2" : "#E5E7EB"}`, borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{label}</button>
        ))}
        {mktUsers.length === 0 && <span style={{ color: "#9CA3AF", fontSize: 12 }}>Đang tải…</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16 }}>
        {usersToShow.map(user => {
          const pRows = visibleRows.filter(r => r.nguoiLam === user.name || r.nguoiLam === user.mkt_code)
          const stats = ALL_STATUSES.reduce((a, s) => ({ ...a, [s]: pRows.filter(r => r.trangThai === s).length }), {} as Record<string, number>)
          return (
            <div key={user.email} style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.07),0 1px 2px rgba(0,0,0,0.04)" }}>
              <div style={{ padding: "16px 18px", borderBottom: "1px solid #E5E7EB", display: "flex", alignItems: "center", gap: 12 }}>
                <Avatar name={user.name} size={42} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ color: "#111827", fontWeight: 700, fontSize: 16 }}>{user.name}</span>
                    {user.mkt_code && (
                      <span style={{ background: "#EFF6FF", color: "#1877F2", border: "1px solid #BFDBFE", borderRadius: 6, padding: "1px 7px", fontSize: 11, fontWeight: 700, fontFamily: "monospace" }}>{user.mkt_code}</span>
                    )}
                  </div>
                  <div style={{ color: "#9CA3AF", fontSize: 12 }}>{user.email} · {pRows.length} video</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ color: "#1877F2", fontWeight: 800, fontSize: 24 }}>{stats["Đã đăng"] || 0}</div>
                  <div style={{ color: "#9CA3AF", fontSize: 11 }}>Đã đăng</div>
                </div>
              </div>
              <div style={{ padding: "10px 18px", borderBottom: "1px solid #E5E7EB", display: "flex", gap: 8, flexWrap: "wrap" }}>
                {ALL_STATUSES.filter(s => stats[s] > 0).map(s => (
                  <div key={s} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <StatusPill status={s} /><span style={{ color: "#4B5563", fontSize: 12, fontWeight: 600 }}>{stats[s]}</span>
                  </div>
                ))}
                {ALL_STATUSES.every(s => !stats[s]) && <span style={{ color: "#D1D5DB", fontSize: 12 }}>Chưa có video nào</span>}
              </div>
              <div style={{ maxHeight: 220, overflowY: "auto" }}>
                {pRows.map((r, i) => (
                  <div key={r.id} className="hover-bg" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 18px", borderBottom: i < pRows.length - 1 ? "1px solid #E5E7EB" : "none" }}>
                    <VideoTypeChip type={r.loaiVideo} />
                    <span className="line-clamp-1" style={{ color: "#111827", fontSize: 12, flex: 1 }}>{r.sp}</span>
                    <StatusPill status={r.trangThai} />
                    <span style={{ color: "#9CA3AF", fontSize: 11 }}>{r.ngayDang}</span>
                  </div>
                ))}
                {pRows.length === 0 && <div style={{ padding: "20px", textAlign: "center", color: "#9CA3AF", fontSize: 12 }}>Chưa có video</div>}
              </div>
            </div>
          )
        })}
        {usersToShow.length === 0 && mktUsers.length > 0 && (
          <div style={{ color: "#9CA3AF", fontSize: 13, padding: "20px 0" }}>Không có dữ liệu</div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Tab: Báo cáo (data thật từ /report)
// ============================================================================
function BaoCaoTab() {
  const [dateFrom, setDateFrom] = useState("2026-06-01")
  const [dateTo, setDateTo] = useState("2026-06-30")
  const [data, setData] = useState<any>(null)

  const load = () => {
    apiJson(`/admin/marketing-video/report?from=${dateFrom}&to=${dateTo}`).then(setData).catch(() => {})
  }
  useEffect(() => { load() }, [dateFrom, dateTo])

  const inpStyle: React.CSSProperties = { background: "#FFFFFF", color: "#111827", border: "1px solid #E5E7EB", borderRadius: 8, padding: "6px 10px", fontSize: 12, outline: "none" }
  const total = data?.total ?? 0
  const byStatus = data?.byStatus ?? {}
  const cards = [
    { label: "Tổng video", value: total, color: "#1877F2" },
    { label: "Đã đăng", value: byStatus["Đã đăng"] || 0, color: "#059669" },
    { label: "Chờ duyệt", value: byStatus["Chờ duyệt"] || 0, color: "#D97706" },
    { label: "Lỗi", value: byStatus["Lỗi"] || 0, color: "#DC2626" },
  ]
  const personColored = (data?.byPerson || []).map((d: any) => ({ ...d, color: PERSON_COLORS[d.label] || "#6B7280" }))
  const typeColored = (data?.byType || []).map((d: any, i: number) => ({ ...d, color: ["#1877F2", "#10B981", "#F59E0B"][i % 3] }))
  const prodColored = (data?.byProduct || []).map((d: any, i: number) => ({ ...d, color: ["#1877F2", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#06B6D4"][i % 6] }))

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <span style={{ color: "#9CA3AF" }}>📅</span>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inpStyle} />
        <span style={{ color: "#9CA3AF" }}>→</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inpStyle} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {cards.map(c => (
          <div key={c.label} style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 14, padding: "16px 18px", boxShadow: "0 1px 3px rgba(0,0,0,0.07),0 1px 2px rgba(0,0,0,0.04)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
              <span style={{ color: "#9CA3AF", fontSize: 12, fontWeight: 500 }}>{c.label}</span>
              <div style={{ background: c.color + "18", color: c.color, width: 10, height: 10, borderRadius: 3 }} />
            </div>
            <div style={{ color: "#111827", fontWeight: 800, fontSize: 30, lineHeight: 1 }}>{c.value}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
        {[
          { title: "Video theo người", data: personColored },
          { title: "Theo loại video", data: typeColored },
          { title: "Theo sản phẩm", data: prodColored },
        ].map(({ title, data }) => (
          <div key={title} style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 14, padding: "16px 18px", boxShadow: "0 1px 3px rgba(0,0,0,0.07),0 1px 2px rgba(0,0,0,0.04)" }}>
            <div style={{ color: "#111827", fontWeight: 600, fontSize: 13, marginBottom: 16 }}>{title}</div>
            {data.length ? <MiniBarChart data={data} /> : <div style={{ color: "#9CA3AF", fontSize: 12, padding: "20px 0", textAlign: "center" }}>Chưa có dữ liệu</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ============================================================================
// Page
// ============================================================================
// onDangFB: do route cha truyền vào — chuyển sang tab Đăng Facebook + prefill (cùng trang).
export function VideoSection({ onDangFB }: { onDangFB: (row: VideoRow) => void }) {
  const [tab, setTab] = useState("bang")
  const [rows, setRows] = useState<VideoRow[]>([])
  const [myEmail, setMyEmail] = useState("")

  const reload = () => { apiJson(`/admin/marketing-video`).then(d => setRows(d.rows || [])).catch(() => {}) }
  useEffect(() => {
    reload()
    apiFetch("/admin/permissions/me").then(r => r.json()).then(d => setMyEmail(d.email || "")).catch(() => {})
  }, [])

  const tabs = [
    { id: "bang", label: "Bảng" },
    { id: "kanban", label: "Kanban" },
    { id: "theonguoi", label: "Theo người" },
    { id: "baocao", label: "Báo cáo" },
  ]

  return (
    <div>
      <div style={{ display: "flex", borderBottom: "1px solid #E5E7EB", background: "#FFFFFF", paddingLeft: 20 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "11px 16px", color: tab === t.id ? "#1877F2" : "#4B5563", background: "none", border: "none", borderBottom: tab === t.id ? "2px solid #1877F2" : "2px solid transparent", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>{t.label}</button>
        ))}
      </div>
      <div style={{ padding: 20 }}>
        {tab === "bang" && <BangTab rows={rows} reload={reload} onDangFB={onDangFB} />}
        {tab === "kanban" && <KanbanTab rows={rows} reload={reload} />}
        {tab === "theonguoi" && <TheoNguoiTab rows={rows} myEmail={myEmail} />}
        {tab === "baocao" && <BaoCaoTab />}
      </div>
    </div>
  )
}

export type { VideoRow }
