import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { apiFetch } from "../../lib/api-client"
import { useCurrentPermissions } from "../../lib/use-permissions"

// ─── Types ───────────────────────────────────────────────────────────────────

type LastMessage = { content: string; author_id: string; msg_type: string; created_at: string }
type Channel = {
  id: string; name: string; description: string | null
  is_private: boolean
  member_count: number; member_ids?: string[]
  unread_count: number; mention_count: number; created_at: string
  last_message?: LastMessage | null
}
type ReplySnippet = { id: string; content: string; author_name: string }
type Message = {
  id: string; channel_id: string; author_id: string; author_name: string
  content: string; task_id: string | null; msg_type: string; metadata: any
  reply_to_id: string | null; reply_to: ReplySnippet | null
  file_url: string | null; file_type: string | null; file_name: string | null
  file_expires_at: string | null
  reactions: Record<string, string[]>; is_pinned: boolean; mentions: string[]
  reply_count: number; channel_name?: string
  created_at: string
}
type MktUser = { email: string; name: string }
type Template = { id: string; label: string; content: string; created_by: string }
type LinkedTask = {
  id: string; title: string; status: string; priority?: string
  assignee_name: string; deadline: string | null
}
type ChatFile = { id: string; file_url: string; file_type: string | null; file_name: string | null; author_id: string; author_name?: string; created_at: string }
type MktNotification = {
  id: string; recipient: string; channel_id: string; channel_name: string; message_id: string
  sender: string; sender_name: string; preview: string; source?: string; created_at: string; read: boolean
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ")
}

function fmtTime(d: string) {
  const dt = new Date(d)
  return `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`
}
function fmtDate(d: string) {
  const dt = new Date(d)
  if (dt.toDateString() === new Date().toDateString()) return "Hôm nay"
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}`
}
function fmtSnippetTime(d: string) {
  const dt = new Date(d)
  if (dt.toDateString() === new Date().toDateString()) return fmtTime(d)
  return fmtDate(d)
}

// XSS-safe: escape HTML trước, sau đó mới highlight @mention
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
function renderMentions(
  text: string,
  mentions: string[] = [],
  users: MktUser[] = [],
  className = "font-semibold text-blue-600 dark:text-blue-400"
): string {
  if (mentions.length > 0) {
    const nameByEmail = new Map(users.map(user => [user.email, user.name]))
    const labels = mentions
      .map(email => nameByEmail.get(email) || email.split("@")[0])
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)

    return renderMentionEntities(text, labels, className)
  }

  return escapeHtml(text).replace(/@[\w.@-]+/g, m => `<span class="${className}">${m}</span>`)
}

function normalizeMentionEntityText(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
}

function renderMentionEntities(text: string, labels: string[], className: string): string {
  const normalizedLabels = labels.map(label => ({
    label,
    token: `@${label}`,
    normalizedToken: normalizeMentionEntityText(`@${label}`),
  }))
  const parts: string[] = []
  let index = 0

  while (index < text.length) {
    const match = normalizedLabels.find(({ token, normalizedToken }) =>
      normalizeMentionEntityText(text.slice(index, index + token.length)) === normalizedToken
    )
    const nextChar = match ? text[index + match.token.length] : ""
    if (!match || (nextChar && !/[\s.,!?;:)\]}]/.test(nextChar))) {
      parts.push(escapeHtml(text[index]))
      index += 1
      continue
    }

    const rawToken = text.slice(index, index + match.token.length)
    parts.push(`<span class="${className}">${escapeHtml(rawToken)}</span>`)
    index += match.token.length
  }

  return parts.join("")
}
function hasMentionEntity(text: string, label: string): boolean {
  const token = `@${label}`
  const normalizedToken = normalizeMentionEntityText(token)
  for (let index = 0; index < text.length; index += 1) {
    if (normalizeMentionEntityText(text.slice(index, index + token.length)) !== normalizedToken) continue
    const nextChar = text[index + token.length]
    if (!nextChar || /[\s.,!?;:)\]}]/.test(nextChar)) return true
  }
  return false
}

function collectMentionEntityEmails(text: string, entities: Record<string, string>, memberIds?: string[]): string[] {
  const members = new Set(memberIds || [])
  return Object.entries(entities)
    .filter(([email, label]) => (!members.size || members.has(email)) && hasMentionEntity(text, label))
    .map(([email]) => email)
}
const QUICK_EMOJIS = ["👍", "❤️", "😂", "🎉", "✅", "🔥"]
const MENTION_SOUND_REPEAT_MS = 20_000
const MENTION_SOUND_REPEAT_LIMIT = 8
function emitMentionTone(ctx: AudioContext) {
  const now = ctx.currentTime
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.34, now + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.15)
  gain.connect(ctx.destination)

  ;[
    { freq: 1046.5, start: 0 },
    { freq: 1318.5, start: 0.13 },
    { freq: 1174.7, start: 0.36 },
    { freq: 1568, start: 0.5 },
    { freq: 2093, start: 0.66 },
  ].forEach(({ freq, start }) => {
    const osc = ctx.createOscillator()
    const startAt = now + start
    osc.type = "triangle"
    osc.frequency.setValueAtTime(freq, startAt)
    osc.connect(gain)
    osc.start(startAt)
    osc.stop(startAt + 0.18)
  })

  window.setTimeout(() => gain.disconnect(), 1300)
}

const AVATAR_COLORS = [
  "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
  "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300",
]
function avatarClass(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

const TASK_STATUS: Record<string, { label: string; chip: string }> = {
  todo:        { label: "Chờ làm",    chip: "bg-ui-bg-component text-ui-fg-subtle" },
  in_progress: { label: "Đang làm",   chip: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300" },
  done:        { label: "Hoàn thành", chip: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
  cancelled:   { label: "Đã hủy",     chip: "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300" },
}

const INPUT_CLS = "w-full rounded-lg border border-ui-border-base bg-ui-bg-field px-3 py-2 text-[13px] text-ui-fg-base outline-none transition-shadow placeholder:text-ui-fg-muted focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
const LABEL_CLS = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ui-fg-muted"

function PageStyles() {
  return (
    <style>{`
      @keyframes chatMsgIn { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
      @keyframes chatPop { 0% { transform: scale(.5) } 60% { transform: scale(1.2) } 100% { transform: scale(1) } }
      @keyframes chatFadeIn { from { opacity: 0 } to { opacity: 1 } }
      @keyframes chatFadeUp { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
      @keyframes chatSlideRight { from { transform: translateX(40px); opacity: 0 } to { transform: none; opacity: 1 } }
      @keyframes chatBounce { 0%, 80%, 100% { transform: translateY(0) } 40% { transform: translateY(-4px) } }
      @keyframes chatHighlight { 0% { background-color: rgb(250 204 21 / 0.25) } 100% { background-color: transparent } }
      .chat-anim-msgin { animation: chatMsgIn .16s ease-out }
      .chat-anim-pop { animation: chatPop .2s cubic-bezier(.34,1.56,.64,1) }
      .chat-anim-fadein { animation: chatFadeIn .18s ease-out }
      .chat-anim-fadeup { animation: chatFadeUp .18s ease-out }
      .chat-anim-panel { animation: chatSlideRight .2s ease-out }
      .chat-anim-highlight { animation: chatHighlight 1.4s ease-out }
      .chat-typing-dot { animation: chatBounce 1.2s infinite ease-in-out }
      @media (prefers-reduced-motion: reduce) {
        .chat-anim-msgin, .chat-anim-pop, .chat-anim-fadein, .chat-anim-fadeup, .chat-anim-panel, .chat-anim-highlight, .chat-typing-dot { animation: none }
      }
    `}</style>
  )
}

// ─── Small components ────────────────────────────────────────────────────────

function Avatar({ name, online, className }: { name: string; online?: boolean; className?: string }) {
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center rounded-full font-bold uppercase", avatarClass(name), className || "size-7 text-[11px]")}>
      {(name || "?").charAt(0)}
      {online !== undefined && (
        <span className={cn("absolute -bottom-px -right-px size-2 rounded-full ring-2 ring-ui-bg-base", online ? "bg-emerald-500" : "bg-gray-300 dark:bg-gray-600")} />
      )}
    </span>
  )
}

function ReactionBar({ reactions, msgId, currentEmail, onReact, isMine }: {
  reactions: Record<string, string[]>; msgId: string; currentEmail: string
  onReact: (msgId: string, emoji: string) => void
  isMine?: boolean
}) {
  const entries = Object.entries(reactions || {}).filter(([, users]) => users.length > 0)
  if (entries.length === 0) return null
  return (
    <div className={cn("mt-1 flex flex-wrap gap-1", isMine && "justify-end")}>
      {entries.map(([emoji, users]) => {
        const mine = users.includes(currentEmail)
        return (
          <button key={emoji} onClick={() => onReact(msgId, emoji)}
            className={cn("chat-anim-pop rounded-full border px-1.5 py-px text-xs leading-relaxed transition-all active:scale-90",
              mine
                ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/15 dark:text-blue-300"
                : "border-ui-border-base bg-ui-bg-component text-ui-fg-subtle hover:border-ui-border-strong")}>
            {emoji} {users.length}
          </button>
        )
      })}
    </div>
  )
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg, users, isMine, currentUserEmail, isManager, isOptimistic, onTaskClick, onReply, onReact, onPin, onOpenThread }: {
  msg: Message; users: MktUser[]; isMine: boolean; currentUserEmail: string; isManager: boolean
  isOptimistic: boolean
  onTaskClick?: (taskId: string) => void
  onReply: (msg: Message) => void
  onReact: (msgId: string, emoji: string) => void
  onPin: (msgId: string) => void
  onOpenThread: (msg: Message) => void
}) {
  const isNote = msg.msg_type === "internal_note"
  const isSystem = !["text", "ai_response", "image", "file", "internal_note"].includes(msg.msg_type)
  const isAI = msg.msg_type === "ai_response"
  const isImage = msg.msg_type === "image"
  const isFile = msg.msg_type === "file"

  if (isSystem) {
    return (
      <div className="my-1 text-center">
        <span className={cn("inline-block rounded-full px-2.5 py-0.5 text-xs text-ui-fg-muted", msg.is_pinned ? "bg-amber-50 dark:bg-amber-500/10" : "bg-ui-bg-component")}>
          {msg.is_pinned && "📌 "}
          {msg.content}
          {msg.task_id && onTaskClick && (
            <button onClick={() => onTaskClick(msg.task_id!)}
              className="ml-1.5 text-[11px] text-blue-600 underline underline-offset-2 transition-colors hover:text-blue-700 dark:text-blue-400">
              Xem →
            </button>
          )}
        </span>
      </div>
    )
  }

  // Internal note: full-width, nền vàng, chỉ member thấy (đánh dấu rõ)
  if (isNote) {
    return (
      <div className="chat-anim-msgin my-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-500/30 dark:bg-amber-500/10">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
          🔒 Note nội bộ · {msg.author_name} · {fmtTime(msg.created_at)}
        </div>
        <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-ui-fg-base"
          dangerouslySetInnerHTML={{ __html: renderMentions(msg.content, msg.mentions, users) }} />
        <ReactionBar reactions={msg.reactions} msgId={msg.id} currentEmail={currentUserEmail} onReact={onReact} />
      </div>
    )
  }

  if (isAI) {
    return (
      <div className="chat-anim-msgin my-2 flex gap-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-violet-500 text-xs text-white">🤖</span>
        <div className="min-w-0">
          <div className="mb-0.5 text-[11px] text-ui-fg-muted">AI · {fmtTime(msg.created_at)}</div>
          <div className="max-w-[400px] whitespace-pre-wrap rounded-xl rounded-tl-sm border border-violet-200 bg-violet-50 px-3 py-2 text-[13px] leading-relaxed text-ui-fg-base dark:border-violet-500/30 dark:bg-violet-500/10">
            {msg.content}
          </div>
          <ReactionBar reactions={msg.reactions} msgId={msg.id} currentEmail={currentUserEmail} onReact={onReact} />
        </div>
      </div>
    )
  }

  return (
    <div className={cn("group/msg relative my-0.5 flex gap-2", isMine && "flex-row-reverse")}>
      {!isMine && <Avatar name={msg.author_name} className="mt-4 size-7 text-[11px]" />}

      <div className="max-w-[400px] min-w-0">
        {!isMine && <div className="mb-0.5 text-[11px] text-ui-fg-muted">{msg.author_name}</div>}

        {msg.reply_to && (
          <div className={cn("rounded-t-lg border-l-2 px-2 py-1 text-[11px]",
            isMine
              ? "border-blue-300 bg-blue-500/10 text-ui-fg-subtle"
              : "border-ui-border-strong bg-ui-bg-component text-ui-fg-muted")}>
            <span className="font-semibold">{msg.reply_to.author_name}</span>: {msg.reply_to.content}
          </div>
        )}

        <div className={cn("relative whitespace-pre-wrap px-3 py-2 text-[13px] leading-relaxed transition-opacity",
          isOptimistic && "opacity-60",
          msg.reply_to ? "rounded-b-xl" : "rounded-xl",
          isMine
            ? cn("bg-blue-600 text-white", !msg.reply_to && "rounded-tr-sm")
            : cn("bg-ui-bg-component text-ui-fg-base", !msg.reply_to && "rounded-tl-sm"))}>
          {msg.is_pinned && <span className="mr-1 text-[10px]">📌</span>}
          {isImage && msg.file_url ? (
            <a href={msg.file_url} target="_blank" rel="noreferrer">
              <img src={msg.file_url} alt={msg.file_name || "ảnh"} className="block max-h-[200px] max-w-[260px] rounded-lg" />
            </a>
          ) : isFile && msg.file_url ? (
            <a href={msg.file_url} target="_blank" rel="noreferrer"
              className={cn("flex items-center gap-1.5 no-underline", isMine ? "text-white" : "text-blue-600 dark:text-blue-400")}>
              <span>📎</span><span className="underline underline-offset-2">{msg.file_name || "File"}</span>
            </a>
          ) : (
            <span dangerouslySetInnerHTML={{ __html: renderMentions(msg.content, msg.mentions, users, isMine ? "font-bold underline underline-offset-2" : "font-semibold text-blue-600 dark:text-blue-400") }} />
          )}
        </div>

        <div className={cn("mt-0.5 text-[10px] text-ui-fg-muted", isMine && "text-right")}>
          {isOptimistic ? "Đang gửi..." : fmtTime(msg.created_at)}
        </div>

        <ReactionBar reactions={msg.reactions} msgId={msg.id} currentEmail={currentUserEmail} onReact={onReact} isMine={isMine} />
        {Number(msg.reply_count || 0) > 0 && (
          <button onClick={() => onOpenThread(msg)}
            className={cn("mt-1 block text-[11px] font-semibold transition-colors", isMine ? "ml-auto text-blue-100 hover:text-white" : "text-blue-600 hover:text-blue-700 dark:text-blue-400")}>
            {msg.reply_count} phản hồi
          </button>
        )}
      </div>

      {/* Hover actions — thanh ngang phía trên bubble (kiểu Slack) */}
      <div className={cn("absolute -top-2.5 z-10 hidden items-center gap-px rounded-lg border border-ui-border-base bg-ui-bg-base p-0.5 shadow-md group-hover/msg:flex",
        isMine ? "right-2" : "left-2")}>
        {QUICK_EMOJIS.slice(0, 4).map(e => (
          <button key={e} onClick={() => onReact(msg.id, e)}
            className="grid size-6 place-items-center rounded-md text-[13px] transition-transform hover:scale-125 hover:bg-ui-bg-base-hover">{e}</button>
        ))}
        <span className="mx-0.5 h-4 w-px bg-ui-border-base" />
        <button onClick={() => onReply(msg)} title="Trả lời"
          className="grid size-6 place-items-center rounded-md text-xs text-ui-fg-subtle transition-colors hover:bg-ui-bg-base-hover">↩</button>
        {isManager && (
          <button onClick={() => onPin(msg.id)} title={msg.is_pinned ? "Bỏ ghim" : "Ghim"}
            className="grid size-6 place-items-center rounded-md text-xs transition-colors hover:bg-ui-bg-base-hover">
            {msg.is_pinned ? "📌" : "📍"}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Pinned bar ───────────────────────────────────────────────────────────────

function PinnedBar({ channelId, onJump }: { channelId: string; onJump: (msgId: string) => void }) {
  const [pinned, setPinned] = useState<Message[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    apiFetch(`/admin/mkt-chat/channels/${channelId}/pinned`)
      .then(r => r.json()).then(d => setPinned(d.pinned || []))
  }, [channelId])

  if (pinned.length === 0) return null
  return (
    <div className="border-b border-amber-200/60 bg-amber-50/70 px-4 py-1.5 dark:border-amber-500/20 dark:bg-amber-500/5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">📌 {pinned.length} tin nhắn được ghim</span>
        <button onClick={() => setOpen(o => !o)}
          className="text-[11px] text-amber-700 transition-colors hover:text-amber-900 dark:text-amber-400">
          {open ? "Thu gọn ▲" : "Xem ▼"}
        </button>
      </div>
      {open && (
        <div className="chat-anim-fadeup mt-1.5 flex flex-col gap-1">
          {pinned.map(m => (
            <div key={m.id} className="flex items-center gap-2">
              <span className="flex-1 truncate text-[11px] text-amber-900 dark:text-amber-300">
                <b>{m.author_name}:</b> {m.content.slice(0, 60)}
              </span>
              <button onClick={() => { setOpen(false); onJump(m.id) }}
                className="whitespace-nowrap text-[11px] text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-400">Đến →</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Search panel ─────────────────────────────────────────────────────────────

function SearchPanel({ currentChannelId, channels, users, onClose, onJump }: {
  currentChannelId: string
  channels: Channel[]
  users: MktUser[]
  onClose: () => void
  onJump: (msg: Message) => void
}) {
  const [q, setQ] = useState("")
  const [scope, setScope] = useState<"channel" | "workspace">("channel")
  const [channelId, setChannelId] = useState("")
  const [authorId, setAuthorId] = useState("")
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")
  const [results, setResults] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!q.trim()) { setResults([]); return }
    const t = setTimeout(() => {
      const params = new URLSearchParams({ q: q.trim(), limit: "50" })
      const scopedChannel = scope === "channel" ? currentChannelId : channelId
      if (scopedChannel) params.set("channel_id", scopedChannel)
      if (authorId) params.set("author_id", authorId)
      if (fromDate) params.set("from", fromDate)
      if (toDate) params.set("to", `${toDate}T23:59:59`)
      setLoading(true)
      apiFetch(`/admin/mkt-chat/search?${params.toString()}`)
        .then(r => r.json()).then(d => setResults(d.messages || [])).finally(() => setLoading(false))
    }, 350)
    return () => clearTimeout(t)
  }, [q, scope, channelId, authorId, fromDate, toDate, currentChannelId])

  const highlight = (text: string) => escapeHtml(text).replace(
    new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
    s => `<mark class="rounded-sm bg-amber-200 dark:bg-amber-500/40">${s}</mark>`
  )

  return (
    <div className="chat-anim-panel absolute inset-y-0 right-0 z-10 flex w-[380px] flex-col border-l border-ui-border-base bg-ui-bg-base">
      <div className="border-b border-ui-border-base px-4 py-3">
        <div className="mb-2 flex items-center gap-2">
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Tim tin nhan..."
            className={cn(INPUT_CLS, "py-1.5")} />
          <button onClick={onClose} className="text-base text-ui-fg-muted transition-colors hover:text-ui-fg-base">✕</button>
        </div>
        <div className="mb-2 grid grid-cols-2 gap-1 rounded-lg bg-ui-bg-component p-0.5">
          <button onClick={() => setScope("channel")}
            className={cn("rounded-md px-2 py-1 text-xs font-semibold", scope === "channel" ? "bg-ui-bg-base text-ui-fg-base shadow-sm" : "text-ui-fg-muted")}>Channel nay</button>
          <button onClick={() => setScope("workspace")}
            className={cn("rounded-md px-2 py-1 text-xs font-semibold", scope === "workspace" ? "bg-ui-bg-base text-ui-fg-base shadow-sm" : "text-ui-fg-muted")}>Workspace</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {scope === "workspace" && (
            <select value={channelId} onChange={e => setChannelId(e.target.value)} className={cn(INPUT_CLS, "h-8 py-0 text-xs")}>
              <option value="">Tất cả channel</option>
              {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <select value={authorId} onChange={e => setAuthorId(e.target.value)} className={cn(INPUT_CLS, "h-8 py-0 text-xs", scope === "channel" && "col-span-2")}>
            <option value="">Tất cả tác giả</option>
            {users.map(u => <option key={u.email} value={u.email}>{u.name}</option>)}
          </select>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className={cn(INPUT_CLS, "h-8 py-0 text-xs")} />
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className={cn(INPUT_CLS, "h-8 py-0 text-xs")} />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {loading && <div className="py-4 text-center text-xs text-ui-fg-muted">Đang tìm...</div>}
        {!loading && results.length === 0 && q.trim() && <div className="py-4 text-center text-xs text-ui-fg-muted">Không tìm thấy</div>}
        {results.map(m => (
          <button key={m.id} onClick={() => onJump(m)}
            className="mb-1.5 block w-full rounded-lg border border-ui-border-base bg-ui-bg-subtle px-2.5 py-2 text-left transition-colors hover:border-blue-300 hover:bg-blue-500/5">
            <div className="mb-0.5 flex items-center justify-between gap-2 text-[11px] text-ui-fg-muted">
              <span>{m.author_name} · {fmtDate(m.created_at)} {fmtTime(m.created_at)}</span>
              {m.channel_name && <span className="max-w-[120px] truncate"># {m.channel_name}</span>}
            </div>
            <div className="whitespace-pre-wrap text-[13px] leading-snug text-ui-fg-base" dangerouslySetInnerHTML={{ __html: highlight(m.content) }} />
          </button>
        ))}
      </div>
    </div>
  )
}
function TemplatePicker({ templates, query, activeIndex, onSelect, onClose }: {
  templates: Template[]; query: string; activeIndex: number
  onSelect: (t: Template) => void; onClose: () => void
}) {
  const filtered = templates.filter(t =>
    !query || t.label.toLowerCase().includes(query.toLowerCase()) || t.content.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 6)

  if (filtered.length === 0) return null
  return (
    <div className="chat-anim-fadeup absolute bottom-full left-0 z-50 mb-2 w-[380px] max-w-[90%] overflow-hidden rounded-xl border border-ui-border-base bg-ui-bg-base shadow-xl">
      <div className="flex items-center justify-between border-b border-ui-border-base bg-ui-bg-subtle px-3 py-1.5">
        <span className="text-[11px] font-bold uppercase tracking-wide text-ui-fg-muted">⚡ Mẫu tin nhắn</span>
        <button onClick={onClose} className="text-xs text-ui-fg-muted hover:text-ui-fg-base">✕</button>
      </div>
      {filtered.map((t, i) => (
        <button key={t.id} onClick={() => onSelect(t)}
          className={cn("block w-full px-3 py-2 text-left transition-colors",
            i === activeIndex ? "bg-blue-500/10" : "hover:bg-ui-bg-base-hover")}>
          <div className="text-xs font-bold text-ui-fg-base">/{t.label}</div>
          <div className="truncate text-xs text-ui-fg-muted">{t.content}</div>
        </button>
      ))}
    </div>
  )
}

function TemplatesModal({ templates, isManager, onClose, onChanged }: {
  templates: Template[]; isManager: boolean; onClose: () => void; onChanged: () => void
}) {
  const [label, setLabel] = useState("")
  const [content, setContent] = useState("")
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState("")

  const create = async () => {
    if (!label.trim() || !content.trim()) return
    setSaving(true); setErr("")
    try {
      const r = await apiFetch("/admin/mkt-chat/templates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim().replace(/\s+/g, "-").toLowerCase(), content: content.trim() }),
      }).then(r => r.json())
      if (r.template) { setLabel(""); setContent(""); onChanged() }
      else setErr(r.error || "Lỗi tạo mẫu")
    } finally { setSaving(false) }
  }

  const remove = async (id: string) => {
    await apiFetch(`/admin/mkt-chat/templates/${id}`, { method: "DELETE" })
    onChanged()
  }

  return (
    <div className="chat-anim-fadein fixed inset-0 z-[200] flex items-center justify-center bg-black/45" onClick={onClose}>
      <div className="chat-anim-fadeup flex max-h-[80vh] w-[480px] max-w-[95vw] flex-col rounded-xl bg-ui-bg-base p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h2 className="mb-1 text-base font-extrabold text-ui-fg-base">⚡ Mẫu tin nhắn nhanh</h2>
        <p className="mb-4 text-xs text-ui-fg-muted">Gõ <b>/</b> trong ô chat để chèn mẫu. {isManager ? "Bạn có thể thêm/xóa mẫu cho cả team." : "Liên hệ manager để thêm mẫu mới."}</p>

        <div className="flex-1 overflow-y-auto">
          {templates.length === 0 && <div className="py-6 text-center text-xs text-ui-fg-muted">Chưa có mẫu nào</div>}
          {templates.map(t => (
            <div key={t.id} className="mb-1.5 flex items-start gap-2 rounded-lg border border-ui-border-base bg-ui-bg-subtle px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-ui-fg-base">/{t.label}</div>
                <div className="whitespace-pre-wrap text-xs leading-relaxed text-ui-fg-subtle">{t.content}</div>
              </div>
              {isManager && (
                <button onClick={() => remove(t.id)} title="Xóa mẫu"
                  className="shrink-0 rounded-md px-1.5 py-0.5 text-xs text-rose-400 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10">🗑</button>
              )}
            </div>
          ))}
        </div>

        {isManager && (
          <div className="mt-3 flex flex-col gap-2 border-t border-ui-border-base pt-3">
            <input className={INPUT_CLS} placeholder="Tên mẫu (vd: chao-khach)" value={label} onChange={e => setLabel(e.target.value)} />
            <textarea className={cn(INPUT_CLS, "resize-y")} rows={2} placeholder="Nội dung mẫu..." value={content} onChange={e => setContent(e.target.value)} />
            {err && <div className="text-xs text-rose-500">{err}</div>}
            <button onClick={create} disabled={saving || !label.trim() || !content.trim()}
              className="self-end rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-bold text-white transition hover:bg-blue-700 active:scale-95 disabled:opacity-40">
              {saving ? "Đang lưu..." : "+ Thêm mẫu"}
            </button>
          </div>
        )}

        <button onClick={onClose}
          className="mt-3 self-end rounded-lg border border-ui-border-base px-4 py-1.5 text-xs text-ui-fg-subtle transition-colors hover:bg-ui-bg-base-hover">
          Đóng
        </button>
      </div>
    </div>
  )
}

// ─── Modals (channel / members / task) ───────────────────────────────────────

function UserCheckList({ users, selected, onToggle }: { users: MktUser[]; selected: Set<string>; onToggle: (email: string) => void }) {
  return (
    <div className="max-h-[240px] overflow-y-auto rounded-lg border border-ui-border-base">
      {users.map(u => {
        const checked = selected.has(u.email)
        return (
          <button key={u.email} onClick={() => onToggle(u.email)}
            className={cn("flex w-full items-center gap-2.5 border-b border-ui-border-base px-3 py-2 text-left transition-colors last:border-b-0",
              checked ? "bg-blue-500/10" : "hover:bg-ui-bg-base-hover")}>
            <span className={cn("grid size-4 shrink-0 place-items-center rounded border-2 text-[10px] text-white transition-colors",
              checked ? "border-blue-600 bg-blue-600" : "border-ui-border-strong bg-ui-bg-base")}>
              {checked && "✓"}
            </span>
            <Avatar name={u.name} className="size-6 text-[10px]" />
            <span className="text-[13px] text-ui-fg-base">{u.name}</span>
          </button>
        )
      })}
      {users.length === 0 && <div className="p-3 text-xs text-ui-fg-muted">Không có thành viên</div>}
    </div>
  )
}

function CreateChannelModal({ onClose, onCreated, users }: { onClose: () => void; onCreated: () => void; users: MktUser[] }) {
  const [name, setName] = useState("")
  const [desc, setDesc] = useState("")
  const [isPrivate, setIsPrivate] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  const toggle = (email: string) => setSelected(s => { const n = new Set(s); n.has(email) ? n.delete(email) : n.add(email); return n })
  const submit = async () => {
    if (!name.trim()) return
    setSaving(true)
    await apiFetch("/admin/mkt-chat/channels", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description: desc, member_ids: [...selected], is_private: isPrivate }),
    })
    setSaving(false); onCreated(); onClose()
  }

  return (
    <div className="chat-anim-fadein fixed inset-0 z-[200] flex items-center justify-center bg-black/45" onClick={onClose}>
      <div className="chat-anim-fadeup w-[440px] max-w-[95vw] rounded-xl bg-ui-bg-base p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h2 className="mb-4 text-base font-extrabold text-ui-fg-base">Tạo group chat mới</h2>
        <div className="flex flex-col gap-3">
          <div><label className={LABEL_CLS}>Tên group *</label>
            <input className={INPUT_CLS} value={name} onChange={e => setName(e.target.value)} placeholder="VD: ads-meta-team..." autoFocus /></div>
          <div><label className={LABEL_CLS}>Mô tả</label>
            <input className={INPUT_CLS} value={desc} onChange={e => setDesc(e.target.value)} placeholder="Muc dich cua group..." /></div>
          <label className="flex items-center gap-2 rounded-lg border border-ui-border-base bg-ui-bg-subtle px-3 py-2 text-[13px] text-ui-fg-base">
            <input type="checkbox" checked={isPrivate} onChange={e => setIsPrivate(e.target.checked)} />
            <span>Riêng tư</span>
          </label>
          <div><label className={LABEL_CLS}>Thêm thành viên</label>
            <UserCheckList users={users} selected={selected} onToggle={toggle} /></div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-ui-border-base px-4 py-2 text-[13px] text-ui-fg-base transition-colors hover:bg-ui-bg-base-hover">Hủy</button>
          <button onClick={submit} disabled={saving || !name.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-blue-700 active:scale-95 disabled:opacity-50">
            {saving ? "Đang tạo..." : "Tạo group"}
          </button>
        </div>
      </div>
    </div>
  )
}
function ManageMembersModal({ channel, users, onClose, onSaved }: { channel: Channel; users: MktUser[]; onClose: () => void; onSaved: () => void }) {
  const initial = useMemo(() => new Set(channel.member_ids || []), [channel])
  const [selected, setSelected] = useState<Set<string>>(new Set(initial))
  const [saving, setSaving] = useState(false)

  const toggle = (email: string) => setSelected(s => { const n = new Set(s); n.has(email) ? n.delete(email) : n.add(email); return n })
  const submit = async () => {
    setSaving(true)
    const add = [...selected].filter(e => !initial.has(e))
    const remove = [...initial].filter(e => !selected.has(e))
    await apiFetch(`/admin/mkt-chat/channels/${channel.id}/members`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ add, remove }),
    })
    setSaving(false); onSaved(); onClose()
  }

  return (
    <div className="chat-anim-fadein fixed inset-0 z-[200] flex items-center justify-center bg-black/45" onClick={onClose}>
      <div className="chat-anim-fadeup w-[440px] max-w-[95vw] rounded-xl bg-ui-bg-base p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h2 className="mb-1 text-base font-extrabold text-ui-fg-base">Thành viên #{channel.name}</h2>
        <p className="mb-4 text-xs text-ui-fg-muted">Tích để thêm / bỏ thành viên</p>
        <UserCheckList users={users} selected={selected} onToggle={toggle} />
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-ui-border-base px-4 py-2 text-[13px] text-ui-fg-base transition-colors hover:bg-ui-bg-base-hover">Hủy</button>
          <button onClick={submit} disabled={saving}
            className="rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-blue-700 active:scale-95 disabled:opacity-50">
            {saving ? "Đang lưu..." : "Lưu"}
          </button>
        </div>
      </div>
    </div>
  )
}

function CreateTaskModal({ channelId, users, onClose, onCreated }: { channelId: string; users: MktUser[]; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ title: "", type: "ads_camp", assignee_id: "", deadline: "" })
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!form.title.trim() || !form.assignee_id) return
    setSaving(true)
    await apiFetch(`/admin/mkt-chat/channels/${channelId}/create-task`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    })
    setSaving(false); onCreated(); onClose()
  }

  return (
    <div className="chat-anim-fadein fixed inset-0 z-[200] flex items-center justify-center bg-black/45" onClick={onClose}>
      <div className="chat-anim-fadeup w-[400px] max-w-[95vw] rounded-xl bg-ui-bg-base p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h2 className="mb-4 text-sm font-extrabold text-ui-fg-base">📋 Tạo task từ chat</h2>
        <div className="flex flex-col gap-2.5">
          <div><label className={LABEL_CLS}>Tiêu đề *</label>
            <input className={INPUT_CLS} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Tiêu đề task..." autoFocus /></div>
          <div><label className={LABEL_CLS}>Loại</label>
            <select className={INPUT_CLS} value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
              <option value="ads_camp">Chạy Ads / Camp</option>
              <option value="content_post">Nội dung / Bài FB</option>
            </select></div>
          <div><label className={LABEL_CLS}>Giao cho *</label>
            <select className={INPUT_CLS} value={form.assignee_id} onChange={e => setForm(f => ({ ...f, assignee_id: e.target.value }))}>
              <option value="">-- Chọn --</option>
              {users.map(u => <option key={u.email} value={u.email}>{u.name}</option>)}
            </select></div>
          <div><label className={LABEL_CLS}>Deadline</label>
            <input type="date" className={INPUT_CLS} value={form.deadline} onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} /></div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-ui-border-base px-3.5 py-1.5 text-xs text-ui-fg-base transition-colors hover:bg-ui-bg-base-hover">Hủy</button>
          <button onClick={submit} disabled={saving || !form.title.trim() || !form.assignee_id}
            className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700 active:scale-95 disabled:opacity-40">
            {saving ? "Đang tạo..." : "Tạo task"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Context Panel (cột 3) ───────────────────────────────────────────────────

function ContextPanel({ channel, mktUsers, onlineEmails, isManager, onManageMembers, onCreateTask, onClose }: {
  channel: Channel
  mktUsers: MktUser[]
  onlineEmails: string[]
  isManager: boolean
  onManageMembers: () => void
  onCreateTask: () => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<"info" | "tasks" | "files">("info")
  const [tasks, setTasks] = useState<LinkedTask[]>([])
  const [files, setFiles] = useState<ChatFile[]>([])
  const [loading, setLoading] = useState(false)
  const [fileType, setFileType] = useState<"all" | "image" | "file">("all")
  const [fileAuthor, setFileAuthor] = useState("")
  const [fileFrom, setFileFrom] = useState("")
  const [fileTo, setFileTo] = useState("")

  useEffect(() => {
    if (tab === "tasks") {
      setLoading(true)
      apiFetch(`/admin/mkt-tasks?channel_id=${channel.id}`)
        .then(r => r.json()).then(d => setTasks(d.tasks || [])).finally(() => setLoading(false))
    } else if (tab === "files") {
      const params = new URLSearchParams()
      if (fileType !== "all") params.set("type", fileType)
      if (fileAuthor) params.set("author", fileAuthor)
      if (fileFrom) params.set("from", fileFrom)
      if (fileTo) params.set("to", `${fileTo}T23:59:59`)
      setLoading(true)
      apiFetch(`/admin/mkt-chat/channels/${channel.id}/files?${params.toString()}`)
        .then(r => r.json()).then(d => setFiles(d.files || [])).finally(() => setLoading(false))
    }
  }, [tab, channel.id, fileType, fileAuthor, fileFrom, fileTo])

  const members = (channel.member_ids || []).map(email => ({
    email,
    name: mktUsers.find(u => u.email === email)?.name || email.split("@")[0],
    online: onlineEmails.includes(email),
  })).sort((a, b) => Number(b.online) - Number(a.online))

  const tabBtn = (t: typeof tab, label: string) => (
    <button key={t} onClick={() => setTab(t)}
      className={cn("flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition-all",
        tab === t ? "bg-ui-bg-base text-ui-fg-base shadow-sm" : "text-ui-fg-muted hover:text-ui-fg-base")}>
      {label}
    </button>
  )

  return (
    <aside className="chat-anim-panel flex w-[300px] shrink-0 flex-col border-l border-ui-border-base bg-ui-bg-subtle">
      <div className="flex items-center justify-between border-b border-ui-border-base px-3 py-2.5">
        <span className="text-[13px] font-bold text-ui-fg-base">Chi tiết</span>
        <button onClick={onClose} className="grid size-6 place-items-center rounded-md text-ui-fg-muted transition-colors hover:bg-ui-bg-base-hover hover:text-ui-fg-base">✕</button>
      </div>

      <div className="m-2 flex gap-0.5 rounded-lg bg-ui-bg-component p-0.5">
        {tabBtn("info", "Info")}
        {tabBtn("tasks", "Task")}
        {tabBtn("files", "Files")}
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {tab === "info" && (
          <div className="flex flex-col gap-4">
            {channel.description && (
              <div>
                <div className={LABEL_CLS}>Mô tả</div>
                <p className="text-[13px] leading-relaxed text-ui-fg-subtle">{channel.description}</p>
              </div>
            )}
            <div>
              <div className="flex items-center justify-between">
                <div className={LABEL_CLS}>Thành viên ({members.length})</div>
                {isManager && (
                  <button onClick={onManageMembers}
                    className="text-[11px] font-medium text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-400">Quản lý</button>
                )}
              </div>
              <div className="flex flex-col gap-0.5">
                {members.map(m => (
                  <div key={m.email} className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-ui-bg-base-hover">
                    <Avatar name={m.name} online={m.online} className="size-7 text-[11px]" />
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-ui-fg-base">{m.name}</div>
                      <div className="text-[10px] text-ui-fg-muted">{m.online ? "Đang hoạt động" : "Ngoại tuyến"}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="text-[11px] text-ui-fg-disabled">
              Tạo ngày {new Date(channel.created_at).toLocaleDateString("vi-VN")}
            </div>
          </div>
        )}

        {tab === "tasks" && (
          <div className="flex flex-col gap-2">
            {isManager && (
              <button onClick={onCreateTask}
                className="rounded-lg border border-dashed border-ui-border-base px-3 py-2 text-xs font-medium text-ui-fg-muted transition-colors hover:border-blue-300 hover:bg-blue-500/5 hover:text-blue-600">
                + Tạo task từ channel này
              </button>
            )}
            {loading && <div className="py-4 text-center text-xs text-ui-fg-muted">Đang tải...</div>}
            {!loading && tasks.length === 0 && <div className="py-4 text-center text-xs text-ui-fg-muted">Chưa có task nào liên kết</div>}
            {tasks.map(t => {
              const st = TASK_STATUS[t.status] || TASK_STATUS.todo
              return (
                <button key={t.id}
                  onClick={() => { window.location.href = `/app/mkt-tasks?task=${t.id}` }}
                  className="rounded-lg border border-ui-border-base bg-ui-bg-base p-2.5 text-left shadow-sm transition-all hover:-translate-y-px hover:border-ui-border-strong hover:shadow-md">
                  <div className="mb-1 flex items-center gap-1.5">
                    <span className={cn("rounded-full px-1.5 py-px text-[10px] font-semibold", st.chip)}>{st.label}</span>
                    {t.priority === "high" && <span className="text-[10px] font-semibold text-rose-500">▲ Cao</span>}
                  </div>
                  <div className="text-[13px] font-medium leading-snug text-ui-fg-base line-clamp-2">{t.title}</div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-ui-fg-muted">
                    <span>👤 {t.assignee_name}</span>
                    {t.deadline && <span>📅 {fmtDate(t.deadline)}</span>}
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {tab === "files" && (
          <div>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <select value={fileType} onChange={e => setFileType(e.target.value as any)} className={cn(INPUT_CLS, "h-8 py-0 text-xs")}>
                <option value="all">Tất cả</option>
                <option value="image">Ảnh</option>
                <option value="file">File</option>
              </select>
              <select value={fileAuthor} onChange={e => setFileAuthor(e.target.value)} className={cn(INPUT_CLS, "h-8 py-0 text-xs")}>
                <option value="">Mọi người</option>
                {mktUsers.map(u => <option key={u.email} value={u.email}>{u.name}</option>)}
              </select>
              <input type="date" value={fileFrom} onChange={e => setFileFrom(e.target.value)} className={cn(INPUT_CLS, "h-8 py-0 text-xs")} />
              <input type="date" value={fileTo} onChange={e => setFileTo(e.target.value)} className={cn(INPUT_CLS, "h-8 py-0 text-xs")} />
            </div>
            {loading && <div className="py-4 text-center text-xs text-ui-fg-muted">Đang tải...</div>}
            {!loading && files.length === 0 && <div className="py-4 text-center text-xs text-ui-fg-muted">Chưa có file nào</div>}
            <div className="mb-2 grid grid-cols-3 gap-1.5">
              {files.filter(f => f.file_type?.startsWith("image")).map(f => (
                <a key={f.id} href={f.file_url} target="_blank" rel="noreferrer"
                  title={`${f.author_name || f.author_id} · ${fmtDate(f.created_at)}`}
                  className="block aspect-square overflow-hidden rounded-lg border border-ui-border-base transition-transform hover:scale-105">
                  <img src={f.file_url} alt={f.file_name || "ảnh"} className="size-full object-cover" />
                </a>
              ))}
            </div>
            <div className="flex flex-col gap-1">
              {files.filter(f => !f.file_type?.startsWith("image")).map(f => (
                <a key={f.id} href={f.file_url} target="_blank" rel="noreferrer"
                  className="flex items-center gap-2 rounded-lg border border-ui-border-base bg-ui-bg-base px-2.5 py-2 transition-colors hover:border-blue-300 hover:bg-blue-500/5">
                  <span className="text-base">📎</span>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-ui-fg-base">{f.file_name || "File"}</div>
                    <div className="text-[10px] text-ui-fg-muted">{f.author_name || f.author_id} · {fmtDate(f.created_at)}</div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}

function ThreadPanel({ channelId, root, users, refreshKey, onClose }: {
  channelId: string
  root: Message
  users: MktUser[]
  refreshKey: number
  onClose: () => void
}) {
  const [rootMessage, setRootMessage] = useState<Message>(root)
  const [replies, setReplies] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)

  const loadThread = useCallback(() => {
    setLoading(true)
    apiFetch(`/admin/mkt-chat/channels/${channelId}/messages/${root.id}/thread`)
      .then(r => r.json()).then(d => {
        if (d.root) setRootMessage(d.root)
        setReplies(d.replies || [])
      }).finally(() => setLoading(false))
  }, [channelId, root.id])

  useEffect(() => { loadThread() }, [loadThread, refreshKey])

  const sendReply = async () => {
    const text = input.trim()
    if (!text || sending) return
    setInput(""); setSending(true)
    const r = await apiFetch(`/admin/mkt-chat/channels/${channelId}/messages/${rootMessage.id}/thread`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: text }),
    }).then(r => r.json()).catch(() => null)
    if (r?.reply) setReplies(prev => prev.some(m => m.id === r.reply.id) ? prev : [...prev, r.reply])
    setSending(false)
  }

  const renderMini = (m: Message) => (
    <div key={m.id} className="flex gap-2 rounded-lg px-2 py-2 hover:bg-ui-bg-base-hover">
      <Avatar name={m.author_name} className="size-7 text-[11px]" />
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-baseline gap-2 text-[11px] text-ui-fg-muted">
          <span className="font-semibold text-ui-fg-base">{m.author_name}</span>
          <span>{fmtTime(m.created_at)}</span>
        </div>
        <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-ui-fg-base" dangerouslySetInnerHTML={{ __html: renderMentions(m.content, m.mentions, users) }} />
      </div>
    </div>
  )

  return (
    <aside className="chat-anim-panel flex w-[360px] shrink-0 flex-col border-l border-ui-border-base bg-ui-bg-base">
      <div className="flex items-center justify-between border-b border-ui-border-base px-4 py-3">
        <div>
          <div className="text-sm font-bold text-ui-fg-base">Thread</div>
          <div className="text-[11px] text-ui-fg-muted">{rootMessage.reply_count || replies.length} phản hồi</div>
        </div>
        <button onClick={onClose} className="grid size-7 place-items-center rounded-md text-ui-fg-muted hover:bg-ui-bg-base-hover">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {renderMini(rootMessage)}
        <div className="my-2 border-t border-ui-border-base" />
        {loading && <div className="py-4 text-center text-xs text-ui-fg-muted">Đang tải...</div>}
        {!loading && replies.length === 0 && <div className="py-4 text-center text-xs text-ui-fg-muted">Chưa có phản hồi</div>}
        {replies.map(renderMini)}
      </div>
      <div className="border-t border-ui-border-base p-3">
        <textarea value={input} onChange={e => setInput(e.target.value)} rows={2}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply() } }}
          placeholder={`Trả lời ${rootMessage.author_name}...`}
          className={cn(INPUT_CLS, "max-h-28 resize-none text-[13px]")} />
        <div className="mt-2 flex justify-end">
          <button onClick={sendReply} disabled={sending || !input.trim()}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-blue-700 disabled:opacity-40">
            {sending ? "Đang gửi..." : "Gửi"}
          </button>
        </div>
      </div>
    </aside>
  )
}
const PANEL_STORAGE_KEY = "mkt-chat:panel"

export default function MktChatPage() {
  const { has, isSuper, email: currentUserId } = useCurrentPermissions()
  const isManager = isSuper || has("page.mkt-chat.manage")

  const [channels, setChannels] = useState<Channel[]>([])
  const [onlineEmails, setOnlineEmails] = useState<string[]>([])
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [typingNames, setTypingNames] = useState<string[]>([])
  const [input, setInput] = useState("")
  const [composerMode, setComposerMode] = useState<"message" | "note">("message")
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(false)
  const [mktUsers, setMktUsers] = useState<MktUser[]>([])
  const [templates, setTemplates] = useState<Template[]>([])

  const [sidebarTab, setSidebarTab] = useState<"all" | "unread" | "mentioned">("all")
  const [channelSearch, setChannelSearch] = useState("")
  const [panelOpen, setPanelOpen] = useState(() => localStorage.getItem(PANEL_STORAGE_KEY) !== "0")

  const [showCreateChannel, setShowCreateChannel] = useState(false)
  const [showCreateTask, setShowCreateTask] = useState(false)
  const [showManageMembers, setShowManageMembers] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [openThread, setOpenThread] = useState<Message | null>(null)
  const [showTemplatesModal, setShowTemplatesModal] = useState(false)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [uploadingFile, setUploadingFile] = useState(false)
  const [newMsgCount, setNewMsgCount] = useState(0)
  const [threadRefreshKey, setThreadRefreshKey] = useState(0)
  const [notifications, setNotifications] = useState<MktNotification[]>([])
  const [notificationUnread, setNotificationUnread] = useState(0)
  const [notificationOpen, setNotificationOpen] = useState(false)
  const [notificationSoundEnabled, setNotificationSoundEnabled] = useState(() => localStorage.getItem("mkt-chat:sound") !== "0")
  const [notificationRepeatSoundEnabled, setNotificationRepeatSoundEnabled] = useState(() => localStorage.getItem("mkt-chat:repeat-sound") !== "0")

  const messagesBoxRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const atBottomRef = useRef(true)
  const lastTypingPingRef = useRef(0)
  const typingTimersRef = useRef<Record<string, any>>({})
  const pendingJumpRef = useRef<string | null>(null)
  const mentionEntityRef = useRef<Record<string, string>>({})
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioUnlockedRef = useRef(false)
  const pendingMentionSoundRef = useRef(false)
  const mentionRepeatTimerRef = useRef<number | null>(null)
  const mentionRepeatCountRef = useRef(0)

  // Mention autocomplete
  const [mentionQuery, setMentionQuery] = useState("")
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionIndex, setMentionIndex] = useState(0)
  const mentionSuggestions = useMemo(() => {
    const memberEmails = new Set(activeChannel?.member_ids || [])
    const scopedUsers = mktUsers.filter(u => memberEmails.has(u.email))
    const q = mentionQuery.toLowerCase()
    return scopedUsers.filter(u =>
      !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    ).slice(0, 5)
  }, [activeChannel?.member_ids, mentionQuery, mktUsers])
  // Template picker (slash command)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [templateIndex, setTemplateIndex] = useState(0)
  const templateQuery = input.startsWith("/") ? input.slice(1) : ""
  const templateSuggestions = templates.filter(t =>
    !templateQuery || t.label.toLowerCase().includes(templateQuery.toLowerCase()) || t.content.toLowerCase().includes(templateQuery.toLowerCase())
  ).slice(0, 6)

  // ── Data loading ───────────────────────────────────────────────────────────

  const loadChannels = useCallback(() => {
    apiFetch("/admin/mkt-chat/channels").then(r => r.json()).then(d => {
      const list: Channel[] = d.channels || []
      setChannels(list)
      setOnlineEmails(d.online_emails || [])
      setActiveChannel(prev => prev ? (list.find(c => c.id === prev.id) || prev) : prev)
    })
  }, [])

  const loadTemplates = useCallback(() => {
    apiFetch("/admin/mkt-chat/templates").then(r => r.json()).then(d => setTemplates(d.templates || [])).catch(() => {})
  }, [])

  const loadNotifications = useCallback(() => {
    apiFetch("/admin/mkt-chat/notifications")
      .then(r => r.json())
      .then(d => {
        setNotifications(d.notifications || [])
        setNotificationUnread(Number(d.unread_count || 0))
      })
      .catch(() => {})
  }, [])

  const clearMentionRepeatTimer = useCallback(() => {
    if (mentionRepeatTimerRef.current !== null) {
      window.clearTimeout(mentionRepeatTimerRef.current)
      mentionRepeatTimerRef.current = null
    }
  }, [])

  const stopMentionSoundReminder = useCallback(() => {
    clearMentionRepeatTimer()
    mentionRepeatCountRef.current = 0
    pendingMentionSoundRef.current = false
  }, [clearMentionRepeatTimer])

  const markNotificationsRead = useCallback(() => {
    stopMentionSoundReminder()
    apiFetch("/admin/mkt-chat/notifications/read", { method: "PATCH" })
      .then(r => r.json())
      .then(() => {
        setNotificationUnread(0)
        setNotifications(prev => prev.map(n => ({ ...n, read: true })))
      })
      .catch(() => {})
  }, [stopMentionSoundReminder])
  useEffect(() => {
    loadChannels()
    loadTemplates()
    loadNotifications()
    apiFetch("/admin/mkt-chat/users").then(r => r.json()).then(d => setMktUsers(d.users || []))
  }, [loadChannels, loadTemplates, loadNotifications])

  const playMentionSound = useCallback((force = false) => {
    if ((!force && !notificationSoundEnabled) || typeof window === "undefined") return false
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioContextCtor) return false
    const ctx = audioContextRef.current || new AudioContextCtor()
    audioContextRef.current = ctx

    const play = () => {
      audioUnlockedRef.current = true
      pendingMentionSoundRef.current = false
      emitMentionTone(ctx)
      return true
    }

    if (ctx.state === "suspended") {
      pendingMentionSoundRef.current = true
      ctx.resume().then(() => {
        if (ctx.state === "running") play()
      }).catch(() => {})
      return false
    }

    return play()
  }, [notificationSoundEnabled])

  useEffect(() => {
    clearMentionRepeatTimer()
    if (!notificationSoundEnabled || !notificationRepeatSoundEnabled || notificationUnread <= 0 || notificationOpen) {
      if (notificationUnread <= 0) mentionRepeatCountRef.current = 0
      return
    }

    const scheduleReminder = () => {
      mentionRepeatTimerRef.current = window.setTimeout(() => {
        mentionRepeatTimerRef.current = null
        if (mentionRepeatCountRef.current >= MENTION_SOUND_REPEAT_LIMIT) return
        mentionRepeatCountRef.current += 1
        playMentionSound()
        scheduleReminder()
      }, MENTION_SOUND_REPEAT_MS)
    }

    scheduleReminder()
    return clearMentionRepeatTimer
  }, [clearMentionRepeatTimer, notificationOpen, notificationRepeatSoundEnabled, notificationSoundEnabled, notificationUnread, playMentionSound])
  const unlockNotificationAudio = useCallback(() => {
    if (typeof window === "undefined") return
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioContextCtor) return
    const ctx = audioContextRef.current || new AudioContextCtor()
    audioContextRef.current = ctx

    const markUnlocked = () => {
      audioUnlockedRef.current = ctx.state === "running"
      if (audioUnlockedRef.current && pendingMentionSoundRef.current && notificationSoundEnabled) {
        playMentionSound(true)
      }
    }

    if (ctx.state === "suspended") {
      ctx.resume().then(markUnlocked).catch(() => {})
      return
    }
    markUnlocked()
  }, [notificationSoundEnabled, playMentionSound])

  useEffect(() => {
    const unlock = () => unlockNotificationAudio()
    window.addEventListener("pointerdown", unlock, { passive: true })
    window.addEventListener("keydown", unlock)
    return () => {
      window.removeEventListener("pointerdown", unlock)
      window.removeEventListener("keydown", unlock)
    }
  }, [unlockNotificationAudio])
  const loadMessages = useCallback((channelId: string, opts?: { scroll?: boolean; markRead?: boolean }) => {
    setLoading(true)
    if (opts?.scroll !== false) setNewMsgCount(0)
    apiFetch(`/admin/mkt-chat/channels/${channelId}/messages`)
      .then(r => r.json()).then(d => {
        setMessages(d.messages || [])
        setTypingNames(d.presence?.typing || [])
        if (opts?.scroll !== false) requestAnimationFrame(() => messagesEndRef.current?.scrollIntoView())
      }).finally(() => setLoading(false))
    if (opts?.markRead) {
      apiFetch(`/admin/mkt-chat/channels/${channelId}/last-read`, { method: "PATCH" }).catch(() => {})
    }
  }, [])

  // Load messages when channel changes
  useEffect(() => {
    if (!activeChannel) return
    atBottomRef.current = true
    loadMessages(activeChannel.id, { markRead: true })
  }, [activeChannel?.id, loadMessages])

  // SSE realtime: receive pushed events instead of 4s polling
  useEffect(() => {
    let es: EventSource | null = null
    let retryTimer: any = null
    let loadChannelsDebounceTimer: any = null

    const refreshActive = () => {
      if (activeChannel?.id) loadMessages(activeChannel.id, { scroll: false, markRead: true })
    }

    // Gộp nhiều sự kiện dồn dập (nhiều tin nhắn liên tiếp trong channel đông người)
    // thành 1 lần gọi loadChannels() thay vì gọi lại cho từng sự kiện.
    const loadChannelsDebounced = () => {
      clearTimeout(loadChannelsDebounceTimer)
      loadChannelsDebounceTimer = setTimeout(loadChannels, 600)
    }

    const connect = () => {
      es = new EventSource("/admin/mkt-chat/events")

      es.addEventListener("message.created", (e: MessageEvent) => {
        const data = JSON.parse(e.data || "{}")
        const msg = data.message as Message | undefined
        if (!msg?.id || !data.channel_id) return

        if (activeChannel?.id === data.channel_id) {
          setMessages(prev => {
            const withoutMatchingOptimistic = prev.filter(m => !(m.id.startsWith("opt-") && m.author_id === msg.author_id && m.content === msg.content))
            if (withoutMatchingOptimistic.some(m => m.id === msg.id)) return withoutMatchingOptimistic
            return [...withoutMatchingOptimistic, msg]
          })
          if (msg.author_id !== currentUserId && msg.msg_type !== "system_notify" && !atBottomRef.current) {
            setNewMsgCount(c => c + 1)
          }
          apiFetch(`/admin/mkt-chat/channels/${data.channel_id}/last-read`, { method: "PATCH" }).catch(() => {})
        }
        loadChannelsDebounced()
      })

      es.addEventListener("message.updated", (e: MessageEvent) => {
        const data = JSON.parse(e.data || "{}")
        if (activeChannel?.id !== data.channel_id || !data.message_id) return
        setMessages(prev => prev.map(m => m.id === data.message_id ? { ...m, ...("reactions" in data ? { reactions: data.reactions } : {}), ...("is_pinned" in data ? { is_pinned: data.is_pinned } : {}) } : m))
      })

      es.addEventListener("thread.reply.created", (e: MessageEvent) => {
        const data = JSON.parse(e.data || "{}")
        if (activeChannel?.id !== data.channel_id || !data.root_message_id) return
        setMessages(prev => prev.map(m => m.id === data.root_message_id
          ? { ...m, reply_count: Number(data.root_reply_count ?? ((m.reply_count || 0) + 1)) }
          : m
        ))
        if (openThread?.id === data.root_message_id) setThreadRefreshKey(k => k + 1)
      })

      es.addEventListener("channel.updated", () => loadChannelsDebounced())
      es.addEventListener("channel.member.updated", () => loadChannelsDebounced())
      es.addEventListener("mention.notification.created", (e: MessageEvent) => {
        const data = JSON.parse(e.data || "{}")
        const notification = data.notification as MktNotification | undefined
        if (!notification?.id) return
        mentionRepeatCountRef.current = 0
        setNotifications(prev => [notification, ...prev.filter(n => n.id !== notification.id)].slice(0, 30))
        setNotificationUnread(c => c + 1)
        playMentionSound()
      })
      es.addEventListener("mention.notifications.read", () => {
        stopMentionSoundReminder()
        setNotificationUnread(0)
        setNotifications(prev => prev.map(n => ({ ...n, read: true })))
      })
      es.addEventListener("read.updated", (e: MessageEvent) => {
        const data = JSON.parse(e.data || "{}")
        if (!data.channel_id) return
        setChannels(prev => prev.map(c => c.id === data.channel_id ? { ...c, unread_count: 0 } : c))
      })

      es.addEventListener("typing.started", (e: MessageEvent) => {
        const data = JSON.parse(e.data || "{}")
        if (activeChannel?.id !== data.channel_id || data.email === currentUserId) return
        const label = data.name || data.email
        setTypingNames(prev => prev.includes(label) ? prev : [...prev, label])
        if (typingTimersRef.current[data.email]) clearTimeout(typingTimersRef.current[data.email])
        typingTimersRef.current[data.email] = setTimeout(() => {
          setTypingNames(prev => prev.filter(n => n !== label))
          delete typingTimersRef.current[data.email]
        }, 6000)
      })

      es.onerror = () => {
        es?.close()
        loadChannels()
        loadNotifications()
        refreshActive()
        retryTimer = setTimeout(connect, 5000)
      }
    }

    connect()

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        loadChannels()
        loadNotifications()
        refreshActive()
      }
    }
    document.addEventListener("visibilitychange", onVisible)

    return () => {
      es?.close()
      clearTimeout(retryTimer)
      clearTimeout(loadChannelsDebounceTimer)
      document.removeEventListener("visibilitychange", onVisible)
      Object.values(typingTimersRef.current).forEach(clearTimeout)
      typingTimersRef.current = {}
    }
  }, [activeChannel?.id, currentUserId, loadChannels, loadMessages, loadNotifications, openThread?.id, playMentionSound, stopMentionSoundReminder])

  // Smart autoscroll: chỉ cuộn khi user đang ở đáy
  useEffect(() => {
    if (atBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
      setNewMsgCount(0)
    }
  }, [messages])

  const handleScroll = () => {
    const el = messagesBoxRef.current
    if (!el) return
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 80
    atBottomRef.current = atBottom
    if (atBottom) setNewMsgCount(0)
  }

  const scrollToBottom = () => {
    atBottomRef.current = true
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    setNewMsgCount(0)
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  const sendMessage = async () => {
    if (!input.trim() || !activeChannel || sending) return
    const text = input.trim()
    const mode = composerMode
    const currentReply = replyTo
    const mentionEmails = collectMentionEntityEmails(text, mentionEntityRef.current, activeChannel.member_ids)
    mentionEntityRef.current = {}
    setInput("")
    setReplyTo(null)
    setMentionOpen(false)
    setTemplateOpen(false)
    setSending(true)
    atBottomRef.current = true
    const optimistic: Message = {
      id: `opt-${Date.now()}`, channel_id: activeChannel.id, author_id: currentUserId,
      author_name: "Bạn", content: text, task_id: null, msg_type: mode === "note" ? "internal_note" : "text", metadata: null,
      reply_to_id: currentReply?.id || null,
      reply_to: currentReply ? { id: currentReply.id, content: currentReply.content.slice(0, 80), author_name: currentReply.author_name } : null,
      file_url: null, file_type: null, file_name: null, file_expires_at: null,
      reactions: {}, is_pinned: false, mentions: mentionEmails,
      reply_count: 0,
      created_at: new Date().toISOString(),
    }
    setMessages(m => [...m, optimistic])
    await apiFetch(`/admin/mkt-chat/channels/${activeChannel.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text, reply_to_id: currentReply?.id || null, msg_type: mode === "note" ? "internal_note" : "text", mentions: mentionEmails }),
    })
    setSending(false)
    textareaRef.current?.focus()
  }

  const pingTyping = () => {
    if (!activeChannel) return
    const now = Date.now()
    if (now - lastTypingPingRef.current < 2500) return
    lastTypingPingRef.current = now
    apiFetch(`/admin/mkt-chat/channels/${activeChannel.id}/typing`, { method: "POST" }).catch(() => {})
  }

  const handleInputChange = (val: string) => {
    setInput(val)
    if (val.trim()) pingTyping()

    // Slash template: chỉ khi "/" đứng đầu
    if (val.startsWith("/")) {
      setTemplateOpen(true); setTemplateIndex(0); setMentionOpen(false)
      return
    }
    setTemplateOpen(false)

    // Detect @mention
    const atIdx = val.lastIndexOf("@")
    if (atIdx >= 0 && atIdx === val.length - 1) {
      setMentionQuery(""); setMentionOpen(true); setMentionIndex(0)
    } else if (atIdx >= 0 && !val.slice(atIdx + 1).includes(" ")) {
      setMentionQuery(val.slice(atIdx + 1)); setMentionOpen(true); setMentionIndex(0)
    } else {
      setMentionOpen(false)
    }
  }

  const insertMention = (user: MktUser) => {
    const atIdx = input.lastIndexOf("@")
    mentionEntityRef.current[user.email] = user.name
    setInput(input.slice(0, atIdx) + `@${user.name} `)
    setMentionOpen(false)
    textareaRef.current?.focus()
  }

  const insertTemplate = (t: Template) => {
    mentionEntityRef.current = {}
    setInput(t.content)
    setTemplateOpen(false)
    textareaRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (templateOpen && templateSuggestions.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setTemplateIndex(i => Math.min(i + 1, templateSuggestions.length - 1)); return }
      if (e.key === "ArrowUp") { e.preventDefault(); setTemplateIndex(i => Math.max(i - 1, 0)); return }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertTemplate(templateSuggestions[templateIndex]); return }
      if (e.key === "Escape") { setTemplateOpen(false); return }
    }
    if (mentionOpen) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex(i => Math.min(i + 1, mentionSuggestions.length - 1)) }
      else if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex(i => Math.max(i - 1, 0)) }
      else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); if (mentionSuggestions[mentionIndex]) insertMention(mentionSuggestions[mentionIndex]) }
      else if (e.key === "Escape") setMentionOpen(false)
      return
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  const handleUpload = async (file: File) => {
    if (!activeChannel) return
    setUploadingFile(true)
    const fd = new FormData(); fd.append("file", file)
    await apiFetch(`/admin/mkt-chat/channels/${activeChannel.id}/upload`, { method: "POST", body: fd })
    // Refresh ngay để thấy file
    const d = await apiFetch(`/admin/mkt-chat/channels/${activeChannel.id}/messages`).then(r => r.json()).catch(() => null)
    if (d?.messages) { atBottomRef.current = true; setMessages(d.messages) }
    setUploadingFile(false)
  }

  const handleReact = async (msgId: string, emoji: string) => {
    if (!activeChannel) return
    const r = await apiFetch(`/admin/mkt-chat/channels/${activeChannel.id}/messages/${msgId}/react`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emoji }),
    })
    const data = await r.json()
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, reactions: data.reactions } : m))
  }

  const handlePin = async (msgId: string) => {
    if (!activeChannel) return
    const r = await apiFetch(`/admin/mkt-chat/channels/${activeChannel.id}/messages/${msgId}/pin`, { method: "POST" })
    const data = await r.json()
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, is_pinned: data.is_pinned } : m))
    loadChannels()
  }

  const jumpToMessage = (msgId: string) => {
    pendingJumpRef.current = null
    setShowSearch(false)
    const el = messageRefs.current[msgId]
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" })
      el.classList.remove("chat-anim-highlight")
      void el.offsetWidth // restart animation
      el.classList.add("chat-anim-highlight")
    }
  }


  const jumpToSearchResult = (msg: Message) => {
    if (msg.channel_id !== activeChannel?.id) {
      const target = channels.find(c => c.id === msg.channel_id)
      if (target) {
        pendingJumpRef.current = msg.id
        setOpenThread(null)
        setActiveChannel(target)
        setShowSearch(false)
      }
      return
    }
    jumpToMessage(msg.id)
  }

  const toggleNotifications = () => {
    const nextOpen = !notificationOpen
    setNotificationOpen(nextOpen)
    if (nextOpen && notificationUnread > 0) markNotificationsRead()
  }

  const toggleNotificationSound = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    const next = !notificationSoundEnabled
    setNotificationSoundEnabled(next)
    localStorage.setItem("mkt-chat:sound", next ? "1" : "0")
    if (!next) {
      stopMentionSoundReminder()
      return
    }
    mentionRepeatCountRef.current = 0
    unlockNotificationAudio()
    playMentionSound(true)
  }

  const toggleNotificationRepeatSound = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    const next = !notificationRepeatSoundEnabled
    setNotificationRepeatSoundEnabled(next)
    localStorage.setItem("mkt-chat:repeat-sound", next ? "1" : "0")
    mentionRepeatCountRef.current = 0
    if (!next) stopMentionSoundReminder()
  }
  const jumpToNotification = (notification: MktNotification) => {
    stopMentionSoundReminder()
    setNotificationOpen(false)
    setShowSearch(false)
    setOpenThread(null)
    pendingJumpRef.current = notification.message_id

    const target = channels.find(c => c.id === notification.channel_id)
    if (target && target.id !== activeChannel?.id) {
      setActiveChannel(target)
      return
    }
    requestAnimationFrame(() => jumpToMessage(notification.message_id))
  }
  useEffect(() => {
    const pendingId = pendingJumpRef.current
    if (!pendingId || !messages.some(m => m.id === pendingId)) return
    requestAnimationFrame(() => jumpToMessage(pendingId))
  }, [messages])

  const togglePanel = () => {
    setPanelOpen(p => {
      localStorage.setItem(PANEL_STORAGE_KEY, p ? "0" : "1")
      return !p
    })
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const visibleChannels = useMemo(() => {
    let list = channels
    if (sidebarTab === "unread") list = list.filter(c => c.unread_count > 0)
    if (sidebarTab === "mentioned") list = list.filter(c => c.mention_count > 0)
    if (channelSearch.trim()) {
      const q = channelSearch.toLowerCase()
      list = list.filter(c => c.name.toLowerCase().includes(q))
    }
    return list
  }, [channels, sidebarTab, channelSearch])

  useEffect(() => {
    if (!activeChannel && visibleChannels.length > 0) {
      setActiveChannel(visibleChannels[0])
    }
  }, [activeChannel, visibleChannels])

  useEffect(() => {
    if (channels.length === 0) return
    const raw = sessionStorage.getItem("mkt-chat:pending-jump")
    if (!raw) return

    let jump: { channel_id?: string; message_id?: string } | null = null
    try { jump = JSON.parse(raw) } catch { jump = null }
    if (!jump?.channel_id || !jump?.message_id) {
      sessionStorage.removeItem("mkt-chat:pending-jump")
      return
    }

    const target = channels.find(c => c.id === jump.channel_id)
    if (!target) return
    sessionStorage.removeItem("mkt-chat:pending-jump")
    pendingJumpRef.current = jump.message_id
    setOpenThread(null)
    if (target.id !== activeChannel?.id) {
      setActiveChannel(target)
      return
    }
    requestAnimationFrame(() => jumpToMessage(jump.message_id!))
  }, [activeChannel?.id, channels])
  const groupedVisibleChannels = useMemo(() => {
    const groups: { label: string; items: Channel[] }[] = []
    const byLabel = new Map<string, Channel[]>()
    for (const channel of visibleChannels) {
      const dash = channel.name.indexOf("-")
      const label = dash > 0 ? channel.name.slice(0, dash).trim() : "Khac"
      const key = label || "Khac"
      if (!byLabel.has(key)) {
        byLabel.set(key, [])
        groups.push({ label: key, items: byLabel.get(key)! })
      }
      byLabel.get(key)!.push(channel)
    }
    return groups
  }, [visibleChannels])

  const groupedByDate = useMemo(() => messages.reduce((acc, m) => {
    if (m.msg_type === "system_notify") return acc
    const d = fmtDate(m.created_at)
    if (!acc[d]) acc[d] = []
    acc[d].push(m)
    return acc
  }, {} as Record<string, Message[]>), [messages])

  const onlineMemberCount = activeChannel
    ? (activeChannel.member_ids || []).filter(e => onlineEmails.includes(e)).length
    : 0

  const totalUnread = channels.reduce((s, c) => s + c.unread_count, 0)

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="relative flex h-[calc(100vh-64px)] bg-ui-bg-base">
      <PageStyles />

      {/* ── Cột 1: Sidebar ── */}
      <aside className="flex w-[260px] shrink-0 flex-col border-r border-ui-border-base bg-ui-bg-subtle">
        <div className="px-3 pb-1 pt-3">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-sm font-extrabold text-ui-fg-base">💬 Chat MKT</span>
            <div className="relative flex items-center gap-1.5">
              {totalUnread > 0 && (
                <span className="rounded-full bg-blue-600 px-1.5 py-px text-[10px] font-bold tabular-nums text-white">{totalUnread > 99 ? "99+" : totalUnread}</span>
              )}
              <button onClick={toggleNotifications} title="Thông báo nhắc đến"
                className={cn("relative grid size-7 place-items-center rounded-lg border text-[13px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40",
                  notificationOpen ? "border-blue-300 bg-blue-500/10 text-blue-600" : "border-ui-border-base text-ui-fg-subtle hover:bg-ui-bg-base-hover")}>🔔
                {notificationUnread > 0 && (
                  <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-rose-600 px-1 text-[9px] font-bold leading-4 text-white shadow-sm">
                    {notificationUnread > 99 ? "99+" : notificationUnread}
                  </span>
                )}
              </button>
              {notificationOpen && (
                <div className="chat-anim-fadeup absolute right-0 top-8 z-[80] w-[320px] overflow-hidden rounded-xl border border-ui-border-base bg-ui-bg-base shadow-2xl">
                  <div className="flex items-center justify-between border-b border-ui-border-base px-3 py-2">
                    <span className="text-xs font-bold text-ui-fg-base">Nhắc đến bạn</span>
                    <span className="flex items-center gap-2">
                      <button onClick={toggleNotificationSound} className={cn("text-[11px] font-medium", notificationSoundEnabled ? "text-emerald-600 hover:text-emerald-700" : "text-ui-fg-muted hover:text-ui-fg-base")}>
                        {notificationSoundEnabled ? "Âm bật" : "Âm tắt"}
                      </button>
                      <button onClick={toggleNotificationRepeatSound} className={cn("text-[11px] font-medium", notificationRepeatSoundEnabled ? "text-amber-600 hover:text-amber-700" : "text-ui-fg-muted hover:text-ui-fg-base")}>{notificationRepeatSoundEnabled ? "Nhắc lại" : "Không nhắc"}</button>
                      <button onClick={markNotificationsRead} className="text-[11px] font-medium text-blue-600 hover:text-blue-700">Đã đọc</button>
                    </span>
                  </div>
                  <div className="max-h-[360px] overflow-y-auto py-1">
                    {notifications.length === 0 ? (
                      <div className="px-3 py-5 text-center text-xs text-ui-fg-muted">Chưa có ai tag bạn</div>
                    ) : notifications.map(n => (
                      <button key={n.id} onClick={() => jumpToNotification(n)}
                        className={cn("flex w-full gap-2 px-3 py-2.5 text-left transition-colors hover:bg-ui-bg-base-hover", !n.read && "bg-blue-500/5")}>
                        <Avatar name={n.sender_name || n.sender} className="size-7 text-[11px]" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-[12px] font-semibold text-ui-fg-base">{n.sender_name || n.sender}</span>
                            <span className="shrink-0 text-[10px] text-ui-fg-muted">{fmtSnippetTime(n.created_at)}</span>
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-ui-fg-muted">#{n.channel_name} · {n.source === "thread" ? "trả lời thread" : "tin nhắn"}</span>
                          <span className="mt-1 block line-clamp-2 text-[12px] leading-snug text-ui-fg-subtle">{n.preview}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          <input
            value={channelSearch}
            onChange={e => setChannelSearch(e.target.value)}
            placeholder="Tìm group..."
            className={cn(INPUT_CLS, "h-8 py-0 text-xs")}
          />
        </div>

        {/* Filter tabs */}
        <div className="mx-3 my-2 grid grid-cols-3 gap-0.5 rounded-lg bg-ui-bg-component p-0.5">
          {([["all", "Tất cả"], ["unread", "Chưa đọc"], ["mentioned", "Nhắc đến"]] as const).map(([v, l]) => (
            <button key={v} onClick={() => setSidebarTab(v)}
              className={cn("h-7 rounded-md text-xs font-semibold transition-all",
                sidebarTab === v ? "bg-ui-bg-base text-ui-fg-base shadow-sm" : "text-ui-fg-muted hover:text-ui-fg-base")}>
              {l}
            </button>
          ))}
        </div>

        {/* Channels */}
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {visibleChannels.length === 0 && (
            <div className="px-2 py-3 text-xs text-ui-fg-muted">
              {sidebarTab === "unread" ? "Không có tin chưa đọc 🎉" : sidebarTab === "mentioned" ? "Chưa có ai nhắc đến bạn 🎉" : channelSearch ? "Không tìm thấy group" : "Chưa có group nào"}
            </div>
          )}
          {groupedVisibleChannels.map(group => (
            <div key={group.label} className="mb-2">
              <div className="px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wide text-ui-fg-muted">{group.label}</div>
              {group.items.map(c => {
                const isActive = activeChannel?.id === c.id
                const anyOnline = (c.member_ids || []).some(e => e !== currentUserId && onlineEmails.includes(e))
                const last = c.last_message
                return (
                  <button key={c.id} onClick={() => { setActiveChannel(c); setShowSearch(false); setOpenThread(null) }}
                    className={cn("group mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40",
                      isActive ? "bg-blue-500/10" : "hover:bg-ui-bg-base-hover")}>
                    <span className={cn("relative grid size-9 shrink-0 place-items-center rounded-lg text-[13px] font-bold uppercase", avatarClass(c.name))}>
                      {c.name.charAt(0)}
                      <span className={cn("absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-ui-bg-subtle", anyOnline ? "bg-emerald-500" : "bg-gray-300 dark:bg-gray-600")} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-1">
                        <span className={cn("truncate text-[13px]", c.unread_count > 0 ? "font-bold text-ui-fg-base" : "font-medium text-ui-fg-base")}>
                          {c.is_private && <span className="mr-1">🔒</span>}{c.name}
                        </span>
                        {last && <span className="shrink-0 text-[10px] tabular-nums text-ui-fg-muted">{fmtSnippetTime(last.created_at)}</span>}
                      </span>
                      <span className="flex items-center justify-between gap-1">
                        <span className={cn("truncate text-[11px]", c.unread_count > 0 ? "font-medium text-ui-fg-subtle" : "text-ui-fg-muted")}>
                          {last
                            ? `${last.author_id === currentUserId ? "Bạn: " : ""}${last.msg_type === "internal_note" ? "Note: " : ""}${last.content}`
                            : c.description || `${c.member_count} thành viên`}
                        </span>
                        {c.unread_count > 0 && (
                          <span className="shrink-0 rounded-full bg-blue-600 px-1.5 py-px text-[10px] font-bold tabular-nums text-white">
                            {c.unread_count > 99 ? "99+" : c.unread_count}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {isManager && (
          <div className="border-t border-ui-border-base p-2">
            <button onClick={() => setShowCreateChannel(true)}
              className="w-full rounded-lg border border-dashed border-ui-border-strong py-2 text-xs font-medium text-ui-fg-muted transition-colors hover:border-blue-300 hover:bg-blue-500/5 hover:text-blue-600">
              + Tạo group
            </button>
          </div>
        )}
      </aside>

      {/* ── Cột 2: Chat area ── */}
      {!activeChannel ? (
        <main className="flex flex-1 flex-col items-center justify-center gap-3 text-ui-fg-muted">
          <div className="text-4xl">💬</div>
          <div className="text-base font-semibold">Chọn một group để bắt đầu</div>
          {isManager && channels.length === 0 && (
            <button onClick={() => setShowCreateChannel(true)}
              className="rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-blue-700 active:scale-95">
              Tạo group đầu tiên
            </button>
          )}
        </main>
      ) : (
        <main className="relative flex min-w-0 flex-1 flex-col">
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b border-ui-border-base px-4 py-2.5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-bold text-ui-fg-base"># {activeChannel.name}</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-ui-fg-muted">
                <span>{activeChannel.member_count} thành viên</span>
                {onlineMemberCount > 0 && (
                  <>
                    <span>·</span>
                    <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                      <span className="size-1.5 rounded-full bg-emerald-500" />{onlineMemberCount} online
                    </span>
                  </>
                )}
                {activeChannel.description && <><span>·</span><span className="truncate">{activeChannel.description}</span></>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button onClick={() => setShowSearch(s => !s)} title="Tìm kiếm"
                className={cn("grid size-8 place-items-center rounded-lg border text-[13px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40",
                  showSearch ? "border-blue-300 bg-blue-500/10 text-blue-600" : "border-ui-border-base text-ui-fg-subtle hover:bg-ui-bg-base-hover")}>🔍</button>
              <button onClick={togglePanel} title={panelOpen ? "Ẩn chi tiết" : "Hiện chi tiết"}
                className={cn("grid size-8 place-items-center rounded-lg border text-[13px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40",
                  panelOpen ? "border-blue-300 bg-blue-500/10 text-blue-600" : "border-ui-border-base text-ui-fg-subtle hover:bg-ui-bg-base-hover")}>ℹ️</button>
            </div>
          </div>

          <PinnedBar channelId={activeChannel.id} onJump={jumpToMessage} />

          {/* Messages */}
          <div ref={messagesBoxRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-3">
            {loading && <div className="py-5 text-center text-[13px] text-ui-fg-muted">Đang tải...</div>}
            {Object.entries(groupedByDate).map(([date, msgs]) => (
              <div key={date}>
                <div className="my-2.5 text-center">
                  <span className="rounded-full bg-ui-bg-component px-2.5 py-0.5 text-[11px] text-ui-fg-muted">{date}</span>
                </div>
                {msgs.map(m => (
                  <div key={m.id} ref={el => { messageRefs.current[m.id] = el }} className="rounded-lg">
                    <MessageBubble
                      msg={m}
                      users={mktUsers}
                      isMine={m.author_id === currentUserId}
                      currentUserEmail={currentUserId}
                      isManager={isManager}
                      isOptimistic={m.id.startsWith("opt-")}
                      onTaskClick={(taskId) => { window.location.href = `/app/mkt-tasks?task=${taskId}` }}
                      onReply={setReplyTo}
                      onReact={handleReact}
                      onPin={handlePin}
                      onOpenThread={setOpenThread}
                    />
                  </div>
                ))}
              </div>
            ))}
            {messages.filter(m => m.msg_type !== "system_notify").length === 0 && !loading && (
              <div className="mt-10 text-center text-[13px] text-ui-fg-muted">
                Chưa có tin nhắn nào.<br />
                <span className="mt-1.5 block text-[11px]">💡 Gõ <b>@tên</b> để tag · <b>@ai [câu hỏi]</b> hỏi AI · <b>/</b> chèn mẫu tin</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* New messages pill */}
          {newMsgCount > 0 && (
            <div className="pointer-events-none absolute bottom-[130px] left-0 right-0 flex justify-center">
              <button onClick={scrollToBottom}
                className="chat-anim-fadeup pointer-events-auto rounded-full bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg transition hover:bg-blue-700 active:scale-95">
                ↓ {newMsgCount} tin mới
              </button>
            </div>
          )}

          {/* Typing indicator */}
          {typingNames.length > 0 && (
            <div className="flex items-center gap-1.5 px-4 pb-1 text-[11px] text-ui-fg-muted">
              <span className="inline-flex gap-0.5">
                <span className="chat-typing-dot size-1 rounded-full bg-ui-fg-muted" />
                <span className="chat-typing-dot size-1 rounded-full bg-ui-fg-muted" style={{ animationDelay: "150ms" }} />
                <span className="chat-typing-dot size-1 rounded-full bg-ui-fg-muted" style={{ animationDelay: "300ms" }} />
              </span>
              {typingNames.slice(0, 2).join(", ")} đang gõ...
            </div>
          )}

          {/* Composer */}
          <div className="relative shrink-0 border-t border-ui-border-base p-3">
            {/* Mention autocomplete */}
            {mentionOpen && mentionSuggestions.length > 0 && (
              <div className="chat-anim-fadeup absolute bottom-full left-3 z-50 mb-1 min-w-[230px] overflow-hidden rounded-xl border border-ui-border-base bg-ui-bg-base shadow-xl">
                {mentionSuggestions.map((u, i) => (
                  <button key={u.email} onClick={() => insertMention(u)}
                    className={cn("flex w-full items-center gap-2 px-3 py-2 text-left transition-colors",
                      i === mentionIndex ? "bg-blue-500/10" : "hover:bg-ui-bg-base-hover")}>
                    <Avatar name={u.name} className="size-6 text-[10px]" />
                    <span>
                      <span className="block text-[13px] font-semibold text-ui-fg-base">{u.name}</span>
                      <span className="block text-[11px] text-ui-fg-muted">{u.email}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Template picker */}
            {templateOpen && (
              <div className="relative">
                <TemplatePicker templates={templates} query={templateQuery} activeIndex={templateIndex}
                  onSelect={insertTemplate} onClose={() => setTemplateOpen(false)} />
              </div>
            )}

            {/* Mode toggle */}
            <div className="mb-1.5 flex items-center gap-1">
              <button onClick={() => setComposerMode("message")}
                className={cn("rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all",
                  composerMode === "message" ? "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300" : "text-ui-fg-muted hover:text-ui-fg-base")}>
                💬 Tin nhắn
              </button>
              <button onClick={() => setComposerMode("note")}
                className={cn("rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all",
                  composerMode === "note" ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" : "text-ui-fg-muted hover:text-ui-fg-base")}>
                🔒 Note nội bộ
              </button>
              {composerMode === "note" && (
                <span className="text-[10px] text-amber-600 dark:text-amber-400">— note đánh dấu trao đổi nội bộ, nền vàng nổi bật</span>
              )}
            </div>

            {/* Reply preview */}
            {replyTo && (
              <div className="chat-anim-fadeup mb-1.5 flex items-center gap-2 rounded-lg bg-ui-bg-component px-2.5 py-1.5 text-xs text-ui-fg-subtle">
                <span className="truncate">↩ Trả lời <b>{replyTo.author_name}</b>: {replyTo.content.slice(0, 60)}</span>
                <button onClick={() => setReplyTo(null)} className="ml-auto shrink-0 text-sm text-ui-fg-muted transition-colors hover:text-ui-fg-base">✕</button>
              </div>
            )}

            {/* Input khung — toolbar bên trong (chuẩn Slack) */}
            <div className={cn("rounded-xl border transition-all focus-within:ring-2",
              composerMode === "note"
                ? "border-amber-300 bg-amber-50/50 focus-within:ring-amber-500/20 dark:border-amber-500/40 dark:bg-amber-500/5"
                : "border-ui-border-base bg-ui-bg-field focus-within:border-blue-400 focus-within:ring-blue-500/20")}>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => handleInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={2}
                placeholder={composerMode === "note"
                  ? "Note nội bộ — chỉ thành viên channel thấy..."
                  : "Nhắn tin... · @tên để tag · @ai hỏi AI · / chèn mẫu"}
                className="max-h-36 w-full resize-none bg-transparent px-3.5 pt-2.5 text-[13px] leading-relaxed text-ui-fg-base outline-none placeholder:text-ui-fg-muted"
              />
              <div className="flex items-center gap-0.5 px-2 pb-1.5">
                <input ref={fileInputRef} type="file" accept="image/*,.pdf,video/mp4" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = "" }} />
                <button onClick={() => fileInputRef.current?.click()} disabled={uploadingFile} title="Gửi ảnh/file"
                  className="grid size-7 place-items-center rounded-lg text-sm text-ui-fg-subtle transition-colors hover:bg-ui-bg-base-hover disabled:opacity-50">
                  {uploadingFile ? "⏳" : "📎"}
                </button>
                <div className="relative">
                  <button onClick={() => setShowEmojiPicker(o => !o)} title="Emoji"
                    className="grid size-7 place-items-center rounded-lg text-sm text-ui-fg-subtle transition-colors hover:bg-ui-bg-base-hover">😊</button>
                  {showEmojiPicker && (
                    <div className="chat-anim-fadeup absolute bottom-9 left-0 z-50 flex gap-1 rounded-xl border border-ui-border-base bg-ui-bg-base p-1.5 shadow-xl">
                      {QUICK_EMOJIS.map(e => (
                        <button key={e} onClick={() => { setInput(i => i + e); setShowEmojiPicker(false); textareaRef.current?.focus() }}
                          className="grid size-8 place-items-center rounded-lg text-lg transition-transform hover:scale-125 hover:bg-ui-bg-base-hover">{e}</button>
                      ))}
                    </div>
                  )}
                </div>
                <button onClick={() => { setShowTemplatesModal(true) }} title="Mẫu tin nhắn (/)"
                  className="grid size-7 place-items-center rounded-lg text-sm text-ui-fg-subtle transition-colors hover:bg-ui-bg-base-hover">⚡</button>
                {isManager && (
                  <button onClick={() => setShowCreateTask(true)} title="Tạo task"
                    className="grid size-7 place-items-center rounded-lg text-sm text-ui-fg-subtle transition-colors hover:bg-ui-bg-base-hover">📋</button>
                )}
                <div className="flex-1" />
                <button onClick={sendMessage} disabled={sending || !input.trim()}
                  className={cn("grid size-8 place-items-center rounded-lg text-sm font-bold transition-all outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40",
                    input.trim() && !sending
                      ? composerMode === "note" ? "bg-amber-500 text-white hover:bg-amber-600 active:scale-90" : "bg-blue-600 text-white hover:bg-blue-700 active:scale-90"
                      : "bg-ui-bg-component text-ui-fg-disabled")}>
                  ➤
                </button>
              </div>
            </div>
          </div>

          {showSearch && <SearchPanel currentChannelId={activeChannel.id} channels={channels} users={mktUsers} onClose={() => setShowSearch(false)} onJump={jumpToSearchResult} />}
        </main>
      )}

      {/* ── Cột 3: Context Panel ── */}
      {activeChannel && openThread ? (
        <ThreadPanel
          channelId={activeChannel.id}
          root={openThread}
          users={mktUsers}
          refreshKey={threadRefreshKey}
          onClose={() => setOpenThread(null)}
        />
      ) : activeChannel && panelOpen && (
        <ContextPanel
          channel={activeChannel}
          mktUsers={mktUsers}
          onlineEmails={onlineEmails}
          isManager={isManager}
          onManageMembers={() => setShowManageMembers(true)}
          onCreateTask={() => setShowCreateTask(true)}
          onClose={togglePanel}
        />
      )}

      {/* ── Modals ── */}
      {showCreateChannel && <CreateChannelModal onClose={() => setShowCreateChannel(false)} onCreated={loadChannels} users={mktUsers} />}
      {showCreateTask && activeChannel && (
        <CreateTaskModal channelId={activeChannel.id} users={mktUsers}
          onClose={() => setShowCreateTask(false)}
          onCreated={() => apiFetch(`/admin/mkt-chat/channels/${activeChannel.id}/messages`).then(r => r.json()).then(d => setMessages(d.messages || []))}
        />
      )}
      {showManageMembers && activeChannel && (
        <ManageMembersModal channel={activeChannel} users={mktUsers}
          onClose={() => setShowManageMembers(false)} onSaved={loadChannels}
        />
      )}
      {showTemplatesModal && (
        <TemplatesModal templates={templates} isManager={isManager}
          onClose={() => setShowTemplatesModal(false)} onChanged={loadTemplates} />
      )}
    </div>
  )
}

export const config = defineRouteConfig({ label: "Chat MKT", rank: 6 })
