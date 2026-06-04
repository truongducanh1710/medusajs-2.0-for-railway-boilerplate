import { useEffect, useState } from "react"
import { apiFetch, apiJson } from "../../lib/api-client"
import { useCurrentPermissions } from "../../lib/use-permissions"

export type FbPrefill = { videoId?: string; driveUrl?: string; sp?: string; vd?: string } | null

function Toast({ msg, onDone }: { msg: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 2800); return () => clearTimeout(t) }, [])
  return <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999, background: "#1877F2", color: "#fff", boxShadow: "0 4px 16px rgba(0,0,0,0.10),0 2px 4px rgba(0,0,0,0.05)", borderRadius: 12, padding: "12px 18px", fontSize: 13, fontWeight: 500 }}>✓ {msg}</div>
}

type Page = { page_id: string; page_name: string; fan_count: number; category: string | null }

function pageColor(id: string) {
  const colors = ["#1877F2", "#E84042", "#F59E0B", "#10B981", "#8B5CF6", "#EF4444", "#06B6D4", "#F97316", "#6366F1", "#EC4899", "#84CC16"]
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return colors[h % colors.length]
}

// ============================================================================
// Tab: Đăng bài
// ============================================================================
const DRAFT_KEY = "fb_dangbai_draft"

function DangBaiTab({ prefill }: { prefill: { videoId?: string; driveUrl?: string; sp?: string; vd?: string } | null }) {
  // Khôi phục draft từ localStorage nếu không có prefill
  const savedDraft = (() => { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null") } catch { return null } })()
  const [content, setContent] = useState(prefill?.sp ? `Video: ${prefill.sp}\n` : (savedDraft?.content || ""))
  const [driveLink, setDriveLink] = useState(prefill?.driveUrl || savedDraft?.driveLink || "")
  const [postType, setPostType] = useState<"text" | "video" | "anh">(savedDraft?.postType || "video")
  const [schedule, setSchedule] = useState<"now" | "schedule">("now")
  const [schedTime, setSchedTime] = useState("2026-06-05T09:00")
  const [pages, setPages] = useState<Page[]>([])
  const [selPages, setSelPages] = useState<Set<string>>(new Set())
  const [pageQ, setPageQ] = useState("")
  const [posting, setPosting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [results, setResults] = useState<any[]>([])
  const [showSim, setShowSim] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [hasDraft, setHasDraft] = useState(!!savedDraft && !prefill)

  // Autosave draft vào localStorage khi content/driveLink/postType thay đổi
  useEffect(() => {
    if (posting) return
    if (!content && !driveLink) { localStorage.removeItem(DRAFT_KEY); return }
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ content, driveLink, postType }))
  }, [content, driveLink, postType, posting])

  // Warn khi thoát trang nếu có nội dung chưa đăng
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if ((content || driveLink) && !posting) {
        e.preventDefault()
        e.returnValue = "Bạn có nội dung chưa đăng. Rời trang?"
      }
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [content, driveLink, posting])

  const clearDraft = () => { localStorage.removeItem(DRAFT_KEY); setHasDraft(false) }

  useEffect(() => {
    apiJson("/admin/fb-content").then(d => {
      if (d.error === "FB_TOKEN_EXPIRED") setToast("Token FB hết hạn — liên hệ admin cập nhật FB_USER_TOKEN")
      setPages(d.pages || [])
    }).catch(() => {})
  }, [])

  const filteredPages = pages.filter(p => p.page_name.toLowerCase().includes(pageQ.toLowerCase()))
  const togglePage = (id: string) => setSelPages(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const selectAll = () => setSelPages(selPages.size === filteredPages.length ? new Set() : new Set(filteredPages.map(p => p.page_id)))

  const pollJob = (jobId: string) => {
    const iv = setInterval(async () => {
      try {
        const d = await apiJson(`/admin/fb-content/post/status?jobId=${jobId}`)
        setProgress({ done: d.done, total: d.total })
        setResults(d.progress || [])
        if (d.status !== "running") {
          clearInterval(iv); setPosting(false)
          const ok = (d.progress || []).filter((p: any) => p.status === "success").length
          setToast(`Hoàn thành: ${ok}/${d.total} trang thành công`)
        }
      } catch { clearInterval(iv); setPosting(false) }
    }, 2000)
  }

  const handlePost = async () => {
    if (!selPages.size) return
    setPosting(true); setShowSim(true); setResults([]); setProgress({ done: 0, total: selPages.size })
    try {
      const body: any = {
        page_ids: [...selPages], message: content,
        drive_url: driveLink, media_type: postType === "anh" ? "photo" : postType,
        video_id: prefill?.videoId,
      }
      if (schedule === "schedule") body.scheduled_for = new Date(schedTime).toISOString()
      const d = await apiJson("/admin/fb-content/post", "POST", body)
      if (d?.jobId) { clearDraft(); pollJob(d.jobId) }
      else { setPosting(false); setToast("Lỗi: không tạo được job") }
    } catch (e: any) { setPosting(false); setToast("Lỗi: " + e.message) }
  }

  const inpCls: React.CSSProperties = { background: "#F0F1F5", color: "#111827", border: "1px solid #E5E7EB", borderRadius: 9, padding: "9px 12px", fontSize: 13, outline: "none", width: "100%" }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {toast && <Toast msg={toast} onDone={() => setToast(null)} />}
      {hasDraft && (
        <div style={{ background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: 10, padding: "10px 16px", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 16 }}>📝</span>
          <span style={{ color: "#92400E", fontSize: 13, flex: 1 }}>Đã khôi phục bản nháp từ lần trước. Kiểm tra lại nội dung trước khi đăng.</span>
          <button onClick={clearDraft} style={{ background: "none", border: "1px solid #FDE68A", borderRadius: 6, padding: "3px 10px", fontSize: 12, color: "#92400E", cursor: "pointer" }}>Xóa nháp</button>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 16 }}>
        {/* LEFT */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 14, padding: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.07),0 1px 2px rgba(0,0,0,0.04)" }}>
            <div style={{ color: "#4B5563", fontSize: 12, fontWeight: 600, marginBottom: 8 }}>NỘI DUNG BÀI ĐĂNG</div>
            <textarea value={content} onChange={e => setContent(e.target.value)} rows={6} placeholder="Nhập nội dung bài đăng…" style={{ ...inpCls, resize: "vertical", fontFamily: "inherit", lineHeight: 1.6 }} />
            <div style={{ color: "#9CA3AF", fontSize: 11, textAlign: "right", marginTop: 4 }}>{content.length} ký tự</div>
          </div>
          <div style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 14, padding: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.07),0 1px 2px rgba(0,0,0,0.04)" }}>
            <div style={{ color: "#4B5563", fontSize: 12, fontWeight: 600, marginBottom: 8 }}>LINK GOOGLE DRIVE</div>
            <input value={driveLink} onChange={e => setDriveLink(e.target.value)} placeholder="https://drive.google.com/file/…" style={inpCls} />
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, padding: "7px 10px", background: "#FEF3C7", border: "1px solid #F59E0B40", borderRadius: 8 }}>
              <span>⚠️</span><span style={{ color: "#92400E", fontSize: 12 }}>File phải để chế độ <b>"Anyone with the link"</b> mới đăng được</span>
            </div>
          </div>
          <div style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 14, padding: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.07),0 1px 2px rgba(0,0,0,0.04)" }}>
            <div style={{ color: "#4B5563", fontSize: 12, fontWeight: 600, marginBottom: 10 }}>LOẠI NỘI DUNG</div>
            <div style={{ display: "flex", gap: 6 }}>
              {([["text", "Văn bản"], ["video", "Video"], ["anh", "Ảnh"]] as const).map(([v, l]) => (
                <button key={v} onClick={() => setPostType(v)} style={{ flex: 1, padding: "8px 0", background: postType === v ? "#1877F2" : "#F0F1F5", color: postType === v ? "#fff" : "#4B5563", border: `1px solid ${postType === v ? "#1877F2" : "#E5E7EB"}`, borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{l}</button>
              ))}
            </div>
          </div>
          <div style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 14, padding: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.07),0 1px 2px rgba(0,0,0,0.04)" }}>
            <div style={{ color: "#4B5563", fontSize: 12, fontWeight: 600, marginBottom: 10 }}>THỜI GIAN ĐĂNG</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              {([["now", "Đăng ngay"], ["schedule", "Lên lịch"]] as const).map(([v, l]) => (
                <button key={v} onClick={() => setSchedule(v)} style={{ flex: 1, padding: "8px 0", background: schedule === v ? "#1877F2" : "#F0F1F5", color: schedule === v ? "#fff" : "#4B5563", border: `1px solid ${schedule === v ? "#1877F2" : "#E5E7EB"}`, borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{l}</button>
              ))}
            </div>
            {schedule === "schedule" && <input type="datetime-local" value={schedTime} onChange={e => setSchedTime(e.target.value)} style={{ ...inpCls, width: "auto" }} />}
          </div>
        </div>
        {/* RIGHT */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.07),0 1px 2px rgba(0,0,0,0.04)", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid #E5E7EB" }}>
            <div style={{ color: "#4B5563", fontSize: 12, fontWeight: 600, marginBottom: 10 }}>CHỌN TRANG ĐĂNG ({pages.length} trang)</div>
            <input value={pageQ} onChange={e => setPageQ(e.target.value)} placeholder="Tìm trang…" style={{ width: "100%", background: "#F0F1F5", border: "1px solid #E5E7EB", borderRadius: 9, padding: "7px 12px", fontSize: 12, color: "#111827", outline: "none", marginBottom: 10 }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <button onClick={selectAll} style={{ color: "#1877F2", background: "none", border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                {selPages.size === filteredPages.length && filteredPages.length > 0 ? "Bỏ chọn tất cả" : `Chọn tất cả (${filteredPages.length})`}
              </button>
              {selPages.size > 0 && <span style={{ background: "#1877F2", color: "#fff", borderRadius: 20, padding: "2px 10px", fontSize: 12, fontWeight: 700 }}>{selPages.size} trang</span>}
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", maxHeight: 400 }}>
            {filteredPages.map(p => (
              <label key={p.page_id} className="hover-bg" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", cursor: "pointer", borderBottom: "1px solid #E5E7EB" }}>
                <input type="checkbox" checked={selPages.has(p.page_id)} onChange={() => togglePage(p.page_id)} style={{ accentColor: "#1877F2", width: 15, height: 15, flexShrink: 0 }} />
                <div style={{ width: 34, height: 34, borderRadius: "50%", background: pageColor(p.page_id), flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, fontWeight: 700 }}>{p.page_name.slice(0, 2).toUpperCase()}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="line-clamp-1" style={{ color: "#111827", fontSize: 13, fontWeight: 500 }}>{p.page_name}</div>
                  <div style={{ color: "#9CA3AF", fontSize: 11 }}>{(p.fan_count || 0).toLocaleString("vi-VN")} người theo dõi</div>
                </div>
              </label>
            ))}
            {filteredPages.length === 0 && <div style={{ padding: 30, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>Không có trang nào</div>}
          </div>
        </div>
      </div>

      <div style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 14, padding: "16px 18px", boxShadow: "0 1px 3px rgba(0,0,0,0.07),0 1px 2px rgba(0,0,0,0.04)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={handlePost} disabled={!selPages.size || posting} style={{ background: selPages.size > 0 ? "#1877F2" : "#E5E7EB", color: selPages.size > 0 ? "#fff" : "#9CA3AF", border: "none", borderRadius: 10, padding: "11px 24px", fontSize: 14, fontWeight: 700, cursor: selPages.size > 0 ? "pointer" : "default", opacity: posting ? 0.7 : 1 }}>
            {posting ? "Đang đăng…" : `Đăng ${selPages.size > 0 ? selPages.size : ""} trang`}
          </button>
          {selPages.size === 0 && <span style={{ color: "#9CA3AF", fontSize: 13 }}>Vui lòng chọn ít nhất 1 trang</span>}
        </div>
        {showSim && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ color: "#4B5563", fontSize: 13 }}>{posting ? "Đang đăng…" : "Hoàn thành"}</span>
              <span style={{ color: "#1877F2", fontSize: 13, fontWeight: 700 }}>{progress.done}/{progress.total}</span>
            </div>
            <div style={{ background: "#E5E7EB", borderRadius: 6, height: 6, overflow: "hidden", marginBottom: 14 }}>
              <div style={{ height: "100%", background: "#1877F2", width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`, transition: "width 0.5s ease", borderRadius: 6 }} />
            </div>
            {results.length > 0 && (
              <div style={{ border: "1px solid #E5E7EB", borderRadius: 10, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr style={{ background: "#F0F1F5" }}>{["Trang", "Trạng thái", "Post ID", "Lỗi"].map((h, i) => <th key={i} style={{ padding: "8px 12px", textAlign: "left", color: "#9CA3AF", fontSize: 10, fontWeight: 700, textTransform: "uppercase", borderBottom: "1px solid #E5E7EB" }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {results.map((r, i) => (
                      <tr key={i} style={{ borderBottom: i < results.length - 1 ? "1px solid #E5E7EB" : "none" }}>
                        <td style={{ padding: "8px 12px", color: "#111827", fontSize: 13 }}>{r.page_name}</td>
                        <td style={{ padding: "8px 12px" }}><span style={{ background: r.status === "success" ? "#D1FAE5" : "#FEE2E2", color: r.status === "success" ? "#059669" : "#DC2626", padding: "2px 8px", borderRadius: 20, fontSize: 12, fontWeight: 600 }}>{r.status === "success" ? "Thành công" : "Lỗi"}</span></td>
                        <td style={{ padding: "8px 12px", color: "#9CA3AF", fontSize: 11, fontFamily: "monospace" }}>{r.post_id || "—"}</td>
                        <td style={{ padding: "8px 12px", color: "#DC2626", fontSize: 12 }}>{r.error || ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Tab: Lịch đăng — lịch sử tất cả bài đã đăng + lên lịch
// ============================================================================
const STATUS_POST: Record<string, { label: string; c: string; bg: string }> = {
  success:   { label: "Đã đăng",   c: "#059669", bg: "#DCFCE7" },
  scheduled: { label: "Lên lịch",  c: "#D97706", bg: "#FEF3C7" },
  failed:    { label: "Lỗi",       c: "#DC2626", bg: "#FEE2E2" },
  pending:   { label: "Chờ",       c: "#6B7280", bg: "#F3F4F6" },
}
const MEDIA_ICON: Record<string, string> = { video: "🎬", photo: "🖼️", text: "📝" }

function LichDangTab() {
  const [posts, setPosts] = useState<any[]>([])
  const [filterStatus, setFilterStatus] = useState("all")
  const [filterFrom, setFilterFrom] = useState("")
  const [filterTo, setFilterTo]   = useState("")
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    const params = new URLSearchParams({ posts: "1" })
    if (filterStatus !== "all") params.set("status", filterStatus)
    if (filterFrom) params.set("from", filterFrom)
    if (filterTo)   params.set("to",   filterTo)
    apiJson(`/admin/fb-content?${params}`)
      .then(d => setPosts(d.posts || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [filterStatus, filterFrom, filterTo])

  const inp: React.CSSProperties = { background: "#FFFFFF", color: "#111827", border: "1px solid #E5E7EB", borderRadius: 8, padding: "6px 10px", fontSize: 12, outline: "none" }

  // Group theo ngày
  const grouped: Record<string, any[]> = {}
  for (const p of posts) {
    const d = new Date(p.created_at || p.scheduled_for || Date.now())
    const key = d.toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" })
    ;(grouped[key] = grouped[key] || []).push(p)
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Filter bar */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={inp}>
          <option value="all">Tất cả trạng thái</option>
          <option value="success">Đã đăng</option>
          <option value="scheduled">Lên lịch</option>
          <option value="failed">Lỗi</option>
        </select>
        <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} style={inp} placeholder="Từ ngày" />
        <span style={{ color: "#9CA3AF" }}>→</span>
        <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} style={inp} placeholder="Đến ngày" />
        <span style={{ color: "#9CA3AF", fontSize: 12, marginLeft: "auto" }}>{posts.length} bài</span>
      </div>

      {loading && <div style={{ padding: 30, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>Đang tải…</div>}

      {!loading && posts.length === 0 && (
        <div style={{ padding: 40, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>Chưa có bài nào</div>
      )}

      {/* Group theo ngày */}
      {Object.entries(grouped).map(([day, dayPosts]) => (
        <div key={day}>
          <div style={{ color: "#6B7280", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>{day}</div>
          <div style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
            {dayPosts.map((p, i) => {
              const st = STATUS_POST[p.status] || STATUS_POST.pending
              const time = new Date(p.created_at || p.scheduled_for).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
              const mediaIcon = MEDIA_ICON[p.media_type] || "📝"
              return (
                <div key={p.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 16px", borderBottom: i < dayPosts.length - 1 ? "1px solid #F3F4F6" : "none" }}>
                  {/* Time + status */}
                  <div style={{ minWidth: 70, textAlign: "center", paddingTop: 2 }}>
                    <div style={{ color: "#374151", fontSize: 12, fontWeight: 600 }}>{time}</div>
                    <span style={{ background: st.bg, color: st.c, borderRadius: 20, padding: "1px 7px", fontSize: 10, fontWeight: 700 }}>{st.label}</span>
                  </div>
                  {/* Icon loại */}
                  <div style={{ fontSize: 20, paddingTop: 2 }}>{mediaIcon}</div>
                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ color: "#111827", fontSize: 13, fontWeight: 600 }}>{p.page_name || "—"}</span>
                      {p.post_id && (
                        <a href={p.media_type === "video" ? `https://www.facebook.com/reel/${p.post_id}/` : `https://www.facebook.com/${p.post_id}`} target="_blank" rel="noopener noreferrer"
                          style={{ color: "#1877F2", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>↗ Xem bài</a>
                      )}
                    </div>
                    <div className="line-clamp-2" style={{ color: "#4B5563", fontSize: 12, lineHeight: 1.5 }}>{p.message || "—"}</div>
                    {p.error_msg && <div style={{ color: "#DC2626", fontSize: 11, marginTop: 4 }}>⚠️ {p.error_msg}</div>}
                    {p.created_by && <div style={{ color: "#9CA3AF", fontSize: 11, marginTop: 4 }}>by {p.created_by}</div>}
                  </div>
                  {/* Drive link nếu có */}
                  {p.drive_url && (
                    <a href={p.drive_url} target="_blank" rel="noopener noreferrer"
                      style={{ color: "#6B7280", fontSize: 11, textDecoration: "none", paddingTop: 2, whiteSpace: "nowrap" }}>📁 Drive</a>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ============================================================================
// Tab: Viral Tracker
// ============================================================================
function ViralTrackerTab() {
  const [dateFrom, setDateFrom] = useState("2026-05-27")
  const [dateTo, setDateTo] = useState("2026-06-03")
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const load = () => {
    setLoading(true)
    apiJson(`/admin/fb-content/insights?from=${dateFrom}&to=${dateTo}`).then(d => { setData(d); setLoading(false) }).catch(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const medals = ["🥇", "🥈", "🥉"]
  const kpis = data?.kpis
  const posts = data?.posts || []
  const inpSt: React.CSSProperties = { background: "#FFFFFF", color: "#111827", border: "1px solid #E5E7EB", borderRadius: 8, padding: "6px 10px", fontSize: 12, outline: "none" }
  const fmt = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1) + "K" : String(n))

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ color: "#9CA3AF" }}>📅</span>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inpSt} />
        <span style={{ color: "#9CA3AF" }}>→</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inpSt} />
        <button onClick={load} style={{ background: "#1877F2", color: "#fff", border: "none", borderRadius: 8, padding: "6px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{loading ? "Đang tải…" : "Tải dữ liệu"}</button>
      </div>
      {data?.error === "FB_TOKEN_EXPIRED" && <div style={{ background: "#FEE2E2", color: "#991B1B", padding: "10px 14px", borderRadius: 10, fontSize: 13 }}>Token FB hết hạn — liên hệ admin cập nhật FB_USER_TOKEN</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {[["Tổng bài", kpis?.totalPosts], ["Cảm xúc", kpis ? fmt(kpis.reactions) : "—"], ["Bình luận", kpis ? fmt(kpis.comments) : "—"], ["Chia sẻ", kpis ? fmt(kpis.shares) : "—"]].map(([label, val]) => (
          <div key={String(label)} style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 14, padding: "16px 18px", boxShadow: "0 1px 3px rgba(0,0,0,0.07),0 1px 2px rgba(0,0,0,0.04)" }}>
            <span style={{ color: "#9CA3AF", fontSize: 12, fontWeight: 500 }}>{label}</span>
            <div style={{ color: "#111827", fontWeight: 800, fontSize: 28, marginTop: 6 }}>{val ?? "—"}</div>
          </div>
        ))}
      </div>
      <div style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.07),0 1px 2px rgba(0,0,0,0.04)" }}>
        <div style={{ padding: "13px 18px", borderBottom: "1px solid #E5E7EB", color: "#111827", fontWeight: 600, fontSize: 14 }}>Top bài viral</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 680, borderCollapse: "collapse" }}>
            <thead><tr style={{ background: "#F0F1F5" }}>{["#", "Trang", "Nội dung", "❤️", "💬", "↗️", "Điểm"].map((h, i) => <th key={i} style={{ padding: "9px 14px", textAlign: i > 2 ? "center" : "left", color: "#9CA3AF", fontSize: 10, fontWeight: 700, textTransform: "uppercase", borderBottom: "1px solid #E5E7EB", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
            <tbody>
              {posts.map((p: any, idx: number) => (
                <tr key={p.id} className="hover-bg" style={{ borderBottom: idx < posts.length - 1 ? "1px solid #E5E7EB" : "none", background: idx === 0 ? "#FFFBEB" : "transparent" }}>
                  <td style={{ padding: "10px 14px", textAlign: "center", fontSize: 16 }}>{medals[idx] || idx + 1}</td>
                  <td style={{ padding: "10px 14px", color: "#111827", fontSize: 13, fontWeight: 500, maxWidth: 150 }} className="line-clamp-1">{p.page_name}</td>
                  <td style={{ padding: "10px 14px", color: "#4B5563", fontSize: 12, maxWidth: 220 }} className="line-clamp-1">{p.message || "(không có text)"}</td>
                  <td style={{ padding: "10px 14px", textAlign: "center", color: "#e53e3e", fontWeight: 600, fontSize: 13 }}>{p.reactions.toLocaleString("vi-VN")}</td>
                  <td style={{ padding: "10px 14px", textAlign: "center", color: "#4B5563", fontWeight: 600, fontSize: 13 }}>{p.comments.toLocaleString("vi-VN")}</td>
                  <td style={{ padding: "10px 14px", textAlign: "center", color: "#2563EB", fontWeight: 600, fontSize: 13 }}>{p.shares.toLocaleString("vi-VN")}</td>
                  <td style={{ padding: "10px 14px", textAlign: "center" }}><span style={{ background: idx < 3 ? "#1877F2" : "#F0F1F5", color: idx < 3 ? "#fff" : "#4B5563", padding: "3px 9px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>{p.diem}</span></td>
                </tr>
              ))}
              {posts.length === 0 && !loading && <tr><td colSpan={7} style={{ padding: 30, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>Chưa có dữ liệu — bấm "Tải dữ liệu"</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Tab: Thư viện
// ============================================================================
function ThuVienTab() {
  const [templates, setTemplates] = useState<any[]>([])
  const [search, setSearch] = useState("")
  const [showNew, setShowNew] = useState(false)
  const [nt, setNt] = useState({ title: "", message: "", tags: "" })
  const [toast, setToast] = useState<string | null>(null)

  const load = () => apiJson(`/admin/fb-content/templates?search=${encodeURIComponent(search)}`).then(d => setTemplates(d.templates || [])).catch(() => {})
  useEffect(() => { load() }, [search])

  const useTemplate = async (t: any) => { await apiJson(`/admin/fb-content/templates/${t.id}`, "PATCH", { action: "use" }); setToast(`Đã áp dụng "${t.title}"`); load() }
  const delTemplate = async (id: string) => { await apiJson(`/admin/fb-content/templates/${id}`, "DELETE"); setToast("Đã xóa mẫu"); load() }
  const addTemplate = async () => {
    if (!nt.title.trim()) return
    await apiJson(`/admin/fb-content/templates`, "POST", nt)
    setShowNew(false); setNt({ title: "", message: "", tags: "" }); setToast("Đã tạo mẫu mới"); load()
  }
  const inpSt: React.CSSProperties = { width: "100%", background: "#F0F1F5", color: "#111827", border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 12px", fontSize: 13, outline: "none" }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {toast && <Toast msg={toast} onDone={() => setToast(null)} />}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button onClick={() => setShowNew(s => !s)} style={{ background: "#1877F2", color: "#fff", border: "none", borderRadius: 10, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>＋ Tạo mẫu mới</button>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm mẫu…" style={{ flex: 1, background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 10, padding: "8px 12px", fontSize: 13, color: "#111827", outline: "none" }} />
      </div>
      {showNew && (
        <div style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <input value={nt.title} onChange={e => setNt({ ...nt, title: e.target.value })} placeholder="Tên mẫu" style={inpSt} />
          <textarea value={nt.message} onChange={e => setNt({ ...nt, message: e.target.value })} rows={3} placeholder="Nội dung mẫu" style={{ ...inpSt, resize: "vertical", fontFamily: "inherit" }} />
          <input value={nt.tags} onChange={e => setNt({ ...nt, tags: e.target.value })} placeholder="#khuyen-mai, #chao-titan" style={inpSt} />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button onClick={() => setShowNew(false)} style={{ background: "#F0F1F5", color: "#4B5563", border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>Hủy</button>
            <button onClick={addTemplate} style={{ background: "#1877F2", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Tạo mẫu</button>
          </div>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
        {templates.map(t => (
          <div key={t.id} style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.07),0 1px 2px rgba(0,0,0,0.04)", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "14px 16px", flex: 1 }}>
              <div style={{ color: "#111827", fontWeight: 600, fontSize: 14, marginBottom: 6 }}>{t.title}</div>
              <p className="line-clamp-3" style={{ color: "#4B5563", fontSize: 12, lineHeight: 1.55, marginBottom: 10 }}>{t.message}</p>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {(t.tags || []).map((tag: string) => <span key={tag} style={{ background: "#EBF3FF", color: "#1654B8", borderRadius: 20, padding: "2px 8px", fontSize: 11, fontWeight: 500 }}>{tag}</span>)}
              </div>
            </div>
            <div style={{ padding: "10px 16px", borderTop: "1px solid #E5E7EB", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#F0F1F5" }}>
              <span style={{ color: "#9CA3AF", fontSize: 12 }}>Đã dùng {t.usage_count} lần</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => useTemplate(t)} style={{ background: "#1877F2", color: "#fff", border: "none", borderRadius: 7, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Dùng</button>
                <button onClick={() => delTemplate(t.id)} style={{ background: "#FEE2E2", color: "#DC2626", border: "none", borderRadius: 7, padding: "5px 9px", fontSize: 12, cursor: "pointer" }}>🗑</button>
              </div>
            </div>
          </div>
        ))}
        {templates.length === 0 && <div style={{ gridColumn: "1/-1", padding: 30, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>Chưa có mẫu nào</div>}
      </div>
    </div>
  )
}

// ============================================================================
// Tab: Phân quyền trang — chỉ admin thấy
// ============================================================================
function PhanQuyenTrangTab() {
  const [pages, setPages] = useState<Page[]>([])
  const [loadingPages, setLoadingPages] = useState(true)
  const [pageSearch, setPageSearch] = useState("")
  const [mktUsers, setMktUsers] = useState<any[]>([])
  const [saving, setSaving] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [selUser, setSelUser] = useState<string | null>(null)
  const [userPageIds, setUserPageIds] = useState<Set<string>>(new Set())

  const filteredPages = pages.filter(p =>
    !pageSearch || p.page_name.toLowerCase().includes(pageSearch.toLowerCase())
  )

  const fetchPages = (forceRefresh = false) => {
    setLoadingPages(true)
    apiJson(`/admin/fb-content?all=true${forceRefresh ? "&force_refresh=true" : ""}`)
      .then(d => {
        setPages(d.pages || [])
        if (d.error === "FB_TOKEN_EXPIRED") setToast("Token FB hết hạn — liên hệ admin cập nhật FB_USER_TOKEN")
      })
      .catch(() => {})
      .finally(() => setLoadingPages(false))
  }

  useEffect(() => {
    fetchPages()
    apiJson("/admin/permissions/mkt-users").then(d => setMktUsers(d.users || [])).catch(() => {})
  }, [])

  const selectUser = async (email: string) => {
    setSelUser(email)
    // Lấy fb_page_ids hiện tại của user từ /admin/users list
    try {
      const d = await apiJson(`/admin/permissions/mkt-users`)
      // Fetch user detail để lấy metadata
      const res = await apiFetch(`/admin/users?email=${encodeURIComponent(email)}&limit=1`)
      const ud = await res.json()
      const user = (ud.users || [])[0]
      const ids: string[] = Array.isArray(user?.metadata?.fb_page_ids) ? user.metadata.fb_page_ids : []
      setUserPageIds(new Set(ids))
    } catch { setUserPageIds(new Set()) }
  }

  const togglePage = (pageId: string) => {
    setUserPageIds(prev => {
      const n = new Set(prev)
      n.has(pageId) ? n.delete(pageId) : n.add(pageId)
      return n
    })
  }

  const savePerms = async () => {
    if (!selUser) return
    setSaving(selUser)
    try {
      // Lấy user hiện tại để merge metadata
      const res = await apiFetch(`/admin/users?email=${encodeURIComponent(selUser)}&limit=1`)
      const ud = await res.json()
      const user = (ud.users || [])[0]
      if (!user) throw new Error("Không tìm thấy user")
      await apiFetch(`/admin/users/${user.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metadata: { ...(user.metadata ?? {}), fb_page_ids: [...userPageIds] }
        }),
      })
      setToast(`Đã cập nhật quyền trang cho ${selUser}`)
    } catch (e: any) { setToast("Lỗi: " + e.message) }
    finally { setSaving(null) }
  }

  const s = {
    card: { background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" } as React.CSSProperties,
  }

  return (
    <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
      {toast && <Toast msg={toast} onDone={() => setToast(null)} />}

      {/* Cột trái — danh sách MKT users */}
      <div style={{ ...s.card, width: 240, flexShrink: 0 }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #E5E7EB", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "#111827", fontWeight: 700, fontSize: 13 }}>👤 Nhân sự MKT</span>
        </div>
        {mktUsers.length === 0 && <div style={{ padding: 20, color: "#9CA3AF", fontSize: 13, textAlign: "center" }}>Đang tải…</div>}
        {mktUsers.map(u => (
          <button key={u.email} onClick={() => selectUser(u.email)}
            style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 16px", background: selUser === u.email ? "#EFF6FF" : "none", border: "none", borderBottom: "1px solid #F3F4F6", cursor: "pointer", textAlign: "left" as const }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: selUser === u.email ? "#1877F2" : "#E5E7EB", display: "flex", alignItems: "center", justifyContent: "center", color: selUser === u.email ? "#fff" : "#6B7280", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
              {(u.name || "?")[0].toUpperCase()}
            </div>
            <div>
              <div style={{ color: "#111827", fontSize: 13, fontWeight: selUser === u.email ? 700 : 500 }}>{u.name}</div>
              {u.mkt_code && <div style={{ color: "#1877F2", fontSize: 11, fontFamily: "monospace", fontWeight: 700 }}>{u.mkt_code}</div>}
            </div>
          </button>
        ))}
      </div>

      {/* Cột phải — danh sách pages để tick */}
      <div style={{ flex: 1 }}>
        {!selUser ? (
          <div style={{ ...s.card, padding: "40px 20px", textAlign: "center" }}>
            <div style={{ color: "#9CA3AF", fontSize: 13, marginBottom: 12 }}>← Chọn nhân sự bên trái để phân quyền trang</div>
            {loadingPages
              ? <div style={{ color: "#9CA3AF", fontSize: 12 }}>Đang tải danh sách trang…</div>
              : pages.length === 0
                ? <div>
                    <div style={{ color: "#EF4444", fontSize: 13, marginBottom: 10 }}>Chưa có trang nào trong cache</div>
                    <button onClick={() => fetchPages(true)} style={{ background: "#1877F2", color: "#fff", border: "none", borderRadius: 8, padding: "7px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                      🔄 Tải trang từ Facebook
                    </button>
                  </div>
                : <div style={{ color: "#6B7280", fontSize: 12 }}>Tìm thấy {pages.length} trang — chọn nhân sự để phân quyền</div>
            }
          </div>
        ) : (
          <div style={s.card}>
            <div style={{ padding: "12px 20px", borderBottom: "1px solid #E5E7EB", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span style={{ color: "#111827", fontWeight: 700, fontSize: 13 }}>Trang được phép đăng</span>
                <span style={{ color: "#9CA3AF", fontSize: 12, marginLeft: 8 }}>— {selUser}</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ color: "#6B7280", fontSize: 12 }}>{userPageIds.size} / {pages.length} trang</span>
                <button onClick={() => fetchPages(true)} title="Đồng bộ lại từ Facebook" style={{ background: "#F0F1F5", color: "#4B5563", border: "1px solid #E5E7EB", borderRadius: 8, padding: "5px 10px", fontSize: 12, cursor: "pointer" }}>🔄</button>
                <button onClick={savePerms} disabled={!!saving}
                  style={{ background: saving ? "#93C5FD" : "#1877F2", color: "#fff", border: "none", borderRadius: 8, padding: "6px 16px", fontSize: 13, fontWeight: 700, cursor: saving ? "wait" : "pointer" }}>
                  {saving ? "Đang lưu…" : "💾 Lưu"}
                </button>
              </div>
            </div>
            {/* Search + Quick select */}
            <div style={{ padding: "10px 16px", borderBottom: "1px solid #E5E7EB", display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ flex: 1, display: "flex", alignItems: "center", background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 8 }}>
                <span style={{ padding: "0 8px", color: "#9CA3AF", fontSize: 13 }}>⌕</span>
                <input
                  value={pageSearch} onChange={e => setPageSearch(e.target.value)}
                  placeholder="Tìm tên trang…"
                  style={{ flex: 1, background: "none", border: "none", outline: "none", padding: "7px 8px 7px 0", fontSize: 13, color: "#111827" }}
                />
                {pageSearch && <button onClick={() => setPageSearch("")} style={{ background: "none", border: "none", cursor: "pointer", color: "#9CA3AF", padding: "0 8px", fontSize: 14 }}>✕</button>}
              </div>
              <button onClick={() => setUserPageIds(new Set(filteredPages.map((p: any) => p.page_id)))}
                style={{ background: "#F0F1F5", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer", color: "#4B5563", fontWeight: 600, whiteSpace: "nowrap" }}>Chọn tất cả</button>
              <button onClick={() => setUserPageIds(new Set())}
                style={{ background: "#F0F1F5", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer", color: "#4B5563", fontWeight: 600, whiteSpace: "nowrap" }}>Bỏ tất cả</button>
            </div>
            <div style={{ maxHeight: 480, overflowY: "auto" }}>
              {loadingPages && <div style={{ padding: 20, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>Đang tải…</div>}
              {!loadingPages && pages.length === 0 && (
                <div style={{ padding: 30, textAlign: "center" }}>
                  <div style={{ color: "#EF4444", fontSize: 13, marginBottom: 10 }}>Chưa có trang nào — cần đồng bộ từ Facebook</div>
                  <button onClick={() => fetchPages(true)} style={{ background: "#1877F2", color: "#fff", border: "none", borderRadius: 8, padding: "7px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>🔄 Tải từ Facebook</button>
                </div>
              )}
              {!loadingPages && filteredPages.length === 0 && pages.length > 0 && (
                <div style={{ padding: 20, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>Không tìm thấy trang nào</div>
              )}
              {filteredPages.map((p: any) => {
                const checked = userPageIds.has(p.page_id)
                return (
                  <label key={p.page_id} onClick={() => togglePage(p.page_id)}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 20px", borderBottom: "1px solid #F3F4F6", cursor: "pointer", background: checked ? "#F0F6FF" : "none" }}>
                    <div style={{ width: 20, height: 20, borderRadius: 5, border: `2px solid ${checked ? "#1877F2" : "#D1D5DB"}`, background: checked ? "#1877F2" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {checked && <span style={{ color: "#fff", fontSize: 12, fontWeight: 900 }}>✓</span>}
                    </div>
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: pageColor(p.page_id), display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 15, flexShrink: 0 }}>
                      {(p.page_name || "?")[0]}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: "#111827", fontSize: 13, fontWeight: 600 }}>{p.page_name}</div>
                      <div style={{ color: "#9CA3AF", fontSize: 11 }}>{p.category || "Page"} · {(p.fan_count || 0).toLocaleString("vi-VN")} follows</div>
                    </div>
                    {checked && <span style={{ background: "#DBEAFE", color: "#1e40af", borderRadius: 20, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>✓ Có quyền</span>}
                  </label>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Page
// ============================================================================
export function FbContentSection({ prefill, initialTab }: { prefill: FbPrefill; initialTab?: string }) {
  const [tab, setTab] = useState(initialTab || "dangbai")
  const { isSuper, has } = useCurrentPermissions()

  const canManagePages = isSuper || has("users.manage")

  const tabs = [
    { id: "dangbai",      label: "Đăng bài" },
    { id: "lichdang",     label: "Lịch đăng" },
    { id: "viraltracker", label: "Viral Tracker" },
    { id: "thuvien",      label: "Thư viện" },
    ...(canManagePages ? [{ id: "phanquyen", label: "🔐 Phân quyền trang" }] : []),
  ]

  return (
    <div>
      <div style={{ display: "flex", borderBottom: "1px solid #E5E7EB", background: "#FFFFFF", paddingLeft: 20 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "11px 16px", color: tab === t.id ? "#1877F2" : "#4B5563", background: "none", border: "none", borderBottom: tab === t.id ? "2px solid #1877F2" : "2px solid transparent", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>{t.label}</button>
        ))}
      </div>
      <div style={{ padding: 20 }}>
        {tab === "dangbai"      && <DangBaiTab key={prefill?.videoId || "blank"} prefill={prefill} />}
        {tab === "lichdang"     && <LichDangTab />}
        {tab === "viraltracker" && <ViralTrackerTab />}
        {tab === "thuvien"      && <ThuVienTab />}
        {tab === "phanquyen"    && <PhanQuyenTrangTab />}
      </div>
    </div>
  )
}
