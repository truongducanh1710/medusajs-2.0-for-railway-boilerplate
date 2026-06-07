import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { apiJson } from "../../lib/api-client"

// ─── Types ───────────────────────────────────────────────────────────────────
type Conversation = {
  id: string; page_id: string; page_name: string
  customer_name?: string; customer_psid: string
  status: string; priority: string
  last_message?: string; last_message_at?: string
  unread_count: number; assigned_to?: string
  handoff_reason?: string; bot_paused: boolean; bot_mode?: string
  product_names?: string[]; active_phone?: string
  active_address?: string; active_order_state?: string
}
type Attachment = { type: string; payload?: { url?: string; title?: string }; name?: string }
type Message = {
  id: string; sender_type: string; direction: string
  text: string; attachments: Attachment[] | string | null; created_at: string
}
type BotEvent = {
  id: string; intent: string; reply_text?: string
  auto_sent: boolean; skipped_reason?: string; created_at: string
}
type ConvDetail = {
  conversation: Conversation & {
    active_window_summary?: string; historical_summary?: string
  }
  messages: Message[]; events: any[]; orders: any[]
}
type Agent = {
  id: string; page_id: string; page_name: string; mode: string
  product_names?: string[]; generated_instruction?: string
  manual_override_instruction?: string; last_generated_at?: string
  error_count?: number; sp_chay?: string; fan_count?: number
}
type Example = {
  id: string; page_name: string; product_name?: string
  customer_text: string; sale_reply: string
  bot_handoff_reason?: string; review_status: string; created_at: string
}

// ─── Constants ───────────────────────────────────────────────────────────────
const TABS = [
  ["all", "Tất cả"], ["unread", "Chưa đọc"], ["handoff", "Cần sale"],
  ["complaint", "Khiếu nại"], ["mine", "Của tôi"],
] as const

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  complaint:    { label: "Khiếu nại",   bg: "#fee2e2", color: "#dc2626" },
  handoff:      { label: "Cần sale",    bg: "#fef3c7", color: "#d97706" },
  assigned:     { label: "Đang xử lý", bg: "#dbeafe", color: "#2563eb" },
  ordered:      { label: "Đã đặt",      bg: "#dcfce7", color: "#16a34a" },
  bot_handling: { label: "Bot xử lý",  bg: "#ede9fe", color: "#7c3aed" },
  new:          { label: "Mới",         bg: "#f1f5f9", color: "#64748b" },
}
const MODE_CONFIG: Record<string, { label: string; color: string }> = {
  off:            { label: "OFF",       color: "#94a3b8" },
  suggest:        { label: "Gợi ý",    color: "#3b82f6" },
  auto_24h:       { label: "Auto 24h", color: "#10b981" },
  paused_by_error:{ label: "Lỗi",      color: "#ef4444" },
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtAgo(v?: string) {
  if (!v) return ""
  const d = new Date(v), diff = Date.now() - d.getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return "vừa xong"
  if (m < 60) return `${m}p`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })
}
function fmtTime(v?: string) {
  if (!v) return ""
  return new Date(v).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })
}
function fmtDateOnly(v: string) {
  const d = new Date(v)
  const today = new Date()
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return "Hôm nay"
  if (d.toDateString() === yesterday.toDateString()) return "Hôm qua"
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })
}
function parseAtts(raw: Attachment[] | string | null | undefined): Attachment[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try { return JSON.parse(raw as string) } catch { return [] }
}
function isCommentReply(t: string) {
  return /ban dang phan hoi binh luan|comment_id=|xem binh luan/i.test(t)
}
function isSystemText(t: string) {
  return isCommentReply(t) || /^\[attachment\]$/i.test(t.trim())
}
function avatarChar(name?: string) {
  return (name || "?")[0].toUpperCase()
}
function avatarColor(name?: string) {
  const colors = ["#6366f1","#ec4899","#f59e0b","#10b981","#3b82f6","#8b5cf6","#ef4444","#14b8a6"]
  let h = 0; for (const c of (name || "")) h = (h * 31 + c.charCodeAt(0)) & 0xff
  return colors[h % colors.length]
}

// ─── Micro UI ────────────────────────────────────────────────────────────────
function Avatar({ name, size = 36 }: { name?: string; size?: number }) {
  const bg = avatarColor(name)
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: bg, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: size * 0.38, flexShrink: 0, userSelect: "none" }}>
      {avatarChar(name)}
    </div>
  )
}

function Tag({ label, bg, color }: { label: string; bg: string; color: string }) {
  return <span style={{ background: bg, color, borderRadius: 4, padding: "1px 7px", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>{label}</span>
}

function Btn({ children, onClick, disabled, variant = "default", size = "md" }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean
  variant?: "default" | "primary" | "danger" | "ghost" | "success"
  size?: "xs" | "sm" | "md"
}) {
  const styles: Record<string, React.CSSProperties> = {
    default:  { background: "#fff", color: "#374151", border: "1px solid #e2e8f0" },
    primary:  { background: "#1877f2", color: "#fff", border: "1px solid #1877f2" },
    danger:   { background: "#fff5f5", color: "#ef4444", border: "1px solid #fecaca" },
    ghost:    { background: "transparent", color: "#64748b", border: "1px solid transparent" },
    success:  { background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0" },
  }
  const pad = size === "xs" ? "2px 8px" : size === "sm" ? "5px 12px" : "7px 16px"
  const fs = size === "xs" ? 11 : size === "sm" ? 12 : 13
  return (
    <button onClick={onClick} disabled={disabled} style={{
      ...styles[variant], borderRadius: 8, padding: pad, fontSize: fs, fontWeight: 500,
      cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1,
      display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap",
    }}>{children}</button>
  )
}

function AttView({ att }: { att: Attachment }) {
  const url = att.payload?.url
  if (!url) return <span style={{ fontSize: 12, color: "#9ca3af" }}>[{att.type}]</span>
  if (att.type === "image") return (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt="" style={{ maxWidth: 220, maxHeight: 220, borderRadius: 12, display: "block", cursor: "zoom-in", objectFit: "cover" }}
        onError={e => { (e.target as HTMLImageElement).style.display = "none" }} />
    </a>
  )
  if (att.type === "video") return <video src={url} controls style={{ maxWidth: 260, borderRadius: 12 }} />
  if (att.type === "audio") return <audio src={url} controls style={{ maxWidth: 240 }} />
  return <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#3b82f6" }}>📎 {att.payload?.title || att.name || att.type}</a>
}

// Date separator
function DateSep({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "8px 0" }}>
      <div style={{ flex: 1, height: 1, background: "#f1f5f9" }} />
      <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500 }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: "#f1f5f9" }} />
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function ChatPage() {
  const [view, setView] = useState<"inbox" | "agents" | "examples">("inbox")
  const [tab, setTab] = useState("all")
  const [pageFilter, setPageFilter] = useState("")
  const [hasPhone, setHasPhone] = useState(false)
  const [pageList, setPageList] = useState<{ page_id: string; page_name: string }[]>([])
  const [convs, setConvs] = useState<Conversation[]>([])
  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ConvDetail | null>(null)
  const [botEvents, setBotEvents] = useState<BotEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState("")
  const [syncDetail, setSyncDetail] = useState<Record<string, any>>({})
  const [showSyncDetail, setShowSyncDetail] = useState(false)
  const [agents, setAgents] = useState<Agent[]>([])
  const [examples, setExamples] = useState<Example[]>([])
  const [exTab, setExTab] = useState("pending")
  const msgEndRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<any>(null)

  const selected = useMemo(() => convs.find(c => c.id === selectedId), [convs, selectedId])
  const conv = detail?.conversation
  const filtered = useMemo(() => {
    if (!search.trim()) return convs
    const s = search.toLowerCase()
    return convs.filter(c =>
      (c.customer_name || "").toLowerCase().includes(s) ||
      c.customer_psid.toLowerCase().includes(s) ||
      (c.last_message || "").toLowerCase().includes(s)
    )
  }, [convs, search])
  const botSuggestion = useMemo(() =>
    botEvents.find(e => e.reply_text && !e.auto_sent && !e.skipped_reason?.includes("handoff")),
    [botEvents]
  )

  // Group messages by date for separators
  const groupedMessages = useMemo(() => {
    const msgs = detail?.messages || []
    const groups: { date: string; messages: Message[] }[] = []
    for (const m of msgs) {
      const d = fmtDateOnly(m.created_at)
      if (!groups.length || groups[groups.length - 1].date !== d) {
        groups.push({ date: d, messages: [m] })
      } else {
        groups[groups.length - 1].messages.push(m)
      }
    }
    return groups
  }, [detail?.messages])

  const loadConvs = useCallback(async (t = tab, p = pageFilter, hp = hasPhone) => {
    setLoading(true)
    try {
      let url = `/admin/chat/conversations?status=${t}&limit=80`
      if (p) url += `&page_id=${p}`
      if (hp) url += `&has_phone=1`
      const d = await apiJson(url)
      setConvs(d.conversations || [])
    } finally { setLoading(false) }
  }, [tab, pageFilter, hasPhone])

  const loadDetail = useCallback(async (id = selectedId) => {
    if (!id) return
    const [d, ev] = await Promise.all([
      apiJson(`/admin/chat/conversations/${id}`),
      apiJson(`/admin/chat/conversations/${id}/bot-events`).catch(() => ({ events: [] })),
    ])
    setDetail(d); setBotEvents(ev.events || [])
  }, [selectedId])

  const loadAgents = useCallback(async () => {
    const d = await apiJson("/admin/chat/agents")
    setAgents(d.agents || [])
    setPageList((d.agents || []).map((a: any) => ({ page_id: a.page_id, page_name: a.page_name })))
  }, [])

  const loadExamples = useCallback(async (s = exTab) => {
    const d = await apiJson(`/admin/chat/reply-examples?status=${s}`)
    setExamples(d.examples || [])
  }, [exTab])

  useEffect(() => { loadConvs(); loadAgents() }, [])
  useEffect(() => { if (selectedId) loadDetail(selectedId) }, [selectedId])
  useEffect(() => {
    if (detail?.messages?.length) msgEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [detail?.messages?.length])
  useEffect(() => {
    if (view !== "inbox") return
    clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      loadConvs(tab, pageFilter, hasPhone)
      if (selectedId) loadDetail(selectedId)
    }, 15000)
    return () => clearInterval(timerRef.current)
  }, [view, tab, pageFilter, hasPhone, selectedId])
  useEffect(() => { if (view === "examples") loadExamples(exTab) }, [view])

  async function send() {
    if (!selectedId || !text.trim() || sending) return
    setSending(true)
    try {
      await apiJson(`/admin/chat/conversations/${selectedId}/send`, "POST", { text })
      setText(""); await loadDetail(selectedId); await loadConvs(tab, pageFilter, hasPhone)
    } finally { setSending(false) }
  }

  async function syncInbox() {
    setSyncing(true); setSyncMsg("⏳ Đang khởi động..."); setSyncDetail({})
    try {
      const body: any = { days: 7 }
      if (pageFilter) body.page_id = pageFilter
      const d = await apiJson("/admin/chat/sync-inbox", "POST", body)
      if (d?.status === "running") {
        setSyncMsg(`⏳ Sync ${d.pages_count} page...`)
        const poll = async () => {
          try {
            const s = await apiJson("/admin/chat/sync-inbox")
            setSyncDetail(s?.results || {})
            if (s?.status === "running") { setSyncMsg(`⏳ ${s.pages_synced}/${d.pages_count}...`); setTimeout(poll, 2000) }
            else if (s?.status === "done") { setSyncMsg(`✅ ${s.total_saved} tin · ${s.pages_synced} page`); setSyncing(false); loadConvs(tab, pageFilter, hasPhone) }
            else { setSyncMsg(`❌ ${s?.error || "Lỗi"}`); setSyncing(false) }
          } catch { setTimeout(poll, 3000) }
        }
        setTimeout(poll, 2000)
      } else { setSyncMsg(`✅ ${d.total_saved || 0} tin`); setSyncing(false); loadConvs(tab, pageFilter, hasPhone) }
    } catch (e: any) { setSyncMsg(`❌ ${e.message}`); setSyncing(false) }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 56px)", margin: -24, background: "#f8fafc", fontFamily: "Inter,system-ui,sans-serif", fontSize: 13, color: "#0f172a" }}>

      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 2, padding: "0 16px", height: 50, background: "#fff", borderBottom: "1px solid #e8edf2", flexShrink: 0 }}>
        <span style={{ fontSize: 18, marginRight: 6 }}>💬</span>
        <b style={{ fontSize: 15, marginRight: 8 }}>Chat</b>
        {(["inbox","agents","examples"] as const).map(v => (
          <button key={v} onClick={() => setView(v)} style={{
            border: "none", background: "none", color: view === v ? "#1877f2" : "#64748b",
            borderBottom: view === v ? "2px solid #1877f2" : "2px solid transparent",
            padding: "0 14px", height: 50, fontSize: 13, fontWeight: view === v ? 600 : 400,
            cursor: "pointer",
          }}>{v === "inbox" ? "Inbox" : v === "agents" ? "Bot Agents" : "Câu cần học"}</button>
        ))}
        {view === "inbox" && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            {syncMsg && (
              <span onClick={() => setShowSyncDetail(v => !v)} style={{ fontSize: 12, cursor: "pointer", color: syncMsg.startsWith("✅") ? "#10b981" : syncMsg.startsWith("❌") ? "#ef4444" : "#f59e0b" }}>
                {syncMsg}
              </span>
            )}
            <select value={pageFilter} onChange={e => { setPageFilter(e.target.value); loadConvs(tab, e.target.value, hasPhone) }}
              style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "5px 8px", fontSize: 12, maxWidth: 180, background: "#fff" }}>
              <option value="">Tất cả page</option>
              {pageList.map(p => <option key={p.page_id} value={p.page_id}>{p.page_name}</option>)}
            </select>
            <Btn onClick={syncInbox} disabled={syncing} size="sm">⬇ {syncing ? "Đang sync..." : "Sync"}</Btn>
            <button onClick={() => loadConvs(tab, pageFilter, hasPhone)} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 8, width: 32, height: 32, cursor: "pointer", fontSize: 15, color: "#64748b" }}>↺</button>
          </div>
        )}
      </div>

      {/* Sync detail */}
      {showSyncDetail && Object.keys(syncDetail).length > 0 && (
        <div style={{ background: "#fffbeb", borderBottom: "1px solid #fde68a", padding: "8px 16px", flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <b style={{ fontSize: 12 }}>Chi tiết sync:</b>
            {Object.entries(syncDetail).map(([name, r]: [string, any]) => (
              <span key={name} style={{ background: "#fff", border: "1px solid #fde68a", borderRadius: 6, padding: "2px 8px", fontSize: 11 }}>
                {name} <b style={{ color: "#10b981" }}>+{r.saved}</b>
                {r.errors?.length > 0 && <span style={{ color: "#ef4444" }}> ⚠</span>}
              </span>
            ))}
            <button onClick={() => setShowSyncDetail(false)} style={{ marginLeft: "auto", border: "none", background: "none", cursor: "pointer", color: "#94a3b8" }}>✕</button>
          </div>
        </div>
      )}

      {/* ── INBOX ── */}
      {view === "inbox" && (
        <div style={{ display: "grid", gridTemplateColumns: "300px 1fr 320px", flex: 1, minHeight: 0 }}>

          {/* ── Sidebar ── */}
          <div style={{ background: "#fff", borderRight: "1px solid #e8edf2", display: "flex", flexDirection: "column", minHeight: 0 }}>
            {/* Search */}
            <div style={{ padding: "10px 12px 0" }}>
              <div style={{ display: "flex", alignItems: "center", background: "#f8fafc", border: "1px solid #e8edf2", borderRadius: 10, padding: "7px 10px", gap: 6 }}>
                <span style={{ color: "#94a3b8", fontSize: 14 }}>🔍</span>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm kiếm..."
                  style={{ border: "none", background: "none", outline: "none", fontSize: 12, flex: 1, color: "#0f172a" }} />
              </div>
            </div>
            {/* Tabs */}
            <div style={{ display: "flex", padding: "8px 10px 4px", gap: 2, flexWrap: "wrap" }}>
              {TABS.map(([id, label]) => (
                <button key={id} onClick={() => { setTab(id); loadConvs(id, pageFilter, hasPhone) }} style={{
                  border: "none", background: tab === id ? "#eff6ff" : "transparent",
                  color: tab === id ? "#1877f2" : "#64748b",
                  borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: tab === id ? 600 : 400, cursor: "pointer",
                }}>{label}</button>
              ))}
            </div>
            {/* Filter row */}
            <div style={{ display: "flex", alignItems: "center", padding: "4px 12px 8px", borderBottom: "1px solid #f1f5f9", gap: 6 }}>
              <button onClick={() => { const v = !hasPhone; setHasPhone(v); loadConvs(tab, pageFilter, v) }}
                style={{ display: "inline-flex", alignItems: "center", gap: 4, border: `1px solid ${hasPhone ? "#3b82f6" : "#e2e8f0"}`, background: hasPhone ? "#eff6ff" : "#fff", color: hasPhone ? "#1877f2" : "#64748b", borderRadius: 99, padding: "3px 10px", fontSize: 11, fontWeight: hasPhone ? 600 : 400, cursor: "pointer" }}>
                📞 Có SĐT
              </button>
              <span style={{ fontSize: 10, color: "#cbd5e1", marginLeft: "auto" }}>mới nhất ↑</span>
            </div>

            {/* Conv list */}
            <div style={{ flex: 1, overflow: "auto" }}>
              {loading && <div style={{ padding: "20px 16px", color: "#94a3b8", fontSize: 12, textAlign: "center" }}>Đang tải...</div>}
              {!loading && filtered.length === 0 && <div style={{ padding: "20px 16px", color: "#94a3b8", fontSize: 12, textAlign: "center" }}>Không có hội thoại</div>}
              {filtered.map(c => {
                const isSelected = selectedId === c.id
                const sc = STATUS_CONFIG[c.status]
                return (
                  <div key={c.id} onClick={() => setSelectedId(c.id)} style={{
                    padding: "10px 14px", borderBottom: "1px solid #f8fafc", cursor: "pointer",
                    background: isSelected ? "#eff6ff" : "#fff",
                    borderLeft: `3px solid ${isSelected ? "#1877f2" : "transparent"}`,
                    transition: "background 0.1s",
                  }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <div style={{ position: "relative", flexShrink: 0 }}>
                        <Avatar name={c.customer_name || c.customer_psid} size={38} />
                        {c.unread_count > 0 && (
                          <span style={{ position: "absolute", top: -3, right: -3, background: "#ef4444", color: "#fff", borderRadius: 99, fontSize: 9, fontWeight: 700, padding: "1px 4px", border: "1.5px solid #fff" }}>
                            {c.unread_count}
                          </span>
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                          <span style={{ fontWeight: 600, fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {c.customer_name || c.customer_psid}
                          </span>
                          <span style={{ fontSize: 10, color: "#94a3b8", flexShrink: 0 }}>{fmtAgo(c.last_message_at)}</span>
                        </div>
                        <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 3 }}>{c.page_name}</div>
                        <div style={{ fontSize: 12, color: c.unread_count > 0 ? "#0f172a" : "#94a3b8", fontWeight: c.unread_count > 0 ? 500 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {c.last_message}
                        </div>
                        <div style={{ display: "flex", gap: 4, marginTop: 5, flexWrap: "wrap", alignItems: "center" }}>
                          {sc && c.status !== "new" && <Tag label={sc.label} bg={sc.bg} color={sc.color} />}
                          {c.bot_mode && c.bot_mode !== "off" && (
                            <Tag label={`🤖 ${MODE_CONFIG[c.bot_mode]?.label || c.bot_mode}${c.bot_paused ? " ⏸" : ""}`}
                              bg="#f5f3ff" color={MODE_CONFIG[c.bot_mode]?.color || "#7c3aed"} />
                          )}
                          {c.active_phone && (
                            <span style={{ fontSize: 10, color: "#3b82f6", fontFamily: "monospace", fontWeight: 600 }}>📞 {c.active_phone}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Messages ── */}
          <div style={{ display: "flex", flexDirection: "column", minHeight: 0, background: "#f8fafc" }}>
            {/* Header */}
            <div style={{ background: "#fff", borderBottom: "1px solid #e8edf2", padding: "10px 16px", display: "flex", gap: 10, alignItems: "center", flexShrink: 0, minHeight: 54 }}>
              {selected ? (
                <>
                  <Avatar name={selected.customer_name || selected.customer_psid} size={34} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{selected.customer_name || selected.customer_psid}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>{selected.page_name}</div>
                  </div>
                  {conv?.handoff_reason && (
                    <Tag
                      label={`⚠ ${conv.handoff_reason === "complaint" ? "Khiếu nại" : "Cần nhân viên"}`}
                      bg="#fff7ed" color="#c2410c"
                    />
                  )}
                  <div style={{ display: "flex", gap: 6 }}>
                    <Btn size="sm" onClick={async () => { await apiJson(`/admin/chat/conversations/${selectedId}/assign-me`, "POST"); loadDetail(selectedId!); loadConvs(tab, pageFilter, hasPhone) }}>
                      Nhận xử lý
                    </Btn>
                    {selected.bot_paused && (
                      <Btn size="sm" variant="success" onClick={async () => { await apiJson(`/admin/chat/conversations/${selectedId}/resume-bot`, "POST"); loadDetail(selectedId!); loadConvs(tab, pageFilter, hasPhone) }}>
                        ▶ Bật bot
                      </Btn>
                    )}
                    <Btn size="sm" variant="danger" onClick={async () => { if (!confirm("Xóa hội thoại này?")) return; await apiJson(`/admin/chat/conversations/${selectedId}`, "DELETE"); setSelectedId(null); setDetail(null); loadConvs(tab, pageFilter, hasPhone) }}>Xóa</Btn>
                  </div>
                </>
              ) : (
                <span style={{ color: "#94a3b8" }}>Chọn hội thoại để bắt đầu</span>
              )}
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflow: "auto", padding: "12px 20px", display: "flex", flexDirection: "column" }}>
              {selectedId && detail && (detail.messages || []).length === 0 && (
                <div style={{ margin: "auto", color: "#94a3b8", fontSize: 13, textAlign: "center" }}>
                  <div style={{ fontSize: 36, marginBottom: 8 }}>💬</div>
                  Chưa có tin nhắn nào được lưu
                </div>
              )}
              {groupedMessages.map(group => (
                <div key={group.date}>
                  <DateSep label={group.date} />
                  {group.messages.map(m => {
                    const isOut = m.direction === "outbound"
                    const isBot = m.sender_type === "bot"
                    const isSale = m.sender_type === "sale"
                    const isPage = m.sender_type === "page"
                    const atts = parseAtts(m.attachments)
                    if (!m.text && atts.length === 0) return null
                    if (m.text && isCommentReply(m.text)) return (
                      <div key={m.id} style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
                        <div style={{ background: "#f1f5f9", borderRadius: 20, padding: "4px 14px", fontSize: 11, color: "#94a3b8" }}>
                          💬 Phản hồi bình luận · {fmtTime(m.created_at)}
                        </div>
                      </div>
                    )
                    const bubbleBg = isBot ? "#7c3aed" : (isSale || isPage) ? "#1877f2" : "#fff"
                    const bubbleColor = (isBot || isSale || isPage) ? "#fff" : "#0f172a"
                    const br = isOut ? "18px 18px 4px 18px" : "18px 18px 18px 4px"
                    return (
                      <div key={m.id} style={{ display: "flex", justifyContent: isOut ? "flex-end" : "flex-start", gap: 8, alignItems: "flex-end", marginBottom: 6 }}>
                        {!isOut && <Avatar name={conv?.customer_name || selected?.customer_name} size={28} />}
                        <div style={{ maxWidth: "65%", display: "flex", flexDirection: "column", alignItems: isOut ? "flex-end" : "flex-start", gap: 3 }}>
                          {atts.length > 0 && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: isOut ? "flex-end" : "flex-start" }}>
                              {atts.map((att, i) => <AttView key={i} att={att} />)}
                            </div>
                          )}
                          {m.text && !isSystemText(m.text) && (
                            <div style={{ background: bubbleBg, color: bubbleColor, borderRadius: br, padding: "9px 14px", fontSize: 13, lineHeight: 1.55, boxShadow: isOut ? "none" : "0 1px 2px rgba(0,0,0,.06)", border: isOut ? "none" : "1px solid #e8edf2", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                              {m.text}
                            </div>
                          )}
                          <div style={{ fontSize: 10, color: "#94a3b8", padding: "0 2px" }}>
                            {isBot ? "🤖 Bot · " : (isSale || isPage) ? "👤 Sale · " : ""}{fmtTime(m.created_at)}
                          </div>
                        </div>
                        {isOut && <div style={{ width: 28 }} />}
                      </div>
                    )
                  })}
                </div>
              ))}
              <div ref={msgEndRef} />
            </div>

            {/* Bot suggestion */}
            {botSuggestion?.reply_text && !conv?.bot_paused && (
              <div style={{ background: "#f5f3ff", borderTop: "2px solid #ddd6fe", padding: "10px 16px", display: "flex", gap: 10, alignItems: "flex-start", flexShrink: 0 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#7c3aed", marginBottom: 4 }}>🤖 Gợi ý bot · {botSuggestion.intent}</div>
                  <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.5 }}>{botSuggestion.reply_text}</div>
                </div>
                <Btn size="sm" variant="ghost" onClick={() => setText(botSuggestion.reply_text!)}>Dùng</Btn>
              </div>
            )}

            {/* Composer */}
            <div style={{ background: "#fff", borderTop: "1px solid #e8edf2", padding: "10px 16px", flexShrink: 0 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: "8px 12px" }}>
                <textarea value={text} onChange={e => setText(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send() } }}
                  placeholder="Nhập tin nhắn… (Ctrl+Enter gửi)"
                  disabled={!selectedId}
                  rows={1}
                  style={{ flex: 1, resize: "none", border: "none", background: "none", outline: "none", fontSize: 13, fontFamily: "inherit", lineHeight: 1.5, maxHeight: 100, overflow: "auto" }}
                />
                <button onClick={send} disabled={!text.trim() || sending || !selectedId}
                  style={{ background: !text.trim() || !selectedId ? "#e2e8f0" : "#1877f2", color: !text.trim() || !selectedId ? "#94a3b8" : "#fff", border: "none", borderRadius: 8, width: 36, height: 36, cursor: !text.trim() || !selectedId ? "not-allowed" : "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "background 0.15s" }}>
                  ➤
                </button>
              </div>
              <div style={{ fontSize: 10, color: "#cbd5e1", marginTop: 4, textAlign: "right" }}>Ctrl+Enter để gửi</div>
            </div>
          </div>

          {/* ── Right panel ── */}
          <div style={{ background: "#fff", borderLeft: "1px solid #e8edf2", overflow: "auto" }}>
            {!selected
              ? <div style={{ padding: 24, color: "#94a3b8", fontSize: 12, textAlign: "center" }}>Chọn hội thoại</div>
              : (
                <div>
                  {/* Customer card */}
                  <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid #f1f5f9" }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
                      <Avatar name={selected.customer_name || selected.customer_psid} size={44} />
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{selected.customer_name || selected.customer_psid}</div>
                        <div style={{ fontSize: 11, color: "#94a3b8" }}>{selected.page_name}</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {STATUS_CONFIG[selected.status] && selected.status !== "new" && (
                        <Tag label={STATUS_CONFIG[selected.status].label} bg={STATUS_CONFIG[selected.status].bg} color={STATUS_CONFIG[selected.status].color} />
                      )}
                      {conv?.bot_mode && (
                        <Tag label={`🤖 ${MODE_CONFIG[conv.bot_mode]?.label || conv.bot_mode}${selected.bot_paused ? " ⏸" : ""}`}
                          bg="#f5f3ff" color={MODE_CONFIG[conv.bot_mode]?.color || "#7c3aed"} />
                      )}
                      {selected.priority === "high" && <Tag label="⚡ Ưu tiên" bg="#fff7ed" color="#c2410c" />}
                    </div>
                  </div>

                  {/* Context 24h */}
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#3b82f6", marginBottom: 10, display: "flex", alignItems: "center", gap: 4 }}>
                      📍 Context 24h
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <InfoRow icon="📞" label="SĐT" value={conv?.active_phone || selected.active_phone} mono />
                      <InfoRow icon="📦" label="Sản phẩm" value={(conv?.product_names || selected.product_names || []).join(", ") || undefined} />
                      <InfoRow icon="🔖" label="Trạng thái đơn" value={conv?.active_order_state} />
                      {selected.assigned_to && <InfoRow icon="👤" label="Gán cho" value={selected.assigned_to} />}
                    </div>
                  </div>

                  {/* Bot events */}
                  {botEvents.length > 0 && (
                    <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#7c3aed", marginBottom: 8 }}>🤖 Nhật ký Bot</div>
                      {botEvents.slice(0, 4).map(ev => (
                        <div key={ev.id} style={{ background: "#faf5ff", borderRadius: 8, padding: "7px 10px", marginBottom: 6, fontSize: 11 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                            <span style={{ fontWeight: 600, color: ev.auto_sent ? "#10b981" : "#64748b" }}>
                              {ev.auto_sent ? "✅ Đã gửi" : ev.skipped_reason ? `⏭ ${ev.skipped_reason}` : "💡 Gợi ý"}
                            </span>
                            <span style={{ color: "#94a3b8" }}>{fmtAgo(ev.created_at)}</span>
                          </div>
                          {ev.reply_text && <div style={{ color: "#4c1d95", lineHeight: 1.4 }}>{ev.reply_text.slice(0, 80)}{ev.reply_text.length > 80 ? "…" : ""}</div>}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Orders */}
                  {detail?.orders?.length ? (
                    <div style={{ padding: "12px 16px" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#16a34a", marginBottom: 8 }}>🛍 Đơn hàng</div>
                      {detail.orders.map((o: any) => (
                        <div key={o.id} style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "8px 10px", fontSize: 12, marginBottom: 6 }}>
                          {o.medusa_order_id && <div>Medusa: <code>{o.medusa_order_id}</code></div>}
                          {o.pancake_order_id && <div>Pancake: <code>{o.pancake_order_id}</code></div>}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            }
          </div>
        </div>
      )}

      {/* ── AGENTS ── */}
      {view === "agents" && (
        <div style={{ padding: 20, overflow: "auto", flex: 1 }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center" }}>
            <Btn variant="primary" onClick={async () => { await apiJson("/admin/chat/agents", "POST"); loadAgents() }}>⚙ Tạo agent từ danh sách Page</Btn>
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            {agents.length === 0 && <div style={{ color: "#94a3b8", padding: 20, textAlign: "center" }}>Chưa có agent.</div>}
            {agents.map(a => (
              <div key={a.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
                  <Avatar name={a.page_name} size={36} />
                  <div style={{ flex: 1 }}>
                    <b style={{ fontSize: 14 }}>{a.page_name}</b>
                    {a.fan_count ? <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: 6 }}>{a.fan_count.toLocaleString()} followers</span> : null}
                    <div style={{ fontSize: 12, color: "#64748b" }}>{(a.product_names || []).join(", ") || a.sp_chay || ""}</div>
                  </div>
                  <select value={a.mode} onChange={async e => { await apiJson(`/admin/chat/agents/${a.id}`, "PATCH", { mode: e.target.value }); loadAgents() }}
                    style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 10px", fontSize: 12, color: MODE_CONFIG[a.mode]?.color || "#374151", fontWeight: 600 }}>
                    <option value="off">OFF</option>
                    <option value="suggest">Gợi ý</option>
                    <option value="auto_24h">Auto 24h</option>
                    <option value="paused_by_error">Paused</option>
                  </select>
                  {!!a.error_count && <span style={{ color: "#ef4444", fontSize: 12 }}>⚠ {a.error_count}</span>}
                </div>
                <pre style={{ whiteSpace: "pre-wrap", background: "#f8fafc", borderRadius: 8, padding: 10, fontSize: 11, color: "#374151", margin: 0, maxHeight: 140, overflow: "auto", lineHeight: 1.5 }}>
                  {a.manual_override_instruction || a.generated_instruction || "Chưa có instruction"}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── EXAMPLES ── */}
      {view === "examples" && (
        <div style={{ padding: 20, overflow: "auto", flex: 1 }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
            {["pending","approved","rejected"].map(s => (
              <Btn key={s} size="sm" variant={exTab === s ? "primary" : "default"}
                onClick={() => { setExTab(s); loadExamples(s) }}>
                {s === "pending" ? "Chờ duyệt" : s === "approved" ? "Đã duyệt" : "Từ chối"}
              </Btn>
            ))}
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            {examples.length === 0 && <div style={{ color: "#94a3b8", textAlign: "center", padding: 20 }}>Không có câu nào</div>}
            {examples.map(ex => (
              <div key={ex.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                  <b>{ex.page_name}</b>
                  {ex.product_name && <span style={{ fontSize: 12, color: "#64748b" }}>· {ex.product_name}</span>}
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "#94a3b8" }}>{fmtTime(ex.created_at)}</span>
                </div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>Khách hỏi</div>
                <div style={{ background: "#f8fafc", padding: "8px 12px", borderRadius: 8, fontSize: 13, marginBottom: 10 }}>{ex.customer_text}</div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>Sale trả lời</div>
                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "8px 12px", borderRadius: 8, fontSize: 13 }}>{ex.sale_reply}</div>
                {ex.review_status === "pending" && (
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <Btn size="sm" variant="primary" onClick={async () => { await apiJson(`/admin/chat/reply-examples/${ex.id}`, "PATCH", { review_status: "approved" }); loadExamples(exTab) }}>✓ Approve</Btn>
                    <Btn size="sm" variant="danger" onClick={async () => { await apiJson(`/admin/chat/reply-examples/${ex.id}`, "PATCH", { review_status: "rejected" }); loadExamples(exTab) }}>✗ Reject</Btn>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function InfoRow({ icon, label, value, mono }: { icon: string; label: string; value?: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      <span style={{ fontSize: 13, width: 18, flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
        <div style={{ fontSize: 12, color: value ? "#0f172a" : "#d1d5db", fontFamily: mono ? "monospace" : undefined, fontWeight: value ? 500 : 400, wordBreak: "break-word" }}>{value || "—"}</div>
      </div>
    </div>
  )
}

export const config = defineRouteConfig({ label: "Chat", icon: "chat-bubble-left-right" })
