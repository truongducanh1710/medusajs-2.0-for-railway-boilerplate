import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useState, useEffect, useRef, useCallback } from "react"
import { apiFetch } from "../../lib/api-client"
import { useCurrentPermissions } from "../../lib/use-permissions"

// ─── Types ───────────────────────────────────────────────────────────────────

type Channel = {
  id: string; name: string; description: string | null
  member_count: number; member_ids?: string[]
  unread_count: number; created_at: string
}
type ReplySnippet = { id: string; content: string; author_name: string }
type Message = {
  id: string; channel_id: string; author_id: string; author_name: string
  content: string; task_id: string | null; msg_type: string; metadata: any
  reply_to_id: string | null; reply_to: ReplySnippet | null
  file_url: string | null; file_type: string | null; file_name: string | null
  file_expires_at: string | null
  reactions: Record<string, string[]>; is_pinned: boolean; mentions: string[]
  created_at: string
}
type MktUser = { email: string; name: string }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtTime(d: string) {
  const dt = new Date(d)
  return `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`
}
function fmtDate(d: string) {
  const dt = new Date(d)
  if (dt.toDateString() === new Date().toDateString()) return "Hôm nay"
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}`
}

const QUICK_EMOJIS = ["👍", "❤️", "😂", "🎉", "✅", "🔥"]

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg, isMine, currentUserEmail, isManager, onTaskClick, onReply, onReact, onPin }: {
  msg: Message; isMine: boolean; currentUserEmail: string; isManager: boolean
  onTaskClick?: (taskId: string) => void
  onReply: (msg: Message) => void
  onReact: (msgId: string, emoji: string) => void
  onPin: (msgId: string) => void
}) {
  const [showActions, setShowActions] = useState(false)
  const isSystem = !["text", "ai_response", "image", "file"].includes(msg.msg_type)
  const isAI = msg.msg_type === "ai_response"
  const isImage = msg.msg_type === "image"
  const isFile = msg.msg_type === "file"

  if (isSystem) {
    return (
      <div style={{ textAlign: "center", margin: "4px 0" }}>
        <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 10, background: msg.is_pinned ? "#FEF3C7" : "#F3F4F6", fontSize: 12, color: "#6B7280" }}>
          {msg.is_pinned && "📌 "}
          {msg.content}
          {msg.task_id && onTaskClick && (
            <button onClick={() => onTaskClick(msg.task_id!)}
              style={{ marginLeft: 6, fontSize: 11, color: "#3B82F6", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
              Xem →
            </button>
          )}
        </span>
      </div>
    )
  }

  if (isAI) {
    return (
      <div style={{ margin: "6px 0 10px 0", display: "flex", gap: 8 }}>
        <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#8B5CF6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#fff", flexShrink: 0 }}>🤖</div>
        <div>
          <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 3 }}>AI · {fmtTime(msg.created_at)}</div>
          <div style={{ background: "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: "0 10px 10px 10px", padding: "8px 12px", fontSize: 13, color: "#374151", maxWidth: 340, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
            {msg.content}
          </div>
          <ReactionBar reactions={msg.reactions} msgId={msg.id} currentEmail={currentUserEmail} onReact={onReact} />
        </div>
      </div>
    )
  }

  const bubbleBg = isMine ? "#3B82F6" : "#F3F4F6"
  const bubbleColor = isMine ? "#fff" : "#111827"
  const borderRadius = isMine ? "10px 0 10px 10px" : "0 10px 10px 10px"

  return (
    <div
      style={{ margin: "2px 0", display: "flex", flexDirection: isMine ? "row-reverse" : "row", gap: 8 }}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {!isMine && (
        <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#E5E7EB", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#6B7280", flexShrink: 0, fontWeight: 700, marginTop: 16 }}>
          {(msg.author_name || "?").charAt(0).toUpperCase()}
        </div>
      )}

      <div style={{ maxWidth: 360 }}>
        {!isMine && <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 2 }}>{msg.author_name}</div>}

        {/* Reply preview */}
        {msg.reply_to && (
          <div style={{ background: isMine ? "rgba(255,255,255,0.2)" : "#E9ECEF", borderLeft: "3px solid #9CA3AF", padding: "3px 8px", borderRadius: "4px 4px 0 0", fontSize: 11, color: isMine ? "rgba(255,255,255,0.8)" : "#6B7280", maxWidth: "100%" }}>
            <span style={{ fontWeight: 600 }}>{msg.reply_to.author_name}</span>: {msg.reply_to.content}
          </div>
        )}

        {/* Content */}
        <div style={{ background: bubbleBg, color: bubbleColor, borderRadius, padding: "8px 12px", fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", position: "relative" }}>
          {msg.is_pinned && <span style={{ fontSize: 10, marginRight: 4 }}>📌</span>}
          {isImage && msg.file_url ? (
            <a href={msg.file_url} target="_blank" rel="noreferrer">
              <img src={msg.file_url} alt={msg.file_name || "ảnh"} style={{ maxWidth: 240, maxHeight: 200, borderRadius: 6, display: "block" }} />
            </a>
          ) : isFile && msg.file_url ? (
            <a href={msg.file_url} target="_blank" rel="noreferrer" style={{ color: isMine ? "#fff" : "#3B82F6", display: "flex", alignItems: "center", gap: 6, textDecoration: "none" }}>
              <span>📎</span>
              <span style={{ textDecoration: "underline" }}>{msg.file_name || "File"}</span>
            </a>
          ) : (
            <span dangerouslySetInnerHTML={{ __html: renderMentions(msg.content) }} />
          )}
        </div>

        <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 2, textAlign: isMine ? "right" : "left" }}>{fmtTime(msg.created_at)}</div>

        <ReactionBar reactions={msg.reactions} msgId={msg.id} currentEmail={currentUserEmail} onReact={onReact} />
      </div>

      {/* Hover actions */}
      {showActions && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, alignSelf: "flex-start", marginTop: 14, opacity: showActions ? 1 : 0, transition: "opacity 0.1s" }}>
          {QUICK_EMOJIS.slice(0, 3).map(e => (
            <button key={e} onClick={() => onReact(msg.id, e)}
              style={{ padding: "2px 4px", fontSize: 13, background: "#fff", border: "1px solid #E5E7EB", borderRadius: 6, cursor: "pointer", lineHeight: 1 }}>{e}</button>
          ))}
          <button onClick={() => onReply(msg)}
            title="Trả lời"
            style={{ padding: "2px 6px", fontSize: 11, background: "#fff", border: "1px solid #E5E7EB", borderRadius: 6, cursor: "pointer", color: "#6B7280" }}>↩</button>
          {isManager && (
            <button onClick={() => onPin(msg.id)}
              title={msg.is_pinned ? "Bỏ ghim" : "Ghim"}
              style={{ padding: "2px 6px", fontSize: 11, background: "#fff", border: "1px solid #E5E7EB", borderRadius: 6, cursor: "pointer", color: "#6B7280" }}>
              {msg.is_pinned ? "📌" : "📍"}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function renderMentions(text: string): string {
  return text.replace(/@[\w.@-]+/g, match => `<span style="color:#3B82F6;font-weight:600">${match}</span>`)
}

function ReactionBar({ reactions, msgId, currentEmail, onReact }: {
  reactions: Record<string, string[]>; msgId: string; currentEmail: string
  onReact: (msgId: string, emoji: string) => void
}) {
  const entries = Object.entries(reactions || {}).filter(([, users]) => users.length > 0)
  if (entries.length === 0) return null
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 3 }}>
      {entries.map(([emoji, users]) => (
        <button key={emoji} onClick={() => onReact(msgId, emoji)}
          style={{
            padding: "1px 6px", fontSize: 12, borderRadius: 10, cursor: "pointer", lineHeight: 1.5,
            background: users.includes(currentEmail) ? "#DBEAFE" : "#F3F4F6",
            border: `1px solid ${users.includes(currentEmail) ? "#93C5FD" : "#E5E7EB"}`,
            color: "#374151",
          }}>
          {emoji} {users.length}
        </button>
      ))}
    </div>
  )
}

// ─── Modals ───────────────────────────────────────────────────────────────────

function CreateChannelModal({ onClose, onCreated, users }: { onClose: () => void; onCreated: () => void; users: MktUser[] }) {
  const [name, setName] = useState(""); const [desc, setDesc] = useState(""); const [memberEmails, setMemberEmails] = useState<string[]>([]); const [saving, setSaving] = useState(false)
  const toggle = (email: string) => setMemberEmails(m => m.includes(email) ? m.filter(e => e !== email) : [...m, email])
  const submit = async () => {
    if (!name.trim()) return
    setSaving(true)
    await apiFetch("/admin/mkt-chat/channels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, description: desc, member_ids: memberEmails }) })
    setSaving(false); onCreated(); onClose()
  }
  const inp: React.CSSProperties = { width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }
  const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#6B7280", display: "block", marginBottom: 4 }
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: 420, maxWidth: "95vw" }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Tạo group chat mới</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div><label style={lbl}>Tên group *</label><input style={inp} value={name} onChange={e => setName(e.target.value)} placeholder="VD: Team MKT T6..." /></div>
          <div><label style={lbl}>Mô tả</label><input style={inp} value={desc} onChange={e => setDesc(e.target.value)} placeholder="Mục đích của group..." /></div>
          <div>
            <label style={lbl}>Thêm thành viên</label>
            <div style={{ border: "1px solid #E5E7EB", borderRadius: 6, overflow: "hidden", maxHeight: 200, overflowY: "auto" }}>
              {users.map(u => (
                <div key={u.email} onClick={() => toggle(u.email)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid #F3F4F6", background: memberEmails.includes(u.email) ? "#EFF6FF" : "#fff" }}>
                  <div style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${memberEmails.includes(u.email) ? "#3B82F6" : "#D1D5DB"}`, background: memberEmails.includes(u.email) ? "#3B82F6" : "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {memberEmails.includes(u.email) && <span style={{ color: "#fff", fontSize: 10 }}>✓</span>}
                  </div>
                  <span style={{ fontSize: 13 }}>{u.name}</span>
                </div>
              ))}
              {users.length === 0 && <div style={{ padding: 12, fontSize: 12, color: "#9CA3AF" }}>Không có thành viên</div>}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button onClick={onClose} style={{ padding: "8px 16px", border: "1px solid #E5E7EB", borderRadius: 6, background: "#fff", fontSize: 13, cursor: "pointer" }}>Hủy</button>
          <button onClick={submit} disabled={saving || !name.trim()} style={{ padding: "8px 16px", border: "none", borderRadius: 6, background: "#3B82F6", color: "#fff", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>
            {saving ? "Đang tạo..." : "Tạo group"}
          </button>
        </div>
      </div>
    </div>
  )
}

function ManageMembersModal({ channel, users, onClose, onSaved }: { channel: Channel; users: MktUser[]; onClose: () => void; onSaved: () => void }) {
  const initial = new Set(channel.member_ids || [])
  const [selected, setSelected] = useState<Set<string>>(new Set(initial))
  const [saving, setSaving] = useState(false)
  const toggle = (email: string) => setSelected(s => { const n = new Set(s); n.has(email) ? n.delete(email) : n.add(email); return n })
  const submit = async () => {
    setSaving(true)
    const add = [...selected].filter(e => !initial.has(e))
    const remove = [...initial].filter(e => !selected.has(e))
    await apiFetch(`/admin/mkt-chat/channels/${channel.id}/members`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ add, remove }) })
    setSaving(false); onSaved(); onClose()
  }
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: 420, maxWidth: "95vw" }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Thành viên #{channel.name}</div>
        <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 16 }}>Tích để thêm / bỏ thành viên</div>
        <div style={{ border: "1px solid #E5E7EB", borderRadius: 6, overflow: "hidden", maxHeight: 300, overflowY: "auto" }}>
          {users.map(u => (
            <div key={u.email} onClick={() => toggle(u.email)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid #F3F4F6", background: selected.has(u.email) ? "#EFF6FF" : "#fff" }}>
              <div style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${selected.has(u.email) ? "#3B82F6" : "#D1D5DB"}`, background: selected.has(u.email) ? "#3B82F6" : "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {selected.has(u.email) && <span style={{ color: "#fff", fontSize: 10 }}>✓</span>}
              </div>
              <span style={{ fontSize: 13 }}>{u.name}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button onClick={onClose} style={{ padding: "8px 16px", border: "1px solid #E5E7EB", borderRadius: 6, background: "#fff", fontSize: 13, cursor: "pointer" }}>Hủy</button>
          <button onClick={submit} disabled={saving} style={{ padding: "8px 16px", border: "none", borderRadius: 6, background: "#3B82F6", color: "#fff", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>
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
    await apiFetch(`/admin/mkt-chat/channels/${channelId}/create-task`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) })
    setSaving(false); onCreated(); onClose()
  }
  const inp: React.CSSProperties = { width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "6px 10px", fontSize: 13, boxSizing: "border-box" }
  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: "#6B7280", display: "block", marginBottom: 3 }
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 20, width: 380, maxWidth: "95vw" }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>📋 Tạo task từ chat</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div><label style={lbl}>Tiêu đề *</label><input style={inp} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Tiêu đề task..." /></div>
          <div><label style={lbl}>Loại</label>
            <select style={inp} value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
              <option value="ads_camp">Chạy Ads / Camp</option>
              <option value="content_post">Nội dung / Bài FB</option>
            </select>
          </div>
          <div><label style={lbl}>Giao cho *</label>
            <select style={inp} value={form.assignee_id} onChange={e => setForm(f => ({ ...f, assignee_id: e.target.value }))}>
              <option value="">-- Chọn --</option>
              {users.map(u => <option key={u.email} value={u.email}>{u.name}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Deadline</label><input type="date" style={inp} value={form.deadline} onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} /></div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <button onClick={onClose} style={{ padding: "6px 14px", border: "1px solid #E5E7EB", borderRadius: 6, background: "#fff", fontSize: 12, cursor: "pointer" }}>Hủy</button>
          <button onClick={submit} disabled={saving} style={{ padding: "6px 14px", border: "none", borderRadius: 6, background: "#3B82F6", color: "#fff", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
            {saving ? "Đang tạo..." : "Tạo task"}
          </button>
        </div>
      </div>
    </div>
  )
}

function PinnedBar({ channelId, onJump }: { channelId: string; onJump: (msgId: string) => void }) {
  const [pinned, setPinned] = useState<Message[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    apiFetch(`/admin/mkt-chat/channels/${channelId}/pinned`)
      .then(r => r.json()).then(d => setPinned(d.pinned || []))
  }, [channelId])

  if (pinned.length === 0) return null
  return (
    <div style={{ borderBottom: "1px solid #FEF3C7", background: "#FFFBEB", padding: "6px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, color: "#92400E", fontWeight: 600 }}>📌 {pinned.length} tin nhắn được ghim</span>
        <button onClick={() => setOpen(o => !o)} style={{ fontSize: 11, color: "#92400E", background: "none", border: "none", cursor: "pointer" }}>
          {open ? "Thu gọn ▲" : "Xem ▼"}
        </button>
      </div>
      {open && (
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
          {pinned.map(m => (
            <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: "#78350F", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <b>{m.author_name}:</b> {m.content.slice(0, 60)}
              </span>
              <button onClick={() => { setOpen(false); onJump(m.id) }} style={{ fontSize: 11, color: "#3B82F6", background: "none", border: "none", cursor: "pointer", whiteSpace: "nowrap" }}>Đến →</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SearchPanel({ channelId, currentEmail, onClose }: { channelId: string; currentEmail: string; onClose: () => void }) {
  const [q, setQ] = useState("")
  const [results, setResults] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!q.trim()) { setResults([]); return }
    const t = setTimeout(() => {
      setLoading(true)
      apiFetch(`/admin/mkt-chat/channels/${channelId}/search?q=${encodeURIComponent(q)}`)
        .then(r => r.json()).then(d => setResults(d.messages || [])).finally(() => setLoading(false))
    }, 400)
    return () => clearTimeout(t)
  }, [q, channelId])

  return (
    <div style={{ position: "absolute", top: 0, right: 0, width: 340, height: "100%", background: "#fff", borderLeft: "1px solid #E5E7EB", display: "flex", flexDirection: "column", zIndex: 10 }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #E5E7EB", display: "flex", gap: 8, alignItems: "center" }}>
        <input
          autoFocus value={q} onChange={e => setQ(e.target.value)}
          placeholder="Tìm trong channel..."
          style={{ flex: 1, border: "1px solid #E5E7EB", borderRadius: 6, padding: "6px 10px", fontSize: 13 }}
        />
        <button onClick={onClose} style={{ fontSize: 16, background: "none", border: "none", cursor: "pointer", color: "#9CA3AF" }}>✕</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
        {loading && <div style={{ fontSize: 12, color: "#9CA3AF", textAlign: "center", padding: 16 }}>Đang tìm...</div>}
        {!loading && results.length === 0 && q.trim() && <div style={{ fontSize: 12, color: "#9CA3AF", textAlign: "center", padding: 16 }}>Không tìm thấy</div>}
        {results.map(m => (
          <div key={m.id} style={{ padding: "8px 10px", borderRadius: 8, marginBottom: 4, background: "#F9FAFB", border: "1px solid #F3F4F6" }}>
            <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 3 }}>{m.author_name} · {fmtDate(m.created_at)} {fmtTime(m.created_at)}</div>
            <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.4, whiteSpace: "pre-wrap" }}
              dangerouslySetInnerHTML={{ __html: m.content.replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), s => `<mark style="background:#FEF3C7">${s}</mark>`) }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MktChatPage() {
  const { has, isSuper, email: myEmail } = useCurrentPermissions()
  const isManager = isSuper || has("page.mkt-chat.manage")

  const [channels, setChannels] = useState<Channel[]>([])
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(false)
  const [mktUsers, setMktUsers] = useState<MktUser[]>([])
  const [currentUserId, setCurrentUserId] = useState("")

  const [showCreateChannel, setShowCreateChannel] = useState(false)
  const [showCreateTask, setShowCreateTask] = useState(false)
  const [showManageMembers, setShowManageMembers] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [uploadingFile, setUploadingFile] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Mention autocomplete
  const [mentionQuery, setMentionQuery] = useState("")
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionIndex, setMentionIndex] = useState(0)
  const mentionSuggestions = mktUsers.filter(u =>
    u.name.toLowerCase().includes(mentionQuery.toLowerCase()) || u.email.toLowerCase().includes(mentionQuery.toLowerCase())
  ).slice(0, 5)

  const loadChannels = useCallback(() => {
    apiFetch("/admin/mkt-chat/channels").then(r => r.json()).then(d => {
      const list: Channel[] = d.channels || []
      setChannels(list)
      setActiveChannel(prev => prev ? (list.find(c => c.id === prev.id) || prev) : prev)
    })
  }, [])

  useEffect(() => {
    loadChannels()
    apiFetch("/admin/permissions/mkt-users").then(r => r.json()).then(d => setMktUsers(d.users || []))
    apiFetch("/admin/permissions/me").then(r => r.json()).then(d => setCurrentUserId(d.email || ""))
  }, [loadChannels])

  // Load messages khi đổi channel
  useEffect(() => {
    if (!activeChannel) return
    setLoading(true)
    apiFetch(`/admin/mkt-chat/channels/${activeChannel.id}/messages`)
      .then(r => r.json()).then(d => setMessages(d.messages || [])).finally(() => setLoading(false))
    // Mark as read
    apiFetch(`/admin/mkt-chat/channels/${activeChannel.id}/last-read`, { method: "PATCH" }).catch(() => {})
  }, [activeChannel?.id])

  // Polling
  useEffect(() => {
    if (!activeChannel) return
    const channelId = activeChannel.id
    const poll = setInterval(() => {
      apiFetch(`/admin/mkt-chat/channels/${channelId}/messages?limit=30`)
        .then(r => r.json()).then(d => {
          const newMsgs: Message[] = d.messages || []
          setMessages(prev => {
            const real = prev.filter(m => !m.id.startsWith("opt-"))
            const realIds = new Set(real.map(m => m.id))
            const fresh = newMsgs.filter(m => !realIds.has(m.id))
            if (fresh.length === 0 && real.length === prev.length) return prev
            // Mark read after receiving new msgs
            apiFetch(`/admin/mkt-chat/channels/${channelId}/last-read`, { method: "PATCH" }).catch(() => {})
            return [...real, ...fresh]
          })
        }).catch(() => {})
      // Refresh unread counts on sidebar
      loadChannels()
    }, 4000)
    return () => clearInterval(poll)
  }, [activeChannel?.id, loadChannels])

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const sendMessage = async () => {
    if (!input.trim() || !activeChannel || sending) return
    const text = input.trim()
    setInput("")
    setReplyTo(null)
    setMentionOpen(false)
    setSending(true)
    const optimistic: Message = {
      id: `opt-${Date.now()}`, channel_id: activeChannel.id, author_id: currentUserId,
      author_name: "Bạn", content: text, task_id: null, msg_type: "text", metadata: null,
      reply_to_id: replyTo?.id || null, reply_to: replyTo ? { id: replyTo.id, content: replyTo.content.slice(0, 80), author_name: replyTo.author_name } : null,
      file_url: null, file_type: null, file_name: null, file_expires_at: null,
      reactions: {}, is_pinned: false, mentions: [],
      created_at: new Date().toISOString(),
    }
    setMessages(m => [...m, optimistic])
    await apiFetch(`/admin/mkt-chat/channels/${activeChannel.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text, reply_to_id: replyTo?.id || null }),
    })
    setSending(false)
  }

  const handleInputChange = (val: string) => {
    setInput(val)
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
    const newInput = input.slice(0, atIdx) + `@${user.name} `
    setInput(newInput); setMentionOpen(false)
    textareaRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
    const el = messageRefs.current[msgId]
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" })
      el.style.background = "#FEF9C3"
      setTimeout(() => { if (el) el.style.background = "" }, 1500)
    }
  }

  const groupedByDate = messages.reduce((acc, m) => {
    if (m.msg_type === "system_notify") return acc // ẩn notify nội bộ
    const d = fmtDate(m.created_at)
    if (!acc[d]) acc[d] = []
    acc[d].push(m)
    return acc
  }, {} as Record<string, Message[]>)

  return (
    <div style={{ display: "flex", height: "calc(100vh - 64px)", background: "#fff", position: "relative" }}>
      {/* Sidebar */}
      <div style={{ width: 240, flexShrink: 0, borderRight: "1px solid #E5E7EB", display: "flex", flexDirection: "column", background: "#F9FAFB" }}>
        <div style={{ padding: "14px 16px 8px", borderBottom: "1px solid #E5E7EB" }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#111827" }}>💬 Chat MKT</div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
          {channels.length === 0 && <div style={{ padding: "12px 8px", fontSize: 12, color: "#9CA3AF" }}>Chưa có group nào</div>}
          {channels.map(c => (
            <div key={c.id} onClick={() => { setActiveChannel(c); setShowSearch(false) }}
              style={{ padding: "10px 12px", borderRadius: 8, cursor: "pointer", marginBottom: 2, background: activeChannel?.id === c.id ? "#EFF6FF" : "transparent", border: activeChannel?.id === c.id ? "1px solid #BFDBFE" : "1px solid transparent", position: "relative" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#111827", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span># {c.name}</span>
                {c.unread_count > 0 && (
                  <span style={{ background: "#EF4444", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 10, padding: "1px 6px", minWidth: 18, textAlign: "center" }}>
                    {c.unread_count > 99 ? "99+" : c.unread_count}
                  </span>
                )}
              </div>
              {c.description && <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 2 }}>{c.description}</div>}
              <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 2 }}>{c.member_count} thành viên</div>
            </div>
          ))}
        </div>
        {isManager && (
          <div style={{ padding: 8, borderTop: "1px solid #E5E7EB" }}>
            <button onClick={() => setShowCreateChannel(true)}
              style={{ width: "100%", padding: "8px 0", border: "1px dashed #D1D5DB", borderRadius: 8, background: "transparent", fontSize: 12, color: "#6B7280", cursor: "pointer" }}>
              + Tạo group
            </button>
          </div>
        )}
      </div>

      {/* Chat area */}
      {!activeChannel ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12, color: "#9CA3AF" }}>
          <div style={{ fontSize: 40 }}>💬</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Chọn một group để bắt đầu</div>
          {isManager && channels.length === 0 && (
            <button onClick={() => setShowCreateChannel(true)} style={{ padding: "8px 16px", border: "none", borderRadius: 6, background: "#3B82F6", color: "#fff", fontSize: 13, cursor: "pointer" }}>
              Tạo group đầu tiên
            </button>
          )}
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, position: "relative" }}>
          {/* Header */}
          <div style={{ padding: "10px 16px", borderBottom: "1px solid #E5E7EB", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
            <div>
              <span style={{ fontSize: 14, fontWeight: 700 }}># {activeChannel.name}</span>
              {activeChannel.description && <span style={{ fontSize: 12, color: "#9CA3AF", marginLeft: 8 }}>{activeChannel.description}</span>}
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button onClick={() => setShowSearch(s => !s)}
                title="Tìm kiếm"
                style={{ padding: "4px 10px", border: "1px solid #E5E7EB", borderRadius: 6, background: showSearch ? "#EFF6FF" : "#fff", fontSize: 12, cursor: "pointer", color: "#374151" }}>🔍</button>
              {isManager ? (
                <button onClick={() => setShowManageMembers(true)}
                  style={{ fontSize: 12, color: "#3B82F6", background: "none", border: "none", cursor: "pointer" }}>
                  {activeChannel.member_count} thành viên · Quản lý
                </button>
              ) : (
                <span style={{ fontSize: 12, color: "#9CA3AF" }}>{activeChannel.member_count} thành viên</span>
              )}
            </div>
          </div>

          {/* Pinned bar */}
          <PinnedBar channelId={activeChannel.id} onJump={jumpToMessage} />

          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
            {loading && <div style={{ textAlign: "center", color: "#9CA3AF", fontSize: 13, padding: 20 }}>Đang tải...</div>}
            {Object.entries(groupedByDate).map(([date, msgs]) => (
              <div key={date}>
                <div style={{ textAlign: "center", margin: "10px 0 6px" }}>
                  <span style={{ background: "#F3F4F6", padding: "2px 10px", borderRadius: 10, fontSize: 11, color: "#9CA3AF" }}>{date}</span>
                </div>
                {msgs.map(m => (
                  <div key={m.id} ref={el => { messageRefs.current[m.id] = el }} style={{ transition: "background 0.3s" }}>
                    <MessageBubble
                      msg={m}
                      isMine={m.author_id === currentUserId}
                      currentUserEmail={currentUserId}
                      isManager={isManager}
                      onTaskClick={() => { window.location.href = "/app/mkt-tasks" }}
                      onReply={setReplyTo}
                      onReact={handleReact}
                      onPin={handlePin}
                    />
                  </div>
                ))}
              </div>
            ))}
            {messages.filter(m => m.msg_type !== "system_notify").length === 0 && !loading && (
              <div style={{ textAlign: "center", color: "#9CA3AF", fontSize: 13, marginTop: 40 }}>
                Chưa có tin nhắn nào.<br />
                <span style={{ fontSize: 11, display: "block", marginTop: 6 }}>💡 Gõ <b>@tên</b> để tag đồng đội · <b>@ai [câu hỏi]</b> để hỏi AI</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div style={{ padding: "10px 16px", borderTop: "1px solid #E5E7EB", flexShrink: 0 }}>
            {/* Reply preview */}
            {replyTo && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#F3F4F6", borderRadius: 6, padding: "4px 10px", marginBottom: 6, fontSize: 12, color: "#6B7280" }}>
                <span>↩ Trả lời <b>{replyTo.author_name}</b>: {replyTo.content.slice(0, 50)}</span>
                <button onClick={() => setReplyTo(null)} style={{ marginLeft: "auto", fontSize: 14, background: "none", border: "none", cursor: "pointer", color: "#9CA3AF" }}>✕</button>
              </div>
            )}

            {/* Mention autocomplete */}
            {mentionOpen && mentionSuggestions.length > 0 && (
              <div style={{ position: "absolute", bottom: 90, left: 16, background: "#fff", border: "1px solid #E5E7EB", borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.1)", zIndex: 50, minWidth: 220 }}>
                {mentionSuggestions.map((u, i) => (
                  <div key={u.email} onClick={() => insertMention(u)}
                    style={{ padding: "8px 12px", cursor: "pointer", background: i === mentionIndex ? "#EFF6FF" : "#fff", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#E5E7EB", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#6B7280" }}>
                      {u.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600 }}>{u.name}</div>
                      <div style={{ fontSize: 11, color: "#9CA3AF" }}>{u.email}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              {/* File upload */}
              <input ref={fileInputRef} type="file" accept="image/*,.pdf,video/mp4" style={{ display: "none" }}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = "" }} />
              <button onClick={() => fileInputRef.current?.click()} disabled={uploadingFile}
                title="Gửi ảnh/file"
                style={{ padding: "8px 10px", border: "1px solid #E5E7EB", borderRadius: 8, background: "#fff", fontSize: 16, cursor: "pointer", flexShrink: 0 }}>
                {uploadingFile ? "⏳" : "📎"}
              </button>

              {/* Emoji quick pick */}
              <div style={{ position: "relative", flexShrink: 0 }}>
                <button onClick={() => setShowEmojiPicker(o => !o)}
                  style={{ padding: "8px 10px", border: "1px solid #E5E7EB", borderRadius: 8, background: "#fff", fontSize: 16, cursor: "pointer" }}>😊</button>
                {showEmojiPicker && (
                  <div style={{ position: "absolute", bottom: 42, left: 0, background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, padding: 8, display: "flex", gap: 6, boxShadow: "0 4px 12px rgba(0,0,0,0.1)", zIndex: 50 }}>
                    {QUICK_EMOJIS.map(e => (
                      <button key={e} onClick={() => { setInput(i => i + e); setShowEmojiPicker(false); textareaRef.current?.focus() }}
                        style={{ fontSize: 20, background: "none", border: "none", cursor: "pointer", padding: 4, borderRadius: 6 }}>{e}</button>
                    ))}
                  </div>
                )}
              </div>

              {isManager && (
                <button onClick={() => setShowCreateTask(true)} title="Tạo task"
                  style={{ padding: "8px 10px", border: "1px solid #E5E7EB", borderRadius: 8, background: "#fff", fontSize: 16, cursor: "pointer", flexShrink: 0 }}>📋</button>
              )}

              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => handleInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={2}
                placeholder={`Gửi tin nhắn... (Shift+Enter xuống dòng)\n@tên để tag · @ai để hỏi AI`}
                style={{ flex: 1, border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 12px", fontSize: 13, resize: "none", lineHeight: 1.5 }}
              />
              <button onClick={sendMessage} disabled={sending || !input.trim()}
                style={{ padding: "8px 16px", border: "none", borderRadius: 8, background: "#3B82F6", color: "#fff", fontSize: 13, cursor: "pointer", fontWeight: 600, flexShrink: 0 }}>
                Gửi
              </button>
            </div>
          </div>

          {/* Search panel */}
          {showSearch && <SearchPanel channelId={activeChannel.id} currentEmail={currentUserId} onClose={() => setShowSearch(false)} />}
        </div>
      )}

      {/* Modals */}
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
    </div>
  )
}

export const config = defineRouteConfig({ label: "Chat MKT" })
