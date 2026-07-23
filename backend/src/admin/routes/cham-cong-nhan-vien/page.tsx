import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useCallback, useEffect, useState } from "react"
import { apiJson } from "../../lib/api-client"
import { useCurrentPermissions } from "../../lib/use-permissions"
import { withRouteGuard } from "../../components/route-guard"

// ─── Chấm công ───────────────────────────────────────────────────────────────

type ChamCongLog = {
  id: string
  action: "in" | "out"
  lat: number | null
  lng: number | null
  accuracy_m: number | null
  created_at: string
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" })
}

const GEO_ERROR_MESSAGE: Record<number, string> = {
  1: "Bạn đã từ chối quyền vị trí. Vào cài đặt trình duyệt để bật lại quyền vị trí cho trang này rồi thử lại.",
  2: "Không lấy được vị trí (thiết bị không xác định được GPS). Vui lòng bật định vị (Location/GPS) rồi thử lại.",
  3: "Lấy vị trí quá lâu, vui lòng thử lại.",
}

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Trình duyệt này không hỗ trợ định vị GPS, không thể chấm công."))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      (err) => reject(new Error(GEO_ERROR_MESSAGE[err.code] || "Không lấy được vị trí, vui lòng thử lại.")),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    )
  })
}

type ChamCongConfig = {
  shift_start: string
  shift_end: string
  work_days: number[]
  late_grace_min: number
  half_day_saturdays: string[]
  ot_min_threshold_min: number
  phep_nam_per_month: number
  phep_nam_max_per_year: number
}

type LeaveMini = { start_at: string; end_at: string }

function toDayKey(dt: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number)
  return h * 60 + m
}

// Phân loại 1 ngày trong lịch tháng cho nhân viên xem, theo giờ VN.
// Trả về status màu + chi tiết để hiện popup khi click.
type DayStatus = "worked" | "late" | "leave" | "missing" | "off" | "future" | "empty"
function classifyDay(
  dayKey: string,
  logsByDay: Record<string, ChamCongLog[]>,
  leaves: LeaveMini[],
  config: ChamCongConfig,
  today: string
): { status: DayStatus; firstIn: string | null; lastOut: string | null; lateMin: number; isHalfDay: boolean } {
  const dt = new Date(`${dayKey}T00:00:00Z`)
  const dow = new Date(dayKey + "T12:00:00").getDay() // giờ trưa tránh lệch DST/UTC offset
  const isWorkDay = config.work_days.includes(dow)
  const isHalfDay = (config.half_day_saturdays || []).includes(dayKey)
  const onLeave = leaves.some((l) => new Date(l.start_at) <= new Date(`${dayKey}T23:59:59`) && new Date(l.end_at) >= dt)

  const logs = logsByDay[dayKey] || []
  const firstIn = logs.find((l) => l.action === "in")?.created_at || null
  const lastOut = [...logs].reverse().find((l) => l.action === "out")?.created_at || null

  let lateMin = 0
  if (firstIn) {
    const vn = new Date(new Date(firstIn).getTime() + 7 * 3600_000)
    const actualMin = vn.getUTCHours() * 60 + vn.getUTCMinutes()
    lateMin = Math.max(0, actualMin - hhmmToMinutes(config.shift_start) - config.late_grace_min)
  }

  if (onLeave) return { status: "leave", firstIn, lastOut, lateMin, isHalfDay }
  if (!isWorkDay) return { status: "off", firstIn, lastOut, lateMin, isHalfDay }
  if (dayKey > today) return { status: "future", firstIn, lastOut, lateMin, isHalfDay }
  if (!firstIn) return { status: dayKey === today ? "future" : "missing", firstIn, lastOut, lateMin, isHalfDay }
  return { status: lateMin > 0 ? "late" : "worked", firstIn, lastOut, lateMin, isHalfDay }
}

const DAY_STATUS_STYLE: Record<DayStatus, string> = {
  worked: "bg-green-500 text-white",
  late: "bg-amber-500 text-white",
  leave: "bg-blue-500 text-white",
  missing: "bg-red-500 text-white",
  off: "bg-ui-bg-component text-ui-fg-muted",
  future: "bg-ui-bg-subtle text-ui-fg-muted",
  empty: "",
}

const WEEKDAY_LABELS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"]

function ChamCongSection() {
  const [logs, setLogs] = useState<ChamCongLog[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState("")

  const [cursor, setCursor] = useState(() => new Date())
  const [monthLogs, setMonthLogs] = useState<ChamCongLog[]>([])
  const [monthLeaves, setMonthLeaves] = useState<LeaveMini[]>([])
  const [config, setConfig] = useState<ChamCongConfig>({ shift_start: "08:30", shift_end: "17:30", work_days: [1, 2, 3, 4, 5, 6], late_grace_min: 5, half_day_saturdays: [], ot_min_threshold_min: 15, phep_nam_per_month: 1, phep_nam_max_per_year: 12 })
  const [monthLoading, setMonthLoading] = useState(false)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [leaveBalance, setLeaveBalance] = useState<{ remaining_days: number; accrued_days: number; used_days: number } | null>(null)
  const [otMinutesThisMonth, setOtMinutesThisMonth] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setErr("")
    try {
      const d = await apiJson("/admin/cham-cong/checkin")
      setLogs(d?.logs || [])
    } catch (e: any) {
      setErr(e.message || "Lỗi tải lịch sử chấm công")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const monthKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`
  const loadMonth = useCallback(async () => {
    setMonthLoading(true)
    try {
      const d = await apiJson(`/admin/cham-cong/checkin/month?month=${monthKey}`)
      setMonthLogs(d?.logs || [])
      setMonthLeaves(d?.leaves || [])
      if (d?.config) setConfig(d.config)
    } catch {
      // best-effort — lịch tháng không phải luồng chính, lỗi không chặn chấm công
    } finally {
      setMonthLoading(false)
    }
  }, [monthKey])

  useEffect(() => { loadMonth() }, [loadMonth])

  useEffect(() => {
    apiJson(`/admin/leave-balance?year=${cursor.getFullYear()}`).then((d) => setLeaveBalance(d)).catch(() => {})
  }, [cursor])

  useEffect(() => {
    apiJson(`/admin/cham-cong/overtime?scope=mine&month=${monthKey}`)
      .then((d) => {
        const total = (d?.requests || [])
          .filter((r: any) => r.status === "approved")
          .reduce((s: number, r: any) => s + (r.approved_duration_min ?? r.duration_min), 0)
        setOtMinutesThisMonth(total)
      })
      .catch(() => {})
  }, [monthKey])

  const lastAction = logs.length > 0 ? logs[logs.length - 1].action : null
  const nextAction: "in" | "out" = lastAction === "in" ? "out" : "in"

  const handleCheckin = async () => {
    setSubmitting(true)
    setErr("")
    try {
      const pos = await getPosition()
      await apiJson("/admin/cham-cong/checkin", "POST", {
        action: nextAction,
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy_m: pos.coords.accuracy,
      })
      await load()
      await loadMonth()
    } catch (e: any) {
      setErr(e.message || "Chấm công thất bại")
    } finally {
      setSubmitting(false)
    }
  }

  // ── Lịch tháng ────────────────────────────────────────────────────────────
  const today = toDayKey(new Date())
  const logsByDay: Record<string, ChamCongLog[]> = {}
  for (const l of monthLogs) {
    const key = toDayKey(new Date(new Date(l.created_at).getTime() + 7 * 3600_000))
    ;(logsByDay[key] ||= []).push(l)
  }

  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const firstOfMonth = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const leadingBlank = (firstOfMonth.getDay() + 6) % 7 // T2=0

  const cells: { dayKey: string | null; dayNum: number | null }[] = []
  for (let i = 0; i < leadingBlank; i++) cells.push({ dayKey: null, dayNum: null })
  for (let day = 1; day <= daysInMonth; day++) {
    const dt = new Date(year, month, day)
    cells.push({ dayKey: toDayKey(dt), dayNum: day })
  }

  let workedDays = 0, workDaysTotal = 0, lateDays = 0, leaveDaysTotal = 0
  for (let day = 1; day <= daysInMonth; day++) {
    const dayKey = toDayKey(new Date(year, month, day))
    if (dayKey > today) continue
    const info = classifyDay(dayKey, logsByDay, monthLeaves, config, today)
    if (info.status === "off") continue
    if (info.status === "leave") { leaveDaysTotal++; continue }
    workDaysTotal++
    if (info.status === "worked" || info.status === "late") workedDays++
    if (info.status === "late") lateDays++
  }

  const selectedInfo = selectedDay ? classifyDay(selectedDay, logsByDay, monthLeaves, config, today) : null

  return (
    <div>
      <p className="mb-4 text-sm text-ui-fg-muted">
        Bấm nút bên dưới để chấm công. Bắt buộc cho phép truy cập vị trí (GPS) — nếu từ chối sẽ không chấm công được.
      </p>

      {err && <div className="mb-4 rounded bg-red-50 dark:bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">{err}</div>}

      <button
        onClick={handleCheckin}
        disabled={submitting}
        className={`mb-6 w-full rounded-lg py-4 text-base font-semibold text-white transition-colors disabled:opacity-50 ${
          nextAction === "in" ? "bg-green-600 hover:bg-green-700" : "bg-rose-600 hover:bg-rose-700"
        }`}
      >
        {submitting ? "Đang xử lý..." : nextAction === "in" ? "Chấm công vào" : "Chấm công ra"}
      </button>

      <h2 className="mb-2 text-sm font-semibold text-ui-fg-subtle">Lịch sử hôm nay</h2>
      <div className="mb-6 rounded border border-ui-border-base">
        {loading && <div className="px-3 py-4 text-center text-sm text-ui-fg-muted">Đang tải...</div>}
        {!loading && logs.length === 0 && (
          <div className="px-3 py-4 text-center text-sm text-ui-fg-muted">Chưa chấm công lần nào hôm nay</div>
        )}
        {logs.map((log, i) => (
          <div key={log.id} className={`flex items-center justify-between px-3 py-2 text-sm ${i > 0 ? "border-t border-ui-border-base" : ""}`}>
            <span className="flex items-center gap-2">
              <span className={`inline-block size-2 rounded-full ${log.action === "in" ? "bg-green-500" : "bg-rose-500"}`} />
              {log.action === "in" ? "Vào ca" : "Ra ca"}
            </span>
            <span className="text-ui-fg-muted">{fmtTime(log.created_at)}</span>
            <span className="text-xs text-ui-fg-muted">
              {log.lat != null && log.lng != null ? "📍 Có GPS" : "Không GPS"}
            </span>
          </div>
        ))}
      </div>

      {/* Stat tiles */}
      <div className="mb-5 grid grid-cols-3 gap-3 sm:grid-cols-5">
        <div className="rounded-lg bg-green-50 dark:bg-green-500/10 p-3 text-center">
          <div className="text-lg font-bold text-green-700 dark:text-green-400">{workedDays}/{workDaysTotal}</div>
          <div className="text-xs text-green-700 dark:text-green-400">Công làm</div>
        </div>
        <div className="rounded-lg bg-amber-50 dark:bg-amber-500/10 p-3 text-center">
          <div className="text-lg font-bold text-amber-700 dark:text-amber-400">{lateDays}</div>
          <div className="text-xs text-amber-700 dark:text-amber-400">Đi muộn</div>
        </div>
        <div className="rounded-lg bg-blue-50 dark:bg-blue-500/10 p-3 text-center">
          <div className="text-lg font-bold text-blue-700 dark:text-blue-400">{leaveDaysTotal.toFixed(2)}</div>
          <div className="text-xs text-blue-700 dark:text-blue-400">Ngày nghỉ</div>
        </div>
        <div className="rounded-lg bg-violet-50 dark:bg-violet-500/10 p-3 text-center">
          <div className="text-lg font-bold text-violet-700 dark:text-violet-400">
            {leaveBalance ? leaveBalance.remaining_days.toFixed(1) : "—"}
          </div>
          <div className="text-xs text-violet-700 dark:text-violet-400">Phép còn lại</div>
        </div>
        <div className="rounded-lg bg-teal-50 dark:bg-teal-500/10 p-3 text-center">
          <div className="text-lg font-bold text-teal-700 dark:text-teal-400">
            {(otMinutesThisMonth / 60).toFixed(1)}h
          </div>
          <div className="text-xs text-teal-700 dark:text-teal-400">OT đã duyệt</div>
        </div>
      </div>

      {/* Lịch tháng */}
      <div className="rounded border border-ui-border-base p-3">
        <div className="mb-3 flex items-center justify-between">
          <button onClick={() => setCursor(new Date(year, month - 1, 1))} className="rounded px-2 py-1 text-sm hover:bg-ui-bg-base-hover">‹</button>
          <div className="text-sm font-semibold">Tháng {month + 1}/{year}</div>
          <button onClick={() => setCursor(new Date(year, month + 1, 1))} className="rounded px-2 py-1 text-sm hover:bg-ui-bg-base-hover">›</button>
        </div>
        <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] text-ui-fg-muted">
          {WEEKDAY_LABELS.map((w) => <div key={w}>{w}</div>)}
        </div>
        <div className={`grid grid-cols-7 gap-1 ${monthLoading ? "opacity-50" : ""}`}>
          {cells.map((c, i) => {
            if (!c.dayKey) return <div key={i} />
            const info = classifyDay(c.dayKey, logsByDay, monthLeaves, config, today)
            return (
              <button
                key={c.dayKey}
                onClick={() => setSelectedDay(c.dayKey)}
                title={info.isHalfDay ? "Thứ 7 làm nửa ngày (buổi sáng)" : undefined}
                className={`relative aspect-square rounded text-xs font-medium transition-opacity hover:opacity-80 ${DAY_STATUS_STYLE[info.status]} ${info.isHalfDay ? "ring-2 ring-violet-400" : ""}`}
              >
                {c.dayNum}
              </button>
            )
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-ui-fg-muted">
          <span className="flex items-center gap-1"><span className="inline-block size-2.5 rounded-full bg-green-500" />Đủ công</span>
          <span className="flex items-center gap-1"><span className="inline-block size-2.5 rounded-full bg-amber-500" />Đi muộn</span>
          <span className="flex items-center gap-1"><span className="inline-block size-2.5 rounded-full bg-blue-500" />Nghỉ phép</span>
          <span className="flex items-center gap-1"><span className="inline-block size-2.5 rounded-full bg-red-500" />Chưa chấm công</span>
          <span className="flex items-center gap-1"><span className="inline-block size-2.5 rounded-full bg-gray-300 dark:bg-gray-600 ring-2 ring-violet-400" />T7 nửa ngày</span>
        </div>
      </div>

      {selectedDay && selectedInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setSelectedDay(null)}>
          <div className="w-full max-w-xs rounded-lg bg-ui-bg-base p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-semibold">{selectedDay}</h3>
              <button onClick={() => setSelectedDay(null)} className="text-ui-fg-muted hover:text-ui-fg-base">✕</button>
            </div>
            <div className="space-y-1 text-sm">
              {selectedInfo.isHalfDay && <div className="text-violet-600 dark:text-violet-400">🕐 Thứ 7 làm nửa ngày (buổi sáng)</div>}
              <div>Vào: {selectedInfo.firstIn ? fmtTime(selectedInfo.firstIn) : "—"}{selectedInfo.lateMin > 0 && <span className="ml-1 text-amber-600 dark:text-amber-400">(muộn {selectedInfo.lateMin} phút)</span>}</div>
              <div>Ra: {selectedInfo.lastOut ? fmtTime(selectedInfo.lastOut) : "—"}</div>
              {selectedInfo.firstIn && (
                <a
                  href={`https://maps.google.com/?q=${(logsByDay[selectedDay]?.find((l) => l.action === "in")?.lat) ?? ""},${(logsByDay[selectedDay]?.find((l) => l.action === "in")?.lng) ?? ""}`}
                  target="_blank" rel="noreferrer"
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                >
                  📍 Xem vị trí chấm công
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Xin nghỉ ────────────────────────────────────────────────────────────────

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
  pending: { text: "Chờ duyệt", cls: "text-amber-600 dark:text-amber-400" },
  approved: { text: "Đã duyệt", cls: "text-green-600 dark:text-green-400" },
  rejected: { text: "Từ chối", cls: "text-red-600 dark:text-red-400" },
  cancelled: { text: "Đã hủy", cls: "text-ui-fg-muted" },
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

function XinNghiSection({ canApprove }: { canApprove: boolean }) {
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
    <div className="relative">
      <div className="mb-4 flex gap-4 border-b border-ui-border-base text-sm">
        <button onClick={() => setTab("mine")} className={`pb-2 ${tab === "mine" ? "border-b-2 border-green-600 font-semibold text-green-700 dark:text-green-400" : "text-ui-fg-muted"}`}>
          Đơn của tôi
        </button>
        {canApprove && (
          <>
            <button onClick={() => setTab("pending")} className={`pb-2 ${tab === "pending" ? "border-b-2 border-green-600 font-semibold text-green-700 dark:text-green-400" : "text-ui-fg-muted"}`}>
              Chờ duyệt
            </button>
            <button onClick={() => setTab("approved")} className={`pb-2 ${tab === "approved" ? "border-b-2 border-green-600 font-semibold text-green-700 dark:text-green-400" : "text-ui-fg-muted"}`}>
              Đã duyệt
            </button>
          </>
        )}
      </div>

      {err && <div className="mb-3 rounded bg-red-50 dark:bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">{err}</div>}

      {loading && <div className="py-6 text-center text-sm text-ui-fg-muted">Đang tải...</div>}
      {!loading && requests.length === 0 && (
        <div className="py-6 text-center text-sm text-ui-fg-muted">Không có đơn nào</div>
      )}

      <div className="space-y-3">
        {requests.map((r) => {
          const st = STATUS_LABEL[r.status] || STATUS_LABEL.pending
          return (
            <div key={r.id} className="rounded border border-ui-border-base p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium">{LEAVE_TYPE_LABEL[r.leave_type] || r.leave_type}</span>
                <span className={`text-xs font-semibold ${st.cls}`}>{st.text}</span>
              </div>
              {tab !== "mine" && <div className="mb-1 text-xs text-ui-fg-muted">Người gửi: {r.requester_email}</div>}
              <div className="text-sm text-ui-fg-subtle">Bắt đầu: {fmtDateTime(r.start_at)}</div>
              <div className="text-sm text-ui-fg-subtle">Kết thúc: {fmtDateTime(r.end_at)}</div>
              <div className="text-sm text-ui-fg-subtle">Thời gian: {diffDays(r.start_at, r.end_at)} ngày</div>
              {r.reason && <div className="mt-1 text-sm text-ui-fg-muted italic">Lý do: {r.reason}</div>}

              {tab === "pending" && r.status === "pending" && (
                <div className="mt-2 flex gap-4 border-t border-ui-border-base pt-2 text-sm">
                  <button onClick={() => decide(r.id, "rejected")} className="font-medium text-red-600 dark:text-red-400 hover:underline">Từ chối</button>
                  <button onClick={() => decide(r.id, "approved")} className="font-medium text-green-600 dark:text-green-400 hover:underline">Đồng ý</button>
                </div>
              )}
              {tab === "mine" && r.status === "pending" && (
                <div className="mt-2 border-t border-ui-border-base pt-2 text-sm">
                  <button onClick={() => cancelRequest(r.id)} className="font-medium text-ui-fg-muted hover:underline">Hủy đơn</button>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setShowForm(false)}>
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-lg bg-ui-bg-base p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 font-semibold">Tạo đơn báo nghỉ</h2>
            <label className="mb-3 block text-sm">
              <span className="mb-1 block text-ui-fg-muted">Loại ngày nghỉ</span>
              <select value={leaveType} onChange={(e) => setLeaveType(e.target.value)} className="w-full rounded border border-ui-border-base bg-ui-bg-field px-2 py-1.5 text-ui-fg-base">
                {Object.entries(LEAVE_TYPE_LABEL).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
            </label>
            <label className="mb-3 block text-sm">
              <span className="mb-1 block text-ui-fg-muted">Ngày nghỉ</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value)
                  if (endDate < e.target.value) setEndDate(e.target.value)
                }}
                className="w-full rounded border border-ui-border-base bg-ui-bg-field px-2 py-1.5 text-ui-fg-base"
              />
            </label>

            <div className="mb-3">
              <span className="mb-1 block text-sm text-ui-fg-muted">Buổi nghỉ</span>
              <div className="grid grid-cols-3 gap-2">
                {DAY_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => applyPreset(p)}
                    className={`rounded border border-ui-border-base py-1.5 text-sm font-medium transition-colors ${
                      activePreset === p.key ? "border-green-600 bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400" : "border-ui-border-base text-ui-fg-subtle hover:bg-ui-bg-base-hover"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="mb-1 block text-ui-fg-muted">Giờ bắt đầu</span>
                <select
                  value={startTime}
                  onChange={(e) => { setStartTime(e.target.value); setActivePreset(null) }}
                  className="w-full rounded border border-ui-border-base bg-ui-bg-field px-2 py-1.5 text-ui-fg-base"
                >
                  {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-ui-fg-muted">Giờ kết thúc</span>
                <select
                  value={endTime}
                  onChange={(e) => { setEndTime(e.target.value); setActivePreset(null) }}
                  className="w-full rounded border border-ui-border-base bg-ui-bg-field px-2 py-1.5 text-ui-fg-base"
                >
                  {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
            </div>

            <label className="mb-3 block text-sm">
              <span className="mb-1 block text-ui-fg-muted">Ngày kết thúc (nếu nghỉ nhiều ngày)</span>
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => { setEndDate(e.target.value); setActivePreset(null) }}
                className="w-full rounded border border-ui-border-base bg-ui-bg-field px-2 py-1.5 text-ui-fg-base"
              />
            </label>
            <label className="mb-4 block text-sm">
              <span className="mb-1 block text-ui-fg-muted">Lý do</span>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="w-full rounded border border-ui-border-base bg-ui-bg-field px-2 py-1.5 text-ui-fg-base" />
            </label>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="rounded border border-ui-border-base px-3 py-1.5 text-sm hover:bg-ui-bg-base-hover">Hủy</button>
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

// ─── Làm thêm giờ (OT) ───────────────────────────────────────────────────────

type OvertimeRow = {
  id: string
  user_email: string
  day_key: string
  duration_min: number
  approved_duration_min: number | null
  source: "auto" | "manual"
  note: string | null
  status: "pending" | "approved" | "rejected"
  reviewer_email: string | null
  reviewed_at: string | null
}

function fmtHhMm(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}h` : `${h}h${m}p`
}

function OvertimeSection({ canApprove }: { canApprove: boolean }) {
  const [tab, setTab] = useState<"mine" | "pending" | "approved">("mine")
  const [rows, setRows] = useState<OvertimeRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editMinutes, setEditMinutes] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setErr("")
    try {
      const d = await apiJson(`/admin/cham-cong/overtime?scope=${tab}`)
      setRows(d?.requests || [])
    } catch (e: any) {
      setErr(e.message || "Lỗi tải OT")
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => { load() }, [load])

  const decide = async (id: string, decision: "approved" | "rejected", approvedMinutes?: number) => {
    try {
      await apiJson(`/admin/cham-cong/overtime/${id}/decision`, "PATCH", {
        decision,
        approved_duration_min: approvedMinutes,
      })
      setEditingId(null)
      load()
    } catch (e: any) {
      setErr(e.message || "Xử lý OT thất bại")
    }
  }

  return (
    <div>
      <div className="mb-4 flex gap-4 border-b border-ui-border-base text-sm">
        <button onClick={() => setTab("mine")} className={`pb-2 ${tab === "mine" ? "border-b-2 border-green-600 font-semibold text-green-700 dark:text-green-400" : "text-ui-fg-muted"}`}>
          OT của tôi
        </button>
        {canApprove && (
          <>
            <button onClick={() => setTab("pending")} className={`pb-2 ${tab === "pending" ? "border-b-2 border-green-600 font-semibold text-green-700 dark:text-green-400" : "text-ui-fg-muted"}`}>
              Chờ duyệt
            </button>
            <button onClick={() => setTab("approved")} className={`pb-2 ${tab === "approved" ? "border-b-2 border-green-600 font-semibold text-green-700 dark:text-green-400" : "text-ui-fg-muted"}`}>
              Đã xử lý
            </button>
          </>
        )}
      </div>

      {err && <div className="mb-3 rounded bg-red-50 dark:bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">{err}</div>}
      {loading && <div className="py-6 text-center text-sm text-ui-fg-muted">Đang tải...</div>}
      {!loading && rows.length === 0 && <div className="py-6 text-center text-sm text-ui-fg-muted">Không có bản ghi OT nào</div>}

      <div className="space-y-3">
        {rows.map((r) => {
          const st = STATUS_LABEL[r.status] || STATUS_LABEL.pending
          return (
            <div key={r.id} className="rounded border border-ui-border-base p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium">{r.day_key}</span>
                <span className={`text-xs font-semibold ${st.cls}`}>{st.text}</span>
              </div>
              {tab !== "mine" && <div className="mb-1 text-xs text-ui-fg-muted">{r.user_email}</div>}
              <div className="text-sm text-ui-fg-subtle">
                Đề xuất: {fmtHhMm(r.duration_min)} {r.source === "auto" ? "(tự động từ checkout)" : "(HR khai báo)"}
              </div>
              {r.approved_duration_min != null && (
                <div className="text-sm text-green-700 dark:text-green-400">Đã duyệt: {fmtHhMm(r.approved_duration_min)}</div>
              )}
              {r.note && <div className="mt-1 text-sm italic text-ui-fg-muted">Ghi chú: {r.note}</div>}

              {tab === "pending" && r.status === "pending" && editingId !== r.id && (
                <div className="mt-2 flex items-center gap-4 border-t border-ui-border-base pt-2 text-sm">
                  <button onClick={() => decide(r.id, "rejected")} className="font-medium text-red-600 dark:text-red-400 hover:underline">Từ chối</button>
                  <button onClick={() => decide(r.id, "approved", r.duration_min)} className="font-medium text-green-600 dark:text-green-400 hover:underline">Duyệt đúng đề xuất</button>
                  <button onClick={() => { setEditingId(r.id); setEditMinutes(r.duration_min) }} className="text-ui-fg-muted hover:underline">Sửa số phút rồi duyệt</button>
                </div>
              )}
              {editingId === r.id && (
                <div className="mt-2 flex items-center gap-2 border-t border-ui-border-base pt-2 text-sm">
                  <input
                    type="number" min={0} value={editMinutes}
                    onChange={(e) => setEditMinutes(Number(e.target.value))}
                    className="w-24 rounded border border-ui-border-base bg-ui-bg-field px-2 py-1 text-ui-fg-base"
                  />
                  <span className="text-ui-fg-muted">phút</span>
                  <button onClick={() => decide(r.id, "approved", editMinutes)} className="font-medium text-green-600 dark:text-green-400 hover:underline">Xác nhận duyệt</button>
                  <button onClick={() => setEditingId(null)} className="text-ui-fg-muted hover:underline">Hủy</button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Quản lý (manager) ───────────────────────────────────────────────────────

type TeamDayRow = {
  email: string; name: string
  first_in: string | null; last_out: string | null
  lat: number | null; lng: number | null
  late_minutes: number; on_leave: boolean
}
type TeamLast7 = { date: string; on_time: number; late: number; missing: number }
type TeamMonthRow = { email: string; name: string; worked_days: number; late_days: number; leave_days: number }
type TeamResponse = {
  config: ChamCongConfig
  date: string
  stats: { on_time: number; late: number; missing: number }
  last7days: TeamLast7[]
  day_rows: TeamDayRow[]
  top_early: TeamDayRow[]
  early_leavers: TeamDayRow[]
  month_summary: TeamMonthRow[]
}

function fmtDdMm(dayKey: string): string {
  const [, m, dd] = dayKey.split("-")
  return `${dd}/${m}`
}

function QuanLySection() {
  const [date, setDate] = useState(() => toDayKey(new Date()))
  const [month, setMonth] = useState(() => date.slice(0, 7))
  const [data, setData] = useState<TeamResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState("")
  const [savingConfig, setSavingConfig] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [cfgShiftStart, setCfgShiftStart] = useState("08:30")
  const [cfgShiftEnd, setCfgShiftEnd] = useState("17:30")
  const [cfgWorkDays, setCfgWorkDays] = useState<number[]>([1, 2, 3, 4, 5, 6])
  const [cfgGrace, setCfgGrace] = useState(5)
  const [cfgHalfDaySaturdays, setCfgHalfDaySaturdays] = useState<string[]>([])
  const [newHalfDay, setNewHalfDay] = useState("")
  const [cfgOtThreshold, setCfgOtThreshold] = useState(15)
  const [cfgPhepPerMonth, setCfgPhepPerMonth] = useState(1)
  const [cfgPhepMaxYear, setCfgPhepMaxYear] = useState(12)
  const [exportMonth, setExportMonth] = useState(() => toDayKey(new Date()).slice(0, 7))

  const load = useCallback(async () => {
    setLoading(true)
    setErr("")
    try {
      const d: TeamResponse = await apiJson(`/admin/cham-cong/team?date=${date}&month=${month}`)
      setData(d)
      setCfgShiftStart(d.config.shift_start)
      setCfgShiftEnd(d.config.shift_end)
      setCfgWorkDays(d.config.work_days)
      setCfgGrace(d.config.late_grace_min)
      setCfgHalfDaySaturdays(d.config.half_day_saturdays || [])
      setCfgOtThreshold(d.config.ot_min_threshold_min ?? 15)
      setCfgPhepPerMonth(d.config.phep_nam_per_month ?? 1)
      setCfgPhepMaxYear(d.config.phep_nam_max_per_year ?? 12)
    } catch (e: any) {
      setErr(e.message || "Lỗi tải dữ liệu")
    } finally {
      setLoading(false)
    }
  }, [date, month])

  useEffect(() => { load() }, [load])

  const saveConfig = async () => {
    setSavingConfig(true)
    try {
      await apiJson("/admin/cham-cong/checkin/config", "PATCH", {
        shift_start: cfgShiftStart, shift_end: cfgShiftEnd, work_days: cfgWorkDays, late_grace_min: cfgGrace,
        half_day_saturdays: cfgHalfDaySaturdays,
        ot_min_threshold_min: cfgOtThreshold, phep_nam_per_month: cfgPhepPerMonth, phep_nam_max_per_year: cfgPhepMaxYear,
      })
      await load()
    } catch (e: any) {
      setErr(e.message || "Lưu cài đặt thất bại")
    } finally {
      setSavingConfig(false)
    }
  }

  const toggleWorkDay = (dow: number) => {
    setCfgWorkDays((prev) => prev.includes(dow) ? prev.filter((d) => d !== dow) : [...prev, dow].sort())
  }

  const addHalfDaySaturday = () => {
    if (!newHalfDay) return
    const dow = new Date(newHalfDay + "T12:00:00").getDay()
    if (dow !== 6) { setErr("Ngày chọn phải là Thứ 7"); return }
    setCfgHalfDaySaturdays((prev) => [...new Set([...prev, newHalfDay])].sort())
    setNewHalfDay("")
  }
  const removeHalfDaySaturday = (day: string) => {
    setCfgHalfDaySaturdays((prev) => prev.filter((d) => d !== day))
  }

  if (loading && !data) return <div className="py-8 text-center text-sm text-ui-fg-muted">Đang tải...</div>
  if (!data) return err ? <div className="rounded bg-red-50 dark:bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">{err}</div> : null

  const maxLast7 = Math.max(1, ...data.last7days.map((d) => d.on_time + d.late + d.missing))

  return (
    <div>
      {err && <div className="mb-3 rounded bg-red-50 dark:bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">{err}</div>}

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ui-fg-subtle">Thống kê chấm công</h2>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded border border-ui-border-base bg-ui-bg-field px-2 py-1 text-sm text-ui-fg-base" />
      </div>

      {/* Stat cards — status palette cố định: xanh=đúng giờ, đỏ=chưa checkin, vàng=đến muộn */}
      <div className="mb-5 grid grid-cols-3 gap-3">
        <div className="rounded-lg bg-green-50 dark:bg-green-500/10 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-green-700 dark:text-green-400">Đúng giờ</span>
            <span className="grid size-6 place-items-center rounded-full bg-green-600 text-xs text-white">✓</span>
          </div>
          <div className="mt-1 text-2xl font-bold text-green-700 dark:text-green-400">{data.stats.on_time}</div>
        </div>
        <div className="rounded-lg bg-red-50 dark:bg-red-500/10 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-red-700 dark:text-red-400">Chưa checkin</span>
            <span className="grid size-6 place-items-center rounded-full bg-red-600 text-xs text-white">✕</span>
          </div>
          <div className="mt-1 text-2xl font-bold text-red-700 dark:text-red-400">{data.stats.missing}</div>
        </div>
        <div className="rounded-lg bg-amber-50 dark:bg-amber-500/10 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-amber-700 dark:text-amber-400">Đến muộn</span>
            <span className="grid size-6 place-items-center rounded-full bg-amber-500 text-xs text-white">⏱</span>
          </div>
          <div className="mt-1 text-2xl font-bold text-amber-700 dark:text-amber-400">{data.stats.late}</div>
        </div>
      </div>

      {/* Stacked bar 7 ngày — legend luôn hiện, số đếm in trực tiếp trên mỗi khúc */}
      <div className="mb-5 rounded border border-ui-border-base p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ui-fg-subtle">Check-in 7 ngày</h3>
          <div className="flex gap-3 text-[11px] text-ui-fg-muted">
            <span className="flex items-center gap-1"><span className="inline-block size-2.5 rounded-full bg-green-500" />Đúng giờ</span>
            <span className="flex items-center gap-1"><span className="inline-block size-2.5 rounded-full bg-amber-500" />Đi muộn</span>
            <span className="flex items-center gap-1"><span className="inline-block size-2.5 rounded-full bg-red-500" />Không checkin</span>
          </div>
        </div>
        <div className="flex h-40 items-end gap-2">
          {data.last7days.map((d) => {
            const total = d.on_time + d.late + d.missing
            const barH = (total / maxLast7) * 100
            return (
              <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex w-full flex-col-reverse overflow-hidden rounded" style={{ height: `${Math.max(barH, 4)}%` }}>
                  {d.on_time > 0 && (
                    <div className="flex items-center justify-center bg-green-500 text-[10px] font-semibold text-white" style={{ height: `${(d.on_time / total) * 100}%` }}>
                      {d.on_time}
                    </div>
                  )}
                  {d.late > 0 && (
                    <div className="flex items-center justify-center bg-amber-500 text-[10px] font-semibold text-white" style={{ height: `${(d.late / total) * 100}%` }}>
                      {d.late}
                    </div>
                  )}
                  {d.missing > 0 && (
                    <div className="flex items-center justify-center bg-red-500 text-[10px] font-semibold text-white" style={{ height: `${(d.missing / total) * 100}%` }}>
                      {d.missing}
                    </div>
                  )}
                </div>
                <span className="text-[11px] text-ui-fg-muted">{fmtDdMm(d.date)}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded border border-ui-border-base p-4">
          <h3 className="mb-2 text-sm font-semibold text-ui-fg-subtle">Đi muộn hôm nay</h3>
          {data.day_rows.filter((r) => r.late_minutes > 0).length === 0 ? (
            <div className="py-3 text-center text-xs text-ui-fg-muted">Không có dữ liệu</div>
          ) : (
            <div className="space-y-2">
              {data.day_rows.filter((r) => r.late_minutes > 0).sort((a, b) => b.late_minutes - a.late_minutes).map((r) => (
                <div key={r.email} className="flex items-center justify-between text-sm">
                  <span>{r.name}</span>
                  <span className="font-medium text-amber-600 dark:text-amber-400">{r.late_minutes} phút</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded border border-ui-border-base p-4">
          <h3 className="mb-2 text-sm font-semibold text-ui-fg-subtle">Top check-in sớm nhất</h3>
          {data.top_early.length === 0 ? (
            <div className="py-3 text-center text-xs text-ui-fg-muted">Không có dữ liệu</div>
          ) : (
            <div className="space-y-2">
              {data.top_early.map((r) => (
                <div key={r.email} className="flex items-center justify-between text-sm">
                  <span>{r.name}</span>
                  <span className="text-ui-fg-muted">{r.first_in ? fmtTime(r.first_in) : "—"}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded border border-ui-border-base p-4 md:col-span-2">
          <h3 className="mb-2 text-sm font-semibold text-ui-fg-subtle">Về sớm hôm nay</h3>
          {data.early_leavers.length === 0 ? (
            <div className="py-3 text-center text-xs text-ui-fg-muted">Không có dữ liệu</div>
          ) : (
            <div className="space-y-2">
              {data.early_leavers.map((r) => (
                <div key={r.email} className="flex items-center justify-between text-sm">
                  <span>{r.name}</span>
                  <span className="text-ui-fg-muted">{r.last_out ? fmtTime(r.last_out) : "—"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bảng chi tiết ngày */}
      <div className="mb-5 overflow-x-auto rounded border border-ui-border-base">
        <table className="w-full text-sm">
          <thead className="bg-ui-bg-subtle text-left text-xs uppercase text-ui-fg-muted">
            <tr>
              <th className="px-3 py-2">Nhân viên</th>
              <th className="px-3 py-2">Vào</th>
              <th className="px-3 py-2">Ra</th>
              <th className="px-3 py-2">GPS</th>
              <th className="px-3 py-2">Ghi chú</th>
            </tr>
          </thead>
          <tbody>
            {data.day_rows.map((r) => (
              <tr key={r.email} className="border-t border-ui-border-base">
                <td className="px-3 py-2">{r.name}</td>
                <td className={`px-3 py-2 ${r.late_minutes > 0 ? "font-medium text-red-600 dark:text-red-400" : ""}`}>
                  {r.first_in ? fmtTime(r.first_in) : "—"}
                </td>
                <td className="px-3 py-2">{r.last_out ? fmtTime(r.last_out) : "—"}</td>
                <td className="px-3 py-2">
                  {r.lat != null && r.lng != null ? (
                    <a href={`https://maps.google.com/?q=${r.lat},${r.lng}`} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">Xem vị trí</a>
                  ) : "—"}
                </td>
                <td className="px-3 py-2 text-xs">
                  {r.on_leave ? "🏖 Nghỉ có đơn" : !r.first_in ? "❌ Chưa chấm công" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tổng hợp tháng */}
      <div className="mb-5 rounded border border-ui-border-base p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ui-fg-subtle">Tổng hợp tháng</h3>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded border border-ui-border-base bg-ui-bg-field px-2 py-1 text-sm text-ui-fg-base" />
        </div>
        <div className="space-y-2">
          {data.month_summary.map((m) => {
            const maxDays = Math.max(1, ...data.month_summary.map((x) => x.worked_days))
            return (
              <div key={m.email} className="text-sm">
                <div className="mb-0.5 flex items-center justify-between">
                  <span>{m.name}</span>
                  <span className="text-ui-fg-muted">{m.worked_days} công · {m.late_days} muộn · {m.leave_days} nghỉ</span>
                </div>
                <div className="h-2 overflow-hidden rounded bg-ui-bg-component">
                  <div className="h-full bg-green-500" style={{ width: `${(m.worked_days / maxDays) * 100}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Cài đặt ca */}
      <div className="rounded border border-ui-border-base">
        <button onClick={() => setShowConfig((s) => !s)} className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-ui-fg-subtle">
          Cài đặt ca làm việc
          <span>{showConfig ? "▲" : "▼"}</span>
        </button>
        {showConfig && (
          <div className="border-t border-ui-border-base p-4">
            <div className="mb-3 grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="mb-1 block text-ui-fg-muted">Giờ vào</span>
                <input type="time" value={cfgShiftStart} onChange={(e) => setCfgShiftStart(e.target.value)} className="w-full rounded border border-ui-border-base bg-ui-bg-field px-2 py-1.5 text-ui-fg-base" />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-ui-fg-muted">Giờ ra</span>
                <input type="time" value={cfgShiftEnd} onChange={(e) => setCfgShiftEnd(e.target.value)} className="w-full rounded border border-ui-border-base bg-ui-bg-field px-2 py-1.5 text-ui-fg-base" />
              </label>
            </div>
            <div className="mb-3">
              <span className="mb-1 block text-sm text-ui-fg-muted">Ngày làm việc</span>
              <div className="flex gap-1.5">
                {WEEKDAY_LABELS.map((label, i) => {
                  const dow = i === 6 ? 0 : i + 1 // WEEKDAY_LABELS = T2..CN, dow 0=CN
                  const active = cfgWorkDays.includes(dow)
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => toggleWorkDay(dow)}
                      className={`flex-1 rounded border border-ui-border-base py-1.5 text-xs font-medium ${active ? "border-green-600 bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400" : "border-ui-border-base text-ui-fg-muted"}`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
            <label className="mb-4 block text-sm">
              <span className="mb-1 block text-ui-fg-muted">Phút du di trước khi tính đi muộn</span>
              <input type="number" min={0} max={60} value={cfgGrace} onChange={(e) => setCfgGrace(Number(e.target.value))} className="w-24 rounded border border-ui-border-base bg-ui-bg-field px-2 py-1.5 text-ui-fg-base" />
            </label>

            <div className="mb-4">
              <span className="mb-1 block text-sm text-ui-fg-muted">Thứ 7 làm nửa ngày (chọn thủ công từng ngày, không theo quy luật cố định)</span>
              <div className="mb-2 flex gap-2">
                <input type="date" value={newHalfDay} onChange={(e) => setNewHalfDay(e.target.value)} className="rounded border border-ui-border-base bg-ui-bg-field px-2 py-1.5 text-sm text-ui-fg-base" />
                <button type="button" onClick={addHalfDaySaturday} className="rounded border border-ui-border-base px-3 py-1.5 text-sm hover:bg-ui-bg-base-hover">+ Thêm</button>
              </div>
              {cfgHalfDaySaturdays.length === 0 ? (
                <div className="text-xs text-ui-fg-muted">Chưa có ngày T7 nửa buổi nào trong tháng này</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {cfgHalfDaySaturdays.map((day) => (
                    <span key={day} className="flex items-center gap-1 rounded-full bg-violet-50 dark:bg-violet-500/10 px-2 py-1 text-xs text-violet-700 dark:text-violet-400">
                      {fmtDdMm(day)}/{day.slice(0, 4)}
                      <button type="button" onClick={() => removeHalfDaySaturday(day)} className="text-violet-400 hover:text-violet-700 dark:hover:text-violet-300 dark:text-violet-400">✕</button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="mb-4 border-t border-ui-border-base pt-4">
              <span className="mb-2 block text-sm font-semibold text-ui-fg-subtle">Làm thêm giờ (OT)</span>
              <label className="block text-sm">
                <span className="mb-1 block text-ui-fg-muted">Phút vượt giờ ra ca tối thiểu mới tính OT</span>
                <input type="number" min={0} max={120} value={cfgOtThreshold} onChange={(e) => setCfgOtThreshold(Number(e.target.value))} className="w-24 rounded border border-ui-border-base bg-ui-bg-field px-2 py-1.5 text-ui-fg-base" />
              </label>
            </div>

            <div className="mb-4 border-t border-ui-border-base pt-4">
              <span className="mb-2 block text-sm font-semibold text-ui-fg-subtle">Tích lũy phép năm</span>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="mb-1 block text-ui-fg-muted">Số ngày cộng mỗi tháng làm đủ</span>
                  <input type="number" min={0} step={0.5} value={cfgPhepPerMonth} onChange={(e) => setCfgPhepPerMonth(Number(e.target.value))} className="w-full rounded border border-ui-border-base bg-ui-bg-field px-2 py-1.5 text-ui-fg-base" />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-ui-fg-muted">Trần tối đa mỗi năm</span>
                  <input type="number" min={0} value={cfgPhepMaxYear} onChange={(e) => setCfgPhepMaxYear(Number(e.target.value))} className="w-full rounded border border-ui-border-base bg-ui-bg-field px-2 py-1.5 text-ui-fg-base" />
                </label>
              </div>
              <p className="mt-1 text-xs text-ui-fg-muted">Chỉ áp dụng cho nhân viên đã qua ngày chính thức (xem tab Nhân sự). Cộng dồn tự động mỗi ngày (idempotent theo tháng).</p>
            </div>

            <button onClick={saveConfig} disabled={savingConfig} className="rounded bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-700 disabled:opacity-50">
              {savingConfig ? "Đang lưu..." : "Lưu cài đặt"}
            </button>
          </div>
        )}
      </div>

      {/* Export báo cáo tháng cho kế toán */}
      <div className="mt-5 rounded border border-ui-border-base p-4">
        <h3 className="mb-2 text-sm font-semibold text-ui-fg-subtle">Xuất báo cáo chấm công tháng (CSV)</h3>
        <div className="flex items-center gap-2">
          <input type="month" value={exportMonth} onChange={(e) => setExportMonth(e.target.value)} className="rounded border border-ui-border-base bg-ui-bg-field px-2 py-1.5 text-sm text-ui-fg-base" />
          <a
            href={`/admin/cham-cong/export?month=${exportMonth}`}
            className="rounded bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-700"
          >
            Tải CSV
          </a>
        </div>
        <p className="mt-1 text-xs text-ui-fg-muted">Gồm giờ vào/ra, phút đi muộn, giờ OT đã duyệt, ngày nghỉ có đơn — theo từng ngày làm việc trong tháng.</p>
      </div>
    </div>
  )
}

// ─── Nhân sự ─────────────────────────────────────────────────────────────────

type Employee = {
  id: string
  ma_nv: string
  ho_ten: string
  gioi_tinh: string | null
  team: string | null
  chuc_vu: string | null
  ngay_bat_dau: string | null
  ngay_chinh_thuc: string | null
  email_cong_ty: string | null
  email_ca_nhan: string | null
  ngay_sinh: string | null
  sdt: string | null
  cccd: string | null
  ngay_cap: string | null
  noi_cap: string | null
  noi_o_hien_tai: string | null
  dia_chi_thuong_tru: string | null
  trinh_do: string | null
  hon_nhan: string | null
  ho_so_du: boolean
  hdtv: string | null
  hdld: string | null
  ngay_het_han_hdld: string | null
  ghi_chu: string | null
  trang_thai: string
}

function fmtDateVn(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Ho_Chi_Minh" })
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400_000)
}

const EMPLOYEE_FORM_FIELDS: { key: keyof Employee; label: string; type: "text" | "date" | "checkbox" }[] = [
  { key: "ma_nv", label: "Mã NV", type: "text" },
  { key: "ho_ten", label: "Họ và tên", type: "text" },
  { key: "gioi_tinh", label: "Giới tính", type: "text" },
  { key: "team", label: "Team", type: "text" },
  { key: "chuc_vu", label: "Chức vụ", type: "text" },
  { key: "ngay_bat_dau", label: "Ngày bắt đầu", type: "date" },
  { key: "ngay_chinh_thuc", label: "Ngày chính thức", type: "date" },
  { key: "email_cong_ty", label: "Email công ty", type: "text" },
  { key: "email_ca_nhan", label: "Email cá nhân", type: "text" },
  { key: "ngay_sinh", label: "Ngày sinh", type: "date" },
  { key: "sdt", label: "SĐT", type: "text" },
  { key: "cccd", label: "CCCD/Hộ chiếu", type: "text" },
  { key: "ngay_cap", label: "Ngày cấp", type: "date" },
  { key: "noi_cap", label: "Nơi cấp", type: "text" },
  { key: "noi_o_hien_tai", label: "Nơi ở hiện tại", type: "text" },
  { key: "dia_chi_thuong_tru", label: "Địa chỉ thường trú", type: "text" },
  { key: "trinh_do", label: "Trình độ học vấn", type: "text" },
  { key: "hon_nhan", label: "Tình trạng hôn nhân", type: "text" },
  { key: "hdtv", label: "HĐTV", type: "text" },
  { key: "hdld", label: "HĐLĐ", type: "text" },
  { key: "ngay_het_han_hdld", label: "Ngày hết hạn HĐLĐ", type: "date" },
  { key: "ghi_chu", label: "Ghi chú", type: "text" },
]

function NhanSuSection({ canManage }: { canManage: boolean }) {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState("")
  const [q, setQ] = useState("")
  const [teamFilter, setTeamFilter] = useState("")
  const [detail, setDetail] = useState<Employee | null>(null)
  const [editing, setEditing] = useState<Partial<Employee> | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setErr("")
    try {
      const params = new URLSearchParams()
      if (q.trim()) params.set("q", q.trim())
      if (teamFilter) params.set("team", teamFilter)
      const d = await apiJson(`/admin/nhan-su?${params.toString()}`)
      setEmployees(d?.employees || [])
    } catch (e: any) {
      setErr(e.message || "Lỗi tải danh sách nhân sự")
    } finally {
      setLoading(false)
    }
  }, [q, teamFilter])

  useEffect(() => { load() }, [load])

  const teams = [...new Set(employees.map((e) => e.team).filter(Boolean))] as string[]
  const activeCount = employees.filter((e) => e.trang_thai === "active").length
  const expiringSoon = employees.filter((e) => {
    const days = daysUntil(e.ngay_het_han_hdld)
    return days !== null && days <= 30
  }).length

  const saveEmployee = async () => {
    if (!editing) return
    setSaving(true)
    try {
      if (editing.id) {
        await apiJson(`/admin/nhan-su/${editing.id}`, "PATCH", editing)
      } else {
        await apiJson("/admin/nhan-su", "POST", editing)
      }
      setEditing(null)
      setDetail(null)
      load()
    } catch (e: any) {
      setErr(e.message || "Lưu hồ sơ thất bại")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      {err && <div className="mb-3 rounded bg-red-50 dark:bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">{err}</div>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tên/mã NV/SĐT..."
          className="min-w-[160px] flex-1 rounded border border-ui-border-base bg-ui-bg-field px-3 py-1.5 text-sm text-ui-fg-base"
        />
        <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} className="rounded border border-ui-border-base bg-ui-bg-field px-2 py-1.5 text-sm text-ui-fg-base">
          <option value="">Tất cả team</option>
          {teams.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {canManage && (
          <button
            onClick={() => setEditing({ ho_so_du: false, trang_thai: "active" })}
            className="rounded bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-700"
          >
            + Thêm nhân viên
          </button>
        )}
      </div>

      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className="rounded-lg bg-ui-bg-subtle p-3 text-center">
          <div className="text-lg font-bold text-ui-fg-base">{employees.length}</div>
          <div className="text-xs text-ui-fg-muted">Tổng NV</div>
        </div>
        <div className="rounded-lg bg-green-50 dark:bg-green-500/10 p-3 text-center">
          <div className="text-lg font-bold text-green-700 dark:text-green-400">{activeCount}</div>
          <div className="text-xs text-green-700 dark:text-green-400">Đang làm việc</div>
        </div>
        <div className="rounded-lg bg-red-50 dark:bg-red-500/10 p-3 text-center">
          <div className="text-lg font-bold text-red-700 dark:text-red-400">{expiringSoon}</div>
          <div className="text-xs text-red-700 dark:text-red-400">Sắp hết hạn HĐLĐ</div>
        </div>
      </div>

      {loading && <div className="py-6 text-center text-sm text-ui-fg-muted">Đang tải...</div>}

      {!loading && (
        <div className="overflow-x-auto rounded border border-ui-border-base">
          <table className="w-full text-sm">
            <thead className="bg-ui-bg-subtle text-left text-xs uppercase text-ui-fg-muted">
              <tr>
                <th className="px-3 py-2">Mã NV</th>
                <th className="px-3 py-2">Họ tên</th>
                <th className="px-3 py-2">Team</th>
                <th className="px-3 py-2">Chức vụ</th>
                <th className="px-3 py-2">SĐT</th>
                <th className="px-3 py-2">HĐLĐ hết hạn</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => {
                const days = daysUntil(e.ngay_het_han_hdld)
                const expiryCls = days !== null && days <= 30 ? "font-medium text-red-600 dark:text-red-400" : days !== null && days <= 90 ? "font-medium text-amber-600 dark:text-amber-400" : ""
                return (
                  <tr key={e.id} onClick={() => setDetail(e)} className="cursor-pointer border-t border-ui-border-base hover:bg-ui-bg-base-hover">
                    <td className="px-3 py-2 font-mono text-xs">{e.ma_nv}</td>
                    <td className="px-3 py-2">{e.ho_ten}</td>
                    <td className="px-3 py-2">{e.team || "—"}</td>
                    <td className="px-3 py-2">{e.chuc_vu || "—"}</td>
                    <td className="px-3 py-2">{e.sdt || "—"}</td>
                    <td className={`px-3 py-2 ${expiryCls}`}>{fmtDateVn(e.ngay_het_han_hdld)}</td>
                  </tr>
                )
              })}
              {employees.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-ui-fg-muted">Không tìm thấy nhân sự</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {detail && !editing && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setDetail(null)}>
          <div className="h-full w-full max-w-md overflow-y-auto bg-ui-bg-base p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="font-semibold">{detail.ho_ten}</h2>
                <p className="text-xs text-ui-fg-muted">{detail.ma_nv} · {detail.chuc_vu || "—"}</p>
              </div>
              <button onClick={() => setDetail(null)} className="text-ui-fg-muted hover:text-ui-fg-base">✕</button>
            </div>
            <div className="space-y-3 text-sm">
              <Field label="Giới tính" value={detail.gioi_tinh} />
              <Field label="Team" value={detail.team} />
              <Field label="Ngày bắt đầu" value={fmtDateVn(detail.ngay_bat_dau)} />
              <Field label="Ngày chính thức" value={fmtDateVn(detail.ngay_chinh_thuc)} />
              <Field label="Email công ty" value={detail.email_cong_ty} />
              <Field label="Email cá nhân" value={detail.email_ca_nhan} />
              <Field label="Ngày sinh" value={fmtDateVn(detail.ngay_sinh)} />
              <Field label="SĐT" value={detail.sdt} />
              <Field label="CCCD/Hộ chiếu" value={detail.cccd} />
              <Field label="Ngày cấp" value={fmtDateVn(detail.ngay_cap)} />
              <Field label="Nơi cấp" value={detail.noi_cap} />
              <Field label="Nơi ở hiện tại" value={detail.noi_o_hien_tai} />
              <Field label="Địa chỉ thường trú" value={detail.dia_chi_thuong_tru} />
              <Field label="Trình độ" value={detail.trinh_do} />
              <Field label="Hôn nhân" value={detail.hon_nhan} />
              <Field label="Hồ sơ đủ" value={detail.ho_so_du ? "Có" : "Chưa"} />
              <Field label="HĐTV" value={detail.hdtv} />
              <Field label="HĐLĐ" value={detail.hdld} />
              <Field label="Ngày hết hạn HĐLĐ" value={fmtDateVn(detail.ngay_het_han_hdld)} />
              <Field label="Ghi chú" value={detail.ghi_chu} />
            </div>
            {canManage && (
              <button onClick={() => setEditing(detail)} className="mt-4 rounded bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-700">
                Sửa hồ sơ
              </button>
            )}
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setEditing(null)}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg bg-ui-bg-base p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 font-semibold">{editing.id ? "Sửa hồ sơ" : "Thêm nhân viên"}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {EMPLOYEE_FORM_FIELDS.map((f) => (
                <label key={String(f.key)} className="block text-sm">
                  <span className="mb-1 block text-ui-fg-muted">{f.label}</span>
                  <input
                    type={f.type === "date" ? "date" : "text"}
                    value={f.type === "date" ? String(editing[f.key] || "").slice(0, 10) : String(editing[f.key] ?? "")}
                    onChange={(e) => setEditing((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    className="w-full rounded border border-ui-border-base bg-ui-bg-field px-2 py-1.5 text-ui-fg-base"
                  />
                </label>
              ))}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!editing.ho_so_du} onChange={(e) => setEditing((prev) => ({ ...prev, ho_so_du: e.target.checked }))} />
                Hồ sơ đủ
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="rounded border border-ui-border-base px-3 py-1.5 text-sm hover:bg-ui-bg-base-hover">Hủy</button>
              <button onClick={saveEmployee} disabled={saving} className="rounded bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-700 disabled:opacity-50">
                {saving ? "Đang lưu..." : "Lưu"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-xs text-ui-fg-muted">{label}</div>
      <div>{value || "—"}</div>
    </div>
  )
}

// ─── Trang gộp Acheckin ──────────────────────────────────────────────────────

function AcheckinPage() {
  const { has } = useCurrentPermissions()
  const canApprove = has("page.leave-request.approve")
  const canApproveOt = has("page.overtime.approve")
  const canViewNhanSu = has("page.nhan-su.view")
  const canManageNhanSu = has("page.nhan-su.manage")
  const canViewQuanLy = has("page.cham-cong.view")
  const [section, setSection] = useState<"cham-cong" | "xin-nghi" | "ot" | "quan-ly" | "nhan-su">("cham-cong")

  const isWide = section === "quan-ly" || section === "nhan-su"

  return (
    <div className={`mx-auto p-4 text-ui-fg-base md:p-6 ${isWide ? "max-w-5xl" : "max-w-2xl"}`}>
      <h1 className="mb-1 text-xl font-semibold">Acheckin</h1>
      <p className="mb-4 text-sm text-ui-fg-muted">Chấm công vị trí + báo nghỉ{(canViewQuanLy || canViewNhanSu) ? " + quản lý nhân sự" : ""}</p>

      <div className="mb-5 flex flex-wrap gap-2 rounded-lg bg-ui-bg-component p-1">
        <button
          onClick={() => setSection("cham-cong")}
          className={`min-w-fit flex-1 whitespace-nowrap rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
            section === "cham-cong" ? "bg-ui-bg-base text-green-700 dark:text-green-400 shadow-sm" : "text-ui-fg-muted hover:text-ui-fg-base"
          }`}
        >
          Chấm công
        </button>
        <button
          onClick={() => setSection("xin-nghi")}
          className={`min-w-fit flex-1 whitespace-nowrap rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
            section === "xin-nghi" ? "bg-ui-bg-base text-green-700 dark:text-green-400 shadow-sm" : "text-ui-fg-muted hover:text-ui-fg-base"
          }`}
        >
          Đơn báo nghỉ
        </button>
        <button
          onClick={() => setSection("ot")}
          className={`min-w-fit flex-1 whitespace-nowrap rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
            section === "ot" ? "bg-ui-bg-base text-green-700 dark:text-green-400 shadow-sm" : "text-ui-fg-muted hover:text-ui-fg-base"
          }`}
        >
          Làm thêm giờ
        </button>
        {canViewQuanLy && (
          <button
            onClick={() => setSection("quan-ly")}
            className={`min-w-fit flex-1 whitespace-nowrap rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
              section === "quan-ly" ? "bg-ui-bg-base text-green-700 dark:text-green-400 shadow-sm" : "text-ui-fg-muted hover:text-ui-fg-base"
            }`}
          >
            Quản lý
          </button>
        )}
        {canViewNhanSu && (
          <button
            onClick={() => setSection("nhan-su")}
            className={`min-w-fit flex-1 whitespace-nowrap rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
              section === "nhan-su" ? "bg-ui-bg-base text-green-700 dark:text-green-400 shadow-sm" : "text-ui-fg-muted hover:text-ui-fg-base"
            }`}
          >
            Nhân sự
          </button>
        )}
      </div>

      {section === "cham-cong" && <ChamCongSection />}
      {section === "xin-nghi" && <XinNghiSection canApprove={canApprove} />}
      {section === "ot" && <OvertimeSection canApprove={canApproveOt} />}
      {section === "quan-ly" && canViewQuanLy && <QuanLySection />}
      {section === "nhan-su" && canViewNhanSu && <NhanSuSection canManage={canManageNhanSu} />}
    </div>
  )
}

export const config = defineRouteConfig({ label: "Acheckin", rank: 20 })

export default withRouteGuard(AcheckinPage)
