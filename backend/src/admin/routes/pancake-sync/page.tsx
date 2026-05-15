import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useState, useEffect, useCallback } from "react"
import { apiFetch } from "../../lib/api-client"

// ---- Helpers ----

function toISODateString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function toISO(dateStr: string, endOfDay = false): string {
  if (endOfDay) return `${dateStr}T23:59:59`
  return `${dateStr}T00:00:00`
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

// ---- Presets ----

function getMonthRange(offset: number): { from: Date; to: Date } {
  const now = new Date()
  const month = now.getMonth() + offset
  const year = now.getFullYear() + Math.floor(month / 12)
  const m = ((month % 12) + 12) % 12
  const from = new Date(year, m, 1)
  const to = new Date(year, m + 1, 0)
  return { from, to }
}

function getLast30Days(): { from: Date; to: Date } {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - 30)
  return { from, to }
}

// ---- Component ----

const PancakeSyncPage = () => {
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")
  const [force, setForce] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<any>(null)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showErrors, setShowErrors] = useState(false)

  // Poll job status
  const pollStatus = useCallback(async (id: string) => {
    try {
      const res = await apiFetch(`/admin/pancake-sync/status?jobId=${id}`)
      if (!res.ok) return
      const data = await res.json()
      setJobStatus(data)
      if (data.status === "done" || data.status === "failed") {
        setSyncing(false)
      }
    } catch {
      // ignore poll errors
    }
  }, [])

  useEffect(() => {
    if (!jobId) return
    const interval = setInterval(() => pollStatus(jobId), 2000)
    return () => clearInterval(interval)
  }, [jobId, pollStatus])

  // Set default date range on mount (current month)
  useEffect(() => {
    const { from, to } = getMonthRange(0)
    setFromDate(toISODateString(from))
    setToDate(toISODateString(to))
  }, [])

  const applyPreset = (preset: string) => {
    let range: { from: Date; to: Date }
    switch (preset) {
      case "this_month":
        range = getMonthRange(0)
        break
      case "last_month":
        range = getMonthRange(-1)
        break
      case "last_30_days":
        range = getLast30Days()
        break
      default:
        return
    }
    setFromDate(toISODateString(range.from))
    setToDate(toISODateString(range.to))
  }

  const startSync = async () => {
    if (!fromDate || !toDate) return
    setError(null)
    setSyncing(true)
    setJobStatus(null)
    setShowErrors(false)

    try {
      const res = await apiFetch("/admin/pancake-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: toISO(fromDate),
          to: toISO(toDate, true),
          force,
        }),
      })

      const data = await res.json()

      if (res.status === 409) {
        setError(data.error || "Một job sync khác đang chạy")
        setSyncing(false)
        return
      }

      if (!res.ok) {
        setError(data.error || `Lỗi ${res.status}`)
        setSyncing(false)
        return
      }

      setJobId(data.jobId)
    } catch (err: any) {
      setError(err.message)
      setSyncing(false)
    }
  }

  const isRunning = syncing && jobStatus?.status !== "done" && jobStatus?.status !== "failed"

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-2xl font-bold mb-2">Đồng bộ đơn hàng Pancake</h1>
      <p className="text-gray-500 text-sm mb-6">
        Kéo đơn hàng từ Pancake POS về Medusa để hiển thị trong danh sách đơn hàng và báo cáo.
      </p>

      {/* Date Range */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6 shadow-sm">
        <h2 className="font-semibold text-gray-700 mb-4">Khoảng thời gian</h2>

        {/* Presets */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {[
            { key: "this_month", label: "Tháng này" },
            { key: "last_month", label: "Tháng trước" },
            { key: "last_30_days", label: "30 ngày qua" },
          ].map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => applyPreset(p.key)}
              disabled={isRunning}
              className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Custom date inputs */}
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <label className="block text-xs text-gray-500 mb-1 font-medium">Từ ngày</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              disabled={isRunning}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
            />
          </div>
          <span className="text-gray-400 mt-5">→</span>
          <div>
            <label className="block text-xs text-gray-500 mb-1 font-medium">Đến ngày</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              disabled={isRunning}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
            />
          </div>
        </div>

        {/* Force checkbox */}
        <label className="flex items-center gap-2 mt-4 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
            disabled={isRunning}
            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-400"
          />
          <span className="text-sm text-gray-600">
            Force re-sync (ghi đè tất cả dữ liệu, kể cả đơn đã sync)
          </span>
        </label>
      </div>

      {/* Action */}
      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={startSync}
          disabled={isRunning || !fromDate || !toDate}
          className="bg-blue-600 text-white px-6 py-3 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isRunning ? "⏳ Đang đồng bộ..." : "Bắt đầu đồng bộ"}
        </button>
        {isRunning && (
          <button
            onClick={() => {
              setSyncing(false)
              setJobId(null)
              setError("Đã ngừng theo dõi (job vẫn chạy nền trên server)")
            }}
            className="text-sm text-red-600 hover:text-red-700 underline"
          >
            Ngừng theo dõi
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 text-sm">
          {error}
        </div>
      )}

      {/* Progress */}
      {jobStatus && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h2 className="font-semibold text-gray-700 mb-4">
            Kết quả đồng bộ{" "}
            {jobStatus.status === "running" && (
              <span className="text-blue-600 font-normal">(đang chạy...)</span>
            )}
            {jobStatus.status === "queued" && (
              <span className="text-gray-500 font-normal">(đang khởi tạo...)</span>
            )}
            {jobStatus.status === "done" && (
              <span className="text-green-600 font-normal">✓ Hoàn thành</span>
            )}
            {jobStatus.status === "failed" && (
              <span className="text-red-600 font-normal">✗ Thất bại</span>
            )}
          </h2>

          {/* Progress bar */}
          {(() => {
            const cp = jobStatus.stats?.current_page ?? 0
            const tp = jobStatus.stats?.total_pages ?? 0
            const isRunningOrQueued = jobStatus.status === "running" || jobStatus.status === "queued"
            const pct = tp > 0 ? Math.min(100, Math.round((cp / tp) * 100)) : 0
            // Estimate ETA dựa trên tốc độ trung bình
            const elapsed = jobStatus.stats?.duration_ms ?? 0
            const eta = cp > 0 && tp > cp && elapsed > 0
              ? Math.round((elapsed / cp) * (tp - cp))
              : 0

            if (!isRunningOrQueued && jobStatus.status !== "done" && jobStatus.status !== "failed") return null

            return (
              <div className="mb-4">
                <div className="flex justify-between items-center mb-1.5 text-xs text-gray-600">
                  <span>
                    {tp > 0 ? (
                      <>
                        <span className="font-semibold text-gray-800">Trang {cp}/{tp}</span>
                        {isRunningOrQueued && eta > 0 && (
                          <span className="text-gray-400 ml-2">· còn ~{formatDuration(eta)}</span>
                        )}
                      </>
                    ) : (
                      <span className="text-gray-400">Đang kết nối Pancake...</span>
                    )}
                  </span>
                  <span className="font-mono font-semibold text-blue-600">{pct}%</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      jobStatus.status === "failed" ? "bg-red-500" :
                      jobStatus.status === "done" ? "bg-green-500" :
                      "bg-blue-500 animate-pulse"
                    }`}
                    style={{ width: `${Math.max(pct, isRunningOrQueued && tp === 0 ? 5 : 0)}%` }}
                  />
                </div>
              </div>
            )
          })()}

          {/* Stats cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="bg-blue-50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-blue-700">
                {jobStatus.stats?.imported ?? 0}
              </div>
              <div className="text-xs text-blue-600 mt-1">Đơn mới</div>
            </div>
            <div className="bg-green-50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-green-700">
                {jobStatus.stats?.updated ?? 0}
              </div>
              <div className="text-xs text-green-600 mt-1">Đã cập nhật</div>
            </div>
            <div className="bg-red-50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-red-700">
                {jobStatus.stats?.failed_pages?.length ?? 0}
              </div>
              <div className="text-xs text-red-600 mt-1">Trang lỗi</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-gray-700">
                {jobStatus.stats?.duration_ms
                  ? formatDuration(jobStatus.stats.duration_ms)
                  : "—"}
              </div>
              <div className="text-xs text-gray-500 mt-1">Thời gian</div>
            </div>
          </div>

          {/* Timeline */}
          <div className="text-xs text-gray-500 space-y-1 mb-4">
            <div>
              <span className="font-medium">Từ:</span>{" "}
              {formatDateTime(jobStatus.from_date)} →{" "}
              {formatDateTime(jobStatus.to_date)}
            </div>
            <div>
              <span className="font-medium">Bắt đầu:</span>{" "}
              {formatDateTime(jobStatus.started_at)}
            </div>
            {jobStatus.finished_at && (
              <div>
                <span className="font-medium">Kết thúc:</span>{" "}
                {formatDateTime(jobStatus.finished_at)}
              </div>
            )}
          </div>

          {/* Error details */}
          {jobStatus.stats?.errors?.length > 0 && (
            <div>
              <button
                onClick={() => setShowErrors(!showErrors)}
                className="text-sm text-red-600 hover:underline font-medium"
              >
                {showErrors ? "Ẩn" : "Hiện"} {jobStatus.stats.errors.length} lỗi
              </button>
              {showErrors && (
                <div className="mt-2 max-h-64 overflow-y-auto bg-red-50 border border-red-200 rounded-lg p-3">
                  {jobStatus.stats.errors.map((err: any, i: number) => (
                    <div key={i} className="text-xs text-red-700 py-1 font-mono">
                      {err.orderId ? `[#${err.orderId}] ` : ""}
                      {err.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Đồng bộ Pancake",
})

export default PancakeSyncPage
