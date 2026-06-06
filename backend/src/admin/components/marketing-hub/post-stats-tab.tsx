import { useState, useEffect, useCallback, useRef } from "react"
import { apiFetch } from "../../lib/api-client"
import { T, lineClamp, STATUS_POST, pageColorFn } from "./tokens"

type PostStat = {
  post_id: string
  page_id: string
  page_name: string
  message: string
  media_type: string
  product_code: string | null
  product_name: string | null
  created_by: string | null
  published_at: string | null
  likes: number
  comments: number
  shares: number
  reach: number
  video_views: number
  synced_at: string
}

type Summary = {
  total_likes: string | null
  total_comments: string | null
  total_shares: string | null
  total_reach: string | null
  last_synced: string | null
}

const PAGE_SIZE = 50

const inp: React.CSSProperties = {
  background: "#fff", color: T.text1, border: `1px solid ${T.border}`,
  borderRadius: 8, padding: "6px 10px", fontSize: 12, outline: "none",
}
const th: React.CSSProperties = {
  padding: "9px 14px", textAlign: "left", color: T.text3, fontSize: 10,
  fontWeight: 700, textTransform: "uppercase", borderBottom: `1px solid ${T.border}`,
  background: T.subtle, whiteSpace: "nowrap",
}
const td: React.CSSProperties = {
  padding: "10px 14px", fontSize: 12, color: T.text2,
  borderBottom: `1px solid ${T.border}`, verticalAlign: "top",
}

function fmt(n: number | string | null) {
  const num = typeof n === "string" ? parseInt(n) : (n ?? 0)
  if (num >= 1000) return (num / 1000).toFixed(1) + "k"
  return String(num)
}

function fmtDate(d: string | null) {
  if (!d) return "—"
  return new Date(d).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

export function PostStatsTab() {
  const [posts, setPosts] = useState<PostStat[]>([])
  const [total, setTotal] = useState(0)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [pages, setPages] = useState<{ page_id: string; page_name: string }[]>([])
  const [products, setProducts] = useState<{ code: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [page, setPage] = useState(0)
  const [filters, setFilters] = useState({
    page_id: "", product_code: "", from: "", to: "", sort: "published_at"
  })
  const [toast, setToast] = useState<string | null>(null)
  const [syncLog, setSyncLog] = useState<string[]>([])
  const [showLog, setShowLog] = useState(false)
  const debounceRef = useRef<any>(null)

  const addLog = (msg: string) => setSyncLog(prev => [`[${new Date().toLocaleTimeString("vi-VN")}] ${msg}`, ...prev].slice(0, 50))

  // Load pages + products once
  useEffect(() => {
    apiFetch("/admin/fb-content?all=true").then(r => r.json()).then(d => {
      setPages(d.pages ?? [])
      addLog(`Đã load ${(d.pages ?? []).length} page từ DB`)
    }).catch(e => addLog(`Lỗi load pages: ${e.message}`))
    apiFetch("/admin/marketing-video/products").then(r => r.json()).then(d => {
      setProducts(d.products ?? [])
      addLog(`Đã load ${(d.products ?? []).length} sản phẩm`)
    }).catch(e => addLog(`Lỗi load products: ${e.message}`))
  }, [])

  const load = useCallback(() => {
    setLoading(true)
    const p = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) })
    if (filters.page_id)      p.set("page_id", filters.page_id)
    if (filters.product_code) p.set("product_code", filters.product_code)
    if (filters.from)         p.set("from", filters.from)
    if (filters.to)           p.set("to", filters.to)
    if (filters.sort)         p.set("sort", filters.sort)
    apiFetch(`/admin/fb-content/post-stats?${p}`)
      .then(r => r.json())
      .then(d => { setPosts(d.posts ?? []); setTotal(d.total ?? 0); setSummary(d.summary ?? null) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [filters, page])

  useEffect(() => { load() }, [load])

  const handleFilter = (key: string, val: string) => {
    setPage(0)
    setFilters(f => ({ ...f, [key]: val }))
  }

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  const refresh = async (pageId?: string) => {
    setSyncing(true)
    setSyncLog([])
    setShowLog(true)
    addLog(pageId ? `Bắt đầu sync page: ${pageId}` : "Bắt đầu sync tất cả page...")
    try {
      addLog("→ Gọi POST /admin/fb-content/post-stats")
      const res = await apiFetch("/admin/fb-content/post-stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pageId ? { page_id: pageId } : {}),
      })
      addLog(`← HTTP ${res.status}`)
      const r = await res.json()
      addLog(`Response: ${JSON.stringify(r)}`)
      if (r.ok) {
        addLog(`✅ Sync xong: ${r.synced} bài / ${r.pages} page`)
        showToast(`Đã sync ${r.synced} bài từ ${r.pages} page`)
        load()
      } else {
        addLog(`❌ Lỗi: ${r.error || JSON.stringify(r)}`)
        showToast(`Lỗi: ${r.error || "Unknown error"}`)
      }
    } catch (e: any) {
      addLog(`❌ Exception: ${e.message}`)
      showToast("Sync thất bại — xem log bên dưới")
    }
    finally { setSyncing(false) }
  }

  const copyPostId = (postId: string) => {
    navigator.clipboard.writeText(postId).then(() => showToast("Đã copy Post ID!"))
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const sortOptions = [
    { value: "published_at", label: "Ngày đăng" },
    { value: "likes",        label: "Likes" },
    { value: "comments",     label: "Comments" },
    { value: "shares",       label: "Shares" },
    { value: "reach",        label: "Reach" },
  ]

  return (
    <div style={{ padding: "0 0 32px" }}>
      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: 24, right: 24, background: "#111827", color: "#fff", borderRadius: 10, padding: "10px 18px", fontSize: 13, zIndex: 9999, boxShadow: T.shadowMd }}>
          {toast}
        </div>
      )}

      {/* KPI Summary */}
      {summary && (
        <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          {[
            { label: "Tổng bài", value: fmt(total), icon: "📄" },
            { label: "Tổng Likes", value: fmt(summary.total_likes), icon: "👍" },
            { label: "Tổng Comments", value: fmt(summary.total_comments), icon: "💬" },
            { label: "Tổng Shares", value: fmt(summary.total_shares), icon: "🔁" },
            { label: "Tổng Reach", value: fmt(summary.total_reach), icon: "👁" },
          ].map(k => (
            <div key={k.label} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: "14px 20px", minWidth: 110, flex: 1 }}>
              <div style={{ fontSize: 20 }}>{k.icon}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: T.text1 }}>{k.value}</div>
              <div style={{ fontSize: 11, color: T.text3 }}>{k.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filter bar */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <select style={inp} value={filters.page_id} onChange={e => handleFilter("page_id", e.target.value)}>
          <option value="">Tất cả trang</option>
          {pages.map(p => <option key={p.page_id} value={p.page_id}>{p.page_name}</option>)}
        </select>

        <select style={inp} value={filters.product_code} onChange={e => handleFilter("product_code", e.target.value)}>
          <option value="">Tất cả sản phẩm</option>
          {products.map(p => <option key={p.code} value={p.code}>{p.name} ({p.code})</option>)}
        </select>

        <select style={inp} value={filters.sort} onChange={e => handleFilter("sort", e.target.value)}>
          {sortOptions.map(o => <option key={o.value} value={o.value}>Sắp xếp: {o.label}</option>)}
        </select>

        <input type="date" style={inp} value={filters.from} onChange={e => handleFilter("from", e.target.value)} />
        <span style={{ color: T.text3, fontSize: 12 }}>→</span>
        <input type="date" style={inp} value={filters.to} onChange={e => handleFilter("to", e.target.value)} />

        <button onClick={() => { setFilters({ page_id: "", product_code: "", from: "", to: "", sort: "published_at" }); setPage(0) }}
          style={{ ...inp, cursor: "pointer", color: T.text2 }}>Xóa lọc</button>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {summary?.last_synced && (
            <span style={{ fontSize: 11, color: T.text3 }}>
              Cập nhật: {fmtDate(summary.last_synced)}
            </span>
          )}
          <button onClick={() => refresh(filters.page_id || undefined)} disabled={syncing}
            style={{ background: T.accent, color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, cursor: syncing ? "not-allowed" : "pointer", opacity: syncing ? 0.7 : 1 }}>
            {syncing ? "⏳ Đang sync..." : "↻ Refresh"}
          </button>
          <button onClick={() => setShowLog(v => !v)}
            style={{ ...inp, cursor: "pointer", color: T.text3, fontSize: 11 }}>
            {showLog ? "Ẩn log" : "🔍 Log"}
          </button>
          <span style={{ fontSize: 12, color: T.text3 }}>{total} bài</span>
        </div>
      </div>

      {/* Debug Log Panel */}
      {showLog && (
        <div style={{ background: "#0f172a", borderRadius: 10, padding: "12px 16px", marginBottom: 12, fontFamily: "monospace", fontSize: 11 }}>
          <div style={{ color: "#94a3b8", marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
            <span>🔍 Sync Log ({syncLog.length} dòng)</span>
            <button onClick={() => setSyncLog([])} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 11 }}>Xóa</button>
          </div>
          {syncLog.length === 0
            ? <div style={{ color: "#475569" }}>Chưa có log — bấm Refresh để sync</div>
            : syncLog.map((l, i) => (
              <div key={i} style={{ color: l.includes("❌") ? "#f87171" : l.includes("✅") ? "#4ade80" : l.includes("→") || l.includes("←") ? "#60a5fa" : "#e2e8f0", padding: "1px 0" }}>
                {l}
              </div>
            ))
          }
        </div>
      )}

      {/* Table */}
      <div style={{ overflowX: "auto", background: T.card, border: `1px solid ${T.border}`, borderRadius: 12 }}>
        <table style={{ width: "100%", minWidth: 900, borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 140 }}>Trang</th>
              <th style={{ ...th, width: 130 }}>Sản phẩm</th>
              <th style={{ ...th }}>Nội dung</th>
              <th style={{ ...th, width: 120 }}>Ngày đăng</th>
              <th style={{ ...th, width: 70, textAlign: "center" }}>👍</th>
              <th style={{ ...th, width: 70, textAlign: "center" }}>💬</th>
              <th style={{ ...th, width: 60, textAlign: "center" }}>🔁</th>
              <th style={{ ...th, width: 80, textAlign: "center" }}>👁 Reach</th>
              <th style={{ ...th, width: 80 }}>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ ...td, textAlign: "center", padding: 32, color: T.text3 }}>Đang tải...</td></tr>
            ) : posts.length === 0 ? (
              <tr><td colSpan={9} style={{ ...td, textAlign: "center", padding: 32, color: T.text3 }}>Không có bài nào — bấm Refresh để sync từ Facebook</td></tr>
            ) : posts.map(post => {
              const color = pageColorFn(post.page_id)
              const fbUrl = `https://www.facebook.com/${post.post_id}`
              return (
                <tr key={post.post_id} className="hover-bg">
                  {/* Trang */}
                  <td style={td}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 24, height: 24, borderRadius: "50%", background: color, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, fontWeight: 700 }}>
                        {(post.page_name || "?")[0]}
                      </div>
                      <span style={{ fontSize: 11, color: T.text2, ...lineClamp(2) }}>{post.page_name}</span>
                    </div>
                  </td>
                  {/* Sản phẩm */}
                  <td style={td}>
                    {post.product_name ? (
                      <div>
                        <div style={{ fontSize: 11, color: T.text2, ...lineClamp(1) }}>{post.product_name}</div>
                        {post.product_code && <code style={{ fontSize: 10, background: T.subtle, padding: "1px 5px", borderRadius: 4, color: T.text3 }}>{post.product_code}</code>}
                      </div>
                    ) : <span style={{ color: T.text3 }}>—</span>}
                  </td>
                  {/* Nội dung */}
                  <td style={{ ...td, maxWidth: 220 }}>
                    <div style={{ fontSize: 12, color: T.text2, ...lineClamp(2) }}>{post.message || "—"}</div>
                    {post.created_by && <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>{post.created_by}</div>}
                  </td>
                  {/* Ngày đăng */}
                  <td style={{ ...td, fontSize: 11 }}>{fmtDate(post.published_at)}</td>
                  {/* Likes */}
                  <td style={{ ...td, textAlign: "center", fontWeight: 600, color: post.likes > 100 ? "#1877F2" : T.text2 }}>{fmt(post.likes)}</td>
                  {/* Comments */}
                  <td style={{ ...td, textAlign: "center", fontWeight: 600, color: post.comments > 50 ? "#059669" : T.text2 }}>{fmt(post.comments)}</td>
                  {/* Shares */}
                  <td style={{ ...td, textAlign: "center" }}>{fmt(post.shares)}</td>
                  {/* Reach */}
                  <td style={{ ...td, textAlign: "center", fontWeight: 600, color: post.reach > 10000 ? "#7C3AED" : T.text2 }}>{post.reach > 0 ? fmt(post.reach) : "—"}</td>
                  {/* Thao tác */}
                  <td style={td}>
                    <div style={{ display: "flex", gap: 4 }}>
                      {post.post_id && (
                        <a href={fbUrl} target="_blank" rel="noreferrer"
                          style={{ fontSize: 11, padding: "3px 7px", borderRadius: 6, background: T.accentSubtle, color: T.accent, textDecoration: "none", whiteSpace: "nowrap" }}>
                          ↗ FB
                        </a>
                      )}
                      {post.post_id && (
                        <button onClick={() => copyPostId(post.post_id)}
                          title={post.post_id}
                          style={{ fontSize: 11, padding: "3px 7px", borderRadius: 6, background: T.subtle, color: T.text2, border: "none", cursor: "pointer" }}>
                          📋
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, marginTop: 16 }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            style={{ ...inp, cursor: page === 0 ? "not-allowed" : "pointer", opacity: page === 0 ? 0.5 : 1 }}>← Trước</button>
          <span style={{ fontSize: 12, color: T.text2 }}>Trang {page + 1} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
            style={{ ...inp, cursor: page >= totalPages - 1 ? "not-allowed" : "pointer", opacity: page >= totalPages - 1 ? 0.5 : 1 }}>Sau →</button>
        </div>
      )}
    </div>
  )
}
