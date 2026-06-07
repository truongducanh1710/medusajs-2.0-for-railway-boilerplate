import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { apiJson } from "../../lib/api-client"

// ─── Types ─────────────────────────────────────────────────────────────────

type Conversation = {
  id: string
  page_id: string
  page_name: string
  customer_name?: string
  customer_psid: string
  status: string
  priority: string
  last_message?: string
  last_message_at?: string
  unread_count: number
  assigned_to?: string
  handoff_reason?: string
  bot_paused: boolean
  bot_mode?: string
  product_names?: string[]
  active_phone?: string
  active_address?: string
  active_order_state?: string
}

type Attachment = {
  type: string // image | video | audio | file | template
  payload?: { url?: string; title?: string }
  name?: string
}

type Message = {
  id: string
  sender_type: string
  direction: string
  text: string
  attachments: Attachment[] | string | null
  created_at: string
}

type BotEvent = {
  id: string
  intent: string
  reply_text?: string
  confidence?: number
  auto_sent: boolean
  skipped_reason?: string
  created_at: string
}

type ConversationDetail = {
  conversation: Conversation & {
    bot_mode?: string
    product_names?: string[]
    active_window_summary?: string
    historical_summary?: string
    generated_instruction?: string
  }
  messages: Message[]
  events: any[]
  orders: any[]
}

type Agent = {
  id: string
  page_id: string
  page_name: string
  mode: string
  product_names?: string[]
  generated_instruction?: string
  manual_override_instruction?: string
  last_generated_at?: string
  error_count?: number
  sp_chay?: string
  fan_count?: number
}

type Example = {
  id: string
  page_name: string
  product_name?: string
  customer_text: string
  sale_reply: string
  bot_handoff_reason?: string
  review_status: string
  created_at: string
}

// ─── Constants ──────────────────────────────────────────────────────────────

const TABS = [
  ["all", "Tất cả"],
  ["unread", "Chưa đọc"],
  ["handoff", "Cần sale xử lý"],
  ["complaint", "Khiếu nại"],
  ["mine", "Đã gán cho tôi"],
] as const

const MODE_LABEL: Record<string, string> = {
  off: "OFF",
  suggest: "GỢI Ý",
  auto_24h: "AUTO 24H",
  paused_by_error: "PAUSED",
}

const MODE_COLOR: Record<string, string> = {
  off: "#6b7280",
  suggest: "#2563eb",
  auto_24h: "#16a34a",
  paused_by_error: "#dc2626",
}

const STATUS_COLOR: Record<string, string> = {
  complaint: "#dc2626",
  handoff: "#d97706",
  assigned: "#2563eb",
  ordered: "#16a34a",
  new: "#6b7280",
  bot_handling: "#7c3aed",
}

const STATUS_LABEL: Record<string, string> = {
  complaint: "Khiếu nại",
  handoff: "Cần sale",
  assigned: "Đang xử lý",
  ordered: "Đã đặt hàng",
  new: "Mới",
  bot_handling: "Bot đang xử lý",
}

const HANDOFF_LABEL: Record<string, string> = {
  customer_requests_human: "Khách cần nhân viên",
  complaint: "Khiếu nại",
  low_confidence: "Bot không chắc",
  outside_24h: "Ngoài 24h",
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtTime(v?: string) {
  if (!v) return ""
  const d = new Date(v)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return "vừa xong"
  if (diffMin < 60) return `${diffMin}p trước`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}h trước`
  return d.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })
}

function fmtDateTime(v?: string) {
  if (!v) return ""
  return new Date(v).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function parseAttachments(raw: Attachment[] | string | null | undefined): Attachment[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try { return JSON.parse(raw as string) } catch { return [] }
}

function AttachmentView({ att }: { att: Attachment }) {
  const url = att.payload?.url
  if (!url) return <span style={{ fontSize: 12, color: "#9ca3af" }}>[{att.type}]</span>
  if (att.type === "image") {
    return (
      <a href={url} target="_blank" rel="noreferrer">
        <img src={url} alt="ảnh" style={{ maxWidth: 220, maxHeight: 220, borderRadius: 8, display: "block", cursor: "pointer" }}
          onError={e => { (e.target as HTMLImageElement).style.display = "none" }} />
      </a>
    )
  }
  if (att.type === "video") {
    return (
      <video src={url} controls style={{ maxWidth: 260, borderRadius: 8, display: "block" }}
        onError={e => {
          const el = e.target as HTMLVideoElement
          el.outerHTML = `<a href="${url}" target="_blank" style="font-size:12px">▶ Xem video</a>`
        }} />
    )
  }
  if (att.type === "audio") {
    return <audio src={url} controls style={{ maxWidth: 240 }} />
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#1877f2" }}>
      📎 {att.payload?.title || att.name || att.type}
    </a>
  )
}

function Info({ label, value, mono }: { label: string; value?: any; mono?: boolean }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 13, color: value ? "#111827" : "#d1d5db", fontWeight: value ? 600 : 400, fontFamily: mono ? "monospace" : undefined }}>{value || "—"}</div>
    </div>
  )
}

function Badge({ label, color, bg }: { label: string; color: string; bg?: string }) {
  return (
    <span style={{ background: bg || color + "18", color, borderRadius: 99, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>{label}</span>
  )
}

function Btn({
  children, onClick, disabled, primary, danger, small, style: extraStyle,
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  primary?: boolean
  danger?: boolean
  small?: boolean
  style?: React.CSSProperties
}) {
  const base: React.CSSProperties = {
    border: "1px solid #d1d5db",
    background: primary ? "#1877f2" : danger ? "#fee2e2" : "#fff",
    color: primary ? "#fff" : danger ? "#dc2626" : "#374151",
    borderColor: primary ? "#1877f2" : danger ? "#fecaca" : "#d1d5db",
    borderRadius: 6,
    padding: small ? "4px 10px" : "7px 12px",
    fontSize: small ? 11 : 12,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    ...extraStyle,
  }
  return <button style={base} onClick={onClick} disabled={disabled}>{children}</button>
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function ChatPage() {
  const [view, setView] = useState<"inbox" | "agents" | "examples">("inbox")
  const [tab, setTab] = useState("all")
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ConversationDetail | null>(null)
  const [botEvents, setBotEvents] = useState<BotEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [examples, setExamples] = useState<Example[]>([])
  const [exampleTab, setExampleTab] = useState("pending")
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const refreshTimer = useRef<any>(null)

  const selected = useMemo(() => conversations.find(c => c.id === selectedId), [conversations, selectedId])

  const filteredConvs = useMemo(() => {
    if (!search.trim()) return conversations
    const s = search.toLowerCase()
    return conversations.filter(c =>
      (c.customer_name || "").toLowerCase().includes(s) ||
      c.customer_psid.toLowerCase().includes(s) ||
      (c.last_message || "").toLowerCase().includes(s) ||
      (c.page_name || "").toLowerCase().includes(s)
    )
  }, [conversations, search])

  // Latest bot suggestion (from suggest mode, not auto-sent)
  const botSuggestion = useMemo(() => {
    return botEvents.find(e => e.reply_text && !e.auto_sent && !e.skipped_reason?.includes("handoff"))
  }, [botEvents])

  const loadConversations = useCallback(async (nextTab = tab) => {
    setLoading(true)
    try {
      const d = await apiJson(`/admin/chat/conversations?status=${nextTab}&limit=80`)
      setConversations(d.conversations || [])
      if (!selectedId && d.conversations?.[0]) setSelectedId(d.conversations[0].id)
    } finally {
      setLoading(false)
    }
  }, [tab, selectedId])

  const loadDetail = useCallback(async (id = selectedId) => {
    if (!id) return
    const [d, evts] = await Promise.all([
      apiJson(`/admin/chat/conversations/${id}`),
      apiJson(`/admin/chat/conversations/${id}/bot-events`).catch(() => ({ events: [] })),
    ])
    setDetail(d)
    setBotEvents(evts.events || [])
  }, [selectedId])

  const loadAgents = useCallback(async () => {
    const d = await apiJson("/admin/chat/agents")
    setAgents(d.agents || [])
  }, [])

  const loadExamples = useCallback(async (status = exampleTab) => {
    const d = await apiJson(`/admin/chat/reply-examples?status=${status}`)
    setExamples(d.examples || [])
  }, [exampleTab])

  // Auto-scroll to latest message
  useEffect(() => {
    if (detail?.messages?.length) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [detail?.messages?.length])

  // Auto-refresh every 15s when viewing inbox
  useEffect(() => {
    if (view !== "inbox") return
    clearInterval(refreshTimer.current)
    refreshTimer.current = setInterval(() => {
      loadConversations(tab)
      if (selectedId) loadDetail(selectedId)
    }, 15000)
    return () => clearInterval(refreshTimer.current)
  }, [view, tab, selectedId])

  useEffect(() => { loadConversations() }, [])
  useEffect(() => { if (selectedId) loadDetail(selectedId) }, [selectedId])
  useEffect(() => {
    if (view === "agents") loadAgents()
    else if (view === "examples") loadExamples(exampleTab)
  }, [view])

  async function send() {
    if (!selectedId || !text.trim() || sending) return
    setSending(true)
    try {
      await apiJson(`/admin/chat/conversations/${selectedId}/send`, "POST", { text })
      setText("")
      await loadDetail(selectedId)
      await loadConversations(tab)
    } finally {
      setSending(false)
    }
  }

  async function syncInbox(pageId?: string) {
    setSyncing(true)
    setSyncResult(null)
    try {
      const d = await apiJson("/admin/chat/sync-inbox", "POST", { page_id: pageId, days: 7 })
      setSyncResult(`✅ Đã lấy ${d.total_saved} tin nhắn từ ${d.pages_synced} page${d.total_errors ? ` (${d.total_errors} lỗi)` : ""}`)
      await loadConversations(tab)
    } catch (e: any) {
      setSyncResult(`❌ Lỗi: ${e.message}`)
    } finally {
      setSyncing(false)
    }
  }

  async function sendSuggestion() {
    if (!botSuggestion?.reply_text) return
    setText(botSuggestion.reply_text)
  }

  async function assignMe() {
    if (!selectedId) return
    await apiJson(`/admin/chat/conversations/${selectedId}/assign-me`, "POST")
    await loadDetail(selectedId)
    await loadConversations(tab)
  }

  async function resumeBot() {
    if (!selectedId) return
    await apiJson(`/admin/chat/conversations/${selectedId}/resume-bot`, "POST")
    await loadDetail(selectedId)
    await loadConversations(tab)
  }

  async function setAgentMode(agent: Agent, mode: string) {
    await apiJson(`/admin/chat/agents/${agent.id}`, "PATCH", { mode })
    await loadAgents()
  }

  async function generateAgents() {
    await apiJson("/admin/chat/agents", "POST")
    await loadAgents()
  }

  async function reviewExample(ex: Example, review_status: "approved" | "rejected") {
    await apiJson(`/admin/chat/reply-examples/${ex.id}`, "PATCH", { review_status })
    await loadExamples(exampleTab)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      send()
    }
  }

  // ─── Styles ───────────────────────────────────────────────────────────────

  const shell: React.CSSProperties = {
    display: "flex", flexDirection: "column",
    height: "calc(100vh - 56px)", margin: -24,
    background: "#f3f4f6", color: "#111827",
    fontFamily: "'Inter', system-ui, sans-serif",
  }

  const conv = detail?.conversation

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={shell}>
      {/* Top nav */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", background: "#fff", borderBottom: "1px solid #e5e7eb", flexShrink: 0 }}>
        <span style={{ fontSize: 18 }}>💬</span>
        <b style={{ fontSize: 15, marginRight: 4 }}>Facebook Chat</b>
        {(["inbox", "agents", "examples"] as const).map(v => (
          <Btn key={v} onClick={() => setView(v)} primary={view === v}
            style={{ borderRadius: 20 }}>
            {v === "inbox" ? "Inbox" : v === "agents" ? "Bot Agents" : "Câu bot cần học"}
          </Btn>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {syncResult && <span style={{ fontSize: 12, color: syncResult.startsWith("✅") ? "#16a34a" : "#dc2626" }}>{syncResult}</span>}
          <Btn onClick={() => syncInbox()} disabled={syncing}>
            {syncing ? "Đang lấy..." : "⬇ Lấy inbox về"}
          </Btn>
          <Btn onClick={() => view === "inbox" ? loadConversations() : view === "agents" ? loadAgents() : loadExamples(exampleTab)}>
            ↺ Refresh
          </Btn>
        </div>
      </div>

      {/* ── INBOX VIEW ─────────────────────────────────────────────────────── */}
      {view === "inbox" && (
        <div style={{ display: "grid", gridTemplateColumns: "300px minmax(0,1fr) 310px", flex: 1, minHeight: 0 }}>

          {/* Left: conversation list */}
          <aside style={{ background: "#fff", borderRight: "1px solid #e5e7eb", display: "flex", flexDirection: "column", minHeight: 0 }}>
            {/* Search */}
            <div style={{ padding: "10px 10px 0" }}>
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Tìm kiếm..."
                style={{ width: "100%", border: "1px solid #e5e7eb", borderRadius: 8, padding: "7px 10px", fontSize: 13, outline: "none", boxSizing: "border-box" }}
              />
            </div>
            {/* Tab filters */}
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", padding: "8px 10px", borderBottom: "1px solid #e5e7eb" }}>
              {TABS.map(([id, label]) => (
                <button key={id} onClick={() => { setTab(id); loadConversations(id) }}
                  style={{
                    border: "1px solid", borderColor: tab === id ? "#1877f2" : "#e5e7eb",
                    background: tab === id ? "#eff6ff" : "#fff",
                    color: tab === id ? "#1877f2" : "#6b7280",
                    borderRadius: 99, padding: "3px 10px", fontSize: 11,
                    fontWeight: tab === id ? 700 : 400, cursor: "pointer",
                  }}>
                  {label}
                </button>
              ))}
            </div>
            {/* List */}
            <div style={{ overflow: "auto", flex: 1 }}>
              {loading && <div style={{ padding: "16px 12px", color: "#9ca3af", fontSize: 13 }}>Đang tải...</div>}
              {!loading && filteredConvs.length === 0 && (
                <div style={{ padding: "16px 12px", color: "#9ca3af", fontSize: 13 }}>Không có hội thoại</div>
              )}
              {filteredConvs.map(c => (
                <button key={c.id} onClick={() => setSelectedId(c.id)}
                  style={{
                    width: "100%", textAlign: "left", border: "none",
                    borderBottom: "1px solid #f3f4f6",
                    background: selectedId === c.id ? "#eff6ff" : c.unread_count > 0 ? "#fafafe" : "#fff",
                    padding: "10px 12px", cursor: "pointer",
                    borderLeft: selectedId === c.id ? "3px solid #1877f2" : "3px solid transparent",
                  }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <b style={{ fontSize: 13 }}>{c.customer_name || c.customer_psid}</b>
                        {c.unread_count > 0 && (
                          <span style={{ background: "#ef4444", color: "#fff", borderRadius: 99, padding: "1px 6px", fontSize: 10 }}>{c.unread_count}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: "#9ca3af" }}>{c.page_name}</div>
                      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {c.last_message}
                      </div>
                    </div>
                    <div style={{ flexShrink: 0, textAlign: "right" }}>
                      <div style={{ fontSize: 10, color: "#9ca3af" }}>{fmtTime(c.last_message_at)}</div>
                      {c.status !== "new" && (
                        <span style={{ color: STATUS_COLOR[c.status] || "#6b7280", fontSize: 10, fontWeight: 700 }}>
                          {STATUS_LABEL[c.status] || c.status}
                        </span>
                      )}
                      {c.priority === "high" && <div style={{ fontSize: 10, color: "#dc2626" }}>⚡ ưu tiên</div>}
                    </div>
                  </div>
                  {c.bot_mode && (
                    <div style={{ marginTop: 4, fontSize: 10, color: MODE_COLOR[c.bot_mode] || "#6b7280" }}>
                      🤖 {MODE_LABEL[c.bot_mode] || c.bot_mode}
                      {c.bot_paused && " · ⏸ dừng"}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </aside>

          {/* Center: conversation */}
          <main style={{ display: "flex", flexDirection: "column", minHeight: 0, background: "#f9fafb" }}>
            {/* Chat header */}
            <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "10px 14px", display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontSize: 14 }}>{conv?.customer_name || selected?.customer_name || selected?.customer_psid || "Chọn hội thoại"}</b>
                {selected?.page_name && <span style={{ fontSize: 12, color: "#9ca3af", marginLeft: 8 }}>{selected.page_name}</span>}
                {conv?.handoff_reason && (
                  <div style={{ marginTop: 3 }}>
                    <Badge label={"Handoff: " + (HANDOFF_LABEL[conv.handoff_reason] || conv.handoff_reason)} color="#d97706" />
                  </div>
                )}
              </div>
              <Btn onClick={assignMe} disabled={!selectedId} small>Nhận xử lý</Btn>
              <Btn onClick={resumeBot} disabled={!selectedId || !selected?.bot_paused} small>Bật lại bot</Btn>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflow: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
              {!selectedId && (
                <div style={{ margin: "auto", color: "#9ca3af", fontSize: 14 }}>Chọn hội thoại để xem tin nhắn</div>
              )}
              {(detail?.messages || []).map((m: Message) => {
                const isOut = m.direction === "outbound"
                const isBot = m.sender_type === "bot"
                const isSale = m.sender_type === "sale"
                const atts = parseAttachments(m.attachments)
                return (
                  <div key={m.id} style={{ display: "flex", justifyContent: isOut ? "flex-end" : "flex-start" }}>
                    <div style={{ maxWidth: "72%" }}>
                      {/* Attachments hiển thị trước bubble text (nếu có) */}
                      {atts.length > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: m.text ? 4 : 0, alignItems: isOut ? "flex-end" : "flex-start" }}>
                          {atts.map((att, i) => <AttachmentView key={i} att={att} />)}
                        </div>
                      )}
                      {/* Text bubble */}
                      {m.text && (
                        <div style={{
                          background: isBot ? "#7c3aed" : isSale ? "#1877f2" : "#fff",
                          color: isOut ? "#fff" : "#111827",
                          borderRadius: isOut ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                          padding: "8px 12px",
                          boxShadow: "0 1px 2px rgba(0,0,0,.07)",
                          border: isOut ? "none" : "1px solid #e5e7eb",
                        }}>
                          <div style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.5 }}>{m.text}</div>
                        </div>
                      )}
                      <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2, textAlign: isOut ? "right" : "left" }}>
                        {isBot ? "🤖 Bot" : isSale ? "👤 Sale" : "🙋 Khách"} · {fmtDateTime(m.created_at)}
                      </div>
                    </div>
                  </div>
                )
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Bot suggestion bar */}
            {botSuggestion?.reply_text && !conv?.bot_paused && (
              <div style={{ background: "#f0f4ff", borderTop: "1px solid #c7d7fe", padding: "10px 14px", display: "flex", gap: 8, alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: "#4f46e5", fontWeight: 700, marginBottom: 3 }}>🤖 Gợi ý từ bot ({botSuggestion.intent})</div>
                  <div style={{ fontSize: 12, color: "#374151", whiteSpace: "pre-wrap" }}>{botSuggestion.reply_text}</div>
                </div>
                <Btn small onClick={sendSuggestion}>Dùng gợi ý này</Btn>
              </div>
            )}

            {/* Composer */}
            <div style={{ display: "flex", gap: 8, padding: "10px 12px", background: "#fff", borderTop: "1px solid #e5e7eb", flexShrink: 0 }}>
              <textarea
                value={text} onChange={e => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Nhập tin nhắn… (Ctrl+Enter để gửi)"
                style={{ flex: 1, resize: "none", minHeight: 52, maxHeight: 140, border: "1px solid #d1d5db", borderRadius: 8, padding: "9px 12px", fontSize: 13, outline: "none", fontFamily: "inherit" }}
              />
              <Btn primary onClick={send} disabled={!text.trim() || sending} style={{ minWidth: 72, alignSelf: "flex-end" }}>
                {sending ? "..." : "Gửi"}
              </Btn>
            </div>
          </main>

          {/* Right: context panel */}
          <aside style={{ background: "#fff", borderLeft: "1px solid #e5e7eb", padding: "14px 14px", overflow: "auto", display: "flex", flexDirection: "column", gap: 0 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>Thông tin khách</h3>

            <Info label="Page" value={conv?.page_name || selected?.page_name} />
            <Info label="Bot mode" value={conv?.bot_mode ? MODE_LABEL[conv.bot_mode] : undefined} />
            <Info label="Trạng thái đơn" value={conv?.active_order_state} />
            {(conv?.product_names || selected?.product_names)?.length ? (
              <Info label="Sản phẩm đang quan tâm" value={(conv?.product_names || selected?.product_names || []).join(", ")} />
            ) : null}

            <hr style={{ border: 0, borderTop: "1px solid #f3f4f6", margin: "10px 0" }} />
            <h4 style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 700, color: "#4f46e5" }}>Context 24h gần nhất</h4>
            <Info label="SĐT" value={conv?.active_phone || selected?.active_phone} mono />
            <Info label="Địa chỉ" value={conv?.active_address || selected?.active_address} />
            <Info label="Assigned to" value={conv?.assigned_to || selected?.assigned_to} />

            {conv?.active_window_summary && (
              <div style={{ background: "#f9fafb", borderRadius: 8, padding: 10, fontSize: 12, color: "#374151", whiteSpace: "pre-wrap", marginBottom: 8, lineHeight: 1.5, maxHeight: 200, overflow: "auto" }}>
                {conv.active_window_summary}
              </div>
            )}

            {conv?.historical_summary && (
              <>
                <h4 style={{ margin: "8px 0 6px", fontSize: 12, fontWeight: 700, color: "#6b7280" }}>Lịch sử tham khảo</h4>
                <div style={{ background: "#f9fafb", borderRadius: 8, padding: 10, fontSize: 11, color: "#6b7280", whiteSpace: "pre-wrap", maxHeight: 120, overflow: "auto" }}>
                  {conv.historical_summary}
                </div>
              </>
            )}

            {/* Bot events */}
            {botEvents.length > 0 && (
              <>
                <hr style={{ border: 0, borderTop: "1px solid #f3f4f6", margin: "12px 0 8px" }} />
                <h4 style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 700, color: "#7c3aed" }}>Nhật ký Bot</h4>
                {botEvents.slice(0, 5).map(ev => (
                  <div key={ev.id} style={{ background: "#faf5ff", borderRadius: 6, padding: "6px 8px", marginBottom: 4, fontSize: 11 }}>
                    <div style={{ color: ev.auto_sent ? "#16a34a" : "#6b7280", fontWeight: 700 }}>
                      {ev.auto_sent ? "✅ Đã gửi tự động" : ev.skipped_reason ? `⏭ ${ev.skipped_reason}` : "💡 Gợi ý"}
                      <span style={{ float: "right", color: "#9ca3af" }}>{fmtTime(ev.created_at)}</span>
                    </div>
                    {ev.reply_text && <div style={{ color: "#374151", marginTop: 3 }}>{ev.reply_text.slice(0, 100)}{ev.reply_text.length > 100 ? "…" : ""}</div>}
                    {ev.intent && <div style={{ color: "#9ca3af" }}>intent: {ev.intent}</div>}
                  </div>
                ))}
              </>
            )}

            {/* Linked orders */}
            {detail?.orders?.length ? (
              <>
                <hr style={{ border: 0, borderTop: "1px solid #f3f4f6", margin: "12px 0 8px" }} />
                <h4 style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 700 }}>Đơn hàng liên kết</h4>
                {detail.orders.map((o: any) => (
                  <div key={o.id} style={{ fontSize: 12, color: "#374151" }}>
                    {o.medusa_order_id && <div>Medusa: <code style={{ fontSize: 11 }}>{o.medusa_order_id}</code></div>}
                    {o.pancake_order_id && <div>Pancake: <code style={{ fontSize: 11 }}>{o.pancake_order_id}</code></div>}
                  </div>
                ))}
              </>
            ) : null}
          </aside>
        </div>
      )}

      {/* ── AGENTS VIEW ────────────────────────────────────────────────────── */}
      {view === "agents" && (
        <div style={{ padding: 16, overflow: "auto", flex: 1 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}>
            <Btn primary onClick={generateAgents}>⚙ Tự động tạo agent từ danh sách Page</Btn>
            <span style={{ fontSize: 12, color: "#9ca3af" }}>Agent sẽ được tạo cho tất cả Page đang có token</span>
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {agents.length === 0 && <div style={{ color: "#9ca3af" }}>Chưa có agent nào. Bấm "Tự động tạo agent" để tạo.</div>}
            {agents.map(a => (
              <div key={a.id} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
                  <div>
                    <b style={{ fontSize: 14 }}>{a.page_name}</b>
                    {a.fan_count && <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: 6 }}>{a.fan_count.toLocaleString()} followers</span>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 12, color: "#6b7280" }}>{(a.product_names || []).join(", ") || a.sp_chay || "Chưa map sản phẩm"}</span>
                  </div>
                  <select value={a.mode} onChange={e => setAgentMode(a, e.target.value)}
                    style={{ border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 8px", fontSize: 12, color: MODE_COLOR[a.mode] || "#374151" }}>
                    <option value="off">OFF — tắt hoàn toàn</option>
                    <option value="suggest">GỢI Ý — bot đề xuất, sale gửi</option>
                    <option value="auto_24h">AUTO 24H — bot tự gửi trong 24h</option>
                    <option value="paused_by_error">PAUSED — tạm dừng</option>
                  </select>
                  {a.error_count ? <Badge label={`${a.error_count} lỗi`} color="#dc2626" /> : null}
                </div>
                <pre style={{ whiteSpace: "pre-wrap", background: "#f9fafb", borderRadius: 8, padding: 10, fontSize: 11, color: "#374151", margin: 0, maxHeight: 180, overflow: "auto" }}>
                  {a.manual_override_instruction || a.generated_instruction || "Chưa có instruction"}
                </pre>
                {a.last_generated_at && (
                  <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 6 }}>Tự động tạo lúc {fmtDateTime(a.last_generated_at)}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── EXAMPLES VIEW ──────────────────────────────────────────────────── */}
      {view === "examples" && (
        <div style={{ padding: 16, overflow: "auto", flex: 1 }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            {["pending", "approved", "rejected"].map(s => (
              <Btn key={s} small primary={exampleTab === s}
                onClick={() => { setExampleTab(s); loadExamples(s) }}>
                {s === "pending" ? "Chờ duyệt" : s === "approved" ? "Đã duyệt" : "Đã từ chối"}
              </Btn>
            ))}
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {examples.length === 0 && <div style={{ color: "#9ca3af" }}>Không có câu nào trong trạng thái này.</div>}
            {examples.map(ex => (
              <div key={ex.id} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 14 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                  <b style={{ fontSize: 13 }}>{ex.page_name || "Page"}</b>
                  {ex.product_name && <span style={{ fontSize: 12, color: "#6b7280" }}>{ex.product_name}</span>}
                  {ex.bot_handoff_reason && <Badge label={`Handoff: ${HANDOFF_LABEL[ex.bot_handoff_reason] || ex.bot_handoff_reason}`} color="#d97706" />}
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "#9ca3af" }}>{fmtDateTime(ex.created_at)}</span>
                </div>
                <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 4 }}>Khách hỏi</div>
                <div style={{ background: "#f9fafb", padding: "8px 10px", borderRadius: 8, fontSize: 13, marginBottom: 8 }}>{ex.customer_text}</div>
                <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 4 }}>Sale trả lời</div>
                <div style={{ background: "#f0fdf4", padding: "8px 10px", borderRadius: 8, fontSize: 13 }}>{ex.sale_reply}</div>
                {ex.review_status === "pending" && (
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <Btn small primary onClick={() => reviewExample(ex, "approved")}>✓ Approve — cho bot học</Btn>
                    <Btn small danger onClick={() => reviewExample(ex, "rejected")}>✗ Reject</Btn>
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
