import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useEffect, useMemo, useState } from "react"
import { apiJson } from "../../lib/api-client"

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

type Message = {
  id: string
  sender_type: string
  direction: string
  text: string
  created_at: string
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

const tabs = [
  ["all", "Tat ca"],
  ["unread", "Chua doc"],
  ["handoff", "Can sale xu ly"],
  ["complaint", "Khieu nai"],
  ["mine", "Da gan cho toi"],
] as const

const modeLabel: Record<string, string> = {
  off: "OFF",
  suggest: "SUGGEST",
  auto_24h: "AUTO 24H",
  paused_by_error: "PAUSED",
}

const statusColor: Record<string, string> = {
  complaint: "#dc2626",
  handoff: "#d97706",
  assigned: "#2563eb",
  ordered: "#16a34a",
  new: "#6b7280",
}

function fmtTime(v?: string) {
  if (!v) return ""
  return new Date(v).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })
}

export default function ChatPage() {
  const [view, setView] = useState<"inbox" | "agents" | "examples">("inbox")
  const [tab, setTab] = useState("all")
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [text, setText] = useState("")
  const [agents, setAgents] = useState<Agent[]>([])
  const [examples, setExamples] = useState<Example[]>([])

  const selected = useMemo(() => conversations.find(c => c.id === selectedId), [conversations, selectedId])

  async function loadConversations(nextTab = tab) {
    setLoading(true)
    try {
      const d = await apiJson(`/admin/chat/conversations?status=${nextTab}&limit=80`)
      setConversations(d.conversations || [])
      if (!selectedId && d.conversations?.[0]) setSelectedId(d.conversations[0].id)
    } finally {
      setLoading(false)
    }
  }

  async function loadDetail(id = selectedId) {
    if (!id) return
    const d = await apiJson(`/admin/chat/conversations/${id}`)
    setDetail(d)
  }

  async function loadAgents() {
    const d = await apiJson("/admin/chat/agents")
    setAgents(d.agents || [])
  }

  async function loadExamples(status = "pending") {
    const d = await apiJson(`/admin/chat/reply-examples?status=${status}`)
    setExamples(d.examples || [])
  }

  useEffect(() => { loadConversations() }, [])
  useEffect(() => { if (selectedId) loadDetail(selectedId) }, [selectedId])
  useEffect(() => { if (view === "agents") loadAgents(); if (view === "examples") loadExamples() }, [view])

  async function send() {
    if (!selectedId || !text.trim()) return
    await apiJson(`/admin/chat/conversations/${selectedId}/send`, "POST", { text })
    setText("")
    await loadDetail(selectedId)
    await loadConversations(tab)
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
    await loadConversations(tab)
  }

  async function generateAgents() {
    await apiJson("/admin/chat/agents", "POST")
    await loadAgents()
  }

  async function reviewExample(ex: Example, review_status: "approved" | "rejected") {
    await apiJson(`/admin/chat/reply-examples/${ex.id}`, "PATCH", { review_status })
    await loadExamples()
  }

  const shell: React.CSSProperties = { display: "flex", flexDirection: "column", height: "calc(100vh - 56px)", margin: -24, background: "#f3f4f6", color: "#111827" }
  const button: React.CSSProperties = { border: "1px solid #d1d5db", background: "#fff", borderRadius: 6, padding: "7px 10px", fontSize: 12, cursor: "pointer" }

  return (
    <div style={shell}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "#fff", borderBottom: "1px solid #e5e7eb" }}>
        <b style={{ fontSize: 16 }}>Facebook Chat</b>
        {(["inbox", "agents", "examples"] as const).map(v => (
          <button key={v} onClick={() => setView(v)} style={{ ...button, background: view === v ? "#1877f2" : "#fff", color: view === v ? "#fff" : "#374151" }}>
            {v === "inbox" ? "Inbox" : v === "agents" ? "Bot Agents" : "Cau bot can hoc"}
          </button>
        ))}
        <button onClick={() => view === "inbox" ? loadConversations() : view === "agents" ? loadAgents() : loadExamples()} style={{ ...button, marginLeft: "auto" }}>Refresh</button>
      </div>

      {view === "inbox" && (
        <div style={{ display: "grid", gridTemplateColumns: "320px minmax(420px, 1fr) 330px", flex: 1, minHeight: 0 }}>
          <aside style={{ background: "#fff", borderRight: "1px solid #e5e7eb", display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", padding: 10, borderBottom: "1px solid #e5e7eb" }}>
              {tabs.map(([id, label]) => (
                <button key={id} onClick={() => { setTab(id); loadConversations(id) }}
                  style={{ ...button, padding: "5px 8px", background: tab === id ? "#eff6ff" : "#fff", color: tab === id ? "#1877f2" : "#374151", fontWeight: tab === id ? 700 : 500 }}>
                  {label}
                </button>
              ))}
            </div>
            <div style={{ overflow: "auto", flex: 1 }}>
              {loading && <div style={{ padding: 20, color: "#6b7280" }}>Dang tai...</div>}
              {conversations.map(c => (
                <button key={c.id} onClick={() => setSelectedId(c.id)}
                  style={{ width: "100%", textAlign: "left", border: "none", borderBottom: "1px solid #f3f4f6", background: selectedId === c.id ? "#eff6ff" : "#fff", padding: 12, cursor: "pointer" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <b style={{ fontSize: 13, flex: 1 }}>{c.customer_name || c.customer_psid}</b>
                    {c.unread_count > 0 && <span style={{ background: "#ef4444", color: "#fff", borderRadius: 99, padding: "1px 6px", fontSize: 11 }}>{c.unread_count}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "#6b7280", marginTop: 3 }}>{c.page_name}</div>
                  <div style={{ fontSize: 12, color: "#374151", marginTop: 5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.last_message}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 7, alignItems: "center" }}>
                    <span style={{ color: statusColor[c.status] || "#6b7280", fontSize: 11, fontWeight: 700 }}>{c.status}</span>
                    <span style={{ color: "#9ca3af", fontSize: 11 }}>{fmtTime(c.last_message_at)}</span>
                    <span style={{ marginLeft: "auto", fontSize: 10, color: "#6b7280" }}>{modeLabel[c.bot_mode || "suggest"]}</span>
                  </div>
                </button>
              ))}
            </div>
          </aside>

          <main style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "10px 14px", display: "flex", gap: 8, alignItems: "center" }}>
              <b>{selected?.customer_name || selected?.customer_psid || "Chon hoi thoai"}</b>
              {selected?.handoff_reason && <span style={{ background: "#fef3c7", color: "#92400e", borderRadius: 99, padding: "2px 8px", fontSize: 11 }}>Handoff: {selected.handoff_reason}</span>}
              <button onClick={assignMe} disabled={!selectedId} style={{ ...button, marginLeft: "auto" }}>Nhan xu ly</button>
              <button onClick={resumeBot} disabled={!selectedId} style={button}>Bat lai bot</button>
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
              {(detail?.messages || []).map((m: Message) => {
                const mine = m.direction === "outbound"
                return (
                  <div key={m.id} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start", marginBottom: 10 }}>
                    <div style={{ maxWidth: "72%", background: mine ? "#1877f2" : "#fff", color: mine ? "#fff" : "#111827", borderRadius: 10, padding: "8px 10px", boxShadow: "0 1px 2px rgba(0,0,0,.08)" }}>
                      <div style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{m.text}</div>
                      <div style={{ fontSize: 10, opacity: 0.75, marginTop: 4 }}>{m.sender_type} · {fmtTime(m.created_at)}</div>
                    </div>
                  </div>
                )
              })}
            </div>
            <div style={{ display: "flex", gap: 8, padding: 12, background: "#fff", borderTop: "1px solid #e5e7eb" }}>
              <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Nhap tin nhan sale..." style={{ flex: 1, resize: "none", minHeight: 54, border: "1px solid #d1d5db", borderRadius: 8, padding: 10 }} />
              <button onClick={send} disabled={!text.trim()} style={{ ...button, background: "#1877f2", color: "#fff", borderColor: "#1877f2", minWidth: 80 }}>Gui</button>
            </div>
          </main>

          <aside style={{ background: "#fff", borderLeft: "1px solid #e5e7eb", padding: 14, overflow: "auto" }}>
            <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>Context khach</h3>
            <Info label="Page" value={detail?.conversation?.page_name || selected?.page_name} />
            <Info label="San pham dang chay" value={(detail?.conversation?.product_names || selected?.product_names || []).join(", ") || selected?.active_product_interest} />
            <Info label="Bot mode" value={detail?.conversation?.bot_mode || selected?.bot_mode} />
            <Info label="Status" value={detail?.conversation?.status || selected?.status} />
            <Info label="Handoff" value={detail?.conversation?.handoff_reason || selected?.handoff_reason} />
            <Info label="Assigned" value={detail?.conversation?.assigned_to || selected?.assigned_to} />
            <hr style={{ border: 0, borderTop: "1px solid #e5e7eb", margin: "12px 0" }} />
            <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>Context 24h</h4>
            <Info label="SDT" value={detail?.conversation?.active_phone || selected?.active_phone} />
            <Info label="Dia chi" value={detail?.conversation?.active_address || selected?.active_address} />
            <Info label="Trang thai don" value={detail?.conversation?.active_order_state || selected?.active_order_state} />
            <div style={{ whiteSpace: "pre-wrap", color: "#4b5563", fontSize: 12, background: "#f9fafb", borderRadius: 8, padding: 10, marginTop: 8 }}>
              {detail?.conversation?.active_window_summary || "Chua co context"}
            </div>
            <h4 style={{ margin: "14px 0 8px", fontSize: 13 }}>Lich su tham khao</h4>
            <div style={{ whiteSpace: "pre-wrap", color: "#6b7280", fontSize: 12, background: "#f9fafb", borderRadius: 8, padding: 10 }}>
              {detail?.conversation?.historical_summary || "Chua co lich su"}
            </div>
          </aside>
        </div>
      )}

      {view === "agents" && (
        <div style={{ padding: 16, overflow: "auto" }}>
          <button onClick={generateAgents} style={{ ...button, background: "#1877f2", color: "#fff", borderColor: "#1877f2", marginBottom: 12 }}>Generate agent tu Page</button>
          <div style={{ display: "grid", gap: 10 }}>
            {agents.map(a => (
              <div key={a.id} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 14 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <b>{a.page_name}</b>
                  <span style={{ color: "#6b7280", fontSize: 12 }}>{(a.product_names || []).join(", ") || a.sp_chay || "Chua map SP"}</span>
                  <select value={a.mode} onChange={e => setAgentMode(a, e.target.value)} style={{ marginLeft: "auto", border: "1px solid #d1d5db", borderRadius: 6, padding: 6 }}>
                    <option value="off">OFF</option>
                    <option value="suggest">SUGGEST</option>
                    <option value="auto_24h">AUTO 24H</option>
                    <option value="paused_by_error">PAUSED</option>
                  </select>
                </div>
                <pre style={{ whiteSpace: "pre-wrap", background: "#f9fafb", borderRadius: 8, padding: 10, fontSize: 12, color: "#374151" }}>{a.generated_instruction || "Chua generate instruction"}</pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "examples" && (
        <div style={{ padding: 16, overflow: "auto" }}>
          <div style={{ display: "grid", gap: 10 }}>
            {examples.map(ex => (
              <div key={ex.id} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 14 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
                  <b>{ex.page_name || "Page"}</b>
                  <span style={{ color: "#6b7280", fontSize: 12 }}>{ex.product_name || ""}</span>
                  <span style={{ marginLeft: "auto", fontSize: 12, color: "#d97706" }}>{ex.review_status}</span>
                </div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Khach hoi</div>
                <div style={{ background: "#f9fafb", padding: 10, borderRadius: 8, marginBottom: 8 }}>{ex.customer_text}</div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Sale tra loi</div>
                <div style={{ background: "#f0fdf4", padding: 10, borderRadius: 8 }}>{ex.sale_reply}</div>
                {ex.review_status === "pending" && (
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button onClick={() => reviewExample(ex, "approved")} style={{ ...button, background: "#16a34a", color: "#fff", borderColor: "#16a34a" }}>Approve</button>
                    <button onClick={() => reviewExample(ex, "rejected")} style={{ ...button, background: "#fee2e2", color: "#dc2626", borderColor: "#fecaca" }}>Reject</button>
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

function Info({ label, value }: { label: string; value?: any }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: value ? "#111827" : "#9ca3af", fontWeight: value ? 600 : 400 }}>{value || "—"}</div>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Chat",
  icon: "chat-bubble-left-right",
})
