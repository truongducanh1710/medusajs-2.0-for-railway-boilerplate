import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useState, useEffect, useCallback } from "react"
import { apiFetch } from "../../lib/api-client"
import { withRouteGuard } from "../../components/route-guard"

// ---- Helpers ----

function toISODateString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// BUG THẬT: thiếu offset "+07:00" — server Railway chạy UTC, nên
// new Date("2026-07-22T00:00:00") (không offset) bị hiểu là UTC 00:00, LỆCH 7 TIẾNG
// so với "00:00 giờ VN" thật mà người dùng chọn trên UI. Khác trường hợp CDR (route
// nhận YYYY-MM-DD thuần) — ở đây UI tự build chuỗi có phần giờ nhưng quên offset, nên
// phải fix tại nguồn build chuỗi này, không phải ở route.
function toISO(dateStr: string, endOfDay = false): string {
  if (endOfDay) return `${dateStr}T23:59:59+07:00`
  return `${dateStr}T00:00:00+07:00`
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  return `${m}m ${sec % 60}s`
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-green-50 text-green-700 border-green-200",
  CONVERTED: "bg-green-50 text-green-700 border-green-200",
  CONVERTING: "bg-blue-50 text-blue-700 border-blue-200",
  INACTIVE: "bg-gray-50 text-gray-600 border-gray-200",
  DELETED: "bg-gray-50 text-gray-500 border-gray-200",
  UP_FAILED: "bg-red-50 text-red-700 border-red-200",
}

const TYPE_LABELS: Record<string, string> = {
  package: "Đóng gói",
  inbound: "Nhập kho",
  outbound: "Xuất kho",
  prepare: "Chuẩn bị hàng",
}

const LAST_JOB_STORAGE_KEY = "dohana-sync:last-job-id"

type Video = {
  id: string
  order_code: string
  type: string
  status: string
  slug: string
  duration: number
  start_time: string | null
  user_email: string
  user_name: string
  drive_link: string | null
}

const DohanaSyncPage = () => {
  const [videos, setVideos] = useState<Video[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(0)
  const limit = 50

  // Filters
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")
  const [status, setStatus] = useState("all")
  const [type, setType] = useState("all")
  const [userEmail, setUserEmail] = useState("all")
  const [orderCode, setOrderCode] = useState("")

  // Sync job
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<any>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  // Default: 7 ngày gần nhất
  useEffect(() => {
    const to = new Date()
    const from = new Date()
    from.setDate(from.getDate() - 7)
    setFromDate(toISODateString(from))
    setToDate(toISODateString(to))
  }, [])

  const loadVideos = useCallback(async () => {
    if (!fromDate || !toDate) return
    setLoading(true)
    try {
      const params = new URLSearchParams({
        from: toISO(fromDate),
        to: toISO(toDate, true),
        status,
        type,
        user_email: userEmail,
        page: String(page),
        limit: String(limit),
      })
      if (orderCode.trim()) params.set("orderCode", orderCode.trim())

      const res = await apiFetch(`/admin/dohana-sync/videos?${params.toString()}`)
      if (!res.ok) return
      const data = await res.json()
      setVideos(data.videos ?? [])
      setCount(data.count ?? 0)
    } finally {
      setLoading(false)
    }
  }, [fromDate, toDate, status, type, userEmail, orderCode, page])

  useEffect(() => { loadVideos() }, [loadVideos])

  // Poll job status
  const pollStatus = useCallback(async (id: string) => {
    try {
      const res = await apiFetch(`/admin/dohana-sync/status?jobId=${id}`)
      if (!res.ok) return
      const data = await res.json()
      setJobStatus(data)
      if (data.status === "done" || data.status === "failed") {
        setSyncing(false)
        localStorage.removeItem(LAST_JOB_STORAGE_KEY)
        loadVideos()
      }
    } catch {
      // ignore poll errors
    }
  }, [loadVideos])

  useEffect(() => {
    if (!jobId) return
    const interval = setInterval(() => pollStatus(jobId), 2000)
    return () => clearInterval(interval)
  }, [jobId, pollStatus])

  // Resume job đang chạy sau khi refresh trang
  useEffect(() => {
    const savedJobId = localStorage.getItem(LAST_JOB_STORAGE_KEY)
    if (!savedJobId) return
    ;(async () => {
      try {
        const res = await apiFetch(`/admin/dohana-sync/status?jobId=${savedJobId}`)
        if (!res.ok) { localStorage.removeItem(LAST_JOB_STORAGE_KEY); return }
        const data = await res.json()
        if (data.status === "done" || data.status === "failed") {
          localStorage.removeItem(LAST_JOB_STORAGE_KEY)
          return
        }
        setJobId(savedJobId)
        setJobStatus(data)
        setSyncing(true)
      } catch { /* offline */ }
    })()
  }, [])

  const startSync = async () => {
    if (!fromDate || !toDate) return
    setSyncError(null)
    setSyncing(true)
    setJobStatus(null)

    try {
      const res = await apiFetch("/admin/dohana-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: toISO(fromDate), to: toISO(toDate, true) }),
      })
      const data = await res.json()

      if (res.status === 409) {
        if (data.existingJobId) {
          setJobId(data.existingJobId)
          localStorage.setItem(LAST_JOB_STORAGE_KEY, data.existingJobId)
          setSyncError(`Đã có job đang chạy — chuyển sang theo dõi job ${data.existingJobId.slice(-8)}`)
          return
        }
        setSyncError(data.error || "Một job sync khác đang chạy")
        setSyncing(false)
        return
      }
      if (!res.ok) {
        setSyncError(data.error || `Lỗi ${res.status}`)
        setSyncing(false)
        return
      }
      setJobId(data.jobId)
      localStorage.setItem(LAST_JOB_STORAGE_KEY, data.jobId)
    } catch (err: any) {
      setSyncError(err.message)
      setSyncing(false)
    }
  }

  const viewVideo = async (video: Video) => {
    if (video.drive_link) {
      window.open(video.drive_link, "_blank")
      return
    }
    try {
      const res = await apiFetch(`/admin/dohana-sync/genlink?slug=${video.slug}`, { method: "POST" })
      const data = await res.json()
      if (data.link) window.open(data.link, "_blank")
      else alert("Không lấy được link video")
    } catch {
      alert("Lỗi khi lấy link video")
    }
  }

  const distinctEmails = Array.from(new Set(videos.map((v) => v.user_email).filter(Boolean)))
  const isRunning = syncing && jobStatus?.status !== "done" && jobStatus?.status !== "failed"

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-2">Kho Vận — Video đóng gói (Dohana)</h1>
      <p className="text-gray-500 text-sm mb-6">
        Theo dõi video quay đóng gói/nhập/xuất kho — lọc theo ngày, trạng thái, nhân viên.
      </p>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 shadow-sm flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1 font-medium">Từ ngày</label>
          <input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(0) }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1 font-medium">Đến ngày</label>
          <input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(0) }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1 font-medium">Trạng thái</label>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0) }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
            <option value="all">Tất cả</option>
            {Object.keys(STATUS_COLORS).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1 font-medium">Loại video</label>
          <select value={type} onChange={(e) => { setType(e.target.value); setPage(0) }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
            <option value="all">Tất cả</option>
            {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1 font-medium">Nhân viên</label>
          <select value={userEmail} onChange={(e) => { setUserEmail(e.target.value); setPage(0) }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm max-w-[200px]">
            <option value="all">Tất cả</option>
            {distinctEmails.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1 font-medium">Mã đơn</label>
          <input type="text" value={orderCode} onChange={(e) => { setOrderCode(e.target.value); setPage(0) }}
            placeholder="Mã đơn hàng"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <button onClick={startSync} disabled={isRunning}
          className="ml-auto bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
          {isRunning ? "⏳ Đang đồng bộ..." : "🔄 Đồng bộ lại"}
        </button>
      </div>

      {syncError && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg mb-4 text-sm">
          {syncError}
        </div>
      )}

      {jobStatus && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 shadow-sm text-sm flex items-center gap-4">
          <span>
            {jobStatus.status === "running" && <span className="text-blue-600 font-medium">⏳ Đang đồng bộ...</span>}
            {jobStatus.status === "queued" && <span className="text-gray-500 font-medium">Đang khởi tạo...</span>}
            {jobStatus.status === "done" && <span className="text-green-600 font-medium">✓ Hoàn thành</span>}
            {jobStatus.status === "failed" && <span className="text-red-600 font-medium">✗ Thất bại</span>}
          </span>
          <span className="text-gray-500">Mới: {jobStatus.stats?.imported ?? 0}</span>
          <span className="text-gray-500">Cập nhật: {jobStatus.stats?.updated ?? 0}</span>
          {jobStatus.stats?.total_pages > 0 && (
            <span className="text-gray-400">Trang {jobStatus.stats?.current_page ?? 0}/{jobStatus.stats?.total_pages}</span>
          )}
        </div>
      )}

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Mã đơn</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Nhân viên</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Loại</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Trạng thái</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Thời lượng</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Thời gian quay</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="text-center py-6 text-gray-400">Đang tải...</td></tr>
            )}
            {!loading && videos.length === 0 && (
              <tr><td colSpan={7} className="text-center py-6 text-gray-400">Không có video nào</td></tr>
            )}
            {!loading && videos.map((v) => (
              <tr key={v.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2 font-mono text-xs">{v.order_code || "—"}</td>
                <td className="px-4 py-2">{v.user_name || v.user_email || "—"}</td>
                <td className="px-4 py-2">{TYPE_LABELS[v.type] ?? v.type}</td>
                <td className="px-4 py-2">
                  <span className={`inline-block px-2 py-0.5 rounded-full border text-xs font-medium ${STATUS_COLORS[v.status] ?? "bg-gray-50 text-gray-600 border-gray-200"}`}>
                    {v.status}
                  </span>
                </td>
                <td className="px-4 py-2">{formatDuration(v.duration)}</td>
                <td className="px-4 py-2 text-gray-500">{formatDateTime(v.start_time)}</td>
                <td className="px-4 py-2">
                  <button onClick={() => viewVideo(v)} className="text-blue-600 hover:underline text-xs font-medium">
                    Xem video
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
        <span>Tổng: {count.toLocaleString("vi-VN")} video</span>
        <div className="flex gap-2">
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
            className="px-3 py-1.5 border border-gray-300 rounded-lg disabled:opacity-50">← Trước</button>
          <span className="px-2 py-1.5">Trang {page + 1}</span>
          <button onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * limit >= count}
            className="px-3 py-1.5 border border-gray-300 rounded-lg disabled:opacity-50">Sau →</button>
        </div>
      </div>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Kho Vận - Video đóng gói", rank: 18,
})

export default withRouteGuard(DohanaSyncPage)
