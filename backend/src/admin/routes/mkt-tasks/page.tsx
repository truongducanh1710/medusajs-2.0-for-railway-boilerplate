import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { apiFetch } from "../../lib/api-client"
import { useCurrentPermissions } from "../../lib/use-permissions"

// ─── Types ───────────────────────────────────────────────────────────────────

type ChecklistItem = { id: string; text: string; done: boolean }

type Task = {
  id: string
  title: string
  type: "ads_camp" | "content_post" | "purchasing" | "cskh_call"
  import_lot_id?: string | null
  purchase_stage?: string | null
  pancake_order_id?: string | null
  customer_name?: string | null
  customer_phone?: string | null
  call_stage?: string | null
  assignee_id: string
  assignee_name: string
  created_by: string
  deadline: string | null
  planned_for?: string | null
  personal_order?: number | null
  status: "todo" | "in_progress" | "pending_review" | "done" | "cancelled" | "missed"
  priority: "high" | "medium" | "low"
  tags: string[]
  notes: string | null
  comments: { author_id: string; text: string; created_at: string }[]
  rating: number | null
  channel_id: string | null
  created_at: string
  updated_at: string
  // Recurring
  output?: string | null
  result?: string | null
  frequency?: "once" | "daily" | "weekly" | "monthly"
  is_template?: boolean
  template_id?: string | null
  period_key?: string | null
  checklist?: ChecklistItem[] | null
}

type MktUser = { id?: string; email: string; name: string }
type ViewMode = "myday" | "list" | "board" | "calendar" | "stats" | "guide"
type GroupBy = "assignee" | "type" | "week"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ")
}

function fmt(d: string | null) {
  if (!d) return "—"
  const dt = new Date(d)
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}`
}

function fmtFull(d: string | null) {
  if (!d) return "Chưa đặt"
  const dt = new Date(d)
  const date = dt.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Ho_Chi_Minh" })
  const time = dt.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" })
  return `${date} ${time}`
}

function isOverdue(t: Task) {
  if (!t.deadline || t.status === "done" || t.status === "cancelled" || t.status === "pending_review") return false
  return new Date(t.deadline) < new Date()
}

function isPersonalTask(t: Task) {
  return !!t.created_by && !!t.assignee_id && t.created_by.trim().toLowerCase() === t.assignee_id.trim().toLowerCase()
}

function vnDateKey(value: string | Date | null | undefined): string | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d)
  const get = (type: string) => parts.find(p => p.type === type)?.value || ""
  return `${get("year")}-${get("month")}-${get("day")}`
}

function addDaysKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00+07:00`)
  d.setDate(d.getDate() + days)
  return vnDateKey(d) || dateKey
}


function daysUntil(d: string | null): number | null {
  if (!d) return null
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000)
}

function resolveAuthorName(authorId: string, users: MktUser[], currentUserEmail: string): string {
  if (authorId === currentUserEmail) return "Bạn"
  const u = users.find(u => u.email === authorId || u.id === authorId)
  if (u) return u.name
  return authorId.includes("@") ? authorId.split("@")[0] : authorId.slice(0, 10)
}

function getWeekKey(d: Date): string {
  const onejan = new Date(d.getFullYear(), 0, 1)
  const week = Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7)
  return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`
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

// ─── Maps ────────────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, { label: string; icon: string; dot: string; chip: string }> = {
  todo:           { label: "Chờ làm",    icon: "☐", dot: "bg-gray-400",    chip: "bg-ui-bg-component text-ui-fg-subtle" },
  in_progress:    { label: "Đang làm",   icon: "◉", dot: "bg-blue-500",    chip: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300" },
  pending_review: { label: "Chờ duyệt",  icon: "⏳", dot: "bg-amber-400",  chip: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" },
  done:           { label: "Hoàn thành", icon: "✓", dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
  cancelled:      { label: "Đã hủy",     icon: "✕", dot: "bg-rose-400",    chip: "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300" },
  missed:         { label: "Bỏ lỡ",      icon: "⨯", dot: "bg-rose-500",    chip: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" },
}
const STATUS_CYCLE: Record<string, string> = { todo: "in_progress", in_progress: "done", done: "todo" }

const FREQUENCY_MAP: Record<string, { label: string; short: string }> = {
  once:    { label: "1 lần",      short: "1 lần" },
  daily:   { label: "Hằng ngày",  short: "Ngày" },
  weekly:  { label: "Hằng tuần",  short: "Tuần" },
  monthly: { label: "Hằng tháng", short: "Tháng" },
}

const TYPE_MAP: Record<string, { label: string; icon: string; chip: string }> = {
  ads_camp:     { label: "Chạy Ads", icon: "📢", chip: "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" },
  content_post: { label: "Nội dung", icon: "✍️", chip: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" },
  purchasing:   { label: "Mua hàng", icon: "🛒", chip: "bg-cyan-50 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300" },
  cskh_call:    { label: "Gọi CSKH", icon: "📞", chip: "bg-pink-50 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300" },
}

// 13 giai đoạn quy trình mua hàng TQ (type=purchasing). value → { label, chip }
const PURCHASE_STAGES: { value: string; label: string; chip: string }[] = [
  { value: "cho_sep_duyet",       label: "Chờ sếp duyệt",             chip: "bg-rose-100 text-rose-700" },
  { value: "sep_da_duyet",        label: "Sếp đã duyệt",              chip: "bg-yellow-100 text-yellow-800" },
  { value: "dat_coc",             label: "Đặt cọc",                   chip: "bg-purple-100 text-purple-700" },
  { value: "ncc_chuan_bi",        label: "NCC chuẩn bị hàng",         chip: "bg-amber-100 text-amber-800" },
  { value: "cho_thanh_toan_70",   label: "Đang chờ thanh toán 70%",   chip: "bg-gray-100 text-gray-700" },
  { value: "da_thanh_toan",       label: "Đã thanh toán",             chip: "bg-orange-200 text-orange-900" },
  { value: "cho_giao_kho_trung",  label: "Chờ giao tới kho Trung",    chip: "bg-red-100 text-red-600" },
  { value: "luu_kho_trung",       label: "Lưu kho Trung",             chip: "bg-yellow-200 text-yellow-800" },
  { value: "xu_ly_hai_quan",      label: "Xử lý thủ tục hải quan",    chip: "bg-blue-600 text-white" },
  { value: "van_chuyen_quoc_te",  label: "Vận chuyển Quốc Tế",        chip: "bg-green-100 text-green-700" },
  { value: "cho_giao_kho_hn",     label: "Chờ giao tới kho HN",       chip: "bg-teal-100 text-teal-700" },
  { value: "luu_kho_ha_noi",      label: "Lưu kho Hà Nội",            chip: "bg-cyan-100 text-cyan-700" },
  { value: "da_nhan_hang",        label: "Đã nhận hàng",              chip: "bg-emerald-600 text-white" },
]
const PURCHASE_STAGE_MAP: Record<string, { label: string; chip: string }> =
  Object.fromEntries(PURCHASE_STAGES.map(s => [s.value, { label: s.label, chip: s.chip }]))

// Dropdown đổi giai đoạn mua hàng inline (dùng trong dòng list)
function PurchaseStageSelect({ value, disabled, onChange }: {
  value: string | null
  disabled: boolean
  onChange: (v: string) => void
}) {
  const cur = value ? PURCHASE_STAGE_MAP[value] : null
  return (
    <select
      value={value || "cho_sep_duyet"}
      disabled={disabled}
      onClick={e => e.stopPropagation()}
      onChange={e => { e.stopPropagation(); onChange(e.target.value) }}
      title={disabled ? "Bạn không phải người nhận task này" : "Đổi giai đoạn"}
      className={cn(
        "max-w-[150px] cursor-pointer truncate rounded-full border-0 px-2 py-0.5 text-[11px] font-semibold outline-none",
        cur?.chip || "bg-ui-bg-component text-ui-fg-subtle",
        disabled && "cursor-not-allowed opacity-70")}>
      {PURCHASE_STAGES.map(s => (
        <option key={s.value} value={s.value} className="bg-white text-gray-800">{s.label}</option>
      ))}
    </select>
  )
}

const PRIORITY_MAP: Record<string, { label: string; icon: string; weight: number; bar: string; chip: string }> = {
  high:   { label: "Cao",   icon: "▲", weight: 0, bar: "bg-rose-300 dark:bg-rose-500/60",  chip: "bg-rose-50 text-rose-600 ring-1 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30" },
  medium: { label: "Vừa",   icon: "▪", weight: 1, bar: "bg-amber-300 dark:bg-amber-500/60", chip: "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30" },
  low:    { label: "Thấp",  icon: "▾", weight: 2, bar: "bg-transparent",                    chip: "bg-ui-bg-component text-ui-fg-muted ring-1 ring-ui-border-base" },
}

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const pw = (PRIORITY_MAP[a.priority]?.weight ?? 1) - (PRIORITY_MAP[b.priority]?.weight ?? 1)
    if (pw !== 0) return pw
    const da = a.deadline ? new Date(a.deadline).getTime() : Infinity
    const db = b.deadline ? new Date(b.deadline).getTime() : Infinity
    if (da !== db) return da - db
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

// ─── Page-level styles (keyframes — Tailwind config không mở rộng được) ─────

function PageStyles() {
  return (
    <style>{`
      @keyframes mktFadeUp { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
      @keyframes mktPop { 0% { transform: scale(.5) } 60% { transform: scale(1.18) } 100% { transform: scale(1) } }
      @keyframes mktSlideInRight { from { transform: translateX(100%) } to { transform: none } }
      @keyframes mktFadeIn { from { opacity: 0 } to { opacity: 1 } }
      @keyframes mktFlashNew { 0% { background-color: rgb(16 185 129 / 0.14) } 100% { background-color: transparent } }
      @keyframes mktToastIn { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: none } }
      .mkt-anim-fadeup { animation: mktFadeUp .18s ease-out }
      .mkt-anim-pop { animation: mktPop .22s cubic-bezier(.34,1.56,.64,1) }
      .mkt-anim-drawer { animation: mktSlideInRight .25s cubic-bezier(.21,1.02,.73,1) }
      .mkt-anim-overlay { animation: mktFadeIn .2s ease-out }
      .mkt-anim-flashnew { animation: mktFlashNew .9s ease-out }
      .mkt-anim-toast { animation: mktToastIn .22s cubic-bezier(.21,1.02,.73,1) }
      @media (prefers-reduced-motion: reduce) {
        .mkt-anim-fadeup, .mkt-anim-pop, .mkt-anim-drawer, .mkt-anim-overlay, .mkt-anim-flashnew, .mkt-anim-toast { animation: none }
      }
    `}</style>
  )
}

// ─── Small components ────────────────────────────────────────────────────────

function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full text-[10px] font-bold uppercase", avatarClass(name), className || "size-5")}>
      {(name || "?").charAt(0)}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] || STATUS_MAP.todo
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold", s.chip)}>
      <span className={cn("size-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  )
}

function TypeChip({ type }: { type: string }) {
  const t = TYPE_MAP[type] || { label: type, icon: "", chip: "bg-ui-bg-component text-ui-fg-subtle" }
  return <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap", t.chip)}>{t.icon} {t.label}</span>
}

function FrequencyChip({ freq, size }: { freq: string; size?: "sm" }) {
  const f = FREQUENCY_MAP[freq]
  if (!f || freq === "once") return null
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md font-semibold whitespace-nowrap bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/30",
      size === "sm" ? "px-1 py-px text-[10px]" : "px-1.5 py-0.5 text-[11px]")}>
      🔁 {f.short}
    </span>
  )
}

function PriorityChip({ level, size }: { level: string; size?: "sm" }) {
  const p = PRIORITY_MAP[level] || PRIORITY_MAP.medium
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md font-semibold whitespace-nowrap", p.chip, size === "sm" ? "px-1 py-px text-[10px]" : "px-1.5 py-0.5 text-[11px]")}>
      {p.icon} {p.label}
    </span>
  )
}

function TagChip({ tag, onRemove }: { tag: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-0.5 rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 ring-1 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/30">
      #{tag}
      {onRemove && (
        <button onClick={e => { e.stopPropagation(); onRemove() }} className="ml-0.5 text-sky-400 transition-colors hover:text-sky-700 dark:hover:text-sky-200">×</button>
      )}
    </span>
  )
}

function DeadlineChip({ task }: { task: Task }) {
  const days = daysUntil(task.deadline)
  const overdue = isOverdue(task)
  if (!task.deadline) return <span className="text-xs text-ui-fg-disabled">—</span>

  let cls = "bg-ui-bg-component text-ui-fg-subtle"
  let label = fmt(task.deadline)
  if (task.status === "done" || task.status === "cancelled") {
    cls = "bg-ui-bg-component text-ui-fg-disabled"
  } else if (overdue) {
    cls = "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300"
    label = `${fmt(task.deadline)} ⚠`
  } else if (days !== null && days <= 2) {
    cls = "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
  }
  return <span className={cn("inline-block rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums whitespace-nowrap", cls)}>{label}</span>
}

function Stars({ value, onChange }: { value: number | null; onChange?: (v: number) => void }) {
  const [hover, setHover] = useState(0)
  return (
    <span className="inline-flex gap-px">
      {[1, 2, 3, 4, 5].map(i => (
        <span key={i}
          onClick={onChange ? (e) => { e.stopPropagation(); onChange(i) } : undefined}
          onMouseEnter={onChange ? () => setHover(i) : undefined}
          onMouseLeave={onChange ? () => setHover(0) : undefined}
          className={cn("text-base leading-none transition-colors duration-100",
            onChange && "cursor-pointer",
            (hover || value || 0) >= i ? "text-amber-400" : "text-ui-fg-disabled")}
          style={onChange && hover >= i ? { transitionDelay: `${i * 20}ms` } : undefined}
        >★</span>
      ))}
    </span>
  )
}

function Toast({ msg, type, onDone }: { msg: string; type: "success" | "error"; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 2800); return () => clearTimeout(t) }, [])
  return (
    <div className={cn("mkt-anim-toast fixed bottom-6 right-6 z-[9999] flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold text-white shadow-lg",
      type === "success" ? "bg-emerald-600" : "bg-rose-600")}>
      <span>{type === "success" ? "✓" : "✕"}</span>{msg}
    </div>
  )
}

function ConfirmDialog({ msg, onConfirm, onCancel }: { msg: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="mkt-anim-overlay fixed inset-0 z-[500] flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div className="mkt-anim-fadeup w-[360px] rounded-xl bg-ui-bg-base p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="mb-5 text-sm leading-relaxed text-ui-fg-base">{msg}</div>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel}
            className="rounded-lg border border-ui-border-base bg-ui-bg-base px-3.5 py-1.5 text-[13px] text-ui-fg-base transition-colors hover:bg-ui-bg-base-hover focus-visible:ring-2 focus-visible:ring-blue-500/40 outline-none">
            Hủy
          </button>
          <button onClick={onConfirm}
            className="rounded-lg bg-rose-600 px-3.5 py-1.5 text-[13px] font-semibold text-white transition hover:bg-rose-700 active:scale-95 focus-visible:ring-2 focus-visible:ring-rose-500/40 outline-none">
            Xác nhận
          </button>
        </div>
      </div>
    </div>
  )
}

// Input style chung
const INPUT_CLS = "w-full rounded-lg border border-ui-border-base bg-ui-bg-field px-3 py-2 text-[13px] text-ui-fg-base outline-none transition-shadow placeholder:text-ui-fg-muted focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
const LABEL_CLS = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ui-fg-muted"

// ─── Mua hàng: khối lô nhập giá vốn ──────────────────────────────────────────
// Task type=purchasing liên kết tới 1 lô nhập trong bảng giá vốn (import_lot).
// Nếu chưa liên kết: form tạo lô mới (POST /admin/gia-von) rồi gắn import_lot_id vào task.
// Nếu đã liên kết: hiển thị tóm tắt lô (giá về kho, SL, phí).

type DailyMktReportRow = {
  date: string
  mkt_name: string
  total_orders: number
  delivered: number
  new_orders: number
  confirmed: number
  cancelled: number
  pending: number
  revenue_total: number | string
  revenue_delivered: number | string
  cod_total: number | string
  ads_cost: number | string
  care_pct: number | string | null
}

function normalizeReportTitle(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
}

function isDailyMktReportTask(task: Task): boolean {
  const haystack = normalizeReportTitle([task.title, task.output, task.notes, ...(task.tags || [])].filter(Boolean).join(" "))
  return haystack.includes("bao cao") || haystack.includes("bao_cao") || haystack.includes("mkt_daily") || haystack.includes("daily_mkt")
}

function todayVNKey(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)
}

function formatVND(value: number | string | null | undefined): string {
  return `${new Intl.NumberFormat("vi-VN").format(Math.round(Number(value || 0)))}đ`
}

function formatPercent(value: number | string | null | undefined): string {
  return `${Number(value || 0).toLocaleString("vi-VN", { maximumFractionDigits: 2 })}%`
}

function formatDateVN(dateKey: string): string {
  const [y, m, d] = dateKey.split("-")
  return `${d}/${m}/${y}`
}

function buildDailyMktReportText(row: DailyMktReportRow, note: string): string {
  return [
    `📊 Báo cáo MKT — ${formatDateVN(row.date)} — ${row.mkt_name}`,
    "",
    `Tổng đơn: ${Number(row.total_orders || 0)}`,
    `Mới: ${Number(row.new_orders || 0)} | Xác nhận: ${Number(row.confirmed || 0)} | Hủy: ${Number(row.cancelled || 0)} | Chờ: ${Number(row.pending || 0)}`,
    `Doanh số tổng: ${formatVND(row.revenue_total)}`,
    `Doanh số đã giao: ${formatVND(row.revenue_delivered)}`,
    `Chi phí ads: ${formatVND(row.ads_cost)}`,
    `Tỷ lệ chi phí/doanh số: ${formatPercent(row.care_pct)}`,
    "",
    "📝 Nhận xét:",
    note.trim() || "(Không có)",
  ].join("\n")
}

function DailyMktReportBlock({ task, canSend, onToast }: {
  task: Task
  canSend: boolean
  onToast: (msg: string, type: "success" | "error") => void
}) {
  const [date, setDate] = useState(todayVNKey())
  const [report, setReport] = useState<DailyMktReportRow | null>(null)
  const [note, setNote] = useState("")
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [cooldown, setCooldown] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    fetch(`/admin/mkt-tasks/${task.id}/daily-report?date=${date}`, { credentials: "include" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error || data?.message || "Không tải được báo cáo")
        if (active) setReport(data.report || null)
      })
      .catch((e) => {
        if (!active) return
        setReport(null)
        setError(e?.message || "Không tải được báo cáo")
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [task.id, date])

  const sendReport = async () => {
    if (!task.channel_id) {
      onToast("Task này chưa gắn kênh chat, liên hệ quản lý gắn kênh trước", "error")
      return
    }
    if (!report) {
      onToast("Chưa có dữ liệu báo cáo để gửi", "error")
      return
    }
    setSending(true)
    try {
      const res = await fetch(`/admin/mkt-chat/channels/${task.channel_id}/messages`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: buildDailyMktReportText(report, note), msg_type: "text" }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || data?.message || "Không gửi được báo cáo")
      onToast("Đã gửi báo cáo vào chat", "success")
      setCooldown(true)
      setTimeout(() => setCooldown(false), 3000)
    } catch (e: any) {
      onToast(e?.message || "Không gửi được báo cáo", "error")
    } finally {
      setSending(false)
    }
  }

  const metrics = report ? [
    ["Tổng đơn", Number(report.total_orders || 0)],
    ["Mới / Xác nhận / Hủy / Chờ", `${Number(report.new_orders || 0)} / ${Number(report.confirmed || 0)} / ${Number(report.cancelled || 0)} / ${Number(report.pending || 0)}`],
    ["Doanh số tổng", formatVND(report.revenue_total)],
    ["Doanh số đã giao", formatVND(report.revenue_delivered)],
    ["Chi phí ads", formatVND(report.ads_cost)],
    ["Tỷ lệ chi phí/doanh số", formatPercent(report.care_pct)],
  ] : []

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 dark:border-emerald-500/20 dark:bg-emerald-500/5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[12px] font-bold text-emerald-800 dark:text-emerald-300">📊 Báo cáo MKT</div>
          {report && <div className="mt-0.5 text-[11px] text-ui-fg-muted">{report.mkt_name} · {formatDateVN(report.date)}</div>}
        </div>
        <input type="date" className={cn(INPUT_CLS, "w-[150px] py-1.5")} value={date} onChange={e => setDate(e.target.value)} />
      </div>

      {loading ? (
        <div className="py-3 text-center text-[12px] text-ui-fg-muted">Đang tải báo cáo...</div>
      ) : error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">{error}</div>
      ) : report ? (
        <>
          <div className="overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-base">
            <table className="w-full text-[12px]">
              <thead className="bg-ui-bg-subtle text-left text-ui-fg-muted">
                <tr>
                  <th className="px-3 py-2 font-semibold">Chỉ số</th>
                  <th className="px-3 py-2 text-right font-semibold">Giá trị</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map(([label, value]) => (
                  <tr key={label} className="border-t border-ui-border-base">
                    <td className="px-3 py-2 text-ui-fg-subtle">{label}</td>
                    <td className="px-3 py-2 text-right font-semibold text-ui-fg-base">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3">
            <label className={LABEL_CLS}>Nhận xét</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={4}
              className={cn(INPUT_CLS, "resize-y")}
              placeholder="Nhập nhận xét trước khi gửi vào chat..."
            />
          </div>

          <button
            onClick={sendReport}
            disabled={!canSend || sending || cooldown}
            className={cn("mt-3 rounded-lg px-3.5 py-2 text-[13px] font-semibold transition active:scale-95",
              canSend && !sending && !cooldown
                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                : "bg-ui-bg-component text-ui-fg-disabled")}
            title={!canSend ? "Bạn không phải người xử lý task này" : undefined}
          >
            {sending ? "Đang gửi..." : cooldown ? "Đã gửi" : "Gửi báo cáo"}
          </button>
        </>
      ) : null}
    </div>
  )
}
type MktProductLite = { id: string; name: string; code: string | null }
type ImportLot = {
  id: string; product_title: string; qty: number; price_unit: number
  final_price: number; lot_date: string; received_date: string | null
  local_fee_tq: number; ship_fee_ovs: number; local_fee_vn: number; vat_fee: number; other_fee: number
  status: string; note: string
}

const nfmt = (v: number | null | undefined) =>
  v == null ? "—" : new Intl.NumberFormat("vi-VN").format(Number(v))

function PurchaseLotBlock({
  lotId, canEdit, onLinked, onToast,
}: {
  lotId: string | null
  canEdit: boolean
  onLinked: (lotId: string) => void
  onToast: (msg: string, type?: "success" | "error") => void
}) {
  const [lot, setLot] = useState<ImportLot | null>(null)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [products, setProducts] = useState<MktProductLite[]>([])
  const [saving, setSaving] = useState(false)
  const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)
  const [f, setF] = useState({
    product_id: "", qty: "", price_unit: "", lot_date: today, received_date: "",
    local_fee_tq: "", ship_fee_ovs: "", local_fee_vn: "", vat_fee: "", other_fee: "", note: "",
  })

  // Nạp lô đã liên kết
  useEffect(() => {
    if (!lotId) { setLot(null); return }
    setLoading(true)
    apiFetch(`/admin/gia-von?limit=100`)
      .then((r) => r.json())
      .then((d) => {
        const found = (d.lots || []).find((l: any) => l.id === lotId) || null
        setLot(found)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [lotId])

  // Nạp danh sách SP khi mở form tạo
  const openCreate = () => {
    setCreating(true)
    if (products.length === 0) {
      apiFetch(`/admin/gia-von/products`)
        .then((r) => r.json())
        .then((d) => setProducts(d.products || []))
        .catch(() => onToast("Không tải được danh sách sản phẩm (cần quyền giá vốn)", "error"))
    }
  }

  const num = (v: string) => (v === "" ? 0 : Number(v))
  const previewFinal = (() => {
    const q = num(f.qty)
    if (!q) return 0
    const total = q * num(f.price_unit) + num(f.local_fee_tq) + num(f.ship_fee_ovs) + num(f.local_fee_vn) + num(f.vat_fee) + num(f.other_fee)
    return Math.round((total / q) * 100) / 100
  })()

  const createLot = async () => {
    const prod = products.find((p) => p.id === f.product_id)
    if (!prod) { onToast("Chọn sản phẩm", "error"); return }
    if (!num(f.qty) || !num(f.price_unit)) { onToast("Nhập số lượng và đơn giá", "error"); return }
    if (!f.received_date) { onToast("Chỉ tạo lô khi hàng đã về — nhập ngày nhận", "error"); return }
    setSaving(true)
    try {
      const res = await apiFetch(`/admin/gia-von`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: prod.id,
          product_title: prod.name,
          lot_date: f.lot_date,
          received_date: f.received_date || null,
          qty: num(f.qty),
          price_unit: num(f.price_unit),
          local_fee_tq: num(f.local_fee_tq),
          ship_fee_ovs: num(f.ship_fee_ovs),
          local_fee_vn: num(f.local_fee_vn),
          vat_fee: num(f.vat_fee),
          other_fee: num(f.other_fee),
          source: "TQ",
          status: "received", // chỉ tạo lô khi hàng đã về (tránh cộng tồn kho ảo)
          note: f.note,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.lot) throw new Error(data?.error || "Lỗi tạo lô")
      setLot(data.lot)
      setCreating(false)
      onLinked(data.lot.id) // gắn vào task
      onToast("Đã tạo & liên kết lô nhập vào giá vốn", "success")
    } catch (e: any) {
      onToast(e?.message || "Lỗi tạo lô", "error")
    } finally {
      setSaving(false)
    }
  }

  const numInput = (key: keyof typeof f, label: string) => (
    <div>
      <label className={LABEL_CLS}>{label}</label>
      <input type="number" className={INPUT_CLS} value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} />
    </div>
  )

  return (
    <div className="rounded-xl border border-cyan-200 bg-cyan-50/40 p-3 dark:border-cyan-500/20 dark:bg-cyan-500/5">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[12px] font-bold text-cyan-800 dark:text-cyan-300">🛒 Lô nhập hàng (giá vốn)</div>
        <a href="/app/gia-von" target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-cyan-700 underline dark:text-cyan-400">Mở giá vốn ↗</a>
      </div>

      {loading ? (
        <div className="py-3 text-center text-[12px] text-ui-fg-muted">Đang tải lô…</div>
      ) : lot ? (
        // Đã liên kết → tóm tắt
        <div className="space-y-1.5 text-[12px]">
          <div className="font-semibold text-ui-fg-base">{lot.product_title}</div>
          <div className="grid grid-cols-3 gap-2 text-ui-fg-subtle">
            <div>SL: <b className="text-ui-fg-base">{nfmt(lot.qty)}</b></div>
            <div>Đơn giá: <b className="text-ui-fg-base">{nfmt(lot.price_unit)}</b></div>
            <div>Giá về kho: <b className="text-emerald-600 dark:text-emerald-400">{nfmt(lot.final_price)}</b></div>
            <div>Ngày lô: {lot.lot_date}</div>
            <div>Nhận: {lot.received_date || "—"}</div>
            <div>TT: {lot.status}</div>
          </div>
        </div>
      ) : creating ? (
        // Form tạo lô
        <div className="space-y-2.5">
          <div>
            <label className={LABEL_CLS}>Sản phẩm *</label>
            <select className={INPUT_CLS} value={f.product_id} onChange={(e) => setF({ ...f, product_id: e.target.value })}>
              <option value="">— Chọn sản phẩm —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.code ? `[${p.code}] ` : ""}{p.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {numInput("qty", "Số lượng *")}
            {numInput("price_unit", "Đơn giá (giá chốt) *")}
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className={LABEL_CLS}>Ngày đặt lô</label>
              <input type="date" className={INPUT_CLS} value={f.lot_date} onChange={(e) => setF({ ...f, lot_date: e.target.value })} />
            </div>
            <div>
              <label className={LABEL_CLS}>Ngày nhận *</label>
              <input type="date" className={INPUT_CLS} value={f.received_date} onChange={(e) => setF({ ...f, received_date: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            {numInput("local_fee_tq", "Phí nội địa TQ")}
            {numInput("ship_fee_ovs", "Ship quốc tế")}
            {numInput("local_fee_vn", "Nội địa VN")}
            {numInput("vat_fee", "VAT")}
            {numInput("other_fee", "Phí khác")}
          </div>
          <div className="rounded-lg bg-ui-bg-subtle px-3 py-2 text-[12px] text-ui-fg-subtle">
            Giá về kho/sp (tạm tính): <b className="text-emerald-600 dark:text-emerald-400">{nfmt(previewFinal)}</b>
          </div>
          <div className="flex gap-2">
            <button disabled={saving} onClick={createLot}
              className="flex-1 rounded-lg bg-cyan-600 py-1.5 text-xs font-semibold text-white transition hover:bg-cyan-700 active:scale-95 disabled:opacity-50">
              {saving ? "Đang tạo…" : "Tạo & liên kết lô"}
            </button>
            <button onClick={() => setCreating(false)}
              className="rounded-lg border border-ui-border-base bg-ui-bg-base px-3.5 py-1.5 text-xs text-ui-fg-subtle hover:bg-ui-bg-base-hover">Hủy</button>
          </div>
        </div>
      ) : (
        // Chưa liên kết
        <div className="flex items-center justify-between">
          <div className="text-[12px] text-ui-fg-muted">Chưa liên kết lô nhập nào.</div>
          {canEdit && (
            <button onClick={openCreate}
              className="rounded-lg border border-cyan-400 bg-white px-3 py-1.5 text-xs font-semibold text-cyan-700 transition hover:bg-cyan-50 dark:bg-transparent dark:text-cyan-300">
              + Tạo lô nhập
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Tags editor ─────────────────────────────────────────────────────────────

function TagsEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [input, setInput] = useState("")
  const add = () => {
    const t = input.trim().replace(/^#/, "").toLowerCase()
    if (t && !tags.includes(t) && tags.length < 10) onChange([...tags, t])
    setInput("")
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-ui-border-base bg-ui-bg-field px-2 py-1.5 transition-shadow focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-500/20">
      {tags.map(t => <TagChip key={t} tag={t} onRemove={() => onChange(tags.filter(x => x !== t))} />)}
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add() }
          if (e.key === "Backspace" && !input && tags.length > 0) onChange(tags.slice(0, -1))
        }}
        onBlur={add}
        placeholder={tags.length === 0 ? "Thêm tag, Enter để xác nhận..." : ""}
        className="min-w-[80px] flex-1 bg-transparent text-xs text-ui-fg-base outline-none placeholder:text-ui-fg-muted"
      />
    </div>
  )
}

// ─── Priority selector ───────────────────────────────────────────────────────

function PrioritySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1.5">
      {(["high", "medium", "low"] as const).map(p => (
        <button key={p} type="button" onClick={() => onChange(p)}
          className={cn("flex-1 rounded-lg border px-2 py-1.5 text-xs font-semibold transition-all active:scale-95 outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40",
            value === p
              ? p === "high" ? "border-rose-300 bg-rose-50 text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300"
                : p === "medium" ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
                : "border-ui-border-strong bg-ui-bg-component text-ui-fg-subtle"
              : "border-ui-border-base bg-ui-bg-base text-ui-fg-muted hover:bg-ui-bg-base-hover")}>
          {PRIORITY_MAP[p].icon} {PRIORITY_MAP[p].label}
        </button>
      ))}
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
  onUpdate: (patch?: Partial<Task> & { id: string }) => void
  onDelete: (id: string) => void
  onToast: (msg: string, type: "success" | "error") => void
}) {
  const isAssignee = initialTask.assignee_id === currentUserEmail
  const isPersonal = isPersonalTask(initialTask)
  const canEditDetails = isManager || isPersonal
  const canWork = isManager || isAssignee  // status + checklist + result + comment

  const [task, setTask] = useState(initialTask)
  const [notes, setNotes] = useState(initialTask.notes || "")
  const [plannedFor, setPlannedFor] = useState(initialTask.planned_for?.slice(0, 10) || "")
  const [notesDirty, setNotesDirty] = useState(false)
  const [result, setResult] = useState(initialTask.result || "")
  const [resultDirty, setResultDirty] = useState(false)
  const [savingResult, setSavingResult] = useState(false)
  const [comment, setComment] = useState("")
  const [comments, setComments] = useState(initialTask.comments || [])
  const [saving, setSaving] = useState(false)
  const [commentSaving, setCommentSaving] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState({
    title: initialTask.title,
    deadline: initialTask.deadline?.slice(0, 10) || "",
    deadlineTime: initialTask.deadline ? new Date(initialTask.deadline).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" }) : "23:59",
    assignee_id: initialTask.assignee_id,
    type: initialTask.type,
  })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [tab, setTab] = useState<"detail" | "work">("detail")
  const [checklist, setChecklist] = useState<ChecklistItem[]>(
    Array.isArray(initialTask.checklist) ? initialTask.checklist : []
  )
  const [newItem, setNewItem] = useState("")
  const commentsEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    commentsEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [comments])

  // Esc để đóng
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [onClose])

  const patchTask = async (update: Record<string, any>) => {
    const r = await apiFetch(`/admin/mkt-tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    }).then(r => r.json())
    if (r.task) {
      setTask(t => ({ ...t, ...update }))
      onUpdate({ id: task.id, ...update })
      return true
    }
    onToast(r.error || "Lỗi cập nhật", "error")
    return false
  }

  const updateStatus = async (s: string) => {
    const ok = await patchTask({ status: s })
    if (ok) onToast(`Đã chuyển sang "${STATUS_MAP[s]?.label}"`, "success")
  }

  // Checklist: lưu ngay khi tick/thêm/xoá (optimistic, revert nếu fail)
  const saveChecklist = async (next: ChecklistItem[]) => {
    const prev = checklist
    setChecklist(next)
    const ok = await patchTask({ checklist: next })
    if (!ok) setChecklist(prev)
  }
  const addChecklistItem = () => {
    const text = newItem.trim()
    if (!text || checklist.length >= 30) return
    setNewItem("")
    saveChecklist([...checklist, {
      id: (globalThis.crypto as any)?.randomUUID?.() || Math.random().toString(36).slice(2, 10),
      text,
      done: false,
    }])
  }
  const toggleChecklistItem = (id: string) =>
    saveChecklist(checklist.map(i => i.id === id ? { ...i, done: !i.done } : i))
  const removeChecklistItem = (id: string) =>
    saveChecklist(checklist.filter(i => i.id !== id))

  const saveNotes = async () => {
    setSaving(true)
    const ok = await patchTask({ notes })
    setSaving(false)
    if (ok) { setNotesDirty(false); onToast("Đã lưu ghi chú", "success") }
  }

  const savePlannedFor = async (value: string) => {
    const prev = plannedFor
    setPlannedFor(value)
    const ok = await patchTask({ planned_for: value ? `${value}T00:00:00+07:00` : null })
    if (!ok) setPlannedFor(prev)
  }

  const saveResult = async () => {
    setSavingResult(true)
    const ok = await patchTask({ result })
    setSavingResult(false)
    if (ok) { setResultDirty(false); onToast("Đã lưu kết quả", "success") }
  }

  const saveEdit = async () => {
    setSaving(true)
    const deadlineVal = editForm.deadline
      ? `${editForm.deadline}T${editForm.deadlineTime || "23:59"}:00+07:00`
      : null
    const update: Record<string, any> = {
      title: editForm.title,
      deadline: deadlineVal,
    }
    if (isManager) {
      update.assignee_id = editForm.assignee_id
      update.type = editForm.type
    }
    const ok = await patchTask(update)
    if (ok) {
      if (isManager) {
        const assigneeName = mktUsers.find(u => u.email === editForm.assignee_id)?.name || editForm.assignee_id
        setTask(t => ({ ...t, assignee_name: assigneeName }))
        onUpdate({ id: task.id, assignee_name: assigneeName } as any)
      }
      setEditMode(false)
      onToast("Đã cập nhật task", "success")
    }
    setSaving(false)
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
    if (ok) onToast("Đã đánh giá", "success")
  }

  const handleDelete = async () => {
    const res = await apiFetch(`/admin/mkt-tasks/${task.id}`, { method: "DELETE" })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      onToast(err?.error || "Xóa thất bại", "error")
      return
    }
    onDelete(task.id)
    onClose()
    onToast("Đã xóa task", "success")
  }

  // Task once: assignee thấy nút "Gửi duyệt" khi đang làm; manager thấy nút Duyệt/Từ chối khi pending_review
  const isOnce = task.frequency === "once" && !task.is_template
  const STATUSES: string[] = isManager
    ? (task.status === "pending_review"
        ? ["todo", "in_progress", "pending_review", "done", "cancelled"]
        : ["todo", "in_progress", "done", "cancelled"])
    : (isPersonal
        ? ["todo", "in_progress", "done", "cancelled"]
        : (isOnce
            ? (task.status === "pending_review" ? ["pending_review"] : ["todo", "in_progress"])
            : ["todo", "in_progress", "pending_review", "done"]))

  const statusBtnCls = (s: string) => {
    const active = task.status === s
    const base = "rounded-lg border px-3.5 py-1.5 text-xs font-semibold transition-all active:scale-95 outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
    if (!active) return cn(base, "border-ui-border-base bg-ui-bg-base text-ui-fg-subtle hover:bg-ui-bg-base-hover")
    switch (s) {
      case "in_progress":    return cn(base, "border-blue-500 bg-blue-600 text-white shadow-sm shadow-blue-500/30")
      case "pending_review": return cn(base, "border-amber-400 bg-amber-500 text-white shadow-sm shadow-amber-500/30")
      case "done":           return cn(base, "border-emerald-500 bg-emerald-600 text-white shadow-sm shadow-emerald-500/30")
      case "cancelled":      return cn(base, "border-rose-400 bg-rose-500 text-white shadow-sm shadow-rose-500/30")
      default:               return cn(base, "border-gray-400 bg-gray-500 text-white")
    }
  }

  return (
    <>
      <div onClick={onClose} className="mkt-anim-overlay fixed inset-0 z-[99] bg-black/25" />
      <div className="mkt-anim-drawer fixed right-0 top-0 z-[100] flex h-screen w-[920px] max-w-[90vw] flex-col border-l border-ui-border-base bg-ui-bg-base shadow-2xl">
        {/* Header */}
        <div className="border-b border-ui-border-base bg-ui-bg-subtle px-5 py-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap gap-1.5">
                <PriorityChip level={task.priority} />
                <TypeChip type={task.type} />
                {task.is_template && task.frequency && <FrequencyChip freq={task.frequency} />}
                {!task.is_template && <StatusBadge status={task.status} />}
                {task.template_id && task.period_key && (
                  <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">🔁 kỳ {task.period_key}</span>
                )}
                {isOverdue(task) && (
                  <span className="rounded-md bg-rose-50 px-1.5 py-0.5 text-[11px] font-bold text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">⚠ Quá hạn</span>
                )}
              </div>
              <h2 className="break-words text-[15px] font-bold leading-snug text-ui-fg-base">{task.title}</h2>
              {task.tags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">{task.tags.map(t => <TagChip key={t} tag={t} />)}</div>
              )}
            </div>
            <div className="flex shrink-0 gap-1">
              {canEditDetails && (
                <button onClick={() => setEditMode(e => !e)} title="Sửa task"
                  className={cn("rounded-lg border px-2.5 py-1 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40",
                    editMode ? "border-blue-300 bg-blue-50 text-blue-600 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-300" : "border-ui-border-base text-ui-fg-subtle hover:bg-ui-bg-base-hover")}>
                  ✏️
                </button>
              )}
              {(isManager || isPersonal) && (
                <button onClick={() => setConfirmDelete(true)} title="Xóa task"
                  className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs text-rose-500 transition-colors hover:bg-rose-50 dark:border-rose-500/30 dark:hover:bg-rose-500/10 outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40">
                  🗑
                </button>
              )}
              <button onClick={onClose}
                className="rounded-lg border border-ui-border-base px-2.5 py-1 text-base leading-none text-ui-fg-muted transition-colors hover:bg-ui-bg-base-hover outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40">
                ×
              </button>
            </div>
          </div>
        </div>

        {/* Tabs: Chi tiết (đề bài) | Checklist & Kết quả (bài làm) */}
        <div className="flex border-b border-ui-border-base bg-ui-bg-subtle px-5">
          {([
            ["detail", "📋 Chi tiết"],
            ["work", "☑️ Checklist & Kết quả"],
          ] as const).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={cn("-mb-px border-b-2 px-4 py-2.5 text-[13px] font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40",
                tab === key
                  ? "border-blue-500 text-blue-600 dark:text-blue-400"
                  : "border-transparent text-ui-fg-muted hover:text-ui-fg-subtle")}>
              {label}
              {key === "work" && checklist.length > 0 && (
                <span className={cn("ml-1.5 rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums",
                  checklist.every(i => i.done)
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                    : "bg-ui-bg-component text-ui-fg-subtle")}>
                  {checklist.filter(i => i.done).length}/{checklist.length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col gap-5 px-5 py-4">

            {tab === "detail" && (<>
            {/* Edit form */}
            {editMode && canEditDetails && (
              <div className="mkt-anim-fadeup flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50/60 p-3.5 dark:border-blue-500/30 dark:bg-blue-500/5">
                <div className="text-[11px] font-bold uppercase tracking-wide text-blue-700 dark:text-blue-300">Chỉnh sửa task</div>
                <div>
                  <label className={LABEL_CLS}>Tiêu đề</label>
                  <input className={INPUT_CLS} value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={LABEL_CLS}>Loại</label>
                    <select className={INPUT_CLS} value={editForm.type} disabled={!isManager} onChange={e => setEditForm(f => ({ ...f, type: e.target.value as any }))}>
                      <option value="ads_camp">Chạy Ads</option>
                      <option value="content_post">Nội dung</option>
                      <option value="purchasing">Mua hàng</option>
                    </select>
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Deadline</label>
                    <div className="flex gap-1.5">
                      <input type="date" className={cn(INPUT_CLS, "flex-1")} value={editForm.deadline} onChange={e => setEditForm(f => ({ ...f, deadline: e.target.value }))} />
                      <input type="time" className={cn(INPUT_CLS, "w-[100px]")} value={editForm.deadlineTime} onChange={e => setEditForm(f => ({ ...f, deadlineTime: e.target.value }))} />
                    </div>
                  </div>
                </div>
                <div>
                  <label className={LABEL_CLS}>Giao cho</label>
                  <select className={INPUT_CLS} value={editForm.assignee_id} onChange={e => setEditForm(f => ({ ...f, assignee_id: e.target.value }))}>
                    {mktUsers.map(u => <option key={u.email} value={u.email}>{u.name}</option>)}
                  </select>
                </div>
                <div className="flex gap-2">
                  <button onClick={saveEdit} disabled={saving}
                    className="flex-1 rounded-lg bg-blue-600 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700 active:scale-95 disabled:opacity-50">
                    {saving ? "Đang lưu..." : "Lưu thay đổi"}
                  </button>
                  <button onClick={() => setEditMode(false)}
                    className="rounded-lg border border-ui-border-base bg-ui-bg-base px-3.5 py-1.5 text-xs text-ui-fg-subtle transition-colors hover:bg-ui-bg-base-hover">
                    Hủy
                  </button>
                </div>
              </div>
            )}

            {/* Meta */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-lg bg-ui-bg-subtle px-3 py-2.5">
                <div className={LABEL_CLS}>Người nhận</div>
                <div className="flex items-center gap-1.5 text-[13px] font-bold text-ui-fg-base">
                  <Avatar name={task.assignee_name} /> {task.assignee_name}
                </div>
              </div>
              <div className="rounded-lg bg-ui-bg-subtle px-3 py-2.5">
                <div className={LABEL_CLS}>Deadline</div>
                <div className={cn("text-[13px] font-bold", isOverdue(task) ? "text-rose-600 dark:text-rose-400" : "text-ui-fg-base")}>
                  📅 {fmtFull(task.deadline)}
                  {(() => {
                    const d = daysUntil(task.deadline)
                    if (d === null || task.status === "done" || task.status === "cancelled") return null
                    if (d < 0) return <span className="ml-1 text-[11px] text-rose-500">({Math.abs(d)}d trễ)</span>
                    if (d <= 2) return <span className="ml-1 text-[11px] text-amber-600 dark:text-amber-400">({d}d còn)</span>
                    return null
                  })()}
                </div>
              </div>
              <div className="rounded-lg bg-ui-bg-subtle px-3 py-2.5">
                <label className={LABEL_CLS}>Ngày dự định làm</label>
                <input type="date" value={plannedFor} disabled={!canWork}
                  onChange={e => savePlannedFor(e.target.value)}
                  className={cn(INPUT_CLS, "py-1.5", !canWork && "bg-ui-bg-subtle")} />
              </div>
            </div>

            {/* Status */}
            <div>
              <div className={LABEL_CLS}>Trạng thái</div>
              <div className="flex flex-wrap gap-1.5">
                {STATUSES.map(s => (
                  <button key={s} onClick={() => canWork && updateStatus(s)} disabled={!canWork} className={statusBtnCls(s)}
                    title={!canWork ? "Bạn không phải người nhận task này" : undefined}>
                    {STATUS_MAP[s].icon} {STATUS_MAP[s].label}
                  </button>
                ))}
              </div>
              {/* Assignee: nút Gửi duyệt khi task once đang làm */}
              {isOnce && !isPersonal && !isManager && isAssignee && task.status === "in_progress" && (
                <button onClick={() => updateStatus("pending_review")}
                  className="mt-2 rounded-lg border border-amber-400 bg-amber-50 px-3.5 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 active:scale-95 dark:bg-amber-500/10 dark:text-amber-300">
                  📤 Gửi duyệt
                </button>
              )}
              {/* Manager: nút Duyệt / Từ chối khi pending_review */}
              {isManager && task.status === "pending_review" && (
                <div className="mt-2 flex gap-2">
                  <button onClick={() => updateStatus("done")}
                    className="rounded-lg border border-emerald-500 bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm shadow-emerald-500/30 transition hover:bg-emerald-700 active:scale-95">
                    ✓ Duyệt
                  </button>
                  <button onClick={() => updateStatus("cancelled")}
                    className="rounded-lg border border-rose-400 bg-rose-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm shadow-rose-500/30 transition hover:bg-rose-600 active:scale-95">
                    ✕ Từ chối
                  </button>
                </div>
              )}
            </div>

            {/* Priority + Tags */}
            {canEditDetails && (
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <div className={LABEL_CLS}>Độ ưu tiên</div>
                  <PrioritySelect value={task.priority} onChange={p => patchTask({ priority: p })} />
                </div>
                <div>
                  <div className={LABEL_CLS}>Tags</div>
                  <TagsEditor tags={task.tags} onChange={tags => patchTask({ tags })} />
                </div>
              </div>
            )}

            {/* Output cần có */}
            <div>
              <div className={LABEL_CLS}>🎯 Output cần có</div>
              {isManager ? (
                <input
                  value={task.output || ""}
                  onChange={e => setTask(t => ({ ...t, output: e.target.value }))}
                  onBlur={e => { if (e.target.value !== (initialTask.output || "")) patchTask({ output: e.target.value || null }) }}
                  className={INPUT_CLS}
                  placeholder="Tiêu chí hoàn thành (VD: gửi báo cáo trước 10h30)"
                />
              ) : (
                <div className={cn("rounded-lg bg-ui-bg-subtle px-3 py-2 text-[13px]", task.output ? "text-ui-fg-base" : "text-ui-fg-disabled")}>
                  {task.output || "(Chưa đặt tiêu chí)"}
                </div>
              )}
            </div>

            {/* Mua hàng: giai đoạn quy trình */}
            {task.type === "purchasing" && (
              <div>
                <div className={LABEL_CLS}>🛒 Giai đoạn mua hàng</div>
                <div className="flex flex-wrap gap-1.5">
                  {PURCHASE_STAGES.map(s => {
                    const active = (task.purchase_stage || "cho_sep_duyet") === s.value
                    return (
                      <button key={s.value}
                        disabled={!canWork}
                        onClick={() => canWork && patchTask(
                          s.value === "da_nhan_hang" && task.status !== "done"
                            ? { purchase_stage: s.value, status: "done" }
                            : { purchase_stage: s.value })}
                        className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold transition",
                          active ? s.chip : "bg-ui-bg-component text-ui-fg-subtle hover:bg-ui-bg-base-hover",
                          !canWork && "cursor-not-allowed opacity-60")}>
                        {s.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Mua hàng: lô nhập giá vốn */}
            {task.type === "purchasing" && (
              <PurchaseLotBlock
                lotId={task.import_lot_id || null}
                canEdit={canWork}
                onLinked={(lotId) => patchTask({ import_lot_id: lotId })}
                onToast={onToast}
              />
            )}

            {isDailyMktReportTask(task) && (
              <DailyMktReportBlock
                task={task}
                canSend={canWork}
                onToast={onToast}
              />
            )}
            {/* Notes */}
            <div>
              <div className={LABEL_CLS}>Ghi chú / Yêu cầu</div>
              <textarea
                value={notes}
                onChange={e => { setNotes(e.target.value); setNotesDirty(true) }}
                disabled={!canEditDetails}
                rows={4}
                className={cn(INPUT_CLS, "resize-y", notesDirty && "border-blue-400", !canEditDetails && "bg-ui-bg-subtle")}
                placeholder={canEditDetails ? "Thêm mô tả, yêu cầu chi tiết..." : "(Chưa có ghi chú)"}
              />
              {canEditDetails && notesDirty && (
                <div className="mkt-anim-fadeup mt-1.5 flex gap-1.5">
                  <button onClick={saveNotes} disabled={saving}
                    className="rounded-lg bg-blue-600 px-3.5 py-1 text-xs font-semibold text-white transition hover:bg-blue-700 active:scale-95 disabled:opacity-50">
                    {saving ? "Đang lưu..." : "Lưu ghi chú"}
                  </button>
                  <button onClick={() => { setNotes(initialTask.notes || ""); setNotesDirty(false) }}
                    className="rounded-lg border border-ui-border-base px-3 py-1 text-xs text-ui-fg-subtle transition-colors hover:bg-ui-bg-base-hover">
                    Hủy
                  </button>
                </div>
              )}
            </div>
            </>)}

            {tab === "work" && (<>
            {/* Checklist — assignee tự quản sub-steps, lưu ngay khi thao tác */}
            <div>
              <div className={LABEL_CLS}>
                ☑️ Checklist
                {checklist.length > 0 && (
                  <span className="ml-1.5 font-bold normal-case tabular-nums text-emerald-600 dark:text-emerald-400">
                    {checklist.filter(i => i.done).length}/{checklist.length}
                  </span>
                )}
              </div>
              {checklist.length > 0 && (
                <div className="mb-2 h-1 overflow-hidden rounded-full bg-ui-bg-component">
                  <div className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                    style={{ width: `${Math.round(checklist.filter(i => i.done).length / checklist.length * 100)}%` }} />
                </div>
              )}
              <div className="flex flex-col gap-0.5">
                {checklist.map(item => (
                  <div key={item.id}
                    className="group flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-ui-bg-subtle">
                    <input type="checkbox" checked={item.done} disabled={!canWork}
                      onChange={() => toggleChecklistItem(item.id)}
                      className="mt-0.5 size-4 shrink-0 cursor-pointer accent-emerald-600 disabled:cursor-not-allowed" />
                    <span className={cn("min-w-0 flex-1 break-words text-[13px] leading-snug",
                      item.done ? "text-ui-fg-muted line-through" : "text-ui-fg-base")}>
                      {item.text}
                    </span>
                    {canWork && (
                    <button onClick={() => removeChecklistItem(item.id)} title="Xóa mục"
                      className="shrink-0 rounded px-1 text-xs text-ui-fg-disabled opacity-0 transition-opacity hover:text-rose-500 group-hover:opacity-100">
                      ✕
                    </button>
                    )}
                  </div>
                ))}
              </div>
              {canWork && checklist.length < 30 && (
                <div className="mt-1.5 flex gap-1.5">
                  <input value={newItem}
                    onChange={e => setNewItem(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addChecklistItem() } }}
                    placeholder="+ Thêm bước... (Enter để thêm)"
                    className={INPUT_CLS} />
                  <button onClick={addChecklistItem} disabled={!newItem.trim()}
                    className={cn("shrink-0 rounded-lg px-3.5 text-[13px] font-semibold transition active:scale-95",
                      newItem.trim() ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-ui-bg-component text-ui-fg-disabled")}>
                    +
                  </button>
                </div>
              )}
            </div>

            {/* Kết quả thực tế — assignee/manager điền (không hiện cho template) */}
            {!task.is_template && (
              <div>
                <div className={LABEL_CLS}>
                  ✅ Kết quả thực tế
                  {task.status !== "done" && <span className="ml-1 font-normal normal-case text-ui-fg-disabled">(điền khi hoàn thành)</span>}
                </div>
                <textarea
                  value={result}
                  onChange={e => { if (canWork) { setResult(e.target.value); setResultDirty(true) } }}
                  disabled={!canWork}
                  rows={8}
                  className={cn(INPUT_CLS, "resize-y", resultDirty && "border-emerald-400",
                    task.status === "done" && !result && "border-amber-300",
                    !canWork && "bg-ui-bg-subtle")}
                  placeholder={canWork ? "Đã làm gì? VD: Tăng budget SP1 lên 4tr, ROAS 2.8, loại 2 creative CTR thấp" : "(Chưa có kết quả)"}
                />
                {resultDirty && canWork && (
                  <div className="mkt-anim-fadeup mt-1.5 flex gap-1.5">
                    <button onClick={saveResult} disabled={savingResult}
                      className="rounded-lg bg-emerald-600 px-3.5 py-1 text-xs font-semibold text-white transition hover:bg-emerald-700 active:scale-95 disabled:opacity-50">
                      {savingResult ? "Đang lưu..." : "Lưu kết quả"}
                    </button>
                    <button onClick={() => { setResult(initialTask.result || ""); setResultDirty(false) }}
                      className="rounded-lg border border-ui-border-base px-3 py-1 text-xs text-ui-fg-subtle transition-colors hover:bg-ui-bg-base-hover">
                      Hủy
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Rating */}
            {(isManager && task.status === "done") && (
              <div>
                <div className={LABEL_CLS}>Đánh giá chất lượng</div>
                <div className="flex items-center gap-2.5">
                  <Stars value={task.rating} onChange={rateTask} />
                  {task.rating
                    ? <span className="text-xs font-bold text-amber-500">{task.rating}/5</span>
                    : <span className="text-xs text-ui-fg-disabled">Chưa đánh giá</span>}
                </div>
              </div>
            )}
            {(!isManager && task.rating) && (
              <div>
                <div className={LABEL_CLS}>Đánh giá</div>
                <div className="flex items-center gap-2">
                  <Stars value={task.rating} />
                  <span className="text-xs font-bold text-amber-500">{task.rating}/5</span>
                </div>
              </div>
            )}
            </>)}

            {tab === "detail" && (<>
            {/* Comments */}
            <div>
              <div className={LABEL_CLS}>Trao đổi ({comments.length})</div>
              <div className="mb-2.5 flex max-h-56 flex-col gap-2 overflow-y-auto pr-1">
                {comments.length === 0 && (
                  <div className="py-3 text-center text-xs text-ui-fg-disabled">💬 Chưa có trao đổi nào</div>
                )}
                {comments.map((c, i) => {
                  const isSystem = (c as any).type === "system"
                  const isMe = c.author_id === currentUserEmail
                  if (isSystem) return (
                    <div key={i} className="flex items-center gap-2 py-0.5">
                      <div className="h-px flex-1 bg-ui-border-base" />
                      <div className="flex items-center gap-1 rounded-full border border-ui-border-base bg-ui-bg-subtle px-2.5 py-0.5 text-[11px] text-ui-fg-muted">
                        <span>⚡</span>
                        <span className="font-medium text-ui-fg-subtle">{resolveAuthorName(c.author_id, mktUsers, currentUserEmail)}</span>
                        <span>{c.text}</span>
                        <span className="ml-1 opacity-60">{new Date(c.created_at).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}</span>
                      </div>
                      <div className="h-px flex-1 bg-ui-border-base" />
                    </div>
                  )
                  return (
                    <div key={i} className={cn("flex flex-col", isMe ? "items-end" : "items-start")}>
                      <div className={cn("max-w-[85%] border px-3 py-2",
                        isMe
                          ? "rounded-xl rounded-br-sm border-blue-200 bg-blue-50 dark:border-blue-500/30 dark:bg-blue-500/10"
                          : "rounded-xl rounded-bl-sm border-ui-border-base bg-ui-bg-subtle")}>
                        <div className="mb-0.5 text-[11px] text-ui-fg-muted">
                          <strong className={isMe ? "text-blue-700 dark:text-blue-300" : "text-ui-fg-base"}>
                            {resolveAuthorName(c.author_id, mktUsers, currentUserEmail)}
                          </strong>
                          {" · "}{new Date(c.created_at).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
                        </div>
                        <div className="text-[13px] leading-relaxed text-ui-fg-base">{c.text}</div>
                      </div>
                    </div>
                  )
                })}
                <div ref={commentsEndRef} />
              </div>
              <div className="flex items-end gap-1.5">
                <textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendComment() } }}
                  rows={2}
                  placeholder="Nhắn tin... (Enter gửi, Shift+Enter xuống dòng)"
                  className={cn(INPUT_CLS, "resize-none")}
                />
                <button onClick={sendComment} disabled={commentSaving || !comment.trim()}
                  className={cn("self-end rounded-lg px-3.5 py-2 text-[13px] font-semibold transition active:scale-95",
                    comment.trim() ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-ui-bg-component text-ui-fg-disabled")}>
                  {commentSaving ? "..." : "↑"}
                </button>
              </div>
            </div>

            <div className="pt-1 text-[11px] text-ui-fg-disabled">
              Tạo lúc {new Date(task.created_at).toLocaleString("vi-VN")}
            </div>
            </>)}
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

// ─── Create Task Modal (full form — cho task phức tạp) ──────────────────────

function CreateTaskModal({ onClose, onCreated, users, defaults, isManager, currentUserEmail }: {
  onClose: () => void
  onCreated: () => void
  users: MktUser[]
  defaults?: Partial<{ assignee_id: string; type: string; deadline: string; planned_for: string }>
  isManager: boolean
  currentUserEmail: string
}) {
  const [form, setForm] = useState({
    title: "",
    type: defaults?.type || "ads_camp",
    assignee_id: defaults?.assignee_id || (isManager ? "" : currentUserEmail),
    deadline: defaults?.deadline || "",
    deadlineTime: "23:59",
    planned_for: defaults?.planned_for || "",
    notes: "",
    priority: "medium",
    tags: [] as string[],
    frequency: "once",
    output: "",
  })
  const isRecurring = isManager && form.frequency !== "once"
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState("")

  const submit = async () => {
    if (!form.title.trim() || (isManager && !form.assignee_id)) { setErr(isManager ? "Vui lòng nhập tiêu đề và chọn người nhận" : "Vui lòng nhập tiêu đề"); return }
    setSaving(true); setErr("")
    const { deadlineTime, ...rest } = form
    const payload: Record<string, any> = {
      ...rest,
      deadline: form.deadline ? `${form.deadline}T${deadlineTime || "23:59"}:00+07:00` : null,
      planned_for: form.planned_for ? `${form.planned_for}T00:00:00+07:00` : null,
    }
    if (!isManager) {
      delete payload.assignee_id
      payload.frequency = "once"
    }
    const r = await apiFetch("/admin/mkt-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(r => r.json())
    setSaving(false)
    if (r.task) { onCreated(); onClose() }
    else setErr(r.error || "Lỗi tạo task")
  }

  return (
    <div className="mkt-anim-overlay fixed inset-0 z-[200] flex items-center justify-center bg-black/45" onClick={onClose}>
      <div className="mkt-anim-fadeup w-[520px] max-w-[95vw] rounded-xl bg-ui-bg-base p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h2 className="mb-5 text-base font-extrabold text-ui-fg-base">📋 {isManager ? "Tạo task mới" : "Tạo việc mới"}</h2>

        <div className="flex flex-col gap-3.5">
          <div>
            <label className={LABEL_CLS}>Tiêu đề <span className="text-rose-500">*</span></label>
            <input className={INPUT_CLS} placeholder="VD: Camp chuyển đổi tháng 6" value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              onKeyDown={e => e.key === "Enter" && submit()} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS}>Loại task <span className="text-rose-500">*</span></label>
              <select className={INPUT_CLS} value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                <option value="ads_camp">📢 Chạy Ads / Camp</option>
                <option value="content_post">✍️ Nội dung / Bài đăng</option>
                <option value="purchasing">🛒 Mua hàng / Nhập hàng</option>
              </select>
            </div>
            {isManager && (
              <div>
                <label className={LABEL_CLS}>Tần suất</label>
                <select className={INPUT_CLS} value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}>
                  <option value="once">1 lần</option>
                  <option value="daily">🔁 Hằng ngày</option>
                  <option value="weekly">🔁 Hằng tuần</option>
                  <option value="monthly">🔁 Hằng tháng</option>
                </select>
              </div>
            )}
          </div>
          {!isRecurring && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLS}>Deadline</label>
                <div className="flex gap-1.5">
                  <input type="date" className={cn(INPUT_CLS, "flex-1")} value={form.deadline} onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} />
                  <input type="time" className={cn(INPUT_CLS, "w-[100px]")} value={form.deadlineTime} onChange={e => setForm(f => ({ ...f, deadlineTime: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className={LABEL_CLS}>Ngày dự định làm</label>
                <input type="date" className={INPUT_CLS} value={form.planned_for} onChange={e => setForm(f => ({ ...f, planned_for: e.target.value }))} />
              </div>
            </div>
          )}
          {isRecurring && (
            <div className="rounded-lg bg-indigo-50/60 px-3 py-2 text-[11px] text-indigo-700 dark:bg-indigo-500/5 dark:text-indigo-300">
              🔁 Việc lặp — hệ thống tự sinh đầu việc mỗi {FREQUENCY_MAP[form.frequency]?.label.toLowerCase()} cho người nhận. Kỳ chưa làm xong khi qua kỳ mới sẽ tự đánh dấu "Bỏ lỡ".
            </div>
          )}
          {isManager && (
            <div>
              <label className={LABEL_CLS}>Giao cho <span className="text-rose-500">*</span></label>
              <select className={INPUT_CLS} value={form.assignee_id} onChange={e => setForm(f => ({ ...f, assignee_id: e.target.value }))}>
                <option value="">-- Chọn thành viên --</option>
                {users.map(u => <option key={u.email} value={u.email}>{u.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className={LABEL_CLS}>Output cần có</label>
            <input className={INPUT_CLS} placeholder="VD: Quyết định budget ghi văn bản, gửi team trước 10h30"
              value={form.output} onChange={e => setForm(f => ({ ...f, output: e.target.value }))} />
          </div>
          <div>
            <label className={LABEL_CLS}>Độ ưu tiên</label>
            <PrioritySelect value={form.priority} onChange={p => setForm(f => ({ ...f, priority: p }))} />
          </div>
          <div>
            <label className={LABEL_CLS}>Tags</label>
            <TagsEditor tags={form.tags} onChange={tags => setForm(f => ({ ...f, tags }))} />
          </div>
          <div>
            <label className={LABEL_CLS}>Ghi chú / Yêu cầu</label>
            <textarea rows={3} className={cn(INPUT_CLS, "resize-y")} placeholder="Mô tả chi tiết công việc..."
              value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          {err && <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">{err}</div>}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose}
            className="rounded-lg border border-ui-border-base bg-ui-bg-base px-4 py-2 text-[13px] text-ui-fg-base transition-colors hover:bg-ui-bg-base-hover">
            Hủy
          </button>
          <button onClick={submit} disabled={saving}
            className="rounded-lg bg-blue-600 px-5 py-2 text-[13px] font-bold text-white transition hover:bg-blue-700 active:scale-95 disabled:opacity-50">
            {saving ? "Đang tạo..." : isRecurring ? "🔁 Tạo việc lặp" : "✓ Tạo task"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Inline create (List group + Board column) ──────────────────────────────

function InlineCreate({ placeholder, needAssignee, users, onCreate, compact }: {
  placeholder: string
  needAssignee?: boolean              // group không xác định được assignee → hiện select
  users: MktUser[]
  onCreate: (title: string, assigneeId: string | null) => Promise<boolean>
  compact?: boolean                   // dạng card trong board
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState("")
  const [assignee, setAssignee] = useState("")
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = async () => {
    if (!title.trim() || busy) return
    if (needAssignee && !assignee) return
    setBusy(true)
    const ok = await onCreate(title.trim(), needAssignee ? assignee : null)
    setBusy(false)
    if (ok) {
      setTitle("")
      inputRef.current?.focus()      // giữ focus để tạo tiếp task kế (chuẩn Linear)
    }
  }

  if (!editing) {
    return (
      <button onClick={() => setEditing(true)}
        className={cn("group flex w-full items-center gap-1.5 text-left text-[13px] text-ui-fg-muted transition-colors hover:text-blue-600 dark:hover:text-blue-400 outline-none focus-visible:text-blue-600",
          compact ? "rounded-lg border border-dashed border-ui-border-base px-3 py-2 hover:border-blue-300 hover:bg-blue-500/5" : "px-4 py-2")}>
        <span className="text-base leading-none transition-transform group-hover:scale-110">+</span> {placeholder}
      </button>
    )
  }

  return (
    <div className={cn("mkt-anim-fadeup flex items-center gap-1.5", compact ? "rounded-lg border border-blue-300 bg-ui-bg-base p-2 shadow-sm dark:border-blue-500/40" : "px-4 py-1.5")}>
      <input
        ref={inputRef} autoFocus value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter") submit()
          if (e.key === "Escape") { setEditing(false); setTitle("") }
        }}
        placeholder="Tiêu đề · Enter tạo · Esc hủy"
        className="h-8 min-w-0 flex-1 rounded-lg border border-blue-300 bg-ui-bg-field px-2.5 text-[13px] text-ui-fg-base outline-none ring-2 ring-blue-500/15 placeholder:text-ui-fg-muted dark:border-blue-500/40"
      />
      {needAssignee && (
        <select value={assignee} onChange={e => setAssignee(e.target.value)}
          className="h-8 max-w-[120px] rounded-lg border border-ui-border-base bg-ui-bg-field px-1.5 text-xs text-ui-fg-base outline-none">
          <option value="">Giao cho...</option>
          {users.map(u => <option key={u.email} value={u.email}>{u.name}</option>)}
        </select>
      )}
      <button onClick={() => { setEditing(false); setTitle("") }}
        className="grid size-8 shrink-0 place-items-center rounded-lg text-ui-fg-muted transition-colors hover:bg-ui-bg-base-hover">×</button>
    </div>
  )
}

// ─── List view ───────────────────────────────────────────────────────────────

function TaskRow({ task, onClick, onQuickStatus, canQuickStatus, onChangeStage, flash, periodLabel, showPersonalChip, planNote, planOverdue }: {
  task: Task
  onClick: () => void
  onQuickStatus: () => void
  canQuickStatus: boolean
  onChangeStage?: (stage: string) => void
  flash?: boolean
  periodLabel?: string
  showPersonalChip?: boolean
  planNote?: string
  planOverdue?: boolean
}) {
  const overdue = isOverdue(task)
  const p = PRIORITY_MAP[task.priority] || PRIORITY_MAP.medium
  return (
    <div onClick={onClick}
      className={cn("relative grid cursor-pointer grid-cols-[1fr_92px_120px_84px_110px_84px] items-center gap-2 border-b border-ui-border-base px-4 py-2.5 transition-colors",
        flash && "mkt-anim-flashnew",
        overdue ? "bg-amber-500/5 hover:bg-amber-500/10" : "hover:bg-ui-bg-base-hover")}>
      {/* Priority bar */}
      <span className={cn("absolute inset-y-0 left-0 w-[3px]", p.bar)} />

      {/* Title + status icon + tags */}
      <div className="flex min-w-0 items-center gap-2">
        <button
          onClick={e => { e.stopPropagation(); if (canQuickStatus) onQuickStatus() }}
          title={canQuickStatus ? `Chuyển sang "${STATUS_MAP[STATUS_CYCLE[task.status] || "todo"]?.label}"` : undefined}
          className={cn("grid size-5 shrink-0 place-items-center rounded text-[13px] leading-none transition-transform outline-none",
            canQuickStatus && "hover:scale-125 focus-visible:ring-2 focus-visible:ring-blue-500/40",
            task.status === "done" ? "text-emerald-500" : task.status === "in_progress" ? "text-blue-500" : task.status === "cancelled" ? "text-rose-400" : "text-ui-fg-muted")}>
          {STATUS_MAP[task.status]?.icon || "☐"}
        </button>
        {periodLabel && (
          <span className="shrink-0 rounded bg-indigo-50 px-1 py-px text-[10px] font-semibold tabular-nums text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">{periodLabel}</span>
        )}
        {showPersonalChip && (
          <span className="shrink-0 rounded bg-indigo-50 px-1.5 py-px text-[10px] font-bold text-indigo-700 ring-1 ring-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/30">CÁ NHÂN</span>
        )}
        {planNote && (
          <span className={cn("shrink-0 rounded px-1.5 py-px text-[10px] font-semibold", planOverdue ? "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300" : "bg-ui-bg-component text-ui-fg-muted")}>{planNote}</span>
        )}
        <span className={cn("truncate text-[13px] font-medium",
          (task.status === "cancelled" || task.status === "missed") ? "text-ui-fg-muted line-through" : task.status === "done" ? "text-ui-fg-subtle" : "text-ui-fg-base")}>
          {periodLabel ? (task.result && task.status === "done" ? task.result : task.title) : task.title}
        </span>
        {task.tags.slice(0, 3).map(t => <TagChip key={t} tag={t} />)}
        {(task.checklist?.length || 0) > 0 && (
          <span className="shrink-0 text-[11px] tabular-nums text-ui-fg-muted">
            ☑{task.checklist!.filter(i => i.done).length}/{task.checklist!.length}
          </span>
        )}
        {(task.comments?.length || 0) > 0 && (
          <span className="shrink-0 text-[11px] text-ui-fg-muted">💬{task.comments.length}</span>
        )}
      </div>

      <div><TypeChip type={task.type} /></div>

      <div className="flex min-w-0 items-center gap-1.5 text-xs text-ui-fg-subtle">
        <Avatar name={task.assignee_name} />
        <span className="truncate">{task.assignee_name}</span>
      </div>

      <div><DeadlineChip task={task} /></div>
      <div>
        {task.type === "purchasing"
          ? <PurchaseStageSelect value={task.purchase_stage || null} disabled={!canQuickStatus} onChange={s => onChangeStage?.(s)} />
          : <StatusBadge status={task.status} />}
      </div>
      <div>
        {task.rating
          ? <Stars value={task.rating} />
          : <span className="text-[13px] text-ui-fg-disabled">☆☆☆☆☆</span>}
      </div>
    </div>
  )
}

// Tách 1 list phẳng thành template (kèm instance con) + task lẻ
function splitRecurring(tasks: Task[]): { templates: { template: Task; instances: Task[] }[]; flat: Task[] } {
  const templates = tasks.filter(t => t.is_template)
  const byTemplate: Record<string, Task[]> = {}
  const flat: Task[] = []
  for (const t of tasks) {
    if (t.is_template) continue
    if (t.template_id) {
      if (!byTemplate[t.template_id]) byTemplate[t.template_id] = []
      byTemplate[t.template_id].push(t)
    } else {
      flat.push(t)
    }
  }
  // instance mồ côi (template bị xoá nhưng đã filter ra) vẫn hiện ở flat
  for (const tid of Object.keys(byTemplate)) {
    if (!templates.find(t => t.id === tid)) flat.push(...byTemplate[tid])
  }
  return {
    templates: templates.map(template => ({
      template,
      instances: (byTemplate[template.id] || []).sort((a, b) =>
        String(b.period_key || "").localeCompare(String(a.period_key || ""))),
    })),
    flat,
  }
}

// Hàng "mẹ" cho việc lặp — gấp được, expand ra từng kỳ (instance)
function RecurringGroupRow({ template, instances, onTaskClick, onQuickStatus, canQuick, flashId }: {
  template: Task
  instances: Task[]
  onTaskClick: (t: Task) => void
  onQuickStatus: (t: Task) => void
  canQuick: (t: Task) => boolean
  flashId: string | null
}) {
  const [open, setOpen] = useState(false)
  const done = instances.filter(t => t.status === "done").length
  const missed = instances.filter(t => t.status === "missed").length
  const denom = done + missed
  const pct = denom > 0 ? Math.round(done / denom * 100) : 0

  return (
    <div className="border-b border-ui-border-base">
      <div className="relative grid cursor-pointer grid-cols-[1fr_92px_120px_84px_110px_84px] items-center gap-2 bg-indigo-500/5 px-4 py-2.5 transition-colors hover:bg-indigo-500/10"
        onClick={() => setOpen(o => !o)}>
        <span className="absolute inset-y-0 left-0 w-[3px] bg-indigo-400" />
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("text-[10px] text-ui-fg-muted transition-transform duration-200", open && "rotate-90")}>▶</span>
          <span className="shrink-0 text-sm">🔁</span>
          <span className="truncate text-[13px] font-bold text-ui-fg-base">{template.title}</span>
          <button onClick={e => { e.stopPropagation(); onTaskClick(template) }}
            title="Sửa việc lặp"
            className="shrink-0 rounded px-1 text-[11px] text-ui-fg-muted transition-colors hover:text-indigo-600">✏️</button>
        </div>
        <div><TypeChip type={template.type} /></div>
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-ui-fg-subtle">
          <Avatar name={template.assignee_name} /><span className="truncate">{template.assignee_name}</span>
        </div>
        <div><FrequencyChip freq={template.frequency || "once"} /></div>
        <div className="flex items-center gap-1.5">
          <span className="h-1 w-12 overflow-hidden rounded-full bg-ui-bg-component">
            <span className={cn("block h-full rounded-full", pct === 100 ? "bg-emerald-500" : "bg-blue-500")} style={{ width: `${pct}%` }} />
          </span>
          <span className="text-[11px] tabular-nums text-ui-fg-muted">{done}/{denom || 0}</span>
        </div>
        <div className="text-[11px] tabular-nums text-ui-fg-muted">
          {missed > 0 && <span className="font-bold text-rose-600 dark:text-rose-400">⨯{missed}</span>}
        </div>
      </div>
      {open && (
        <div className="bg-ui-bg-subtle/40">
          {instances.length === 0 && (
            <div className="px-4 py-3 pl-12 text-xs text-ui-fg-disabled">Chưa có kỳ nào được sinh</div>
          )}
          {instances.map(t => (
            <div key={t.id} className="pl-7">
              <TaskRow task={t}
                onClick={() => onTaskClick(t)}
                onQuickStatus={() => onQuickStatus(t)}
                canQuickStatus={canQuick(t) && t.status !== "cancelled" && t.status !== "missed"}
                flash={flashId === t.id}
                periodLabel={t.period_key || undefined}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function GroupedSection({ label, tasks, onTaskClick, onQuickStatus, canQuick, onChangeStage, isManager, users, onInlineCreate, inlineDefaults, flashId }: {
  label: string
  tasks: Task[]
  onTaskClick: (t: Task) => void
  onQuickStatus: (t: Task) => void
  canQuick: (t: Task) => boolean
  onChangeStage: (t: Task, stage: string) => void
  isManager: boolean
  users: MktUser[]
  onInlineCreate: (title: string, assigneeId: string | null) => Promise<boolean>
  inlineDefaults: { assignee_id?: string; needAssignee: boolean }
  flashId: string | null
}) {
  const [open, setOpen] = useState(true)
  const { templates, flat } = useMemo(() => splitRecurring(tasks), [tasks])
  // Tiến độ header tính trên task không-template (instance + lẻ)
  const countable = tasks.filter(t => !t.is_template)
  const done = countable.filter(t => t.status === "done").length
  const overdue = countable.filter(t => isOverdue(t)).length
  const pct = countable.length > 0 ? Math.round(done / countable.length * 100) : 0

  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-ui-border-base bg-ui-bg-base">
      <button onClick={() => setOpen(o => !o)}
        className={cn("flex w-full items-center gap-2.5 bg-ui-bg-subtle px-4 py-2.5 text-left transition-colors hover:bg-ui-bg-subtle-hover", open && "border-b border-ui-border-base")}>
        <span className={cn("text-[10px] text-ui-fg-muted transition-transform duration-200", open && "rotate-90")}>▶</span>
        <span className="flex-1 text-[13px] font-bold text-ui-fg-base">{label}</span>
        {overdue > 0 && (
          <span className="rounded-full bg-rose-50 px-2 py-px text-[11px] font-semibold text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">⚠ {overdue} quá hạn</span>
        )}
        <span className="text-[11px] tabular-nums text-ui-fg-muted">{done}/{countable.length}</span>
        <span className="h-1 w-16 overflow-hidden rounded-full bg-ui-bg-component">
          <span className={cn("block h-full rounded-full transition-all duration-300", pct === 100 ? "bg-emerald-500" : "bg-blue-500")} style={{ width: `${pct}%` }} />
        </span>
        <span className={cn("min-w-[32px] text-right text-[11px] font-bold tabular-nums", pct === 100 ? "text-emerald-600 dark:text-emerald-400" : "text-ui-fg-subtle")}>{pct}%</span>
      </button>
      {open && (
        <div>
          <div className="grid grid-cols-[1fr_92px_120px_84px_110px_84px] gap-2 border-b border-ui-border-base px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-ui-fg-disabled">
            <div className="pl-7">Tiêu đề</div><div>Loại</div><div>Người nhận</div><div>Deadline</div><div>Trạng thái</div><div>Đánh giá</div>
          </div>
          {templates.map(({ template, instances }) => (
            <RecurringGroupRow key={template.id} template={template} instances={instances}
              onTaskClick={onTaskClick} onQuickStatus={onQuickStatus} canQuick={canQuick} flashId={flashId} />
          ))}
          {flat.map(t => (
            <TaskRow key={t.id} task={t}
              onClick={() => onTaskClick(t)}
              onQuickStatus={() => onQuickStatus(t)}
              canQuickStatus={canQuick(t) && t.status !== "cancelled" && t.status !== "missed"}
              onChangeStage={(s) => onChangeStage(t, s)}
              flash={flashId === t.id}
            />
          ))}
          {isManager && (
            <InlineCreate
              placeholder={`Thêm task${inlineDefaults.needAssignee ? "" : ` cho ${label}`}...`}
              needAssignee={inlineDefaults.needAssignee}
              users={users}
              onCreate={onInlineCreate}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ─── Board view (Kanban) ─────────────────────────────────────────────────────

type PlannerBucketKey = "today" | "tomorrow" | "week" | "unscheduled"

type PlannerMeta = { note?: string; overdue?: boolean }

function MyDayView({ tasks, onTaskClick, onQuickStatus, canQuick, onChangeStage, onInlineCreate, flashId }: {
  tasks: Task[]
  onTaskClick: (t: Task) => void
  onQuickStatus: (t: Task) => void
  canQuick: (t: Task) => boolean
  onChangeStage: (t: Task, stage: string) => void
  onInlineCreate: (title: string, plannedFor: string | null) => Promise<boolean>
  flashId: string | null
}) {
  const today = vnDateKey(new Date()) || ""
  const tomorrow = addDaysKey(today, 1)
  const weekInlineDate = addDaysKey(today, 2)
  const meta: Record<string, PlannerMeta> = {}
  const grouped: Record<PlannerBucketKey, Task[]> = {
    today: [],
    tomorrow: [],
    week: [],
    unscheduled: [],
  }

  for (const task of sortTasks(tasks.filter(t => !t.is_template))) {
    const plannedKey = vnDateKey(task.planned_for)
    const deadlineKey = vnDateKey(task.deadline)
    const basis = plannedKey || deadlineKey
    const active = task.status !== "done" && task.status !== "cancelled"
    let bucket: PlannerBucketKey = "unscheduled"

    if (plannedKey && plannedKey < today && active) {
      bucket = "today"
      meta[task.id] = { note: "⚠ trễ kế hoạch", overdue: true }
    } else if (!basis) {
      bucket = "unscheduled"
    } else if (basis === today) {
      bucket = "today"
    } else if (basis === tomorrow) {
      bucket = "tomorrow"
    } else if (basis < today) {
      bucket = "unscheduled"
    } else {
      bucket = "week"
    }

    if (!plannedKey && deadlineKey) meta[task.id] = { ...(meta[task.id] || {}), note: meta[task.id]?.note || "theo deadline" }
    grouped[bucket].push(task)
  }

  const buckets: { key: PlannerBucketKey; label: string; hint: string; plannedFor: string | null; accent?: boolean }[] = [
    { key: "today", label: "Hôm nay", hint: today, plannedFor: today, accent: true },
    { key: "tomorrow", label: "Ngày mai", hint: tomorrow, plannedFor: tomorrow },
    { key: "week", label: "Tuần này", hint: "Các ngày sắp tới", plannedFor: weekInlineDate },
    { key: "unscheduled", label: "Chưa xếp lịch", hint: "Chưa có ngày dự định hoặc deadline", plannedFor: null },
  ]
  const total = Object.values(grouped).reduce((sum, list) => sum + list.length, 0)

  return (
    <div className="space-y-3">
      {total === 0 && (
        <div className="rounded-xl border border-dashed border-ui-border-base bg-ui-bg-subtle px-4 py-8 text-center text-sm text-ui-fg-muted">
          Bấm + để thêm việc riêng, hoặc đặt Ngày dự định làm cho task được giao.
        </div>
      )}
      {buckets.map(bucket => {
        const list = grouped[bucket.key]
        const done = list.filter(t => t.status === "done").length
        return (
          <section key={bucket.key} className={cn("overflow-hidden rounded-xl border border-ui-border-base bg-ui-bg-base", bucket.accent && "border-blue-200 bg-blue-500/[0.03] dark:border-blue-500/30")}>
            <header className={cn("flex items-center gap-2 border-b border-ui-border-base px-4 py-2.5", bucket.accent ? "bg-blue-50/70 dark:bg-blue-500/10" : "bg-ui-bg-subtle")}>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold text-ui-fg-base">{bucket.label}</div>
                <div className="text-[11px] text-ui-fg-muted">{bucket.hint}</div>
              </div>
              <span className="text-[11px] tabular-nums text-ui-fg-muted">{done}/{list.length}</span>
            </header>
            <div>
              {list.map(t => (
                <TaskRow key={t.id} task={t}
                  onClick={() => onTaskClick(t)}
                  onQuickStatus={() => onQuickStatus(t)}
                  canQuickStatus={canQuick(t) && t.status !== "cancelled" && t.status !== "missed"}
                  onChangeStage={(s) => onChangeStage(t, s)}
                  flash={flashId === t.id}
                  showPersonalChip={isPersonalTask(t)}
                  planNote={meta[t.id]?.note}
                  planOverdue={meta[t.id]?.overdue}
                />
              ))}
              {list.length === 0 && (
                <div className="px-4 py-3 text-xs text-ui-fg-disabled">Không có việc trong nhóm này</div>
              )}
              <InlineCreate
                placeholder={`Thêm việc vào ${bucket.label.toLowerCase()}...`}
                users={[]}
                onCreate={(title) => onInlineCreate(title, bucket.plannedFor)}
              />
            </div>
          </section>
        )
      })}
    </div>
  )
}
const BOARD_COLUMNS: { status: Task["status"]; label: string; dot: string }[] = [
  { status: "todo",           label: "Chờ làm",    dot: "bg-gray-400" },
  { status: "in_progress",    label: "Đang làm",   dot: "bg-blue-500" },
  { status: "pending_review", label: "Chờ duyệt",  dot: "bg-amber-400" },
  { status: "done",           label: "Hoàn thành", dot: "bg-emerald-500" },
  { status: "cancelled",      label: "Đã hủy",     dot: "bg-rose-400" },
]

function TaskCard({ task, onClick, draggable, onDragStart, onDragEnd, dragging }: {
  task: Task
  onClick: () => void
  draggable: boolean
  onDragStart: () => void
  onDragEnd: () => void
  dragging: boolean
}) {
  return (
    <article
      draggable={draggable}
      onDragStart={e => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", task.id); onDragStart() }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={cn("group cursor-pointer rounded-lg border border-ui-border-base bg-ui-bg-base p-3 shadow-sm transition-all duration-150",
        "hover:-translate-y-0.5 hover:border-ui-border-strong hover:shadow-md",
        draggable && "active:cursor-grabbing",
        dragging && "rotate-2 opacity-50")}>
      <div className="mb-2 flex flex-wrap gap-1">
        <PriorityChip level={task.priority} size="sm" />
        <TypeChip type={task.type} />
        {task.tags.slice(0, 2).map(t => <TagChip key={t} tag={t} />)}
      </div>
      <h4 className={cn("text-[13px] font-medium leading-snug line-clamp-2",
        task.status === "cancelled" ? "text-ui-fg-muted line-through" : "text-ui-fg-base")}>{task.title}</h4>
      <div className="mt-2.5 flex items-center justify-between">
        <DeadlineChip task={task} />
        <div className="flex items-center gap-1.5 text-[11px] text-ui-fg-muted">
          {(task.checklist?.length || 0) > 0 && (
            <span className="tabular-nums">☑{task.checklist!.filter(i => i.done).length}/{task.checklist!.length}</span>
          )}
          {(task.comments?.length || 0) > 0 && <span>💬{task.comments.length}</span>}
          {task.rating ? <span className="text-amber-400">★{task.rating}</span> : null}
          <Avatar name={task.assignee_name} />
        </div>
      </div>
    </article>
  )
}

function BoardView({ tasks, onTaskClick, onMove, canMove, isManager, users, onInlineCreate, flashId }: {
  tasks: Task[]
  onTaskClick: (t: Task) => void
  onMove: (taskId: string, status: Task["status"]) => void
  canMove: (t: Task) => boolean
  isManager: boolean
  users: MktUser[]
  onInlineCreate: (title: string, assigneeId: string | null, status: Task["status"]) => Promise<boolean>
  flashId: string | null
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  return (
    <div className="grid auto-cols-[280px] grid-flow-col gap-3.5 overflow-x-auto pb-4 xl:auto-cols-fr">
      {BOARD_COLUMNS.map(col => {
        const colTasks = sortTasks(tasks.filter(t => t.status === col.status))
        return (
          <section key={col.status}
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDropTarget(col.status) }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null) }}
            onDrop={e => {
              e.preventDefault()
              const id = e.dataTransfer.getData("text/plain") || draggingId
              if (id) onMove(id, col.status)
              setDropTarget(null); setDraggingId(null)
            }}
            className={cn("flex max-h-[calc(100vh-240px)] flex-col rounded-xl bg-ui-bg-subtle p-2 transition-all duration-150",
              dropTarget === col.status && draggingId && "bg-blue-500/5 ring-2 ring-blue-400/50")}>
            <header className="flex items-center gap-2 px-2 py-1.5">
              <span className={cn("size-2 rounded-full", col.dot)} />
              <span className="text-[13px] font-bold text-ui-fg-base">{col.label}</span>
              <span className="rounded-full bg-ui-bg-component px-1.5 text-[11px] font-semibold tabular-nums text-ui-fg-muted">{colTasks.length}</span>
            </header>
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-0.5">
              {colTasks.map(t => (
                <div key={t.id} className={flashId === t.id ? "mkt-anim-flashnew rounded-lg" : undefined}>
                  <TaskCard task={t}
                    onClick={() => onTaskClick(t)}
                    draggable={canMove(t)}
                    onDragStart={() => setDraggingId(t.id)}
                    onDragEnd={() => { setDraggingId(null); setDropTarget(null) }}
                    dragging={draggingId === t.id}
                  />
                </div>
              ))}
              {isManager && (col.status === "todo" || col.status === "in_progress") && (
                <InlineCreate compact placeholder="Thêm task..." needAssignee users={users}
                  onCreate={(title, assignee) => onInlineCreate(title, assignee, col.status)} />
              )}
              {colTasks.length === 0 && !isManager && (
                <div className="py-8 text-center text-xs text-ui-fg-disabled">Trống</div>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

// ─── Calendar view ───────────────────────────────────────────────────────────

function CalendarView({ tasks, onTaskClick, onMoveDeadline, canMove, isManager, users, onQuickCreate }: {
  tasks: Task[]
  onTaskClick: (t: Task) => void
  onMoveDeadline: (taskId: string, date: string) => void
  canMove: boolean
  isManager: boolean
  users: MktUser[]
  onQuickCreate: (title: string, assigneeId: string, deadline: string) => Promise<boolean>
}) {
  const today = new Date()
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropDay, setDropDay] = useState<string | null>(null)
  const [createDay, setCreateDay] = useState<string | null>(null)
  const [createTitle, setCreateTitle] = useState("")
  const [createAssignee, setCreateAssignee] = useState("")
  const [expandDay, setExpandDay] = useState<string | null>(null)

  // Build grid: tuần bắt đầu Thứ 2
  const firstDow = (month.getDay() + 6) % 7
  const start = new Date(month); start.setDate(1 - firstDow)
  const cells: Date[] = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start); d.setDate(start.getDate() + i); return d
  })
  const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  const todayKey = dayKey(today)

  const tasksByDay = useMemo(() => {
    const map: Record<string, Task[]> = {}
    for (const t of tasks) {
      if (!t.deadline) continue
      const k = dayKey(new Date(t.deadline))
      if (!map[k]) map[k] = []
      map[k].push(t)
    }
    for (const k of Object.keys(map)) map[k] = sortTasks(map[k])
    return map
  }, [tasks])

  const noDeadline = tasks.filter(t => !t.deadline && t.status !== "done" && t.status !== "cancelled")

  const pillCls = (t: Task) => cn(
    "block w-full truncate rounded-md px-1.5 py-0.5 text-left text-[11px] font-medium leading-tight transition-all hover:brightness-95 dark:hover:brightness-125",
    draggingId === t.id && "opacity-40",
    t.status === "done" ? "bg-ui-bg-component text-ui-fg-muted line-through"
      : t.status === "cancelled" ? "bg-ui-bg-component text-ui-fg-disabled line-through"
      : isOverdue(t) ? "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"
      : t.priority === "high" ? "bg-rose-50 text-rose-600 ring-1 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/20"
      : t.priority === "medium" ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/20"
      : "bg-ui-bg-component text-ui-fg-subtle"
  )

  const submitQuickCreate = async () => {
    if (!createTitle.trim() || !createAssignee || !createDay) return
    const ok = await onQuickCreate(createTitle.trim(), createAssignee, createDay)
    if (ok) { setCreateDay(null); setCreateTitle("") }
  }

  return (
    <div>
      {/* Month nav */}
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
          className="grid size-8 place-items-center rounded-lg border border-ui-border-base text-ui-fg-subtle transition-colors hover:bg-ui-bg-base-hover active:scale-95">‹</button>
        <span className="min-w-[140px] text-center text-sm font-bold capitalize text-ui-fg-base">
          Tháng {month.getMonth() + 1}/{month.getFullYear()}
        </span>
        <button onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
          className="grid size-8 place-items-center rounded-lg border border-ui-border-base text-ui-fg-subtle transition-colors hover:bg-ui-bg-base-hover active:scale-95">›</button>
        <button onClick={() => setMonth(new Date(today.getFullYear(), today.getMonth(), 1))}
          className="rounded-lg border border-ui-border-base px-3 py-1.5 text-xs font-medium text-ui-fg-subtle transition-colors hover:bg-ui-bg-base-hover">Hôm nay</button>
        {canMove && <span className="ml-auto text-[11px] text-ui-fg-muted">💡 Kéo task sang ngày khác để đổi deadline</span>}
      </div>

      {/* No-deadline strip */}
      {noDeadline.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-xl border border-dashed border-ui-border-base bg-ui-bg-subtle px-3 py-2">
          <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-ui-fg-muted">Chưa đặt deadline ({noDeadline.length})</span>
          {noDeadline.slice(0, 8).map(t => (
            <button key={t.id}
              draggable={canMove}
              onDragStart={e => { e.dataTransfer.setData("text/plain", t.id); setDraggingId(t.id) }}
              onDragEnd={() => { setDraggingId(null); setDropDay(null) }}
              onClick={() => onTaskClick(t)}
              className={cn(pillCls(t), "w-auto max-w-[180px]", canMove && "cursor-grab active:cursor-grabbing")}>
              {t.title}
            </button>
          ))}
          {noDeadline.length > 8 && <span className="text-[11px] text-ui-fg-muted">+{noDeadline.length - 8} khác</span>}
        </div>
      )}

      {/* Grid */}
      <div className="overflow-hidden rounded-xl border border-ui-border-base bg-ui-bg-base">
        <div className="grid grid-cols-7 border-b border-ui-border-base bg-ui-bg-subtle">
          {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map(d => (
            <div key={d} className="px-2 py-1.5 text-center text-[11px] font-bold uppercase tracking-wide text-ui-fg-muted">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            const k = dayKey(d)
            const inMonth = d.getMonth() === month.getMonth()
            const dayTasks = tasksByDay[k] || []
            const isToday = k === todayKey
            const expanded = expandDay === k
            const shown = expanded ? dayTasks : dayTasks.slice(0, 3)
            return (
              <div key={i}
                onDragOver={e => { if (draggingId) { e.preventDefault(); setDropDay(k) } }}
                onDragLeave={() => setDropDay(prev => prev === k ? null : prev)}
                onDrop={e => {
                  e.preventDefault()
                  const id = e.dataTransfer.getData("text/plain") || draggingId
                  if (id) onMoveDeadline(id, k)
                  setDropDay(null); setDraggingId(null)
                }}
                onDoubleClick={() => { if (isManager && inMonth) { setCreateDay(k); setCreateTitle(""); setCreateAssignee("") } }}
                className={cn("group/day relative min-h-[92px] border-b border-r border-ui-border-base p-1 transition-colors [&:nth-child(7n)]:border-r-0",
                  !inMonth && "bg-ui-bg-subtle/60",
                  dropDay === k && draggingId && "bg-blue-500/10 ring-2 ring-inset ring-blue-400/50")}>
                <div className="mb-1 flex items-center justify-between px-0.5">
                  <span className={cn("grid size-5 place-items-center rounded-full text-[11px] font-semibold tabular-nums",
                    isToday ? "bg-blue-600 text-white" : inMonth ? "text-ui-fg-subtle" : "text-ui-fg-disabled")}>
                    {d.getDate()}
                  </span>
                  {isManager && inMonth && (
                    <button onClick={() => { setCreateDay(k); setCreateTitle(""); setCreateAssignee("") }}
                      className="grid size-4 place-items-center rounded text-[11px] text-ui-fg-disabled opacity-0 transition-opacity hover:bg-ui-bg-component hover:text-blue-600 group-hover/day:opacity-100">+</button>
                  )}
                </div>
                <div className="flex flex-col gap-0.5">
                  {shown.map(t => (
                    <button key={t.id}
                      draggable={canMove}
                      onDragStart={e => { e.dataTransfer.setData("text/plain", t.id); setDraggingId(t.id) }}
                      onDragEnd={() => { setDraggingId(null); setDropDay(null) }}
                      onClick={() => onTaskClick(t)}
                      title={`${t.title} — ${t.assignee_name}`}
                      className={cn(pillCls(t), canMove && "cursor-grab active:cursor-grabbing")}>
                      {t.title}
                    </button>
                  ))}
                  {dayTasks.length > 3 && (
                    <button onClick={() => setExpandDay(expanded ? null : k)}
                      className="px-1 text-left text-[10px] font-medium text-ui-fg-muted transition-colors hover:text-blue-600">
                      {expanded ? "Thu gọn ▲" : `+${dayTasks.length - 3} khác`}
                    </button>
                  )}
                </div>

                {/* Quick create popover */}
                {createDay === k && (
                  <div className="mkt-anim-fadeup absolute left-1 top-7 z-20 w-56 rounded-xl border border-ui-border-base bg-ui-bg-base p-2.5 shadow-xl">
                    <div className="mb-1.5 text-[11px] font-bold text-ui-fg-subtle">Task mới · {fmt(k)}</div>
                    <input autoFocus value={createTitle} onChange={e => setCreateTitle(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") submitQuickCreate(); if (e.key === "Escape") setCreateDay(null) }}
                      placeholder="Tiêu đề..." className={cn(INPUT_CLS, "mb-1.5 py-1.5")} />
                    <select value={createAssignee} onChange={e => setCreateAssignee(e.target.value)} className={cn(INPUT_CLS, "mb-2 py-1.5")}>
                      <option value="">Giao cho...</option>
                      {users.map(u => <option key={u.email} value={u.email}>{u.name}</option>)}
                    </select>
                    <div className="flex gap-1.5">
                      <button onClick={submitQuickCreate} disabled={!createTitle.trim() || !createAssignee}
                        className="flex-1 rounded-lg bg-blue-600 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700 active:scale-95 disabled:opacity-40">Tạo</button>
                      <button onClick={() => setCreateDay(null)}
                        className="rounded-lg border border-ui-border-base px-2.5 text-xs text-ui-fg-subtle hover:bg-ui-bg-base-hover">Hủy</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Recurring stats row (expandable periods) ────────────────────────────────

function RecurringStatsRow({ r }: { r: any }) {
  const [open, setOpen] = useState(false)
  // Cùng style cell với bảng StatsView (td bên đó là biến local, ngoài scope ở đây)
  const td = "px-3.5 py-2.5 text-[13px] border-b border-ui-border-base text-ui-fg-base"
  const rate = r.period_done_rate
  return (
    <>
      <tr
        className="cursor-pointer transition-colors hover:bg-ui-bg-base-hover"
        onClick={() => setOpen(o => !o)}
      >
        <td className={td}>
          <div className="flex items-center gap-1.5">
            <span className="text-indigo-500">🔁</span>
            <span className="font-medium">{r.title}</span>
            {r.output && <span className="ml-1 max-w-[160px] truncate text-[11px] text-ui-fg-muted" title={r.output}>→ {r.output}</span>}
          </div>
        </td>
        <td className={td}><span className="text-sm">{r.assignee_name}</span></td>
        <td className={cn(td, "text-center")}><FrequencyChip freq={r.frequency} /></td>
        <td className={cn(td, "text-center font-semibold tabular-nums")}>{r.total_periods}</td>
        <td className={cn(td, "text-center")}>
          <span className="font-bold text-emerald-600 dark:text-emerald-400">{r.done}</span>
        </td>
        <td className={cn(td, "text-center")}>
          {r.missed > 0
            ? <span className="font-bold text-rose-600 dark:text-rose-400">{r.missed}</span>
            : <span className="text-ui-fg-disabled">—</span>}
        </td>
        <td className={cn(td, "text-center")}>
          {rate != null
            ? <span className={cn("font-bold", rate >= 80 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>{rate}%</span>
            : <span className="text-ui-fg-disabled">—</span>}
        </td>
      </tr>
      {open && r.periods.map((p: any) => (
        <tr key={p.id} className="bg-ui-bg-subtle">
          <td colSpan={2} className={cn(td, "pl-8 text-sm text-ui-fg-muted")}>
            <span className="mr-2 rounded bg-ui-bg-component px-1.5 py-0.5 font-mono text-[11px]">{p.period_key}</span>
            {p.result && <span className="truncate italic">{p.result}</span>}
          </td>
          <td className={cn(td, "text-center")} colSpan={2}>
            {p.deadline && <span className="text-[11px] text-ui-fg-muted">{new Date(p.deadline).toLocaleDateString("vi-VN")}</span>}
          </td>
          <td colSpan={3} className={cn(td, "text-center")}>
            <StatusBadge status={p.status} />
          </td>
        </tr>
      ))}
    </>
  )
}

// ─── Hướng dẫn sử dụng ───────────────────────────────────────────────────────

function HuongDanTab({ isManager }: { isManager: boolean }) {
  const sec = "mb-5 rounded-xl border border-ui-border-base bg-ui-bg-base p-5"
  const h2 = "mb-3 flex items-center gap-2 text-[15px] font-bold text-ui-fg-base"
  const p = "text-[13px] leading-relaxed text-ui-fg-subtle"
  const li = "flex items-start gap-2 text-[13px] text-ui-fg-subtle"
  const badge = (color: string, text: string) =>
    <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-bold ${color}`}>{text}</span>

  return (
    <div className="mx-auto max-w-[860px] py-2">

      {/* Tổng quan */}
      <div className={sec}>
        <div className={h2}>📋 Giao Việc MKT là gì?</div>
        <p className={p}>
          Công cụ quản lý công việc nội bộ cho team Marketing của Phan Việt.
          Manager giao việc → MKT nhận, cập nhật tiến độ, điền kết quả → Manager đánh giá.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["≡ List", "Xem danh sách nhóm theo người / loại / tuần"],
            ["▦ Board", "Kanban — kéo thả chuyển trạng thái"],
            ["📅 Lịch", "Xem theo deadline, kéo sang ngày khác"],
            ["📊 Báo cáo", "Thống kê hoàn thành, đúng hạn, đánh giá"],
          ].map(([icon, desc]) => (
            <div key={icon} className="rounded-lg bg-ui-bg-subtle px-3 py-2.5">
              <div className="mb-1 font-bold text-ui-fg-base text-[13px]">{icon}</div>
              <div className="text-[11px] text-ui-fg-muted">{desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Trạng thái */}
      <div className={sec}>
        <div className={h2}>🔄 Trạng thái task</div>
        <div className="flex flex-col gap-2">
          {[
            ["⏳ Chờ làm", "bg-gray-100 text-gray-600 dark:bg-gray-500/10 dark:text-gray-300", "Mới được giao, chưa bắt đầu"],
            ["🚀 Đang làm", "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300", "Đã nhận việc, đang thực hiện"],
            ["✅ Hoàn thành", "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300", "Xong — nhớ điền Kết quả thực tế"],
            ["❌ Đã hủy", "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300", "Không làm nữa (manager hủy)"],
            ["🔴 Bỏ lỡ", "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300", "Qua deadline mà chưa xong — hệ thống tự set"],
          ].map(([label, cls, desc]) => (
            <div key={String(label)} className={li}>
              <span className={`mt-0.5 shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold ${cls}`}>{label}</span>
              <span className="mt-0.5">{desc}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 rounded-lg bg-ui-bg-subtle px-3 py-2 text-[12px] text-ui-fg-muted">
          💡 Bấm vào icon trạng thái ở đầu dòng để chuyển nhanh (Chờ → Đang → Xong). Hoặc mở task, bấm nút trạng thái trong drawer.
        </div>
      </div>

      {/* Luồng MKT */}
      <div className={sec}>
        <div className={h2}>👤 Luồng làm việc cho MKT</div>
        <ol className="flex flex-col gap-3">
          {[
            ["Nhận task", "Bạn thấy task mới trong danh sách (mặc định nhóm theo người nhận). Click để xem chi tiết."],
            ["Đọc đề bài", "Tab \"Chi tiết\": xem Output cần có, Ghi chú / Yêu cầu của manager, Deadline."],
            ["Tự quản tiến độ", "Tab \"Checklist & Kết quả\": thêm các bước nhỏ, tick từng bước khi xong. Tự quản, không cần báo manager."],
            ["Cập nhật trạng thái", "Bấm Đang làm khi bắt đầu, bấm Hoàn thành khi xong."],
            ["Điền kết quả", "Sau khi xong, điền Kết quả thực tế (tab Checklist & Kết quả) — số liệu cụ thể, hành động đã làm."],
            ["Trao đổi", "Dùng phần Trao đổi (tab Chi tiết) để nhắn tin với manager nếu cần làm rõ yêu cầu."],
          ].map(([step, desc], i) => (
            <li key={i} className={li}>
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[11px] font-bold text-white">{i + 1}</span>
              <div>
                <span className="font-semibold text-ui-fg-base">{step}: </span>
                <span>{desc}</span>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* Luồng Manager */}
      {isManager && (
        <div className={sec}>
          <div className={h2}>🎯 Luồng làm việc cho Manager</div>
          <ol className="flex flex-col gap-3">
            {[
              ["Tạo task", "Bấm + Tạo task → điền tiêu đề, loại, người nhận, deadline, output cần có. Có thể đặt task lặp (hằng ngày / tuần / tháng)."],
              ["Theo dõi", "List / Board hiện trạng thái toàn team. Badge ☑3/5 cho biết checklist tiến độ. 💬 hiện số trao đổi."],
              ["Giao tiếp", "Mở task → Trao đổi để nhắn tin trực tiếp. Hệ thống báo khi status thay đổi."],
              ["Đánh giá", "Khi task Hoàn thành, tab Chi tiết hiện mục Đánh giá (⭐ 1–5 sao). Đánh giá giúp MKT biết chất lượng."],
              ["Xem báo cáo", "Tab Báo cáo: tỉ lệ hoàn thành, đúng hạn, điểm trung bình theo từng người. Xem riêng task lặp."],
            ].map(([step, desc], i) => (
              <li key={i} className={li}>
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-bold text-white">{i + 1}</span>
                <div>
                  <span className="font-semibold text-ui-fg-base">{step}: </span>
                  <span>{desc}</span>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Checklist */}
      <div className={sec}>
        <div className={h2}>☑️ Checklist — tự quản bước làm</div>
        <div className="flex flex-col gap-2">
          {[
            "Mở task → bấm tab Checklist & Kết quả",
            "Gõ tên bước vào ô \"+Thêm bước...\" rồi nhấn Enter (hoặc nút +)",
            "Tick checkbox khi hoàn thành bước đó — lưu ngay lập tức",
            "Hover vào bước → bấm ✕ để xoá",
            "Thanh progress bar và số 2/5 cập nhật theo thời gian thực",
            "Tối đa 30 bước mỗi task",
          ].map((t, i) => (
            <div key={i} className={li}>
              <span className="mt-0.5 text-emerald-500">✓</span>
              <span>{t}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Task lặp */}
      <div className={sec}>
        <div className={h2}>🔁 Task lặp (Recurring)</div>
        <p className={cn(p, "mb-3")}>
          Task định kỳ tự động tạo mỗi kỳ (ngày / tuần / tháng). Manager tạo 1 lần, hệ thống sinh task thực tế cho từng kỳ.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {[
            ["📆 Hằng ngày", "Sinh lúc 00:05 sáng mỗi ngày, deadline cuối ngày"],
            ["📅 Hằng tuần", "Sinh thứ Hai, deadline Chủ nhật cùng tuần"],
            ["🗓 Hằng tháng", "Sinh ngày 1, deadline cuối tháng"],
          ].map(([label, desc]) => (
            <div key={String(label)} className="rounded-lg bg-ui-bg-subtle px-3 py-2.5">
              <div className="mb-1 font-bold text-ui-fg-base text-[13px]">{label}</div>
              <div className="text-[11px] text-ui-fg-muted">{desc}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
          ⚠ Task lặp hiển thị nhãn <strong>🔁 kỳ YYYY-MM-DD</strong> để phân biệt với task thường. Badge <strong>Tuần / Ngày</strong> là task mẫu (template).
        </div>
      </div>

      {/* Tips */}
      <div className={sec}>
        <div className={h2}>💡 Mẹo nhanh</div>
        <div className="flex flex-col gap-2">
          {[
            ["Esc", "Đóng drawer task đang mở"],
            ["Click icon trạng thái", "Chuyển nhanh Chờ → Đang → Xong không cần mở drawer"],
            ["Enter trong ô checklist", "Thêm bước mới nhanh hơn bấm nút +"],
            ["Shift+Enter trong Trao đổi", "Xuống dòng (Enter đơn = gửi tin)"],
            ["Tag #", "Gõ tag để phân nhóm nội dung (VD: #SP1, #CAMP_T6). Filter theo tag ở toolbar."],
            ["Tìm kiếm", "Ô 🔍 tìm theo tiêu đề, người nhận, tag — tìm realtime không cần nhấn Enter"],
          ].map(([key, desc]) => (
            <div key={String(key)} className={li}>
              <span className="mt-0.5 shrink-0 rounded bg-ui-bg-component px-1.5 py-0.5 font-mono text-[11px] text-ui-fg-subtle">{key}</span>
              <span>{desc}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}

// ─── Stats view ──────────────────────────────────────────────────────────────

function StatsTab() {
  const [stats, setStats] = useState<any[]>([])
  const [recurring, setRecurring] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch("/admin/mkt-tasks/stats").then(r => r.json()).then(d => {
      setStats(d.stats || [])
      setRecurring(d.recurring || [])
    }).finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="py-12 text-center text-ui-fg-muted">
      <div className="mb-2 text-2xl">⏳</div>Đang tải báo cáo...
    </div>
  )

  const totalDone = stats.reduce((s, m) => s + m.done, 0)
  const totalTasks = stats.reduce((s, m) => s + m.total, 0)
  const overallRate = totalTasks > 0 ? Math.round(totalDone / totalTasks * 100) : 0

  const th = "px-3.5 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-ui-fg-muted bg-ui-bg-subtle border-b border-ui-border-base"
  const td = "px-3.5 py-2.5 text-[13px] border-b border-ui-border-base text-ui-fg-base"

  return (
    <div className="mkt-anim-fadeup">
      <div className="mb-5 grid grid-cols-3 gap-3">
        {[
          { label: "Tổng task", value: totalTasks, cls: "text-ui-fg-base", icon: "📋" },
          { label: "Hoàn thành", value: totalDone, cls: "text-emerald-600 dark:text-emerald-400", icon: "✅" },
          { label: "Tỷ lệ hoàn thành", value: `${overallRate}%`, cls: overallRate >= 70 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400", icon: "📊" },
        ].map(c => (
          <div key={c.label} className="rounded-xl border border-ui-border-base bg-ui-bg-base px-4 py-3.5">
            <div className="text-xl">{c.icon}</div>
            <div className={cn("mt-1 text-2xl font-extrabold tabular-nums", c.cls)}>{c.value}</div>
            <div className="mt-0.5 text-xs text-ui-fg-muted">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-ui-border-base bg-ui-bg-base">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>Thành viên</th>
              <th className={cn(th, "text-center")}>Tổng</th>
              <th className={cn(th, "text-center")}>Đang làm</th>
              <th className={cn(th, "text-center")}>Hoàn thành</th>
              <th className={cn(th, "text-center")}>Bỏ lỡ</th>
              <th className={cn(th, "text-center")}>Quá hạn</th>
              <th className={cn(th, "text-center")}>Đúng hạn</th>
              <th className={cn(th, "text-center")}>Đánh giá TB</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s: any) => (
              <tr key={s.assignee_id} className="transition-colors hover:bg-ui-bg-base-hover">
                <td className={td}>
                  <div className="flex items-center gap-2 font-bold">
                    <Avatar name={s.assignee_name} className="size-6 text-[11px]" />{s.assignee_name}
                  </div>
                  <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-ui-bg-component">
                    <div className={cn("h-full transition-all duration-500", s.done_rate >= 70 ? "bg-emerald-500" : "bg-blue-500")} style={{ width: `${s.done_rate}%` }} />
                  </div>
                </td>
                <td className={cn(td, "text-center font-semibold tabular-nums")}>{s.total}</td>
                <td className={cn(td, "text-center")}><span className="font-bold text-blue-600 dark:text-blue-400">{s.in_progress}</span></td>
                <td className={cn(td, "text-center")}>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">{s.done}</span>
                  <span className="text-[11px] text-ui-fg-muted"> ({s.done_rate}%)</span>
                </td>
                <td className={cn(td, "text-center")}>
                  {(s.missed || 0) > 0
                    ? <span className="font-bold text-rose-600 dark:text-rose-400">{s.missed}</span>
                    : <span className="text-ui-fg-disabled">—</span>}
                </td>
                <td className={cn(td, "text-center")}>
                  {(s.in_progress_overdue || 0) > 0
                    ? <span className="font-bold text-rose-600 dark:text-rose-400">{s.in_progress_overdue}</span>
                    : <span className="text-ui-fg-disabled">—</span>}
                </td>
                <td className={cn(td, "text-center")}>
                  <span className={cn("font-bold", s.on_time_rate >= 80 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>{s.on_time_rate}%</span>
                </td>
                <td className={cn(td, "text-center")}>
                  {s.avg_rating
                    ? <span className="inline-flex items-center gap-1"><Stars value={Math.round(s.avg_rating)} /><span className="text-[11px] text-ui-fg-muted">{s.avg_rating}</span></span>
                    : <span className="text-ui-fg-disabled">—</span>}
                </td>
              </tr>
            ))}
            {stats.length === 0 && (
              <tr><td colSpan={8} className={cn(td, "py-8 text-center text-ui-fg-muted")}>Chưa có dữ liệu thống kê</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Tổng hợp việc lặp ───────────────────────────────────────── */}
      {recurring.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-3 text-sm font-semibold text-ui-fg-base">Tổng hợp việc lặp 🔁</h3>
          <div className="overflow-hidden rounded-xl border border-ui-border-base bg-ui-bg-base">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={th}>Đầu việc</th>
                  <th className={th}>Người nhận</th>
                  <th className={cn(th, "text-center")}>Tần suất</th>
                  <th className={cn(th, "text-center")}>Tổng kỳ</th>
                  <th className={cn(th, "text-center")}>Done</th>
                  <th className={cn(th, "text-center")}>Miss</th>
                  <th className={cn(th, "text-center")}>Tỉ lệ</th>
                </tr>
              </thead>
              <tbody>
                {recurring.map((r: any) => (
                  <RecurringStatsRow key={r.template_id} r={r} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const VIEW_STORAGE_KEY = "mkt-tasks:view"

export default function MktTasksPage() {
  const { has, isSuper, email: currentUserEmail, loading: permsLoading } = useCurrentPermissions()
  const isManager = isSuper || has("page.mkt-tasks.manage")

  const [view, setView] = useState<ViewMode>(() => {
    const saved = localStorage.getItem(VIEW_STORAGE_KEY)
    return (saved === "myday" || saved === "list" || saved === "board" || saved === "calendar") ? saved : "list"
  })
  const [groupBy, setGroupBy] = useState<GroupBy>("assignee")
  const [filterStatus, setFilterStatus] = useState("all")
  const [filterType, setFilterType] = useState("")
  const [filterPriority, setFilterPriority] = useState("")
  const [filterTag, setFilterTag] = useState("")
  const [mineOnly, setMineOnly] = useState(false)
  const [search, setSearch] = useState("")
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [mktUsers, setMktUsers] = useState<MktUser[]>([])
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)

  const showToast = (msg: string, type: "success" | "error") => setToast({ msg, type })
  const setViewPersist = (v: ViewMode) => {
    setView(v)
    if (v !== "stats") localStorage.setItem(VIEW_STORAGE_KEY, v)
  }

  // Fetch flat — mọi grouping/filter phụ làm client-side để 1 fetch phục vụ cả 3 view
  const load = useCallback(() => {
    setLoading(true)
    apiFetch("/admin/mkt-tasks").then(r => r.json()).then(d => {
      setTasks(d.tasks || [])
    }).finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (permsLoading) return
    const saved = localStorage.getItem(VIEW_STORAGE_KEY)
    if (!saved && !isManager) setView("myday")
  }, [permsLoading, isManager])

  useEffect(() => {
    apiFetch("/admin/permissions/mkt-users").then(r => r.json()).then(d => setMktUsers(d.users || []))
  }, [])

  // Deep-link ?task=ID (từ chat context panel)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const taskId = params.get("task")
    if (!taskId) return
    apiFetch(`/admin/mkt-tasks/${taskId}`).then(r => r.json()).then(d => {
      if (d.task) {
        const assignee = d.task.assignee_id
        setSelectedTask({
          tags: [], comments: [], priority: "medium",
          ...d.task,
          assignee_name: d.task.assignee_name || assignee,
        })
      }
    }).catch(() => {})
    // Xoá param khỏi URL (không dùng react-router-dom — Vite không resolve được)
    history.replaceState(null, "", window.location.pathname)
  }, [])

  // Normalize: đảm bảo tags/comments luôn là mảng
  const normalized = useMemo(() => tasks.map(t => ({
    ...t,
    tags: Array.isArray(t.tags) ? t.tags : [],
    comments: Array.isArray(t.comments) ? t.comments : [],
    priority: t.priority || "medium",
  })), [tasks])

  // Apply filters client-side
  const filtered = useMemo(() => {
    let list = normalized
    // Template là "container" — không lọc theo status (chúng luôn status todo). Status filter chỉ áp cho instance/task lẻ.
    if (filterStatus !== "all") list = list.filter(t => t.is_template || t.status === filterStatus)
    if (filterType) list = list.filter(t => t.type === filterType)
    if (filterPriority) list = list.filter(t => t.is_template || t.priority === filterPriority)
    if (filterTag) list = list.filter(t => t.tags.includes(filterTag))
    if (mineOnly && currentUserEmail) list = list.filter(t => t.assignee_id === currentUserEmail)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(t => t.title.toLowerCase().includes(q) || t.assignee_name.toLowerCase().includes(q) || t.tags.some(tag => tag.includes(q)))
    }
    return list
  }, [normalized, filterStatus, filterType, filterPriority, filterTag, mineOnly, currentUserEmail, search])

  // Board/Calendar chỉ hiện instance + task lẻ (template không có deadline/cột trạng thái)
  const boardCalTasks = useMemo(() => filtered.filter(t => !t.is_template), [filtered])
  const myDayTasks = useMemo(() => filtered.filter(t => !t.is_template && t.assignee_id === currentUserEmail), [filtered, currentUserEmail])

  const allTags = useMemo(() => {
    const s = new Set<string>()
    for (const t of normalized) for (const tag of t.tags) s.add(tag)
    return [...s].sort()
  }, [normalized])

  // Group (list view)
  const groups = useMemo(() => {
    const map: Record<string, { tasks: Task[]; assigneeId?: string }> = {}
    for (const t of filtered) {
      let key: string
      if (groupBy === "assignee") key = t.assignee_name
      else if (groupBy === "type") key = TYPE_MAP[t.type]?.label || t.type
      else key = t.deadline ? getWeekKey(new Date(t.deadline)) : "Không có deadline"
      if (!map[key]) map[key] = { tasks: [], assigneeId: groupBy === "assignee" ? t.assignee_id : undefined }
      map[key].tasks.push(t)
    }
    for (const k of Object.keys(map)) map[k].tasks = sortTasks(map[k].tasks)
    return map
  }, [filtered, groupBy])

  const totalTasks = boardCalTasks.length
  const overdueCount = boardCalTasks.filter(isOverdue).length

  // ── Mutations ──────────────────────────────────────────────────────────────

  const applyLocalPatch = (id: string, patch: Partial<Task>) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t))
  }

  const quickStatus = async (t: Task) => {
    const next = STATUS_CYCLE[t.status]
    if (!next) return
    applyLocalPatch(t.id, { status: next as Task["status"] })  // optimistic
    const r = await apiFetch(`/admin/mkt-tasks/${t.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    }).then(r => r.json()).catch(() => null)
    if (!r?.task) {
      applyLocalPatch(t.id, { status: t.status })  // revert
      showToast(r?.error || "Lỗi cập nhật trạng thái", "error")
    }
  }

  // Đổi giai đoạn mua hàng inline (chỉ task type=purchasing)
  const changeStage = async (t: Task, stage: string) => {
    if (t.purchase_stage === stage) return
    const prevStage = t.purchase_stage
    const prevStatus = t.status
    // Optimistic: đổi stage; nếu là bước cuối thì status→done
    const patch: Partial<Task> = { purchase_stage: stage }
    if (stage === "da_nhan_hang" && t.status !== "done") patch.status = "done"
    applyLocalPatch(t.id, patch)
    const r = await apiFetch(`/admin/mkt-tasks/${t.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purchase_stage: stage }),
    }).then(r => r.json()).catch(() => null)
    if (!r?.task) {
      applyLocalPatch(t.id, { purchase_stage: prevStage, status: prevStatus })  // revert
      showToast(r?.error || "Lỗi cập nhật giai đoạn", "error")
    }
  }

  const moveTask = async (taskId: string, status: Task["status"]) => {
    const t = tasks.find(x => x.id === taskId)
    if (!t || t.status === status) return
    const prev = t.status
    applyLocalPatch(taskId, { status })
    const r = await apiFetch(`/admin/mkt-tasks/${taskId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }).then(r => r.json()).catch(() => null)
    if (!r?.task) {
      applyLocalPatch(taskId, { status: prev })
      showToast(r?.error || "Không thể di chuyển task", "error")
    }
  }

  const moveDeadline = async (taskId: string, date: string) => {
    const t = tasks.find(x => x.id === taskId)
    if (!t) return
    const prev = t.deadline
    applyLocalPatch(taskId, { deadline: new Date(date + "T00:00:00").toISOString() })
    const r = await apiFetch(`/admin/mkt-tasks/${taskId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deadline: date }),
    }).then(r => r.json()).catch(() => null)
    if (!r?.task) {
      applyLocalPatch(taskId, { deadline: prev })
      showToast(r?.error || "Không thể đổi deadline (chỉ manager)", "error")
    }
  }

  const createTask = async (payload: Record<string, any>): Promise<boolean> => {
    const r = await apiFetch("/admin/mkt-tasks", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(r => r.json()).catch(() => null)
    if (r?.task) {
      const assigneeName = mktUsers.find(u => u.email === r.task.assignee_id)?.name || r.task.assignee_id
      const newTask: Task = { tags: [], comments: [], priority: "medium", ...r.task, assignee_name: assigneeName }
      setTasks(prev => [newTask, ...prev])
      setFlashId(r.task.id)
      setTimeout(() => setFlashId(null), 1000)
      return true
    }
    showToast(r?.error || "Lỗi tạo task", "error")
    return false
  }

  const canQuick = (t: Task) => isManager || t.assignee_id === currentUserEmail

  // ── Render ─────────────────────────────────────────────────────────────────

  const viewBtn = (v: ViewMode, icon: string, label: string) => (
    <button key={v} onClick={() => setViewPersist(v)}
      className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold transition-all outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40",
        view === v ? "bg-ui-bg-base text-ui-fg-base shadow-sm" : "text-ui-fg-muted hover:text-ui-fg-base")}>
      <span>{icon}</span>{label}
    </button>
  )

  const chipCls = (active: boolean, activeCls?: string) => cn(
    "rounded-full border px-3 py-1 text-xs font-semibold transition-all active:scale-95 outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40",
    active
      ? activeCls || "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-300"
      : "border-ui-border-base bg-ui-bg-base text-ui-fg-muted hover:bg-ui-bg-base-hover hover:text-ui-fg-subtle")

  const selectCls = "rounded-lg border border-ui-border-base bg-ui-bg-field px-2.5 py-1.5 text-xs text-ui-fg-subtle outline-none transition-shadow focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-6">
      <PageStyles />

      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-xl font-extrabold text-ui-fg-base">📋 Giao Việc MKT</h1>
          <div className="mt-1 flex gap-2.5 text-[13px] text-ui-fg-muted">
            <span>{totalTasks} task</span>
            {overdueCount > 0 && <span className="font-semibold text-rose-600 dark:text-rose-400">⚠ {overdueCount} quá hạn</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* View switcher */}
          <div className="flex gap-0.5 rounded-lg bg-ui-bg-component p-0.5">
            {viewBtn("myday", "◉", "Việc của tôi")}
            {viewBtn("list", "≡", "List")}
            {viewBtn("board", "▦", "Board")}
            {viewBtn("calendar", "📅", "Lịch")}
            {isManager && viewBtn("stats", "📊", "Báo cáo")}
            {viewBtn("guide", "❓", "Hướng dẫn")}
          </div>
          <button onClick={() => setShowCreate(true)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-bold text-white shadow-sm shadow-blue-500/30 transition hover:bg-blue-700 active:scale-95 outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40">
            {isManager ? "+ Tạo task" : "+ Tạo việc"}
          </button>
        </div>
      </div>

      {view === "guide" ? <HuongDanTab isManager={isManager} /> : view === "stats" ? <StatsTab /> : (
        <>
          {/* Toolbar */}
          <div className="mb-4 flex flex-wrap items-center gap-2.5">
            {/* Search */}
            <div className="relative max-w-[260px] flex-[1_1_170px]">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-ui-fg-muted">🔍</span>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Tìm task, người, #tag..."
                className={cn(INPUT_CLS, "py-1.5 pl-8", search && "pr-7")}
              />
              {search && (
                <button onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-ui-fg-muted transition-colors hover:text-ui-fg-base">×</button>
              )}
            </div>

            {/* Group-by (list only) */}
            {view === "list" && isManager && (
              <div className="flex gap-0.5 rounded-lg bg-ui-bg-component p-0.5">
                {([["assignee", "Theo người"], ["type", "Theo loại"], ["week", "Theo tuần"]] as [GroupBy, string][]).map(([v, l]) => (
                  <button key={v} onClick={() => setGroupBy(v)}
                    className={cn("rounded-md px-3 py-1 text-xs font-semibold transition-all",
                      groupBy === v ? "bg-ui-bg-base text-ui-fg-base shadow-sm" : "text-ui-fg-muted hover:text-ui-fg-base")}>
                    {l}
                  </button>
                ))}
              </div>
            )}

            {isManager && currentUserEmail && (
              <button onClick={() => setMineOnly(v => !v)} className={chipCls(mineOnly, "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-300")}>Của tôi</button>
            )}

            {/* Status chips */}
            {view !== "board" && (
              <div className="flex flex-wrap gap-1">
                {[
                  { v: "all", l: "Tất cả" },
                  { v: "todo", l: "Chờ làm" },
                  { v: "in_progress", l: "Đang làm" },
                  { v: "pending_review", l: "Chờ duyệt" },
                  { v: "done", l: "Hoàn thành" },
                  { v: "missed", l: "Bỏ lỡ" },
                  { v: "cancelled", l: "Đã hủy" },
                ].map(({ v, l }) => (
                  <button key={v} onClick={() => setFilterStatus(v)} className={chipCls(filterStatus === v)}>{l}</button>
                ))}
              </div>
            )}

            {/* Priority */}
            <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} className={selectCls}>
              <option value="">Mọi ưu tiên</option>
              <option value="high">▲ Cao</option>
              <option value="medium">▪ Vừa</option>
              <option value="low">▾ Thấp</option>
            </select>

            {/* Type */}
            <select value={filterType} onChange={e => setFilterType(e.target.value)} className={selectCls}>
              <option value="">Mọi loại</option>
              <option value="ads_camp">📢 Chạy Ads</option>
              <option value="content_post">✍️ Nội dung</option>
              <option value="purchasing">🛒 Mua hàng</option>
            </select>

            {/* Tag */}
            {allTags.length > 0 && (
              <select value={filterTag} onChange={e => setFilterTag(e.target.value)} className={selectCls}>
                <option value="">Mọi tag</option>
                {allTags.map(t => <option key={t} value={t}>#{t}</option>)}
              </select>
            )}

            {(filterStatus !== "all" || filterType || filterPriority || filterTag || mineOnly || search) && (
              <button onClick={() => { setFilterStatus("all"); setFilterType(""); setFilterPriority(""); setFilterTag(""); setMineOnly(false); setSearch("") }}
                className="text-xs font-medium text-ui-fg-muted underline-offset-2 transition-colors hover:text-ui-fg-base hover:underline">
                Xóa lọc
              </button>
            )}
          </div>

          {/* Content */}
          {loading ? (
            <div className="py-14 text-center text-ui-fg-muted">
              <div className="mb-2 text-2xl">⏳</div>Đang tải...
            </div>
          ) : filtered.length === 0 && view !== "myday" ? (
            <div className="py-14 text-center text-ui-fg-muted">
              <div className="mb-2.5 text-3xl">📭</div>
              {search ? `Không tìm thấy task nào với "${search}"` : "Không có task nào"}
            </div>
          ) : view === "myday" ? (
            <MyDayView
              tasks={myDayTasks}
              onTaskClick={setSelectedTask}
              onQuickStatus={quickStatus}
              canQuick={canQuick}
              onChangeStage={changeStage}
              flashId={flashId}
              onInlineCreate={(title, plannedFor) => createTask({
                title,
                type: "ads_camp",
                assignee_id: isManager ? currentUserEmail : undefined,
                planned_for: plannedFor ? `${plannedFor}T00:00:00+07:00` : null,
                priority: "medium",
              })}
            />
          ) : view === "board" ? (
            <BoardView
              tasks={boardCalTasks}
              onTaskClick={setSelectedTask}
              onMove={moveTask}
              canMove={canQuick}
              isManager={isManager}
              users={mktUsers}
              onInlineCreate={(title, assignee, status) =>
                createTask({ title, type: "ads_camp", assignee_id: assignee, status, priority: "medium" })}
              flashId={flashId}
            />
          ) : view === "calendar" ? (
            <CalendarView
              tasks={boardCalTasks}
              onTaskClick={setSelectedTask}
              onMoveDeadline={moveDeadline}
              canMove={isManager}
              isManager={isManager}
              users={mktUsers}
              onQuickCreate={(title, assignee, deadline) =>
                createTask({ title, type: "ads_camp", assignee_id: assignee, deadline, priority: "medium" })}
            />
          ) : (
            Object.entries(groups).map(([label, g]) => (
              <GroupedSection key={label} label={label} tasks={g.tasks}
                onTaskClick={setSelectedTask}
                onQuickStatus={quickStatus}
                canQuick={canQuick}
                onChangeStage={changeStage}
                isManager={isManager}
                users={mktUsers}
                inlineDefaults={{ assignee_id: g.assigneeId, needAssignee: !g.assigneeId }}
                onInlineCreate={(title, assignee) => createTask({
                  title,
                  type: groupBy === "type" ? (Object.keys(TYPE_MAP).find(k => TYPE_MAP[k].label === label) || "ads_camp") : "ads_camp",
                  assignee_id: g.assigneeId || assignee,
                  priority: "medium",
                })}
                flashId={flashId}
              />
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
          isManager={isManager}
          currentUserEmail={currentUserEmail}
        />
      )}
      {selectedTask && (
        <TaskDrawer
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          isManager={isManager}
          currentUserEmail={currentUserEmail}
          mktUsers={mktUsers}
          onUpdate={(patch) => { if (patch) applyLocalPatch(patch.id, patch) }}
          onDelete={(id) => setTasks(prev => prev.filter(t => t.id !== id))}
          onToast={showToast}
        />
      )}
      {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Giao Việc MKT", rank: 5,
})
