import { useEffect, useMemo, useRef, useState } from "react"
import { apiFetch } from "../lib/api-client"

// Hàng đợi việc CSKH: đơn đã chốt cần xử lý (giao không thành, sắp hoàn, trễ giao, VTP
// chưa lấy, kho chậm, hoàn thiếu lý do). Mỗi cuộc gọi = 1 kết quả = 1 note trên POS.

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
function toLocalInput(ms: number) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Shared with /app/xac-nhan-don: one pending call per person, whichever page it was made from.
const PENDING_KEY = "xac-nhan-don.pending-call"
function readPending(): { orderId: string; at: number; name: string } | null {
  try {
    const v = JSON.parse(localStorage.getItem(PENDING_KEY) || "null")
    return v && Date.now() - v.at < 12 * 3600_000 ? v : null
  } catch {
    return null
  }
}

const TASKS: Record<string, { label: string; cls: string }> = {
  gkt_sap_hoan: { label: "Sắp chuyển hoàn", cls: "bg-red-600 text-white" },
  gkt: { label: "Giao không thành", cls: "bg-red-100 text-red-700" },
  vtp_huy: { label: "VTP hủy vận đơn", cls: "bg-red-100 text-red-700" },
  tre_giao: { label: "Trễ giao", cls: "bg-orange-100 text-orange-700" },
  vtp_chua_lay: { label: "VTP chưa lấy", cls: "bg-yellow-100 text-yellow-800" },
  kho_lau: { label: "Kho chậm", cls: "bg-yellow-100 text-yellow-800" },
  nhac_nhan: { label: "Nhắc nhận hàng", cls: "bg-blue-100 text-blue-700" },
  hoan_ly_do: { label: "Hoàn thiếu lý do", cls: "bg-purple-100 text-purple-700" },
}

const OUTCOMES = [
  { key: "kh_dong_y", label: "Khách đồng ý nhận", cls: "border-green-400 text-green-700" },
  { key: "kh_hen_nhan", label: "Khách hẹn nhận lại", cls: "border-violet-400 text-violet-700" },
  { key: "knm", label: "KNM", cls: "border-gray-300" },
  { key: "bao_vtp", label: "Đã báo bưu tá / VTP", cls: "border-gray-300" },
  { key: "bao_kho", label: "Đã báo kho", cls: "border-gray-300" },
  { key: "kh_tu_choi", label: "Khách từ chối nhận", cls: "border-red-300 text-red-700" },
  { key: "hen", label: "Hẹn gọi lại", cls: "border-gray-300" },
  { key: "note", label: "Chỉ ghi note", cls: "border-gray-300" },
]
const HOAN_TAG_NAMES = ["Hoan_DoKhach", "Hoan_DoKhongLienLacDuoc", "Hoan_DoDVVC", "Hoan_DoKho", "Hoan_DoSanPham", "Hoan_GiaoHangLau", "Hoan_KhachTuChoi"]

function TaskCard({ t, tagInfo, pending, setPending, onClose, onSaved }: {
  t: any; tagInfo: any; pending: ReturnType<typeof readPending>; setPending: (p: any) => void
  onClose: () => void; onSaved: (msg: string, warn: string[]) => void
}) {
  const [outcome, setOutcome] = useState("")
  const [when, setWhen] = useState(toLocalInput(Date.now() + 24 * 3600_000))
  const [extra, setExtra] = useState("")
  const [addTags, setAddTags] = useState<number[]>([])
  const [saving, setSaving] = useState(false)
  const [calling, setCalling] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.focus() }, [])

  const allTags: any[] = tagInfo?.tags ?? []
  const tagId = (name: string) => allTags.find((x) => x.name === name)?.id
  const tagName = (id: number) => allTags.find((x) => x.id === id)?.name ?? `#${id}`
  const has = (id: number) => t.tags.includes(tagName(id)) || addTags.includes(id)
  const suggestions: { id: number; why: string }[] = []
  if (outcome === "kh_tu_choi" && tagId("Hoan_KhachTuChoi")) suggestions.push({ id: tagId("Hoan_KhachTuChoi"), why: "khách từ chối" })
  if (t.task.code === "hoan_ly_do") for (const n of HOAN_TAG_NAMES) if (tagId(n)) suggestions.push({ id: tagId(n), why: "lý do hoàn" })
  if (["gkt", "gkt_sap_hoan", "tre_giao"].includes(t.task.code) && tagId("Theo Dõi")) suggestions.push({ id: tagId("Theo Dõi"), why: "theo dõi tiếp" })
  if (outcome === "knm" && tagId("Hoan_DoKhongLienLacDuoc") && t.task.code === "gkt_sap_hoan") suggestions.push({ id: tagId("Hoan_DoKhongLienLacDuoc"), why: "không liên lạc được" })
  const shown = suggestions.filter((s, i, a) => !has(s.id) && a.findIndex((x) => x.id === s.id) === i)

  const call = async (phone: string, who: string) => {
    if (pending && pending.orderId !== String(t.id)) return setErr(`Ghi kết quả cuộc gọi ${pending.name} trước`)
    setCalling(true); setErr(null)
    try {
      const r = await apiFetch("/admin/ity-cdr-sync/click2call", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, userfield: `order:${t.id}` }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error || "Không gọi được")
      // Only calls to the customer must be logged on the order; calling the shipper is not.
      if (who === "khach") {
        const p = { orderId: String(t.id), at: Date.now(), name: t.customer_name }
        localStorage.setItem(PENDING_KEY, JSON.stringify(p))
        setPending(p)
      }
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setCalling(false)
    }
  }

  const save = async () => {
    setErr(null)
    if (!outcome) return setErr("Chọn kết quả cuộc gọi")
    if (outcome === "note" && !extra.trim()) return setErr("Nhập nội dung note")
    setSaving(true)
    try {
      const r = await apiFetch("/admin/pancake-sync/call-board/result", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: t.id,
          outcome,
          callback_at: outcome === "hen" || outcome === "kh_hen_nhan" ? new Date(when).toISOString() : undefined,
          extra_note: extra.trim() || undefined,
          edits: addTags.length ? { add_tags: addTags } : undefined,
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || "Lưu thất bại")
      if (pending?.orderId === String(t.id)) { localStorage.removeItem(PENDING_KEY); setPending(null) }
      onSaved(d.message, d.warnings ?? [])
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  const c = t.carrier
  const history = [
    ...c.updates.map((u: any) => ({ at: u.at ? Date.parse(u.at) : 0, text: `🚚 ${u.text}` })),
    ...t.notes.map((n: any) => ({ at: n.at, text: `📝 ${n.by ? n.by + ": " : ""}${n.message}` })),
  ].sort((a, b) => b.at - a.at)

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto py-6" onClick={onClose}>
      <div ref={ref} tabIndex={-1} onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); save() }
          const tag = (e.target as HTMLElement)?.tagName
          if (tag === "INPUT" || tag === "SELECT") return
          const i = Number(e.key) - 1
          if (i >= 0 && i < OUTCOMES.length) setOutcome(OUTCOMES[i].key)
        }}
        className="bg-white rounded-xl shadow-2xl w-full max-w-3xl mx-4 p-5 outline-none">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-lg font-semibold">{t.customer_name} · {t.customer_phone}</div>
            <div className="text-xs text-gray-500">#{t.id} · {t.status_name} · COD {fmtVND(t.cod)} · {t.province || "—"} · Sale {t.seller_name || "—"}</div>
            <div className="text-xs text-gray-500 truncate max-w-xl">{t.product_summary}</div>
          </div>
          <div className="flex gap-2 items-center">
            <button onClick={() => call(t.customer_phone, "khach")} disabled={calling}
              className="px-3 py-2 bg-violet-600 text-white rounded-lg text-sm hover:bg-violet-700 disabled:opacity-40">📞 Gọi khách</button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl px-2">×</button>
          </div>
        </div>

        <div className={`mt-3 p-3 rounded-lg ${TASKS[t.task.code]?.cls.includes("red") ? "bg-red-50" : "bg-gray-50"}`}>
          <div className="font-medium">{t.task.label}</div>
          <div className="text-xs text-gray-500">{t.task.handled ? "Đã có note sau sự việc — xem lại" : "Chưa ai xử lý"} · hạn {fmtDue(t.task.due_at)}</div>
        </div>

        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div className="border rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-1">Vận chuyển</div>
            <div>Bưu tá: <b>{c.delivery_name || "—"}</b>{c.delivery_tel && (
              <> · <button onClick={() => call(c.delivery_tel, "buu_ta")} className="text-violet-700 hover:underline">📞 {c.delivery_tel}</button></>
            )}</div>
            <div>Số lần giao: {c.count_of_delivery ?? "—"} · Lấy hàng: {fmtTime(c.picked_up_at)}</div>
            <div>Mã vận đơn: {c.tracking_code || "—"}{c.tracking_link && <> · <a href={c.tracking_link} target="_blank" rel="noreferrer" className="text-violet-700 hover:underline">Tra cứu</a></>}</div>
          </div>
          <div className="border rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-1">Thẻ đơn</div>
            <div className="flex flex-wrap gap-1">
              {t.tags.map((n: string) => <span key={n} className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">{n}</span>)}
              {addTags.map((id) => (
                <span key={id} className="px-2 py-0.5 rounded-full text-xs bg-violet-100 text-violet-700">+ {tagName(id)} <button onClick={() => setAddTags(addTags.filter((x) => x !== id))}>×</button></span>
              ))}
              {!t.tags.length && !addTags.length && <span className="text-xs text-gray-400">Chưa có thẻ</span>}
            </div>
            {shown.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2 items-center">
                <span className="text-xs text-gray-500">Gợi ý:</span>
                {shown.map((s) => (
                  <button key={s.id} onClick={() => setAddTags([...addTags, s.id])} className="px-2 py-0.5 rounded-full text-xs border border-dashed border-violet-400 text-violet-700 hover:bg-violet-50">+ {tagName(s.id)}</button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-3">
          <div className="text-xs font-semibold text-gray-400 uppercase">Lịch sử vận chuyển & note</div>
          <div className="mt-1 space-y-0.5 text-sm max-h-44 overflow-y-auto">
            {history.map((h, i) => (
              <div key={i}><span className="text-xs text-gray-400 mr-2">{h.at ? fmtTime(h.at) : "—"}</span>{h.text}</div>
            ))}
            {!history.length && <div className="text-gray-400 italic">Chưa có</div>}
          </div>
        </div>

        <div className="mt-4 border-t pt-3">
          <div className="text-sm font-medium mb-2">Kết quả cuộc gọi <span className="text-xs text-gray-400 font-normal">(phím 1–8, Ctrl+Enter để lưu)</span></div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {OUTCOMES.map((x, i) => (
              <button key={x.key} onClick={() => setOutcome(x.key)}
                className={`px-2 py-2 rounded-lg border text-sm ${x.cls} ${outcome === x.key ? "ring-2 ring-violet-500 bg-violet-50 font-semibold" : "bg-white hover:bg-gray-50"}`}>
                <span className="text-xs text-gray-400 mr-1">{i + 1}</span>{x.label}
              </button>
            ))}
          </div>
          {(outcome === "hen" || outcome === "kh_hen_nhan") && (
            <label className="text-sm block mt-2">{outcome === "hen" ? "Gọi lại lúc" : "Khách hẹn nhận — kiểm tra lại lúc"}
              <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="border rounded px-2 py-1 ml-2" />
            </label>
          )}
          <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Ghi thêm: khách đổi địa chỉ, hẹn giờ giao, đã báo bưu tá..." className="w-full border rounded px-2 py-1.5 text-sm mt-2" />
          {err && <div className="mt-2 text-sm text-red-600">{err}</div>}
          <div className="flex justify-between items-center gap-2 mt-3">
            <a href={`/app/pancake-orders/${t.id}`} className="text-xs text-gray-500 hover:underline">Xem chi tiết đơn →</a>
            <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-2 border rounded-lg text-sm">Đóng</button>
              <button onClick={save} disabled={saving} className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm hover:bg-violet-700 disabled:opacity-50">{saving ? "Đang ghi POS..." : "Lưu note lên POS"}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function CskhQueue() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>("")
  const [showLater, setShowLater] = useState(false)
  const [selected, setSelected] = useState<any>(null)
  const [tagInfo, setTagInfo] = useState<any>(null)
  const [pending, setPending] = useState(readPending)
  const [toast, setToast] = useState<{ msg: string; warn: string[] } | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const r = await apiFetch("/admin/cskh/queue")
      const d = await r.json().catch(() => null)
      if (!r.ok || !d) throw new Error(d?.error || "Không tải được hàng đợi")
      setData(d); setErr(null)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    load()
    apiFetch("/admin/pancake-sync/call-board/tags").then((r) => r.json()).then(setTagInfo).catch(() => {})
    const t = setInterval(load, 3 * 60_000)
    return () => clearInterval(t)
  }, [])

  const rows = useMemo(() => {
    let list: any[] = data?.tasks ?? []
    if (!showLater) list = list.filter((t) => t.bucket !== "later")
    if (filter) list = list.filter((t) => t.task.code === filter)
    return list
  }, [data, filter, showLater])

  const s = data?.summary ?? {}
  return (
    <div className="space-y-4">
      {pending && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm flex justify-between items-center gap-2 flex-wrap">
          <span>📞 Bạn vừa gọi <b>{pending.name}</b> (#{pending.orderId}) lúc {fmtTime(pending.at)} — ghi kết quả trước khi gọi đơn khác.</span>
          <span className="flex gap-2">
            {data?.tasks.some((t: any) => String(t.id) === pending.orderId) && (
              <button onClick={() => setSelected(data.tasks.find((t: any) => String(t.id) === pending.orderId))} className="px-3 py-1 bg-red-600 text-white rounded text-xs">Ghi kết quả</button>
            )}
            <button onClick={() => { localStorage.removeItem(PENDING_KEY); setPending(null) }} className="px-3 py-1 border border-red-300 rounded text-xs">Không kết nối được</button>
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        <button onClick={() => setFilter("")} className={`rounded-xl p-3 text-left bg-gray-50 ${!filter ? "ring-2 ring-violet-500" : ""}`}>
          <div className="text-2xl font-bold">{s.due ?? 0}</div><div className="text-xs text-gray-500">Việc đến hạn</div>
        </button>
        {Object.entries(TASKS).map(([code, v]) => (
          <button key={code} onClick={() => setFilter(filter === code ? "" : code)}
            className={`rounded-xl p-3 text-left bg-white border ${filter === code ? "ring-2 ring-violet-500" : ""}`}>
            <div className="text-2xl font-bold">{s.by_code?.[code] ?? 0}</div>
            <div className="text-xs text-gray-500">{v.label}</div>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
        <span>Đang theo dõi: chờ kho {s.cho_kho ?? 0} · chờ VTP {s.cho_vtp ?? 0} · đang giao {s.dang_giao ?? 0} · đang hoàn {s.dang_hoan ?? 0}</span>
        <label className="flex items-center gap-1"><input type="checkbox" checked={showLater} onChange={(e) => setShowLater(e.target.checked)} /> Hiện cả việc đã xử lý, chờ VTP ({s.waiting_carrier ?? 0})</label>
        <button onClick={load} className="px-3 py-1 border rounded hover:bg-gray-50">🔄 Làm mới</button>
      </div>

      {err && <div className="text-sm text-red-600">{err}</div>}
      {loading && !data ? (
        <div className="text-center py-16 text-gray-400">Đang tải...</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-gray-400">Không còn việc nào 🎉</div>
      ) : (
        <div className="border rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-3 py-2">Việc</th>
                <th className="text-left px-3 py-2">Khách / đơn</th>
                <th className="text-left px-3 py-2">Cập nhật vận chuyển mới nhất</th>
                <th className="text-left px-3 py-2">Hạn</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} onClick={() => setSelected(t)} className={`border-t cursor-pointer hover:bg-violet-50 ${pending?.orderId === String(t.id) ? "bg-red-50" : ""}`}>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs whitespace-nowrap ${TASKS[t.task.code]?.cls ?? ""}`}>{TASKS[t.task.code]?.label ?? t.task.code}</span>
                    {t.task.handled && <div className="text-[11px] text-gray-400 mt-0.5">đã xử lý, xem lại</div>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{t.customer_name} · {fmtVND(t.cod)}</div>
                    <div className="text-xs text-gray-400">#{t.id} · {t.province || "—"} · {t.carrier.delivery_name ? `BT ${t.carrier.delivery_name}` : ""}</div>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600 max-w-xs">
                    <div className="truncate">{t.carrier.updates[0]?.text || "—"}</div>
                    <div className="text-gray-400">{fmtTime(t.carrier.updates[0]?.at)}</div>
                  </td>
                  <td className={`px-3 py-2 text-xs whitespace-nowrap ${t.bucket === "overdue" ? "text-red-600 font-medium" : "text-gray-500"}`}>{fmtDue(t.task.due_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <TaskCard t={selected} tagInfo={tagInfo} pending={pending} setPending={setPending}
          onClose={() => setSelected(null)}
          onSaved={(msg, warn) => { setSelected(null); setToast({ msg, warn }); load(); setTimeout(() => setToast(null), warn.length ? 15000 : 5000) }} />
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
