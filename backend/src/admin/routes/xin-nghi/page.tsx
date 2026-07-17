import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useCallback, useEffect, useState } from "react"
import { apiJson } from "../../lib/api-client"
import { useCurrentPermissions } from "../../lib/use-permissions"
import { withRouteGuard } from "../../components/route-guard"

type LeaveRequest = {
  id: string
  requester_email: string
  leave_type: "khong_luong" | "phep_nam" | "om" | "khac"
  start_at: string
  end_at: string
  reason: string | null
  status: "pending" | "approved" | "rejected" | "cancelled"
  reviewer_email: string | null
  reviewed_at: string | null
  created_at: string
}

const LEAVE_TYPE_LABEL: Record<string, string> = {
  khong_luong: "Nghỉ không lương",
  phep_nam: "Nghỉ phép năm",
  om: "Nghỉ ốm",
  khac: "Khác",
}

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  pending: { text: "Chờ duyệt", cls: "text-amber-600" },
  approved: { text: "Đã duyệt", cls: "text-green-600" },
  rejected: { text: "Từ chối", cls: "text-red-600" },
  cancelled: { text: "Đã hủy", cls: "text-gray-400" },
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Ho_Chi_Minh" })
}

function diffDays(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  const days = ms / (8 * 3600 * 1000)
  return days.toFixed(2)
}

function toDateInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Giờ hành chính 08:30-17:30 — dropdown mốc 30 phút, gọn hơn cuộn giờ/phút/AM-PM của datetime-local native.
const TIME_OPTIONS: string[] = (() => {
  const out: string[] = []
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`)
    }
  }
  return out
})()

const DAY_PRESETS: { key: string; label: string; start: string; end: string }[] = [
  { key: "full", label: "Cả ngày", start: "08:30", end: "17:30" },
  { key: "morning", label: "Buổi sáng", start: "08:30", end: "12:00" },
  { key: "afternoon", label: "Buổi chiều", start: "13:30", end: "17:30" },
]

function XinNghiPage() {
  const { has } = useCurrentPermissions()
  const canApprove = has("page.leave-request.approve")
  const [tab, setTab] = useState<"mine" | "pending" | "approved">("mine")
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState("")
  const [showForm, setShowForm] = useState(false)

  const [leaveType, setLeaveType] = useState("phep_nam")
  const [startDate, setStartDate] = useState(() => toDateInputValue(new Date()))
  const [startTime, setStartTime] = useState("08:30")
  const [endDate, setEndDate] = useState(() => toDateInputValue(new Date()))
  const [endTime, setEndTime] = useState("17:30")
  const [activePreset, setActivePreset] = useState<string | null>("full")
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const applyPreset = (preset: typeof DAY_PRESETS[number]) => {
    setActivePreset(preset.key)
    setStartTime(preset.start)
    setEndTime(preset.end)
    setEndDate(startDate)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setErr("")
    try {
      const d = await apiJson(`/admin/leave-request?scope=${tab}`)
      setRequests(d?.requests || [])
    } catch (e: any) {
      setErr(e.message || "Lỗi tải đơn")
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => { load() }, [load])

  const submitRequest = async () => {
    setSubmitting(true)
    setErr("")
    try {
      await apiJson("/admin/leave-request", "POST", {
        leave_type: leaveType,
        start_at: new Date(`${startDate}T${startTime}:00`).toISOString(),
        end_at: new Date(`${endDate}T${endTime}:00`).toISOString(),
        reason: reason.trim() || null,
      })
      setShowForm(false)
      setReason("")
      if (tab === "mine") load()
    } catch (e: any) {
      setErr(e.message || "Tạo đơn thất bại")
    } finally {
      setSubmitting(false)
    }
  }

  const decide = async (id: string, decision: "approved" | "rejected") => {
    try {
      await apiJson(`/admin/leave-request/${id}/decision`, "PATCH", { decision })
      load()
    } catch (e: any) {
      setErr(e.message || "Xử lý đơn thất bại")
    }
  }

  const cancelRequest = async (id: string) => {
    try {
      await apiJson(`/admin/leave-request/${id}`, "PATCH", { action: "cancel" })
      load()
    } catch (e: any) {
      setErr(e.message || "Hủy đơn thất bại")
    }
  }

  return (
    <div className="relative mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-xl font-semibold">Đơn báo nghỉ</h1>

      <div className="mb-4 flex gap-4 border-b text-sm">
        <button onClick={() => setTab("mine")} className={`pb-2 ${tab === "mine" ? "border-b-2 border-green-600 font-semibold text-green-700" : "text-gray-500"}`}>
          Đơn của tôi
        </button>
        {canApprove && (
          <>
            <button onClick={() => setTab("pending")} className={`pb-2 ${tab === "pending" ? "border-b-2 border-green-600 font-semibold text-green-700" : "text-gray-500"}`}>
              Chờ duyệt
            </button>
            <button onClick={() => setTab("approved")} className={`pb-2 ${tab === "approved" ? "border-b-2 border-green-600 font-semibold text-green-700" : "text-gray-500"}`}>
              Đã duyệt
            </button>
          </>
        )}
      </div>

      {err && <div className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      {loading && <div className="py-6 text-center text-sm text-gray-400">Đang tải...</div>}
      {!loading && requests.length === 0 && (
        <div className="py-6 text-center text-sm text-gray-400">Không có đơn nào</div>
      )}

      <div className="space-y-3">
        {requests.map((r) => {
          const st = STATUS_LABEL[r.status] || STATUS_LABEL.pending
          return (
            <div key={r.id} className="rounded border p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium">{LEAVE_TYPE_LABEL[r.leave_type] || r.leave_type}</span>
                <span className={`text-xs font-semibold ${st.cls}`}>{st.text}</span>
              </div>
              {tab !== "mine" && <div className="mb-1 text-xs text-gray-500">Người gửi: {r.requester_email}</div>}
              <div className="text-sm text-gray-600">Bắt đầu: {fmtDateTime(r.start_at)}</div>
              <div className="text-sm text-gray-600">Kết thúc: {fmtDateTime(r.end_at)}</div>
              <div className="text-sm text-gray-600">Thời gian: {diffDays(r.start_at, r.end_at)} ngày</div>
              {r.reason && <div className="mt-1 text-sm text-gray-500 italic">Lý do: {r.reason}</div>}

              {tab === "pending" && r.status === "pending" && (
                <div className="mt-2 flex gap-4 border-t pt-2 text-sm">
                  <button onClick={() => decide(r.id, "rejected")} className="font-medium text-red-600 hover:underline">Từ chối</button>
                  <button onClick={() => decide(r.id, "approved")} className="font-medium text-green-600 hover:underline">Đồng ý</button>
                </div>
              )}
              {tab === "mine" && r.status === "pending" && (
                <div className="mt-2 border-t pt-2 text-sm">
                  <button onClick={() => cancelRequest(r.id)} className="font-medium text-gray-500 hover:underline">Hủy đơn</button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <button
        onClick={() => setShowForm(true)}
        className="fixed bottom-8 right-8 grid size-14 place-items-center rounded-full bg-green-600 text-2xl text-white shadow-lg hover:bg-green-700"
      >
        +
      </button>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 font-semibold">Tạo đơn báo nghỉ</h2>
            <label className="mb-3 block text-sm">
              <span className="mb-1 block text-gray-500">Loại ngày nghỉ</span>
              <select value={leaveType} onChange={(e) => setLeaveType(e.target.value)} className="w-full rounded border px-2 py-1.5">
                {Object.entries(LEAVE_TYPE_LABEL).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
            </label>
            <label className="mb-3 block text-sm">
              <span className="mb-1 block text-gray-500">Ngày nghỉ</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value)
                  if (endDate < e.target.value) setEndDate(e.target.value)
                }}
                className="w-full rounded border px-2 py-1.5"
              />
            </label>

            <div className="mb-3">
              <span className="mb-1 block text-sm text-gray-500">Buổi nghỉ</span>
              <div className="grid grid-cols-3 gap-2">
                {DAY_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => applyPreset(p)}
                    className={`rounded border py-1.5 text-sm font-medium transition-colors ${
                      activePreset === p.key ? "border-green-600 bg-green-50 text-green-700" : "border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="mb-1 block text-gray-500">Giờ bắt đầu</span>
                <select
                  value={startTime}
                  onChange={(e) => { setStartTime(e.target.value); setActivePreset(null) }}
                  className="w-full rounded border px-2 py-1.5"
                >
                  {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-gray-500">Giờ kết thúc</span>
                <select
                  value={endTime}
                  onChange={(e) => { setEndTime(e.target.value); setActivePreset(null) }}
                  className="w-full rounded border px-2 py-1.5"
                >
                  {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
            </div>

            <label className="mb-3 block text-sm">
              <span className="mb-1 block text-gray-500">Ngày kết thúc (nếu nghỉ nhiều ngày)</span>
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => { setEndDate(e.target.value); setActivePreset(null) }}
                className="w-full rounded border px-2 py-1.5"
              />
            </label>
            <label className="mb-4 block text-sm">
              <span className="mb-1 block text-gray-500">Lý do</span>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="w-full rounded border px-2 py-1.5" />
            </label>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50">Hủy</button>
              <button onClick={submitRequest} disabled={submitting} className="rounded bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-700 disabled:opacity-50">
                {submitting ? "Đang gửi..." : "Gửi đơn"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export const config = defineRouteConfig({ label: "Xin nghỉ", rank: 21 })

export default withRouteGuard(XinNghiPage)
