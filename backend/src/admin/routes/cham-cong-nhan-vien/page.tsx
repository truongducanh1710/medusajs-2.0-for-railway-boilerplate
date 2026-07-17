import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useCallback, useEffect, useState } from "react"
import { apiJson } from "../../lib/api-client"
import { withRouteGuard } from "../../components/route-guard"

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

function ChamCongNhanVienPage() {
  const [logs, setLogs] = useState<ChamCongLog[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState("")

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
    } catch (e: any) {
      setErr(e.message || "Chấm công thất bại")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg p-6">
      <h1 className="mb-1 text-xl font-semibold">Chấm công</h1>
      <p className="mb-5 text-sm text-gray-500">
        Bấm nút bên dưới để chấm công. Bắt buộc cho phép truy cập vị trí (GPS) — nếu từ chối sẽ không chấm công được.
      </p>

      {err && <div className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      <button
        onClick={handleCheckin}
        disabled={submitting}
        className={`mb-6 w-full rounded-lg py-4 text-base font-semibold text-white transition-colors disabled:opacity-50 ${
          nextAction === "in" ? "bg-green-600 hover:bg-green-700" : "bg-rose-600 hover:bg-rose-700"
        }`}
      >
        {submitting ? "Đang xử lý..." : nextAction === "in" ? "Chấm công vào" : "Chấm công ra"}
      </button>

      <h2 className="mb-2 text-sm font-semibold text-gray-700">Lịch sử hôm nay</h2>
      <div className="rounded border">
        {loading && <div className="px-3 py-4 text-center text-sm text-gray-400">Đang tải...</div>}
        {!loading && logs.length === 0 && (
          <div className="px-3 py-4 text-center text-sm text-gray-400">Chưa chấm công lần nào hôm nay</div>
        )}
        {logs.map((log, i) => (
          <div key={log.id} className={`flex items-center justify-between px-3 py-2 text-sm ${i > 0 ? "border-t" : ""}`}>
            <span className="flex items-center gap-2">
              <span className={`inline-block size-2 rounded-full ${log.action === "in" ? "bg-green-500" : "bg-rose-500"}`} />
              {log.action === "in" ? "Vào ca" : "Ra ca"}
            </span>
            <span className="text-gray-500">{fmtTime(log.created_at)}</span>
            <span className="text-xs text-gray-400">
              {log.lat != null && log.lng != null ? "📍 Có GPS" : "Không GPS"}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export const config = defineRouteConfig({ label: "Chấm công (Tôi)", rank: 20 })

export default withRouteGuard(ChamCongNhanVienPage)
