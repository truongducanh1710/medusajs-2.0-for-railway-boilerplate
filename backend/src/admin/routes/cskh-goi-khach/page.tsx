import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useState, useEffect, useCallback, useMemo } from "react"
import { apiFetch } from "../../lib/api-client"
import { useCurrentPermissions } from "../../lib/use-permissions"

// ─── Types ───────────────────────────────────────────────────────────────────

type Task = {
  id: string
  title: string
  type: string
  assignee_id: string
  assignee_name: string
  status: "todo" | "in_progress" | "pending_review" | "done" | "cancelled" | "missed"
  priority: "high" | "medium" | "low"
  deadline: string | null
  rating: number | null
  result: string | null
  notes: string | null
  customer_name: string | null
  customer_phone: string | null
  pancake_order_id: string | null
  call_stage: string | null
  created_at: string
}

type SourceCustomer = {
  customer_phone: string
  customer_name: string
  order_ids: string[]
  order_count: number
  latest_order_at: string
  matched_items: string[]
  already_has_task: boolean
}

type MktUser = { id?: string; email: string; name: string }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ")
}
function fmt(d: string | null) {
  if (!d) return "—"
  const dt = new Date(d)
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}`
}

const CALL_STAGES: { value: string; label: string; icon: string; chip: string }[] = [
  { value: "chua_goi",          label: "Chưa gọi",             icon: "🔴", chip: "bg-rose-50 text-rose-600 ring-1 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30" },
  { value: "da_goi_hai_long",   label: "Đã gọi - Hài lòng",    icon: "✅", chip: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30" },
  { value: "da_goi_co_gop_y",   label: "Đã gọi - Có góp ý",    icon: "💬", chip: "bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30" },
  { value: "khong_nghe_may",    label: "Không nghe máy",       icon: "⚠️", chip: "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30" },
  { value: "hen_goi_lai",       label: "Hẹn gọi lại",          icon: "🟡", chip: "bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200 dark:bg-yellow-500/15 dark:text-yellow-300 dark:ring-yellow-500/30" },
  { value: "tu_choi",           label: "Từ chối nghe tư vấn",  icon: "✕", chip: "bg-ui-bg-component text-ui-fg-muted ring-1 ring-ui-border-base" },
]
const CALL_STAGE_MAP = Object.fromEntries(CALL_STAGES.map(s => [s.value, s]))

function Stars({ value, onChange }: { value: number | null; onChange?: (v: number) => void }) {
  const [hover, setHover] = useState(0)
  return (
    <span className="inline-flex gap-px">
      {[1, 2, 3, 4, 5].map(i => (
        <span key={i}
          onClick={onChange ? (e) => { e.stopPropagation(); onChange(i) } : undefined}
          onMouseEnter={onChange ? () => setHover(i) : undefined}
          onMouseLeave={onChange ? () => setHover(0) : undefined}
          className={cn("text-base leading-none transition-colors duration-100", onChange && "cursor-pointer",
            (hover || value || 0) >= i ? "text-amber-400" : "text-ui-fg-disabled")}
        >★</span>
      ))}
    </span>
  )
}

function Toast({ msg, type, onDone }: { msg: string; type: "success" | "error"; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 2800); return () => clearTimeout(t) }, [])
  return (
    <div className={cn("fixed bottom-6 right-6 z-[9999] flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold text-white shadow-lg",
      type === "success" ? "bg-emerald-600" : "bg-rose-600")}>
      <span>{type === "success" ? "✓" : "✕"}</span>{msg}
    </div>
  )
}

function CallStageSelect({ value, disabled, onChange }: { value: string | null; disabled: boolean; onChange: (v: string) => void }) {
  const cur = value ? CALL_STAGE_MAP[value] : null
  return (
    <select
      value={value || "chua_goi"}
      disabled={disabled}
      onClick={e => e.stopPropagation()}
      onChange={e => { e.stopPropagation(); onChange(e.target.value) }}
      title={disabled ? "Bạn không phải người phụ trách" : "Đổi giai đoạn gọi"}
      className={cn("max-w-[170px] cursor-pointer truncate rounded-full border-0 px-2 py-0.5 text-[11px] font-semibold outline-none",
        cur?.chip || "bg-ui-bg-component text-ui-fg-subtle", disabled && "cursor-not-allowed opacity-70")}>
      {CALL_STAGES.map(s => <option key={s.value} value={s.value} className="bg-white text-gray-800">{s.icon} {s.label}</option>)}
    </select>
  )
}

// ─── Bulk create modal ───────────────────────────────────────────────────────

function BulkCreateModal({ users, onClose, onCreated, onToast }: {
  users: MktUser[]
  onClose: () => void
  onCreated: () => void
  onToast: (msg: string, type: "success" | "error") => void
}) {
  const [keyword, setKeyword] = useState("chảo vàng")
  const [days, setDays] = useState(30)
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<SourceCustomer[] | null>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [mergeOrders, setMergeOrders] = useState(true)
  const [mode, setMode] = useState<"manual" | "round_robin">("round_robin")
  const [rrAssignees, setRrAssignees] = useState<Record<string, boolean>>({})
  const [manualAssignee, setManualAssignee] = useState<Record<string, string>>({})
  const [deadline, setDeadline] = useState("")
  const [priority, setPriority] = useState<"high" | "medium" | "low">("medium")
  const [notes, setNotes] = useState("Hỏi thăm trải nghiệm sử dụng sản phẩm, xin đánh giá 5 sao")
  const [creating, setCreating] = useState(false)

  const search = useCallback(async () => {
    setSearching(true)
    try {
      const r = await apiFetch(`/admin/mkt-tasks/cskh-source?keyword=${encodeURIComponent(keyword)}&days=${days}&limit=200`)
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error || "Lỗi tìm khách hàng")
      const customers: SourceCustomer[] = d.customers || []
      setResults(customers)
      const sel: Record<string, boolean> = {}
      for (const c of customers) sel[c.customer_phone] = !c.already_has_task
      setSelected(sel)
    } catch (e: any) {
      onToast(e?.message || "Lỗi tìm khách hàng", "error")
    } finally { setSearching(false) }
  }, [keyword, days])

  const selectedCustomers = useMemo(() => (results || []).filter(c => selected[c.customer_phone]), [results, selected])
  const selectedCount = selectedCustomers.length
  const rrList = Object.keys(rrAssignees).filter(k => rrAssignees[k])

  const canCreate = selectedCount > 0 && (mode === "round_robin" ? rrList.length > 0 : selectedCustomers.every(c => manualAssignee[c.customer_phone]))

  async function create() {
    if (!canCreate) return
    setCreating(true)
    try {
      const body: any = {
        customers: selectedCustomers.map(c => ({ customer_phone: c.customer_phone, customer_name: c.customer_name, order_ids: c.order_ids })),
        assignment_mode: mode,
        merge_orders: mergeOrders,
        deadline: deadline || null,
        priority,
        notes: notes || null,
      }
      if (mode === "round_robin") body.assignee_ids = rrList
      else body.assignee_map = manualAssignee

      const r = await apiFetch("/admin/mkt-tasks/cskh-call/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error || "Lỗi tạo việc")
      onToast(`Đã tạo ${d.created?.length || 0} việc${d.skipped?.length ? `, bỏ qua ${d.skipped.length} (đã có việc)` : ""}`, "success")
      onCreated()
      onClose()
    } catch (e: any) {
      onToast(e?.message || "Lỗi tạo việc", "error")
    } finally { setCreating(false) }
  }

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-ui-bg-base p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-ui-fg-base">Tạo việc gọi CSKH hàng loạt</h2>
          <button onClick={onClose} className="text-ui-fg-muted hover:text-ui-fg-base">✕</button>
        </div>

        {/* Bước 1 */}
        <div className="mb-5">
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ui-fg-subtle">Bước 1 · Tìm khách hàng</div>
          <div className="flex gap-2">
            <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="Từ khóa sản phẩm"
              className="flex-1 rounded-lg border border-ui-border-base bg-ui-bg-field px-3 py-1.5 text-[13px] outline-none focus:ring-1 focus:ring-ui-border-interactive" />
            <select value={days} onChange={e => setDays(Number(e.target.value))} className="rounded-lg border border-ui-border-base bg-ui-bg-field px-2 py-1.5 text-[13px]">
              {[7, 14, 30, 60, 90].map(d => <option key={d} value={d}>{d} ngày</option>)}
            </select>
            <button onClick={search} disabled={searching || !keyword.trim()}
              className="rounded-lg bg-ui-button-inverted px-4 py-1.5 text-[13px] font-semibold text-ui-fg-on-inverted disabled:opacity-50">
              {searching ? "Đang tìm..." : "🔍 Tìm"}
            </button>
          </div>
        </div>

        {/* Bước 2 */}
        {results && (
          <div className="mb-5">
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ui-fg-subtle">
              Bước 2 · Chọn khách hàng ({results.length} kết quả, đã chọn {selectedCount})
            </div>
            {results.length === 0 ? (
              <div className="rounded-lg bg-ui-bg-subtle px-3 py-4 text-center text-[13px] text-ui-fg-muted">Không tìm thấy khách hàng nào</div>
            ) : (
              <div className="max-h-64 overflow-y-auto rounded-lg border border-ui-border-base">
                {results.map(c => (
                  <label key={c.customer_phone} className="flex cursor-pointer items-center gap-2 border-b border-ui-border-base px-3 py-1.5 text-[12px] last:border-0 hover:bg-ui-bg-subtle-hover">
                    <input type="checkbox" checked={!!selected[c.customer_phone]}
                      onChange={e => setSelected(s => ({ ...s, [c.customer_phone]: e.target.checked }))} />
                    <span className="w-32 truncate font-medium">{c.customer_name || "—"}</span>
                    <span className="w-24 font-mono text-ui-fg-subtle">{c.customer_phone}</span>
                    <span className="w-14 text-ui-fg-subtle">{c.order_count} đơn</span>
                    <span className="w-14 text-ui-fg-subtle">{fmt(c.latest_order_at)}</span>
                    {c.already_has_task && <span className="ml-auto text-amber-600">⚠ đã có việc</span>}
                  </label>
                ))}
              </div>
            )}
            <label className="mt-2 flex items-center gap-2 text-[12px] text-ui-fg-subtle">
              <input type="checkbox" checked={mergeOrders} onChange={e => setMergeOrders(e.target.checked)} />
              Gộp nhiều đơn cùng khách thành 1 việc
            </label>
          </div>
        )}

        {/* Bước 3 */}
        {results && selectedCount > 0 && (
          <div className="mb-5">
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ui-fg-subtle">Bước 3 · Chia việc</div>
            <div className="mb-2 flex gap-4 text-[12px]">
              <label className="flex items-center gap-1.5"><input type="radio" checked={mode === "manual"} onChange={() => setMode("manual")} /> Chia tay từng khách</label>
              <label className="flex items-center gap-1.5"><input type="radio" checked={mode === "round_robin"} onChange={() => setMode("round_robin")} /> Chia đều — Round robin</label>
            </div>
            {mode === "round_robin" ? (
              <div className="flex flex-wrap gap-1.5">
                {users.map(u => (
                  <label key={u.email} className={cn("flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-[11px]",
                    rrAssignees[u.email] ? "border-ui-border-interactive bg-ui-bg-interactive text-ui-fg-on-inverted" : "border-ui-border-base text-ui-fg-subtle")}>
                    <input type="checkbox" className="hidden" checked={!!rrAssignees[u.email]} onChange={e => setRrAssignees(s => ({ ...s, [u.email]: e.target.checked }))} />
                    {u.name}
                  </label>
                ))}
              </div>
            ) : (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-ui-border-base">
                {selectedCustomers.map(c => (
                  <div key={c.customer_phone} className="flex items-center gap-2 border-b border-ui-border-base px-3 py-1.5 text-[12px] last:border-0">
                    <span className="w-32 truncate">{c.customer_name || c.customer_phone}</span>
                    <select value={manualAssignee[c.customer_phone] || ""} onChange={e => setManualAssignee(s => ({ ...s, [c.customer_phone]: e.target.value }))}
                      className="flex-1 rounded border border-ui-border-base bg-ui-bg-field px-2 py-0.5 text-[12px]">
                      <option value="">— Chọn người —</option>
                      {users.map(u => <option key={u.email} value={u.email}>{u.name}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Bước 4 */}
        {results && selectedCount > 0 && (
          <div className="mb-5">
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ui-fg-subtle">Bước 4 · Thiết lập chung</div>
            <div className="mb-2 flex gap-2">
              <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)}
                className="rounded-lg border border-ui-border-base bg-ui-bg-field px-2 py-1.5 text-[13px]" />
              <select value={priority} onChange={e => setPriority(e.target.value as any)}
                className="rounded-lg border border-ui-border-base bg-ui-bg-field px-2 py-1.5 text-[13px]">
                <option value="high">Ưu tiên Cao</option>
                <option value="medium">Ưu tiên Vừa</option>
                <option value="low">Ưu tiên Thấp</option>
              </select>
            </div>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full rounded-lg border border-ui-border-base bg-ui-bg-field px-3 py-1.5 text-[13px]" placeholder="Ghi chú chung" />
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-ui-border-base px-4 py-1.5 text-[13px] font-medium text-ui-fg-subtle">Hủy</button>
          {results && selectedCount > 0 && (
            <button onClick={create} disabled={!canCreate || creating}
              className="rounded-lg bg-ui-button-inverted px-4 py-1.5 text-[13px] font-semibold text-ui-fg-on-inverted disabled:opacity-50">
              {creating ? "Đang tạo..." : `Tạo ${selectedCount} việc${mode === "round_robin" && rrList.length ? ` cho ${rrList.length} người` : ""}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Detail drawer ───────────────────────────────────────────────────────────

function DetailDrawer({ task, canRate, onClose, onPatch, onRate }: {
  task: Task
  canRate: boolean
  onClose: () => void
  onPatch: (fields: Record<string, any>) => void
  onRate: (rating: number) => void
}) {
  const [result, setResult] = useState(task.result || "")
  return (
    <div className="fixed inset-0 z-[9997] flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-ui-bg-base p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[15px] font-bold text-ui-fg-base">{task.title}</h3>
          <button onClick={onClose} className="text-ui-fg-muted hover:text-ui-fg-base">✕</button>
        </div>

        <div className="mb-4 space-y-1 rounded-lg bg-ui-bg-subtle p-3 text-[12px]">
          <div><span className="text-ui-fg-subtle">Khách hàng:</span> <b>{task.customer_name || "—"}</b></div>
          <div><span className="text-ui-fg-subtle">SĐT:</span> <a href={`tel:${task.customer_phone}`} className="font-mono text-blue-600">{task.customer_phone}</a></div>
          {task.pancake_order_id && (
            <div><span className="text-ui-fg-subtle">Đơn gốc:</span> <a href={`/app/pancake-orders/${task.pancake_order_id}`} className="text-blue-600 underline">{task.pancake_order_id}</a></div>
          )}
          <div><span className="text-ui-fg-subtle">Phụ trách:</span> {task.assignee_name}</div>
        </div>

        <div className="mb-4">
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ui-fg-subtle">Giai đoạn gọi</div>
          <div className="flex flex-wrap gap-1.5">
            {CALL_STAGES.map(s => {
              const active = (task.call_stage || "chua_goi") === s.value
              return (
                <button key={s.value} onClick={() => onPatch({ call_stage: s.value })}
                  className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold transition",
                    active ? s.chip : "bg-ui-bg-component text-ui-fg-subtle hover:bg-ui-bg-base-hover")}>
                  {s.icon} {s.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="mb-4">
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ui-fg-subtle">Ghi chú kết quả cuộc gọi</div>
          <textarea value={result} onChange={e => setResult(e.target.value)}
            onBlur={() => { if (result !== (task.result || "")) onPatch({ result: result || null }) }}
            rows={3} placeholder="Nội dung góp ý / trao đổi với khách..."
            className="w-full rounded-lg border border-ui-border-base bg-ui-bg-field px-3 py-1.5 text-[13px]" />
        </div>

        {task.status === "done" && (
          <div className="mb-4">
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ui-fg-subtle">Đánh giá</div>
            {canRate ? <Stars value={task.rating} onChange={onRate} /> : <Stars value={task.rating} />}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function CskhGoiKhachPage() {
  const { has, isSuper, email } = useCurrentPermissions()
  const isManager = isSuper || has("page.mkt-tasks.manage")

  const [tab, setTab] = useState<"all" | "mine" | string>("all")
  const [search, setSearch] = useState("")
  const [tasks, setTasks] = useState<Task[]>([])
  const [users, setUsers] = useState<MktUser[]>([])
  const [loading, setLoading] = useState(false)
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null)
  const [view, setView] = useState<"list" | "stats">("list")
  const [stats, setStats] = useState<any[]>([])

  const onToast = useCallback((msg: string, type: "success" | "error") => setToast({ msg, type }), [])

  const loadTasks = useCallback(async () => {
    setLoading(true)
    try {
      let url = "/admin/mkt-tasks?type=cskh_call"
      // Non-manager: server tự lọc theo email của actor, "mine" không cần truyền gì thêm.
      // Manager xem "Của tôi": phải truyền đúng email của chính họ để lọc.
      if (tab === "mine" && isManager && email) url += `&assignee_id=${encodeURIComponent(email)}`
      const r = await apiFetch(url)
      const d = await r.json()
      setTasks(d.tasks || [])
    } finally { setLoading(false) }
  }, [tab, isManager, email])

  const loadUsers = useCallback(async () => {
    try {
      const r = await apiFetch("/admin/mkt-tasks/cskh-users")
      const d = await r.json()
      setUsers(d.users || [])
    } catch { /* optional */ }
  }, [])

  const loadStats = useCallback(async () => {
    const r = await apiFetch("/admin/mkt-tasks/stats?type=cskh_call")
    const d = await r.json()
    setStats(d.stats || [])
  }, [])

  useEffect(() => { loadTasks() }, [loadTasks])
  useEffect(() => { loadUsers() }, [loadUsers])
  useEffect(() => { if (view === "stats") loadStats() }, [view, loadStats])

  const filtered = useMemo(() => {
    let list = tasks
    if (tab !== "all" && tab !== "mine") list = list.filter(t => t.call_stage === tab)
    if (search.trim()) {
      const s = search.toLowerCase()
      list = list.filter(t => (t.customer_name || "").toLowerCase().includes(s) || (t.customer_phone || "").includes(s))
    }
    return list
  }, [tasks, tab, search])

  async function patchTask(id: string, fields: Record<string, any>) {
    try {
      const r = await apiFetch(`/admin/mkt-tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error || "Lỗi cập nhật")
      setTasks(prev => prev.map(t => t.id === id ? d.task : t))
      setSelectedTask(prev => prev && prev.id === id ? d.task : prev)
    } catch (e: any) {
      onToast(e?.message || "Lỗi cập nhật", "error")
    }
  }

  async function rateTask(id: string, rating: number) {
    try {
      const r = await apiFetch(`/admin/mkt-tasks/${id}/rate`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error || "Lỗi đánh giá")
      setTasks(prev => prev.map(t => t.id === id ? { ...t, rating } : t))
      setSelectedTask(prev => prev && prev.id === id ? { ...prev, rating } : prev)
      onToast("Đã đánh giá", "success")
    } catch (e: any) {
      onToast(e?.message || "Lỗi đánh giá", "error")
    }
  }

  return (
    <div className="p-0">
      {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
      {showBulkModal && (
        <BulkCreateModal users={users} onClose={() => setShowBulkModal(false)}
          onCreated={loadTasks} onToast={onToast} />
      )}
      {selectedTask && (
        <DetailDrawer task={selectedTask} canRate={isManager}
          onClose={() => setSelectedTask(null)}
          onPatch={fields => patchTask(selectedTask.id, fields)}
          onRate={rating => rateTask(selectedTask.id, rating)} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between border-b border-ui-border-base px-6 py-4">
        <div>
          <h1 className="text-lg font-bold text-ui-fg-base">📞 Gọi tư vấn CSKH — Khách mua chảo vàng</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setView(v => v === "list" ? "stats" : "list")}
            className="rounded-lg border border-ui-border-base px-3 py-1.5 text-[13px] font-medium text-ui-fg-subtle">
            {view === "list" ? "📊 Thống kê" : "📋 Danh sách"}
          </button>
          {isManager && (
            <button onClick={() => setShowBulkModal(true)}
              className="rounded-lg bg-ui-button-inverted px-3 py-1.5 text-[13px] font-semibold text-ui-fg-on-inverted">
              + Tạo việc từ danh sách khách hàng
            </button>
          )}
        </div>
      </div>

      {view === "list" ? (
        <>
          {/* Filter tabs */}
          <div className="flex items-center justify-between border-b border-ui-border-base px-6 py-2.5">
            <div className="flex flex-wrap gap-1.5">
              {[["all", "Tất cả"], ["mine", "Của tôi"], ...CALL_STAGES.map(s => [s.value, `${s.icon} ${s.label}`])].map(([v, label]) => (
                <button key={v} onClick={() => setTab(v)}
                  className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold",
                    tab === v ? "bg-ui-button-inverted text-ui-fg-on-inverted" : "bg-ui-bg-component text-ui-fg-subtle")}>
                  {label}
                </button>
              ))}
            </div>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Tìm SĐT/tên"
              className="w-48 rounded-lg border border-ui-border-base bg-ui-bg-field px-3 py-1.5 text-[12px]" />
          </div>

          {/* List */}
          <div className="px-6 py-3">
            {loading && <div className="py-10 text-center text-ui-fg-muted">Đang tải...</div>}
            {!loading && filtered.length === 0 && <div className="py-10 text-center text-ui-fg-muted">Không có việc nào</div>}
            {!loading && filtered.length > 0 && (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-ui-border-base text-left text-[11px] uppercase text-ui-fg-subtle">
                    <th className="py-2">Khách hàng</th>
                    <th className="py-2">SĐT</th>
                    <th className="py-2">Phụ trách</th>
                    <th className="py-2">Giai đoạn gọi</th>
                    <th className="py-2">★</th>
                    <th className="py-2">Hạn</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(t => (
                    <tr key={t.id} onClick={() => setSelectedTask(t)} className="cursor-pointer border-b border-ui-border-base last:border-0 hover:bg-ui-bg-subtle-hover">
                      <td className="py-2 font-medium">{t.customer_name || "—"}</td>
                      <td className="py-2 font-mono text-ui-fg-subtle">{t.customer_phone}</td>
                      <td className="py-2 text-ui-fg-subtle">👤 {t.assignee_name}</td>
                      <td className="py-2">
                        <CallStageSelect value={t.call_stage} disabled={false} onChange={v => patchTask(t.id, { call_stage: v })} />
                      </td>
                      <td className="py-2">{t.status === "done" ? <Stars value={t.rating} /> : "·"}</td>
                      <td className="py-2 text-ui-fg-subtle">{fmt(t.deadline)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        <div className="px-6 py-4">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-ui-border-base text-left text-[11px] uppercase text-ui-fg-subtle">
                <th className="py-2">Nhân viên</th>
                <th className="py-2">Tổng</th>
                <th className="py-2">Hoàn thành</th>
                <th className="py-2">Tỉ lệ xong</th>
                <th className="py-2">Đúng hạn</th>
                <th className="py-2">Đánh giá TB</th>
              </tr>
            </thead>
            <tbody>
              {stats.map(s => (
                <tr key={s.assignee_id} className="border-b border-ui-border-base last:border-0">
                  <td className="py-2 font-medium">{s.assignee_name}</td>
                  <td className="py-2">{s.total}</td>
                  <td className="py-2">{s.done}</td>
                  <td className="py-2">{s.done_rate}%</td>
                  <td className="py-2">{s.on_time_rate}%</td>
                  <td className="py-2">{s.avg_rating ? `${s.avg_rating} ★` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export const config = defineRouteConfig({ label: "CSKH Gọi khách" })
