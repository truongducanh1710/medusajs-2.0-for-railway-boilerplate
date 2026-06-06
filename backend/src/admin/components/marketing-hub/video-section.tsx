import { useEffect, useRef, useState } from "react"
import { apiFetch, apiJson } from "../../lib/api-client"
import { useCurrentPermissions } from "../../lib/use-permissions"

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

type FbPostLink = { page_id: string; page_name: string; post_url: string; posted_at: string }

type VideoRow = {
  id: string; vdCode: string; ngayDang: string; postDate?: string | null
  createdAt?: string; adName?: string; script?: string
  nguon: string; nguoiLam: string; sp: string; productCode?: string
  loaiVideo: string; link: string; trangThai: string; ghiChu: string; createdBy?: string
  fbPostLinks?: FbPostLink[]
  deadline?: string | null
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

function DeadlineChip({ deadline, onClick }: { deadline?: string | null; onClick?: () => void }) {
  if (!deadline) return (
    <span onClick={onClick} style={{ color: "#D1D5DB", fontSize: 11, cursor: onClick ? "pointer" : "default" }}>—</span>
  )
  const today = new Date(); today.setHours(0,0,0,0)
  const d = new Date(deadline); d.setHours(0,0,0,0)
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000)
  const label = d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })
  const { bg, c } = diff < 0
    ? { bg: "#FEE2E2", c: "#DC2626" }
    : diff <= 2
    ? { bg: "#FEF3C7", c: "#D97706" }
    : { bg: "#DCFCE7", c: "#16A34A" }
  return (
    <span onClick={onClick} style={{ background: bg, color: c, borderRadius: 10, padding: "2px 8px", fontSize: 11, fontWeight: 600, cursor: onClick ? "pointer" : "default", whiteSpace: "nowrap" }}>
      {label}
    </span>
  )
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

type EditDraft = { nguoiLam: string; sp: string; loaiVideo: string; link: string; ghiChu: string; postDate: string; adName: string; script: string }

function BangTab({ rows, reload, onDangFB, isSuper, mktCode, mktUsers }: { rows: VideoRow[]; reload: () => void; onDangFB: (r: VideoRow) => void; isSuper: boolean; mktCode: string | null; mktUsers: MktUser[] }) {
  const [statusDropId, setStatusDropId] = useState<string | null>(null)
  const [editRowId, setEditRowId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const defaultNguoi = (!isSuper && mktCode) ? mktCode : "all"
  const [filters, setFilters] = useState({ nguoi: defaultNguoi, sp: "all", tts: "all", q: "" })
  const [toast, setToast] = useState<string | null>(null)
  const [fbLinkModal, setFbLinkModal] = useState<{ row: VideoRow } | null>(null)
  const [fbLinkDraft, setFbLinkDraft] = useState<{ page_name: string; post_url: string }>({ page_name: "", post_url: "" })
  const [deadlinePopup, setDeadlinePopup] = useState<{ row: VideoRow } | null>(null)
  const [makerPopup, setMakerPopup] = useState<{ row: VideoRow } | null>(null)
  const [newRowId, setNewRowId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [spList, setSpList] = useState<{ name: string; code: string }[]>([])
  const [draft, setDraft] = useState<QuickAdd>({ sp: "", nguoiLam: "", loaiVideo: LOAI_LIST[0], link: "", ghiChu: "" })
  const spRef = useRef<HTMLSelectElement>(null)

  // Fetch products từ Pancake POS
  useEffect(() => {
    apiFetch("/admin/marketing-video/products")
      .then(r => r.json())
      .then(d => {
        const list = (d.products || []).filter((p: any) => p.name && p.active !== false)
        setSpList(list)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const fn = () => { setStatusDropId(null); setDeleteConfirmId(null) }
    document.addEventListener("click", fn)
    return () => document.removeEventListener("click", fn)
  }, [])

  useEffect(() => {
    if (adding) spRef.current?.focus()
  }, [adding])

  const mktCodeToName = (code: string) => mktUsers.find(u => u.mkt_code === code)?.name || code

  const openAdd = () => {
    const defaultPerson = (!isSuper && mktCode) ? mktCodeToName(mktCode) : (mktUsers[0]?.name || "")
    setDraft({ sp: spList[0]?.name || "", nguoiLam: defaultPerson, loaiVideo: LOAI_LIST[0], link: "", ghiChu: "" })
    setAdding(true)
  }

  const cancelAdd = () => setAdding(false)

  const saveRow = async () => {
    if (saving) return
    setSaving(true)
    try {
      const spEntry = spList.find(s => s.name.toLowerCase() === draft.sp.toLowerCase())
      const res = await apiJson(`/admin/marketing-video`, "POST", { ...draft, link: draft.link || "", trangThai: "Cần làm", productCode: spEntry?.code || "" })
      setAdding(false)
      const id = res?.row?.id || res?.id || null
      if (id) { setNewRowId(id); setTimeout(() => setNewRowId(null), 2000) }
      setToast("Đã thêm: " + draft.sp)
      reload()
    } catch (e: any) { setToast("Lỗi: " + e.message) }
    finally { setSaving(false) }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); saveRow() }
    if (e.key === "Escape") cancelAdd()
  }

  const updateStatus = async (id: string, s: string) => {
    setStatusDropId(null)
    try { await apiJson(`/admin/marketing-video/${id}`, "PATCH", { trangThai: s }); reload() }
    catch (e: any) { setToast("Lỗi: " + e.message) }
  }

  const startEdit = (row: VideoRow) => {
    setEditRowId(row.id)
    setEditDraft({ nguoiLam: row.nguoiLam, sp: row.sp, loaiVideo: row.loaiVideo, link: row.link || "", ghiChu: row.ghiChu || "", postDate: row.postDate || "", adName: row.adName || "", script: row.script || "" })
    setDeleteConfirmId(null)
  }

  const cancelEdit = () => { setEditRowId(null); setEditDraft(null) }

  const saveEdit = async (id: string) => {
    if (!editDraft) return
    try {
      const spEntry = spList.find(s => s.name.toLowerCase() === editDraft.sp.toLowerCase())
      const payload = { ...editDraft, ...(spEntry?.code ? { productCode: spEntry.code } : {}) }
      await apiJson(`/admin/marketing-video/${id}`, "PATCH", payload)
      setToast("Đã lưu"); cancelEdit(); reload()
    } catch (e: any) { setToast("Lỗi: " + e.message) }
  }

  const deleteRow = async (id: string) => {
    try {
      await apiJson(`/admin/marketing-video/${id}`, "DELETE")
      setDeleteConfirmId(null); setToast("Đã xóa dòng"); reload()
    } catch (e: any) { setToast("Lỗi: " + e.message) }
  }

  const saveFbLink = async () => {
    if (!fbLinkModal || !fbLinkDraft.post_url.trim()) return
    const row = fbLinkModal.row
    const existing = row.fbPostLinks || []
    const newLink: FbPostLink = {
      page_id: "",
      page_name: fbLinkDraft.page_name.trim() || "Page",
      post_url: fbLinkDraft.post_url.trim(),
      posted_at: new Date().toISOString(),
    }
    const updated = [...existing, newLink]
    try {
      await apiJson(`/admin/marketing-video/${row.id}`, "PATCH", { fbPostLinks: updated })
      setFbLinkModal(null)
      setFbLinkDraft({ page_name: "", post_url: "" })
      setToast("Đã lưu link bài đăng")
      reload()
    } catch (e: any) { setToast("Lỗi: " + e.message) }
  }

  const removeFbLink = async (row: VideoRow, idx: number) => {
    const updated = (row.fbPostLinks || []).filter((_, i) => i !== idx)
    try {
      await apiJson(`/admin/marketing-video/${row.id}`, "PATCH", { fbPostLinks: updated })
      setToast("Đã xóa link"); reload()
    } catch (e: any) { setToast("Lỗi: " + e.message) }
  }

  const saveDeadline = async (row: VideoRow, deadline: string | null) => {
    try {
      await apiJson(`/admin/marketing-video/${row.id}`, "PATCH", { deadline })
      setDeadlinePopup(null); setToast("Đã lưu deadline"); reload()
    } catch (e: any) { setToast("Lỗi: " + e.message) }
  }

  const saveMaker = async (row: VideoRow, maker: string) => {
    try {
      await apiJson(`/admin/marketing-video/${row.id}`, "PATCH", { nguoiLam: maker })
      setMakerPopup(null); setToast("Đã cập nhật người làm"); reload()
    } catch (e: any) { setToast("Lỗi: " + e.message) }
  }

  const filtered = rows.filter(r => {
    if (filters.nguoi !== "all") {
      // filters.nguoi là mkt_code — map sang name để match với r.nguoiLam (maker = tên)
      const expectedName = mktCodeToName(filters.nguoi)
      if (r.nguoiLam !== expectedName && r.nguoiLam !== filters.nguoi) return false
    }
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
          {mktUsers.map(u => (
            <option key={u.email} value={u.mkt_code || u.name}>
              {u.name}{u.mkt_code ? ` (${u.mkt_code})` : ""}
            </option>
          ))}
        </select>
        <select value={filters.sp} onChange={e => setFilters(p => ({ ...p, sp: e.target.value }))} style={inp}>
          <option value="all">Tất cả SP</option>
          {spList.map(s => <option key={s.name} value={s.name}>{s.name}{s.code ? ` [${s.code}]` : ""}</option>)}
        </select>
        <select value={filters.tts} onChange={e => setFilters(p => ({ ...p, tts: e.target.value }))} style={inp}>
          <option value="all">Trạng thái</option>
          {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {/* MKT user: toggle xem của mình / xem tổng */}
        {!isSuper && mktCode && (
          <button
            onClick={() => setFilters(p => ({ ...p, nguoi: p.nguoi === mktCode ? "all" : mktCode }))}
            style={{ background: filters.nguoi === mktCode ? "#EFF6FF" : "#F3F4F6", color: filters.nguoi === mktCode ? "#1877F2" : "#4B5563", border: `1px solid ${filters.nguoi === mktCode ? "#BFDBFE" : "#E5E7EB"}`, borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
            {filters.nguoi === mktCode ? `👤 Của tôi (${mktCode})` : "🌐 Xem tổng"}
          </button>
        )}
        <span style={{ color: "#9CA3AF", fontSize: 12, marginLeft: "auto" }}>{filtered.length} / {rows.length} dòng</span>
        <button onClick={adding ? cancelAdd : openAdd} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: adding ? "#FEE2E2" : "#1877F2", border: adding ? "1px solid #FECACA" : "none", borderRadius: 6, cursor: "pointer", color: adding ? "#DC2626" : "#fff", fontSize: 12, fontWeight: 600, padding: "5px 12px", whiteSpace: "nowrap" }}>
          {adding ? "✕ Hủy" : "＋ Thêm dòng"}
        </button>
      </div>

      <div style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.07),0 1px 2px rgba(0,0,0,0.04)", display: "flex", flexDirection: "column", minHeight: "calc(100vh - 280px)" }}>
        <div style={{ overflowX: "auto", flex: 1 }}>
          <table style={{ width: "100%", minWidth: 1300, borderCollapse: "collapse", tableLayout: "fixed", height: "100%" }}>
            <colgroup>
              <col style={{ width: 36 }} />   {/* # */}
              <col style={{ width: 76 }} />   {/* VD */}
              <col style={{ width: 90 }} />   {/* Ngày */}
              <col style={{ width: 70 }} />   {/* Nguồn */}
              <col style={{ width: 140 }} />  {/* Người làm */}
              <col style={{ width: 85 }} />   {/* Deadline */}
              <col style={{ width: 190 }} />  {/* Sản phẩm */}
              <col style={{ width: 90 }} />   {/* Loại */}
              <col style={{ width: 70 }} />   {/* Link */}
              <col style={{ width: 90 }} />   {/* Bài FB */}
              <col style={{ width: 110 }} />  {/* Trạng thái */}
              <col style={{ width: 160 }} />  {/* Ad Name */}
              <col style={{ width: 200 }} />  {/* Lời thoại */}
              <col />                         {/* Ghi chú — fill phần còn lại */}
              <col style={{ width: 160 }} />  {/* Actions */}
            </colgroup>
            <thead>
              <tr style={{ background: "#F0F1F5" }}>
                {["#", "VD", "Ngày", "Nguồn", "Người làm", "Deadline", "Sản phẩm", "Loại", "Link", "Bài FB", "Trạng thái", "Ad Name", "Lời thoại", "Ghi chú", ""].map((h, i) => (
                  <th key={i} style={{ padding: "9px 12px", textAlign: "left", color: "#9CA3AF", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", borderBottom: "1px solid #E5E7EB", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, idx) => {
                const isEditing = editRowId === row.id
                const ed = editDraft!
                const rowBg = newRowId === row.id ? "#EFF6FF" : isEditing ? "#FAFBFF" : undefined
                return (
                <tr key={row.id} className={isEditing ? "" : "hover-bg"} style={{ borderBottom: idx < filtered.length - 1 ? "1px solid #E5E7EB" : "none", transition: "background 0.4s", background: rowBg, outline: isEditing ? "2px solid #93C5FD" : "none", outlineOffset: -1 }}>
                  <td style={{ padding: "9px 12px", color: "#9CA3AF", fontSize: 12 }}>{idx + 1}</td>
                  <td style={{ padding: "9px 12px", color: "#1654B8", fontSize: 11, fontWeight: 700, fontFamily: "monospace" }}>{row.vdCode}</td>
                  {/* Ngày */}
                  {/* Ngày tạo — cố định, không cho sửa */}
                  <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>
                    <span style={{ color: "#4B5563", fontSize: 12 }}>{row.createdAt || "—"}</span>
                  </td>
                  <td style={{ padding: "9px 12px" }}>
                    <span style={{ background: row.nguon === "Team" ? "#DBEAFE" : "#F0F1F5", color: row.nguon === "Team" ? "#1e40af" : "#4B5563", fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 20 }}>{row.nguon}</span>
                  </td>
                  {/* Người làm */}
                  <td style={{ padding: "9px 12px" }}>
                    {isEditing
                      ? <select value={ed.nguoiLam} onChange={e => setEditDraft(p => ({ ...p!, nguoiLam: e.target.value }))} style={cellInp}>
                          {mktUsers.map(u => <option key={u.email} value={u.name}>{u.name}{u.mkt_code ? ` · ${u.mkt_code}` : ""}</option>)}
                        </select>
                      : <div onClick={isSuper ? () => setMakerPopup({ row }) : undefined} style={{ display: "flex", alignItems: "center", gap: 7, cursor: isSuper ? "pointer" : "default" }}>
                          <Avatar name={row.nguoiLam} size={22} />
                          <span style={{ color: "#111827", fontSize: 13, fontWeight: 500 }}>{row.nguoiLam}</span>
                          {isSuper && <span style={{ color: "#D1D5DB", fontSize: 10 }}>✎</span>}
                        </div>}
                  </td>
                  {/* Deadline */}
                  <td style={{ padding: "9px 12px" }}>
                    {isSuper
                      ? <DeadlineChip deadline={row.deadline} onClick={() => setDeadlinePopup({ row })} />
                      : <DeadlineChip deadline={row.deadline} />}
                  </td>
                  {/* Sản phẩm */}
                  <td style={{ padding: "9px 12px" }}>
                    {isEditing
                      ? <select value={ed.sp} onChange={e => setEditDraft(p => ({ ...p!, sp: e.target.value }))} style={cellInp}>
                          {spList.map(s => <option key={s.name} value={s.name}>{s.name}{s.code ? ` [${s.code}]` : ""}</option>)}
                        </select>
                      : <span className="line-clamp-1" style={{ color: "#111827", fontSize: 12 }}>{row.sp}</span>}
                  </td>
                  {/* Loại */}
                  <td style={{ padding: "9px 12px" }}>
                    {isEditing
                      ? <select value={ed.loaiVideo} onChange={e => setEditDraft(p => ({ ...p!, loaiVideo: e.target.value }))} style={cellInp}>
                          {LOAI_LIST.map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                      : <VideoTypeChip type={row.loaiVideo} />}
                  </td>
                  {/* Link */}
                  <td style={{ padding: "9px 12px" }}>
                    {isEditing
                      ? <input value={ed.link} onChange={e => setEditDraft(p => ({ ...p!, link: e.target.value }))} placeholder="Drive link…" style={cellInp} />
                      : row.link ? <a href={row.link} target="_blank" rel="noopener noreferrer" style={{ color: "#1877F2", fontSize: 12, fontWeight: 500, textDecoration: "none" }}>↗ Drive</a> : <span style={{ color: "#9CA3AF", fontSize: 12 }}>—</span>}
                  </td>
                  {/* Bài FB */}
                  <td style={{ padding: "9px 12px" }}>
                    {(row.fbPostLinks && row.fbPostLinks.length > 0) ? (
                      <button onClick={() => { setFbLinkModal({ row }); setFbLinkDraft({ page_name: "", post_url: "" }) }} title="Xem / thêm link bài đăng" style={{ display: "flex", alignItems: "center", gap: 4, background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 12, padding: "2px 8px", cursor: "pointer", fontSize: 11, color: "#1D4ED8", fontWeight: 600 }}>
                        ✓ {row.fbPostLinks.length} bài
                      </button>
                    ) : (
                      <button onClick={() => { setFbLinkModal({ row }); setFbLinkDraft({ page_name: "", post_url: "" }) }} title="Thêm link bài đăng Facebook" style={{ background: "none", border: "1px dashed #D1D5DB", borderRadius: 12, padding: "2px 8px", cursor: "pointer", fontSize: 11, color: "#9CA3AF" }}>
                        + Link
                      </button>
                    )}
                  </td>
                  {/* Trạng thái */}
                  <td style={{ padding: "9px 12px" }}>
                    <div style={{ position: "relative", display: "inline-block" }} onClick={e => e.stopPropagation()}>
                      <StatusPill status={row.trangThai} onClick={() => setStatusDropId(statusDropId === row.id ? null : row.id)} />
                      {statusDropId === row.id && (
                        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 500, background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 10, boxShadow: "0 4px 16px rgba(0,0,0,0.10)", padding: "4px 0", minWidth: 130 }}>
                          {ALL_STATUSES.map(s => (
                            <button key={s} onClick={() => updateStatus(row.id, s)} className="hover-bg" style={{ display: "flex", alignItems: "center", padding: "6px 10px", width: "100%", background: "none", border: "none", cursor: "pointer" }}>
                              <StatusPill status={s} />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </td>
                  {/* Ad Name */}
                  <td style={{ padding: "9px 12px" }}>
                    {isEditing
                      ? <input value={ed.adName} onChange={e => setEditDraft(p => ({ ...p!, adName: e.target.value }))} placeholder="Ad name…" style={cellInp} />
                      : <span style={{ fontFamily: "monospace", fontSize: 11, color: "#1654B8", background: "#EFF6FF", borderRadius: 5, padding: "2px 6px" }}>{row.adName || "—"}</span>}
                  </td>
                  {/* Lời thoại */}
                  <td style={{ padding: "9px 12px" }}>
                    {isEditing
                      ? <textarea value={ed.script} onChange={e => setEditDraft(p => ({ ...p!, script: e.target.value }))} placeholder="Lời thoại…" rows={2} style={{ ...cellInp, resize: "vertical", fontFamily: "inherit" }} />
                      : row.script
                        ? <span className="line-clamp-2" style={{ color: "#374151", fontSize: 12, lineHeight: 1.5, cursor: "help", whiteSpace: "pre-wrap" }} title={row.script}>{row.script}</span>
                        : <span style={{ color: "#D1D5DB", fontSize: 12 }}>—</span>}
                  </td>
                  {/* Ghi chú */}
                  <td style={{ padding: "9px 12px" }}>
                    {isEditing
                      ? <input value={ed.ghiChu} onChange={e => setEditDraft(p => ({ ...p!, ghiChu: e.target.value }))} placeholder="Ghi chú…" style={cellInp} onKeyDown={e => { if (e.key === "Enter") saveEdit(row.id); if (e.key === "Escape") cancelEdit() }} />
                      : <span className="line-clamp-1" style={{ color: "#4B5563", fontSize: 12 }}>{row.ghiChu || "—"}</span>}
                  </td>
                  {/* Actions */}
                  <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>
                    {isEditing ? (
                      <div style={{ display: "flex", gap: 5 }}>
                        <button onClick={() => saveEdit(row.id)} style={{ background: "#1877F2", color: "#fff", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✓ Lưu</button>
                        <button onClick={cancelEdit} style={{ background: "#F3F4F6", color: "#6B7280", border: "none", borderRadius: 6, padding: "4px 8px", fontSize: 12, cursor: "pointer" }}>✕</button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        {row.link && (
                          <button onClick={() => onDangFB(row)} style={{ background: "#1877F2", color: "#fff", border: "none", borderRadius: 7, padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Đăng FB</button>
                        )}
                        <button onClick={e => { e.stopPropagation(); startEdit(row) }} title="Chỉnh sửa" style={{ background: "none", border: "1px solid #E5E7EB", borderRadius: 6, padding: "3px 7px", fontSize: 12, cursor: "pointer", color: "#6B7280" }}>✏️</button>
                        <div style={{ position: "relative" }} onClick={e => e.stopPropagation()}>
                          <button onClick={() => setDeleteConfirmId(deleteConfirmId === row.id ? null : row.id)} title="Xóa" style={{ background: "none", border: "1px solid #E5E7EB", borderRadius: 6, padding: "3px 7px", fontSize: 12, cursor: "pointer", color: "#EF4444" }}>🗑</button>
                          {deleteConfirmId === row.id && (
                            <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 500, background: "#FFF", border: "1px solid #FECACA", borderRadius: 10, boxShadow: "0 4px 16px rgba(0,0,0,0.10)", padding: "10px 14px", minWidth: 160, whiteSpace: "nowrap" }}>
                              <div style={{ color: "#111827", fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Xóa dòng này?</div>
                              <div style={{ display: "flex", gap: 6 }}>
                                <button onClick={() => deleteRow(row.id)} style={{ background: "#EF4444", color: "#fff", border: "none", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Xóa</button>
                                <button onClick={() => setDeleteConfirmId(null)} style={{ background: "#F3F4F6", color: "#6B7280", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer" }}>Hủy</button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
                )
              })}
              {filtered.length === 0 && !adding && (
                <tr><td colSpan={13} style={{ padding: "30px", textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>Chưa có dữ liệu</td></tr>
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
                  <td style={{ padding: "8px 12px" }}>
                    <select value={draft.nguoiLam} onChange={e => setDraft(p => ({ ...p, nguoiLam: e.target.value }))} style={cellInp}>
                      {mktUsers.length === 0 && <option value="">Đang tải…</option>}
                      {mktUsers.map(u => (
                        <option key={u.email} value={u.name}>{u.name}{u.mkt_code ? ` · ${u.mkt_code}` : ""}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: "8px 12px" }}><span style={{ color: "#D1D5DB", fontSize: 11 }}>—</span></td>
                  <td style={{ padding: "8px 12px" }}>
                    <select ref={spRef} value={draft.sp} onChange={e => setDraft(p => ({ ...p, sp: e.target.value }))} style={cellInp}>
                      {spList.length === 0 && <option value="">Đang tải…</option>}
                      {spList.map(s => <option key={s.name} value={s.name}>{s.name}{s.code ? ` [${s.code}]` : ""}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    <select value={draft.loaiVideo} onChange={e => setDraft(p => ({ ...p, loaiVideo: e.target.value }))} style={cellInp}>
                      {LOAI_LIST.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    <input value={draft.link} onChange={e => setDraft(p => ({ ...p, link: e.target.value }))} placeholder="Drive link…" style={cellInp} />
                  </td>
                  <td style={{ padding: "8px 12px" }}><span style={{ color: "#D1D5DB", fontSize: 11 }}>—</span></td>
                  <td style={{ padding: "8px 12px" }}>
                    <StatusPill status="Cần làm" />
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    <input value={draft.ghiChu} onChange={e => setDraft(p => ({ ...p, ghiChu: e.target.value }))} placeholder="Ghi chú (tuỳ chọn)…" style={cellInp} />
                  </td>
                  {/* Ad Name — tự sinh sau khi lưu */}
                  <td style={{ padding: "8px 12px" }}>
                    <span style={{ color: "#9CA3AF", fontSize: 11, fontStyle: "italic" }}>tự sinh…</span>
                  </td>
                  {/* Lời thoại */}
                  <td style={{ padding: "8px 12px" }}>
                    <span style={{ color: "#9CA3AF", fontSize: 11, fontStyle: "italic" }}>thêm sau…</span>
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
        {adding && <div style={{ padding: "6px 12px", borderTop: "1px solid #E5E7EB", background: "#F0F1F5" }}>
          <span style={{ color: "#93C5FD", fontSize: 11 }}>Enter để lưu · Esc để hủy</span>
        </div>}
      </div>

      {/* ── Popup: chọn deadline ── */}
      {deadlinePopup && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 8000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setDeadlinePopup(null)}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, width: 280, boxShadow: "0 8px 32px rgba(0,0,0,0.15)" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14, color: "#111827" }}>Đặt deadline — {deadlinePopup.row.vdCode}</div>
            <input type="date" defaultValue={deadlinePopup.row.deadline || ""}
              style={{ width: "100%", border: "1px solid #D1D5DB", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 12, boxSizing: "border-box" }}
              onChange={e => {}}
              id="deadline-input"
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => saveDeadline(deadlinePopup.row, null)} style={{ background: "#FEE2E2", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, color: "#DC2626", cursor: "pointer" }}>Xóa</button>
              <button onClick={() => setDeadlinePopup(null)} style={{ background: "#F3F4F6", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, cursor: "pointer" }}>Hủy</button>
              <button onClick={() => { const v = (document.getElementById("deadline-input") as HTMLInputElement)?.value; saveDeadline(deadlinePopup.row, v || null) }} style={{ background: "#1877F2", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 700, color: "#fff", cursor: "pointer" }}>Lưu</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Popup: đổi người làm (admin only) ── */}
      {makerPopup && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 8000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setMakerPopup(null)}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, width: 280, boxShadow: "0 8px 32px rgba(0,0,0,0.15)" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14, color: "#111827" }}>Đổi người làm — {makerPopup.row.vdCode}</div>
            <select id="maker-select" defaultValue={makerPopup.row.nguoiLam} style={{ width: "100%", border: "1px solid #D1D5DB", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 12, boxSizing: "border-box" }}>
              {mktUsers.map(u => <option key={u.email} value={u.name}>{u.name}</option>)}
            </select>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setMakerPopup(null)} style={{ background: "#F3F4F6", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, cursor: "pointer" }}>Hủy</button>
              <button onClick={() => { const v = (document.getElementById("maker-select") as HTMLSelectElement)?.value; saveMaker(makerPopup.row, v) }} style={{ background: "#1877F2", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 700, color: "#fff", cursor: "pointer" }}>Lưu</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: link bài đăng FB ── */}
      {fbLinkModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setFbLinkModal(null)}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 24, width: 420, maxWidth: "95vw", boxShadow: "0 8px 40px rgba(0,0,0,0.18)" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: "#111827" }}>Link bài đăng Facebook</span>
              <button onClick={() => setFbLinkModal(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#9CA3AF", fontSize: 18 }}>✕</button>
            </div>

            {/* Danh sách link đã lưu */}
            {(fbLinkModal.row.fbPostLinks || []).length > 0 && (
              <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                {(fbLinkModal.row.fbPostLinks || []).map((lnk, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, background: "#F0F6FF", borderRadius: 8, padding: "7px 10px" }}>
                    <span style={{ fontSize: 11, color: "#1D4ED8", fontWeight: 600, minWidth: 60, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lnk.page_name || "Page"}</span>
                    <a href={lnk.post_url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, fontSize: 11, color: "#1877F2", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lnk.post_url.replace("https://www.facebook.com/", "fb.com/")}</a>
                    <button onClick={() => removeFbLink(fbLinkModal.row, i)} style={{ background: "none", border: "none", cursor: "pointer", color: "#EF4444", fontSize: 14, flexShrink: 0 }} title="Xóa">✕</button>
                  </div>
                ))}
              </div>
            )}

            {/* Form thêm link mới */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input
                value={fbLinkDraft.page_name}
                onChange={e => setFbLinkDraft(p => ({ ...p, page_name: e.target.value }))}
                placeholder="Tên Page (vd: Phan Việt Official)"
                style={{ border: "1px solid #D1D5DB", borderRadius: 8, padding: "8px 12px", fontSize: 13, outline: "none" }}
              />
              <input
                value={fbLinkDraft.post_url}
                onChange={e => setFbLinkDraft(p => ({ ...p, post_url: e.target.value }))}
                placeholder="Link bài đăng Facebook..."
                style={{ border: "1px solid #D1D5DB", borderRadius: 8, padding: "8px 12px", fontSize: 13, outline: "none" }}
              />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
                <button onClick={() => setFbLinkModal(null)} style={{ background: "#F3F4F6", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer", color: "#4B5563" }}>Đóng</button>
                <button onClick={saveFbLink} disabled={!fbLinkDraft.post_url.trim()} style={{ background: fbLinkDraft.post_url.trim() ? "#1877F2" : "#93C5FD", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: fbLinkDraft.post_url.trim() ? "pointer" : "default", color: "#fff" }}>＋ Thêm link</button>
              </div>
            </div>
          </div>
        </div>
      )}
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

function TheoNguoiTab({ rows, isSuper, mktCode, mktUsers }: { rows: VideoRow[]; isSuper: boolean; mktCode: string | null; mktUsers: MktUser[] }) {
  const [showAll, setShowAll] = useState(isSuper || !mktCode)

  // Tên của user hiện tại (để match với maker trong DB)
  const myName = mktUsers.find(u => u.mkt_code === mktCode)?.name ?? null

  const usersToShow = showAll ? mktUsers : mktUsers.filter(u => u.mkt_code === mktCode)

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {mktCode && (
          <button onClick={() => setShowAll(false)} style={{ background: !showAll ? "#1877F2" : "#FFFFFF", color: !showAll ? "#fff" : "#4B5563", border: `1px solid ${!showAll ? "#1877F2" : "#E5E7EB"}`, borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            👤 Của tôi ({mktCode})
          </button>
        )}
        <button onClick={() => setShowAll(true)} style={{ background: showAll ? "#1877F2" : "#FFFFFF", color: showAll ? "#fff" : "#4B5563", border: `1px solid ${showAll ? "#1877F2" : "#E5E7EB"}`, borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          🌐 Xem tổng
        </button>
        {mktUsers.length === 0 && <span style={{ color: "#9CA3AF", fontSize: 12 }}>Đang tải…</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16 }}>
        {usersToShow.map(user => {
          // maker trong DB = name (first_name+last_name)
          const pRows = rows.filter(r => r.nguoiLam === user.name)
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
// Tab: Hướng dẫn — quy tắc đặt tên & upload link video
// ============================================================================
function HuongDanTab({ mktCode }: { mktCode: string | null }) {
  const code = mktCode || "MKT_CODE"
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "")
  const exAI   = `${code}_SP1_AI_${today}_v1.mp4`
  const exReal = `${code}_SP3_REAL_${today}_v1.mp4`
  const exV2   = `${code}_SP1_AI_${today}_v2.mp4`

  const s = {
    card:   { background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 14, padding: "20px 24px", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" } as React.CSSProperties,
    h:      { color: "#111827", fontWeight: 700, fontSize: 15, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 } as React.CSSProperties,
    label:  { color: "#6B7280", fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 6 },
    code:   { background: "#F0F6FF", border: "1px solid #BFDBFE", borderRadius: 7, padding: "8px 14px", fontFamily: "monospace", fontSize: 13, color: "#1654B8", display: "block", marginBottom: 6 } as React.CSSProperties,
    note:   { color: "#6B7280", fontSize: 12, marginTop: 4 } as React.CSSProperties,
    step:   { display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 14 } as React.CSSProperties,
    num:    { background: "#1877F2", color: "#fff", borderRadius: "50%", width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 } as React.CSSProperties,
    warn:   { background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: 10, padding: "12px 16px", display: "flex", gap: 10, alignItems: "flex-start" } as React.CSSProperties,
    ok:     { background: "#DCFCE7", border: "1px solid #BBF7D0", borderRadius: 10, padding: "12px 16px", display: "flex", gap: 10, alignItems: "flex-start" } as React.CSSProperties,
    tag:    (c: string, bg: string) => ({ background: bg, color: c, borderRadius: 5, padding: "2px 8px", fontSize: 11, fontWeight: 700, fontFamily: "monospace" }) as React.CSSProperties,
  }

  const SP_CODES = [
    ["SP1", "Hộp Inox 304"], ["SP2", "Chảo Titan"], ["SP3", "Nồi Chiên Không Dầu"],
    ["SP4", "Thùng Hạt"], ["SP5", "Máy Lọc Nước"], ["SP6", "Ấm Siêu Tốc"],
  ]
  const LOAI_CODES = [
    ["AI", "Video AI — dựng bằng AI, voiceover tự động"],
    ["REAL", "Real — quay thực tế, người thật"],
    ["REVIEW", "Review — đánh giá sản phẩm, unboxing"],
  ]

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 860 }}>

      {/* 1. Naming convention */}
      <div style={s.card}>
        <div style={s.h}>📝 Quy tắc đặt tên file video</div>

        <div style={s.label}>Format chuẩn</div>
        <div style={s.code}>[MKT_CODE]_[SP_CODE]_[LOAI]_[YYYYMMDD]_v[version].mp4</div>

        <div style={s.label}>Ví dụ thực tế (MKT code của bạn: <span style={{ color: "#1877F2", fontWeight: 700 }}>{code}</span>)</div>
        <div style={s.code}>{exAI}</div>
        <div style={s.code}>{exReal}</div>
        <div style={{ ...s.code, marginBottom: 0 }}>{exV2} <span style={{ color: "#9CA3AF", fontSize: 11 }}>← nếu render lại</span></div>

        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={s.label}>SP_CODE</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const }}>
            {SP_CODES.map(([code, name]) => (
              <div key={code} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={s.tag("#1654B8", "#EFF6FF")}>{code}</span>
                <span style={{ color: "#4B5563", fontSize: 12 }}>{name}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={s.label}>LOAI</div>
          <div style={{ display: "flex", flexDirection: "column" as const, gap: 5 }}>
            {LOAI_CODES.map(([code, desc]) => (
              <div key={code} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={s.tag("#059669", "#DCFCE7")}>{code}</span>
                <span style={{ color: "#4B5563", fontSize: 12 }}>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Cấu trúc folder Drive */}
      <div style={s.card}>
        <div style={s.h}>📁 Cấu trúc folder Google Drive</div>
        <div style={{ background: "#F8FAFC", border: "1px solid #E5E7EB", borderRadius: 10, padding: "14px 18px", fontFamily: "monospace", fontSize: 12, color: "#374151", lineHeight: 2 }}>
          <div>📁 <b>Phan Viet — Video MKT/</b></div>
          <div style={{ paddingLeft: 20 }}>📁 <b>2026-06/</b> <span style={{ color: "#9CA3AF" }}>(tháng hiện tại)</span></div>
          <div style={{ paddingLeft: 40 }}>📁 <b>SP1 - Hộp Inox 304/</b></div>
          <div style={{ paddingLeft: 60, color: "#1654B8" }}>{exAI}</div>
          <div style={{ paddingLeft: 40 }}>📁 <b>SP3 - Nồi Chiên Không Dầu/</b></div>
          <div style={{ paddingLeft: 60, color: "#1654B8" }}>{exReal}</div>
          <div style={{ paddingLeft: 20 }}>📁 <b>2026-07/</b></div>
          <div style={{ paddingLeft: 40, color: "#9CA3AF" }}>...</div>
        </div>
        <div style={{ ...s.note, marginTop: 10 }}>Upload đúng tháng và đúng SP folder — admin kiểm tra theo folder này khi duyệt.</div>
      </div>

      {/* 3. Quy trình lấy link */}
      <div style={s.card}>
        <div style={s.h}>🔗 Cách lấy link Drive để paste vào bảng</div>
        {[
          ["Upload file vào đúng folder Drive (xem cấu trúc trên)", ""],
          ["Chuột phải vào file → \"Chia sẻ\" → đổi quyền thành \"Bất kỳ ai có đường liên kết\"", "Nếu để chế độ riêng tư, admin/leader không xem được khi duyệt"],
          ["Chuột phải → \"Sao chép đường liên kết\" → paste vào cột Link trong bảng", ""],
          ["Đổi trạng thái sang \"Chờ duyệt\" để leader biết có video cần review", ""],
        ].map(([text, warn], i) => (
          <div key={i} style={s.step}>
            <div style={s.num}>{i + 1}</div>
            <div>
              <div style={{ color: "#111827", fontSize: 13 }}>{text}</div>
              {warn && <div style={{ color: "#D97706", fontSize: 12, marginTop: 3 }}>⚠️ {warn}</div>}
            </div>
          </div>
        ))}
      </div>

      {/* 4. Đúng / Sai */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div style={s.ok}>
          <span style={{ fontSize: 18 }}>✅</span>
          <div>
            <div style={{ color: "#15803D", fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Đúng</div>
            {[exAI, exReal, exV2].map(e => <div key={e} style={{ fontFamily: "monospace", fontSize: 11, color: "#166534", marginBottom: 4 }}>{e}</div>)}
          </div>
        </div>
        <div style={s.warn}>
          <span style={{ fontSize: 18 }}>❌</span>
          <div>
            <div style={{ color: "#92400E", fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Sai — dễ bị nhầm</div>
            {[
              ["video1.mp4", "thiếu code, không biết của ai"],
              [`sp1_${today}.mp4`, "thiếu MKT_CODE và LOAI"],
              ["Video AI hộp inox.mp4", "tên tiếng Việt, có dấu cách"],
              [`${code}_sp1_ai_${today}_v1.mp4`, "chữ thường — nên viết HOA"],
            ].map(([name, reason]) => (
              <div key={name} style={{ marginBottom: 6 }}>
                <div style={{ fontFamily: "monospace", fontSize: 11, color: "#92400E" }}>{name}</div>
                <div style={{ fontSize: 11, color: "#B45309" }}>→ {reason}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

    </div>
  )
}

// ============================================================================
// Page
// ============================================================================
export function VideoSection({ onDangFB }: { onDangFB: (row: VideoRow) => void }) {
  const [tab, setTab] = useState("bang")
  const [rows, setRows] = useState<VideoRow[]>([])
  const [mktUsers, setMktUsers] = useState<MktUser[]>([])
  const { isSuper, mktCode } = useCurrentPermissions()

  const reload = () => { apiJson(`/admin/marketing-video`).then(d => setRows(d.rows || [])).catch(() => {}) }
  useEffect(() => {
    reload()
    apiJson("/admin/permissions/mkt-users").then(d => setMktUsers(d.users || [])).catch(() => {})
  }, [])

  const tabs = [
    { id: "bang",      label: "Bảng" },
    { id: "kanban",    label: "Kanban" },
    { id: "theonguoi", label: "Theo người" },
    { id: "baocao",    label: "Báo cáo" },
    { id: "huongdan",  label: "📋 Hướng dẫn" },
  ]

  return (
    <div>
      <div style={{ display: "flex", borderBottom: "1px solid #E5E7EB", background: "#FFFFFF", paddingLeft: 20 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "11px 16px", color: tab === t.id ? "#1877F2" : "#4B5563", background: "none", border: "none", borderBottom: tab === t.id ? "2px solid #1877F2" : "2px solid transparent", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>{t.label}</button>
        ))}
      </div>
      <div style={{ padding: 20 }}>
        {tab === "bang"      && <BangTab rows={rows} reload={reload} onDangFB={onDangFB} isSuper={isSuper} mktCode={mktCode} mktUsers={mktUsers} />}
        {tab === "kanban"    && <KanbanTab rows={rows} reload={reload} />}
        {tab === "theonguoi" && <TheoNguoiTab rows={rows} isSuper={isSuper} mktCode={mktCode} mktUsers={mktUsers} />}
        {tab === "baocao"    && <BaoCaoTab />}
        {tab === "huongdan"  && <HuongDanTab mktCode={mktCode} />}
      </div>
    </div>
  )
}

export type { VideoRow }
