import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useState, useEffect, useCallback } from "react"
import { apiFetch } from "../../lib/api-client"
import { useCurrentPermissions } from "../../lib/use-permissions"

// ─── Types ───────────────────────────────────────────────────────────────────

type Task = {
  id: string
  title: string
  type: "ads_camp" | "content_post"
  assignee_id: string
  assignee_name: string
  created_by: string
  deadline: string | null
  status: "todo" | "in_progress" | "done" | "cancelled"
  notes: string | null
  comments: { author_id: string; text: string; created_at: string }[]
  rating: number | null
  channel_id: string | null
  created_at: string
  updated_at: string
}

type MktUser = { id?: string; email: string; name: string }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(d: string | null) {
  if (!d) return "—"
  const dt = new Date(d)
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}`
}

function isOverdue(t: Task) {
  if (!t.deadline || t.status === "done" || t.status === "cancelled") return false
  return new Date(t.deadline) < new Date()
}

// ─── Badges ──────────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  todo: { label: "Chờ làm", color: "#6B7280" },
  in_progress: { label: "Đang làm", color: "#3B82F6" },
  done: { label: "Hoàn thành", color: "#10B981" },
  cancelled: { label: "Đã hủy", color: "#EF4444" },
}

const TYPE_MAP: Record<string, { label: string; color: string }> = {
  ads_camp: { label: "Chạy Ads", color: "#8B5CF6" },
  content_post: { label: "Nội dung", color: "#F59E0B" },
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] || { label: status, color: "#6B7280" }
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600,
      background: s.color + "18", color: s.color,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.color }} />
      {s.label}
    </span>
  )
}

function TypeBadge({ type }: { type: string }) {
  const t = TYPE_MAP[type] || { label: type, color: "#6B7280" }
  return (
    <span style={{
      padding: "1px 6px", borderRadius: 4, fontSize: 11, fontWeight: 600,
      background: t.color + "20", color: t.color,
    }}>{t.label}</span>
  )
}

function Stars({ value, onChange }: { value: number | null; onChange?: (v: number) => void }) {
  return (
    <span style={{ display: "inline-flex", gap: 2 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <span key={i}
          onClick={onChange ? () => onChange(i) : undefined}
          style={{
            fontSize: 16, cursor: onChange ? "pointer" : "default",
            color: (value || 0) >= i ? "#F59E0B" : "#D1D5DB",
          }}>★</span>
      ))}
    </span>
  )
}

// ─── Task Drawer ─────────────────────────────────────────────────────────────

function TaskDrawer({
  task, onClose, isManager, currentUserId,
  onUpdate,
}: {
  task: Task
  onClose: () => void
  isManager: boolean
  currentUserId: string
  onUpdate: () => void
}) {
  const [status, setStatus] = useState(task.status)
  const [notes, setNotes] = useState(task.notes || "")
  const [comment, setComment] = useState("")
  const [comments, setComments] = useState(task.comments || [])
  const [saving, setSaving] = useState(false)
  const [commentSaving, setCommentSaving] = useState(false)

  const updateStatus = async (s: string) => {
    setStatus(s as any)
    await apiFetch(`/admin/mkt-tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: s }),
    })
    onUpdate()
  }

  const saveNotes = async () => {
    setSaving(true)
    await apiFetch(`/admin/mkt-tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    })
    setSaving(false)
    onUpdate()
  }

  const sendComment = async () => {
    if (!comment.trim()) return
    setCommentSaving(true)
    const r = await apiFetch(`/admin/mkt-tasks/${task.id}/comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: comment.trim() }),
    }).then(r => r.json())
    if (r.comment) setComments(c => [...c, r.comment])
    setComment("")
    setCommentSaving(false)
  }

  const rateTask = async (rating: number) => {
    await apiFetch(`/admin/mkt-tasks/${task.id}/rate`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating }),
    })
    onUpdate()
  }

  const STATUSES = isManager
    ? ["todo", "in_progress", "done", "cancelled"]
    : ["todo", "in_progress", "done"]

  const st: React.CSSProperties = {
    position: "fixed", top: 0, right: 0, width: 420, height: "100vh",
    background: "#fff", borderLeft: "1px solid #E5E7EB",
    boxShadow: "-4px 0 24px rgba(0,0,0,0.08)",
    zIndex: 100, display: "flex", flexDirection: "column", overflowY: "auto",
  }

  return (
    <>
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.2)", zIndex: 99,
      }} />
      <div style={st}>
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #F3F4F6", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <TypeBadge type={task.type} />
              <StatusBadge status={status} />
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#111827", lineHeight: 1.3 }}>{task.title}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#9CA3AF", padding: 0 }}>×</button>
        </div>

        <div style={{ padding: "16px 20px", flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Meta */}
          <div style={{ fontSize: 13, color: "#6B7280", display: "flex", flexDirection: "column", gap: 4 }}>
            <div>👤 <strong>{task.assignee_name}</strong></div>
            <div style={{ color: isOverdue(task) ? "#EF4444" : undefined }}>
              📅 Deadline: <strong>{task.deadline ? new Date(task.deadline).toLocaleDateString("vi-VN") : "Chưa đặt"}</strong>
              {isOverdue(task) && <span style={{ color: "#EF4444", marginLeft: 6 }}>⚠ Quá hạn</span>}
            </div>
          </div>

          {/* Status buttons */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#6B7280", marginBottom: 6 }}>TRẠNG THÁI</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {STATUSES.map(s => (
                <button key={s}
                  onClick={() => updateStatus(s)}
                  style={{
                    padding: "5px 12px", borderRadius: 6, border: "1px solid",
                    fontSize: 12, fontWeight: 600, cursor: "pointer",
                    background: status === s ? STATUS_MAP[s].color : "#fff",
                    color: status === s ? "#fff" : STATUS_MAP[s].color,
                    borderColor: STATUS_MAP[s].color,
                  }}
                >{STATUS_MAP[s].label}</button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#6B7280", marginBottom: 6 }}>GHI CHÚ</div>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              disabled={!isManager}
              rows={3}
              style={{
                width: "100%", border: "1px solid #E5E7EB", borderRadius: 6,
                padding: "8px 10px", fontSize: 13, resize: "vertical",
                background: isManager ? "#fff" : "#F9FAFB", color: "#374151",
                boxSizing: "border-box",
              }}
              placeholder={isManager ? "Thêm mô tả, yêu cầu..." : "Không có ghi chú"}
            />
            {isManager && (
              <button onClick={saveNotes} disabled={saving}
                style={{ marginTop: 6, padding: "4px 12px", borderRadius: 6, border: "1px solid #E5E7EB", background: "#fff", fontSize: 12, cursor: "pointer" }}>
                {saving ? "Đang lưu..." : "Lưu ghi chú"}
              </button>
            )}
          </div>

          {/* Rating (manager only, when done) */}
          {isManager && status === "done" && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#6B7280", marginBottom: 6 }}>ĐÁNH GIÁ</div>
              <Stars value={task.rating} onChange={rateTask} />
              {task.rating && <span style={{ fontSize: 12, color: "#9CA3AF", marginLeft: 8 }}>{task.rating}/5</span>}
            </div>
          )}
          {!isManager && task.rating && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#6B7280", marginBottom: 6 }}>ĐÁNH GIÁ</div>
              <Stars value={task.rating} />
            </div>
          )}

          {/* Comments */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#6B7280", marginBottom: 8 }}>BÌNH LUẬN ({comments.length})</div>
            <div style={{ flex: 1, overflowY: "auto", maxHeight: 200, display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
              {comments.length === 0 && <div style={{ fontSize: 12, color: "#9CA3AF" }}>Chưa có bình luận</div>}
              {comments.map((c, i) => (
                <div key={i} style={{ background: "#F9FAFB", borderRadius: 6, padding: "8px 10px" }}>
                  <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 2 }}>
                    {c.author_id === currentUserId ? "Bạn" : c.author_id.slice(0, 8)} · {new Date(c.created_at).toLocaleString("vi-VN")}
                  </div>
                  <div style={{ fontSize: 13, color: "#374151" }}>{c.text}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <textarea
                value={comment}
                onChange={e => setComment(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendComment() } }}
                rows={2}
                placeholder="Nhập bình luận... (Enter để gửi)"
                style={{ flex: 1, border: "1px solid #E5E7EB", borderRadius: 6, padding: "6px 8px", fontSize: 13, resize: "none" }}
              />
              <button onClick={sendComment} disabled={commentSaving || !comment.trim()}
                style={{ padding: "6px 12px", borderRadius: 6, border: "none", background: "#3B82F6", color: "#fff", fontSize: 12, cursor: "pointer", alignSelf: "flex-end" }}>
                Gửi
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Create Task Modal ────────────────────────────────────────────────────────

function CreateTaskModal({ onClose, onCreated, users }: {
  onClose: () => void
  onCreated: () => void
  users: MktUser[]
}) {
  const [form, setForm] = useState({ title: "", type: "ads_camp", assignee_id: "", deadline: "", notes: "" })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState("")

  const submit = async () => {
    if (!form.title.trim() || !form.assignee_id) { setErr("Vui lòng nhập tiêu đề và chọn người nhận"); return }
    setSaving(true); setErr("")
    const r = await apiFetch("/admin/mkt-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    }).then(r => r.json())
    setSaving(false)
    if (r.task) { onCreated(); onClose() }
    else setErr(r.error || "Lỗi tạo task")
  }

  const inp: React.CSSProperties = { width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }
  const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#6B7280", display: "block", marginBottom: 4 }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: 480, maxWidth: "95vw", boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>Tạo task mới</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={lbl}>Tiêu đề *</label>
            <input style={inp} placeholder="VD: Camp chuyển đổi tháng 6" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </div>
          <div>
            <label style={lbl}>Loại task *</label>
            <select style={inp} value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
              <option value="ads_camp">Chạy Ads / Camp</option>
              <option value="content_post">Nội dung / Bài đăng FB</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Giao cho *</label>
            <select style={inp} value={form.assignee_id} onChange={e => setForm(f => ({ ...f, assignee_id: e.target.value }))}>
              <option value="">-- Chọn người --</option>
              {users.map(u => <option key={u.email} value={u.email}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Deadline</label>
            <input type="date" style={inp} value={form.deadline} onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} />
          </div>
          <div>
            <label style={lbl}>Ghi chú / Yêu cầu</label>
            <textarea rows={3} style={{ ...inp, resize: "vertical" }} placeholder="Mô tả chi tiết..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          {err && <div style={{ color: "#EF4444", fontSize: 12 }}>{err}</div>}
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
          <button onClick={onClose} style={{ padding: "8px 16px", border: "1px solid #E5E7EB", borderRadius: 6, background: "#fff", fontSize: 13, cursor: "pointer" }}>Hủy</button>
          <button onClick={submit} disabled={saving} style={{ padding: "8px 16px", border: "none", borderRadius: 6, background: "#3B82F6", color: "#fff", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>
            {saving ? "Đang tạo..." : "Tạo task"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Task Row ─────────────────────────────────────────────────────────────────

function TaskRow({ task, onClick }: { task: Task; onClick: () => void }) {
  const overdue = isOverdue(task)
  return (
    <div onClick={onClick} style={{
      display: "grid", gridTemplateColumns: "1fr 90px 100px 80px 110px 80px",
      alignItems: "center", padding: "10px 12px", cursor: "pointer",
      borderBottom: "1px solid #F3F4F6", gap: 8,
      background: "#fff",
      transition: "background 0.1s",
    }}
      onMouseEnter={e => (e.currentTarget.style.background = "#F9FAFB")}
      onMouseLeave={e => (e.currentTarget.style.background = "#fff")}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
        <span style={{ fontSize: 14 }}>
          {task.status === "done" ? "✓" : task.status === "cancelled" ? "✕" : task.status === "in_progress" ? "◉" : "☐"}
        </span>
        <span style={{
          fontSize: 13, fontWeight: 500, color: "#111827",
          textDecoration: task.status === "cancelled" ? "line-through" : undefined,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{task.title}</span>
      </div>
      <div><TypeBadge type={task.type} /></div>
      <div style={{ fontSize: 12, color: "#6B7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{task.assignee_name}</div>
      <div style={{ fontSize: 12, color: overdue ? "#EF4444" : "#6B7280", fontWeight: overdue ? 600 : 400 }}>
        {fmt(task.deadline)}
        {overdue && " ⚠"}
      </div>
      <div><StatusBadge status={task.status} /></div>
      <div><Stars value={task.rating} /></div>
    </div>
  )
}

// ─── Grouped Section ──────────────────────────────────────────────────────────

function GroupedSection({ label, tasks, onTaskClick }: {
  label: string
  tasks: Task[]
  onTaskClick: (t: Task) => void
}) {
  const [open, setOpen] = useState(true)
  const done = tasks.filter(t => t.status === "done").length

  return (
    <div style={{ marginBottom: 8 }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
          background: "#F9FAFB", borderRadius: open ? "6px 6px 0 0" : 6,
          cursor: "pointer", borderBottom: open ? "1px solid #E5E7EB" : undefined,
        }}
      >
        <span style={{ fontSize: 12, color: "#9CA3AF" }}>{open ? "▼" : "▶"}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>{label}</span>
        <span style={{ fontSize: 11, color: "#9CA3AF", marginLeft: "auto" }}>{done}/{tasks.length} hoàn thành</span>
      </div>
      {open && (
        <div style={{ border: "1px solid #F3F4F6", borderTop: "none", borderRadius: "0 0 6px 6px", overflow: "hidden" }}>
          {tasks.map(t => <TaskRow key={t.id} task={t} onClick={() => onTaskClick(t)} />)}
        </div>
      )}
    </div>
  )
}

// ─── Stats Tab ────────────────────────────────────────────────────────────────

function StatsTab() {
  const [stats, setStats] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch("/admin/mkt-tasks/stats").then(r => r.json()).then(d => setStats(d.stats || [])).finally(() => setLoading(false))
  }, [])

  const th: React.CSSProperties = { padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6B7280", background: "#F9FAFB", borderBottom: "2px solid #E5E7EB" }
  const td: React.CSSProperties = { padding: "10px 12px", fontSize: 13, borderBottom: "1px solid #F3F4F6" }

  if (loading) return <div style={{ padding: 24, color: "#9CA3AF" }}>Đang tải...</div>

  return (
    <div style={{ padding: "0 0 24px" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: 8, overflow: "hidden", border: "1px solid #E5E7EB" }}>
        <thead>
          <tr>
            <th style={th}>Thành viên</th>
            <th style={{ ...th, textAlign: "center" }}>Tổng</th>
            <th style={{ ...th, textAlign: "center" }}>Đang làm</th>
            <th style={{ ...th, textAlign: "center" }}>Hoàn thành</th>
            <th style={{ ...th, textAlign: "center" }}>Đúng hạn</th>
            <th style={{ ...th, textAlign: "center" }}>Đánh giá TB</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s: any) => (
            <tr key={s.assignee_id}>
              <td style={td}><strong>{s.assignee_name}</strong></td>
              <td style={{ ...td, textAlign: "center" }}>{s.total}</td>
              <td style={{ ...td, textAlign: "center" }}><span style={{ color: "#3B82F6", fontWeight: 600 }}>{s.in_progress}</span></td>
              <td style={{ ...td, textAlign: "center" }}>
                <span style={{ color: "#10B981", fontWeight: 600 }}>{s.done}</span>
                <span style={{ color: "#9CA3AF", fontSize: 11 }}> ({s.done_rate}%)</span>
              </td>
              <td style={{ ...td, textAlign: "center" }}>
                <span style={{ color: s.on_time_rate >= 80 ? "#10B981" : "#F59E0B", fontWeight: 600 }}>{s.on_time_rate}%</span>
              </td>
              <td style={{ ...td, textAlign: "center" }}>
                {s.avg_rating ? <><Stars value={Math.round(s.avg_rating)} /><span style={{ fontSize: 11, color: "#9CA3AF" }}> {s.avg_rating}</span></> : "—"}
              </td>
            </tr>
          ))}
          {stats.length === 0 && (
            <tr><td colSpan={6} style={{ ...td, textAlign: "center", color: "#9CA3AF" }}>Chưa có dữ liệu</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MktTasksPage() {
  const { has, isSuper, mktCode } = useCurrentPermissions()
  const isManager = isSuper || has("page.mkt-tasks.manage")

  const [tab, setTab] = useState<"tasks" | "stats">("tasks")
  const [groupBy, setGroupBy] = useState<"assignee" | "type" | "week">("assignee")
  const [filterStatus, setFilterStatus] = useState("all")
  const [filterType, setFilterType] = useState("")
  const [groups, setGroups] = useState<Record<string, Task[]>>({})
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [mktUsers, setMktUsers] = useState<MktUser[]>([])
  const [currentUserId, setCurrentUserId] = useState("")

  const load = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({ group_by: groupBy })
    if (filterStatus !== "all") params.set("status", filterStatus)
    if (filterType) params.set("type", filterType)
    apiFetch(`/admin/mkt-tasks?${params}`).then(r => r.json()).then(d => {
      if (d.grouped) setGroups(d.groups)
      else setGroups({ "Tất cả": d.tasks || [] })
    }).finally(() => setLoading(false))
  }, [groupBy, filterStatus, filterType])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    apiFetch("/admin/permissions/mkt-users").then(r => r.json()).then(d => setMktUsers(d.users || []))
    apiFetch("/admin/permissions/me").then(r => r.json()).then(d => setCurrentUserId(d.user?.id || ""))
  }, [])

  const totalTasks = Object.values(groups).flat().length

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "8px 16px", borderRadius: 6, border: "none",
    background: active ? "#3B82F6" : "transparent",
    color: active ? "#fff" : "#6B7280",
    fontSize: 13, fontWeight: 600, cursor: "pointer",
  })

  const chip = (v: string, cur: string, set: (v: string) => void, label: string, color?: string): React.CSSProperties => ({
    padding: "4px 12px", borderRadius: 12, border: `1px solid ${cur === v ? (color || "#3B82F6") : "#E5E7EB"}`,
    background: cur === v ? (color || "#3B82F6") + "15" : "#fff",
    color: cur === v ? (color || "#3B82F6") : "#6B7280",
    fontSize: 12, fontWeight: 600, cursor: "pointer",
  })

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: "#111827" }}>📋 Giao Việc MKT</h1>
          <div style={{ fontSize: 13, color: "#9CA3AF", marginTop: 2 }}>{totalTasks} task{totalTasks !== 1 ? "" : ""}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {isManager && (
            <button style={{ ...tabStyle(false), background: "#3B82F6" }} onClick={() => setShowCreate(true)}>
              + Tạo task
            </button>
          )}
          {isManager && (
            <div style={{ display: "flex", gap: 2, background: "#F3F4F6", borderRadius: 6, padding: 2 }}>
              {(["tasks", "stats"] as const).map(t => (
                <button key={t} onClick={() => setTab(t)} style={tabStyle(tab === t)}>
                  {t === "tasks" ? "Danh sách" : "Báo cáo"}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {tab === "stats" ? <StatsTab /> : (
        <>
          {/* Toolbar */}
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
            {/* Group-by */}
            {isManager && (
              <div style={{ display: "flex", gap: 2, background: "#F3F4F6", borderRadius: 6, padding: 2 }}>
                {[
                  { v: "assignee", l: "Theo người" },
                  { v: "type", l: "Theo loại" },
                  { v: "week", l: "Theo tuần" },
                ].map(({ v, l }) => (
                  <button key={v} onClick={() => setGroupBy(v as any)}
                    style={tabStyle(groupBy === v)}>{l}</button>
                ))}
              </div>
            )}
            {/* Status filter */}
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {[
                { v: "all", l: "Tất cả" },
                { v: "todo", l: "Chờ làm", c: "#6B7280" },
                { v: "in_progress", l: "Đang làm", c: "#3B82F6" },
                { v: "done", l: "Hoàn thành", c: "#10B981" },
                { v: "cancelled", l: "Đã hủy", c: "#EF4444" },
              ].map(({ v, l, c }) => (
                <button key={v} onClick={() => setFilterStatus(v)} style={chip(v, filterStatus, setFilterStatus, l, c)}>{l}</button>
              ))}
            </div>
            {/* Type filter */}
            <select
              value={filterType}
              onChange={e => setFilterType(e.target.value)}
              style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #E5E7EB", fontSize: 12, color: "#6B7280" }}
            >
              <option value="">Mọi loại</option>
              <option value="ads_camp">Chạy Ads</option>
              <option value="content_post">Nội dung</option>
            </select>
          </div>

          {/* Table header */}
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 90px 100px 80px 110px 80px",
            padding: "6px 12px", gap: 8,
            fontSize: 11, fontWeight: 700, color: "#9CA3AF", letterSpacing: "0.05em",
          }}>
            <div>TIÊU ĐỀ</div>
            <div>LOẠI</div>
            <div>NGƯỜI NHẬN</div>
            <div>DEADLINE</div>
            <div>TRẠNG THÁI</div>
            <div>ĐÁNH GIÁ</div>
          </div>

          {/* Groups */}
          {loading ? (
            <div style={{ textAlign: "center", padding: 40, color: "#9CA3AF" }}>Đang tải...</div>
          ) : Object.entries(groups).length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "#9CA3AF" }}>Không có task nào</div>
          ) : (
            Object.entries(groups).map(([label, tasks]) => (
              <GroupedSection key={label} label={label} tasks={tasks} onTaskClick={setSelectedTask} />
            ))
          )}
        </>
      )}

      {/* Modals */}
      {showCreate && (
        <CreateTaskModal
          onClose={() => setShowCreate(false)}
          onCreated={load}
          users={mktUsers}
        />
      )}
      {selectedTask && (
        <TaskDrawer
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          isManager={isManager}
          currentUserId={currentUserId}
          onUpdate={() => { load(); setSelectedTask(null) }}
        />
      )}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Giao Việc MKT",
})
