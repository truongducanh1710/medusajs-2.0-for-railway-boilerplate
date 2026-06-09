import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useState, useEffect, useCallback, useRef } from "react"
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

function fmtFull(d: string | null) {
  if (!d) return "Chưa đặt"
  return new Date(d).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })
}

function isOverdue(t: Task) {
  if (!t.deadline || t.status === "done" || t.status === "cancelled") return false
  return new Date(t.deadline) < new Date()
}

function daysUntil(d: string | null): number | null {
  if (!d) return null
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000)
}

function resolveAuthorName(authorId: string, users: MktUser[], currentUserEmail: string): string {
  if (authorId === currentUserEmail) return "Bạn"
  const u = users.find(u => u.email === authorId || u.id === authorId)
  if (u) return u.name
  // fallback: show partial email
  return authorId.includes("@") ? authorId.split("@")[0] : authorId.slice(0, 10)
}

// ─── Badges ──────────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, { label: string; color: string; icon: string }> = {
  todo:        { label: "Chờ làm",     color: "#6B7280", icon: "☐" },
  in_progress: { label: "Đang làm",    color: "#3B82F6", icon: "◉" },
  done:        { label: "Hoàn thành",  color: "#10B981", icon: "✓" },
  cancelled:   { label: "Đã hủy",      color: "#EF4444", icon: "✕" },
}

const TYPE_MAP: Record<string, { label: string; color: string; icon: string }> = {
  ads_camp:     { label: "Chạy Ads",  color: "#8B5CF6", icon: "📢" },
  content_post: { label: "Nội dung",  color: "#F59E0B", icon: "✍️" },
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] || { label: status, color: "#6B7280", icon: "" }
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
  const t = TYPE_MAP[type] || { label: type, color: "#6B7280", icon: "" }
  return (
    <span style={{
      padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
      background: t.color + "20", color: t.color,
    }}>{t.icon} {t.label}</span>
  )
}

function Stars({ value, onChange }: { value: number | null; onChange?: (v: number) => void }) {
  const [hover, setHover] = useState(0)
  return (
    <span style={{ display: "inline-flex", gap: 2 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <span key={i}
          onClick={onChange ? () => onChange(i) : undefined}
          onMouseEnter={onChange ? () => setHover(i) : undefined}
          onMouseLeave={onChange ? () => setHover(0) : undefined}
          style={{
            fontSize: 16, cursor: onChange ? "pointer" : "default",
            color: (hover || value || 0) >= i ? "#F59E0B" : "#D1D5DB",
            transition: "color 0.1s",
          }}>★</span>
      ))}
    </span>
  )
}

// ─── Deadline chip ────────────────────────────────────────────────────────────

function DeadlineChip({ task }: { task: Task }) {
  const days = daysUntil(task.deadline)
  const overdue = isOverdue(task)

  if (!task.deadline) return <span style={{ fontSize: 12, color: "#D1D5DB" }}>—</span>

  let bg = "#F3F4F6", color = "#6B7280", label = fmt(task.deadline)
  if (task.status === "done" || task.status === "cancelled") {
    bg = "#F3F4F6"; color = "#9CA3AF"
  } else if (overdue) {
    bg = "#FEE2E2"; color = "#DC2626"; label = fmt(task.deadline) + " ⚠"
  } else if (days !== null && days <= 2) {
    bg = "#FEF3C7"; color = "#D97706"
  }

  return (
    <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: bg, color }}>
      {label}
    </span>
  )
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ msg, type, onDone }: { msg: string; type: "success" | "error"; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 2800); return () => clearTimeout(t) }, [])
  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24, zIndex: 9999,
      background: type === "success" ? "#10B981" : "#EF4444",
      color: "#fff", padding: "10px 18px", borderRadius: 8,
      fontSize: 13, fontWeight: 600, boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
      animation: "fadeIn 0.2s ease",
    }}>
      {type === "success" ? "✓ " : "✕ "}{msg}
    </div>
  )
}

// ─── Confirm Dialog ───────────────────────────────────────────────────────────

function ConfirmDialog({ msg, onConfirm, onCancel }: { msg: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: 10, padding: 24, width: 340, boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}>
        <div style={{ fontSize: 14, color: "#374151", marginBottom: 20, lineHeight: 1.5 }}>{msg}</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ padding: "7px 14px", border: "1px solid #E5E7EB", borderRadius: 6, background: "#fff", fontSize: 13, cursor: "pointer" }}>Hủy</button>
          <button onClick={onConfirm} style={{ padding: "7px 14px", border: "none", borderRadius: 6, background: "#EF4444", color: "#fff", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>Xác nhận</button>
        </div>
      </div>
    </div>
  )
}

// ─── Task Drawer ─────────────────────────────────────────────────────────────

function TaskDrawer({
  task: initialTask, onClose, isManager, currentUserEmail, mktUsers,
  onUpdate, onDelete, onToast,
}: {
  task: Task
  onClose: () => void
  isManager: boolean
  currentUserEmail: string
  mktUsers: MktUser[]
  onUpdate: (reload?: boolean) => void
  onDelete: (id: string) => void
  onToast: (msg: string, type: "success" | "error") => void
}) {
  const [task, setTask] = useState(initialTask)
  const [notes, setNotes] = useState(initialTask.notes || "")
  const [notesDirty, setNotesDirty] = useState(false)
  const [comment, setComment] = useState("")
  const [comments, setComments] = useState(initialTask.comments || [])
  const [saving, setSaving] = useState(false)
  const [commentSaving, setCommentSaving] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState({ title: initialTask.title, deadline: initialTask.deadline?.slice(0, 10) || "", assignee_id: initialTask.assignee_id, type: initialTask.type })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const commentsEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    commentsEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [comments])

  const patchTask = async (update: Record<string, any>) => {
    const r = await apiFetch(`/admin/mkt-tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    }).then(r => r.json())
    if (r.task) {
      setTask(t => ({ ...t, ...update }))
      onUpdate(false)
      return true
    }
    onToast(r.error || "Lỗi cập nhật", "error")
    return false
  }

  const updateStatus = async (s: string) => {
    const ok = await patchTask({ status: s })
    if (ok) onToast(`Đã chuyển sang "${STATUS_MAP[s]?.label}"`, "success")
  }

  const saveNotes = async () => {
    setSaving(true)
    const ok = await patchTask({ notes })
    setSaving(false)
    if (ok) { setNotesDirty(false); onToast("Đã lưu ghi chú", "success") }
  }

  const saveEdit = async () => {
    setSaving(true)
    const ok = await patchTask({
      title: editForm.title,
      deadline: editForm.deadline || null,
      assignee_id: editForm.assignee_id,
      type: editForm.type,
    })
    setSaving(false)
    if (ok) { setEditMode(false); onToast("Đã cập nhật task", "success") }
  }

  const sendComment = async () => {
    if (!comment.trim()) return
    setCommentSaving(true)
    const r = await apiFetch(`/admin/mkt-tasks/${task.id}/comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: comment.trim() }),
    }).then(r => r.json())
    if (r.comment) {
      setComments(c => [...c, r.comment])
      setComment("")
    } else {
      onToast(r.error || "Lỗi gửi comment", "error")
    }
    setCommentSaving(false)
  }

  const rateTask = async (rating: number) => {
    const ok = await patchTask({ rating })
    if (ok) { setTask(t => ({ ...t, rating })); onToast("Đã đánh giá", "success") }
  }

  const handleDelete = async () => {
    await apiFetch(`/admin/mkt-tasks/${task.id}`, { method: "DELETE" })
    onDelete(task.id)
    onClose()
    onToast("Đã xóa task", "success")
  }

  const STATUSES = isManager
    ? ["todo", "in_progress", "done", "cancelled"]
    : ["todo", "in_progress", "done"]

  const inp: React.CSSProperties = { width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "7px 10px", fontSize: 13, boxSizing: "border-box", background: "#fff" }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", zIndex: 99 }} />
      <div style={{
        position: "fixed", top: 0, right: 0, width: 440, height: "100vh",
        background: "#fff", borderLeft: "1px solid #E5E7EB",
        boxShadow: "-8px 0 32px rgba(0,0,0,0.1)",
        zIndex: 100, display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #F3F4F6", background: "#FAFAFA" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                <TypeBadge type={task.type} />
                <StatusBadge status={task.status} />
                {isOverdue(task) && (
                  <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, background: "#FEE2E2", color: "#DC2626" }}>
                    ⚠ Quá hạn
                  </span>
                )}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#111827", lineHeight: 1.4, wordBreak: "break-word" }}>
                {task.title}
              </div>
            </div>
            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
              {isManager && (
                <button onClick={() => setEditMode(e => !e)} title="Sửa task"
                  style={{ padding: "5px 10px", border: "1px solid #E5E7EB", borderRadius: 6, background: editMode ? "#EFF6FF" : "#fff", color: editMode ? "#3B82F6" : "#6B7280", fontSize: 12, cursor: "pointer" }}>
                  ✏️
                </button>
              )}
              {isManager && (
                <button onClick={() => setConfirmDelete(true)} title="Xóa task"
                  style={{ padding: "5px 10px", border: "1px solid #FEE2E2", borderRadius: 6, background: "#fff", color: "#EF4444", fontSize: 12, cursor: "pointer" }}>
                  🗑
                </button>
              )}
              <button onClick={onClose}
                style={{ padding: "5px 10px", border: "1px solid #E5E7EB", borderRadius: 6, background: "#fff", color: "#9CA3AF", fontSize: 16, cursor: "pointer", lineHeight: 1 }}>
                ×
              </button>
            </div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Edit form */}
            {editMode && isManager && (
              <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#1D4ED8", marginBottom: 2 }}>CHỈNH SỬA TASK</div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "#6B7280", display: "block", marginBottom: 3 }}>Tiêu đề</label>
                  <input style={inp} value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: "#6B7280", display: "block", marginBottom: 3 }}>Loại</label>
                    <select style={inp} value={editForm.type} onChange={e => setEditForm(f => ({ ...f, type: e.target.value as any }))}>
                      <option value="ads_camp">Chạy Ads</option>
                      <option value="content_post">Nội dung</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: "#6B7280", display: "block", marginBottom: 3 }}>Deadline</label>
                    <input type="date" style={inp} value={editForm.deadline} onChange={e => setEditForm(f => ({ ...f, deadline: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "#6B7280", display: "block", marginBottom: 3 }}>Giao cho</label>
                  <select style={inp} value={editForm.assignee_id} onChange={e => setEditForm(f => ({ ...f, assignee_id: e.target.value }))}>
                    {mktUsers.map(u => <option key={u.email} value={u.email}>{u.name}</option>)}
                  </select>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={saveEdit} disabled={saving}
                    style={{ flex: 1, padding: "7px", border: "none", borderRadius: 6, background: "#2563EB", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    {saving ? "Đang lưu..." : "Lưu thay đổi"}
                  </button>
                  <button onClick={() => setEditMode(false)}
                    style={{ padding: "7px 14px", border: "1px solid #BFDBFE", borderRadius: 6, background: "#fff", color: "#6B7280", fontSize: 12, cursor: "pointer" }}>
                    Hủy
                  </button>
                </div>
              </div>
            )}

            {/* Meta info */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ background: "#F9FAFB", borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 600, marginBottom: 4 }}>NGƯỜI NHẬN</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>👤 {task.assignee_name}</div>
              </div>
              <div style={{ background: "#F9FAFB", borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 600, marginBottom: 4 }}>DEADLINE</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: isOverdue(task) ? "#DC2626" : "#374151" }}>
                  📅 {fmtFull(task.deadline)}
                  {(() => {
                    const d = daysUntil(task.deadline)
                    if (d === null || task.status === "done" || task.status === "cancelled") return null
                    if (d < 0) return <span style={{ fontSize: 11, color: "#DC2626", marginLeft: 4 }}>({Math.abs(d)}d trễ)</span>
                    if (d <= 2) return <span style={{ fontSize: 11, color: "#D97706", marginLeft: 4 }}>({d}d còn)</span>
                    return null
                  })()}
                </div>
              </div>
            </div>

            {/* Status */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", letterSpacing: "0.05em", marginBottom: 8 }}>TRẠNG THÁI</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {STATUSES.map(s => (
                  <button key={s} onClick={() => updateStatus(s)}
                    style={{
                      padding: "6px 14px", borderRadius: 8, border: "1.5px solid",
                      fontSize: 12, fontWeight: 600, cursor: "pointer",
                      background: task.status === s ? STATUS_MAP[s].color : "#fff",
                      color: task.status === s ? "#fff" : STATUS_MAP[s].color,
                      borderColor: STATUS_MAP[s].color,
                      transition: "all 0.15s",
                      boxShadow: task.status === s ? `0 2px 8px ${STATUS_MAP[s].color}40` : "none",
                    }}>
                    {STATUS_MAP[s].icon} {STATUS_MAP[s].label}
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", letterSpacing: "0.05em", marginBottom: 8 }}>GHI CHÚ / YÊU CẦU</div>
              <textarea
                value={notes}
                onChange={e => { setNotes(e.target.value); setNotesDirty(true) }}
                disabled={!isManager}
                rows={3}
                style={{
                  width: "100%", border: `1px solid ${notesDirty ? "#3B82F6" : "#E5E7EB"}`, borderRadius: 6,
                  padding: "8px 10px", fontSize: 13, resize: "vertical",
                  background: isManager ? "#fff" : "#F9FAFB", color: "#374151",
                  boxSizing: "border-box", transition: "border-color 0.2s",
                }}
                placeholder={isManager ? "Thêm mô tả, yêu cầu chi tiết..." : "(Chưa có ghi chú)"}
              />
              {isManager && notesDirty && (
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  <button onClick={saveNotes} disabled={saving}
                    style={{ padding: "5px 14px", borderRadius: 6, border: "none", background: "#3B82F6", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    {saving ? "Đang lưu..." : "Lưu ghi chú"}
                  </button>
                  <button onClick={() => { setNotes(initialTask.notes || ""); setNotesDirty(false) }}
                    style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid #E5E7EB", background: "#fff", color: "#6B7280", fontSize: 12, cursor: "pointer" }}>
                    Hủy
                  </button>
                </div>
              )}
            </div>

            {/* Rating */}
            {(isManager && task.status === "done") && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", letterSpacing: "0.05em", marginBottom: 8 }}>ĐÁNH GIÁ CHẤT LƯỢNG</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Stars value={task.rating} onChange={rateTask} />
                  {task.rating ? (
                    <span style={{ fontSize: 12, color: "#F59E0B", fontWeight: 700 }}>{task.rating}/5</span>
                  ) : (
                    <span style={{ fontSize: 12, color: "#D1D5DB" }}>Chưa đánh giá</span>
                  )}
                </div>
              </div>
            )}
            {(!isManager && task.rating) && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", letterSpacing: "0.05em", marginBottom: 8 }}>ĐÁNH GIÁ</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Stars value={task.rating} />
                  <span style={{ fontSize: 12, color: "#F59E0B", fontWeight: 700 }}>{task.rating}/5</span>
                </div>
              </div>
            )}

            {/* Comments */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", letterSpacing: "0.05em", marginBottom: 8 }}>
                TRAO ĐỔI ({comments.length})
              </div>
              <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, marginBottom: 10, paddingRight: 2 }}>
                {comments.length === 0 && (
                  <div style={{ fontSize: 12, color: "#D1D5DB", textAlign: "center", padding: "12px 0" }}>
                    💬 Chưa có trao đổi nào
                  </div>
                )}
                {comments.map((c, i) => {
                  const isMe = c.author_id === currentUserEmail
                  return (
                    <div key={i} style={{
                      display: "flex", flexDirection: "column",
                      alignItems: isMe ? "flex-end" : "flex-start",
                    }}>
                      <div style={{
                        maxWidth: "85%", background: isMe ? "#EFF6FF" : "#F9FAFB",
                        border: `1px solid ${isMe ? "#BFDBFE" : "#F3F4F6"}`,
                        borderRadius: isMe ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                        padding: "8px 12px",
                      }}>
                        <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 3 }}>
                          <strong style={{ color: isMe ? "#1D4ED8" : "#374151" }}>
                            {resolveAuthorName(c.author_id, mktUsers, currentUserEmail)}
                          </strong>
                          {" · "}{new Date(c.created_at).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
                        </div>
                        <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.4 }}>{c.text}</div>
                      </div>
                    </div>
                  )
                })}
                <div ref={commentsEndRef} />
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
                <textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendComment() } }}
                  rows={2}
                  placeholder="Nhắn tin... (Enter gửi, Shift+Enter xuống dòng)"
                  style={{
                    flex: 1, border: "1px solid #E5E7EB", borderRadius: 8,
                    padding: "8px 10px", fontSize: 13, resize: "none",
                    transition: "border-color 0.2s",
                  }}
                  onFocus={e => e.target.style.borderColor = "#3B82F6"}
                  onBlur={e => e.target.style.borderColor = "#E5E7EB"}
                />
                <button onClick={sendComment} disabled={commentSaving || !comment.trim()}
                  style={{
                    padding: "8px 14px", borderRadius: 8, border: "none",
                    background: comment.trim() ? "#3B82F6" : "#E5E7EB",
                    color: comment.trim() ? "#fff" : "#9CA3AF",
                    fontSize: 13, cursor: comment.trim() ? "pointer" : "default",
                    fontWeight: 600, transition: "all 0.15s",
                    alignSelf: "flex-end",
                  }}>
                  {commentSaving ? "..." : "↑"}
                </button>
              </div>
            </div>

            {/* Created */}
            <div style={{ fontSize: 11, color: "#D1D5DB", paddingTop: 4 }}>
              Tạo lúc {new Date(task.created_at).toLocaleString("vi-VN")}
            </div>
          </div>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          msg={`Xóa task "${task.title}"? Hành động này không thể hoàn tác.`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
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

  const inp: React.CSSProperties = { width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, boxSizing: "border-box" }
  const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#6B7280", display: "block", marginBottom: 4 }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: 500, maxWidth: "95vw", boxShadow: "0 24px 64px rgba(0,0,0,0.2)" }}>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 20, color: "#111827" }}>📋 Tạo task mới</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={lbl}>Tiêu đề <span style={{ color: "#EF4444" }}>*</span></label>
            <input style={inp} placeholder="VD: Camp chuyển đổi tháng 6" value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              onKeyDown={e => e.key === "Enter" && submit()} autoFocus />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={lbl}>Loại task <span style={{ color: "#EF4444" }}>*</span></label>
              <select style={inp} value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                <option value="ads_camp">📢 Chạy Ads / Camp</option>
                <option value="content_post">✍️ Nội dung / Bài đăng</option>
              </select>
            </div>
            <div>
              <label style={lbl}>Deadline</label>
              <input type="date" style={inp} value={form.deadline} onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} />
            </div>
          </div>
          <div>
            <label style={lbl}>Giao cho <span style={{ color: "#EF4444" }}>*</span></label>
            <select style={inp} value={form.assignee_id} onChange={e => setForm(f => ({ ...f, assignee_id: e.target.value }))}>
              <option value="">-- Chọn thành viên --</option>
              {users.map(u => <option key={u.email} value={u.email}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Ghi chú / Yêu cầu</label>
            <textarea rows={3} style={{ ...inp, resize: "vertical" }} placeholder="Mô tả chi tiết công việc..."
              value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          {err && <div style={{ color: "#EF4444", fontSize: 12, background: "#FEF2F2", padding: "8px 12px", borderRadius: 6 }}>{err}</div>}
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
          <button onClick={onClose} style={{ padding: "9px 18px", border: "1px solid #E5E7EB", borderRadius: 8, background: "#fff", fontSize: 13, cursor: "pointer" }}>Hủy</button>
          <button onClick={submit} disabled={saving}
            style={{ padding: "9px 20px", border: "none", borderRadius: 8, background: "#3B82F6", color: "#fff", fontSize: 13, cursor: "pointer", fontWeight: 700 }}>
            {saving ? "Đang tạo..." : "✓ Tạo task"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Task Row ─────────────────────────────────────────────────────────────────

function TaskRow({ task, onClick }: { task: Task; onClick: () => void }) {
  const overdue = isOverdue(task)
  const days = daysUntil(task.deadline)
  return (
    <div onClick={onClick} style={{
      display: "grid", gridTemplateColumns: "1fr 100px 110px 90px 120px 80px",
      alignItems: "center", padding: "11px 14px", cursor: "pointer",
      borderBottom: "1px solid #F3F4F6", gap: 8,
      background: overdue ? "#FFFBF5" : "#fff",
      transition: "background 0.1s",
    }}
      onMouseEnter={e => (e.currentTarget.style.background = overdue ? "#FEF3C7" : "#F9FAFB")}
      onMouseLeave={e => (e.currentTarget.style.background = overdue ? "#FFFBF5" : "#fff")}
    >
      {/* Title */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
        <span style={{ fontSize: 13, flexShrink: 0, color: STATUS_MAP[task.status]?.color || "#9CA3AF" }}>
          {STATUS_MAP[task.status]?.icon || "☐"}
        </span>
        <span style={{
          fontSize: 13, fontWeight: 500, color: task.status === "cancelled" ? "#9CA3AF" : "#111827",
          textDecoration: task.status === "cancelled" ? "line-through" : undefined,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{task.title}</span>
        {task.comments?.length > 0 && (
          <span style={{ fontSize: 11, color: "#9CA3AF", flexShrink: 0 }}>💬{task.comments.length}</span>
        )}
      </div>

      {/* Type */}
      <div><TypeBadge type={task.type} /></div>

      {/* Assignee */}
      <div style={{ fontSize: 12, color: "#6B7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {task.assignee_name}
      </div>

      {/* Deadline */}
      <div><DeadlineChip task={task} /></div>

      {/* Status */}
      <div><StatusBadge status={task.status} /></div>

      {/* Rating */}
      <div>
        {task.rating ? <Stars value={task.rating} /> : <span style={{ color: "#E5E7EB", fontSize: 13 }}>☆☆☆☆☆</span>}
      </div>
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
  const overdue = tasks.filter(t => isOverdue(t)).length
  const pct = tasks.length > 0 ? Math.round(done / tasks.length * 100) : 0

  return (
    <div style={{ marginBottom: 10, borderRadius: 8, overflow: "hidden", border: "1px solid #E5E7EB" }}>
      <div onClick={() => setOpen(o => !o)} style={{
        display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
        background: "#F9FAFB", cursor: "pointer",
        borderBottom: open ? "1px solid #E5E7EB" : "none",
      }}>
        <span style={{ fontSize: 11, color: "#9CA3AF", width: 12 }}>{open ? "▼" : "▶"}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#374151", flex: 1 }}>{label}</span>
        {overdue > 0 && (
          <span style={{ fontSize: 11, fontWeight: 600, color: "#DC2626", background: "#FEE2E2", padding: "1px 7px", borderRadius: 10 }}>
            ⚠ {overdue} quá hạn
          </span>
        )}
        <span style={{ fontSize: 11, color: "#9CA3AF" }}>{done}/{tasks.length}</span>
        {/* Progress bar */}
        <div style={{ width: 60, height: 4, background: "#E5E7EB", borderRadius: 2, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: pct === 100 ? "#10B981" : "#3B82F6", transition: "width 0.3s" }} />
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: pct === 100 ? "#10B981" : "#6B7280", minWidth: 30 }}>{pct}%</span>
      </div>
      {open && (
        <div>
          {/* Column headers */}
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 100px 110px 90px 120px 80px",
            padding: "5px 14px", gap: 8,
            fontSize: 10, fontWeight: 700, color: "#C4C9D4", letterSpacing: "0.06em",
            borderBottom: "1px solid #F3F4F6",
          }}>
            <div>TIÊU ĐỀ</div><div>LOẠI</div><div>NGƯỜI NHẬN</div><div>DEADLINE</div><div>TRẠNG THÁI</div><div>ĐÁNH GIÁ</div>
          </div>
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

  const th: React.CSSProperties = { padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6B7280", background: "#F9FAFB", borderBottom: "2px solid #E5E7EB" }
  const td: React.CSSProperties = { padding: "11px 14px", fontSize: 13, borderBottom: "1px solid #F3F4F6" }

  if (loading) return (
    <div style={{ padding: 48, textAlign: "center", color: "#9CA3AF" }}>
      <div style={{ fontSize: 24, marginBottom: 8 }}>⏳</div>
      Đang tải báo cáo...
    </div>
  )

  const totalDone = stats.reduce((s, m) => s + m.done, 0)
  const totalTasks = stats.reduce((s, m) => s + m.total, 0)
  const overallRate = totalTasks > 0 ? Math.round(totalDone / totalTasks * 100) : 0

  return (
    <div>
      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Tổng task", value: totalTasks, color: "#6B7280", icon: "📋" },
          { label: "Hoàn thành", value: totalDone, color: "#10B981", icon: "✅" },
          { label: "Tỷ lệ hoàn thành", value: `${overallRate}%`, color: overallRate >= 70 ? "#10B981" : "#F59E0B", icon: "📊" },
        ].map(c => (
          <div key={c.label} style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontSize: 20 }}>{c.icon}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: c.color, marginTop: 4 }}>{c.value}</div>
            <div style={{ fontSize: 12, color: "#9CA3AF", marginTop: 2 }}>{c.label}</div>
          </div>
        ))}
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: 8, overflow: "hidden", border: "1px solid #E5E7EB" }}>
        <thead>
          <tr>
            <th style={th}>Thành viên</th>
            <th style={{ ...th, textAlign: "center" }}>Tổng</th>
            <th style={{ ...th, textAlign: "center" }}>Đang làm</th>
            <th style={{ ...th, textAlign: "center" }}>Hoàn thành</th>
            <th style={{ ...th, textAlign: "center" }}>Quá hạn</th>
            <th style={{ ...th, textAlign: "center" }}>Đúng hạn</th>
            <th style={{ ...th, textAlign: "center" }}>Đánh giá TB</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s: any) => (
            <tr key={s.assignee_id}>
              <td style={td}>
                <div style={{ fontWeight: 700, color: "#111827" }}>{s.assignee_name}</div>
                {/* Mini progress bar */}
                <div style={{ width: "100%", height: 3, background: "#F3F4F6", borderRadius: 2, marginTop: 4, overflow: "hidden" }}>
                  <div style={{ width: `${s.done_rate}%`, height: "100%", background: s.done_rate >= 70 ? "#10B981" : "#3B82F6" }} />
                </div>
              </td>
              <td style={{ ...td, textAlign: "center", fontWeight: 600 }}>{s.total}</td>
              <td style={{ ...td, textAlign: "center" }}><span style={{ color: "#3B82F6", fontWeight: 700 }}>{s.in_progress}</span></td>
              <td style={{ ...td, textAlign: "center" }}>
                <span style={{ color: "#10B981", fontWeight: 700 }}>{s.done}</span>
                <span style={{ color: "#9CA3AF", fontSize: 11 }}> ({s.done_rate}%)</span>
              </td>
              <td style={{ ...td, textAlign: "center" }}>
                {(s.in_progress_overdue || 0) > 0
                  ? <span style={{ color: "#DC2626", fontWeight: 700 }}>{s.in_progress_overdue}</span>
                  : <span style={{ color: "#D1D5DB" }}>—</span>}
              </td>
              <td style={{ ...td, textAlign: "center" }}>
                <span style={{ color: s.on_time_rate >= 80 ? "#10B981" : "#F59E0B", fontWeight: 700 }}>{s.on_time_rate}%</span>
              </td>
              <td style={{ ...td, textAlign: "center" }}>
                {s.avg_rating
                  ? <><Stars value={Math.round(s.avg_rating)} /><span style={{ fontSize: 11, color: "#9CA3AF", marginLeft: 4 }}>{s.avg_rating}</span></>
                  : <span style={{ color: "#D1D5DB" }}>—</span>}
              </td>
            </tr>
          ))}
          {stats.length === 0 && (
            <tr><td colSpan={7} style={{ ...td, textAlign: "center", color: "#9CA3AF", padding: 32 }}>Chưa có dữ liệu thống kê</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MktTasksPage() {
  const { has, isSuper } = useCurrentPermissions()
  const isManager = isSuper || has("page.mkt-tasks.manage")

  const [tab, setTab] = useState<"tasks" | "stats">("tasks")
  const [groupBy, setGroupBy] = useState<"assignee" | "type" | "week">("assignee")
  const [filterStatus, setFilterStatus] = useState("all")
  const [filterType, setFilterType] = useState("")
  const [search, setSearch] = useState("")
  const [groups, setGroups] = useState<Record<string, Task[]>>({})
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [mktUsers, setMktUsers] = useState<MktUser[]>([])
  const [currentUserEmail, setCurrentUserEmail] = useState("")
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null)

  const showToast = (msg: string, type: "success" | "error") => setToast({ msg, type })

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
    apiFetch("/admin/permissions/me").then(r => r.json()).then(d => setCurrentUserEmail(d.user?.email || ""))
  }, [])

  // Apply search filter client-side
  const filteredGroups = search.trim()
    ? Object.fromEntries(
        Object.entries(groups).map(([k, tasks]) => [
          k,
          tasks.filter(t => t.title.toLowerCase().includes(search.toLowerCase()) || t.assignee_name.toLowerCase().includes(search.toLowerCase()))
        ]).filter(([, tasks]) => tasks.length > 0)
      )
    : groups

  const totalTasks = Object.values(groups).flat().length
  const overdueCount = Object.values(groups).flat().filter(isOverdue).length

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "7px 16px", borderRadius: 6, border: "none",
    background: active ? "#3B82F6" : "transparent",
    color: active ? "#fff" : "#6B7280",
    fontSize: 13, fontWeight: 600, cursor: "pointer",
    transition: "all 0.15s",
  })

  const chipStyle = (active: boolean, color?: string): React.CSSProperties => ({
    padding: "4px 12px", borderRadius: 12,
    border: `1.5px solid ${active ? (color || "#3B82F6") : "#E5E7EB"}`,
    background: active ? (color || "#3B82F6") + "15" : "#fff",
    color: active ? (color || "#3B82F6") : "#6B7280",
    fontSize: 12, fontWeight: 600, cursor: "pointer",
    transition: "all 0.15s",
  })

  return (
    <div style={{ padding: 24, maxWidth: 1140, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: "#111827" }}>📋 Giao Việc MKT</h1>
          <div style={{ fontSize: 13, color: "#9CA3AF", marginTop: 3, display: "flex", gap: 10 }}>
            <span>{totalTasks} task</span>
            {overdueCount > 0 && <span style={{ color: "#DC2626", fontWeight: 600 }}>⚠ {overdueCount} quá hạn</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {isManager && (
            <button style={{
              padding: "8px 18px", border: "none", borderRadius: 8,
              background: "#3B82F6", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
              boxShadow: "0 2px 8px rgba(59,130,246,0.35)",
            }} onClick={() => setShowCreate(true)}>
              + Tạo task
            </button>
          )}
          {isManager && (
            <div style={{ display: "flex", gap: 2, background: "#F3F4F6", borderRadius: 8, padding: 3 }}>
              {(["tasks", "stats"] as const).map(t => (
                <button key={t} onClick={() => setTab(t)} style={tabStyle(tab === t)}>
                  {t === "tasks" ? "📋 Danh sách" : "📊 Báo cáo"}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {tab === "stats" ? <StatsTab /> : (
        <>
          {/* Toolbar */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
            {/* Search */}
            <div style={{ position: "relative", flex: "1 1 180px", maxWidth: 280 }}>
              <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#9CA3AF", fontSize: 14 }}>🔍</span>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Tìm task..."
                style={{
                  width: "100%", border: "1px solid #E5E7EB", borderRadius: 8,
                  padding: "7px 10px 7px 30px", fontSize: 13,
                  boxSizing: "border-box", outline: "none",
                }}
              />
              {search && (
                <button onClick={() => setSearch("")} style={{
                  position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                  background: "none", border: "none", color: "#9CA3AF", cursor: "pointer", fontSize: 14,
                }}>×</button>
              )}
            </div>

            {/* Group-by (manager only) */}
            {isManager && (
              <div style={{ display: "flex", gap: 2, background: "#F3F4F6", borderRadius: 8, padding: 3 }}>
                {[
                  { v: "assignee", l: "Theo người" },
                  { v: "type",     l: "Theo loại" },
                  { v: "week",     l: "Theo tuần" },
                ].map(({ v, l }) => (
                  <button key={v} onClick={() => setGroupBy(v as any)} style={tabStyle(groupBy === v)}>{l}</button>
                ))}
              </div>
            )}

            {/* Status filter */}
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {[
                { v: "all",         l: "Tất cả",      c: undefined },
                { v: "todo",        l: "Chờ làm",      c: "#6B7280" },
                { v: "in_progress", l: "Đang làm",     c: "#3B82F6" },
                { v: "done",        l: "Hoàn thành",   c: "#10B981" },
                { v: "cancelled",   l: "Đã hủy",       c: "#EF4444" },
              ].map(({ v, l, c }) => (
                <button key={v} onClick={() => setFilterStatus(v)} style={chipStyle(filterStatus === v, c)}>{l}</button>
              ))}
            </div>

            {/* Type filter */}
            <select
              value={filterType}
              onChange={e => setFilterType(e.target.value)}
              style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 12, color: "#6B7280", cursor: "pointer" }}
            >
              <option value="">Mọi loại</option>
              <option value="ads_camp">📢 Chạy Ads</option>
              <option value="content_post">✍️ Nội dung</option>
            </select>
          </div>

          {/* Task list */}
          {loading ? (
            <div style={{ textAlign: "center", padding: 60, color: "#9CA3AF" }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>⏳</div>
              Đang tải...
            </div>
          ) : Object.entries(filteredGroups).length === 0 ? (
            <div style={{ textAlign: "center", padding: 60, color: "#9CA3AF" }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>📭</div>
              {search ? `Không tìm thấy task nào với "${search}"` : "Không có task nào"}
            </div>
          ) : (
            Object.entries(filteredGroups).map(([label, tasks]) => (
              <GroupedSection key={label} label={label} tasks={tasks} onTaskClick={setSelectedTask} />
            ))
          )}
        </>
      )}

      {/* Modals */}
      {showCreate && (
        <CreateTaskModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { load(); showToast("Đã tạo task mới!", "success") }}
          users={mktUsers}
        />
      )}
      {selectedTask && (
        <TaskDrawer
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          isManager={isManager}
          currentUserEmail={currentUserEmail}
          mktUsers={mktUsers}
          onUpdate={(reload = true) => { if (reload) load() }}
          onDelete={() => { load() }}
          onToast={showToast}
        />
      )}
      {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Giao Việc MKT",
})
