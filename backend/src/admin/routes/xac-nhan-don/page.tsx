import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useEffect, useMemo, useRef, useState } from "react"
import { apiFetch } from "../../lib/api-client"
import { click2call, CallExtensionPicker } from "../../lib/click2call"
import SalePeriodSummary from "../../components/sale-period-summary"
import { withRouteGuard } from "../../components/route-guard"
import AddressPicker, { type AddressValue, type Suggestion, suggestFrom } from "../../components/address-picker"
import { RepChip, repTier } from "../../components/reputation-bar"
import XacNhanGuide from "../../components/xac-nhan-guide"

// Hàng đợi việc của sale: mọi đơn chưa xử lý xong (không lọc theo ngày), sắp theo hạn của
// việc tiếp theo. Mỗi cuộc gọi phải ghi đúng 1 kết quả → 1 note trên POS.

// ---- Helpers ----

const fmtVND = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(n || 0)) + "đ"
const pad = (x: number) => String(x).padStart(2, "0")
function fmtTime(iso: string | number | null) {
  if (!iso) return "—"
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`
}
function fmtDue(iso: string) {
  const diff = Date.parse(iso) - Date.now()
  const abs = Math.abs(diff)
  const txt = abs < 3600_000 ? `${Math.round(abs / 60_000)}p` : abs < 86400_000 ? `${Math.round(abs / 3600_000)}h` : `${Math.round(abs / 86400_000)} ngày`
  return diff < 0 ? `Quá ${txt}` : `Còn ${txt}`
}
const fold = (s: string) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d")
/** YYYY-MM-DD in Vietnam time — never parse a bare date with new Date() (reads as UTC). */
function vnDate(ms: number) {
  return new Date(ms + 7 * 3600_000).toISOString().slice(0, 10)
}
function toLocalInput(ms: number) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Network-wide return rate from Pancake: ≥30% or a POS warning means "confirm carefully".
function repBadEarly(rep: any) {
  return !!rep?.available && rep.return_rate !== null && (rep.return_rate >= 30 || rep.flagged)
}

// Mirrors CSKH_BLOCKS in lib/cskh-queue.ts (server lib uses pg, so it can't be imported here).
const CSKH_PERSON = "HADTT"
const CSKH_BLOCKS_UI: [number, number, string][] = [[510, 570, "8:30–9:30"], [660, 690, "11:00–11:30"], [900, 960, "15:00–16:00"]]
function cskhBlockNow(): string | null {
  const vn = new Date(Date.now() + 7 * 3600_000)
  const m = vn.getUTCHours() * 60 + vn.getUTCMinutes()
  return CSKH_BLOCKS_UI.find(([s, e]) => m >= s && m < e)?.[2] ?? null
}

const PENDING_KEY = "xac-nhan-don.pending-call"
function readPending(): { orderId: string; at: number; name: string } | null {
  try {
    const v = JSON.parse(localStorage.getItem(PENDING_KEY) || "null")
    // A forgotten call older than 12h no longer blocks — the compliance flag still records it.
    return v && Date.now() - v.at < 12 * 3600_000 ? v : null
  } catch {
    return null
  }
}

const BUCKET_STYLE: Record<string, string> = {
  overdue: "bg-red-100 text-red-700",
  now: "bg-orange-100 text-orange-700",
  later: "bg-gray-100 text-gray-600",
  cancel: "bg-gray-200 text-gray-700",
}

const OUTCOMES = [
  { key: "chot", label: "Chốt đơn", cls: "border-green-400 text-green-700" },
  { key: "knm", label: "KNM", cls: "border-gray-300" },
  { key: "may_ban", label: "Máy bận", cls: "border-gray-300" },
  { key: "thue_bao", label: "Thuê bao", cls: "border-gray-300" },
  { key: "zalo", label: "Đã nhắn Zalo", cls: "border-gray-300" },
  { key: "hen", label: "Hẹn gọi lại", cls: "border-violet-400 text-violet-700" },
  { key: "huy", label: "Đề xuất hủy", cls: "border-red-300 text-red-700" },
  { key: "note", label: "Chỉ ghi note", cls: "border-gray-300" },
]
const PRINT_CHIPS = ["Cho xem hàng", "Gọi trước khi giao", "Giao giờ hành chính", "Không cho thử"]

// ---- Order card (edit + call result) ----

function OrderCard({ row, tagInfo, onClose, onSaved, pending, setPending }: {
  row: any
  tagInfo: any
  onClose: () => void
  onSaved: (msg: string, warnings: string[]) => void
  pending: ReturnType<typeof readPending>
  setPending: (p: ReturnType<typeof readPending>) => void
}) {
  const [o, setO] = useState<any>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [rep, setRep] = useState<any>(null)
  const [items, setItems] = useState<any[]>([])
  const [discount, setDiscount] = useState(0)
  const [ship, setShip] = useState(0)
  const [freeShip, setFreeShip] = useState(false)
  const [addr, setAddr] = useState<AddressValue>({ provinceId: "", communeId: "" })
  const provinceId = addr.provinceId
  const communeId = addr.communeId
  const [street, setStreet] = useState("")
  const [notePrint, setNotePrint] = useState("")
  const [productQ, setProductQ] = useState("")
  const [productRes, setProductRes] = useState<any[]>([])
  const [inStockOnly, setInStockOnly] = useState(true)
  const [outcome, setOutcome] = useState<string>("")
  const [henAt, setHenAt] = useState(toLocalInput(Date.now() + 2 * 3600_000))
  const [cancelReason, setCancelReason] = useState("Khách không đặt")
  // Tags the sale adds in this card. Tags already on the POS order are never removed here.
  const [addTags, setAddTags] = useState<number[]>([])
  const [tagQ, setTagQ] = useState("")
  const [extra, setExtra] = useState("")
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [calling, setCalling] = useState(false)
  const [addrSugg, setAddrSugg] = useState<Suggestion | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)

  const load = async () => {
    setLoadErr(null)
    const r = await apiFetch(`/admin/pancake-sync/call-board/order?id=${row.id}`)
    const d = await r.json()
    if (!r.ok) return setLoadErr(d.error || "Không tải được đơn")
    setO(d)
    setItems(d.items.map((i: any) => ({ ...i })))
    setDiscount(d.discount || 0)
    setShip(d.shipping_fee || 0)
    setFreeShip(!!d.is_free_shipping)
    setAddr({ provinceId: d.address.province_id || "", communeId: d.address.commune_id || "" })
    setStreet(d.address.address || "")
    setNotePrint(d.note_print || "")
    setAddTags([])
  }
  useEffect(() => {
    load()
    if (row.customer_phone) {
      apiFetch(`/admin/pancake-sync/call-board/reputation?phone=${encodeURIComponent(row.customer_phone)}`)
        .then((r) => r.json()).then(setRep).catch(() => setRep({ available: false }))
    }
  }, [row.id])

  // Address suggestion for the "Địa chỉ giao" check box (only when POS has no ward yet).
  useEffect(() => {
    setAddrSugg(null)
    if (!o || o.address.commune_id || o.status !== 0) return
    suggestFrom(o.address.full_address || o.address.address || "").then(setAddrSugg).catch(() => {})
  }, [o?.id])

  useEffect(() => {
    const q = productQ.trim()
    if (!q) return setProductRes([])
    const t = setTimeout(() => {
      apiFetch(`/admin/pancake-sync/call-board/products?q=${encodeURIComponent(q)}&in_stock=${inStockOnly ? 1 : 0}`)
        .then((r) => r.json()).then((d) => setProductRes(d.products ?? [])).catch(() => setProductRes([]))
    }, 250)
    return () => clearTimeout(t)
  }, [productQ, inStockOnly])

  if (loadErr) {
    return (
      <Overlay onClose={onClose}>
        <p className="text-red-600 text-sm">{loadErr}</p>
        <button onClick={load} className="mt-3 px-3 py-1.5 border rounded text-sm">Thử lại</button>
      </Overlay>
    )
  }
  if (!o) return <Overlay onClose={onClose}><p className="text-gray-400 text-sm">Đang tải đơn từ POS...</p></Overlay>

  const editable = o.status === 0
  const subtotal = items.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.price || 0), 0)
  const cod = Math.max(0, subtotal - discount + (freeShip ? 0 : ship) - (o.prepaid || 0))
  const pkg = o.pkg
  const pkgMatch = pkg?.price ? cod === pkg.price : null
  const province = addr.provinceName ? { name: addr.provinceName } : null
  const commune = addr.communeName ? { name: addr.communeName } : null

  const itemsChanged = JSON.stringify(items.map((i) => [i.variation_id, i.name, +i.quantity, +i.price]))
    !== JSON.stringify(o.items.map((i: any) => [i.variation_id, i.name, +i.quantity, +i.price]))
  const addrChanged = (provinceId || "") !== (o.address.province_id || "") || (communeId || "") !== (o.address.commune_id || "") || street !== (o.address.address || "")
  const edits: any = {}
  if (itemsChanged) edits.items = items.map((i) => ({ variation_id: i.variation_id, name: i.name, quantity: +i.quantity, price: +i.price }))
  if (discount !== (o.discount || 0)) edits.discount = discount
  if (ship !== (o.shipping_fee || 0)) edits.shipping_fee = ship
  if (freeShip !== !!o.is_free_shipping) edits.is_free_shipping = freeShip
  if (addrChanged) edits.address = { province_id: provinceId, commune_id: communeId, address: street, province_name: province?.name, commune_name: commune?.name }
  if (notePrint !== (o.note_print || "")) edits.note_print = notePrint
  const orderChanged = Object.keys(edits).length > 0
  if (addTags.length) edits.add_tags = addTags
  const hasEdits = Object.keys(edits).length > 0

  // ---- Tag suggestions (sale clicks to add; nothing is tagged automatically) ----
  const allTags: any[] = tagInfo?.tags ?? []
  const tagName = (id: number) => allTags.find((t) => t.id === id)?.name ?? `#${id}`
  const currentTagIds: number[] = o.tags.map((t: any) => Number(t.id))
  const hasTag = (id: number) => currentTagIds.includes(id) || addTags.includes(id)
  const sg = tagInfo?.suggest
  const suggestions: { id: number; why: string }[] = []
  if (sg) {
    if (["knm", "may_ban", "thue_bao"].includes(outcome)) {
      const level = Math.max(0, ...currentTagIds.map((id) => sg.goi_lan.indexOf(id) + 1))
      suggestions.push({ id: sg.goi_lan[Math.min(level, sg.goi_lan.length - 1)], why: "gọi không được" })
    }
    if (outcome === "chot") suggestions.push({ id: sg.sale_chot, why: "đã chốt" })
    if (outcome === "hen") suggestions.push({ id: sg.suy_nghi, why: "khách hẹn" })
    if (outcome === "huy") {
      suggestions.push({ id: sg.khach_khong_dat, why: "hủy" })
      const r = (tagInfo?.cancel_reasons ?? []).find((x: any) => x.label === cancelReason)
      if (r && r.id !== sg.khach_khong_dat) suggestions.push({ id: r.id, why: "lý do hủy" })
    }
    if (orderChanged && (edits.items || edits.discount !== undefined || edits.address)) suggestions.push({ id: sg.sua_don, why: "đã sửa đơn" })
    if (o.duplicated_phone) suggestions.push({ id: sg.don_trung, why: "trùng SĐT" })
    if (repBadEarly(rep)) suggestions.push({ id: sg.rui_ro, why: "tỷ lệ hoàn cao" })
    if (!communeId && !o.address.commune_id) suggestions.push({ id: sg.thieu_dia_chi, why: "chưa có xã" })
  }
  const shownSuggestions = suggestions.filter((s, i, arr) => !hasTag(s.id) && arr.findIndex((x) => x.id === s.id) === i)
  const tagSearch = fold(tagQ.trim())
  const tagResults = tagSearch
    ? allTags.filter((t) => !t.system && !hasTag(t.id) && fold(t.name).includes(tagSearch)).slice(0, 12)
    : (tagInfo?.quick ?? []).filter((id: number) => !hasTag(id)).map((id: number) => allTags.find((t) => t.id === id)).filter(Boolean)
  const missingCommune = !communeId
  const bigDiscount = subtotal > 0 && discount > subtotal * 0.15

  const applyPackage = () => {
    if (!pkg?.price) return
    if (pkg.freeship) { setFreeShip(true); setShip(0) }
    const shipPart = pkg.freeship ? 0 : (freeShip ? 0 : ship)
    setDiscount(Math.max(0, subtotal + shipPart - (o.prepaid || 0) - pkg.price))
  }

  const call = async () => {
    if (pending && pending.orderId !== String(row.id)) return
    if (!editable) return setErr("Đơn đã rời trạng thái Mới — gọi từ POS nếu cần")
    setCalling(true)
    setErr(null)
    try {
      await click2call(o.customer.phone, `order:${row.id}`)
      const p = { orderId: String(row.id), at: Date.now(), name: row.customer_name }
      localStorage.setItem(PENDING_KEY, JSON.stringify(p))
      setPending(p)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setCalling(false)
    }
  }

  const save = async () => {
    setErr(null)
    if (!outcome) return setErr("Chọn kết quả cuộc gọi")
    if (outcome === "chot" && missingCommune) return setErr("Chọn phường/xã trước khi chốt — kho không giao được")
    if (outcome === "chot" && !items.length) return setErr("Đơn chưa có sản phẩm")
    if (bigDiscount && edits.discount !== undefined && !extra.trim()) return setErr("Giảm trên 15% tiền hàng — ghi lý do vào ô ghi thêm")
    if (edits.address && (!provinceId || !communeId)) return setErr("Chọn đủ tỉnh và phường/xã")
    setSaving(true)
    try {
      const r = await apiFetch("/admin/pancake-sync/call-board/result", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: row.id,
          outcome,
          callback_at: outcome === "hen" ? new Date(henAt).toISOString() : undefined,
          cancel_reason: outcome === "huy" ? cancelReason : undefined,
          extra_note: extra.trim() || undefined,
          base_updated_at: o.updated_at,
          edits: hasEdits && editable ? edits : undefined,
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || "Lưu thất bại")
      if (pending?.orderId === String(row.id)) {
        localStorage.removeItem(PENDING_KEY)
        setPending(null)
      }
      onSaved(d.message, d.warnings ?? [])
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }


  // ---- Layout (top → bottom = how often the sale needs it during a call) ----
  const tagNames: string[] = o.tags.map((t: any) => t.name)
  const draft = tagNames.some(isDraftTag)
  const [repLabel, repTone] = (() => { const t = repTier(rep); return [t.label, t.tone] as const })()
  const repTotal = (rep?.success ?? 0) + (rep?.fail ?? 0)
  const posHasWard = !!o.address.commune_id
  const addrOk = !!communeId
  const history = [
    ...o.notes.map((n: any) => ({ at: n.at, text: `📝 ${n.by ? n.by + ": " : ""}${n.message}`, warn: false })),
    ...(row.calls ?? []).map((c: any) => ({ at: Date.parse(c.at), text: `📞 ${c.talk_sec > 0 ? `Nghe máy ${c.talk_sec}s` : "Không nghe máy"}${c.noted ? "" : " — chưa có note"}`, warn: !c.noted })),
  ].sort((a, b) => b.at - a.at)
  const callBlocked = !!pending && pending.orderId !== String(row.id)

  return (
    <SideSheet onClose={onClose} onKey={(e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); save() }
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      if (e.key === "Escape") return onClose()
      const idx = Number(e.key) - 1
      if (idx >= 0 && idx < OUTCOMES.length) setOutcome(OUTCOMES[idx].key)
    }}>
      {/* 1. Sticky header: draft badge first, who, phone, call */}
      <div className="sticky top-0 z-10 bg-white border-b pt-4 pb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {draft && <span className="px-2.5 py-1 rounded-md bg-amber-500 text-white text-sm font-bold tracking-wider ring-4 ring-amber-100">ĐƠN NHÁP</span>}
            <span className="text-xl font-semibold">{o.customer.name}</span>
            <span className="font-mono text-gray-500">{o.customer.phone}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {tagNames.filter((t) => !isDraftTag(t)).map((t) => (
              <span key={t} className={`px-2 py-0.5 rounded-full text-xs font-medium ${TAG_TONE(t)}`}>{tagLabel(t)}</span>
            ))}
            {o.duplicated_phone && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Trùng SĐT với đơn khác</span>}
            <span className="text-xs text-gray-500">#{o.id} · {row.next?.label ?? o.status_name} · gọi {row.call_attempts ?? 0} lần / {o.notes.length} note</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <CallExtensionPicker />
          <button onClick={call} disabled={calling || callBlocked}
            title={callBlocked ? `Ghi kết quả cuộc gọi ${pending!.name} trước` : ""}
            className="px-4 py-2.5 bg-violet-600 text-white rounded-lg font-semibold hover:bg-violet-700 disabled:opacity-40">
            {calling ? "Đang gọi..." : "📞 Gọi"}
          </button>
          <button onClick={onClose} aria-label="Đóng" className="px-3 py-2 border rounded-lg text-gray-500 hover:bg-gray-50">✕</button>
        </div>
      </div>

      {!editable && (
        <div className="mt-3 p-2 rounded bg-yellow-50 text-yellow-800 text-sm">Đơn đã ở trạng thái "{o.status_name}" trên POS — chỉ ghi note, không sửa được.</div>
      )}

      {/* 2. Check before confirming: package vs COD · reputation · address */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
        <div className={`rounded-xl border-2 p-3 flex flex-col gap-1 ${pkg?.price && !pkgMatch ? "border-red-400 bg-red-50" : "border-green-300 bg-green-50"}`}>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Gói khách chọn</div>
          <div className="font-semibold leading-snug">{pkg ? pkg.text : "Không có thông tin gói"}</div>
          {pkg?.price ? (pkgMatch
            ? <div className="text-sm text-green-700">✓ Khớp: thu {fmtVND(cod)}</div>
            : <>
                <div className="text-sm text-red-700">Đơn thu <b>{fmtVND(cod)}</b> · gói <b>{fmtVND(pkg.price)}</b></div>
                {editable && <button onClick={applyPackage} className="self-start mt-1 px-3 py-1.5 bg-violet-600 text-white rounded-lg text-sm font-semibold">Áp đúng gói {fmtVND(pkg.price)}</button>}
              </>)
            : <div className="text-sm text-gray-600">COD {fmtVND(cod)}</div>}
        </div>

        <div className={`rounded-xl border-2 p-3 flex flex-col gap-1 ${repTone === "bad" ? "border-red-400 bg-red-50" : repTone === "good" ? "border-green-300 bg-green-50" : "border-gray-200 bg-gray-50"}`}>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Uy tín khách (toàn mạng)</div>
          <div className="font-semibold">{repTone === "bad" ? "⚠ " : ""}{repLabel}</div>
          {rep?.available && repTotal > 0 ? <>
            <div className={`font-mono text-2xl font-semibold ${(rep.return_rate ?? 0) >= 30 ? "text-red-600" : "text-green-700"}`}>hoàn {rep.return_rate}%</div>
            <div className="h-1.5 rounded-full overflow-hidden bg-red-500"><div className="h-full bg-green-500" style={{ width: `${((rep.success ?? 0) / repTotal) * 100}%` }} /></div>
            <div className="text-sm">{rep.success} thành công · {rep.fail} hoàn{rep.flagged ? " · POS cảnh báo" : ""}</div>
          </> : rep?.available ? <div className="text-sm text-gray-600">Chưa có đơn nào trên Pancake</div> : null}
          <div className="text-xs text-gray-500">Shop mình: {o.customer.order_count} đơn · {o.customer.succeed_order_count} thành công · {o.customer.returned_order_count} hoàn</div>
          {repTone === "bad" && <div className="text-sm text-red-700">Yêu cầu chuyển khoản / cọc trước khi chốt</div>}
        </div>

        <div className={`rounded-xl border-2 p-3 flex flex-col gap-1 ${addrOk ? "border-green-300 bg-green-50" : "border-red-400 bg-red-50"}`}>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Địa chỉ giao</div>
          {addrOk && (addr.communeName || !posHasWard || addrChanged) ? <>
            <div className="font-semibold leading-snug">{[street, addr.communeName, addr.provinceName].filter(Boolean).join(", ")}</div>
            <div className="text-sm text-green-700">✓ Đủ phường/xã</div>
          </> : addrOk ? <>
            <div className="text-sm leading-snug">{o.address.full_address || o.address.address}</div>
            <div className="text-sm text-green-700">✓ Đã có phường/xã trên POS — sửa ở mục Giao hàng nếu khách đổi</div>
          </> : <>
            <div className="text-sm leading-snug">{o.address.full_address || o.address.address || "Khách chưa ghi địa chỉ"}</div>
            {addrSugg ? <>
              <div className="text-sm">Gợi ý: <b>{addrSugg.communeName}, {addrSugg.provinceName}</b>
                {addrSugg.from.includes("(cũ)") && <span className="block text-xs text-gray-500">đọc theo địa chỉ cũ: {addrSugg.from}</span>}</div>
              {editable && <button onClick={() => setAddr({ provinceId: addrSugg.provinceId, communeId: addrSugg.communeId, provinceName: addrSugg.provinceName, communeName: addrSugg.communeName })}
                className="self-start mt-1 px-3 py-1.5 bg-violet-600 text-white rounded-lg text-sm font-semibold">Dùng gợi ý</button>}
            </> : <div className="text-sm text-red-700">⚠ Chưa có phường/xã — {(o.address.full_address || o.address.address) ? "chọn ở mục Giao hàng" : "hỏi khách địa chỉ"}</div>}
          </>}
        </div>
      </div>

      {/* 3. Work area: products & money | delivery */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
        <section className="border rounded-xl p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">Sản phẩm & tiền</div>
          {editable && (
            <div className="relative mb-2">
              <div className="flex gap-2 items-center">
                <input value={productQ} onChange={(e) => setProductQ(e.target.value)} placeholder="Thêm sản phẩm: tên hoặc mã PHVVN..." className="flex-1 min-w-0 border rounded-lg px-2 py-1.5 text-sm" />
                <label className="text-xs flex items-center gap-1 whitespace-nowrap"><input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} /> Còn hàng</label>
              </div>
              {productRes.length > 0 && (
                <div className="absolute z-20 left-0 right-0 mt-1 bg-white border rounded shadow max-h-64 overflow-y-auto">
                  {productRes.map((p) => (
                    <button key={p.variation_id} onClick={() => {
                      setItems((prev) => {
                        const ex = prev.find((i) => i.variation_id === p.variation_id && Number(i.price) > 0)
                        if (ex) return prev.map((i) => i === ex ? { ...i, quantity: Number(i.quantity) + 1 } : i)
                        return [...prev, { variation_id: p.variation_id, display_id: p.display_id, name: p.name, quantity: 1, price: p.price }]
                      })
                      setProductQ("")
                    }} className="w-full text-left px-3 py-2 text-sm hover:bg-violet-50 flex justify-between gap-2">
                      <span className="truncate">{p.name}</span>
                      <span className="text-xs text-gray-500 whitespace-nowrap">{p.display_id} · {fmtVND(p.price)} · tồn {p.remain}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <table className="w-full text-sm table-fixed">
            <colgroup><col /><col className="w-14" /><col className="w-28" /><col className="w-24" /><col className="w-7" /></colgroup>
            <tbody>
              {items.map((it, idx) => (
                <tr key={idx} className="border-t align-middle">
                  <td className="py-1.5 pr-2 break-words text-[13px] leading-tight">{Number(it.price) === 0 ? "🎁 " : ""}{it.name}{it.display_id && <div className="text-xs text-gray-400">{it.display_id}</div>}</td>
                  <td><input type="number" min={1} disabled={!editable} value={it.quantity} aria-label="Số lượng" onChange={(e) => setItems(items.map((x, j) => j === idx ? { ...x, quantity: Math.max(1, Math.round(+e.target.value || 1)) } : x))} className="w-full border rounded px-1 py-1" /></td>
                  <td className="pl-1"><input type="number" min={0} step={1000} disabled={!editable} value={it.price} aria-label="Đơn giá" onChange={(e) => setItems(items.map((x, j) => j === idx ? { ...x, price: Math.max(0, Math.round(+e.target.value || 0)) } : x))} className="w-full border rounded px-1 py-1" /></td>
                  <td className="text-right font-mono text-[13px]">{fmtVND(it.quantity * it.price)}</td>
                  <td className="text-right">{editable && <button onClick={() => setItems(items.filter((_, j) => j !== idx))} aria-label="Xóa" className="text-gray-400 hover:text-red-600">×</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid grid-cols-2 gap-2 mt-3 text-xs text-gray-500 items-end">
            <label className="flex flex-col gap-1">Giảm giá<input type="number" min={0} step={1000} disabled={!editable} value={discount} onChange={(e) => setDiscount(Math.max(0, Math.round(+e.target.value || 0)))} className="border rounded px-2 py-1.5 text-sm text-gray-900" /></label>
            <label className="flex flex-col gap-1">Phí ship<input type="number" min={0} step={1000} disabled={!editable || freeShip} value={ship} onChange={(e) => setShip(Math.max(0, Math.round(+e.target.value || 0)))} className="border rounded px-2 py-1.5 text-sm text-gray-900" /></label>
            <label className="flex items-center gap-2 text-sm text-gray-800"><input type="checkbox" disabled={!editable} checked={freeShip} onChange={(e) => setFreeShip(e.target.checked)} /> Miễn ship</label>
            {o.prepaid > 0 && <div className="text-sm text-gray-700 text-right">Đã CK −{fmtVND(o.prepaid)}</div>}
            <div className="col-span-2 flex justify-between items-baseline bg-gray-50 rounded-lg px-3 py-2">
              <span className="text-sm font-semibold text-gray-800">Thu hộ COD</span>
              <span className="font-mono text-xl font-bold text-gray-900">{fmtVND(cod)}</span>
            </div>
          </div>
          {bigDiscount && <div className="text-xs text-orange-600 mt-1">Giảm trên 15% tiền hàng — ghi lý do ở ô ghi thêm.</div>}
        </section>

        <section className="border rounded-xl p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">Giao hàng</div>
          <AddressPicker pickerOnly rawText={o.address.full_address || o.address.address || ""} value={addr} onChange={setAddr} disabled={!editable} />
          <label className="text-sm block mt-2">Số nhà, thôn, tổ
            <input disabled={!editable} value={street} onChange={(e) => setStreet(e.target.value)} className="w-full border rounded-lg px-2 py-1.5" />
          </label>
        </section>
      </div>

      {/* 4. Folded: history, print note, more tags */}
      <details className="mt-3 border rounded-xl p-3" open={moreOpen} onToggle={(e) => setMoreOpen((e.target as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer text-sm font-semibold text-gray-600">
          Lịch sử gọi & note ({history.length}) · Ghi chú in cho shipper · Thêm thẻ khác
          {history[0] && <span className="block text-xs font-normal text-gray-500 mt-0.5 truncate">Gần nhất: {fmtTime(history[0].at)} {history[0].text}</span>}
        </summary>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
          <div className="space-y-1 text-sm max-h-48 overflow-y-auto">
            {history.map((h, i) => (
              <div key={i} className={h.warn ? "text-orange-600" : ""}><span className="text-xs text-gray-400 mr-2 font-mono">{fmtTime(h.at)}</span>{h.text}</div>
            ))}
            {!history.length && <div className="text-gray-400 italic">Chưa gọi lần nào</div>}
          </div>
          <div>
            <label className="text-sm block">Ghi chú in cho shipper
              <input disabled={!editable} value={notePrint} onChange={(e) => setNotePrint(e.target.value)} placeholder="Khách hẹn nhận sau 17h, cho xem hàng..." className="w-full border rounded-lg px-2 py-1.5" />
            </label>
            {editable && (
              <div className="flex flex-wrap gap-1 mt-1">
                {PRINT_CHIPS.map((c) => (
                  <button key={c} onClick={() => setNotePrint(notePrint.includes(c) ? notePrint : [notePrint, c].filter(Boolean).join(", "))} className="px-2 py-0.5 border border-dashed border-violet-400 text-violet-700 rounded-full text-xs">+ {c}</button>
                ))}
              </div>
            )}
            {editable && (
              <div className="flex flex-wrap gap-1 mt-3 items-center">
                <span className="text-xs text-gray-500">Thêm thẻ:</span>
                <input value={tagQ} onChange={(e) => setTagQ(e.target.value)} placeholder="Tìm thẻ..." className="border rounded px-2 py-0.5 text-xs w-32" />
                {tagResults.map((t: any) => (
                  <button key={t.id} onClick={() => { setAddTags([...addTags, t.id]); setTagQ("") }} className="px-2 py-0.5 rounded-full text-xs border text-gray-600 hover:bg-gray-50">+ {t.name}</button>
                ))}
              </div>
            )}
          </div>
        </div>
      </details>

      {/* 5. Sticky footer: outcome, extra note, save — always reachable */}
      <div className="sticky bottom-0 z-10 bg-white border-t mt-3 pt-3 pb-4 shadow-[0_-8px_16px_-12px_rgba(0,0,0,0.25)]">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {OUTCOMES.map((x, i) => (
            <button key={x.key} onClick={() => setOutcome(x.key)}
              disabled={!editable && (x.key === "chot" || x.key === "huy" || x.key === "hen")}
              className={`px-2 py-2 rounded-lg border text-sm text-left disabled:opacity-30 ${x.cls} ${outcome === x.key ? "ring-2 ring-violet-500 bg-violet-50 font-semibold" : "bg-white hover:bg-gray-50"}`}>
              <span className="text-xs text-gray-400 mr-1 font-mono">{i + 1}</span>{x.label}
            </button>
          ))}
        </div>
        {outcome === "hen" && (
          <label className="text-sm block mt-2">Gọi lại lúc <input type="datetime-local" value={henAt} onChange={(e) => setHenAt(e.target.value)} className="border rounded px-2 py-1 ml-2" /></label>
        )}
        {outcome === "huy" && (
          <label className="text-sm block mt-2">Lý do hủy
            <select value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className="border rounded px-2 py-1 ml-2">
              {[...(tagInfo?.cancel_reasons ?? []).map((r: any) => r.label), "Khác"].map((r: string) => <option key={r}>{r}</option>)}
            </select>
          </label>
        )}
        {(addTags.length > 0 || (editable && shownSuggestions.length > 0)) && (
          <div className="flex flex-wrap gap-1 mt-2 items-center">
            {addTags.map((id) => (
              <span key={id} className="px-2 py-0.5 rounded-full text-xs bg-violet-100 text-violet-700">
                + {tagLabel(tagName(id))} <button onClick={() => setAddTags(addTags.filter((x) => x !== id))} className="ml-1" aria-label="Bỏ thẻ">×</button>
              </span>
            ))}
            {editable && shownSuggestions.map((s) => (
              <button key={s.id} onClick={() => setAddTags([...addTags, s.id])} className="px-2 py-0.5 rounded-full text-xs border border-dashed border-violet-400 text-violet-700 hover:bg-violet-50">
                + {tagLabel(tagName(s.id))} <span className="text-gray-400">({s.why})</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2 mt-2">
          <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Ghi thêm: đổi địa chỉ, giao sau 17h, lý do giảm giá..." className="flex-1 min-w-0 border rounded-lg px-3 py-2 text-sm" />
          <button onClick={save} disabled={saving} className="px-5 py-2 bg-violet-600 text-white rounded-lg font-semibold hover:bg-violet-700 disabled:opacity-50 whitespace-nowrap">
            {saving ? "Đang ghi POS..." : "Lưu & đẩy POS"}
          </button>
        </div>
        {hasEdits && editable && (
          <div className="mt-1.5 text-xs text-gray-600">
            Sẽ ghi lên POS: {[
              edits.items && "sản phẩm",
              edits.discount !== undefined && `giảm giá ${fmtVND(discount)}`,
              edits.shipping_fee !== undefined && `ship ${fmtVND(ship)}`,
              edits.is_free_shipping !== undefined && (freeShip ? "miễn ship" : "khách trả ship"),
              edits.address && `địa chỉ ${[street, commune?.name, province?.name].filter(Boolean).join(", ")}`,
              edits.note_print !== undefined && "ghi chú in",
              edits.add_tags && `thẻ ${addTags.map(tagName).join(", ")}`,
            ].filter(Boolean).join(" · ")}{orderChanged ? ` · COD ${fmtVND(cod)}` : ""}
          </div>
        )}
        {err && <div className="mt-1.5 text-sm text-red-600">{err}</div>}
        <div className="text-[11px] text-gray-400 mt-1">Phím 1–8 chọn kết quả · Ctrl+Enter lưu · Esc đóng</div>
      </div>
    </SideSheet>
  )
}

const isDraftTag = (t: string) => /^đơn nháp/i.test(String(t).trim())
const tagLabel = (t: string) => String(t).trim()
  .replace(/^TrangThai_GoiLan(\d)_ThatBai$/, "Gọi lần $1 thất bại")
  .replace(/^TrangThai_GoiLan4_SoNgoai_ThatBai$/, "Gọi số ngoài thất bại")
const TAG_TONE = (t: string) => /không đặt|bom|rủi ro|trùng/i.test(t) ? "bg-red-100 text-red-700"
  : /^TrangThai_GoiLan/.test(t.trim()) ? "bg-gray-100 text-gray-600" : "bg-violet-100 text-violet-700"

/** Right-hand sheet: the queue stays visible on the left on wide screens. */
function SideSheet({ children, onClose, onKey }: { children: any; onClose: () => void; onKey?: (e: React.KeyboardEvent) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div ref={ref} tabIndex={-1} onKeyDown={onKey} onClick={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-4xl h-full overflow-y-auto px-5 outline-none shadow-2xl">
        {children}
      </div>
    </div>
  )
}

function Overlay({ children, onClose, wide, onKey }: { children: any; onClose: () => void; wide?: boolean; onKey?: (e: React.KeyboardEvent) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto py-6" onClick={onClose}>
      <div ref={ref} tabIndex={-1} onKeyDown={onKey} onClick={(e) => e.stopPropagation()}
        className={`bg-white rounded-xl shadow-2xl w-full ${wide ? "max-w-5xl" : "max-w-md"} mx-4 p-5 outline-none`}>
        {children}
      </div>
    </div>
  )
}

// ---- Queue table columns (sale picks which to show and can sort by any) ----

type QueueCol = {
  key: string
  label: string
  title?: string
  defaultOn: boolean
  fixed?: boolean
  sort: (o: any) => string | number
  cell: (o: any) => any
  className?: string
}

const QUEUE_COLUMNS: QueueCol[] = [
  {
    key: "customer", label: "Khách / đơn", defaultOn: true, fixed: true, sort: (o) => fold(o.customer_name),
    cell: (o) => (<>
      <div className="font-medium">
        {o.tags?.some(isDraftTag) && <span className="mr-1.5 px-1.5 py-0.5 rounded bg-amber-500 text-white text-[10px] font-bold tracking-wide align-middle">NHÁP</span>}
        {o.customer_name} · <span className="text-gray-700">{fmtVND(o.cod ?? o.total)}</span>
      </div>
      <div className="text-xs text-gray-400 truncate max-w-xs">#{o.id} · {o.product_summary} · {fmtTime(o.created_at)}</div>
    </>),
  },
  { key: "order_id", label: "Mã đơn", defaultOn: false, sort: (o) => Number(o.id) || 0, cell: (o) => <span className="font-mono">#{o.id}</span> },
  { key: "tracking", label: "Mã vận đơn", defaultOn: false, sort: (o) => o.tracking_code || "", cell: (o) => <span className="font-mono text-xs">{o.tracking_code || "—"}</span> },
  { key: "created", label: "Ngày tạo", defaultOn: false, sort: (o) => Date.parse(o.created_at) || 0, cell: (o) => <span className="text-xs whitespace-nowrap">{fmtTime(o.created_at)}</span> },
  { key: "product", label: "Sản phẩm", defaultOn: false, sort: (o) => fold(o.product_summary), cell: (o) => <div className="text-xs max-w-[240px] truncate" title={o.product_summary}>{o.product_summary}</div> },
  { key: "cod", label: "Tiền thu (COD)", defaultOn: false, sort: (o) => Number(o.cod ?? o.total) || 0, cell: (o) => <span className="whitespace-nowrap">{fmtVND(o.cod ?? o.total)}</span> },
  {
    key: "next", label: "Việc tiếp theo", defaultOn: true, sort: (o) => Date.parse(o.next?.dueAt) || 0,
    cell: (o) => (<>
      <span className={`px-2 py-0.5 rounded-full text-xs ${BUCKET_STYLE[o.bucket]}`}>{o.next.label}</span>
      {o.priority?.reasons?.length > 0 && (
        <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
          {o.priority.reasons.map((r: string) => (
            <span key={r} className={`px-1.5 py-0.5 rounded text-[11px] ${/hoàn/.test(r) ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{r}</span>
          ))}
        </span>
      )}
      {o.notes?.length > 0 && <div className="text-xs text-gray-400 mt-0.5 truncate max-w-[220px]">“{o.notes[o.notes.length - 1].message}”</div>}
    </>),
  },
  {
    key: "calls", label: "Gọi / note", title: "Số lượt gọi tổng đài / số note", defaultOn: true, className: "text-center", sort: (o) => o.attempts ?? 0,
    cell: (o) => (<>
      {o.call_attempts} / {o.note_count}
      {(o.unnoted > 0 || o.awaiting) && <span className="ml-1 text-orange-600" title={o.awaiting ? "Vừa gọi, chưa ghi kết quả" : `${o.unnoted} lượt gọi chưa note`}>⚠</span>}
    </>),
  },
  {
    key: "due", label: "Hạn", defaultOn: true, sort: (o) => (o.bucket === "cancel" ? Infinity : Date.parse(o.next?.dueAt) || 0),
    cell: (o) => <span className={`text-xs ${o.bucket === "overdue" ? "text-red-600 font-medium" : "text-gray-500"}`}>{o.bucket === "cancel" ? "—" : fmtDue(o.next.dueAt)}</span>,
  },
  { key: "rep", label: "Uy tín khách", title: "Toàn mạng Pancake: đơn thành công / hoàn", defaultOn: true, sort: (o) => (o.rep ? o.rep.return_rate ?? 0 : -1), cell: (o) => <RepChip rep={o.rep ? { available: true, ...o.rep } : null} /> },
  {
    key: "flags", label: "Cảnh báo", defaultOn: true, sort: (o) => (o.flags.pkg_mismatch ? 4 : 0) + (o.flags.no_commune ? 2 : 0) + (o.flags.dup_phone ? 1 : 0),
    cell: (o) => (<span className="text-xs space-x-1 whitespace-nowrap">
      {o.flags.pkg_mismatch && <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700">Lệch gói</span>}
      {o.flags.no_commune && <span className="px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-800">Chưa xã</span>}
      {o.flags.dup_phone && <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">Trùng SĐT</span>}
    </span>),
  },
  { key: "province", label: "Tỉnh", defaultOn: false, sort: (o) => fold(o.province || ""), cell: (o) => <span className="text-xs">{o.province || "—"}</span> },
  { key: "marketer", label: "MKT", defaultOn: false, sort: (o) => o.marketer_name || "", cell: (o) => <span className="text-xs">{o.marketer_name || "—"}</span> },
  { key: "source", label: "Nguồn / page", defaultOn: false, sort: (o) => fold(o.shop_name || ""), cell: (o) => <div className="text-xs max-w-[180px] truncate" title={o.shop_name}>{o.shop_name || "—"}</div> },
  { key: "seller", label: "Sale", defaultOn: true, sort: (o) => o.seller_name || "", cell: (o) => <span className="text-xs">{o.seller_name || "—"}</span> },
]
const PREF_KEY = "xac-nhan-don.table-prefs.v1"
type TablePrefs = { mode: "smart" | "pos"; cols: string[]; sort: { key: string; dir: 1 | -1 } | null }
function readPrefs(): TablePrefs {
  const fallback: TablePrefs = { mode: "smart", cols: QUEUE_COLUMNS.filter((c) => c.defaultOn).map((c) => c.key), sort: null }
  try {
    const v = JSON.parse(localStorage.getItem(PREF_KEY) || "null")
    return v && Array.isArray(v.cols) ? { ...fallback, ...v } : fallback
  } catch {
    return fallback
  }
}

// ---- Main page ----

const XacNhanDonPage = () => {
  const [seller, setSeller] = useState("me")
  const [data, setData] = useState<any>(null)
  const [comp, setComp] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<"queue" | "waiting" | "cancel" | "manager">("queue")
  const [bucket, setBucket] = useState<string>("")
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<any>(null)
  const [toast, setToast] = useState<{ msg: string; warn: string[] } | null>(null)
  const [pending, setPending] = useState(readPending)
  const [syncing, setSyncing] = useState(false)
  const [tagInfo, setTagInfo] = useState<any>(null)
  // Order-date filter (VN date of creation). Empty = every open order in the 14-day window.
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  // ~42% of open orders carry "Đơn nháp" (22/10) — let the sale show or hide them at once.
  const [draftFilter, setDraftFilter] = useState<"" | "only" | "hide">("")
  // Sort mode + visible columns, remembered per browser so each sale keeps their own view.
  const [prefs, setPrefsState] = useState<TablePrefs>(readPrefs)
  const setPrefs = (p: TablePrefs) => {
    setPrefsState(p)
    try { localStorage.setItem(PREF_KEY, JSON.stringify(p)) } catch {}
  }
  const toggleSort = (key: string) => {
    const cur = prefs.sort
    // asc → desc → off (back to the chosen mode)
    const next = !cur || cur.key !== key ? { key, dir: 1 as const } : cur.dir === 1 ? { key, dir: -1 as const } : null
    setPrefs({ ...prefs, sort: next })
  }
  const [compDate, setCompDate] = useState(vnDate(Date.now()))

  useEffect(() => {
    apiFetch("/admin/pancake-sync/call-board/tags").then((r) => r.json()).then(setTagInfo).catch(() => {})
  }, [])

  const load = async () => {
    setLoading(true)
    try {
      const sel = seller
      const r = await apiFetch(`/admin/pancake-sync/call-board/queue?seller=${sel}`)
      const d = await r.json().catch(() => null)
      if (!r.ok || !d) return
      setData(d)
      const sellerId = sel === "me" ? d.me?.id : sel
      const params = new URLSearchParams({ date: compDate })
      if (sellerId && sellerId !== "all") params.set("seller", sellerId)
      const cr = await apiFetch(`/admin/pancake-sync/call-board/compliance?${params}`)
      if (cr.ok) setComp(await cr.json())
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [seller, compDate])
  useEffect(() => {
    const t = setInterval(load, 3 * 60_000)
    return () => clearInterval(t)
  }, [seller, tab])

  const syncPos = async () => {
    setSyncing(true)
    try {
      await apiFetch("/admin/pancake-sync/active-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      await load()
    } finally {
      setSyncing(false)
    }
  }

  const inDate = (o: any) => {
    const d = vnDate(Date.parse(o.created_at))
    return (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo)
  }
  const dated = useMemo(() => (data?.queue ?? []).filter(inDate), [data, dateFrom, dateTo])
  const datedWaiting = useMemo(() => (data?.waiting ?? []).filter(inDate), [data, dateFrom, dateTo])

  const rows = useMemo(() => {
    if (!data) return []
    let list: any[] = tab === "waiting" ? datedWaiting : dated
    if (tab === "cancel") list = list.filter((o) => o.bucket === "cancel")
    if (tab === "queue") list = list.filter((o) => o.bucket !== "cancel")
    if (bucket === "callback") list = list.filter((o) => o.next?.code === "callback")
    else if (bucket === "unnoted") list = list.filter((o) => o.unnoted > 0 || o.awaiting)
    else if (bucket) list = list.filter((o) => o.bucket === bucket)
    if (draftFilter === "only") list = list.filter((o) => o.tags?.some(isDraftTag))
    else if (draftFilter === "hide") list = list.filter((o) => !o.tags?.some(isDraftTag))
    const q = fold(search.trim())
    if (q) list = list.filter((o) => fold(`${o.customer_name} ${o.customer_phone} ${o.id} ${o.product_summary} ${o.tracking_code ?? ""}`).includes(q))
    // Column sort wins; otherwise "Kiểu POS" = newest order on top, "Hỗ trợ mới" = server order
    // (due orders interleaved new/call-back, by priority).
    const col = prefs.sort && QUEUE_COLUMNS.find((c) => c.key === prefs.sort!.key)
    if (col && tab !== "waiting") {
      const dir = prefs.sort!.dir
      list = [...list].sort((a, b) => { const x = col.sort(a), y = col.sort(b); return (x < y ? -1 : x > y ? 1 : 0) * dir })
    } else if (prefs.mode === "pos") {
      list = [...list].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    }
    return list
  }, [dated, datedWaiting, tab, bucket, search, draftFilter, prefs])
  const shownCols = QUEUE_COLUMNS.filter((c) => c.fixed || prefs.cols.includes(c.key))

  // Cards follow the date filter, so "Quá hạn" for "Hôm nay" counts only today's orders.
  const s = {
    total: dated.filter((o: any) => o.bucket !== "cancel").length,
    now: dated.filter((o: any) => o.bucket === "now").length,
    overdue: dated.filter((o: any) => o.bucket === "overdue").length,
    callback: dated.filter((o: any) => o.next?.code === "callback").length,
    unnoted: dated.reduce((n: number, o: any) => n + o.unnoted, 0),
    cancel: dated.filter((o: any) => o.bucket === "cancel").length,
    waiting: datedWaiting.length,
  }
  const today = vnDate(Date.now())
  const presets: [string, string, string][] = [
    ["Tất cả", "", ""],
    ["Hôm nay", today, today],
    ["Hôm qua", vnDate(Date.now() - 86400_000), vnDate(Date.now() - 86400_000)],
    ["3 ngày", vnDate(Date.now() - 2 * 86400_000), today],
    ["7 ngày", vnDate(Date.now() - 6 * 86400_000), today],
  ]
  // The banner is about today's calls; a past date picked in the manager tab must not raise it.
  const myViolations = compDate !== today ? [] : (comp?.sellers ?? []).flatMap((x: any) => x.violations.map((v: any) => ({ ...v, seller: x.name })))
  const openRow = (id: string) => {
    const r = data?.queue.find((o: any) => String(o.id) === String(id))
    // Orders no longer in the queue (already confirmed on POS) open read-only so the sale can back-fill a note.
    setSelected(r ?? { id, customer_name: `#${id}`, customer_phone: "", calls: [], shop_name: "" })
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Hàng đợi xác nhận đơn</h1>
          <p className="text-sm text-gray-400">Mọi đơn chưa xong trong 14 ngày · tự làm mới 3 phút/lần</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={seller} onChange={(e) => setSeller(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
            <option value="me">{data?.me ? `Của tôi (${data.me.name})` : "Của tôi"}</option>
            <option value="all">Tất cả sale</option>
            {(data?.sellers ?? []).map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm tên, SĐT, mã đơn" className="border rounded-lg px-3 py-2 text-sm w-48" />
          <button onClick={syncPos} disabled={syncing} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50">{syncing ? "Đang đồng bộ..." : "🔄 Đồng bộ POS"}</button>
          <XacNhanGuide />
        </div>
      </div>

      {/* Hà sells and is the CSKH: during fixed CSKH blocks the sale queue points her to /app/cskh */}
      {data?.me?.name === CSKH_PERSON && cskhBlockNow() && (
        <div className="p-3 rounded-lg bg-green-50 text-green-800 text-sm flex justify-between items-center gap-2 flex-wrap">
          <span>🟢 Đang trong khung CSKH <b>{cskhBlockNow()}</b> — ưu tiên gọi cứu đơn giao thất bại trước, đơn sale để sau khung này.</span>
          <a href="/app/cskh?main=queue" className="px-3 py-1 bg-green-600 text-white rounded text-xs">Sang CSKH →</a>
        </div>
      )}

      {/* Must-log banners */}
      {pending && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm flex justify-between items-center gap-2 flex-wrap">
          <span>📞 Bạn vừa gọi <b>{pending.name}</b> (#{pending.orderId}) lúc {fmtTime(pending.at)} — ghi kết quả trước khi gọi đơn khác.</span>
          <span className="flex gap-2">
            <button onClick={() => openRow(pending.orderId)} className="px-3 py-1 bg-red-600 text-white rounded text-xs">Ghi kết quả</button>
            <button onClick={() => { localStorage.removeItem(PENDING_KEY); setPending(null) }} className="px-3 py-1 border border-red-300 rounded text-xs" title="Chỉ dùng khi cuộc gọi không kết nối được">Không kết nối được</button>
          </span>
        </div>
      )}
      {myViolations.length > 0 && (
        <div className="p-3 rounded-lg bg-orange-50 text-orange-800 text-sm">
          <div className="font-medium">⚠ {myViolations.length} cuộc gọi hôm nay chưa có note (luật: gọi lần nào ghi note lần đó)</div>
          <div className="mt-1 flex flex-wrap gap-2">
            {myViolations.slice(0, 8).map((v: any, i: number) => (
              <button key={i} onClick={() => openRow(v.order_id)} className="px-2 py-0.5 bg-white border border-orange-300 rounded text-xs">
                {v.seller !== data?.me?.name ? `${v.seller} · ` : ""}#{v.order_id} {v.customer_name} · {fmtTime(v.at)}{v.talk_sec > 0 ? ` · ${v.talk_sec}s` : ""}
              </button>
            ))}
          </div>
        </div>
      )}

      <SalePeriodSummary defaultSeller="" />

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { k: "", label: "Tồn chờ xử lý", v: s.total, cls: "bg-gray-50" },
          { k: "now", label: "Cần gọi ngay", v: s.now, cls: "bg-orange-50" },
          { k: "overdue", label: "Quá hạn", v: s.overdue, cls: "bg-red-50" },
          { k: "callback", label: "Hẹn gọi lại", v: s.callback, cls: "bg-violet-50" },
          { k: "unnoted", label: "Gọi chưa note", v: s.unnoted, cls: "bg-yellow-50" },
          { k: "waiting", label: "Chờ kho / chờ hàng", v: s.waiting, cls: "bg-blue-50" },
        ].map((c) => (
          <button key={c.label} onClick={() => { if (c.k === "waiting") { setTab("waiting"); setBucket("") } else { setTab("queue"); setBucket(c.k) } }}
            className={`${c.cls} rounded-xl p-3 text-left hover:ring-2 hover:ring-violet-400 ${(c.k === "waiting" ? tab === "waiting" : tab === "queue" && bucket === c.k) ? "ring-2 ring-violet-500" : ""}`}>
            <div className="text-2xl font-bold">{c.v ?? 0}</div>
            <div className="text-xs text-gray-500">{c.label}</div>
          </button>
        ))}
      </div>

      {tab !== "manager" && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-500">Ngày tạo đơn:</span>
          {presets.map(([label, f, t]) => (
            <button key={label} onClick={() => { setDateFrom(f); setDateTo(t) }}
              className={`px-3 py-1 rounded-full border text-xs ${dateFrom === f && dateTo === t ? "bg-violet-600 text-white border-violet-600" : "hover:bg-gray-50"}`}>{label}</button>
          ))}
          <input type="date" value={dateFrom} max={dateTo || today} onChange={(e) => setDateFrom(e.target.value)} className="border rounded px-2 py-1 text-xs" />
          <span className="text-gray-400">→</span>
          <input type="date" value={dateTo} min={dateFrom} max={today} onChange={(e) => setDateTo(e.target.value)} className="border rounded px-2 py-1 text-xs" />
          <span className="w-full" />
          <span className="text-gray-500">Sắp xếp:</span>
          <div className="inline-flex border rounded-lg overflow-hidden text-xs">
            {([["smart", "Hỗ trợ mới (ưu tiên)"], ["pos", "Kiểu POS (mới nhất trên cùng)"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setPrefs({ ...prefs, mode: k, sort: null })}
                className={`px-3 py-1 ${k === "pos" ? "border-l" : ""} ${prefs.mode === k && !prefs.sort ? "bg-violet-600 text-white" : "hover:bg-gray-50"}`}>{l}</button>
            ))}
          </div>
          {prefs.sort && (
            <button onClick={() => setPrefs({ ...prefs, sort: null })} className="px-2 py-1 rounded-full border text-xs text-violet-700 border-violet-300">
              Đang xếp theo cột "{QUEUE_COLUMNS.find((c) => c.key === prefs.sort!.key)?.label}" {prefs.sort.dir === 1 ? "▲" : "▼"} · bỏ
            </button>
          )}
          <details className="relative">
            <summary className="list-none cursor-pointer px-3 py-1 rounded-full border text-xs hover:bg-gray-50">⚙ Cột hiển thị</summary>
            <div className="absolute z-20 mt-1 w-56 bg-white border rounded-lg shadow-lg p-2 space-y-1">
              {QUEUE_COLUMNS.filter((c) => !c.fixed).map((c) => (
                <label key={c.key} className="flex items-center gap-2 text-sm px-1 py-0.5 rounded hover:bg-gray-50">
                  <input type="checkbox" checked={prefs.cols.includes(c.key)}
                    onChange={(e) => setPrefs({ ...prefs, cols: e.target.checked ? [...prefs.cols, c.key] : prefs.cols.filter((k) => k !== c.key) })} />
                  {c.label}
                </label>
              ))}
              <button onClick={() => setPrefs({ ...prefs, cols: QUEUE_COLUMNS.filter((c) => c.defaultOn).map((c) => c.key) })} className="text-xs text-violet-700 hover:underline px-1">Về mặc định</button>
            </div>
          </details>
          <span className="w-full" />
          <span className="text-gray-500">Đơn nháp:</span>
          {([["", "Tất cả"], ["only", `Chỉ đơn nháp (${dated.filter((o: any) => o.tags?.some(isDraftTag)).length})`], ["hide", "Ẩn đơn nháp"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setDraftFilter(k)}
              className={`px-3 py-1 rounded-full border text-xs ${draftFilter === k ? "bg-amber-500 text-white border-amber-500" : "hover:bg-gray-50"}`}>{l}</button>
          ))}
          <span className="text-xs text-gray-400" title="Đơn đến hạn xếp xen kẽ: 1 khách mới, 1 đơn gọi lại. Trong mỗi nhóm ưu tiên đơn to, khách có lịch sử mua tốt, khách chờ lâu; đơn tồn càng cũ càng xuống.">
            Hàng đợi chỉ giữ đơn 14 ngày gần nhất · Thứ tự: xen kẽ khách mới / gọi lại ⓘ
          </span>
        </div>
      )}

      <div className="flex gap-1 border-b text-sm">
        {[
          ["queue", "Hàng đợi"], ["waiting", "Chờ kho / chờ hàng"], ["cancel", `Đề xuất hủy (${s.cancel ?? 0})`], ["manager", "Quản lý"],
        ].map(([k, l]) => (
          <button key={k} onClick={() => { setTab(k as any); setBucket("") }} className={`px-3 py-2 -mb-px border-b-2 ${tab === k ? "border-violet-600 text-violet-700 font-medium" : "border-transparent text-gray-500"}`}>{l}</button>
        ))}
      </div>

      {tab === "manager" ? (
        <ManagerView data={data} comp={comp} onOpen={openRow} compDate={compDate} setCompDate={setCompDate} today={today} />
      ) : loading && !data ? (
        <div className="text-center py-16 text-gray-400">Đang tải...</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-gray-400">Không còn đơn nào ở đây 🎉</div>
      ) : tab === "waiting" ? (
        <table className="w-full text-sm border rounded-xl overflow-hidden">
          <thead className="bg-gray-50 text-gray-600"><tr><th className="text-left px-3 py-2">Khách / đơn</th><th className="text-left px-3 py-2">Sản phẩm</th><th className="text-left px-3 py-2">Trạng thái</th><th className="text-left px-3 py-2">Sale</th><th className="text-right px-3 py-2">Đã chờ</th></tr></thead>
          <tbody>{rows.map((o) => (
            <tr key={o.id} className="border-t">
              <td className="px-3 py-2"><div className="font-medium">{o.customer_name}</div><div className="text-xs text-gray-400">#{o.id} · {o.customer_phone}</div></td>
              <td className="px-3 py-2 text-gray-600 truncate max-w-xs">{o.product_summary}</td>
              <td className="px-3 py-2">{o.status === 11 ? "Chờ hàng" : "Sale đã chốt, chờ kho"}</td>
              <td className="px-3 py-2">{o.seller_name || "—"}</td>
              <td className={`px-3 py-2 text-right ${o.hours_open > 24 ? "text-red-600 font-medium" : ""}`}>{o.hours_open}h</td>
            </tr>
          ))}</tbody>
        </table>
      ) : (
        <div className="border rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                {shownCols.map((c) => {
                  const active = prefs.sort?.key === c.key
                  return (
                    <th key={c.key} title={c.title} className={`px-3 py-2 ${c.className ?? "text-left"}`}>
                      <button onClick={() => toggleSort(c.key)} className={`inline-flex items-center gap-1 hover:text-violet-700 ${active ? "text-violet-700 font-semibold" : ""}`}>
                        {c.label}<span className="text-[10px]">{active ? (prefs.sort!.dir === 1 ? "▲" : "▼") : "↕"}</span>
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} onClick={() => setSelected(o)} className={`border-t cursor-pointer hover:bg-violet-50 ${pending?.orderId === String(o.id) ? "bg-red-50" : ""}`}>
                  {shownCols.map((c) => <td key={c.key} className={`px-3 py-2 align-top ${c.className ?? ""}`}>{c.cell(o)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <OrderCard
          row={selected}
          tagInfo={tagInfo}
          pending={pending}
          setPending={setPending}
          onClose={() => setSelected(null)}
          onSaved={(msg, warn) => { setSelected(null); setToast({ msg, warn }); load(); setTimeout(() => setToast(null), warn.length ? 15000 : 5000) }}
        />
      )}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-md bg-white border shadow-lg rounded-lg p-3 text-sm">
          <div className="text-green-700">✓ Đã ghi POS: {toast.msg}</div>
          {toast.warn.map((w, i) => <div key={i} className="text-orange-700 mt-1">{w}</div>)}
        </div>
      )}
    </div>
  )
}

function ManagerView({ data, comp, onOpen, compDate, setCompDate, today }: {
  data: any; comp: any; onOpen: (id: string) => void; compDate: string; setCompDate: (d: string) => void; today: string
}) {
  const bySeller = new Map<string, any>()
  for (const o of data?.queue ?? []) {
    const k = o.seller_name || "Chưa gán"
    const x = bySeller.get(k) ?? { total: 0, overdue: 0, oldestH: 0, unnoted: 0 }
    x.total++
    if (o.bucket === "overdue") x.overdue++
    x.oldestH = Math.max(x.oldestH, Math.floor((Date.now() - Date.parse(o.created_at)) / 3600_000))
    x.unnoted += o.unnoted
    bySeller.set(k, x)
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-500">Tuân thủ note ngày:</span>
        <input type="date" value={compDate} max={today} onChange={(e) => e.target.value && setCompDate(e.target.value)} className="border rounded px-2 py-1 text-xs" />
        {compDate !== today && <button onClick={() => setCompDate(today)} className="text-xs text-violet-700 hover:underline">Về hôm nay</button>}
        <span className="text-xs text-gray-500">· Cột Tồn/Quá hạn luôn là hiện tại · Chọn "Tất cả sale" ở trên để thấy đủ mọi người.</span>
      </div>
      <table className="w-full text-sm border rounded-xl overflow-hidden">
        <thead className="bg-gray-50 text-gray-600"><tr><th className="text-left px-3 py-2">Sale</th><th className="text-right px-3 py-2">Tồn</th><th className="text-right px-3 py-2">Quá hạn</th><th className="text-right px-3 py-2">Đơn cũ nhất</th><th className="text-right px-3 py-2">Lượt gọi hôm nay</th><th className="text-right px-3 py-2">% có note</th></tr></thead>
        <tbody>
          {[...bySeller.entries()].map(([name, x]) => {
            const c = (comp?.sellers ?? []).find((s: any) => s.name === name)
            return (
              <tr key={name} className="border-t">
                <td className="px-3 py-2 font-medium">{name}</td>
                <td className="px-3 py-2 text-right">{x.total}</td>
                <td className={`px-3 py-2 text-right ${x.overdue ? "text-red-600 font-medium" : ""}`}>{x.overdue}</td>
                <td className="px-3 py-2 text-right">{x.oldestH}h</td>
                <td className="px-3 py-2 text-right">{c?.attempts ?? "—"}</td>
                <td className={`px-3 py-2 text-right ${c?.pct_noted != null && c.pct_noted < 95 ? "text-red-600 font-medium" : ""}`}>{c?.pct_noted != null ? `${c.pct_noted}%` : "—"}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {(comp?.sellers ?? []).map((sl: any) => sl.violations.length > 0 && (
        <div key={sl.id}>
          <div className="text-sm font-medium mb-1">{sl.name} — {sl.violations.length} cuộc gọi chưa note hôm nay</div>
          <div className="space-y-1">
            {sl.violations.map((v: any, i: number) => (
              <div key={i} className="text-sm flex gap-3 items-center">
                <span className="text-xs text-gray-400 w-24">{fmtTime(v.at)}</span>
                <button onClick={() => onOpen(v.order_id)} className="text-violet-700 hover:underline">#{v.order_id} {v.customer_name}</button>
                <span className="text-xs text-gray-500">{v.talk_sec > 0 ? `nghe máy ${v.talk_sec}s` : "không nghe"}</span>
                {v.recording && <a href={v.recording} target="_blank" rel="noreferrer" className="text-xs text-violet-600 hover:underline">▶ Nghe ghi âm</a>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Xác nhận đơn", rank: 9,
})

export default withRouteGuard(XacNhanDonPage)
