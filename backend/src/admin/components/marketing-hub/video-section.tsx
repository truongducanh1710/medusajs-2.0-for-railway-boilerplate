import React, { useEffect, useRef, useState } from "react"
import { apiFetch, apiJson } from "../../lib/api-client"
import { useCurrentPermissions } from "../../lib/use-permissions"
import { useResizableColumns, ResizeHandle, type ColumnDef } from "../../lib/resizable-columns"

const BANG_TAB_COLS = [
  { id: "sel",      label: "",            default: 36,  min: 36  },
  { id: "stt",      label: "#",           default: 36,  min: 36  },
  { id: "vd",       label: "VD",          default: 72,  min: 50  },
  { id: "ngay",     label: "Ngày",        default: 84,  min: 60  },
  { id: "nguon",    label: "Nguồn",       default: 64,  min: 50  },
  { id: "nguoilam", label: "Người làm",   default: 130, min: 80  },
  { id: "deadline", label: "Deadline",    default: 80,  min: 60  },
  { id: "sp",       label: "Sản phẩm",   default: 170, min: 100 },
  { id: "loai",     label: "Loại",        default: 84,  min: 60  },
  { id: "link",     label: "Link",        default: 64,  min: 50  },
  { id: "baifb",    label: "Bài FB",      default: 84,  min: 60  },
  { id: "trangthai",label: "Trạng thái",  default: 100, min: 80  },
  { id: "adname",   label: "Ad Name",     default: 180, min: 100 },
  { id: "loithoai", label: "Lời thoại",   default: 220, min: 100 },
  { id: "ghichu",   label: "Ghi chú",     default: 160, min: 80  },
  { id: "actions",  label: "",            default: 150, min: 100 },
] as const satisfies readonly ColumnDef[]

/** ISO "yyyy-mm-dd" hoặc "yyyy-mm-ddT..." → "dd/mm" hoặc "dd/mm/yyyy" */
function fmtDate(s: string | null | undefined, withYear = false): string {
  if (!s) return ""
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  const dd = String(d.getUTCDate()).padStart(2, "0")
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0")
  return withYear ? `${dd}/${mm}/${d.getUTCFullYear()}` : `${dd}/${mm}`
}

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
const PERSON_BADGE_COLORS = [
  { bg: "#DBEAFE", text: "#1D4ED8" },
  { bg: "#D1FAE5", text: "#065F46" },
  { bg: "#FDE68A", text: "#92400E" },
  { bg: "#EDE9FE", text: "#5B21B6" },
  { bg: "#FCE7F3", text: "#9D174D" },
  { bg: "#CFFAFE", text: "#155E75" },
  { bg: "#FEE2E2", text: "#991B1B" },
  { bg: "#D1FAE5", text: "#064E3B" },
]
function personBadgeColor(name: string): { bg: string; text: string } {
  if (!name) return { bg: "#F3F4F6", text: "#374151" }
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return PERSON_BADGE_COLORS[hash % PERSON_BADGE_COLORS.length]
}
const VT_COLORS: Record<string, string> = { "Video AI": "#1877F2", "Real": "#10B981", "Review": "#F59E0B" }

type FbPostLink = { page_id: string; page_name: string; post_url: string; posted_at: string }

type VideoRow = {
  id: string; vdCode: string; ngayDang: string; postDate?: string | null
  createdAt?: string; adName?: string; script?: string
  nguon: string; nguoiLam: string; sp: string; productCode?: string
  loaiVideo: string; link: string; trangThai: string; ghiChu: string; createdBy?: string
  fbPostLinks?: FbPostLink[]
  deadline?: string | null
  aiScore?: number | null
  aiReview?: any
  starred?: boolean
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
  const [editRowId, setEditRowId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set())
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; done: string[]; failed: string[] } | null>(null)
  const [linkCheckState, setLinkCheckState] = useState<{ checking: boolean; error: string | null; ok: boolean }>({ checking: false, error: null, ok: false })
  const [aiModal, setAiModal] = useState<{ row: VideoRow; result: any } | null>(null)
  const [aiModel, setAiModel] = useState<string>("gemini-3.1-pro-preview")
  const [detailRow, setDetailRow] = useState<VideoRow | null>(null)
  const defaultNguoi = "all"
  const [filters, setFilters] = useState({ nguoi: defaultNguoi, sp: "all", tts: "all", q: "", starOnly: false })
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
  const { colWidths, onResizeMouseDown, resetColWidths, totalWidth } = useResizableColumns("mkt-video-bang.col-widths.v1", BANG_TAB_COLS)

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

  const cancelAdd = () => { setAdding(false); setLinkCheckState({ checking: false, error: null, ok: false }) }

  const checkLink = async (link: string): Promise<boolean> => {
    if (!link || (!link.includes("drive.google") && !link.includes("drive.usercontent") && !link.includes("lark") && !link.includes("feishu"))) return true
    setLinkCheckState({ checking: true, error: null, ok: false })
    try {
      const r = await apiFetch(`/admin/marketing-video/check-link?url=${encodeURIComponent(link)}`).then(r => r.json())
      if (r.ok) {
        setLinkCheckState({ checking: false, error: null, ok: true })
        return true
      } else {
        setLinkCheckState({ checking: false, error: r.error || "Link không hợp lệ", ok: false })
        return false
      }
    } catch {
      setLinkCheckState({ checking: false, error: null, ok: false })
      return true // network fail → cho qua, không block
    }
  }

  const saveRow = async () => {
    if (saving) return
    if (draft.link) {
      const valid = await checkLink(draft.link)
      if (!valid) return
    }
    setSaving(true)
    try {
      const spEntry = spList.find(s => s.name.toLowerCase() === draft.sp.toLowerCase())
      const res = await apiJson(`/admin/marketing-video`, "POST", { ...draft, link: draft.link || "", trangThai: "Cần làm", productCode: spEntry?.code || "" })
      setAdding(false)
      setLinkCheckState({ checking: false, error: null, ok: false })
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

  const toggleStar = async (row: VideoRow, e: React.MouseEvent) => {
    e.stopPropagation()
    const newVal = !row.starred
    try {
      await apiJson(`/admin/marketing-video/${row.id}`, "PATCH", { starred: newVal })
      reload()
    } catch (err: any) { setToast("Lỗi: " + err.message) }
  }

  const analyzeVideo = async (row: VideoRow, model?: string) => {
    if (analyzingIds.has(row.id)) return
    if (row.aiReview && !model) { setAiModal({ row, result: row.aiReview }); return }
    setAnalyzingIds(prev => new Set(prev).add(row.id))
    setToast("Đang phân tích AI (~20-40s)...")
    try {
      const result = await apiJson(`/admin/marketing-video/${row.id}/analyze`, "POST", { model: model || aiModel })
      if (result?.ai_review) {
        const updatedScript = (!row.script && result.ai_review.loi_thoai) ? result.ai_review.loi_thoai : row.script
        setAiModal({ row: { ...row, aiScore: result.ai_score, aiReview: result.ai_review, script: updatedScript }, result: result.ai_review })
        reload()
      } else {
        setToast("Phân tích thất bại: " + (result?.error || "không có kết quả"))
      }
    } catch (e: any) { setToast("Lỗi phân tích: " + e.message) }
    finally { setAnalyzingIds(prev => { const n = new Set(prev); n.delete(row.id); return n }) }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    const ids = filtered.filter(r => r.link).map(r => r.id)
    if (ids.every(id => selectedIds.has(id))) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(ids))
    }
  }

  const batchAnalyze = async () => {
    const targets = filtered.filter(r => r.link && selectedIds.has(r.id))
    if (!targets.length) return
    if (!confirm(`Phân tích ${targets.length} video bằng AI? (~${targets.length * 35}s)`)) return
    setBatchProgress({ current: 0, total: targets.length, done: [], failed: [] })
    setSelectedIds(new Set())
    for (let i = 0; i < targets.length; i++) {
      const row = targets[i]
      setBatchProgress(p => p ? { ...p, current: i + 1 } : null)
      try {
        const result = await apiJson(`/admin/marketing-video/${row.id}/analyze`, "POST", { model: aiModel })
        if (result?.ai_review) {
          setBatchProgress(p => p ? { ...p, done: [...p.done, row.vdCode] } : null)
        } else {
          setBatchProgress(p => p ? { ...p, failed: [...p.failed, row.vdCode] } : null)
        }
      } catch {
        setBatchProgress(p => p ? { ...p, failed: [...p.failed, row.vdCode] } : null)
      }
      if (i < targets.length - 1) await new Promise(r => setTimeout(r, 2000))
    }
    reload()
    setTimeout(() => setBatchProgress(null), 5000)
  }

  const startEdit = (row: VideoRow) => {
    setEditRowId(row.id)
    setEditDraft({ nguoiLam: row.nguoiLam, sp: row.sp, loaiVideo: row.loaiVideo, link: row.link || "", ghiChu: row.ghiChu || "", postDate: row.postDate || "", adName: row.adName || "", script: row.script || "" })
    setDeleteConfirmId(null)
  }

  const cancelEdit = () => { setEditRowId(null); setEditDraft(null) }

  const saveEdit = async (id: string) => {
    if (!editDraft) return
    if (editDraft.link) {
      const valid = await checkLink(editDraft.link)
      if (!valid) return
    }
    try {
      const spEntry = spList.find(s => s.name.toLowerCase() === editDraft.sp.toLowerCase())
      const payload = { ...editDraft, ...(spEntry?.code ? { productCode: spEntry.code } : {}) }
      await apiJson(`/admin/marketing-video/${id}`, "PATCH", payload)
      setLinkCheckState({ checking: false, error: null, ok: false })
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
    if (filters.starOnly && !r.starred) return false
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
        <button
          onClick={() => setFilters(p => ({ ...p, starOnly: !p.starOnly }))}
          title="Chỉ hiện video win (★)"
          style={{ background: filters.starOnly ? "#FEF9C3" : "#F3F4F6", color: filters.starOnly ? "#92400E" : "#6B7280", border: `1px solid ${filters.starOnly ? "#FDE047" : "#E5E7EB"}`, borderRadius: 8, padding: "5px 12px", fontSize: 14, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
          ★ {filters.starOnly ? "Win" : "Win"}
        </button>
        {/* MKT user: toggle xem của mình / xem tổng */}
        {!isSuper && mktCode && (
          <button
            onClick={() => setFilters(p => ({ ...p, nguoi: p.nguoi === mktCode ? "all" : mktCode }))}
            style={{ background: filters.nguoi === mktCode ? "#EFF6FF" : "#F3F4F6", color: filters.nguoi === mktCode ? "#1877F2" : "#4B5563", border: `1px solid ${filters.nguoi === mktCode ? "#BFDBFE" : "#E5E7EB"}`, borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
            {filters.nguoi === mktCode ? `👤 Của tôi (${mktCode})` : "🌐 Xem tổng"}
          </button>
        )}
        <span style={{ color: "#9CA3AF", fontSize: 12, marginLeft: "auto" }}>{filtered.length} / {rows.length} dòng</span>
        {selectedIds.size > 0 && (
          <button
            onClick={batchAnalyze}
            disabled={!!batchProgress}
            style={{ background: "#7C3AED", color: "#fff", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", opacity: batchProgress ? 0.6 : 1 }}
          >
            🔍 Phân tích {selectedIds.size} video
          </button>
        )}
        <button onClick={resetColWidths} title="Reset độ rộng cột về mặc định" style={{ background: "none", border: "1px solid #E5E7EB", borderRadius: 6, padding: "5px 8px", fontSize: 11, color: "#9CA3AF", cursor: "pointer" }}>⇔</button>
        <select
          value={aiModel}
          onChange={e => setAiModel(e.target.value)}
          title="Model AI dùng để phân tích video"
          style={{ fontSize: 11, border: "1px solid #E5E7EB", borderRadius: 6, padding: "4px 6px", color: "#374151", background: "#F9FAFB", cursor: "pointer", maxWidth: 160 }}
        >
          <optgroup label="★ Chất lượng cao">
            <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro ($2/M)</option>
            <option value="gemini-3-pro-preview">Gemini 3 Pro</option>
            <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
          </optgroup>
          <optgroup label="⚡ Nhanh / Tiết kiệm">
            <option value="gemini-3.5-flash">Gemini 3.5 Flash ($1.5/M)</option>
            <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite ($0.25/M)</option>
            <option value="gemini-3-flash-preview">Gemini 3 Flash ($0.5/M)</option>
            <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
          </optgroup>
        </select>
        <button onClick={adding ? cancelAdd : openAdd} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: adding ? "#FEE2E2" : "#1877F2", border: adding ? "1px solid #FECACA" : "none", borderRadius: 6, cursor: "pointer", color: adding ? "#DC2626" : "#fff", fontSize: 12, fontWeight: 600, padding: "5px 12px", whiteSpace: "nowrap" }}>
          {adding ? "✕ Hủy" : "＋ Thêm dòng"}
        </button>
      </div>

      {batchProgress && (
        <div style={{ background: "#EDE9FE", border: "1px solid #DDD6FE", borderRadius: 10, padding: "10px 16px", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#5B21B6", marginBottom: 6 }}>
              Đang phân tích {batchProgress.current}/{batchProgress.total} video...
              {batchProgress.done.length > 0 && <span style={{ color: "#16A34A", marginLeft: 8 }}>✓ {batchProgress.done.join(", ")}</span>}
              {batchProgress.failed.length > 0 && <span style={{ color: "#DC2626", marginLeft: 8 }}>✗ {batchProgress.failed.join(", ")}</span>}
            </div>
            <div style={{ background: "#DDD6FE", borderRadius: 4, height: 6 }}>
              <div style={{ background: "#7C3AED", borderRadius: 4, height: 6, width: `${(batchProgress.current / batchProgress.total) * 100}%`, transition: "width 0.5s ease" }} />
            </div>
          </div>
        </div>
      )}

      <div style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.07),0 1px 2px rgba(0,0,0,0.04)", display: "flex", flexDirection: "column", minHeight: "calc(100vh - 280px)" }}>
        <div style={{ overflowX: "auto", flex: 1 }}>
          <table style={{ width: totalWidth, minWidth: totalWidth, borderCollapse: "collapse", tableLayout: "fixed", height: "100%" }}>
            <colgroup>
              {BANG_TAB_COLS.map(c => <col key={c.id} style={{ width: colWidths[c.id] }} />)}
            </colgroup>
            <thead>
              <tr style={{ background: "#F0F1F5" }}>
                {BANG_TAB_COLS.map(c => {
                  const stickyLeft: Record<string, number> = { sel: 0, stt: colWidths["sel"], vd: colWidths["sel"] + colWidths["stt"] }
                  const isLeftSticky = c.id in stickyLeft
                  const isRightSticky = c.id === "actions"
                  return (
                  <th key={c.id} style={{ position: isLeftSticky || isRightSticky ? "sticky" : "relative", left: isLeftSticky ? stickyLeft[c.id] : undefined, right: isRightSticky ? 0 : undefined, zIndex: isLeftSticky ? 11 : isRightSticky ? 10 : undefined, background: "#F0F1F5", borderLeft: isRightSticky ? "1px solid #E5E7EB" : undefined, borderRight: isLeftSticky && c.id === "vd" ? "1px solid #E5E7EB" : undefined, padding: "9px 12px", textAlign: "left", color: "#9CA3AF", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", borderBottom: "1px solid #E5E7EB", whiteSpace: "nowrap" }}>
                    {c.id === "sel" ? (
                      <input
                        type="checkbox"
                        title="Chọn tất cả"
                        style={{ cursor: "pointer", accentColor: "#7C3AED" }}
                        checked={filtered.filter(r => r.link).length > 0 && filtered.filter(r => r.link).every(r => selectedIds.has(r.id))}
                        onChange={toggleSelectAll}
                      />
                    ) : c.label}
                    {c.id !== "actions" && c.id !== "sel" && <ResizeHandle onMouseDown={onResizeMouseDown(c.id)} />}
                  </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {/* ── Inline quick-add row — hiện TRÊN CÙNG ── */}
              {adding && (
                <tr style={{ background: "#EFF6FF", borderBottom: "2px solid #93C5FD" }} onKeyDown={handleKeyDown}>
                  <td style={{ padding: "10px 12px", color: "#9CA3AF", fontSize: 12, textAlign: "center" }}>✦</td>
                  <td style={{ padding: "10px 12px", color: "#93C5FD", fontSize: 11, fontFamily: "monospace" }}>mới</td>
                  <td style={{ padding: "10px 12px", color: "#9CA3AF", fontSize: 12 }}>hôm nay</td>
                  <td style={{ padding: "10px 12px" }}>
                    <span style={{ background: "#DBEAFE", color: "#1e40af", fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 20 }}>Team</span>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <select value={draft.nguoiLam} onChange={e => setDraft(p => ({ ...p, nguoiLam: e.target.value }))} style={{ ...cellInp, fontSize: 13, padding: "6px 8px" }}>
                      {mktUsers.length === 0 && <option value="">Đang tải…</option>}
                      {mktUsers.map(u => (
                        <option key={u.email} value={u.name}>{u.name}{u.mkt_code ? ` · ${u.mkt_code}` : ""}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: "10px 12px" }}><span style={{ color: "#D1D5DB", fontSize: 11 }}>—</span></td>
                  <td style={{ padding: "10px 12px" }}><span style={{ color: "#D1D5DB", fontSize: 11 }}>—</span></td>
                  <td style={{ padding: "10px 12px" }}>
                    <select ref={spRef} value={draft.sp} onChange={e => setDraft(p => ({ ...p, sp: e.target.value }))} style={{ ...cellInp, fontSize: 13, padding: "6px 8px" }}>
                      {spList.length === 0 && <option value="">Đang tải…</option>}
                      {spList.map(s => <option key={s.name} value={s.name}>{s.name}{s.code ? ` [${s.code}]` : ""}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <select value={draft.loaiVideo} onChange={e => setDraft(p => ({ ...p, loaiVideo: e.target.value }))} style={{ ...cellInp, fontSize: 13, padding: "6px 8px" }}>
                      {LOAI_LIST.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <input
                        value={draft.link}
                        onChange={e => { setDraft(p => ({ ...p, link: e.target.value })); setLinkCheckState({ checking: false, error: null, ok: false }) }}
                        placeholder="Dán link Drive/Lark vào đây…"
                        style={{ ...cellInp, fontSize: 13, padding: "6px 8px", borderColor: linkCheckState.error ? "#FCA5A5" : linkCheckState.ok ? "#86EFAC" : undefined }}
                      />
                      {linkCheckState.checking && <span style={{ fontSize: 10, color: "#6B7280" }}>⏳ Đang kiểm tra link…</span>}
                      {linkCheckState.error && <span style={{ fontSize: 10, color: "#DC2626", fontWeight: 600 }}>⚠ {linkCheckState.error}</span>}
                      {linkCheckState.ok && <span style={{ fontSize: 10, color: "#16A34A", fontWeight: 600 }}>✓ Link hợp lệ</span>}
                    </div>
                  </td>
                  <td style={{ padding: "10px 12px" }}><span style={{ color: "#D1D5DB", fontSize: 11 }}>—</span></td>
                  <td style={{ padding: "10px 12px" }}>
                    <StatusPill status="Cần làm" />
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <span style={{ color: "#9CA3AF", fontSize: 11, fontStyle: "italic" }}>tự sinh…</span>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <span style={{ color: "#9CA3AF", fontSize: 11, fontStyle: "italic" }}>thêm sau…</span>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <input value={draft.ghiChu} onChange={e => setDraft(p => ({ ...p, ghiChu: e.target.value }))} placeholder="Ghi chú…" style={{ ...cellInp, fontSize: 13, padding: "6px 8px" }} />
                  </td>
                  <td style={{ position: "sticky", right: 0, background: "#EFF6FF", borderLeft: "1px solid #93C5FD", padding: "10px 12px", whiteSpace: "nowrap", zIndex: 5 }}>
                    <div style={{ display: "flex", gap: 5 }}>
                      <button onClick={saveRow} disabled={saving} style={{ background: saving ? "#93C5FD" : "#1877F2", color: "#fff", border: "none", borderRadius: 6, padding: "5px 14px", fontSize: 13, fontWeight: 700, cursor: saving ? "wait" : "pointer" }}>
                        {saving ? "…" : "✓ Lưu"}
                      </button>
                      <button onClick={cancelAdd} style={{ background: "#F3F4F6", color: "#6B7280", border: "none", borderRadius: 6, padding: "5px 10px", fontSize: 13, cursor: "pointer" }}>✕</button>
                    </div>
                  </td>
                </tr>
              )}
              {filtered.map((row, idx) => {
                const isEditing = editRowId === row.id
                const ed = editDraft!
                const rowBg = newRowId === row.id ? "#EFF6FF" : isEditing ? "#FAFBFF" : undefined
                return (
                <tr key={row.id} className={isEditing ? "" : "hover-bg"} onClick={!isEditing ? () => setDetailRow(row) : undefined} style={{ borderBottom: idx < filtered.length - 1 ? "1px solid #E5E7EB" : "none", transition: "background 0.4s", background: selectedIds.has(row.id) ? "#F5F3FF" : rowBg, outline: isEditing ? "2px solid #93C5FD" : selectedIds.has(row.id) ? "2px solid #DDD6FE" : "none", outlineOffset: -1, cursor: isEditing ? "default" : "pointer" }}>
                  <td onClick={e => { e.stopPropagation(); if (row.link) toggleSelect(row.id) }} className="sticky-left" style={{ position: "sticky", left: 0, zIndex: 4, background: selectedIds.has(row.id) ? "#F5F3FF" : rowBg || "#FFFFFF", padding: "9px 12px", textAlign: "center" }}>
                    {row.link && (
                      <input type="checkbox" checked={selectedIds.has(row.id)} onChange={() => toggleSelect(row.id)} onClick={e => e.stopPropagation()} style={{ cursor: "pointer", accentColor: "#7C3AED" }} />
                    )}
                  </td>
                  <td className="sticky-left" style={{ position: "sticky", left: colWidths["sel"], zIndex: 4, background: selectedIds.has(row.id) ? "#F5F3FF" : rowBg || "#FFFFFF", padding: "9px 12px", color: "#9CA3AF", fontSize: 12 }}>{idx + 1}</td>
                  <td className="sticky-left" style={{ position: "sticky", left: colWidths["sel"] + colWidths["stt"], zIndex: 4, background: selectedIds.has(row.id) ? "#F5F3FF" : rowBg || "#FFFFFF", borderRight: "1px solid #E5E7EB", padding: "9px 12px", color: "#1654B8", fontSize: 11, fontWeight: 700, fontFamily: "monospace" }}>{row.vdCode}</td>
                  {/* Ngày */}
                  {/* Ngày tạo — cố định, không cho sửa */}
                  <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>
                    <span style={{ color: "#4B5563", fontSize: 12 }}>{fmtDate(row.createdAt, true) || "—"}</span>
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
                      : (() => { const bc = personBadgeColor(row.nguoiLam); return (
                        <div onClick={isSuper ? () => setMakerPopup({ row }) : undefined} style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: isSuper ? "pointer" : "default", background: bc.bg, color: bc.text, borderRadius: 20, padding: "3px 10px 3px 4px", fontWeight: 600, fontSize: 12 }}>
                          <Avatar name={row.nguoiLam} size={20} />
                          <span>{row.nguoiLam}</span>
                          {isSuper && <span style={{ opacity: 0.5, fontSize: 10 }}>✎</span>}
                        </div>
                      )})()}
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
                      ? <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          <input
                            value={ed.link}
                            onChange={e => { setEditDraft(p => ({ ...p!, link: e.target.value })); setLinkCheckState({ checking: false, error: null, ok: false }) }}
                            placeholder="Drive link…"
                            style={{ ...cellInp, borderColor: linkCheckState.error ? "#FCA5A5" : linkCheckState.ok ? "#86EFAC" : undefined }}
                          />
                          {linkCheckState.checking && <span style={{ fontSize: 10, color: "#6B7280" }}>⏳ Đang kiểm tra link…</span>}
                          {linkCheckState.error && <span style={{ fontSize: 10, color: "#DC2626", fontWeight: 600 }}>⚠ {linkCheckState.error}</span>}
                          {linkCheckState.ok && <span style={{ fontSize: 10, color: "#16A34A", fontWeight: 600 }}>✓ Link hợp lệ</span>}
                        </div>
                      : row.link ? (() => {
                          const isLark = row.link.includes("larksuite") || row.link.includes("feishu") || row.link.includes("lark.suite")
                          return (
                            <a href={row.link} target="_blank" rel="noopener noreferrer"
                              style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 12, fontWeight: 500, textDecoration: "none",
                                color: isLark ? "#2E6FD8" : "#1877F2",
                                background: isLark ? "#EEF4FF" : "#EFF6FF",
                                border: `1px solid ${isLark ? "#BFDBFE" : "#DBEAFE"}`,
                                borderRadius: 6, padding: "2px 6px" }}>
                              {isLark ? "🪶" : "📁"} {isLark ? "Lark" : "Drive"}
                            </a>
                          )
                        })() : <span style={{ color: "#9CA3AF", fontSize: 12 }}>—</span>}
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
                  <td style={{ padding: "9px 12px" }} onClick={e => e.stopPropagation()}>
                    {(() => {
                      const v = STATUS_VARS[row.trangThai] || STATUS_VARS["Cần làm"]
                      return (
                        <select
                          value={row.trangThai}
                          onChange={e => updateStatus(row.id, e.target.value)}
                          style={{ color: v.c, background: v.bg, border: "none", borderRadius: 20, padding: "2px 8px", fontSize: 12, fontWeight: 500, cursor: "pointer", outline: "none", appearance: "auto" }}
                        >
                          {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      )
                    })()}
                  </td>
                  {/* Ad Name */}
                  <td style={{ padding: "9px 12px", maxWidth: 0 }}>
                    {isEditing
                      ? <input value={ed.adName} onChange={e => setEditDraft(p => ({ ...p!, adName: e.target.value }))} placeholder="Ad name…" style={cellInp} />
                      : <span
                          title={row.adName ? `Click để copy: ${row.adName}` : ""}
                          onClick={e => { e.stopPropagation(); if (row.adName) { navigator.clipboard.writeText(row.adName); setToast("Đã copy: " + row.adName) } }}
                          style={{ fontFamily: "monospace", fontSize: 11, color: "#1654B8", background: "#EFF6FF", borderRadius: 5, padding: "2px 6px", cursor: "copy", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        >{row.adName || "—"}</span>}
                  </td>
                  {/* Lời thoại */}
                  <td style={{ padding: "9px 12px", maxWidth: 0 }}>
                    {isEditing
                      ? <textarea value={ed.script} onChange={e => setEditDraft(p => ({ ...p!, script: e.target.value }))} placeholder="Lời thoại…" rows={2} style={{ ...cellInp, resize: "vertical", fontFamily: "inherit" }} />
                      : row.script
                        ? <span title={row.script} style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", color: "#374151", fontSize: 12, lineHeight: 1.5, cursor: "help" }}>{row.script}</span>
                        : <span style={{ color: "#DC2626", fontSize: 11, fontWeight: 600, background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 4, padding: "2px 6px", whiteSpace: "nowrap" }}>⚠ Chưa có lời thoại</span>}
                  </td>
                  {/* Ghi chú */}
                  <td style={{ padding: "9px 12px" }}>
                    {isEditing
                      ? <input value={ed.ghiChu} onChange={e => setEditDraft(p => ({ ...p!, ghiChu: e.target.value }))} placeholder="Ghi chú…" style={cellInp} onKeyDown={e => { if (e.key === "Enter") saveEdit(row.id); if (e.key === "Escape") cancelEdit() }} />
                      : <span className="line-clamp-1" style={{ color: "#4B5563", fontSize: 12 }}>{row.ghiChu || "—"}</span>}
                  </td>
                  {/* Actions */}
                  <td onClick={e => e.stopPropagation()} style={{ position: "sticky", right: 0, background: selectedIds.has(row.id) ? "#F5F3FF" : (newRowId === row.id ? "#EFF6FF" : isEditing ? "#FAFBFF" : "#FFFFFF"), borderLeft: "1px solid #E5E7EB", padding: "9px 12px", whiteSpace: "nowrap", zIndex: 5 }}>
                    {isEditing ? (
                      <div style={{ display: "flex", gap: 5 }}>
                        <button onClick={() => saveEdit(row.id)} style={{ background: "#1877F2", color: "#fff", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✓ Lưu</button>
                        <button onClick={cancelEdit} style={{ background: "#F3F4F6", color: "#6B7280", border: "none", borderRadius: 6, padding: "4px 8px", fontSize: 12, cursor: "pointer" }}>✕</button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <button
                          onClick={e => toggleStar(row, e)}
                          title={row.starred ? "Bỏ đánh dấu win" : "Đánh dấu video win"}
                          style={{ background: row.starred ? "#FEF9C3" : "none", color: row.starred ? "#92400E" : "#D1D5DB", border: `1px solid ${row.starred ? "#FDE047" : "#E5E7EB"}`, borderRadius: 6, padding: "3px 7px", fontSize: 13, fontWeight: 700, cursor: "pointer", lineHeight: 1 }}>
                          ★
                        </button>
                        {row.link && (
                          <button onClick={() => onDangFB(row)} style={{ background: "#1877F2", color: "#fff", border: "none", borderRadius: 7, padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Đăng FB</button>
                        )}
                        {/* Nút xem/phân tích AI — MKT chỉ xem nếu đã có kết quả, admin mới trigger phân tích */}
                        {(row.aiScore != null || isSuper) && row.link && (
                          <button
                            onClick={e => { e.stopPropagation(); if (isSuper || row.aiReview) analyzeVideo(row) }}
                            title={row.aiReview ? "Xem phân tích AI" : (isSuper ? "Phân tích video AI" : "")}
                            disabled={analyzingIds.has(row.id) || (!isSuper && !row.aiReview)}
                            style={{
                              background: row.aiScore != null ? (row.aiScore >= 8 ? "#DCFCE7" : row.aiScore >= 6 ? "#FEF9C3" : "#FEE2E2") : "none",
                              border: `1px solid ${row.aiScore != null ? (row.aiScore >= 8 ? "#86EFAC" : row.aiScore >= 6 ? "#FDE047" : "#FCA5A5") : "#E5E7EB"}`,
                              borderRadius: 6, padding: "3px 7px", fontSize: 12,
                              cursor: analyzingIds.has(row.id) ? "wait" : (row.aiReview || isSuper) ? "pointer" : "default",
                              color: row.aiScore != null ? (row.aiScore >= 8 ? "#166534" : row.aiScore >= 6 ? "#713F12" : "#991B1B") : "#6B7280",
                              fontWeight: row.aiScore != null ? 700 : 400,
                              minWidth: 36, textAlign: "center",
                            }}
                          >
                            {analyzingIds.has(row.id) ? "⏳" : row.aiScore != null ? `★${row.aiScore}` : "🔍"}
                          </button>
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
                <tr><td colSpan={15} style={{ padding: "30px", textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>Chưa có dữ liệu</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {adding && <div style={{ padding: "5px 14px", borderTop: "1px solid #E5E7EB", background: "#EFF6FF" }}>
          <span style={{ color: "#60A5FA", fontSize: 11 }}>Enter để lưu · Esc để hủy</span>
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

      {/* Detail popup */}
      {detailRow && (
        <div onClick={() => setDetailRow(null)} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: 560, maxWidth: "95vw", maxHeight: "85vh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #E5E7EB" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 15, color: "#1877F2" }}>{detailRow.vdCode}</span>
                <VideoTypeChip type={detailRow.loaiVideo} />
                <StatusPill status={detailRow.trangThai} />
              </div>
              <button onClick={() => setDetailRow(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#9CA3AF", lineHeight: 1 }}>✕</button>
            </div>
            {/* Body */}
            <div style={{ overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Row 1 */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 600, marginBottom: 3 }}>NGƯỜI LÀM</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{detailRow.nguoiLam}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 600, marginBottom: 3 }}>NGÀY ĐĂNG</div>
                  <div style={{ fontSize: 13 }}>{detailRow.ngayDang || "—"}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 600, marginBottom: 3 }}>SẢN PHẨM</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{detailRow.sp || "—"}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 600, marginBottom: 3 }}>DEADLINE</div>
                  <div style={{ fontSize: 13 }}><DeadlineChip deadline={detailRow.deadline} /></div>
                </div>
              </div>
              {/* AD NAME */}
              <div>
                <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 600, marginBottom: 4 }}>AD NAME</div>
                <div
                  onClick={() => { if (detailRow.adName) { navigator.clipboard.writeText(detailRow.adName); setToast("Đã copy: " + detailRow.adName) } }}
                  style={{ fontFamily: "monospace", fontSize: 13, color: "#1654B8", background: "#EFF6FF", borderRadius: 8, padding: "8px 12px", cursor: "copy", wordBreak: "break-all" }}
                >{detailRow.adName || "—"} <span style={{ fontSize: 10, color: "#93C5FD" }}>click để copy</span></div>
              </div>
              {/* Lời thoại */}
              <div>
                <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 600, marginBottom: 4 }}>LỜI THOẠI</div>
                {detailRow.script
                  ? <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.7, background: "#F9FAFB", borderRadius: 8, padding: "10px 12px", whiteSpace: "pre-wrap" }}>{detailRow.script}</div>
                  : <span style={{ color: "#DC2626", fontSize: 12, fontWeight: 600, background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 4, padding: "4px 8px" }}>⚠ Chưa có lời thoại</span>}
              </div>
              {/* Ghi chú */}
              {detailRow.ghiChu && (
                <div>
                  <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 600, marginBottom: 4 }}>GHI CHÚ</div>
                  <div style={{ fontSize: 13, color: "#4B5563", lineHeight: 1.6, background: "#F9FAFB", borderRadius: 8, padding: "8px 12px", whiteSpace: "pre-wrap" }}>{detailRow.ghiChu}</div>
                </div>
              )}
              {/* Link */}
              {detailRow.link && (
                <div>
                  <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 600, marginBottom: 4 }}>LINK VIDEO</div>
                  <a href={detailRow.link} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "#1877F2", wordBreak: "break-all" }}>{detailRow.link}</a>
                </div>
              )}
              {/* FB Posts */}
              {detailRow.fbPostLinks && detailRow.fbPostLinks.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 600, marginBottom: 4 }}>BÀI ĐĂNG FB</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {detailRow.fbPostLinks.map((l, i) => (
                      <a key={i} href={l.post_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#1877F2" }}>{l.page_name || l.post_url}</a>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {/* Footer */}
            <div style={{ padding: "12px 20px", borderTop: "1px solid #E5E7EB", display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => { setDetailRow(null); startEdit(detailRow) }} style={{ background: "#F3F4F6", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer", color: "#374151", fontWeight: 600 }}>✏️ Chỉnh sửa</button>
              <button onClick={() => { onDangFB(detailRow); setDetailRow(null) }} style={{ background: "#1877F2", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer", color: "#fff", fontWeight: 700 }}>Đăng FB</button>
            </div>
          </div>
        </div>
      )}
      {/* AI Review Modal */}
      {aiModal && <AiReviewModal row={aiModal.row} result={aiModal.result} aiModel={aiModel} isSuper={isSuper} onClose={() => setAiModal(null)} onReanalyze={isSuper ? (model) => { const r = aiModal.row; setAiModal(null); setAnalyzingId(r.id); setToast("Đang phân tích lại..."); apiJson(`/admin/marketing-video/${r.id}/analyze`, "POST", { model: model || aiModel }).then(result => { if (result?.ai_review) { const updatedScript = (!r.script && result.ai_review.loi_thoai) ? result.ai_review.loi_thoai : r.script; setAiModal({ row: { ...r, aiScore: result.ai_score, aiReview: result.ai_review, script: updatedScript }, result: result.ai_review }); reload() } else setToast("Phân tích thất bại") }).catch((e: any) => setToast("Lỗi: " + e.message)).finally(() => setAnalyzingId(null)) } : undefined} />}
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
                    <span style={{ color: "#9CA3AF", fontSize: 11 }}>{fmtDate(row.ngayDang)}</span>
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

  // Matrix ngày × người: rows = ngày (mới nhất trước), cols = người (theo tổng video giảm dần)
  const byPersonDay: { day: string; label: string; value: number }[] = data?.byPersonDay || []
  const dayPersons: string[] = (data?.byPerson || []).map((d: any) => d.label).filter(Boolean)
  const dayMatrix = (() => {
    const map = new Map<string, Record<string, number>>()
    for (const r of byPersonDay) {
      if (!map.has(r.day)) map.set(r.day, {})
      map.get(r.day)![r.label] = r.value
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  })()
  const personTotals: Record<string, number> = {}
  for (const r of byPersonDay) personTotals[r.label] = (personTotals[r.label] || 0) + r.value
  const matrixTotal = dayPersons.reduce((s, p) => s + (personTotals[p] || 0), 0)
  const fmtDay = (d: string) => {
    const dt = new Date(d + "T00:00:00")
    return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit" })
  }
  const thStyle: React.CSSProperties = { padding: "9px 12px", fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.04em", textAlign: "center", whiteSpace: "nowrap", borderBottom: "1px solid #E5E7EB" }
  const tdStyle: React.CSSProperties = { padding: "8px 12px", fontSize: 13, textAlign: "center", borderBottom: "1px solid #F3F4F6" }

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

      {/* Bảng số video theo ngày của từng người */}
      <div style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.07),0 1px 2px rgba(0,0,0,0.04)", overflow: "hidden" }}>
        <div style={{ padding: "16px 18px", borderBottom: "1px solid #E5E7EB", color: "#111827", fontWeight: 600, fontSize: 13 }}>
          📆 Số video theo ngày / người
        </div>
        {dayMatrix.length === 0 ? (
          <div style={{ color: "#9CA3AF", fontSize: 12, padding: "24px 0", textAlign: "center" }}>Chưa có dữ liệu</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr style={{ background: "#F9FAFB" }}>
                  <th style={{ ...thStyle, textAlign: "left", position: "sticky", left: 0, background: "#F9FAFB" }}>Ngày</th>
                  {dayPersons.map(p => {
                    const bc = personBadgeColor(p)
                    return (
                      <th key={p} style={thStyle}>
                        <span style={{ background: bc.bg, color: bc.text, borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 700, textTransform: "none", letterSpacing: 0 }}>{p}</span>
                      </th>
                    )
                  })}
                  <th style={thStyle}>Tổng</th>
                </tr>
              </thead>
              <tbody>
                {dayMatrix.map(([day, counts]) => {
                  const rowTotal = dayPersons.reduce((s, p) => s + (counts[p] || 0), 0)
                  return (
                    <tr key={day} className="hover-bg">
                      <td style={{ ...tdStyle, textAlign: "left", color: "#111827", fontWeight: 600, whiteSpace: "nowrap", position: "sticky", left: 0, background: "#FFFFFF" }}>{fmtDay(day)}</td>
                      {dayPersons.map(p => {
                        const v = counts[p] || 0
                        return <td key={p} style={{ ...tdStyle, color: v ? "#111827" : "#D1D5DB", fontWeight: v ? 600 : 400 }}>{v || "–"}</td>
                      })}
                      <td style={{ ...tdStyle, color: "#1877F2", fontWeight: 800 }}>{rowTotal}</td>
                    </tr>
                  )
                })}
                <tr style={{ background: "#F9FAFB" }}>
                  <td style={{ ...tdStyle, textAlign: "left", color: "#111827", fontWeight: 800, borderBottom: "none", position: "sticky", left: 0, background: "#F9FAFB" }}>Tổng</td>
                  {dayPersons.map(p => (
                    <td key={p} style={{ ...tdStyle, color: "#111827", fontWeight: 800, borderBottom: "none" }}>{personTotals[p] || 0}</td>
                  ))}
                  <td style={{ ...tdStyle, color: "#1877F2", fontWeight: 800, borderBottom: "none" }}>{matrixTotal}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
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
      <style>{`
        tr.hover-bg:hover td.sticky-left { background: #F9FAFB !important; }
        tr.hover-bg[style*="F5F3FF"]:hover td.sticky-left { background: #EDE9FE !important; }
      `}</style>
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

const AI_MODELS = [
  { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", tier: "pro" },
  { value: "gemini-3-pro-preview",   label: "Gemini 3 Pro",   tier: "pro" },
  { value: "gemini-2.5-pro",         label: "Gemini 2.5 Pro", tier: "pro" },
  { value: "gemini-3.5-flash",       label: "Gemini 3.5 Flash", tier: "flash" },
  { value: "gemini-3.1-flash-lite",  label: "Gemini 3.1 Flash Lite", tier: "flash" },
  { value: "gemini-3-flash-preview", label: "Gemini 3 Flash", tier: "flash" },
  { value: "gemini-2.5-flash",       label: "Gemini 2.5 Flash", tier: "flash" },
]

function AiReviewModal({ row, result, aiModel, isSuper, onClose, onReanalyze }: { row: VideoRow; result: any; aiModel?: string; isSuper?: boolean; onClose: () => void; onReanalyze?: (model?: string) => void }) {
  const [selectedModel, setSelectedModel] = React.useState(aiModel || "gemini-3.1-pro-preview")
  const score = result?.diem_ban_hang ?? row.aiScore
  const scoreColor = score >= 8 ? "#166534" : score >= 6 ? "#713F12" : "#991B1B"
  const scoreBg = score >= 8 ? "#DCFCE7" : score >= 6 ? "#FEF9C3" : "#FEE2E2"
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 9999, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 40, overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, width: "min(900px, 95vw)", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)", padding: 0 }}>
        {/* Header */}
        <div style={{ background: "#1877F2", color: "#fff", padding: "16px 20px", borderRadius: "14px 14px 0 0", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Phân tích AI — {row.sp}</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>{row.vdCode && <span style={{ fontFamily: "monospace", marginRight: 6 }}>{row.vdCode}</span>}{row.nguoiLam && <span style={{ marginRight: 6 }}>· {row.nguoiLam}</span>}{row.loaiVideo}</div>
          </div>
          {score != null && (
            <div style={{ background: scoreBg, color: scoreColor, borderRadius: 20, padding: "4px 14px", fontWeight: 800, fontSize: 18 }}>★ {score}</div>
          )}
          {onReanalyze && (
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)} style={{ fontSize: 11, borderRadius: 6, border: "1px solid rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.15)", color: "#fff", padding: "3px 6px", cursor: "pointer" }}>
                {AI_MODELS.map(m => <option key={m.value} value={m.value} style={{ color: "#111", background: "#fff" }}>{m.label}</option>)}
              </select>
              <button onClick={() => { onClose(); onReanalyze(selectedModel) }} style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.4)", color: "#fff", borderRadius: 8, padding: "4px 12px", fontSize: 12, cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}>🔄 Phân tích lại</button>
            </div>
          )}
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", borderRadius: 8, padding: "4px 10px", fontSize: 16, cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ padding: 20 }}>
          {/* Tổng quan */}
          {result?.tong_quan && (
            <div style={{ background: "#F8FAFC", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#6B7280", marginBottom: 4 }}>TỔNG QUAN</div>
              <div style={{ fontSize: 13, color: "#111827", lineHeight: 1.6 }}>{result.tong_quan}</div>
            </div>
          )}

          {/* Nhận xét quản lý */}
          {result?.nhan_xet_quanly && (
            <div style={{ background: "#1C1917", borderRadius: 10, padding: "14px 16px", marginBottom: 16, border: "1px solid #44403C" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#FCD34D", marginBottom: 6 }}>💼 NHẬN XÉT QUẢN LÝ ADS</div>
              <div style={{ fontSize: 13, color: "#E7E5E4", lineHeight: 1.8 }}>{result.nhan_xet_quanly}</div>
            </div>
          )}

          {/* Lời thoại đầy đủ */}
          {result?.loi_thoai && (
            <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#1D4ED8", marginBottom: 6 }}>🗣 LỜI THOẠI ĐẦY ĐỦ (TRANSCRIPT)</div>
              <div style={{ fontSize: 13, color: "#1e3a5f", lineHeight: 1.8, whiteSpace: "pre-wrap", fontStyle: "italic" }}>{result.loi_thoai}</div>
            </div>
          )}

          {/* Lỗi video */}
          {result?.loi_video?.length > 0 && (
            <div style={{ background: "#FFF1F2", border: "1px solid #FECDD3", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#BE123C", marginBottom: 6 }}>LỖI PHÁT HIỆN</div>
              {result.loi_video.map((l: string, i: number) => (
                <div key={i} style={{ fontSize: 13, color: "#9F1239", marginBottom: 3 }}>• {l}</div>
              ))}
            </div>
          )}

          {/* Điểm chi tiết theo rubric */}
          {result?.diem_chi_tiet && (
            <div style={{ background: "#F8FAFC", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#6B7280", marginBottom: 8 }}>ĐIỂM THEO TIÊU CHÍ</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[
                  { key: "hook", label: "🪝 Hook", max: 2 },
                  { key: "demo", label: "🛍 Demo", max: 3 },
                  { key: "loi_thoai", label: "🗣 Lời thoại", max: 2 },
                  { key: "cta", label: "📣 CTA", max: 1 },
                  { key: "chat_luong", label: "🎬 Chất lượng", max: 2 },
                ].map(({ key, label, max }) => {
                  const val = result.diem_chi_tiet[key]
                  if (val == null) return null
                  const pct = val / max
                  const c = pct >= 0.8 ? "#166534" : pct >= 0.5 ? "#713F12" : "#991B1B"
                  const bg = pct >= 0.8 ? "#DCFCE7" : pct >= 0.5 ? "#FEF9C3" : "#FEE2E2"
                  return <div key={key} style={{ background: bg, borderRadius: 8, padding: "6px 10px", textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "#6B7280", marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: c }}>{val}<span style={{ fontSize: 10, fontWeight: 400 }}>/{max}</span></div>
                  </div>
                })}
              </div>
            </div>
          )}

          {/* Bố cục */}
          {result?.phan_tich_bo_cuc && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#6B7280", marginBottom: 8 }}>BỐ CỤC NARRATIVE</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                {[
                  { key: "hook_manh", label: "Hook mạnh" },
                  { key: "co_pain_point", label: "Pain point" },
                  { key: "co_demo_ro", label: "Demo rõ" },
                  { key: "co_social_proof", label: "Social proof" },
                  { key: "cta_ro_rang", label: "CTA rõ" },
                ].map(({ key, label }) => (
                  <span key={key} style={{ fontSize: 11, borderRadius: 20, padding: "3px 10px", fontWeight: 600, background: result.phan_tich_bo_cuc[key] ? "#DCFCE7" : "#F3F4F6", color: result.phan_tich_bo_cuc[key] ? "#166534" : "#9CA3AF" }}>
                    {result.phan_tich_bo_cuc[key] ? "✓" : "✗"} {label}
                  </span>
                ))}
              </div>
              {result.phan_tich_bo_cuc.nhan_xet && <div style={{ fontSize: 12, color: "#4B5563", background: "#F9FAFB", borderRadius: 8, padding: "8px 12px" }}>{result.phan_tich_bo_cuc.nhan_xet}</div>}
            </div>
          )}

          {/* Điểm mạnh / lỗi */}
          {(result?.diem_manh?.length > 0 || result?.loi_video?.length > 0) && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
              {result?.diem_manh?.length > 0 && (
                <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#166534", marginBottom: 6 }}>✅ Điểm mạnh</div>
                  {result.diem_manh.map((d: string, i: number) => <div key={i} style={{ fontSize: 12, color: "#166534", marginBottom: 3 }}>• {d}</div>)}
                </div>
              )}
              {result?.loi_video?.length > 0 && (
                <div style={{ background: "#FFF1F2", border: "1px solid #FECDD3", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#BE123C", marginBottom: 6 }}>⚠ Lỗi phát hiện</div>
                  {result.loi_video.map((l: string, i: number) => <div key={i} style={{ fontSize: 12, color: "#9F1239", marginBottom: 3 }}>• {l}</div>)}
                </div>
              )}
            </div>
          )}

          {/* Từng cảnh */}
          {result?.tung_canh?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#6B7280", marginBottom: 8 }}>PHÂN TÍCH TỪNG CẢNH ({result.tung_canh.length} cảnh)</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {result.tung_canh.map((c: any, i: number) => (
                  <div key={i} style={{ border: `1px solid ${c.loi_ky_thuat ? "#FECDD3" : "#E5E7EB"}`, borderRadius: 8, padding: "10px 12px", background: c.loi_ky_thuat ? "#FFF8F8" : "#FAFAFA" }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                      <span style={{ background: "#1877F2", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 4, padding: "2px 6px" }}>#{c.stt || i + 1}</span>
                      <span style={{ fontSize: 11, color: "#6B7280" }}>{c.timestamp}</span>
                      {c.loai_canh && <span style={{ background: "#EFF6FF", color: "#1D4ED8", fontSize: 10, borderRadius: 4, padding: "2px 6px", fontWeight: 600 }}>{c.loai_canh}</span>}
                      {c.loi_ky_thuat && <span style={{ background: "#FEE2E2", color: "#991B1B", fontSize: 10, borderRadius: 4, padding: "2px 6px", fontWeight: 600 }}>⚠ {c.loi_ky_thuat}</span>}
                    </div>
                    {(c.loi_thoai_canh || c.phan_script) && <div style={{ fontSize: 12, color: "#1D4ED8", fontStyle: "italic", marginBottom: 4, lineHeight: 1.6, background: "#EFF6FF", borderRadius: 6, padding: "4px 8px" }}>"{c.loi_thoai_canh || c.phan_script}"</div>}
                    {c.mo_ta_hinh && <div style={{ fontSize: 12, color: "#374151", marginBottom: 2 }}>🎬 {c.mo_ta_hinh}</div>}
                    {c.text_overlay && <div style={{ fontSize: 12, color: "#7C3AED", marginBottom: 2 }}>📝 {c.text_overlay}</div>}
                    {c.am_thanh && <div style={{ fontSize: 12, color: "#0891B2", marginBottom: 2 }}>🔊 {c.am_thanh}</div>}
                    {(c.hieu_qua_ban_hang || c.hieu_qua || c.danh_gia) && <div style={{ fontSize: 11, color: "#059669", marginTop: 4, fontStyle: "italic" }}>→ {c.hieu_qua_ban_hang || c.hieu_qua || c.danh_gia}</div>}
                    {c.diem_yeu_canh && <div style={{ fontSize: 11, color: "#DC2626", marginTop: 3, background: "#FFF1F2", borderRadius: 4, padding: "3px 6px" }}>⚠ {c.diem_yeu_canh}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Âm thanh + visual + góc độ */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
            {result?.goc_do_trien_khai && (
              <div style={{ background: "#F8FAFC", borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7280", marginBottom: 4 }}>GÓC ĐỘ</div>
                <div style={{ fontSize: 12, color: "#374151" }}>{result.goc_do_trien_khai}</div>
              </div>
            )}
            {result?.danh_gia_visual && (
              <div style={{ background: "#F8FAFC", borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7280", marginBottom: 4 }}>VISUAL</div>
                <div style={{ fontSize: 12, color: "#374151" }}>{result.danh_gia_visual}</div>
              </div>
            )}
            {result?.am_thanh_tong_the && (
              <div style={{ background: "#F8FAFC", borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7280", marginBottom: 4 }}>ÂM THANH</div>
                <div style={{ fontSize: 12, color: "#374151" }}>{result.am_thanh_tong_the}</div>
              </div>
            )}
          </div>

          {/* Giải thích điểm theo từng tiêu chí */}
          {result?.ly_giai_diem && (
            <div style={{ background: "#F8FAFC", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#6B7280", marginBottom: 8 }}>📋 GIẢI THÍCH CHI TIẾT TỪNG ĐIỂM</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {[
                  { key: "hook", label: "🪝 Hook", score: result.diem_chi_tiet?.hook, max: 2 },
                  { key: "demo", label: "🛍 Demo", score: result.diem_chi_tiet?.demo, max: 3 },
                  { key: "loi_thoai", label: "🗣 Lời thoại", score: result.diem_chi_tiet?.loi_thoai, max: 2 },
                  { key: "cta", label: "📣 CTA", score: result.diem_chi_tiet?.cta, max: 1 },
                  { key: "chat_luong", label: "🎬 Chất lượng", score: result.diem_chi_tiet?.chat_luong, max: 2 },
                ].filter(({ key }) => result.ly_giai_diem[key]).map(({ key, label, score, max }) => (
                  <div key={key} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 10px", background: "#fff", borderRadius: 8, border: "1px solid #E5E7EB" }}>
                    <div style={{ minWidth: 80, display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 2 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#6B7280" }}>{label}</div>
                      {score != null && <div style={{ fontSize: 15, fontWeight: 800, color: score/max >= 0.8 ? "#166534" : score/max >= 0.5 ? "#713F12" : "#991B1B" }}>{score}/{max}</div>}
                    </div>
                    <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.7, flex: 1 }}>{result.ly_giai_diem[key]}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Phân tích tâm lý mua hàng */}
          {result?.phan_tich_tam_ly && (
            <div style={{ background: "#FAF5FF", border: "1px solid #E9D5FF", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#7C3AED", marginBottom: 8 }}>🧠 PHÂN TÍCH TÂM LÝ MUA HÀNG</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {result.phan_tich_tam_ly.trigger_chinh && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7280", marginBottom: 3 }}>TRIGGER CHÍNH</div>
                    <div style={{ fontSize: 12, background: "#7C3AED", color: "#fff", borderRadius: 20, padding: "3px 10px", display: "inline-block", fontWeight: 600 }}>{result.phan_tich_tam_ly.trigger_chinh}</div>
                  </div>
                )}
                {result.phan_tich_tam_ly.diem_thoat_du_doan && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7280", marginBottom: 3 }}>DỰ ĐOÁN ĐIỂM THOÁT</div>
                    <div style={{ fontSize: 12, color: "#DC2626", fontWeight: 600 }}>⚠ {result.phan_tich_tam_ly.diem_thoat_du_doan}</div>
                  </div>
                )}
                {result.phan_tich_tam_ly.trigger_hieu_qua && (
                  <div style={{ gridColumn: "1/-1" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7280", marginBottom: 3 }}>ĐANG HOẠT ĐỘNG TỐT</div>
                    <div style={{ fontSize: 12, color: "#166534" }}>✓ {result.phan_tich_tam_ly.trigger_hieu_qua}</div>
                  </div>
                )}
                {result.phan_tich_tam_ly.trigger_thieu && (
                  <div style={{ gridColumn: "1/-1" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7280", marginBottom: 3 }}>NÊN THÊM VÀO</div>
                    <div style={{ fontSize: 12, color: "#92400E" }}>+ {result.phan_tich_tam_ly.trigger_thieu}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* So sánh benchmark */}
          {result?.so_sanh_benchmark && (
            <div style={{ background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#0369A1", marginBottom: 6 }}>📊 SO SÁNH VỚI VIDEO CÙNG SP</div>
              <div style={{ fontSize: 13, color: "#0C4A6E", lineHeight: 1.7 }}>{result.so_sanh_benchmark}</div>
            </div>
          )}

          {/* Khuyến nghị */}
          {result?.khuyen_nghi?.length > 0 && (
            <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#1D4ED8", marginBottom: 6 }}>💡 KHUYẾN NGHỊ</div>
              {result.khuyen_nghi.map((k: string, i: number) => (
                <div key={i} style={{ fontSize: 13, color: "#1E40AF", marginBottom: 4 }}>• {k}</div>
              ))}
            </div>
          )}

          {/* Đề xuất viết lại */}
          {result?.viet_lai_de_xuat && (result.viet_lai_de_xuat.hook_moi || result.viet_lai_de_xuat.cta_moi || result.viet_lai_de_xuat.canh_nen_them) && (
            <div style={{ background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#065F46", marginBottom: 8 }}>✏️ ĐỀ XUẤT VIẾT LẠI</div>
              {result.viet_lai_de_xuat.hook_moi && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7280", marginBottom: 3 }}>HOOK MỚI (3s đầu)</div>
                  <div style={{ fontSize: 13, color: "#065F46", fontStyle: "italic", background: "#fff", borderRadius: 6, padding: "6px 10px", border: "1px solid #A7F3D0" }}>"{result.viet_lai_de_xuat.hook_moi}"</div>
                </div>
              )}
              {result.viet_lai_de_xuat.cta_moi && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7280", marginBottom: 3 }}>CTA MỚI</div>
                  <div style={{ fontSize: 13, color: "#065F46", fontStyle: "italic", background: "#fff", borderRadius: 6, padding: "6px 10px", border: "1px solid #A7F3D0" }}>"{result.viet_lai_de_xuat.cta_moi}"</div>
                </div>
              )}
              {result.viet_lai_de_xuat.canh_nen_them && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7280", marginBottom: 3 }}>CẢNH NÊN THÊM</div>
                  <div style={{ fontSize: 12, color: "#374151" }}>+ {result.viet_lai_de_xuat.canh_nen_them}</div>
                </div>
              )}
            </div>
          )}

          {/* Kết luận quản lý */}
          {result?.ket_luan_quanly && (
            <div style={{ background: "#1C1917", borderRadius: 10, padding: "14px 16px", border: "1px solid #44403C" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#FCD34D", marginBottom: 6 }}>🎯 KẾT LUẬN — CÓ NÊN CHẠY ADS KHÔNG?</div>
              <div style={{ fontSize: 13, color: "#E7E5E4", lineHeight: 1.8 }}>{result.ket_luan_quanly}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export type { VideoRow }
