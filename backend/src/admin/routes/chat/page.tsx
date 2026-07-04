import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { apiJson } from "../../lib/api-client"

// ─── Types ───────────────────────────────────────────────────────────────────
type ConvTag = "mua_hang" | "chot_duoc" | "hoi_gia" | "voucher_30k" | "kieu_nai" | "mua_lai"
type Conversation = {
  id: string; page_id: string; page_name: string
  customer_name?: string; customer_psid: string
  status: string; priority: string
  last_message?: string; last_message_at?: string
  unread_count: number; assigned_to?: string
  handoff_reason?: string; bot_paused: boolean; bot_mode?: string
  product_names?: string[]; active_phone?: string
  active_address?: string; active_order_state?: string
  tags?: string[]
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
  conversation: Conversation & { active_window_summary?: string; historical_summary?: string }
  messages: Message[]; events: any[]; orders: any[]
}
type Agent = {
  id: string; page_id: string; page_name: string; mode: string
  product_names?: string[]; generated_instruction?: string
  manual_override_instruction?: string; last_generated_at?: string
  error_count?: number; sp_chay?: string; fan_count?: number
  prompt_score?: number; last_eval_at?: string
  latest_prompt_version?: { id: string; version: number; status: string; score_before?: number; score_after?: number; eval_summary?: string; change_reason?: string; created_at?: string }
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

const STATUS_PIPELINE: { key: string; label: string; color: string; bg: string }[] = [
  { key: "new",          label: "Mới",           color: "#64748b", bg: "#f1f5f9" },
  { key: "consulting",   label: "Tư vấn",        color: "#2563eb", bg: "#dbeafe" },
  { key: "waiting_info", label: "Chờ TT",        color: "#d97706", bg: "#fef3c7" },
  { key: "ordered",      label: "Đã đặt",        color: "#16a34a", bg: "#dcfce7" },
  { key: "complaint",    label: "Khiếu nại",     color: "#dc2626", bg: "#fee2e2" },
  { key: "done",         label: "Xong",          color: "#94a3b8", bg: "#f8fafc" },
]

const CONV_TAGS: { key: ConvTag; label: string; emoji: string; bg: string; color: string }[] = [
  { key: "mua_hang",    label: "Mua hàng",    emoji: "🛍",  bg: "#dcfce7", color: "#16a34a" },
  { key: "chot_duoc",   label: "Chốt được",   emoji: "💰",  bg: "#d1fae5", color: "#059669" },
  { key: "hoi_gia",     label: "Hỏi giá",     emoji: "❓",  bg: "#f1f5f9", color: "#64748b" },
  { key: "voucher_30k", label: "Voucher 30K",  emoji: "🎁",  bg: "#fff7ed", color: "#c2410c" },
  { key: "kieu_nai",    label: "Khiếu nại",   emoji: "⚠️", bg: "#fee2e2", color: "#dc2626" },
  { key: "mua_lai",     label: "Mua lại",     emoji: "🔄",  bg: "#ede9fe", color: "#7c3aed" },
]

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = Object.fromEntries(
  STATUS_PIPELINE.map(s => [s.key, { label: s.label, bg: s.bg, color: s.color }])
)
STATUS_CONFIG["handoff"]      = { label: "Cần sale",   bg: "#fef3c7", color: "#d97706" }
STATUS_CONFIG["assigned"]     = { label: "Đang xử lý", bg: "#dbeafe", color: "#2563eb" }
STATUS_CONFIG["bot_handling"] = { label: "Bot xử lý",  bg: "#ede9fe", color: "#7c3aed" }

const MODE_CONFIG: Record<string, { label: string; color: string }> = {
  off:             { label: "OFF",       color: "#94a3b8" },
  suggest:         { label: "Gợi ý",    color: "#3b82f6" },
  auto_24h:        { label: "Auto 24h", color: "#10b981" },
  paused_by_error: { label: "Lỗi",      color: "#ef4444" },
}

const phoneDigits = (value?: string | null) => String(value || "").replace(/\D/g, "")
const hasValidPhone = (value?: string | null) => /^(0|84)(3|5|7|8|9)\d{8}$/.test(phoneDigits(value))

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
function avatarChar(name?: string) { return (name || "?")[0].toUpperCase() }
function avatarColor(name?: string) {
  const colors = ["#6366f1","#ec4899","#f59e0b","#10b981","#3b82f6","#8b5cf6","#ef4444","#14b8a6"]
  let h = 0; for (const c of (name || "")) h = (h * 31 + c.charCodeAt(0)) & 0xff
  return colors[h % colors.length]
}
function convTags(c: Conversation): string[] {
  if (!c.tags) return []
  if (Array.isArray(c.tags)) return c.tags
  try { return JSON.parse(c.tags as any) } catch { return [] }
}

// ─── Micro UI ────────────────────────────────────────────────────────────────
function Avatar({ name, size = 36 }: { name?: string; size?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: avatarColor(name), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: size * 0.38, flexShrink: 0, userSelect: "none" }}>
      {avatarChar(name)}
    </div>
  )
}
function Chip({ label, bg, color, emoji }: { label: string; bg: string; color: string; emoji?: string }) {
  return <span style={{ background: bg, color, borderRadius: 4, padding: "1px 7px", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>{emoji ? `${emoji} ` : ""}{label}</span>
}
function Btn({ children, onClick, disabled, variant = "default", size = "md" }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean
  variant?: "default" | "primary" | "danger" | "ghost" | "success"
  size?: "xs" | "sm" | "md"
}) {
  const styles: Record<string, React.CSSProperties> = {
    default: { background: "#fff",    color: "#374151", border: "1px solid #e2e8f0" },
    primary: { background: "#1877f2", color: "#fff",    border: "1px solid #1877f2" },
    danger:  { background: "#fff5f5", color: "#ef4444", border: "1px solid #fecaca" },
    ghost:   { background: "transparent", color: "#64748b", border: "1px solid transparent" },
    success: { background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0" },
  }
  const pad = size === "xs" ? "2px 8px" : size === "sm" ? "5px 12px" : "7px 16px"
  const fs  = size === "xs" ? 11 : size === "sm" ? 12 : 13
  return (
    <button onClick={onClick} disabled={disabled} style={{ ...styles[variant], borderRadius: 8, padding: pad, fontSize: fs, fontWeight: 500, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1, display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
      {children}
    </button>
  )
}
function AttView({ att }: { att: Attachment }) {
  const url = att.payload?.url
  if (!url) return <span style={{ fontSize: 12, color: "#9ca3af" }}>[{att.type}]</span>
  if (att.type === "image") return (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt="" style={{ maxWidth: 220, maxHeight: 220, borderRadius: 12, display: "block", cursor: "zoom-in", objectFit: "cover" }} onError={e => { (e.target as HTMLImageElement).style.display = "none" }} />
    </a>
  )
  if (att.type === "video") return <video src={url} controls style={{ maxWidth: 260, borderRadius: 12 }} />
  if (att.type === "audio") return <audio src={url} controls style={{ maxWidth: 240 }} />
  return <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#3b82f6" }}>📎 {att.payload?.title || att.name || att.type}</a>
}
function DateSep({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "8px 0" }}>
      <div style={{ flex: 1, height: 1, background: "#f1f5f9" }} />
      <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500 }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: "#f1f5f9" }} />
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

function makeMessageReadable(text: string) {
  return String(text || "")
    .replace(/\s+-\s+(\*\*?Combo\b)/gi, "\n- $1")
    .replace(/\s+-\s+(Combo\s+\d+\b)/gi, "\n- $1")
    .replace(/\s+(\*\*Combo\s+\d+\*\*\s*:)/gi, "\n- $1")
    .replace(/\s+(Combo\s+\d+\s*:)/gi, "\n- $1")
    .trim()
}

function InlineMessageText({ text }: { text: string }) {
  const parts = String(text || "").split(/(\*\*[^*]+\*\*)/g)
  return <>{parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} style={{ fontWeight: 700 }}>{part.slice(2, -2)}</strong>
    }
    return <span key={i}>{part}</span>
  })}</>
}

function MessageText({ text }: { text: string }) {
  const lines = makeMessageReadable(text).split(/\n+/).filter(Boolean)
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {lines.map((line, i) => {
        const isBullet = /^\s*[-•]\s+/.test(line)
        const content = line.replace(/^\s*[-•]\s+/, "")
        return (
          <div key={i} style={{ display: isBullet ? "grid" : "block", gridTemplateColumns: isBullet ? "12px minmax(0, 1fr)" : undefined, gap: isBullet ? 6 : undefined }}>
            {isBullet && <span style={{ opacity: 0.7, lineHeight: 1.55 }}>•</span>}
            <span style={{ minWidth: 0 }}><InlineMessageText text={content} /></span>
          </div>
        )
      })}
    </div>
  )
}
// ─── Status Pipeline Bar ─────────────────────────────────────────────────────
function StatusPipeline({ current, onChange }: { current: string; onChange: (s: string) => void }) {
  return (
    <div style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9" }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Trạng thái</div>
      <div style={{ display: "flex", gap: 3 }}>
        {STATUS_PIPELINE.map((s, i) => {
          const isActive = current === s.key
          return (
            <button key={s.key} onClick={() => onChange(s.key)} title={s.label} style={{
              flex: 1, padding: "5px 2px", fontSize: 10, fontWeight: isActive ? 700 : 500,
              background: isActive ? s.bg : "#f8fafc",
              color: isActive ? s.color : "#94a3b8",
              border: isActive ? `1.5px solid ${s.color}` : "1.5px solid #e2e8f0",
              borderRadius: i === 0 ? "6px 0 0 6px" : i === STATUS_PIPELINE.length - 1 ? "0 6px 6px 0" : 0,
              cursor: "pointer", textAlign: "center", whiteSpace: "nowrap", overflow: "hidden",
              transition: "all 0.1s",
            }}>{s.label}</button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Tag Picker ──────────────────────────────────────────────────────────────
function TagPicker({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const toggle = (key: string) => {
    onChange(tags.includes(key) ? tags.filter(t => t !== key) : [...tags, key])
  }
  return (
    <div style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9" }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Tags</div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {CONV_TAGS.map(t => {
          const active = tags.includes(t.key)
          return (
            <button key={t.key} onClick={() => toggle(t.key)} style={{
              background: active ? t.bg : "#f8fafc",
              color: active ? t.color : "#94a3b8",
              border: active ? `1.5px solid ${t.color}` : "1.5px solid #e2e8f0",
              borderRadius: 6, padding: "3px 9px", fontSize: 11, fontWeight: active ? 700 : 400,
              cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3,
              transition: "all 0.1s",
            }}>
              {t.emoji} {t.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function ChatPage() {
  const [view, setView]           = useState<"inbox" | "agents" | "examples" | "settings" | "pancake" | "test-bot">("inbox")
  const [tab, setTab]             = useState("all")
  const [pageFilter, setPageFilter] = useState("")
  const [tagFilter, setTagFilter] = useState<string>("")
  const [hasPhone, setHasPhone]   = useState(false)
  const [pageList, setPageList]   = useState<{ page_id: string; page_name: string }[]>([])
  const [convs, setConvs]         = useState<Conversation[]>([])
  const [search, setSearch]       = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail]       = useState<ConvDetail | null>(null)
  const [botEvents, setBotEvents] = useState<BotEvent[]>([])
  const [loading, setLoading]     = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore]     = useState(false)
  const [text, setText]           = useState("")
  const [sending, setSending]     = useState(false)
  const [syncing, setSyncing]     = useState(false)
  const [syncMsg, setSyncMsg]     = useState("")
  const [syncDetail, setSyncDetail] = useState<Record<string, any>>({})
  const [showSyncDetail, setShowSyncDetail] = useState(false)
  const [agents, setAgents]       = useState<Agent[]>([])
  const [examples, setExamples]   = useState<Example[]>([])
  const [exTab, setExTab]         = useState("pending")
  const [settingPages, setSettingPages] = useState<any[]>([])
  const [settingPagesErr, setSettingPagesErr] = useState<string>("")
  const [pancakePages, setPancakePages] = useState<any[]>([])
  const [pcDraft, setPcDraft]     = useState<Record<string, string>>({})
  const [testPageId, setTestPageId] = useState("")
  const [testMessages, setTestMessages] = useState<{ role: "customer" | "bot"; text: string }[]>([])
  const [testInput, setTestInput] = useState("")
  const [testSending, setTestSending] = useState(false)
  const [testToolCalls, setTestToolCalls] = useState<{ name: string; args: any; result: any }[]>([])
  const [testActions, setTestActions] = useState<{ type: string; reason?: string }[]>([])
  const [promptBusy, setPromptBusy] = useState<Record<string, string>>({})
  const [promptLoopResults, setPromptLoopResults] = useState<Record<string, any>>({})
  const [promptLoopLogs, setPromptLoopLogs] = useState<Record<string, string[]>>({})
  const [pcBusy, setPcBusy]       = useState<string>("")
  const msgEndRef  = useRef<HTMLDivElement>(null)
  const msgTopRef  = useRef<HTMLDivElement>(null)
  const msgAreaRef = useRef<HTMLDivElement>(null)
  const timerRef   = useRef<any>(null)

  const selected = useMemo(() => convs.find(c => c.id === selectedId), [convs, selectedId])
  const conv     = detail?.conversation

  // Frontend filter
  const filtered = useMemo(() => {
    const hasSearch = !!search.trim()
    let list = convs
    if (!hasSearch && hasPhone) list = list.filter(c => hasValidPhone(c.active_phone))
    if (!hasSearch && tagFilter) list = list.filter(c => convTags(c).includes(tagFilter))
    if (!hasSearch) return list
    const s = search.toLowerCase()
    const digits = phoneDigits(search)
    return list.filter(c =>
      (c.customer_name || "").toLowerCase().includes(s) ||
      c.customer_psid.toLowerCase().includes(s) ||
      (c.last_message || "").toLowerCase().includes(s) ||
      (c.active_phone || "").toLowerCase().includes(s) ||
      (!!digits && phoneDigits(c.active_phone).includes(digits))
    )
  }, [convs, tagFilter, hasPhone, search])

  const botSuggestion = useMemo(() =>
    botEvents.find(e => e.reply_text && !e.auto_sent && !e.skipped_reason?.includes("handoff")),
    [botEvents]
  )
  const groupedMessages = useMemo(() => {
    const msgs = detail?.messages || []
    const groups: { date: string; messages: Message[] }[] = []
    for (const m of msgs) {
      const d = fmtDateOnly(m.created_at)
      if (!groups.length || groups[groups.length - 1].date !== d) groups.push({ date: d, messages: [m] })
      else groups[groups.length - 1].messages.push(m)
    }
    return groups
  }, [detail?.messages])

  const loadConvs = useCallback(async (t = tab, p = pageFilter, hp = hasPhone, q = search) => {
    setLoading(true)
    try {
      const term = q.trim()
      let url = `/admin/chat/conversations?status=${term ? "all" : t}&limit=100`
      if (!term && p) url += `&page_id=${p}`
      if (!term && hp) url += `&has_phone=1`
      if (term) url += `&q=${encodeURIComponent(term)}`
      const d = await apiJson(url)
      setConvs(d.conversations || [])
    } finally { setLoading(false) }
  }, [tab, pageFilter, hasPhone, search])

  const loadDetail = useCallback(async (id = selectedId) => {
    if (!id) return
    const [d, ev] = await Promise.all([
      apiJson(`/admin/chat/conversations/${id}`),
      apiJson(`/admin/chat/conversations/${id}/bot-events`).catch(() => ({ events: [] })),
    ])
    // API trả về DESC (mới nhất trước), reverse lại để hiển thị cũ→mới
    if (d?.messages) d.messages = [...d.messages].reverse()
    setHasMore((d?.messages?.length || 0) >= 60)
    setDetail(d); setBotEvents(ev.events || [])
  }, [selectedId])

  const loadMoreMessages = useCallback(async () => {
    if (!selectedId || !detail?.messages?.length || loadingMore) return
    setLoadingMore(true)
    try {
      const oldest = detail.messages[0]?.created_at
      const d = await apiJson(`/admin/chat/conversations/${selectedId}?before=${encodeURIComponent(oldest)}`)
      if (!d?.messages?.length) { setHasMore(false); return }
      const older = [...d.messages].reverse()
      setHasMore(older.length >= 60)
      // Prepend older messages, giữ scroll position
      const area = msgAreaRef.current
      const prevHeight = area?.scrollHeight || 0
      setDetail(prev => prev ? { ...prev, messages: [...older, ...prev.messages] } : prev)
      // Restore scroll sau khi DOM update
      requestAnimationFrame(() => {
        if (area) area.scrollTop = area.scrollHeight - prevHeight
      })
    } finally { setLoadingMore(false) }
  }, [selectedId, detail, loadingMore])

  const loadSettingPages = useCallback(async () => {
    try {
      const d = await apiJson("/admin/chat/pages")
      setSettingPages(d.pages || [])
      setSettingPagesErr("")
    } catch (e: any) {
      setSettingPagesErr(e?.message || "Không tải được danh sách page")
    }
  }, [])

  const loadPancakePages = useCallback(async () => {
    try {
      const d = await apiJson("/admin/chat/pancake-pages")
      setPancakePages(d.pages || [])
    } catch (e: any) {
      console.error("loadPancakePages failed:", e?.message)
    }
  }, [])

  const savePancakeToken = useCallback(async (fbPageId: string, token: string) => {
    setPcBusy(fbPageId)
    try {
      await apiJson("/admin/chat/pancake-pages", "PATCH", { fb_page_id: fbPageId, page_access_token: token })
      setPcDraft(prev => { const n = { ...prev }; delete n[fbPageId]; return n })
      await loadPancakePages()
    } finally { setPcBusy("") }
  }, [loadPancakePages])

  const togglePancake = useCallback(async (fbPageId: string, enabled: boolean) => {
    setPcBusy(fbPageId)
    try {
      await apiJson("/admin/chat/pancake-pages", "PATCH", { fb_page_id: fbPageId, enabled })
      await loadPancakePages()
    } finally { setPcBusy("") }
  }, [loadPancakePages])

  const testPancakeToken = useCallback(async (fbPageId: string) => {
    setPcBusy(fbPageId)
    try {
      const r = await apiJson("/admin/chat/pancake-pages", "POST", { fb_page_id: fbPageId })
      alert(r.ok ? `✅ Token OK — ${r.sample?.count ?? 0} hội thoại${r.sample?.first ? ` (vd: ${r.sample.first})` : ""}` : `❌ Lỗi: ${r.error || "không rõ"}`)
      await loadPancakePages()
    } finally { setPcBusy("") }
  }, [loadPancakePages])

  const loadAgents = useCallback(async () => {
    const d = await apiJson("/admin/chat/agents")
    setAgents(d.agents || [])
  }, [])

  const appendPromptLoopLog = useCallback((agentId: string, line: string) => {
    setPromptLoopLogs(prev => ({ ...prev, [agentId]: [...(prev[agentId] || []), `${new Date().toLocaleTimeString("vi-VN")} - ${line}`].slice(-80) }))
  }, [])

  const runPromptLoop = useCallback(async (agentId: string) => {
    const timers: any[] = []
    setPromptBusy(prev => ({ ...prev, [agentId]: "loop" }))
    setPromptLoopResults(prev => { const n = { ...prev }; delete n[agentId]; return n })
    setPromptLoopLogs(prev => ({ ...prev, [agentId]: [`${new Date().toLocaleTimeString("vi-VN")} - Bắt đầu AI test loop`] }))
    const schedule = (ms: number, line: string) => timers.push(setTimeout(() => appendPromptLoopLog(agentId, line), ms))
    schedule(1500, "Tạo tình huống khách hàng giả lập")
    schedule(5000, "Test prompt hiện tại với từng tình huống")
    schedule(9500, "Evaluator chấm điểm câu trả lời hiện tại")
    schedule(14000, "Sinh draft prompt cải thiện")
    schedule(19000, "Test lại bằng draft prompt")
    schedule(24000, "Lưu draft prompt, chờ admin duyệt")
    try {
      const r = await apiJson(`/admin/chat/agents/${agentId}/prompt-loop`, "POST", { scenario_count: 3 })
      setPromptLoopResults(prev => ({ ...prev, [agentId]: r }))
      const detailLines = [
        `Hoàn tất: ${r.score_before}/10 -> ${r.score_after}/10`,
        ...(r.before || []).map((x: any, i: number) => `Scenario ${i + 1}: "${x.customer}" | hiện tại ${x.evaluation?.score ?? "-"}/10${x.evaluation?.issues?.length ? ` | lỗi: ${x.evaluation.issues.join("; ")}` : ""}`),
        ...(r.after || []).map((x: any, i: number) => `Draft ${i + 1}: ${x.evaluation?.score ?? "-"}/10${x.evaluation?.issues?.length ? ` | còn lỗi: ${x.evaluation.issues.join("; ")}` : ""}`),
      ]
      setPromptLoopLogs(prev => ({ ...prev, [agentId]: [...(prev[agentId] || []), ...detailLines].slice(-80) }))
      await loadAgents()
    } catch (e: any) {
      appendPromptLoopLog(agentId, `Lỗi: ${e.message}`)
      alert(`Không chạy được loop: ${e.message}`)
    } finally {
      timers.forEach(clearTimeout)
      setPromptBusy(prev => { const n = { ...prev }; delete n[agentId]; return n })
    }
  }, [appendPromptLoopLog, loadAgents])
  const activatePromptDraft = useCallback(async (agentId: string, promptId: string) => {
    setPromptBusy(prev => ({ ...prev, [agentId]: "activate" }))
    try {
      await apiJson(`/admin/chat/agents/${agentId}/prompts/${promptId}/activate`, "POST")
      await loadAgents()
    } catch (e: any) {
      alert(`Không duyệt được prompt: ${e.message}`)
    } finally {
      setPromptBusy(prev => { const n = { ...prev }; delete n[agentId]; return n })
    }
  }, [loadAgents])

  const sendTestMessage = useCallback(async () => {
    const text = testInput.trim()
    if (!text || !testPageId || testSending) return
    setTestSending(true)
    const page = agents.find(a => a.page_id === testPageId)
    const historyForApi = testMessages
    setTestMessages(prev => [...prev, { role: "customer", text }])
    setTestInput("")
    try {
      const r = await apiJson("/admin/chat/bot-test", "POST", {
        page_id: testPageId,
        page_name: page?.page_name,
        messages: historyForApi,
        text,
      })
      const bubbles: string[] = r.bubbles || []
      setTestMessages(prev => [...prev, ...bubbles.map((b: string) => ({ role: "bot" as const, text: b }))])
      setTestToolCalls(r.tool_calls || [])
      setTestActions(r.actions || [])
      if (!bubbles.length && r.actions?.length) {
        setTestMessages(prev => [...prev, { role: "bot", text: `[Không trả lời — action: ${r.actions.map((a: any) => a.type).join(", ")}]` }])
      }
    } catch (e: any) {
      setTestMessages(prev => [...prev, { role: "bot", text: `⚠ Lỗi: ${e.message}` }])
    } finally {
      setTestSending(false)
    }
  }, [testInput, testPageId, testSending, testMessages, agents])

  // Dropdown lọc page ở topbar: chỉ liệt kê page đang bật (sync_enabled).
  const loadPageFilterList = useCallback(async () => {
    try {
      const d = await apiJson("/admin/chat/pages")
      setPageList((d.pages || [])
        .filter((p: any) => p.sync_enabled)
        .map((p: any) => ({ page_id: p.page_id, page_name: p.page_name })))
    } catch (e: any) {
      console.error("loadPageFilterList failed:", e?.message)
    }
  }, [])

  const loadExamples = useCallback(async (s = exTab) => {
    const d = await apiJson(`/admin/chat/reply-examples?status=${s}`)
    setExamples(d.examples || [])
  }, [exTab])

  const patchConv = useCallback(async (fields: Record<string, any>) => {
    if (!selectedId) return
    await apiJson(`/admin/chat/conversations/${selectedId}`, "PATCH", fields)
    // Update local state optimistically
    setConvs(prev => prev.map(c => c.id === selectedId ? { ...c, ...fields } : c))
    setDetail(prev => prev ? { ...prev, conversation: { ...prev.conversation, ...fields } } : prev)
  }, [selectedId])

  useEffect(() => { loadConvs(); loadAgents(); loadPageFilterList() }, [])
  useEffect(() => {
    if (view !== "inbox") return
    const handle = setTimeout(() => loadConvs(tab, pageFilter, hasPhone, search), 250)
    return () => clearTimeout(handle)
  }, [search, tab, pageFilter, hasPhone, view, loadConvs])
  useEffect(() => { if (selectedId) loadDetail(selectedId) }, [selectedId])
  const prevSelectedId = useRef<string | null>(null)
  useEffect(() => {
    if (!detail?.messages?.length) return
    // Chỉ scroll xuống cuối khi lần đầu load conv (không phải load-more)
    if (selectedId !== prevSelectedId.current) {
      prevSelectedId.current = selectedId
      msgEndRef.current?.scrollIntoView({ behavior: "auto" })
    }
  }, [detail?.messages])
  useEffect(() => {
    if (view !== "inbox") return

    // SSE — nhận push event khi có tin mới
    let es: EventSource | null = null
    let retryTimer: any = null

    const connectSSE = () => {
      es = new EventSource("/admin/chat/events")
      es.addEventListener("new_message", (e: MessageEvent) => {
        const data = JSON.parse(e.data || "{}")
        loadConvs(tab, pageFilter, hasPhone, search)
        if (selectedId && data.conversation_id === selectedId) loadDetail(selectedId)
      })
      es.onerror = () => {
        es?.close()
        // Reconnect sau 5s nếu SSE bị drop
        retryTimer = setTimeout(connectSSE, 5000)
      }
    }
    connectSSE()

    // Fallback polling 30s — bắt các thay đổi không qua webhook (assign, status...)
    clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      loadConvs(tab, pageFilter, hasPhone, search)
      if (selectedId) loadDetail(selectedId)
    }, 30000)

    return () => {
      es?.close()
      clearTimeout(retryTimer)
      clearInterval(timerRef.current)
    }
  }, [view, tab, pageFilter, hasPhone, search, selectedId, loadConvs])
  useEffect(() => { if (view === "examples") loadExamples(exTab) }, [view])
  useEffect(() => { if (view === "settings") loadSettingPages() }, [view])
  useEffect(() => { if (view === "pancake") loadPancakePages() }, [view])

  async function send() {
    if (!selectedId || !text.trim() || sending) return
    setSending(true)
    try {
      const r = await apiJson(`/admin/chat/conversations/${selectedId}/send`, "POST", { text })
      if (r?.error) { alert(`Lỗi gửi tin: ${r.error}`); return }
      setText(""); await loadDetail(selectedId); await loadConvs(tab, pageFilter)
    } catch (e: any) {
      alert(`Lỗi gửi tin: ${e?.message || "Không rõ lỗi"}`)
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
            else if (s?.status === "done") { setSyncMsg(`✅ ${s.total_saved} tin · ${s.pages_synced} page`); setSyncing(false); loadConvs(tab, pageFilter) }
            else { setSyncMsg(`❌ ${s?.error || "Lỗi"}`); setSyncing(false) }
          } catch { setTimeout(poll, 3000) }
        }
        setTimeout(poll, 2000)
      } else { setSyncMsg(`✅ ${d.total_saved || 0} tin`); setSyncing(false); loadConvs(tab, pageFilter) }
    } catch (e: any) { setSyncMsg(`❌ ${e.message}`); setSyncing(false) }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 56px)", margin: -24, background: "#f8fafc", fontFamily: "Inter,system-ui,sans-serif", fontSize: 13, color: "#0f172a" }}>

      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 2, padding: "0 16px", height: 50, background: "#fff", borderBottom: "1px solid #e8edf2", flexShrink: 0 }}>
        <span style={{ fontSize: 18, marginRight: 6 }}>💬</span>
        <b style={{ fontSize: 15, marginRight: 8 }}>Chat</b>
        {(["inbox","agents","examples","settings","pancake","test-bot"] as const).map(v => (
          <button key={v} onClick={() => setView(v)} style={{ border: "none", background: "none", color: view === v ? "#1877f2" : "#64748b", borderBottom: view === v ? "2px solid #1877f2" : "2px solid transparent", padding: "0 14px", height: 50, fontSize: 13, fontWeight: view === v ? 600 : 400, cursor: "pointer" }}>
            {v === "inbox" ? "Inbox" : v === "agents" ? "Bot Agents" : v === "examples" ? "Câu cần học" : v === "settings" ? "⚙ Cài đặt" : v === "pancake" ? "🥞 Pancake" : "🧪 Test bot"}
          </button>
        ))}
        {view === "inbox" && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            {syncMsg && (
              <span onClick={() => setShowSyncDetail(v => !v)} style={{ fontSize: 12, cursor: "pointer", color: syncMsg.startsWith("✅") ? "#10b981" : syncMsg.startsWith("❌") ? "#ef4444" : "#f59e0b" }}>
                {syncMsg}
              </span>
            )}
            <select value={pageFilter} onChange={e => { setPageFilter(e.target.value); loadConvs(tab, e.target.value) }}
              style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "5px 8px", fontSize: 12, maxWidth: 180, background: "#fff" }}>
              <option value="">Tất cả page</option>
              {pageList.map(p => <option key={p.page_id} value={p.page_id}>{p.page_name}</option>)}
            </select>
            <Btn onClick={syncInbox} disabled={syncing} size="sm">⬇ {syncing ? "Đang sync..." : "Sync"}</Btn>
            <button onClick={() => loadConvs(tab, pageFilter)} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 8, width: 32, height: 32, cursor: "pointer", fontSize: 15, color: "#64748b" }}>↺</button>
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
                  style={{ border: "none", background: "none", outline: "none", fontSize: 12, flex: 1 }} />
              </div>
            </div>

            {/* Status tabs */}
            <div style={{ display: "flex", padding: "8px 10px 4px", gap: 2, flexWrap: "wrap" }}>
              {TABS.map(([id, label]) => (
                <button key={id} onClick={() => { setTab(id); loadConvs(id, pageFilter) }} style={{ border: "none", background: tab === id ? "#eff6ff" : "transparent", color: tab === id ? "#1877f2" : "#64748b", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: tab === id ? 600 : 400, cursor: "pointer" }}>{label}</button>
              ))}
            </div>

            {/* Filter row */}
            <div style={{ padding: "4px 10px 8px", borderBottom: "1px solid #f1f5f9" }}>
              {/* Tag filter pills */}
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
                <button onClick={() => setTagFilter("")} style={{ background: tagFilter === "" ? "#eff6ff" : "#f8fafc", color: tagFilter === "" ? "#1877f2" : "#94a3b8", border: `1px solid ${tagFilter === "" ? "#bfdbfe" : "#e2e8f0"}`, borderRadius: 99, padding: "2px 9px", fontSize: 11, cursor: "pointer", fontWeight: tagFilter === "" ? 600 : 400 }}>
                  Tất cả
                </button>
                {CONV_TAGS.map(t => (
                  <button key={t.key} onClick={() => setTagFilter(tagFilter === t.key ? "" : t.key)} style={{ background: tagFilter === t.key ? t.bg : "#f8fafc", color: tagFilter === t.key ? t.color : "#94a3b8", border: `1px solid ${tagFilter === t.key ? t.color : "#e2e8f0"}`, borderRadius: 99, padding: "2px 8px", fontSize: 11, cursor: "pointer", fontWeight: tagFilter === t.key ? 600 : 400 }}>
                    {t.emoji} {t.label}
                  </button>
                ))}
              </div>
              {/* SĐT toggle */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button onClick={() => { const next = !hasPhone; setHasPhone(next); loadConvs(tab, pageFilter, next) }} style={{ display: "inline-flex", alignItems: "center", gap: 4, border: `1px solid ${hasPhone ? "#3b82f6" : "#e2e8f0"}`, background: hasPhone ? "#eff6ff" : "#fff", color: hasPhone ? "#1877f2" : "#64748b", borderRadius: 99, padding: "3px 10px", fontSize: 11, fontWeight: hasPhone ? 600 : 400, cursor: "pointer" }}>
                  📞 Có SĐT
                </button>
                <span style={{ fontSize: 10, color: "#cbd5e1", marginLeft: "auto" }}>mới nhất ↑</span>
              </div>
            </div>

            {/* Conv list */}
            <div style={{ flex: 1, overflow: "auto" }}>
              {loading && <div style={{ padding: "20px 16px", color: "#94a3b8", fontSize: 12, textAlign: "center" }}>Đang tải...</div>}
              {!loading && filtered.length === 0 && <div style={{ padding: "20px 16px", color: "#94a3b8", fontSize: 12, textAlign: "center" }}>Không có hội thoại</div>}
              {filtered.map(c => {
                const isSelected = selectedId === c.id
                const sc = STATUS_CONFIG[c.status]
                const ctags = convTags(c)
                return (
                  <div key={c.id} onClick={() => setSelectedId(c.id)} style={{ padding: "10px 14px", borderBottom: "1px solid #f8fafc", cursor: "pointer", background: isSelected ? "#eff6ff" : "#fff", borderLeft: `3px solid ${isSelected ? "#1877f2" : "transparent"}`, transition: "background 0.1s" }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <div style={{ position: "relative", flexShrink: 0 }}>
                        <Avatar name={c.customer_name || c.customer_psid} size={38} />
                        {c.unread_count > 0 && (
                          <span style={{ position: "absolute", top: -3, right: -3, background: "#ef4444", color: "#fff", borderRadius: 99, fontSize: 9, fontWeight: 700, padding: "1px 4px", border: "1.5px solid #fff" }}>{c.unread_count}</span>
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                          <span style={{ fontWeight: 600, fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.customer_name || c.customer_psid}</span>
                          <span style={{ fontSize: 10, color: "#94a3b8", flexShrink: 0 }}>{fmtAgo(c.last_message_at)}</span>
                        </div>
                        <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 2 }}>{c.page_name}</div>
                        <div style={{ fontSize: 12, color: c.unread_count > 0 ? "#0f172a" : "#94a3b8", fontWeight: c.unread_count > 0 ? 500 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.last_message}</div>
                        <div style={{ display: "flex", gap: 4, marginTop: 5, flexWrap: "wrap", alignItems: "center" }}>
                          {/* Status chip */}
                          {sc && c.status !== "new" && <Chip label={sc.label} bg={sc.bg} color={sc.color} />}
                          {/* Conv tags */}
                          {ctags.slice(0, 2).map(tk => {
                            const tc = CONV_TAGS.find(t => t.key === tk)
                            return tc ? <Chip key={tk} label={tc.label} bg={tc.bg} color={tc.color} emoji={tc.emoji} /> : null
                          })}
                          {ctags.length > 2 && <span style={{ fontSize: 10, color: "#94a3b8" }}>+{ctags.length - 2}</span>}
                          {/* Bot mode */}
                          {c.bot_mode && c.bot_mode !== "off" && (
                            <Chip label={`🤖 ${MODE_CONFIG[c.bot_mode]?.label || c.bot_mode}${c.bot_paused ? " ⏸" : ""}`} bg="#f5f3ff" color={MODE_CONFIG[c.bot_mode]?.color || "#7c3aed"} />
                          )}
                          {/* Phone */}
                          {c.active_phone && <span style={{ fontSize: 10, color: "#3b82f6", fontFamily: "monospace", fontWeight: 600 }}>📞 {c.active_phone}</span>}
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
                  {conv?.handoff_reason && <Chip label={`⚠ ${conv.handoff_reason === "complaint" ? "Khiếu nại" : "Cần nhân viên"}`} bg="#fff7ed" color="#c2410c" />}
                  <div style={{ display: "flex", gap: 6 }}>
                    <Btn size="sm" onClick={async () => { await apiJson(`/admin/chat/conversations/${selectedId}/assign-me`, "POST"); loadDetail(selectedId!); loadConvs(tab, pageFilter) }}>Nhận xử lý</Btn>
                    {selected.bot_paused && (
                      <Btn size="sm" variant="success" onClick={async () => { await apiJson(`/admin/chat/conversations/${selectedId}/resume-bot`, "POST"); loadDetail(selectedId!); loadConvs(tab, pageFilter) }}>▶ Bật bot</Btn>
                    )}
                    <Btn size="sm" variant="danger" onClick={async () => { if (!confirm("Xóa hội thoại này?")) return; await apiJson(`/admin/chat/conversations/${selectedId}`, "DELETE"); setSelectedId(null); setDetail(null); loadConvs(tab, pageFilter) }}>Xóa</Btn>
                  </div>
                </>
              ) : (
                <span style={{ color: "#94a3b8" }}>Chọn hội thoại để bắt đầu</span>
              )}
            </div>

            {/* Messages */}
            <div ref={msgAreaRef} style={{ flex: 1, overflow: "auto", padding: "12px 20px", display: "flex", flexDirection: "column" }}>
              {/* Load more */}
              {hasMore && (
                <div style={{ textAlign: "center", marginBottom: 8 }}>
                  <button onClick={loadMoreMessages} disabled={loadingMore} style={{ background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 20, padding: "5px 16px", fontSize: 12, color: "#64748b", cursor: loadingMore ? "not-allowed" : "pointer" }}>
                    {loadingMore ? "⏳ Đang tải..." : "⬆ Tải thêm tin nhắn cũ hơn"}
                  </button>
                </div>
              )}
              <div ref={msgTopRef} />
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
                    const isOut  = m.direction === "outbound"
                    const isBot  = m.sender_type === "bot"
                    const isSale = m.sender_type === "sale"
                    const isPage = m.sender_type === "page"
                    const atts   = parseAtts(m.attachments)
                    if (!m.text && atts.length === 0) return null
                    if (m.text && isCommentReply(m.text)) return (
                      <div key={m.id} style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
                        <div style={{ background: "#f1f5f9", borderRadius: 20, padding: "4px 14px", fontSize: 11, color: "#94a3b8" }}>
                          💬 Phản hồi bình luận · {fmtTime(m.created_at)}
                        </div>
                      </div>
                    )
                    const bubbleBg    = isBot ? "#7c3aed" : (isSale || isPage) ? "#1877f2" : "#fff"
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
                              <MessageText text={m.text} />
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
                  <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.5 }}><MessageText text={botSuggestion.reply_text} /></div>
                </div>
                <Btn size="sm" variant="ghost" onClick={() => setText(botSuggestion.reply_text!)}>Dùng</Btn>
              </div>
            )}

            {/* Composer */}
            <div style={{ background: "#fff", borderTop: "1px solid #e8edf2", padding: "10px 16px", flexShrink: 0 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: "8px 12px" }}>
                <textarea value={text} onChange={e => setText(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send() } }}
                  placeholder="Nhập tin nhắn… (Ctrl+Enter gửi)" disabled={!selectedId} rows={1}
                  style={{ flex: 1, resize: "none", border: "none", background: "none", outline: "none", fontSize: 13, fontFamily: "inherit", lineHeight: 1.5, maxHeight: 100, overflow: "auto" }}
                />
                <button onClick={send} disabled={!text.trim() || sending || !selectedId}
                  style={{ background: !text.trim() || !selectedId ? "#e2e8f0" : "#1877f2", color: !text.trim() || !selectedId ? "#94a3b8" : "#fff", border: "none", borderRadius: 8, width: 36, height: 36, cursor: !text.trim() || !selectedId ? "not-allowed" : "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  ➤
                </button>
              </div>
              <div style={{ fontSize: 10, color: "#cbd5e1", marginTop: 4, textAlign: "right" }}>Ctrl+Enter để gửi</div>
            </div>
          </div>

          {/* ── Right panel ── */}
          <div style={{ background: "#fff", borderLeft: "1px solid #e8edf2", overflow: "auto", display: "flex", flexDirection: "column" }}>
            {!selected
              ? <div style={{ padding: 24, color: "#94a3b8", fontSize: 12, textAlign: "center" }}>Chọn hội thoại</div>
              : (
                <>
                  {/* Customer card */}
                  <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid #f1f5f9" }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
                      <Avatar name={selected.customer_name || selected.customer_psid} size={44} />
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{selected.customer_name || selected.customer_psid}</div>
                        <div style={{ fontSize: 11, color: "#94a3b8" }}>{selected.page_name}</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {conv?.bot_mode && conv.bot_mode !== "off" && (
                        <Chip label={`🤖 ${MODE_CONFIG[conv.bot_mode]?.label || conv.bot_mode}${selected.bot_paused ? " ⏸" : ""}`} bg="#f5f3ff" color={MODE_CONFIG[conv.bot_mode]?.color || "#7c3aed"} />
                      )}
                      {selected.priority === "high" && <Chip label="⚡ Ưu tiên" bg="#fff7ed" color="#c2410c" />}
                    </div>
                  </div>

                  {/* Status pipeline */}
                  <StatusPipeline
                    current={conv?.status || selected.status || "new"}
                    onChange={s => patchConv({ status: s })}
                  />

                  {/* Tag picker */}
                  <TagPicker
                    tags={convTags(conv || selected)}
                    onChange={tags => patchConv({ tags })}
                  />

                  {/* Context 24h */}
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#3b82f6", marginBottom: 10 }}>📍 Context 24h</div>
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

                  {/* Đơn Pancake */}
                  {conv?.active_phone && (
                    <div style={{ padding: "12px 16px" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#16a34a", marginBottom: 8 }}>
                        🛍 Đơn hàng {detail?.orders?.length ? `(${detail.orders.length})` : ""}
                      </div>
                      {!detail?.orders?.length && <div style={{ fontSize: 12, color: "#94a3b8" }}>Chưa có đơn theo SĐT này</div>}
                      {(detail?.orders || []).map((o: any) => {
                        const items: any[] = Array.isArray(o.items) ? o.items : []
                        const statusColor = o.status_name?.includes("hủy") ? "#ef4444"
                          : o.status_name?.includes("thành công") || o.status_name?.includes("giao") ? "#16a34a" : "#f59e0b"
                        return (
                          <div key={o.id} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                              <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: "#374151" }}>#{o.id}</span>
                              <span style={{ fontSize: 10, fontWeight: 600, color: statusColor }}>{o.status_name || "—"}</span>
                            </div>
                            {items.length > 0 && (
                              <div style={{ fontSize: 12, color: "#374151", marginBottom: 4 }}>
                                {items.map((it: any, i: number) => (
                                  <div key={i}>{it.name} x{it.qty} — {Number(it.price || 0).toLocaleString("vi-VN")}đ</div>
                                ))}
                              </div>
                            )}
                            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                              <span style={{ fontSize: 11, color: "#64748b" }}>{o.province}</span>
                              <span style={{ fontSize: 12, fontWeight: 700 }}>{Number(o.cod_amount || o.total || 0).toLocaleString("vi-VN")}đ</span>
                            </div>
                            {o.tracking_code && <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>🚚 {o.tracking_code}</div>}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </>
              )
            }
          </div>
        </div>
      )}

      {/* ── AGENTS ── */}
      {view === "agents" && (
        <div style={{ padding: 20, overflow: "auto", flex: 1 }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
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
                <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <Btn size="sm" onClick={() => runPromptLoop(a.id)} disabled={!!promptBusy[a.id]}>
                    {promptBusy[a.id] === "loop" ? "AI đang test..." : "🔁 AI test loop"}
                  </Btn>
                  {a.latest_prompt_version?.status === "draft" && (
                    <Btn size="sm" variant="success" onClick={() => activatePromptDraft(a.id, a.latest_prompt_version!.id)} disabled={!!promptBusy[a.id]}>
                      {promptBusy[a.id] === "activate" ? "Đang duyệt..." : `✓ Duyệt draft v${a.latest_prompt_version.version}`}
                    </Btn>
                  )}
                  {a.latest_prompt_version && (
                    <span style={{ fontSize: 11, color: "#64748b" }}>
                      Prompt v{a.latest_prompt_version.version} · {a.latest_prompt_version.status} · {a.latest_prompt_version.score_before ?? "-"} → {a.latest_prompt_version.score_after ?? "-"}/10
                    </span>
                  )}
                </div>
                {((promptLoopLogs[a.id]?.length || promptLoopResults[a.id] || a.latest_prompt_version?.eval_summary) && (
                  <div style={{ marginTop: 8, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 10, fontSize: 11, color: "#475569", lineHeight: 1.5 }}>
                    {promptLoopResults[a.id] ? (
                      <>
                        <b>Loop result:</b> {promptLoopResults[a.id].score_before}/10 → {promptLoopResults[a.id].score_after}/10
                        <div style={{ marginTop: 4 }}>{promptLoopResults[a.id].eval_summary}</div>
                      </>
                    ) : a.latest_prompt_version?.eval_summary ? (
                      <div>{a.latest_prompt_version.eval_summary}</div>
                    ) : null}

                    {!!promptLoopLogs[a.id]?.length && (
                      <div style={{ marginTop: 8, borderTop: "1px solid #e2e8f0", paddingTop: 8 }}>
                        <b>Process log</b>
                        <div style={{ marginTop: 6, display: "grid", gap: 4, fontFamily: "monospace", color: "#334155" }}>
                          {promptLoopLogs[a.id].map((line, i) => <div key={i}>• {line}</div>)}
                        </div>
                      </div>
                    )}

                    {!!promptLoopResults[a.id]?.before?.length && (
                      <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                        {promptLoopResults[a.id].before.map((row: any, i: number) => {
                          const draft = promptLoopResults[a.id].after?.[i]
                          return (
                            <div key={i} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 8 }}>
                              <div style={{ fontWeight: 700, color: "#0f172a" }}>Scenario {i + 1}: {row.customer}</div>
                              <div style={{ marginTop: 4 }}>Hiện tại: {row.evaluation?.score ?? "-"}/10{row.evaluation?.issues?.length ? ` - ${row.evaluation.issues.join("; ")}` : ""}</div>
                              {draft && <div style={{ marginTop: 4 }}>Draft: {draft.evaluation?.score ?? "-"}/10{draft.evaluation?.issues?.length ? ` - ${draft.evaluation.issues.join("; ")}` : ""}</div>}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TEST BOT (sandbox — không gửi tin thật, không ghi DB hội thoại) ── */}
      {view === "test-bot" && (
        <div style={{ padding: 20, overflow: "auto", flex: 1, display: "flex", gap: 16, maxWidth: 1100 }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
              <select value={testPageId} onChange={e => { setTestPageId(e.target.value); setTestMessages([]); setTestToolCalls([]); setTestActions([]) }}
                style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 10px", fontSize: 12, flex: 1 }}>
                <option value="">Chọn page để test...</option>
                {agents.map(a => <option key={a.page_id} value={a.page_id}>{a.page_name}</option>)}
              </select>
              <Btn size="sm" onClick={() => { setTestMessages([]); setTestToolCalls([]); setTestActions([]) }}>↺ Xoá hội thoại test</Btn>
            </div>
            <div style={{ flex: 1, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, overflow: "auto", minHeight: 360, display: "flex", flexDirection: "column", gap: 8 }}>
              {testMessages.length === 0 && <div style={{ color: "#94a3b8", textAlign: "center", padding: 20 }}>Chọn page rồi nhắn thử như một khách hàng.</div>}
              {testMessages.map((m, i) => (
                <div key={i} style={{ display: "flex", justifyContent: m.role === "customer" ? "flex-end" : "flex-start" }}>
                  <div style={{
                    maxWidth: "70%", padding: "8px 12px", borderRadius: 12, fontSize: 13,
                    background: m.role === "customer" ? "#1877f2" : "#f1f5f9",
                    color: m.role === "customer" ? "#fff" : "#0f172a",
                  }}><MessageText text={m.text} /></div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <input value={testInput} onChange={e => setTestInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendTestMessage() } }}
                placeholder={testPageId ? "Nhắn thử như khách hàng..." : "Chọn page trước"} disabled={!testPageId || testSending}
                style={{ flex: 1, border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", fontSize: 13 }} />
              <Btn variant="primary" onClick={sendTestMessage} disabled={!testPageId || !testInput.trim() || testSending}>
                {testSending ? "Đang gửi..." : "Gửi"}
              </Btn>
            </div>
          </div>
          <div style={{ width: 340, flexShrink: 0, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 14 }}>
              <b style={{ fontSize: 12, color: "#64748b" }}>🔧 Tool calls</b>
              {testToolCalls.length === 0 && <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 6 }}>Chưa có</div>}
              {testToolCalls.map((tc, i) => (
                <pre key={i} style={{ whiteSpace: "pre-wrap", background: "#f8fafc", borderRadius: 8, padding: 8, fontSize: 10.5, marginTop: 8, maxHeight: 160, overflow: "auto" }}>
                  {tc.name}({JSON.stringify(tc.args)})
                  {"\n→ "}{JSON.stringify(tc.result, null, 1)}
                </pre>
              ))}
            </div>
            {testActions.length > 0 && (
              <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 12, padding: 14 }}>
                <b style={{ fontSize: 12, color: "#92400e" }}>⚠ Actions (chưa thực thi, chỉ hiển thị)</b>
                {testActions.map((a, i) => (
                  <div key={i} style={{ fontSize: 12, marginTop: 6 }}>{a.type}{a.reason ? `: ${a.reason}` : ""}</div>
                ))}
              </div>
            )}
            <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 12, padding: 14, fontSize: 11.5, color: "#075985", lineHeight: 1.6 }}>
              Sandbox: không gửi tin thật, không ghi vào Inbox. Tool tra giá/lịch sử mua chạy thật trên DB.
            </div>
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

      {/* ── SETTINGS ── */}
      {view === "settings" && (
        <div style={{ padding: 24, overflow: "auto", flex: 1, maxWidth: 700 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>⚙ Chọn Page hiển thị</h2>
          <p style={{ fontSize: 13, color: "#64748b", marginBottom: 20 }}>
            Page đang <b>Bật</b> sẽ được sync tin nhắn về <b>và hiện trong Inbox</b>. Page <b>Tắt</b> sẽ bị ẩn khỏi Inbox và không sync
            (dữ liệu cũ vẫn giữ trong DB, bật lại là hiện lại).
          </p>
          {settingPagesErr && (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#dc2626", display: "flex", gap: 10, alignItems: "center" }}>
              <span>⚠ Lỗi tải danh sách page: {settingPagesErr}</span>
              <Btn size="xs" onClick={loadSettingPages}>Thử lại</Btn>
            </div>
          )}
          {!settingPagesErr && settingPages.length === 0 && (
            <div style={{ color: "#94a3b8", padding: 20, textAlign: "center" }}>
              Chưa có page nào. Cần có access_token trong bảng fb_page_token.
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {settingPages.map(p => (
              <div key={p.page_id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 18px", display: "flex", alignItems: "center", gap: 14 }}>
                <Avatar name={p.page_name} size={40} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{p.page_name}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace" }}>{p.page_id}</div>
                  {!p.has_token && <div style={{ fontSize: 11, color: "#ef4444", marginTop: 2 }}>⚠ Chưa có access token</div>}
                </div>
                {/* Sync days */}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "#64748b" }}>Lấy</span>
                  <select
                    value={p.sync_days || 7}
                    onChange={async e => {
                      const sync_days = parseInt(e.target.value)
                      await apiJson("/admin/chat/pages", "PATCH", { page_id: p.page_id, sync_days })
                      setSettingPages(prev => prev.map(x => x.page_id === p.page_id ? { ...x, sync_days } : x))
                    }}
                    style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "4px 8px", fontSize: 12 }}
                  >
                    {[1,3,7,14,30].map(d => <option key={d} value={d}>{d} ngày</option>)}
                  </select>
                </div>
                {/* Toggle sync_enabled */}
                <button
                  onClick={async () => {
                    const sync_enabled = !p.sync_enabled
                    await apiJson("/admin/chat/pages", "PATCH", { page_id: p.page_id, sync_enabled })
                    setSettingPages(prev => prev.map(x => x.page_id === p.page_id ? { ...x, sync_enabled } : x))
                    loadPageFilterList()   // refresh dropdown lọc page ở topbar
                  }}
                  style={{
                    background: p.sync_enabled ? "#dcfce7" : "#f1f5f9",
                    color: p.sync_enabled ? "#16a34a" : "#94a3b8",
                    border: `1.5px solid ${p.sync_enabled ? "#86efac" : "#e2e8f0"}`,
                    borderRadius: 99, padding: "5px 16px", fontSize: 12, fontWeight: 600,
                    cursor: "pointer", minWidth: 80,
                  }}
                >
                  {p.sync_enabled ? "✓ Bật" : "Tắt"}
                </button>
              </div>
            ))}
          </div>

          {/* Sync now button */}
          {settingPages.some(p => p.sync_enabled) && (
            <div style={{ marginTop: 20, padding: "14px 18px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12 }}>
              <div style={{ fontSize: 13, color: "#16a34a", fontWeight: 600, marginBottom: 8 }}>
                Sync ngay {settingPages.filter(p => p.sync_enabled).length} page đang bật
              </div>
              <Btn variant="success" onClick={() => { setView("inbox"); syncInbox() }}>
                ⬇ Sync inbox ngay
              </Btn>
            </div>
          )}
        </div>
      )}

      {/* ── PANCAKE TOKEN ── */}
      {view === "pancake" && (
        <div style={{ padding: 24, overflow: "auto", flex: 1, maxWidth: 820 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>🥞 Page Access Token (Pancake)</h2>
          <p style={{ fontSize: 13, color: "#64748b", marginBottom: 6 }}>
            Dùng để <b>gửi tin</b> qua Pancake khi Facebook App chưa được duyệt. Mỗi page 1 token riêng —
            lấy tại <b>Pancake → mở page → Cài đặt → Công cụ</b> (Settings → Tools), copy dòng <i>Page Access Token</i>.
          </p>
          <p style={{ fontSize: 12, color: "#94a3b8", marginBottom: 20 }}>
            Khi page đã có token và đang bật, nút gửi trong Inbox sẽ tự gửi qua Pancake. Page chưa cấu hình vẫn gửi qua Facebook như cũ.
          </p>

          {pancakePages.length === 0 && (
            <div style={{ color: "#94a3b8", padding: 20, textAlign: "center" }}>Chưa có page nào trong fb_page_token.</div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {pancakePages.map(p => {
              const busy = pcBusy === p.page_id
              const draft = pcDraft[p.page_id]
              const editing = draft !== undefined
              return (
                <div key={p.page_id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 18px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10 }}>
                    <Avatar name={p.page_name} size={40} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{p.page_name}</div>
                      <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace" }}>{p.page_id}</div>
                    </div>
                    {/* Status */}
                    {p.has_token ? (
                      <Chip label={p.last_test_ok === true ? "✓ Token OK" : p.last_test_ok === false ? "⚠ Token lỗi" : "Đã lưu token"}
                        bg={p.last_test_ok === false ? "#fee2e2" : "#dcfce7"}
                        color={p.last_test_ok === false ? "#dc2626" : "#16a34a"} />
                    ) : (
                      <Chip label="Chưa có token" bg="#f1f5f9" color="#94a3b8" />
                    )}
                    {/* Enable toggle */}
                    {p.has_token && (
                      <button onClick={() => togglePancake(p.page_id, !p.enabled)} disabled={busy}
                        style={{ background: p.enabled ? "#dcfce7" : "#f1f5f9", color: p.enabled ? "#16a34a" : "#94a3b8", border: `1.5px solid ${p.enabled ? "#86efac" : "#e2e8f0"}`, borderRadius: 99, padding: "5px 14px", fontSize: 12, fontWeight: 600, cursor: busy ? "wait" : "pointer", minWidth: 78 }}>
                        {p.enabled ? "✓ Bật gửi" : "Tắt"}
                      </button>
                    )}
                  </div>

                  {/* Token input row */}
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="password"
                      value={editing ? draft : ""}
                      placeholder={p.has_token && !editing ? "•••••••••••• (đã lưu — nhập để thay)" : "Dán Page Access Token…"}
                      onChange={e => setPcDraft(prev => ({ ...prev, [p.page_id]: e.target.value }))}
                      style={{ flex: 1, border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", fontSize: 12, fontFamily: "monospace", background: "#f8fafc", outline: "none" }}
                    />
                    <Btn size="sm" variant="primary" disabled={busy || !editing || !draft?.trim()}
                      onClick={() => savePancakeToken(p.page_id, draft)}>
                      {busy ? "..." : "Lưu"}
                    </Btn>
                    <Btn size="sm" disabled={busy || !p.has_token}
                      onClick={() => testPancakeToken(p.page_id)}>
                      Test
                    </Btn>
                  </div>
                  {p.last_test_ok === false && p.last_test_error && (
                    <div style={{ fontSize: 11, color: "#dc2626", marginTop: 6 }}>Lỗi test: {p.last_test_error}</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export const config = defineRouteConfig({ label: "Chat" })
