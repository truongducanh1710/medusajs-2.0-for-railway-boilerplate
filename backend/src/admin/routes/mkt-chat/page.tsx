import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useState, useEffect, useRef, useCallback } from "react"
import { apiFetch } from "../../lib/api-client"
import { useCurrentPermissions } from "../../lib/use-permissions"

// ─── Types ───────────────────────────────────────────────────────────────────

type Channel = { id: string; name: string; description: string | null; member_count: number }
type Message = {
  id: string
  channel_id: string
  author_id: string
  author_name: string
  content: string
  task_id: string | null
  msg_type: string
  metadata: any
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
  const today = new Date()
  if (dt.toDateString() === today.toDateString()) return "Hôm nay"
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}`
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg, isMine, onTaskClick }: {
  msg: Message
  isMine: boolean
  onTaskClick?: (taskId: string) => void
}) {
  const isSystem = msg.msg_type !== "text" && msg.msg_type !== "ai_response"
  const isAI = msg.msg_type === "ai_response"

  if (isSystem) {
    return (
      <div style={{ textAlign: "center", margin: "6px 0" }}>
        <span style={{
          display: "inline-block", padding: "4px 12px", borderRadius: 12,
          background: "#F3F4F6", fontSize: 12, color: "#6B7280",
        }}>
          {msg.content}
          {msg.task_id && onTaskClick && (
            <button
              onClick={() => onTaskClick(msg.task_id!)}
              style={{ marginLeft: 8, fontSize: 11, color: "#3B82F6", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
            >Xem task →</button>
          )}
        </span>
        <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 2 }}>{fmtTime(msg.created_at)}</div>
      </div>
    )
  }

  if (isAI) {
    return (
      <div style={{ margin: "6px 0 10px 0", display: "flex", gap: 8 }}>
        <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#8B5CF6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#fff", flexShrink: 0 }}>🤖</div>
        <div>
          <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 3 }}>AI Assistant · {fmtTime(msg.created_at)}</div>
          <div style={{ background: "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: "0 10px 10px 10px", padding: "8px 12px", fontSize: 13, color: "#374151", maxWidth: 340, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
            {msg.content}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ margin: "4px 0", display: "flex", flexDirection: isMine ? "row-reverse" : "row", gap: 8 }}>
      {!isMine && (
        <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#E5E7EB", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#6B7280", flexShrink: 0, fontWeight: 700 }}>
          {(msg.author_name || "?").charAt(0).toUpperCase()}
        </div>
      )}
      <div style={{ maxWidth: 320 }}>
        {!isMine && <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 2 }}>{msg.author_name}</div>}
        <div style={{
          background: isMine ? "#3B82F6" : "#F3F4F6",
          color: isMine ? "#fff" : "#111827",
          borderRadius: isMine ? "10px 0 10px 10px" : "0 10px 10px 10px",
          padding: "8px 12px", fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap",
        }}>{msg.content}</div>
        <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 2, textAlign: isMine ? "right" : "left" }}>{fmtTime(msg.created_at)}</div>
      </div>
    </div>
  )
}

// ─── Create Channel Modal ─────────────────────────────────────────────────────

function CreateChannelModal({ onClose, onCreated, users }: {
  onClose: () => void
  onCreated: () => void
  users: MktUser[]
}) {
  const [name, setName] = useState("")
  const [desc, setDesc] = useState("")
  const [memberEmails, setMemberEmails] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const toggle = (email: string) => {
    setMemberEmails(m => m.includes(email) ? m.filter(e => e !== email) : [...m, email])
  }

  const submit = async () => {
    if (!name.trim()) return
    setSaving(true)
    await apiFetch("/admin/mkt-chat/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description: desc, member_ids: memberEmails }),
    })
    setSaving(false)
    onCreated(); onClose()
  }

  const inp: React.CSSProperties = { width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }
  const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#6B7280", display: "block", marginBottom: 4 }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: 420, maxWidth: "95vw" }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Tạo group chat mới</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={lbl}>Tên group *</label>
            <input style={inp} placeholder="VD: Team MKT T6, Camp tháng 6..." value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label style={lbl}>Mô tả</label>
            <input style={inp} placeholder="Mục đích của group..." value={desc} onChange={e => setDesc(e.target.value)} />
          </div>
          <div>
            <label style={lbl}>Thêm thành viên</label>
            <div style={{ border: "1px solid #E5E7EB", borderRadius: 6, overflow: "hidden" }}>
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

// ─── Create Task from Chat Modal ──────────────────────────────────────────────

function CreateTaskFromChatModal({ channelId, users, onClose, onCreated }: {
  channelId: string; users: MktUser[]
  onClose: () => void; onCreated: () => void
}) {
  const [form, setForm] = useState({ title: "", type: "ads_camp", assignee_id: "", deadline: "" })
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!form.title.trim() || !form.assignee_id) return
    setSaving(true)
    await apiFetch(`/admin/mkt-chat/channels/${channelId}/create-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    })
    setSaving(false)
    onCreated(); onClose()
  }

  const inp: React.CSSProperties = { width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "6px 10px", fontSize: 13, boxSizing: "border-box" }
  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: "#6B7280", display: "block", marginBottom: 3 }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 20, width: 380, maxWidth: "95vw" }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>📋 Tạo task từ chat</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <label style={lbl}>Tiêu đề *</label>
            <input style={inp} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Tiêu đề task..." />
          </div>
          <div>
            <label style={lbl}>Loại</label>
            <select style={inp} value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
              <option value="ads_camp">Chạy Ads / Camp</option>
              <option value="content_post">Nội dung / Bài FB</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Giao cho *</label>
            <select style={inp} value={form.assignee_id} onChange={e => setForm(f => ({ ...f, assignee_id: e.target.value }))}>
              <option value="">-- Chọn --</option>
              {users.map(u => <option key={u.email} value={u.email}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Deadline</label>
            <input type="date" style={inp} value={form.deadline} onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} />
          </div>
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

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MktChatPage() {
  const { has, isSuper } = useCurrentPermissions()
  const isManager = isSuper || has("page.mkt-chat.manage")

  const [channels, setChannels] = useState<Channel[]>([])
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showCreateChannel, setShowCreateChannel] = useState(false)
  const [showCreateTask, setShowCreateTask] = useState(false)
  const [mktUsers, setMktUsers] = useState<MktUser[]>([])
  const [currentUserId, setCurrentUserId] = useState("")
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const sseRef = useRef<EventSource | null>(null)

  // Load channels
  const loadChannels = useCallback(() => {
    apiFetch("/admin/mkt-chat/channels").then(r => r.json()).then(d => setChannels(d.channels || []))
  }, [])

  useEffect(() => {
    loadChannels()
    apiFetch("/admin/permissions/mkt-users").then(r => r.json()).then(d => setMktUsers(d.users || []))
    apiFetch("/admin/permissions/me").then(r => r.json()).then(d => setCurrentUserId(d.user?.email || ""))
  }, [loadChannels])

  // Load messages when channel changes
  useEffect(() => {
    if (!activeChannel) return
    setLoading(true)
    apiFetch(`/admin/mkt-chat/channels/${activeChannel.id}/messages`)
      .then(r => r.json())
      .then(d => setMessages(d.messages || []))
      .finally(() => setLoading(false))
  }, [activeChannel])

  // SSE for real-time messages
  useEffect(() => {
    if (!activeChannel) return
    if (sseRef.current) sseRef.current.close()

    // Use apiFetch base URL pattern — get token from cookie
    const url = `/admin/mkt-chat/channels/${activeChannel.id}/stream`
    // Simple polling fallback since SSE needs auth headers
    const poll = setInterval(() => {
      if (!activeChannel) return
      const last = messages[messages.length - 1]
      const params = last ? `?before_id=${last.id}` : ""
      apiFetch(`/admin/mkt-chat/channels/${activeChannel.id}/messages?limit=10`)
        .then(r => r.json())
        .then(d => {
          const newMsgs: Message[] = d.messages || []
          setMessages(prev => {
            const ids = new Set(prev.map(m => m.id))
            const fresh = newMsgs.filter(m => !ids.has(m.id))
            return fresh.length > 0 ? [...prev, ...fresh] : prev
          })
        })
        .catch(() => {})
    }, 3000)

    return () => { clearInterval(poll) }
  }, [activeChannel?.id])

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const sendMessage = async () => {
    if (!input.trim() || !activeChannel || sending) return
    const text = input.trim()
    setInput("")
    setSending(true)
    // Optimistic
    const optimistic: Message = {
      id: `opt-${Date.now()}`, channel_id: activeChannel.id, author_id: currentUserId,
      author_name: "Bạn", content: text, task_id: null, msg_type: "text", metadata: null,
      created_at: new Date().toISOString(),
    }
    setMessages(m => [...m, optimistic])
    await apiFetch(`/admin/mkt-chat/channels/${activeChannel.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    })
    setSending(false)
  }

  const groupedByDate = messages.reduce((acc, m) => {
    const d = fmtDate(m.created_at)
    if (!acc[d]) acc[d] = []
    acc[d].push(m)
    return acc
  }, {} as Record<string, Message[]>)

  return (
    <div style={{ display: "flex", height: "calc(100vh - 64px)", background: "#fff" }}>
      {/* Sidebar */}
      <div style={{ width: 240, flexShrink: 0, borderRight: "1px solid #E5E7EB", display: "flex", flexDirection: "column", background: "#F9FAFB" }}>
        <div style={{ padding: "16px 16px 8px", borderBottom: "1px solid #E5E7EB" }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#111827" }}>💬 Chat MKT</div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
          {channels.length === 0 && (
            <div style={{ padding: "12px 8px", fontSize: 12, color: "#9CA3AF" }}>Chưa có group nào</div>
          )}
          {channels.map(c => (
            <div key={c.id}
              onClick={() => setActiveChannel(c)}
              style={{
                padding: "10px 12px", borderRadius: 8, cursor: "pointer", marginBottom: 2,
                background: activeChannel?.id === c.id ? "#EFF6FF" : "transparent",
                border: activeChannel?.id === c.id ? "1px solid #BFDBFE" : "1px solid transparent",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}># {c.name}</div>
              {c.description && <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 2 }}>{c.description}</div>}
              <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 2 }}>{c.member_count} thành viên</div>
            </div>
          ))}
        </div>
        {isManager && (
          <div style={{ padding: 8, borderTop: "1px solid #E5E7EB" }}>
            <button
              onClick={() => setShowCreateChannel(true)}
              style={{ width: "100%", padding: "8px 0", border: "1px dashed #D1D5DB", borderRadius: 8, background: "transparent", fontSize: 12, color: "#6B7280", cursor: "pointer" }}
            >+ Tạo group</button>
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
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {/* Channel header */}
          <div style={{ padding: "12px 20px", borderBottom: "1px solid #E5E7EB", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}># {activeChannel.name}</span>
              {activeChannel.description && <span style={{ fontSize: 12, color: "#9CA3AF", marginLeft: 8 }}>{activeChannel.description}</span>}
            </div>
            <div style={{ fontSize: 12, color: "#9CA3AF" }}>{activeChannel.member_count} thành viên</div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
            {loading && <div style={{ textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>Đang tải...</div>}
            {Object.entries(groupedByDate).map(([date, msgs]) => (
              <div key={date}>
                <div style={{ textAlign: "center", margin: "12px 0 8px" }}>
                  <span style={{ background: "#F3F4F6", padding: "3px 10px", borderRadius: 10, fontSize: 11, color: "#9CA3AF" }}>{date}</span>
                </div>
                {msgs.map(m => (
                  <MessageBubble
                    key={m.id}
                    msg={m}
                    isMine={m.author_id === currentUserId}
                    onTaskClick={() => { window.location.href = "/app/mkt-tasks" }}
                  />
                ))}
              </div>
            ))}
            {messages.length === 0 && !loading && (
              <div style={{ textAlign: "center", color: "#9CA3AF", fontSize: 13, marginTop: 40 }}>
                Chưa có tin nhắn nào. Bắt đầu cuộc trò chuyện!<br />
                <span style={{ fontSize: 11, marginTop: 8, display: "block" }}>💡 Gõ <strong>@ai [câu hỏi]</strong> để hỏi AI assistant</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div style={{ padding: "12px 20px", borderTop: "1px solid #E5E7EB", display: "flex", gap: 8, alignItems: "flex-end" }}>
            {isManager && (
              <button
                onClick={() => setShowCreateTask(true)}
                title="Tạo task"
                style={{ padding: "8px 10px", border: "1px solid #E5E7EB", borderRadius: 8, background: "#fff", fontSize: 16, cursor: "pointer", flexShrink: 0 }}
              >📋</button>
            )}
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
              rows={2}
              placeholder={`Gửi tin nhắn tới #${activeChannel.name}... (Shift+Enter xuống dòng)\n@ai [câu hỏi] để hỏi AI`}
              style={{
                flex: 1, border: "1px solid #E5E7EB", borderRadius: 8,
                padding: "8px 12px", fontSize: 13, resize: "none", lineHeight: 1.5,
              }}
            />
            <button
              onClick={sendMessage}
              disabled={sending || !input.trim()}
              style={{ padding: "8px 16px", border: "none", borderRadius: 8, background: "#3B82F6", color: "#fff", fontSize: 13, cursor: "pointer", fontWeight: 600, flexShrink: 0 }}
            >Gửi</button>
          </div>
        </div>
      )}

      {/* Modals */}
      {showCreateChannel && (
        <CreateChannelModal onClose={() => setShowCreateChannel(false)} onCreated={loadChannels} users={mktUsers} />
      )}
      {showCreateTask && activeChannel && (
        <CreateTaskFromChatModal
          channelId={activeChannel.id}
          users={mktUsers}
          onClose={() => setShowCreateTask(false)}
          onCreated={() => {
            apiFetch(`/admin/mkt-chat/channels/${activeChannel.id}/messages`)
              .then(r => r.json()).then(d => setMessages(d.messages || []))
          }}
        />
      )}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Chat MKT",
})
