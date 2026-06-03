import { useEffect, useState } from "react"
import { apiFetch, apiJson } from "../../lib/api-client"

export type FbPrefill = { videoId?: string; driveUrl?: string; sp?: string; vd?: string } | null

function Toast({ msg, onDone }: { msg: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 2800); return () => clearTimeout(t) }, [])
  return <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999, background: "#1877F2", color: "#fff", boxShadow: "var(--shadow-md)", borderRadius: 12, padding: "12px 18px", fontSize: 13, fontWeight: 500 }}>✓ {msg}</div>
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
function DangBaiTab({ prefill }: { prefill: { videoId?: string; driveUrl?: string; sp?: string; vd?: string } | null }) {
  const [content, setContent] = useState(prefill?.sp ? `Video: ${prefill.sp}\n` : "")
  const [driveLink, setDriveLink] = useState(prefill?.driveUrl || "")
  const [postType, setPostType] = useState<"text" | "video" | "anh">("video")
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
      if (d?.jobId) pollJob(d.jobId)
      else { setPosting(false); setToast("Lỗi: không tạo được job") }
    } catch (e: any) { setPosting(false); setToast("Lỗi: " + e.message) }
  }

  const inpCls: React.CSSProperties = { background: "var(--bg-subtle)", color: "var(--text-1)", border: "1px solid var(--border)", borderRadius: 9, padding: "9px 12px", fontSize: 13, outline: "none", width: "100%" }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {toast && <Toast msg={toast} onDone={() => setToast(null)} />}
      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 16 }}>
        {/* LEFT */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: 16, boxShadow: "var(--shadow-sm)" }}>
            <div style={{ color: "var(--text-2)", fontSize: 12, fontWeight: 600, marginBottom: 8 }}>NỘI DUNG BÀI ĐĂNG</div>
            <textarea value={content} onChange={e => setContent(e.target.value)} rows={6} placeholder="Nhập nội dung bài đăng…" style={{ ...inpCls, resize: "vertical", fontFamily: "inherit", lineHeight: 1.6 }} />
            <div style={{ color: "var(--text-3)", fontSize: 11, textAlign: "right", marginTop: 4 }}>{content.length} ký tự</div>
          </div>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: 16, boxShadow: "var(--shadow-sm)" }}>
            <div style={{ color: "var(--text-2)", fontSize: 12, fontWeight: 600, marginBottom: 8 }}>LINK GOOGLE DRIVE</div>
            <input value={driveLink} onChange={e => setDriveLink(e.target.value)} placeholder="https://drive.google.com/file/…" style={inpCls} />
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, padding: "7px 10px", background: "#FEF3C7", border: "1px solid #F59E0B40", borderRadius: 8 }}>
              <span>⚠️</span><span style={{ color: "#92400E", fontSize: 12 }}>File phải để chế độ <b>"Anyone with the link"</b> mới đăng được</span>
            </div>
          </div>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: 16, boxShadow: "var(--shadow-sm)" }}>
            <div style={{ color: "var(--text-2)", fontSize: 12, fontWeight: 600, marginBottom: 10 }}>LOẠI NỘI DUNG</div>
            <div style={{ display: "flex", gap: 6 }}>
              {([["text", "Văn bản"], ["video", "Video"], ["anh", "Ảnh"]] as const).map(([v, l]) => (
                <button key={v} onClick={() => setPostType(v)} style={{ flex: 1, padding: "8px 0", background: postType === v ? "var(--accent)" : "var(--bg-subtle)", color: postType === v ? "#fff" : "var(--text-2)", border: `1px solid ${postType === v ? "var(--accent)" : "var(--border)"}`, borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{l}</button>
              ))}
            </div>
          </div>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: 16, boxShadow: "var(--shadow-sm)" }}>
            <div style={{ color: "var(--text-2)", fontSize: 12, fontWeight: 600, marginBottom: 10 }}>THỜI GIAN ĐĂNG</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              {([["now", "Đăng ngay"], ["schedule", "Lên lịch"]] as const).map(([v, l]) => (
                <button key={v} onClick={() => setSchedule(v)} style={{ flex: 1, padding: "8px 0", background: schedule === v ? "var(--accent)" : "var(--bg-subtle)", color: schedule === v ? "#fff" : "var(--text-2)", border: `1px solid ${schedule === v ? "var(--accent)" : "var(--border)"}`, borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{l}</button>
              ))}
            </div>
            {schedule === "schedule" && <input type="datetime-local" value={schedTime} onChange={e => setSchedTime(e.target.value)} style={{ ...inpCls, width: "auto" }} />}
          </div>
        </div>
        {/* RIGHT */}
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", boxShadow: "var(--shadow-sm)", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ color: "var(--text-2)", fontSize: 12, fontWeight: 600, marginBottom: 10 }}>CHỌN TRANG ĐĂNG ({pages.length} trang)</div>
            <input value={pageQ} onChange={e => setPageQ(e.target.value)} placeholder="Tìm trang…" style={{ width: "100%", background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 9, padding: "7px 12px", fontSize: 12, color: "var(--text-1)", outline: "none", marginBottom: 10 }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <button onClick={selectAll} style={{ color: "var(--accent)", background: "none", border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                {selPages.size === filteredPages.length && filteredPages.length > 0 ? "Bỏ chọn tất cả" : `Chọn tất cả (${filteredPages.length})`}
              </button>
              {selPages.size > 0 && <span style={{ background: "var(--accent)", color: "#fff", borderRadius: 20, padding: "2px 10px", fontSize: 12, fontWeight: 700 }}>{selPages.size} trang</span>}
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", maxHeight: 400 }}>
            {filteredPages.map(p => (
              <label key={p.page_id} className="hover-bg" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", cursor: "pointer", borderBottom: "1px solid var(--border)" }}>
                <input type="checkbox" checked={selPages.has(p.page_id)} onChange={() => togglePage(p.page_id)} style={{ accentColor: "#1877F2", width: 15, height: 15, flexShrink: 0 }} />
                <div style={{ width: 34, height: 34, borderRadius: "50%", background: pageColor(p.page_id), flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, fontWeight: 700 }}>{p.page_name.slice(0, 2).toUpperCase()}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="line-clamp-1" style={{ color: "var(--text-1)", fontSize: 13, fontWeight: 500 }}>{p.page_name}</div>
                  <div style={{ color: "var(--text-3)", fontSize: 11 }}>{(p.fan_count || 0).toLocaleString("vi-VN")} người theo dõi</div>
                </div>
              </label>
            ))}
            {filteredPages.length === 0 && <div style={{ padding: 30, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>Không có trang nào</div>}
          </div>
        </div>
      </div>

      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px", boxShadow: "var(--shadow-sm)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={handlePost} disabled={!selPages.size || posting} style={{ background: selPages.size > 0 ? "var(--accent)" : "var(--border)", color: selPages.size > 0 ? "#fff" : "var(--text-3)", border: "none", borderRadius: 10, padding: "11px 24px", fontSize: 14, fontWeight: 700, cursor: selPages.size > 0 ? "pointer" : "default", opacity: posting ? 0.7 : 1 }}>
            {posting ? "Đang đăng…" : `Đăng ${selPages.size > 0 ? selPages.size : ""} trang`}
          </button>
          {selPages.size === 0 && <span style={{ color: "var(--text-3)", fontSize: 13 }}>Vui lòng chọn ít nhất 1 trang</span>}
        </div>
        {showSim && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ color: "var(--text-2)", fontSize: 13 }}>{posting ? "Đang đăng…" : "Hoàn thành"}</span>
              <span style={{ color: "var(--accent)", fontSize: 13, fontWeight: 700 }}>{progress.done}/{progress.total}</span>
            </div>
            <div style={{ background: "var(--border)", borderRadius: 6, height: 6, overflow: "hidden", marginBottom: 14 }}>
              <div style={{ height: "100%", background: "var(--accent)", width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`, transition: "width 0.5s ease", borderRadius: 6 }} />
            </div>
            {results.length > 0 && (
              <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr style={{ background: "var(--bg-subtle)" }}>{["Trang", "Trạng thái", "Post ID", "Lỗi"].map((h, i) => <th key={i} style={{ padding: "8px 12px", textAlign: "left", color: "var(--text-3)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", borderBottom: "1px solid var(--border)" }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {results.map((r, i) => (
                      <tr key={i} style={{ borderBottom: i < results.length - 1 ? "1px solid var(--border)" : "none" }}>
                        <td style={{ padding: "8px 12px", color: "var(--text-1)", fontSize: 13 }}>{r.page_name}</td>
                        <td style={{ padding: "8px 12px" }}><span style={{ background: r.status === "success" ? "var(--s-post-bg)" : "var(--s-err-bg)", color: r.status === "success" ? "var(--s-post)" : "var(--s-err)", padding: "2px 8px", borderRadius: 20, fontSize: 12, fontWeight: 600 }}>{r.status === "success" ? "Thành công" : "Lỗi"}</span></td>
                        <td style={{ padding: "8px 12px", color: "var(--text-3)", fontSize: 11, fontFamily: "monospace" }}>{r.post_id || "—"}</td>
                        <td style={{ padding: "8px 12px", color: "var(--s-err)", fontSize: 12 }}>{r.error || ""}</td>
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
// Tab: Lịch đăng
// ============================================================================
function LichDangTab() {
  const [posts, setPosts] = useState<any[]>([])
  useEffect(() => { apiJson("/admin/fb-content?posts=1&status=scheduled").then(d => setPosts(d.posts || [])).catch(() => {}) }, [])
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ color: "var(--text-2)", fontSize: 13 }}>Các bài đã lên lịch ({posts.length})</div>
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
        {posts.length === 0 && <div style={{ padding: 30, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>Chưa có bài lên lịch</div>}
        {posts.map((p, i) => (
          <div key={p.id} className="hover-bg" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: i < posts.length - 1 ? "1px solid var(--border)" : "none" }}>
            <div style={{ color: "var(--accent)", fontSize: 12, fontWeight: 700, minWidth: 120 }}>{p.scheduled_for ? new Date(p.scheduled_for).toLocaleString("vi-VN") : "—"}</div>
            <div style={{ color: "var(--text-1)", fontSize: 13, fontWeight: 500, minWidth: 150 }}>{p.page_name}</div>
            <div className="line-clamp-1" style={{ color: "var(--text-2)", fontSize: 12, flex: 1 }}>{p.message}</div>
          </div>
        ))}
      </div>
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
  const inpSt: React.CSSProperties = { background: "var(--bg-card)", color: "var(--text-1)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", fontSize: 12, outline: "none" }
  const fmt = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1) + "K" : String(n))

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ color: "var(--text-3)" }}>📅</span>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inpSt} />
        <span style={{ color: "var(--text-3)" }}>→</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inpSt} />
        <button onClick={load} style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 8, padding: "6px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{loading ? "Đang tải…" : "Tải dữ liệu"}</button>
      </div>
      {data?.error === "FB_TOKEN_EXPIRED" && <div style={{ background: "#FEE2E2", color: "#991B1B", padding: "10px 14px", borderRadius: 10, fontSize: 13 }}>Token FB hết hạn — liên hệ admin cập nhật FB_USER_TOKEN</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {[["Tổng bài", kpis?.totalPosts], ["Cảm xúc", kpis ? fmt(kpis.reactions) : "—"], ["Bình luận", kpis ? fmt(kpis.comments) : "—"], ["Chia sẻ", kpis ? fmt(kpis.shares) : "—"]].map(([label, val]) => (
          <div key={String(label)} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px", boxShadow: "var(--shadow-sm)" }}>
            <span style={{ color: "var(--text-3)", fontSize: 12, fontWeight: 500 }}>{label}</span>
            <div style={{ color: "var(--text-1)", fontWeight: 800, fontSize: 28, marginTop: 6 }}>{val ?? "—"}</div>
          </div>
        ))}
      </div>
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
        <div style={{ padding: "13px 18px", borderBottom: "1px solid var(--border)", color: "var(--text-1)", fontWeight: 600, fontSize: 14 }}>Top bài viral</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 680, borderCollapse: "collapse" }}>
            <thead><tr style={{ background: "var(--bg-subtle)" }}>{["#", "Trang", "Nội dung", "❤️", "💬", "↗️", "Điểm"].map((h, i) => <th key={i} style={{ padding: "9px 14px", textAlign: i > 2 ? "center" : "left", color: "var(--text-3)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
            <tbody>
              {posts.map((p: any, idx: number) => (
                <tr key={p.id} className="hover-bg" style={{ borderBottom: idx < posts.length - 1 ? "1px solid var(--border)" : "none", background: idx === 0 ? "#FFFBEB" : "transparent" }}>
                  <td style={{ padding: "10px 14px", textAlign: "center", fontSize: 16 }}>{medals[idx] || idx + 1}</td>
                  <td style={{ padding: "10px 14px", color: "var(--text-1)", fontSize: 13, fontWeight: 500, maxWidth: 150 }} className="line-clamp-1">{p.page_name}</td>
                  <td style={{ padding: "10px 14px", color: "var(--text-2)", fontSize: 12, maxWidth: 220 }} className="line-clamp-1">{p.message || "(không có text)"}</td>
                  <td style={{ padding: "10px 14px", textAlign: "center", color: "#e53e3e", fontWeight: 600, fontSize: 13 }}>{p.reactions.toLocaleString("vi-VN")}</td>
                  <td style={{ padding: "10px 14px", textAlign: "center", color: "var(--text-2)", fontWeight: 600, fontSize: 13 }}>{p.comments.toLocaleString("vi-VN")}</td>
                  <td style={{ padding: "10px 14px", textAlign: "center", color: "#2563EB", fontWeight: 600, fontSize: 13 }}>{p.shares.toLocaleString("vi-VN")}</td>
                  <td style={{ padding: "10px 14px", textAlign: "center" }}><span style={{ background: idx < 3 ? "var(--accent)" : "var(--bg-subtle)", color: idx < 3 ? "#fff" : "var(--text-2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>{p.diem}</span></td>
                </tr>
              ))}
              {posts.length === 0 && !loading && <tr><td colSpan={7} style={{ padding: 30, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>Chưa có dữ liệu — bấm "Tải dữ liệu"</td></tr>}
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
  const inpSt: React.CSSProperties = { width: "100%", background: "var(--bg-subtle)", color: "var(--text-1)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", fontSize: 13, outline: "none" }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {toast && <Toast msg={toast} onDone={() => setToast(null)} />}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button onClick={() => setShowNew(s => !s)} style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 10, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>＋ Tạo mẫu mới</button>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm mẫu…" style={{ flex: 1, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px", fontSize: 13, color: "var(--text-1)", outline: "none" }} />
      </div>
      {showNew && (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <input value={nt.title} onChange={e => setNt({ ...nt, title: e.target.value })} placeholder="Tên mẫu" style={inpSt} />
          <textarea value={nt.message} onChange={e => setNt({ ...nt, message: e.target.value })} rows={3} placeholder="Nội dung mẫu" style={{ ...inpSt, resize: "vertical", fontFamily: "inherit" }} />
          <input value={nt.tags} onChange={e => setNt({ ...nt, tags: e.target.value })} placeholder="#khuyen-mai, #chao-titan" style={inpSt} />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button onClick={() => setShowNew(false)} style={{ background: "var(--bg-subtle)", color: "var(--text-2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>Hủy</button>
            <button onClick={addTemplate} style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Tạo mẫu</button>
          </div>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
        {templates.map(t => (
          <div key={t.id} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", boxShadow: "var(--shadow-sm)", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "14px 16px", flex: 1 }}>
              <div style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 14, marginBottom: 6 }}>{t.title}</div>
              <p className="line-clamp-3" style={{ color: "var(--text-2)", fontSize: 12, lineHeight: 1.55, marginBottom: 10 }}>{t.message}</p>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {(t.tags || []).map((tag: string) => <span key={tag} style={{ background: "var(--accent-subtle)", color: "var(--accent-text)", borderRadius: 20, padding: "2px 8px", fontSize: 11, fontWeight: 500 }}>{tag}</span>)}
              </div>
            </div>
            <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--bg-subtle)" }}>
              <span style={{ color: "var(--text-3)", fontSize: 12 }}>Đã dùng {t.usage_count} lần</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => useTemplate(t)} style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 7, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Dùng</button>
                <button onClick={() => delTemplate(t.id)} style={{ background: "var(--s-err-bg)", color: "var(--s-err)", border: "none", borderRadius: 7, padding: "5px 9px", fontSize: 12, cursor: "pointer" }}>🗑</button>
              </div>
            </div>
          </div>
        ))}
        {templates.length === 0 && <div style={{ gridColumn: "1/-1", padding: 30, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>Chưa có mẫu nào</div>}
      </div>
    </div>
  )
}

// ============================================================================
// Page
// ============================================================================
// prefill + activeSubTab: route cha điều khiển khi bấm "Đăng FB" từ tab Video.
export function FbContentSection({ prefill, initialTab }: { prefill: FbPrefill; initialTab?: string }) {
  const [tab, setTab] = useState(initialTab || "dangbai")

  const tabs = [
    { id: "dangbai", label: "Đăng bài" },
    { id: "lichdang", label: "Lịch đăng" },
    { id: "viraltracker", label: "Viral Tracker" },
    { id: "thuvien", label: "Thư viện" },
  ]

  return (
    <div>
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", background: "var(--bg-card)", paddingLeft: 20 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "11px 16px", color: tab === t.id ? "var(--accent)" : "var(--text-2)", background: "none", border: "none", borderBottom: tab === t.id ? "2px solid var(--accent)" : "2px solid transparent", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>{t.label}</button>
        ))}
      </div>
      <div style={{ padding: 20 }}>
        {tab === "dangbai" && <DangBaiTab key={prefill?.videoId || "blank"} prefill={prefill} />}
        {tab === "lichdang" && <LichDangTab />}
        {tab === "viraltracker" && <ViralTrackerTab />}
        {tab === "thuvien" && <ThuVienTab />}
      </div>
    </div>
  )
}
