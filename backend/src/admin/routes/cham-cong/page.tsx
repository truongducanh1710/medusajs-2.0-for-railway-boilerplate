import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useCallback, useEffect, useState } from "react"
import { apiJson } from "../../lib/api-client"
import { withRouteGuard } from "../../components/route-guard"

type Row = {
  email: string
  name: string
  role: string
  status: "online" | "idle" | "offline"
  active_seconds: number
  idle_seconds: number
  first_seen: string | null
  last_seen: string | null
  session_count: number
  messages: number
  tasks_done: number
  tasks_in_progress: number
  tasks_pending: number
  calls: number
  calls_answered: number
  talk_seconds: number
}

type TimelineItem = {
  at: string
  kind: "session" | "message" | "task" | "call"
  label: string
  detail?: string
}

function todayVN(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)
}

function fmtDur(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h === 0 && m === 0) return "—"
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}m` : `${m}m`
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" })
}

const STATUS_STYLE: Record<string, { dot: string; label: string }> = {
  online: { dot: "bg-green-500", label: "Online" },
  idle: { dot: "bg-amber-400", label: "Idle" },
  offline: { dot: "bg-gray-300", label: "Offline" },
}

const KIND_STYLE: Record<string, { icon: string; cls: string }> = {
  session: { icon: "●", cls: "text-blue-600" },
  message: { icon: "💬", cls: "text-gray-700" },
  task: { icon: "✓", cls: "text-green-700" },
  call: { icon: "📞", cls: "text-purple-700" },
}

function ChamCongPage() {
  const [from, setFrom] = useState(todayVN())
  const [to, setTo] = useState(todayVN())
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState("")
  const [detail, setDetail] = useState<{ email: string; name: string; items: TimelineItem[] } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setErr("")
    try {
      const d = await apiJson(`/admin/cham-cong/report?from=${from}&to=${to}`)
      setRows(d?.rows || [])
    } catch (e: any) {
      setErr(e.message || "Lỗi tải báo cáo")
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => { load() }, [load])

  // Chỉ auto-refresh khi đang xem hôm nay — xem ngày cũ thì số liệu đã cố định.
  useEffect(() => {
    if (from !== todayVN() || to !== todayVN()) return
    const t = window.setInterval(load, 60000)
    return () => clearInterval(t)
  }, [from, to, load])

  const openTimeline = async (r: Row) => {
    setDetailLoading(true)
    setDetail({ email: r.email, name: r.name, items: [] })
    try {
      const d = await apiJson(`/admin/cham-cong/timeline?email=${encodeURIComponent(r.email)}&date=${to}`)
      setDetail({ email: r.email, name: d?.name || r.name, items: d?.items || [] })
    } catch (e: any) {
      setErr(e.message || "Lỗi tải nhật ký")
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }

  const totalOnline = rows.reduce((s, r) => s + r.active_seconds, 0)
  const nowOnline = rows.filter(r => r.status === "online").length
  const nowIdle = rows.filter(r => r.status === "idle").length

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Chấm công &amp; Hoạt động</h1>
          <p className="text-sm text-gray-500">
            Giờ online tính theo thời gian mở tab Chat MKT và có thao tác thật. Không thao tác quá 5 phút → tính Idle.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 block text-gray-500">Từ ngày</span>
            <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}
              className="rounded border px-2 py-1" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-gray-500">Đến ngày</span>
            <input type="date" value={to} min={from} max={todayVN()} onChange={e => setTo(e.target.value)}
              className="rounded border px-2 py-1" />
          </label>
          <button onClick={() => { setFrom(todayVN()); setTo(todayVN()) }}
            className="rounded border px-3 py-1 text-sm hover:bg-gray-50">Hôm nay</button>
          <button onClick={load} disabled={loading}
            className="rounded bg-gray-900 px-3 py-1 text-sm text-white disabled:opacity-50">
            {loading ? "Đang tải..." : "Làm mới"}
          </button>
        </div>
      </div>

      {err && <div className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      <div className="mb-4 flex gap-3 text-sm">
        <div className="rounded border px-3 py-2">
          <span className="text-gray-500">Đang online: </span>
          <span className="font-semibold text-green-600">{nowOnline}</span>
        </div>
        <div className="rounded border px-3 py-2">
          <span className="text-gray-500">Đang idle: </span>
          <span className="font-semibold text-amber-500">{nowIdle}</span>
        </div>
        <div className="rounded border px-3 py-2">
          <span className="text-gray-500">Tổng giờ online: </span>
          <span className="font-semibold">{fmtDur(totalOnline)}</span>
        </div>
      </div>

      <div className="overflow-x-auto rounded border">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">Nhân sự</th>
              <th className="px-3 py-2">Trạng thái</th>
              <th className="px-3 py-2 text-right">Giờ online</th>
              <th className="px-3 py-2 text-right">Giờ idle</th>
              <th className="px-3 py-2">Vào ca</th>
              <th className="px-3 py-2">Cuối cùng</th>
              <th className="px-3 py-2 text-right">Tin nhắn</th>
              <th className="px-3 py-2 text-right">Task xong</th>
              <th className="px-3 py-2 text-right">Cuộc gọi</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const st = STATUS_STYLE[r.status] || STATUS_STYLE.offline
              // Mở tab nhiều nhưng idle áp đảo → dấu hiệu "mở cho có", tô cảnh báo.
              const mostlyIdle = r.idle_seconds > r.active_seconds && r.idle_seconds > 1800
              return (
                <tr key={r.email} className="border-t hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-gray-400">{r.role || "—"}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`inline-block size-2 rounded-full ${st.dot}`} />
                      {st.label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-medium">{fmtDur(r.active_seconds)}</td>
                  <td className={`px-3 py-2 text-right ${mostlyIdle ? "font-medium text-amber-600" : "text-gray-500"}`}>
                    {fmtDur(r.idle_seconds)}{mostlyIdle && " ⚠"}
                  </td>
                  <td className="px-3 py-2 text-gray-500">{fmtTime(r.first_seen)}</td>
                  <td className="px-3 py-2 text-gray-500">{fmtTime(r.last_seen)}</td>
                  <td className="px-3 py-2 text-right">{r.messages || "—"}</td>
                  <td className="px-3 py-2 text-right">
                    {r.tasks_done || "—"}
                    {r.tasks_pending > 0 && <span className="ml-1 text-xs text-gray-400">/{r.tasks_pending} chờ</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.calls || "—"}
                    {r.talk_seconds > 0 && <span className="ml-1 text-xs text-gray-400">{fmtDur(r.talk_seconds)}</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => openTimeline(r)} className="text-xs text-blue-600 hover:underline">
                      Nhật ký
                    </button>
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-gray-400">Chưa có dữ liệu</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setDetail(null)}>
          <div className="h-full w-full max-w-md overflow-y-auto bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="font-semibold">{detail.name}</h2>
                <p className="text-xs text-gray-500">Nhật ký ngày {to}</p>
              </div>
              <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-700">✕</button>
            </div>
            {detailLoading && <div className="text-sm text-gray-400">Đang tải...</div>}
            {!detailLoading && detail.items.length === 0 && (
              <div className="text-sm text-gray-400">Không có hoạt động nào trong ngày này</div>
            )}
            <ul className="space-y-3">
              {detail.items.map((it, i) => {
                const k = KIND_STYLE[it.kind] || KIND_STYLE.message
                return (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="w-11 shrink-0 text-xs text-gray-400">{fmtTime(it.at)}</span>
                    <span className={`shrink-0 ${k.cls}`}>{k.icon}</span>
                    <div className="min-w-0">
                      <div className="break-words">{it.label}</div>
                      {it.detail && <div className="truncate text-xs text-gray-400">{it.detail}</div>}
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

export const config = defineRouteConfig({ label: "Chấm công", rank: 19 })

export default withRouteGuard(ChamCongPage)
