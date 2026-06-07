import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { apiJson } from "../../lib/api-client"

// ─── Types ──────────────────────────────────────────────────────────────────

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

type Attachment = {
  type: string
  payload?: { url?: string; title?: string }
  name?: string
}

type Message = {
  id: string; sender_type: string; direction: string
  text: string; attachments: Attachment[] | string | null; created_at: string
}

type BotEvent = {
  id: string; intent: string; reply_text?: string
  confidence?: number; auto_sent: boolean
  skipped_reason?: string; created_at: string
}

type ConvDetail = {
  conversation: Conversation & {
    bot_mode?: string; product_names?: string[]
    active_window_summary?: string; historical_summary?: string
    generated_instruction?: string
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

const MODE_COLOR: Record<string, string> = {
  off: "#9ca3af", suggest: "#3b82f6", auto_24h: "#10b981", paused_by_error: "#ef4444",
}
const MODE_LABEL: Record<string, string> = {
  off: "OFF", suggest: "Gợi ý", auto_24h: "Auto 24h", paused_by_error: "Lỗi",
}
const STATUS_DOT: Record<string, string> = {
  complaint: "#ef4444", handoff: "#f59e0b", assigned: "#3b82f6",
  ordered: "#10b981", new: "#d1d5db", bot_handling: "#8b5cf6",
}
const STATUS_LABEL: Record<string, string> = {
  complaint: "Khiếu nại", handoff: "Cần sale", assigned: "Đang xử lý",
  ordered: "Đã đặt", new: "Mới", bot_handling: "Bot xử lý",
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtAgo(v?: string) {
  if (!v) return ""
  const d = new Date(v), now = Date.now(), diff = now - d.getTime()
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

function parseAtts(raw: Attachment[] | string | null | undefined): Attachment[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try { return JSON.parse(raw as string) } catch { return [] }
}

function isCommentReply(text: string) {
  return /ban dang phan hoi binh luan|comment_id=|xem binh luan/i.test(text)
}

function isSystemText(text: string) {
  return isCommentReply(text) || /^\[attachment\]$/i.test(text.trim())
}

// ─── Micro-components ────────────────────────────────────────────────────────

const C = {
  // Muted label
  label: (t: string) => (
    <div style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 3 }}>{t}</div>
  ),
  // Value
  val: (v?: string, mono?: boolean) => (
    <div style={{ fontSize: 13, color: v ? "#111827" : "#d1d5db", fontFamily: mono ? "monospace" : undefined, marginBottom: 10 }}>{v || "—"}</div>
  ),
  divider: () => <div style={{ height: 1, background: "#f3f4f6", margin: "12px 0" }} />,
}

function Btn({ children, onClick, disabled, variant = "default", size = "md", full }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean
  variant?: "default" | "primary" | "danger" | "ghost"
  size?: "sm" | "md"; full?: boolean
}) {
  const bg = variant === "primary" ? "#1877f2" : variant === "danger" ? "#fff" : variant === "ghost" ? "transparent" : "#fff"
  const color = variant === "primary" ? "#fff" : variant === "danger" ? "#ef4444" : "#374151"
  const border = variant === "primary" ? "#1877f2" : variant === "danger" ? "#fca5a5" : variant === "ghost" ? "transparent" : "#e5e7eb"
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: bg, color, border: `1px solid ${border}`,
      borderRadius: 8, padding: size === "sm" ? "4px 10px" : "7px 14px",
      fontSize: size === "sm" ? 11 : 12, fontWeight: 500,
      cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1,
      width: full ? "100%" : undefined, display: "inline-flex", alignItems: "center", gap: 4,
    }}>{children}</button>
  )
}

function AttView({ att }: { att: Attachment }) {
  const url = att.payload?.url
  if (!url) return <span style={{ fontSize: 12, color: "#9ca3af" }}>[{att.type}]</span>
  if (att.type === "image") return (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt="" style={{ maxWidth: 200, maxHeight: 200, borderRadius: 10, display: "block", cursor: "zoom-in", border: "1px solid #e5e7eb" }}
        onError={e => { (e.target as HTMLImageElement).style.display = "none" }} />
    </a>
  )
  if (att.type === "video") return (
    <video src={url} controls style={{ maxWidth: 240, borderRadius: 10 }} />
  )
  if (att.type === "audio") return <audio src={url} controls style={{ maxWidth: 220 }} />
  return <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#3b82f6" }}>📎 {att.payload?.title || att.name || att.type}</a>
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const [view, setView] = useState<"inbox" | "agents" | "examples">("inbox")
  const [tab, setTab] = useState("all")
  const [pageFilter, setPageFilter] = useState("")
  const [pageList, setPageList] = useState<{ page_id: string; page_name: string }[]>([])
  const [convs, setConvs] = useState<Conversation[]>([])
  const [search, setSearch] = useState("")
  const [hasPhone, setHasPhone] = useState(false)
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
    setDetail(d)
    setBotEvents(ev.events || [])
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

  useEffect(() => {
    loadConvs(); loadAgents()
  }, [])

  useEffect(() => {
    if (selectedId) loadDetail(selectedId)
  }, [selectedId])

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

  useEffect(() => {
    if (view === "examples") loadExamples(exTab)
  }, [view])

  async function send() {
    if (!selectedId || !text.trim() || sending) return
    setSending(true)
    try {
      await apiJson(`/admin/chat/conversations/${selectedId}/send`, "POST", { text })
      setText("")
      await loadDetail(selectedId)
      await loadConvs(tab, pageFilter)
    } finally { setSending(false) }
  }

  async function syncInbox() {
    setSyncing(true)
    setSyncMsg("⏳ Đang khởi động...")
    setSyncDetail({})
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
            if (s?.status === "running") {
              setSyncMsg(`⏳ ${s.pages_synced}/${d.pages_count} page...`)
              setTimeout(poll, 2000)
            } else if (s?.status === "done") {
              setSyncMsg(`✅ ${s.total_saved} tin · ${s.pages_synced} page`)
              setSyncing(false)
              loadConvs(tab, pageFilter)
            } else {
              setSyncMsg(`❌ ${s?.error || "Lỗi"}`)
              setSyncing(false)
            }
          } catch { setTimeout(poll, 3000) }
        }
        setTimeout(poll, 2000)
      } else {
        setSyncMsg(`✅ ${d.total_saved || 0} tin`)
        setSyncing(false)
        loadConvs(tab, pageFilter)
      }
    } catch (e: any) {
      setSyncMsg(`❌ ${e.message}`)
      setSyncing(false)
    }
  }

  async function deleteConv(id: string) {
    if (!confirm("Xóa hội thoại này?")) return
    await apiJson(`/admin/chat/conversations/${id}`, "DELETE")
    setSelectedId(null); setDetail(null)
    loadConvs(tab, pageFilter)
  }

  // ── Styles ──────────────────────────────────────────────────────────────────
  const shell: React.CSSProperties = {
    display: "flex", flexDirection: "column",
    height: "calc(100vh - 56px)", margin: -24,
    background: "#f8fafc", color: "#0f172a",
    fontFamily: "Inter, system-ui, sans-serif", fontSize: 13,
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={shell}>

      {/* ── Top bar ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 16px", height: 52, background: "#fff", borderBottom: "1px solid #e2e8f0", flexShrink: 0 }}>
        <span style={{ fontSize: 16 }}>💬</span>
        <b style={{ fontSize: 14, color: "#0f172a" }}>Chat</b>
        <div style={{ width: 1, height: 20, background: "#e2e8f0", margin: "0 4px" }} />
        {(["inbox", "agents", "examples"] as const).map(v => (
          <button key={v} onClick={() => setView(v)} style={{
            border: "none", background: view === v ? "#eff6ff" : "transparent",
            color: view === v ? "#1877f2" : "#64748b",
            borderRadius: 8, padding: "5px 12px", fontSize: 13, fontWeight: view === v ? 600 : 400,
            cursor: "pointer",
          }}>
            {v === "inbox" ? "Inbox" : v === "agents" ? "Bot Agents" : "Câu cần học"}
          </button>
        ))}

        {/* Sync controls — chỉ hiện ở inbox */}
        {view === "inbox" && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            {syncMsg && (
              <span onClick={() => setShowSyncDetail(v => !v)} style={{
                fontSize: 12, cursor: "pointer",
                color: syncMsg.startsWith("✅") ? "#10b981" : syncMsg.startsWith("❌") ? "#ef4444" : "#f59e0b",
              }}>{syncMsg}</span>
            )}
            <select value={pageFilter} onChange={e => { setPageFilter(e.target.value); loadConvs(tab, e.target.value) }}
              style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "5px 8px", fontSize: 12, color: "#374151", maxWidth: 180, background: "#fff" }}>
              <option value="">Tất cả page</option>
              {pageList.map(p => <option key={p.page_id} value={p.page_id}>{p.page_name}</option>)}
            </select>
            <Btn onClick={syncInbox} disabled={syncing} size="sm">
              {syncing ? "Đang sync..." : "⬇ Sync"}
            </Btn>
            <button onClick={() => loadConvs(tab, pageFilter)} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 8, width: 32, height: 32, cursor: "pointer", color: "#64748b", fontSize: 15 }}>↺</button>
          </div>
        )}
      </div>

      {/* Sync detail dropdown */}
      {showSyncDetail && Object.keys(syncDetail).length > 0 && (
        <div style={{ background: "#fffbeb", borderBottom: "1px solid #fde68a", padding: "10px 16px", flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <b style={{ fontSize: 12 }}>Chi tiết sync</b>
            <button onClick={() => setShowSyncDetail(false)} style={{ border: "none", background: "none", cursor: "pointer", color: "#9ca3af" }}>✕</button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {Object.entries(syncDetail).map(([name, r]: [string, any]) => (
              <div key={name} style={{ background: "#fff", border: "1px solid #fde68a", borderRadius: 8, padding: "6px 10px", fontSize: 11 }}>
                <b>{name}</b>
                <span style={{ color: "#10b981", marginLeft: 6 }}>+{r.saved}</span>
                {r.errors?.length > 0 && <span style={{ color: "#ef4444", marginLeft: 4 }}>⚠ {r.errors[0].slice(0, 40)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── INBOX ── */}
      {view === "inbox" && (
        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr 300px", flex: 1, minHeight: 0 }}>

          {/* Left sidebar */}
          <div style={{ background: "#fff", borderRight: "1px solid #e2e8f0", display: "flex", flexDirection: "column", minHeight: 0 }}>
            {/* Search */}
            <div style={{ padding: "10px 12px 6px" }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Tìm kiếm..."
                style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "7px 10px", fontSize: 12, outline: "none", background: "#f8fafc", boxSizing: "border-box" }} />
            </div>
            {/* Tabs */}
            <div style={{ display: "flex", gap: 4, padding: "4px 12px 6px", flexWrap: "wrap" }}>
              {TABS.map(([id, label]) => (
                <button key={id} onClick={() => { setTab(id); loadConvs(id, pageFilter, hasPhone) }} style={{
                  border: "none", background: tab === id ? "#eff6ff" : "transparent",
                  color: tab === id ? "#1877f2" : "#64748b",
                  borderRadius: 6, padding: "3px 9px", fontSize: 11, fontWeight: tab === id ? 600 : 400, cursor: "pointer",
                }}>{label}</button>
              ))}
            </div>
            {/* Filter bar */}
            <div style={{ display: "flex", alignItems: "center", padding: "4px 12px 8px", borderBottom: "1px solid #f1f5f9", gap: 6 }}>
              <button
                onClick={() => { const v = !hasPhone; setHasPhone(v); loadConvs(tab, pageFilter, v) }}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  border: `1px solid ${hasPhone ? "#3b82f6" : "#e2e8f0"}`,
                  background: hasPhone ? "#eff6ff" : "#fff",
                  color: hasPhone ? "#1877f2" : "#64748b",
                  borderRadius: 99, padding: "3px 10px", fontSize: 11,
                  fontWeight: hasPhone ? 600 : 400, cursor: "pointer",
                }}>
                <span style={{ fontSize: 12 }}>📞</span> Có SĐT
              </button>
              <span style={{ fontSize: 10, color: "#cbd5e1", marginLeft: "auto" }}>mới nhất ↑</span>
            </div>
            {/* List */}
            <div style={{ flex: 1, overflow: "auto" }}>
              {loading && <div style={{ padding: 16, color: "#9ca3af", fontSize: 12 }}>Đang tải...</div>}
              {!loading && filtered.length === 0 && <div style={{ padding: 16, color: "#9ca3af", fontSize: 12 }}>Không có hội thoại</div>}
              {filtered.map(c => {
                const isSelected = selectedId === c.id
                return (
                  <button key={c.id} onClick={() => setSelectedId(c.id)} style={{
                    width: "100%", textAlign: "left", border: "none",
                    borderBottom: "1px solid #f8fafc",
                    background: isSelected ? "#eff6ff" : "#fff",
                    padding: "10px 12px", cursor: "pointer",
                    borderLeft: isSelected ? "3px solid #1877f2" : "3px solid transparent",
                  }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                      {/* Avatar placeholder */}
                      <div style={{
                        width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
                        background: "#e0e7ff", color: "#4338ca",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontWeight: 700, fontSize: 13,
                      }}>{(c.customer_name || c.customer_psid)[0]?.toUpperCase()}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ fontWeight: 600, fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {c.customer_name || c.customer_psid}
                          </span>
                          <span style={{ fontSize: 10, color: "#94a3b8", flexShrink: 0 }}>{fmtAgo(c.last_message_at)}</span>
                        </div>
                        <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 2 }}>{c.page_name}</div>
                        <div style={{ fontSize: 12, color: c.unread_count > 0 ? "#0f172a" : "#94a3b8", fontWeight: c.unread_count > 0 ? 600 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {c.last_message}
                        </div>
                        {c.active_phone && (
                          <div style={{ fontSize: 11, color: "#3b82f6", fontFamily: "monospace", marginTop: 2 }}>📞 {c.active_phone}</div>
                        )}
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                          {c.status !== "new" && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, color: STATUS_DOT[c.status] || "#94a3b8" }}>
                              <span style={{ width: 5, height: 5, borderRadius: "50%", background: STATUS_DOT[c.status] || "#d1d5db", display: "inline-block" }} />
                              {STATUS_LABEL[c.status] || c.status}
                            </span>
                          )}
                          {c.bot_mode && c.bot_mode !== "off" && (
                            <span style={{ fontSize: 10, color: MODE_COLOR[c.bot_mode] || "#94a3b8" }}>
                              🤖 {MODE_LABEL[c.bot_mode]}
                              {c.bot_paused && " ⏸"}
                            </span>
                          )}
                          {c.unread_count > 0 && (
                            <span style={{ marginLeft: "auto", background: "#ef4444", color: "#fff", borderRadius: 99, padding: "1px 6px", fontSize: 10, fontWeight: 700 }}>{c.unread_count}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Center: messages */}
          <div style={{ display: "flex", flexDirection: "column", minHeight: 0, background: "#f8fafc" }}>
            {/* Header */}
            <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "10px 16px", display: "flex", gap: 8, alignItems: "center", flexShrink: 0, minHeight: 52 }}>
              {selected ? (
                <>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#e0e7ff", color: "#4338ca", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                    {(selected.customer_name || selected.customer_psid)[0]?.toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{selected.customer_name || selected.customer_psid}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>{selected.page_name}</div>
                  </div>
                  {conv?.handoff_reason && (
                    <span style={{ background: "#fff7ed", color: "#c2410c", border: "1px solid #fed7aa", borderRadius: 99, padding: "2px 10px", fontSize: 11, fontWeight: 600 }}>
                      ⚠ {conv.handoff_reason === "complaint" ? "Khiếu nại" : conv.handoff_reason === "customer_requests_human" ? "Cần nhân viên" : conv.handoff_reason}
                    </span>
                  )}
                  <Btn size="sm" onClick={async () => { await apiJson(`/admin/chat/conversations/${selectedId}/assign-me`, "POST"); loadDetail(selectedId!); loadConvs(tab, pageFilter) }}>Nhận xử lý</Btn>
                  {selected.bot_paused && <Btn size="sm" onClick={async () => { await apiJson(`/admin/chat/conversations/${selectedId}/resume-bot`, "POST"); loadDetail(selectedId!); loadConvs(tab, pageFilter) }}>▶ Bật bot</Btn>}
                  <Btn size="sm" variant="danger" onClick={() => deleteConv(selectedId!)}>Xóa</Btn>
                </>
              ) : (
                <span style={{ color: "#94a3b8", fontSize: 13 }}>Chọn hội thoại để bắt đầu</span>
              )}
            </div>

            {/* Messages list */}
            <div style={{ flex: 1, overflow: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
              {selectedId && detail && (detail.messages || []).length === 0 && (
                <div style={{ margin: "auto", color: "#94a3b8", fontSize: 13, textAlign: "center" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>💬</div>
                  Chưa có tin nhắn nào được lưu
                </div>
              )}
              {(detail?.messages || []).map((m: Message) => {
                const isOut = m.direction === "outbound"
                const isBot = m.sender_type === "bot"
                const isSale = m.sender_type === "sale"
                const isPage = m.sender_type === "page"
                const atts = parseAtts(m.attachments)
                if (!m.text && atts.length === 0) return null
                const commentReply = m.text && isCommentReply(m.text)
                const systemText = m.text && isSystemText(m.text)

                if (commentReply) return (
                  <div key={m.id} style={{ display: "flex", justifyContent: "center" }}>
                    <div style={{ background: "#f1f5f9", borderRadius: 8, padding: "4px 12px", fontSize: 11, color: "#94a3b8" }}>
                      💬 Phản hồi bình luận · {fmtTime(m.created_at)}
                    </div>
                  </div>
                )

                return (
                  <div key={m.id} style={{ display: "flex", justifyContent: isOut ? "flex-end" : "flex-start", gap: 8, alignItems: "flex-end" }}>
                    {!isOut && (
                      <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#e0e7ff", color: "#4338ca", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                        {(conv?.customer_name || selected?.customer_name || "K")[0]}
                      </div>
                    )}
                    <div style={{ maxWidth: "68%", display: "flex", flexDirection: "column", alignItems: isOut ? "flex-end" : "flex-start", gap: 2 }}>
                      {atts.length > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: isOut ? "flex-end" : "flex-start" }}>
                          {atts.map((att, i) => <AttView key={i} att={att} />)}
                        </div>
                      )}
                      {m.text && !systemText && (
                        <div style={{
                          background: isBot ? "#7c3aed" : (isSale || isPage) ? "#1877f2" : "#fff",
                          color: (isBot || isSale || isPage) ? "#fff" : "#0f172a",
                          borderRadius: isOut ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                          padding: "9px 13px", fontSize: 13, lineHeight: 1.5,
                          boxShadow: "0 1px 3px rgba(0,0,0,.08)",
                          border: isOut ? "none" : "1px solid #e2e8f0",
                          whiteSpace: "pre-wrap", wordBreak: "break-word",
                        }}>{m.text}</div>
                      )}
                      <div style={{ fontSize: 10, color: "#94a3b8" }}>
                        {isBot ? "🤖 Bot" : isSale || isPage ? "👤 Sale" : ""}{(isBot || isSale || isPage) ? " · " : ""}{fmtTime(m.created_at)}
                      </div>
                    </div>
                  </div>
                )
              })}
              <div ref={msgEndRef} />
            </div>

            {/* Bot suggestion */}
            {botSuggestion?.reply_text && !conv?.bot_paused && (
              <div style={{ background: "#f5f3ff", borderTop: "2px solid #ddd6fe", padding: "10px 16px", display: "flex", gap: 10, alignItems: "flex-start", flexShrink: 0 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#7c3aed", marginBottom: 4 }}>🤖 Gợi ý bot · {botSuggestion.intent}</div>
                  <div style={{ fontSize: 13, color: "#374151" }}>{botSuggestion.reply_text}</div>
                </div>
                <Btn size="sm" onClick={() => setText(botSuggestion.reply_text!)}>Dùng</Btn>
              </div>
            )}

            {/* Composer */}
            <div style={{ background: "#fff", borderTop: "1px solid #e2e8f0", padding: "12px 16px", flexShrink: 0 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                <textarea value={text} onChange={e => setText(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send() } }}
                  placeholder="Nhập tin nhắn… (Ctrl+Enter gửi)"
                  disabled={!selectedId}
                  style={{ flex: 1, resize: "none", minHeight: 48, maxHeight: 120, border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 13, outline: "none", fontFamily: "inherit", background: selectedId ? "#fff" : "#f8fafc" }}
                />
                <Btn variant="primary" onClick={send} disabled={!text.trim() || sending || !selectedId}>
                  {sending ? "..." : "Gửi"}
                </Btn>
              </div>
            </div>
          </div>

          {/* Right: context panel */}
          <div style={{ background: "#fff", borderLeft: "1px solid #e2e8f0", overflow: "auto", display: "flex", flexDirection: "column" }}>
            {!selected ? (
              <div style={{ padding: 20, color: "#94a3b8", fontSize: 12 }}>Chọn hội thoại</div>
            ) : (
              <div style={{ padding: "14px 16px" }}>
                {/* Customer info */}
                {C.label("Thông tin khách")}
                {C.val(conv?.page_name || selected.page_name)}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                  <div>
                    {C.label("Bot")}
                    <span style={{ fontSize: 12, fontWeight: 600, color: conv?.bot_mode ? MODE_COLOR[conv.bot_mode] : "#94a3b8" }}>
                      {conv?.bot_mode ? MODE_LABEL[conv.bot_mode] : "—"}
                      {selected.bot_paused ? " ⏸" : ""}
                    </span>
                  </div>
                  <div>
                    {C.label("Trạng thái")}
                    <span style={{ fontSize: 12, fontWeight: 600, color: STATUS_DOT[selected.status] || "#94a3b8" }}>
                      {STATUS_LABEL[selected.status] || selected.status}
                    </span>
                  </div>
                </div>

                {(conv?.product_names || selected.product_names)?.length ? (
                  <>
                    {C.label("Sản phẩm quan tâm")}
                    <div style={{ fontSize: 12, color: "#0f172a", marginBottom: 10, fontWeight: 600 }}>
                      {(conv?.product_names || selected.product_names || []).join(", ")}
                    </div>
                  </>
                ) : null}

                {C.divider()}

                {/* Context 24h */}
                <div style={{ background: "#f8fafc", borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#3b82f6", marginBottom: 8 }}>📍 Context 24h gần nhất</div>
                  <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 10px", fontSize: 12 }}>
                    <span style={{ color: "#94a3b8" }}>SĐT</span>
                    <span style={{ fontWeight: 600, color: conv?.active_phone ? "#0f172a" : "#d1d5db", fontFamily: "monospace" }}>{conv?.active_phone || selected.active_phone || "—"}</span>
                    <span style={{ color: "#94a3b8" }}>Địa chỉ</span>
                    <span style={{ color: conv?.active_address && !isSystemText(conv.active_address) ? "#0f172a" : "#d1d5db" }}>
                      {conv?.active_address && !isSystemText(conv.active_address) ? conv.active_address : "—"}
                    </span>
                    <span style={{ color: "#94a3b8" }}>Đơn</span>
                    <span style={{ color: "#0f172a" }}>{conv?.active_order_state || "—"}</span>
                  </div>
                </div>

                {/* Assigned */}
                {(conv?.assigned_to || selected.assigned_to) && (
                  <>
                    {C.label("Được gán cho")}
                    {C.val(conv?.assigned_to || selected.assigned_to)}
                  </>
                )}

                {/* Bot events */}
                {botEvents.length > 0 && (
                  <>
                    {C.divider()}
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#7c3aed", marginBottom: 8 }}>🤖 Nhật ký Bot</div>
                    {botEvents.slice(0, 4).map(ev => (
                      <div key={ev.id} style={{ background: "#faf5ff", borderRadius: 8, padding: "6px 10px", marginBottom: 6, fontSize: 11 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                          <span style={{ fontWeight: 600, color: ev.auto_sent ? "#10b981" : "#64748b" }}>
                            {ev.auto_sent ? "✅ Đã gửi" : ev.skipped_reason ? `⏭ ${ev.skipped_reason}` : "💡 Gợi ý"}
                          </span>
                          <span style={{ color: "#94a3b8" }}>{fmtAgo(ev.created_at)}</span>
                        </div>
                        {ev.reply_text && <div style={{ color: "#374151", lineHeight: 1.4 }}>{ev.reply_text.slice(0, 90)}{ev.reply_text.length > 90 ? "…" : ""}</div>}
                      </div>
                    ))}
                  </>
                )}

                {/* Orders */}
                {detail?.orders?.length ? (
                  <>
                    {C.divider()}
                    {C.label("Đơn hàng liên kết")}
                    {detail.orders.map((o: any) => (
                      <div key={o.id} style={{ fontSize: 12, color: "#374151", marginBottom: 4 }}>
                        {o.medusa_order_id && <div>Medusa: <code style={{ fontSize: 11 }}>{o.medusa_order_id}</code></div>}
                        {o.pancake_order_id && <div>Pancake: <code style={{ fontSize: 11 }}>{o.pancake_order_id}</code></div>}
                      </div>
                    ))}
                  </>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── AGENTS ── */}
      {view === "agents" && (
        <div style={{ padding: 20, overflow: "auto", flex: 1 }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center" }}>
            <Btn variant="primary" onClick={async () => { await apiJson("/admin/chat/agents", "POST"); loadAgents() }}>⚙ Tạo agent từ danh sách Page</Btn>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>Tự động tạo cho tất cả Page có token</span>
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            {agents.length === 0 && <div style={{ color: "#94a3b8", padding: 20, textAlign: "center" }}>Chưa có agent. Bấm "Tạo agent" để bắt đầu.</div>}
            {agents.map(a => (
              <div key={a.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
                  <div>
                    <b style={{ fontSize: 14 }}>{a.page_name}</b>
                    {a.fan_count ? <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: 6 }}>{a.fan_count.toLocaleString()} followers</span> : null}
                  </div>
                  <span style={{ fontSize: 12, color: "#64748b", flex: 1 }}>{(a.product_names || []).join(", ") || a.sp_chay || ""}</span>
                  <select value={a.mode} onChange={async e => { await apiJson(`/admin/chat/agents/${a.id}`, "PATCH", { mode: e.target.value }); loadAgents() }}
                    style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 10px", fontSize: 12, color: MODE_COLOR[a.mode] || "#374151", fontWeight: 600 }}>
                    <option value="off">OFF</option>
                    <option value="suggest">Gợi ý</option>
                    <option value="auto_24h">Auto 24h</option>
                    <option value="paused_by_error">Paused</option>
                  </select>
                  {a.error_count ? <span style={{ color: "#ef4444", fontSize: 12 }}>⚠ {a.error_count} lỗi</span> : null}
                </div>
                <pre style={{ whiteSpace: "pre-wrap", background: "#f8fafc", borderRadius: 8, padding: 10, fontSize: 11, color: "#374151", margin: 0, maxHeight: 160, overflow: "auto", lineHeight: 1.5 }}>
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
            {["pending", "approved", "rejected"].map(s => (
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

export const config = defineRouteConfig({
  label: "Chat",
  icon: "chat-bubble-left-right",
})
