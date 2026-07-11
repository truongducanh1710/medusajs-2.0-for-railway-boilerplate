import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { createPortal } from "react-dom"
import { apiFetch } from "../../lib/api-client"
import { useCurrentPermissions } from "../../lib/use-permissions"
import { ResizeHandle, useResizableColumns, type ColumnDef as ResizableColDef } from "../../lib/resizable-columns"
import { withRouteGuard } from "../../components/route-guard"

// ─── Types ───────────────────────────────────────────────────────────────────

type Comment = { author_id: string; text: string; created_at: string; type?: string }

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
  comments: Comment[]
  customer_name: string | null
  customer_phone: string | null
  pancake_order_id: string | null
  call_stage: string | null
  product_name: string | null
  created_at: string
  updated_at: string
}

type MktProduct = { id: number; name: string; code: string }

type SourceOrder = {
  id: string
  status_name: string
  customer_name: string
  customer_phone: string
  total: number
  cod_amount: number
  tracking_code: string
  province: string
  items: { name: string; qty: number; price: number }[]
  sale_name: string
  pancake_created_at: string | null
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

type CskhCallColumnKey =
  | "select"
  | "customer"
  | "phone"
  | "product"
  | "assignee"
  | "stage"
  | "notes"
  | "rating"
  | "deadline"
  | "delete"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ")
}
function fmt(d: string | null) {
  if (!d) return "—"
  const dt = new Date(d)
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}`
}
function fmtDateTime(d: string | null) {
  if (!d) return "—"
  const dt = new Date(d)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(dt.getHours())}:${pad(dt.getMinutes())} ${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}`
}
function fmtVND(v: number) {
  if (!v) return "0đ"
  return new Intl.NumberFormat("vi-VN").format(v) + "đ"
}
function authorLabel(authorId: string, users: MktUser[]) {
  const u = users.find(u => u.email === authorId)
  return u ? u.name : authorId.includes("@") ? authorId.split("@")[0] : authorId
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

const CSKH_CALL_COLUMN_STORAGE_KEY = "cskh-call.col-widths.v1"
const CSKH_CALL_COLUMN_DEFS: ResizableColDef<CskhCallColumnKey>[] = [
  { id: "select",   label: "",             default: 44,  min: 40 },
  { id: "customer", label: "Khách hàng",   default: 260, min: 120 },
  { id: "phone",    label: "SĐT",          default: 120, min: 96 },
  { id: "product",  label: "Sản phẩm",     default: 240, min: 120 },
  { id: "assignee", label: "Phụ trách",    default: 180, min: 120 },
  { id: "stage",    label: "Giai đoạn gọi", default: 160, min: 140 },
  { id: "notes",    label: "Ghi chú",      default: 180, min: 120 },
  { id: "rating",   label: "★",            default: 80,  min: 64 },
  { id: "deadline", label: "Hạn",          default: 72,  min: 64 },
  { id: "delete",   label: "Xóa",          default: 68,  min: 60 },
]
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

function NoteCell({ comments, users }: { comments: Comment[]; users: MktUser[] }) {
  const [hover, setHover] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const notes = (comments || []).filter(c => !c.type || c.type !== "system")
  if (notes.length === 0) return <span className="text-ui-fg-disabled">·</span>
  const last = notes[notes.length - 1]

  function openPopup() {
    const rect = anchorRef.current?.getBoundingClientRect()
    if (rect) setPos({ top: rect.bottom + 4, left: rect.left })
    setHover(true)
  }

  return (
    <>
      <span
        ref={anchorRef}
        className="cursor-default truncate text-[12px] text-ui-fg-subtle"
        onMouseEnter={openPopup}
        onMouseLeave={() => setHover(false)}
      >
        💬 {last.text.length > 16 ? last.text.slice(0, 16) + "…" : last.text}
      </span>
      {hover && pos && createPortal(
        <div
          style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 99999 }}
          className="max-h-64 w-64 overflow-y-auto rounded-lg border border-ui-border-base bg-ui-bg-base p-2 shadow-xl"
        >
          {[...notes].reverse().map((c, i) => (
            <div key={i} className="mb-1.5 border-b border-ui-border-base pb-1.5 text-[11px] last:mb-0 last:border-0 last:pb-0">
              <div className="mb-0.5 flex items-center justify-between text-ui-fg-subtle">
                <span className="font-semibold text-ui-fg-base">{authorLabel(c.author_id, users)}</span>
                <span>{fmtDateTime(c.created_at)}</span>
              </div>
              <div className="whitespace-pre-wrap text-ui-fg-base">{c.text}</div>
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  )
}

// ─── Bulk create modal ───────────────────────────────────────────────────────

function BulkCreateModal({ users, onClose, onCreated, onToast }: {
  users: MktUser[]
  onClose: () => void
  onCreated: () => void
  onToast: (msg: string, type: "success" | "error") => void
}) {
  const todayStr = new Date().toISOString().slice(0, 10)
  const monthAgoStr = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10)
  const [product, setProduct] = useState<MktProduct | null>(null)
  const [productQuery, setProductQuery] = useState("chảo vàng")
  const [productOptions, setProductOptions] = useState<MktProduct[]>([])
  const [showProductDropdown, setShowProductDropdown] = useState(false)
  const [allProducts, setAllProducts] = useState<MktProduct[]>([])
  const [fromDate, setFromDate] = useState(monthAgoStr)
  const [toDate, setToDate] = useState(todayStr)
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

  useEffect(() => {
    apiFetch("/admin/mkt-tasks/cskh-products").then(r => r.json()).then(d => setAllProducts(d.products || [])).catch(() => {})
  }, [])

  useEffect(() => {
    const q = productQuery.trim().toLowerCase()
    if (!q) { setProductOptions(allProducts.slice(0, 20)); return }
    setProductOptions(
      allProducts.filter(p => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)).slice(0, 20)
    )
  }, [productQuery, allProducts])

  const search = useCallback(async () => {
    const keyword = product?.name || productQuery.trim()
    if (!keyword) { onToast("Chọn sản phẩm trước khi tìm", "error"); return }
    setSearching(true)
    try {
      const params = new URLSearchParams({ keyword, from: fromDate, to: toDate, limit: "200" })
      const r = await apiFetch(`/admin/mkt-tasks/cskh-source?${params.toString()}`)
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
  }, [product, productQuery, fromDate, toDate])

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
        product_name: product?.name || productQuery.trim() || null,
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
            <div className="relative flex-1">
              <input
                value={product ? `${product.code}  ${product.name}` : productQuery}
                onChange={e => { setProduct(null); setProductQuery(e.target.value); setShowProductDropdown(true) }}
                onFocus={() => setShowProductDropdown(true)}
                onBlur={() => setTimeout(() => setShowProductDropdown(false), 150)}
                placeholder="Tìm sản phẩm theo tên hoặc mã POS..."
                className="w-full rounded-lg border border-ui-border-base bg-ui-bg-field px-3 py-1.5 text-[13px] outline-none focus:ring-1 focus:ring-ui-border-interactive" />
              {showProductDropdown && productOptions.length > 0 && (
                <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-ui-border-base bg-ui-bg-base shadow-lg">
                  {productOptions.map(p => (
                    <button key={p.id} type="button"
                      onMouseDown={() => { setProduct(p); setProductQuery(""); setShowProductDropdown(false) }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-ui-bg-subtle-hover">
                      <span className="font-mono font-semibold text-violet-600">{p.code}</span>
                      <span className="text-ui-fg-base">{p.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="rounded-lg border border-ui-border-base bg-ui-bg-field px-2 py-1.5 text-[13px]" />
            <span className="self-center text-ui-fg-subtle">—</span>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="rounded-lg border border-ui-border-base bg-ui-bg-field px-2 py-1.5 text-[13px]" />
            <button onClick={search} disabled={searching || (!product && !productQuery.trim())}
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

function OrderCard({ order }: { order: SourceOrder }) {
  const statusColor = order.status_name?.includes("hủy") ? "text-rose-600"
    : order.status_name?.includes("thành công") || order.status_name?.includes("giao") ? "text-emerald-600" : "text-amber-600"
  return (
    <div className="rounded-lg border border-ui-border-base bg-ui-bg-subtle p-3 text-[12px]">
      <div className="mb-1.5 flex items-center justify-between">
        <a href={`/app/pancake-orders/${order.id}`} className="font-mono font-bold text-blue-600 underline">#{order.id}</a>
        <span className={cn("font-semibold", statusColor)}>{order.status_name || "—"}</span>
      </div>
      <div className="mb-1"><b>{order.customer_name}</b> · <span className="font-mono text-ui-fg-subtle">{order.customer_phone}</span></div>
      {(order.items || []).length > 0 && (
        <div className="mb-1 space-y-0.5 text-ui-fg-subtle">
          {order.items.map((it, i) => <div key={i}>{it.name} x{it.qty} — {fmtVND(it.price)}</div>)}
        </div>
      )}
      <div className="flex items-center justify-between text-ui-fg-subtle">
        <span>{order.province}</span>
        <span className="font-bold text-ui-fg-base">{fmtVND(order.cod_amount || order.total)}</span>
      </div>
      {order.tracking_code && <div className="mt-1 text-ui-fg-subtle">🚚 {order.tracking_code}</div>}
      {order.sale_name && <div className="mt-1 text-ui-fg-subtle">👤 Sale: {order.sale_name}</div>}
    </div>
  )
}

function DetailDrawer({ task, users, canRate, onClose, onPatch, onRate, onCommentAdded, onToast }: {
  task: Task
  users: MktUser[]
  canRate: boolean
  onClose: () => void
  onPatch: (fields: Record<string, any>) => void
  onRate: (rating: number) => void
  onCommentAdded: (comment: Comment) => void
  onToast: (msg: string, type: "success" | "error") => void
}) {
  const [order, setOrder] = useState<SourceOrder | null>(null)
  const [loadingOrder, setLoadingOrder] = useState(false)
  const [noteDraft, setNoteDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [calling, setCalling] = useState(false)
  const [timeline, setTimeline] = useState<{ type: "call" | "note"; at: string; actor: string; text: string }[] | null>(null)
  const [loadingTimeline, setLoadingTimeline] = useState(false)

  async function callCustomer() {
    if (calling || !task.customer_phone) return
    setCalling(true)
    try {
      const r = await apiFetch("/admin/ity-cdr-sync/click2call", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: task.customer_phone, userfield: task.id }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error || "Lỗi gọi")
      onToast("Đã đổ chuông máy nhánh, vui lòng nhấc máy", "success")
    } catch (e: any) {
      onToast(e?.message || "Lỗi gọi", "error")
    } finally {
      setCalling(false)
    }
  }

  useEffect(() => {
    if (!task.pancake_order_id) { setOrder(null); return }
    setLoadingOrder(true)
    apiFetch(`/admin/mkt-tasks/${task.id}`)
      .then(r => r.json())
      .then(d => setOrder(d.source_order || null))
      .finally(() => setLoadingOrder(false))
  }, [task.id, task.pancake_order_id])

  useEffect(() => {
    setLoadingTimeline(true)
    apiFetch(`/admin/mkt-tasks/${task.id}/timeline`)
      .then(r => r.json())
      .then(d => setTimeline(d.events || []))
      .catch(() => setTimeline([]))
      .finally(() => setLoadingTimeline(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, task.call_stage, (task.comments || []).length])

  async function sendNote() {
    if (!noteDraft.trim() || sending) return
    setSending(true)
    try {
      const r = await apiFetch(`/admin/mkt-tasks/${task.id}/comment`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: noteDraft.trim() }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error || "Lỗi gửi ghi chú")
      onCommentAdded(d.comment)
      setNoteDraft("")
    } catch { /* toast do page cha xử lý nếu cần */ }
    finally { setSending(false) }
  }

  const notes = (task.comments || []).filter(c => !c.type || c.type !== "system")

  return (
    <div className="fixed inset-0 z-[9997] flex justify-end bg-black/30" onClick={onClose}>
      <div className="flex h-full w-full max-w-md flex-col bg-ui-bg-base shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex-1 overflow-y-auto p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-[15px] font-bold text-ui-fg-base">{task.title}</h3>
            <button onClick={onClose} className="text-ui-fg-muted hover:text-ui-fg-base">✕</button>
          </div>

          <div className="mb-4 space-y-1 rounded-lg bg-ui-bg-subtle p-3 text-[12px]">
            <div><span className="text-ui-fg-subtle">Khách hàng:</span> <b>{task.customer_name || "—"}</b></div>
            <div className="flex items-center gap-2">
              <span className="text-ui-fg-subtle">SĐT:</span>
              <span className="font-mono">{task.customer_phone}</span>
              <button onClick={callCustomer} disabled={calling || !task.customer_phone}
                className="rounded bg-blue-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-blue-700 disabled:opacity-50">
                {calling ? "Đang gọi..." : "📞 Gọi"}
              </button>
            </div>
            <div><span className="text-ui-fg-subtle">Phụ trách:</span> {task.assignee_name}</div>
          </div>

          {/* Đơn gốc */}
          {task.pancake_order_id && (
            <div className="mb-4">
              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ui-fg-subtle">Đơn gốc</div>
              {loadingOrder && <div className="text-[12px] text-ui-fg-muted">Đang tải...</div>}
              {!loadingOrder && order && <OrderCard order={order} />}
              {!loadingOrder && !order && <div className="text-[12px] text-ui-fg-muted">Không tìm thấy đơn</div>}
            </div>
          )}

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

          {/* Nhật ký ghi chú — mỗi lần ghi 1 dòng kèm người + thời gian */}
          <div className="mb-4">
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ui-fg-subtle">Ghi chú kết quả cuộc gọi</div>
            <div className="mb-2 max-h-48 space-y-2 overflow-y-auto">
              {notes.length === 0 && <div className="text-[12px] text-ui-fg-muted">Chưa có ghi chú nào</div>}
              {notes.map((c, i) => (
                <div key={i} className="rounded-lg bg-ui-bg-subtle px-3 py-2 text-[12px]">
                  <div className="mb-0.5 flex items-center justify-between text-[11px] text-ui-fg-subtle">
                    <span className="font-semibold text-ui-fg-base">{authorLabel(c.author_id, users)}</span>
                    <span>{fmtDateTime(c.created_at)}</span>
                  </div>
                  <div className="whitespace-pre-wrap text-ui-fg-base">{c.text}</div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={noteDraft} onChange={e => setNoteDraft(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") sendNote() }}
                placeholder="Nhập ghi chú (Enter để gửi)"
                className="flex-1 rounded-lg border border-ui-border-base bg-ui-bg-field px-3 py-1.5 text-[13px] outline-none" />
              <button onClick={sendNote} disabled={sending || !noteDraft.trim()}
                className="rounded-lg bg-ui-button-inverted px-3 py-1.5 text-[13px] font-semibold text-ui-fg-on-inverted disabled:opacity-50">
                Gửi
              </button>
            </div>
          </div>

          {task.status === "done" && (
            <div className="mb-4">
              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ui-fg-subtle">Đánh giá</div>
              {canRate ? <Stars value={task.rating} onChange={onRate} /> : <Stars value={task.rating} />}
            </div>
          )}

          {/* Timeline hợp nhất: cuộc gọi thật (CDR tổng đài) + thay đổi trạng thái/ghi chú — để lead sale theo dõi đối chiếu */}
          <div className="mb-4">
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ui-fg-subtle">Lịch sử xử lý (đối chiếu tổng đài)</div>
            <div className="max-h-56 space-y-1.5 overflow-y-auto">
              {loadingTimeline && <div className="text-[12px] text-ui-fg-muted">Đang tải...</div>}
              {!loadingTimeline && timeline?.length === 0 && <div className="text-[12px] text-ui-fg-muted">Chưa có hoạt động nào</div>}
              {!loadingTimeline && timeline?.map((e, i) => (
                <div key={i} className={cn("rounded-lg px-3 py-2 text-[12px]", e.type === "call" ? "bg-blue-50 dark:bg-blue-500/10" : "bg-ui-bg-subtle")}>
                  <div className="mb-0.5 flex items-center justify-between text-[11px] text-ui-fg-subtle">
                    <span className="font-semibold text-ui-fg-base">{e.type === "call" ? "📞" : "💬"} {e.actor}</span>
                    <span>{fmtDateTime(e.at)}</span>
                  </div>
                  <div className="whitespace-pre-wrap text-ui-fg-base">{e.text}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Daily new/old numbers chart ───────────────────────────────────────────────

function DailyCompareChart({ byDay }: { byDay: any[] }) {
  const [agentFilter, setAgentFilter] = useState<string>("all")

  const agents = useMemo(() => {
    const map: Record<string, string> = {}
    for (const d of byDay) for (const a of d.by_agent) map[a.email] = a.name
    return Object.entries(map).map(([email, name]) => ({ email, name }))
  }, [byDay])

  const rows = useMemo(() => byDay.map(d => {
    const agentsList = agentFilter === "all" ? d.by_agent : d.by_agent.filter((a: any) => a.email === agentFilter)
    const new_numbers = agentsList.reduce((s: number, a: any) => s + a.new_numbers, 0)
    const old_numbers = agentsList.reduce((s: number, a: any) => s + a.old_numbers, 0)
    return { day: d.day, new_numbers, old_numbers, total: new_numbers + old_numbers }
  }), [byDay, agentFilter])

  const maxTotal = Math.max(1, ...rows.map(r => r.total))
  const W = 720, H = 220, padL = 32, padB = 28, padT = 12, padR = 12
  const chartW = W - padL - padR, chartH = H - padT - padB
  const barSlot = rows.length > 0 ? chartW / rows.length : chartW
  const barW = Math.min(28, barSlot * 0.5)

  const yFor = (v: number) => padT + chartH - (v / maxTotal) * chartH
  const linePoints = rows.map((r, i) => `${padL + barSlot * i + barSlot / 2},${yFor(r.total)}`).join(" ")

  if (rows.length === 0) {
    return <div className="py-8 text-center text-[12px] text-ui-fg-muted">Chưa có dữ liệu theo ngày trong khoảng đã chọn</div>
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-medium text-ui-fg-subtle">Xem:</span>
        <button type="button" onClick={() => setAgentFilter("all")}
          className={cn("rounded-full border px-2.5 py-1 text-[11px] font-medium",
            agentFilter === "all" ? "border-ui-border-interactive bg-ui-bg-interactive text-ui-fg-on-inverted" : "border-ui-border-base text-ui-fg-subtle")}>
          Tất cả
        </button>
        {agents.map(a => (
          <button key={a.email} type="button" onClick={() => setAgentFilter(a.email)}
            className={cn("rounded-full border px-2.5 py-1 text-[11px] font-medium",
              agentFilter === a.email ? "border-ui-border-interactive bg-ui-bg-interactive text-ui-fg-on-inverted" : "border-ui-border-base text-ui-fg-subtle")}>
            {a.name}
          </button>
        ))}
        <span className="ml-3 flex items-center gap-1 text-[11px] text-ui-fg-subtle"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Số mới</span>
        <span className="flex items-center gap-1 text-[11px] text-ui-fg-subtle"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-400" /> Số cũ</span>
        <span className="flex items-center gap-1 text-[11px] text-ui-fg-subtle"><span className="inline-block h-0.5 w-3 bg-blue-500" /> Tổng</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxWidth: W }}>
        {[0, 0.5, 1].map(f => (
          <line key={f} x1={padL} x2={W - padR} y1={padT + chartH * f} y2={padT + chartH * f} stroke="currentColor" strokeOpacity={0.1} className="text-ui-fg-subtle" />
        ))}
        {rows.map((r, i) => {
          const x = padL + barSlot * i + (barSlot - barW) / 2
          const newH = (r.new_numbers / maxTotal) * chartH
          const oldH = (r.old_numbers / maxTotal) * chartH
          return (
            <g key={r.day}>
              <rect x={x} y={yFor(r.new_numbers)} width={barW} height={newH} fill="#10b981" rx={2} />
              <rect x={x} y={padT + chartH - newH - oldH} width={barW} height={oldH} fill="#fbbf24" rx={2} />
              <text x={x + barW / 2} y={H - 8} textAnchor="middle" className="fill-current text-ui-fg-subtle" fontSize={10}>
                {r.day.slice(5)}
              </text>
              {r.total > 0 && (
                <text x={x + barW / 2} y={yFor(r.total) - 4} textAnchor="middle" className="fill-current text-ui-fg-base" fontSize={10} fontWeight={600}>
                  {r.total}
                </text>
              )}
            </g>
          )
        })}
        <polyline points={linePoints} fill="none" stroke="#3b82f6" strokeWidth={2} />
        {rows.map((r, i) => (
          <circle key={r.day} cx={padL + barSlot * i + barSlot / 2} cy={yFor(r.total)} r={2.5} fill="#3b82f6" />
        ))}
      </svg>
    </div>
  )
}

// ─── Main ────────────────────────────────────────────────────────────────────

function CskhGoiKhachPage() {
  const { has, isSuper, email } = useCurrentPermissions()
  const isManager = isSuper || has("page.mkt-tasks.manage")

  const [tab, setTab] = useState<"all" | "mine" | string>("all")
  const [search, setSearch] = useState("")
  const [changedFrom, setChangedFrom] = useState("")
  const [changedTo, setChangedTo] = useState("")
  const [tasks, setTasks] = useState<Task[]>([])
  const [users, setUsers] = useState<MktUser[]>([])
  const [loading, setLoading] = useState(false)
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null)
  const [view, setView] = useState<"list" | "stats">("list")
  const [stats, setStats] = useState<any[]>([])
  const [compareRows, setCompareRows] = useState<any[]>([])
  const [compareByDay, setCompareByDay] = useState<any[]>([])
  const [compareUnmapped, setCompareUnmapped] = useState(0)
  const [compareLoading, setCompareLoading] = useState(false)
  const todayStr0 = new Date().toISOString().slice(0, 10)
  const [compareFrom, setCompareFrom] = useState(todayStr0)
  const [compareTo, setCompareTo] = useState(todayStr0)
  const [pageSize, setPageSize] = useState(50)
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({})
  const [bulkAssignee, setBulkAssignee] = useState("")
  const [bulkAssigning, setBulkAssigning] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const { colWidths, onResizeMouseDown, resetColWidths } =
    useResizableColumns<CskhCallColumnKey>(CSKH_CALL_COLUMN_STORAGE_KEY, CSKH_CALL_COLUMN_DEFS)
  const visibleColumnDefs = useMemo(() => (
    isManager
      ? CSKH_CALL_COLUMN_DEFS
      : CSKH_CALL_COLUMN_DEFS.filter(c => c.id !== "select" && c.id !== "delete")
  ), [isManager])
  const tableWidth = useMemo(
    () => visibleColumnDefs.reduce((sum, c) => sum + colWidths[c.id], 0),
    [colWidths, visibleColumnDefs]
  )
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

  const loadCompare = useCallback(async () => {
    setCompareLoading(true)
    try {
      const params = new URLSearchParams({
        from: `${compareFrom}T00:00:00+07:00`,
        to: `${compareTo}T23:59:59+07:00`,
      })
      const r = await apiFetch(`/admin/ity-cdr-sync/compare?${params.toString()}`)
      const d = await r.json()
      setCompareRows(d.rows || [])
      setCompareByDay(d.by_day || [])
      setCompareUnmapped(d.unmapped_extension_calls || 0)
    } finally { setCompareLoading(false) }
  }, [compareFrom, compareTo])

  useEffect(() => { loadTasks() }, [loadTasks])
  useEffect(() => { loadUsers() }, [loadUsers])
  useEffect(() => { if (view === "stats") { loadStats(); loadCompare() } }, [view, loadStats, loadCompare])

  const filtered = useMemo(() => {
    let list = tasks
    if (tab !== "all" && tab !== "mine") list = list.filter(t => t.call_stage === tab)
    if (search.trim()) {
      const s = search.toLowerCase()
      list = list.filter(t => (t.customer_name || "").toLowerCase().includes(s) || (t.customer_phone || "").includes(s))
    }
    // Lọc theo đơn có nhân sự gọi/đổi giai đoạn/ghi chú trong khoảng ngày.
    // Chỉ tính event thật (ghi chú tự do, hoặc "Giai đoạn gọi CSKH: ...") — KHÔNG tính
    // các activity log khác (chuyển giao, đổi deadline, đổi ưu tiên...) dù cũng đổi updated_at.
    if (changedFrom || changedTo) {
      const fromTs = changedFrom ? new Date(`${changedFrom}T00:00:00+07:00`).getTime() : -Infinity
      const toTs = changedTo ? new Date(`${changedTo}T23:59:59+07:00`).getTime() : Infinity
      list = list.filter(t => (t.comments || []).some(c => {
        const isRelevant = !c.type || c.type !== "system" || c.text.startsWith("Giai đoạn gọi CSKH:")
        if (!isRelevant) return false
        const ts = new Date(c.created_at).getTime()
        return ts >= fromTs && ts <= toTs
      }))
    }
    return list
  }, [tasks, tab, search, changedFrom, changedTo])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const paged = useMemo(() => {
    const start = (page - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, page, pageSize])

  useEffect(() => { setPage(1) }, [tab, search, pageSize, changedFrom, changedTo])

  const pagedSelectedCount = paged.filter(t => selectedIds[t.id]).length
  const allPagedSelected = paged.length > 0 && pagedSelectedCount === paged.length
  const selectedCount = Object.values(selectedIds).filter(Boolean).length

  function toggleSelect(id: string) {
    setSelectedIds(prev => ({ ...prev, [id]: !prev[id] }))
  }
  function toggleSelectAllPaged() {
    setSelectedIds(prev => {
      const next = { ...prev }
      const shouldSelect = !allPagedSelected
      for (const t of paged) next[t.id] = shouldSelect
      return next
    })
  }
  function clearSelection() { setSelectedIds({}) }

  async function bulkReassign() {
    if (!bulkAssignee || bulkAssigning) return
    const ids = Object.keys(selectedIds).filter(id => selectedIds[id])
    if (!ids.length) return
    setBulkAssigning(true)
    try {
      const results = await Promise.allSettled(
        ids.map(id => apiFetch(`/admin/mkt-tasks/${id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assignee_id: bulkAssignee }),
        }).then(r => r.json().then(d => ({ ok: r.ok, id, d }))))
      )
      const okIds = new Set<string>()
      let failCount = 0
      for (const r of results) {
        if (r.status === "fulfilled" && r.value.ok) okIds.add(r.value.id)
        else failCount++
      }
      const assigneeName = users.find(u => u.email === bulkAssignee)?.name || bulkAssignee
      setTasks(prev => prev.map(t => okIds.has(t.id) ? { ...t, assignee_id: bulkAssignee, assignee_name: assigneeName } : t))
      onToast(failCount ? `Đã chuyển ${okIds.size} việc, lỗi ${failCount}` : `Đã chuyển ${okIds.size} việc cho ${assigneeName}`, failCount ? "error" : "success")
      clearSelection()
      setBulkAssignee("")
    } finally { setBulkAssigning(false) }
  }

  async function bulkDelete() {
    const ids = Object.keys(selectedIds).filter(id => selectedIds[id])
    if (!ids.length || bulkDeleting) return
    if (!confirm(`Xóa ${ids.length} việc đã chọn? Không thể hoàn tác.`)) return
    setBulkDeleting(true)
    try {
      const results = await Promise.allSettled(
        ids.map(id => apiFetch(`/admin/mkt-tasks/${id}`, { method: "DELETE" }).then(r => ({ ok: r.ok, id })))
      )
      const okIds = new Set<string>()
      let failCount = 0
      for (const r of results) {
        if (r.status === "fulfilled" && r.value.ok) okIds.add(r.value.id)
        else failCount++
      }
      setTasks(prev => prev.filter(t => !okIds.has(t.id)))
      onToast(failCount ? `Đã xóa ${okIds.size} việc, lỗi ${failCount}` : `Đã xóa ${okIds.size} việc`, failCount ? "error" : "success")
      clearSelection()
    } finally { setBulkDeleting(false) }
  }

  async function deleteOne(id: string) {
    if (!confirm("Xóa việc này? Không thể hoàn tác.")) return
    try {
      const r = await apiFetch(`/admin/mkt-tasks/${id}`, { method: "DELETE" })
      if (!r.ok) { const d = await r.json(); throw new Error(d?.error || "Lỗi xóa") }
      setTasks(prev => prev.filter(t => t.id !== id))
      setSelectedTask(prev => prev && prev.id === id ? null : prev)
      onToast("Đã xóa", "success")
    } catch (e: any) {
      onToast(e?.message || "Lỗi xóa", "error")
    }
  }

  async function copyPhone(phone: string | null) {
    const value = (phone || "").trim()
    if (!value) return
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
      } else {
        const input = document.createElement("textarea")
        input.value = value
        input.setAttribute("readonly", "")
        input.style.position = "fixed"
        input.style.opacity = "0"
        document.body.appendChild(input)
        input.select()
        document.execCommand("copy")
        document.body.removeChild(input)
      }
      onToast(`\u0110\u00e3 copy S\u0110T ${value}`, "success")
    } catch {
      onToast("Kh\u00f4ng copy \u0111\u01b0\u1ee3c S\u0110T", "error")
    }
  }

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
        <DetailDrawer task={selectedTask} users={users} canRate={isManager} onToast={onToast}
          onClose={() => setSelectedTask(null)}
          onPatch={fields => patchTask(selectedTask.id, fields)}
          onRate={rating => rateTask(selectedTask.id, rating)}
          onCommentAdded={comment => {
            setSelectedTask(prev => prev ? { ...prev, comments: [...(prev.comments || []), comment] } : prev)
            setTasks(prev => prev.map(t => t.id === selectedTask.id ? { ...t, comments: [...(t.comments || []), comment] } : t))
          }} />
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
            <div className="flex items-center gap-2">
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Tìm SĐT/tên"
                className="w-48 rounded-lg border border-ui-border-base bg-ui-bg-field px-3 py-1.5 text-[12px]" />
              <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))}
                className="rounded-lg border border-ui-border-base bg-ui-bg-field px-2 py-1.5 text-[12px]">
                {[20, 50, 100, 200].map(n => <option key={n} value={n}>{n} / trang</option>)}
              </select>
              <button type="button" onClick={resetColWidths}
                className="rounded-lg border border-ui-border-base px-2.5 py-1.5 text-[12px] font-medium text-ui-fg-subtle hover:bg-ui-bg-subtle-hover"
                title="Reset độ rộng cột về mặc định">
                ↻ Reset cột
              </button>
            </div>
          </div>

          {/* Bộ lọc theo thời gian gọi/đổi giai đoạn */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-ui-border-base px-6 py-2">
            <span className="text-[11px] font-medium text-ui-fg-subtle">📅 Đã gọi/đổi giai đoạn:</span>
            {[["Hôm nay", 0], ["7 ngày", 6]].map(([label, daysBack]) => (
              <button key={label as string} type="button"
                onClick={() => {
                  const to = new Date()
                  const from = new Date(Date.now() - Number(daysBack) * 86400_000)
                  setChangedTo(to.toISOString().slice(0, 10))
                  setChangedFrom(from.toISOString().slice(0, 10))
                }}
                className={cn("rounded-full border px-2.5 py-1 text-[11px] font-medium",
                  "border-ui-border-base text-ui-fg-subtle hover:bg-ui-bg-subtle-hover")}>
                {label}
              </button>
            ))}
            <input type="date" value={changedFrom} onChange={e => setChangedFrom(e.target.value)}
              title="Chỉ hiện đơn có gọi/đổi giai đoạn từ ngày này"
              className="rounded-lg border border-ui-border-base bg-ui-bg-field px-2 py-1 text-[12px]" />
            <span className="text-ui-fg-subtle">—</span>
            <input type="date" value={changedTo} onChange={e => setChangedTo(e.target.value)}
              title="Chỉ hiện đơn có gọi/đổi giai đoạn đến ngày này"
              className="rounded-lg border border-ui-border-base bg-ui-bg-field px-2 py-1 text-[12px]" />
            {(changedFrom || changedTo) && (
              <button type="button" onClick={() => { setChangedFrom(""); setChangedTo("") }}
                className="rounded-full border border-ui-border-base px-2.5 py-1 text-[11px] font-medium text-rose-600 hover:bg-rose-50"
                title="Xóa bộ lọc, hiện tất cả">✕ Hiện tất cả</button>
            )}
          </div>

          {/* Bulk action toolbar */}
          {isManager && selectedCount > 0 && (
            <div className="flex items-center gap-2 border-b border-ui-border-base bg-blue-50 px-6 py-2 dark:bg-blue-500/10">
              <span className="text-[12px] font-semibold text-ui-fg-base">Đã chọn {selectedCount} việc</span>
              <select value={bulkAssignee} onChange={e => setBulkAssignee(e.target.value)}
                className="rounded-lg border border-ui-border-base bg-ui-bg-field px-2 py-1 text-[12px]">
                <option value="">— Chuyển cho —</option>
                {users.map(u => <option key={u.email} value={u.email}>{u.name}</option>)}
              </select>
              <button onClick={bulkReassign} disabled={!bulkAssignee || bulkAssigning}
                className="rounded-lg bg-ui-button-inverted px-3 py-1 text-[12px] font-semibold text-ui-fg-on-inverted disabled:opacity-50">
                {bulkAssigning ? "Đang chuyển..." : "Chuyển phụ trách"}
              </button>
              <button onClick={bulkDelete} disabled={bulkDeleting}
                className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1 text-[12px] font-semibold text-rose-600 hover:bg-rose-100 disabled:opacity-50">
                {bulkDeleting ? "Đang xóa..." : "Xóa đã chọn"}
              </button>
              <button onClick={clearSelection} className="ml-auto text-[12px] text-ui-fg-subtle hover:text-ui-fg-base">Bỏ chọn</button>
            </div>
          )}

          {/* List */}
          <div className="px-6 py-3">
            {loading && <div className="py-10 text-center text-ui-fg-muted">Đang tải...</div>}
            {!loading && filtered.length === 0 && <div className="py-10 text-center text-ui-fg-muted">Không có việc nào</div>}
            {!loading && filtered.length > 0 && (
              <>
                <div className="overflow-x-auto">
                  <table
                    className="text-[13px]"
                    style={{
                      tableLayout: "fixed",
                      width: `${tableWidth}px`,
                    }}
                  >
                    <colgroup>
                      {visibleColumnDefs.map((c) => (
                        <col key={c.id} style={{ width: `${colWidths[c.id]}px` }} />
                      ))}
                    </colgroup>
                    <thead>
                      <tr className="border-b border-ui-border-base text-left text-[11px] uppercase text-ui-fg-subtle">
                        {(() => {
                          const Th = ({ id, children, align = "left" }: { id: CskhCallColumnKey; children: any; align?: "left" | "right" | "center" }) => (
                            <th className={cn("relative overflow-hidden px-3 py-2 font-semibold", align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left")}>
                              <span className="block truncate" title={typeof children === "string" ? children : undefined}>{children}</span>
                              <ResizeHandle onMouseDown={onResizeMouseDown(id)} />
                            </th>
                          )
                          return (
                            <>
                              {isManager && (
                                <Th id="select" align="center">
                                  <input type="checkbox" checked={allPagedSelected} onChange={toggleSelectAllPaged} onClick={e => e.stopPropagation()} />
                                </Th>
                              )}
                              <Th id="customer">Khách hàng</Th>
                              <Th id="phone">SĐT</Th>
                              <Th id="product">Sản phẩm</Th>
                              <Th id="assignee">Phụ trách</Th>
                              <Th id="stage">Giai đoạn gọi</Th>
                              <Th id="notes">Ghi chú</Th>
                              <Th id="rating">★</Th>
                              <Th id="deadline">Hạn</Th>
                              {isManager && <Th id="delete" align="right">Xóa</Th>}
                            </>
                          )
                        })()}
                      </tr>
                    </thead>
                  <tbody>
                    {paged.map(t => (
                      <tr key={t.id} onClick={() => setSelectedTask(t)} className="cursor-pointer border-b border-ui-border-base last:border-0 hover:bg-ui-bg-subtle-hover">
                        {isManager && (
                          <td className="py-2 pr-3 text-center">
                            <input type="checkbox" checked={!!selectedIds[t.id]} onClick={e => e.stopPropagation()} onChange={() => toggleSelect(t.id)} />
                          </td>
                        )}
                        <td className="truncate py-2 pr-3 font-medium" title={t.customer_name || ""}>{t.customer_name || "—"}</td>
                        <td className="truncate py-2 pr-3">
                          <button type="button" onClick={(e) => { e.stopPropagation(); copyPhone(t.customer_phone) }}
                            className="font-mono text-ui-fg-subtle underline-offset-2 hover:text-ui-fg-base hover:underline"
                            title={"B\u1ea5m \u0111\u1ec3 copy s\u1ed1 \u0111i\u1ec7n tho\u1ea1i"}>
                            {t.customer_phone || "\u2014"}
                          </button>
                        </td>
                        <td className="truncate py-2 pr-3 text-ui-fg-subtle" title={t.product_name || ""}>{t.product_name || "—"}</td>
                        <td className="truncate py-2 pr-3 text-ui-fg-subtle" title={t.assignee_name}>👤 {t.assignee_name}</td>
                        <td className="py-2 pr-3">
                          <CallStageSelect value={t.call_stage} disabled={false} onChange={v => patchTask(t.id, { call_stage: v })} />
                        </td>
                        <td className="truncate py-2 pr-3"><NoteCell comments={t.comments} users={users} /></td>
                        <td className="truncate py-2 pr-3">{t.status === "done" ? <Stars value={t.rating} /> : "·"}</td>
                        <td className="truncate py-2 pr-3 text-ui-fg-subtle">{fmt(t.deadline)}</td>
                        {isManager && (
                          <td className="py-2 pr-3 text-right">
                            <button onClick={(e) => { e.stopPropagation(); deleteOne(t.id) }}
                              className="rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-100">
                              Xóa
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  </table>
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-between py-3 text-[12px] text-ui-fg-subtle">
                  <span>{filtered.length} việc · Trang {page}/{totalPages}</span>
                  <div className="flex gap-1.5">
                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                      className="rounded-lg border border-ui-border-base px-2.5 py-1 disabled:opacity-40">‹ Trước</button>
                    <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                      className="rounded-lg border border-ui-border-base px-2.5 py-1 disabled:opacity-40">Sau ›</button>
                  </div>
                </div>
              </>
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

          <div className="mt-8 mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[13px] font-bold uppercase tracking-wide text-ui-fg-subtle">
              📞 Đối chiếu cuộc gọi thật (tổng đài) vs task đã xử lý
            </h2>
            <div className="flex items-center gap-1.5">
              <button type="button"
                onClick={() => {
                  const today = new Date().toISOString().slice(0, 10)
                  setCompareFrom(today); setCompareTo(today)
                }}
                className="rounded-full border border-ui-border-base px-2.5 py-1 text-[11px] font-medium text-ui-fg-subtle hover:bg-ui-bg-subtle-hover">
                Hôm nay
              </button>
              <button type="button"
                onClick={() => {
                  const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10)
                  setCompareFrom(yesterday); setCompareTo(yesterday)
                }}
                className="rounded-full border border-ui-border-base px-2.5 py-1 text-[11px] font-medium text-ui-fg-subtle hover:bg-ui-bg-subtle-hover">
                Hôm qua
              </button>
              {[["7 ngày", 6], ["30 ngày", 29]].map(([label, daysBack]) => (
                <button key={label as string} type="button"
                  onClick={() => {
                    const to = new Date()
                    const from = new Date(Date.now() - Number(daysBack) * 86400_000)
                    setCompareTo(to.toISOString().slice(0, 10))
                    setCompareFrom(from.toISOString().slice(0, 10))
                  }}
                  className="rounded-full border border-ui-border-base px-2.5 py-1 text-[11px] font-medium text-ui-fg-subtle hover:bg-ui-bg-subtle-hover">
                  {label}
                </button>
              ))}
              <input type="date" value={compareFrom} onChange={e => setCompareFrom(e.target.value)}
                className="rounded-lg border border-ui-border-base bg-ui-bg-field px-2 py-1 text-[12px]" />
              <span className="text-ui-fg-subtle">—</span>
              <input type="date" value={compareTo} onChange={e => setCompareTo(e.target.value)}
                className="rounded-lg border border-ui-border-base bg-ui-bg-field px-2 py-1 text-[12px]" />
              {compareLoading && <span className="text-[12px] text-ui-fg-muted">Đang tải...</span>}
            </div>
          </div>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-ui-border-base text-left text-[11px] uppercase text-ui-fg-subtle">
                <th className="py-2">Nhân viên</th>
                <th className="py-2">Cuộc gọi thật (CDR)</th>
                <th className="py-2">Trong đó nghe máy</th>
                <th className="py-2">Task đã xử lý</th>
                <th className="py-2">Số mới</th>
                <th className="py-2">Số cũ (tồn đọng)</th>
                <th className="py-2">Chênh lệch</th>
              </tr>
            </thead>
            <tbody>
              {compareRows.map(r => (
                <tr key={r.email} className="border-b border-ui-border-base last:border-0">
                  <td className="py-2 font-medium">{r.name}</td>
                  <td className="py-2">{r.real_calls}</td>
                  <td className="py-2">{r.real_answered}</td>
                  <td className="py-2">{r.task_calls}</td>
                  <td className="py-2 text-emerald-600">{r.new_numbers}</td>
                  <td className="py-2 text-amber-600">{r.old_numbers}</td>
                  <td className={cn("py-2 font-semibold", r.diff === 0 ? "text-ui-fg-subtle" : r.diff > 0 ? "text-amber-600" : "text-rose-600")}>
                    {r.diff > 0 ? `+${r.diff}` : r.diff}
                  </td>
                </tr>
              ))}
              {!compareLoading && compareRows.length === 0 && (
                <tr><td colSpan={7} className="py-6 text-center text-ui-fg-muted">Chưa có dữ liệu hôm nay</td></tr>
              )}
            </tbody>
          </table>
          {compareUnmapped > 0 && (
            <div className="mt-2 text-[12px] text-ui-fg-muted">
              ⚠ {compareUnmapped} cuộc gọi từ extension chưa gán nhân viên (xem trang ITY CDR để gán).
            </div>
          )}

          <h2 className="mt-8 mb-2 text-[13px] font-bold uppercase tracking-wide text-ui-fg-subtle">
            📈 Theo dõi hằng ngày — số mới vs số cũ
          </h2>
          <DailyCompareChart byDay={compareByDay} />
        </div>
      )}
    </div>
  )
}

export const config = defineRouteConfig({ label: "CSKH Gọi khách", rank: 13 })

export default withRouteGuard(CskhGoiKhachPage)
