import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useEffect, useState } from "react"
import { apiJson } from "../../lib/api-client"
import { useCurrentPermissions } from "../../lib/use-permissions"
import { withRouteGuard } from "../../components/route-guard"

type RangePreset = "today" | "yesterday" | "week" | "month"

// Tính [from, to] theo giờ VN cho các preset — "week" = Thứ 2 tới hôm nay, "month" = ngày 1 tới hôm nay
function getPresetRange(preset: RangePreset): { from: string; to: string } {
  const nowVN = new Date(Date.now() + 7 * 3600 * 1000)
  const to = nowVN.toISOString().slice(0, 10)
  if (preset === "today") return { from: to, to }
  if (preset === "yesterday") {
    const y = new Date(nowVN.getTime() - 86400_000).toISOString().slice(0, 10)
    return { from: y, to: y }
  }
  if (preset === "month") {
    const from = `${nowVN.toISOString().slice(0, 7)}-01`
    return { from, to }
  }
  // week: lùi về thứ 2 gần nhất (getUTCDay vì nowVN đã cộng offset, đọc như UTC)
  const dow = nowVN.getUTCDay() // 0=CN, 1=T2...
  const diffToMonday = dow === 0 ? 6 : dow - 1
  const monday = new Date(nowVN.getTime() - diffToMonday * 86400_000)
  return { from: monday.toISOString().slice(0, 10), to }
}

const CHART_COLORS: Record<string, string> = {
  ANSWERED: "#22c55e", // green
  no_answer: "#9ca3af", // gray — NO ANSWER
  busy: "#f97316", // orange
  other: "#a78bfa",
}

const LINE_PALETTE = ["#7c3aed", "#0ea5e9", "#f43f5e", "#eab308", "#10b981", "#6366f1"]

function formatDateTime(iso: string) {
  const d = new Date(iso)
  const pad = (x: number) => String(x).padStart(2, "0")
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDuration(sec: number) {
  if (sec <= 0) return "—"
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}h${m}p`
  return m > 0 ? `${m}p${s}s` : `${s}s`
}

const DISPOSITION_BADGE: Record<string, string> = {
  ANSWERED: "bg-green-100 text-green-700 ring-1 ring-green-300",
  "NO ANSWER": "bg-gray-100 text-gray-500 ring-1 ring-gray-200",
  BUSY: "bg-orange-100 text-orange-700 ring-1 ring-orange-300",
}

// ---- Bảng gán extension ↔ nhân viên ----

function ExtensionTable({ canManage }: { canManage: boolean }) {
  const [extensions, setExtensions] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  const fetchData = async () => {
    setLoading(true)
    try {
      const data = await apiJson("/admin/ity-cdr-sync/extensions")
      setExtensions(data?.extensions ?? [])
      setUsers(data?.users ?? [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  const assignUser = async (extension: string, userId: string) => {
    setSaving(extension)
    try {
      await apiJson("/admin/ity-cdr-sync/extensions", "POST", { extension, user_id: userId || null })
      await fetchData()
    } catch (e: any) {
      alert("Lỗi gán extension: " + e.message)
    } finally {
      setSaving(null)
    }
  }

  if (loading) return <div className="text-sm text-gray-400 py-4">Đang tải danh sách extension...</div>

  return (
    <div className="border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b">
          <tr>
            <th className="text-left px-4 py-2 font-medium text-gray-600">Extension</th>
            <th className="text-left px-4 py-2 font-medium text-gray-600">Nhân viên</th>
            <th className="text-left px-4 py-2 font-medium text-gray-600">Email</th>
          </tr>
        </thead>
        <tbody>
          {extensions.map((ext) => (
            <tr key={ext.extension} className="border-b last:border-0">
              <td className="px-4 py-2 font-mono text-gray-700">{ext.extension}</td>
              <td className="px-4 py-2">
                {canManage ? (
                  <select
                    value={ext.user_id ?? ""}
                    onChange={(e) => assignUser(ext.extension, e.target.value)}
                    disabled={saving === ext.extension}
                    className="border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50"
                  >
                    <option value="">— Chưa gán —</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                ) : (
                  <span>{ext.display_name || "— Chưa gán —"}</span>
                )}
              </td>
              <td className="px-4 py-2 text-gray-400 text-xs">{ext.user?.email ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---- Bảng danh sách cuộc gọi ----

function CallsTable({ from, to }: { from: string; to: string }) {
  const [calls, setCalls] = useState<any[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [extension, setExtension] = useState("")
  const [extensionOptions, setExtensionOptions] = useState<any[]>([])
  const [disposition, setDisposition] = useState("")
  const [offset, setOffset] = useState(0)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const limit = 50

  useEffect(() => {
    apiJson("/admin/ity-cdr-sync/extensions")
      .then((data) => setExtensionOptions(data?.extensions ?? []))
      .catch(() => {})
  }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      // +07:00 khớp timezone với ReportSection — tránh lệch "ngày" giữa 2 khối khi ở gần biên ngày.
      const params = new URLSearchParams({
        from: `${from}T00:00:00+07:00`,
        to: `${to}T23:59:59+07:00`,
        limit: String(limit),
        offset: String(offset),
      })
      if (extension) params.set("extension", extension)
      if (disposition) params.set("disposition", disposition)
      const data = await apiJson(`/admin/ity-cdr-sync/calls?${params}`)
      setCalls(data?.calls ?? [])
      setCount(data?.count ?? 0)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [from, to, extension, disposition, offset])
  useEffect(() => { setOffset(0) }, [from, to, extension, disposition])

  const totalAnswered = calls.filter((c) => c.disposition === "ANSWERED").length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 items-center">
        <select
          value={extension}
          onChange={(e) => setExtension(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
        >
          <option value="">Tất cả nhân viên</option>
          {extensionOptions.map((ext) => (
            <option key={ext.extension} value={ext.extension}>{ext.display_name || ext.extension}</option>
          ))}
        </select>
        <select
          value={disposition}
          onChange={(e) => setDisposition(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
        >
          <option value="">Tất cả trạng thái</option>
          <option value="ANSWERED">Đã nghe máy</option>
          <option value="NO ANSWER">Không nghe máy</option>
          <option value="BUSY">Máy bận</option>
        </select>
        <span className="text-sm text-gray-400">
          {count} cuộc gọi trong khoảng đã chọn{calls.length > 0 && ` · ${totalAnswered}/${calls.length} đã nghe (trang này)`}
        </span>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Đang tải...</div>
      ) : calls.length === 0 ? (
        <div className="text-center py-12 text-gray-400">Không có cuộc gọi nào</div>
      ) : (
        <div className="border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">Thời gian</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">Nhân viên</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">SĐT khách</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-600">Thời lượng</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-600">Trạng thái</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-600">Ghi âm</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => (
                  <>
                    <tr key={c.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{formatDateTime(c.calldate)}</td>
                      <td className="px-3 py-2">{c.agent_display_name || c.agent_name || "—"}</td>
                      <td className="px-3 py-2 font-mono text-gray-600">{c.customer_phone}</td>
                      <td className="px-3 py-2 text-center text-gray-600">{formatDuration(c.billsec)}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${DISPOSITION_BADGE[c.disposition] ?? "bg-gray-100 text-gray-500"}`}>
                          {c.disposition}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {c.recording_url ? (
                          <button
                            onClick={() => setPlayingId(playingId === c.id ? null : c.id)}
                            className="text-violet-600 hover:text-violet-800"
                          >
                            {playingId === c.id ? "✕ Đóng" : "▶ Nghe"}
                          </button>
                        ) : "—"}
                      </td>
                    </tr>
                    {playingId === c.id && c.recording_url && (
                      <tr className="border-b last:border-0 bg-violet-50/40">
                        <td colSpan={6} className="px-3 py-2">
                          <audio controls autoPlay src={c.recording_url} className="w-full h-9">
                            Trình duyệt không hỗ trợ phát audio.
                            <a href={c.recording_url} target="_blank" rel="noopener noreferrer">Tải file ghi âm</a>
                          </audio>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-3 py-2 border-t bg-gray-50 text-xs text-gray-500">
            <span>{offset + 1}–{offset + calls.length} / {count}</span>
            <div className="flex gap-2">
              <button
                onClick={() => setOffset(Math.max(0, offset - limit))}
                disabled={offset === 0}
                className="px-2 py-1 border rounded disabled:opacity-40"
              >
                ← Trước
              </button>
              <button
                onClick={() => setOffset(offset + limit)}
                disabled={offset + limit >= count}
                className="px-2 py-1 border rounded disabled:opacity-40"
              >
                Sau →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- Báo cáo so sánh sale + xu hướng theo giờ ----

function ReportSection({
  preset, onPresetChange, shiftHours, onShiftHoursChange,
}: {
  preset: RangePreset; onPresetChange: (p: RangePreset) => void
  shiftHours: number; onShiftHoursChange: (h: number) => void
}) {
  const [report, setReport] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [selectedExt, setSelectedExt] = useState<string | null>(null)

  const fetchReport = async () => {
    setLoading(true)
    try {
      const { from, to } = getPresetRange(preset)
      const params = new URLSearchParams({
        from: `${from}T00:00:00+07:00`,
        to: `${to}T23:59:59+07:00`,
        shift_hours: String(shiftHours),
      })
      const data = await apiJson(`/admin/ity-cdr-sync/report?${params}`)
      setReport(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchReport() }, [preset, shiftHours])

  const bySale: any[] = report?.by_sale ?? []
  const byHour: any[] = report?.by_hour ?? []
  const byHourExt: any[] = report?.by_hour_ext ?? []
  const byDay: any[] = report?.by_day ?? []
  const maxHourCalls = Math.max(1, ...byHour.map((h) => h.total_calls))
  const isSingleDay = preset === "today" || preset === "yesterday"

  // Target/ngưỡng cuộc gọi kỳ vọng mỗi giờ — ước lượng đơn giản: tổng cuộc gọi kỳ vọng
  // cả ca (giờ/ca đã nhập) chia đều cho số giờ ca, dùng làm đường tham chiếu trực quan
  // trên chart theo giờ (không phải KPI chính thức — chỉ để so lệch nhanh).
  const hourlyTarget = shiftHours > 0 && bySale.length > 0
    ? Math.round((bySale.reduce((s, x) => s + x.total_calls, 0) / bySale.length / shiftHours) * bySale.length)
    : 0

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex border border-gray-200 rounded-lg overflow-hidden text-sm">
          {([
            { label: "Hôm nay", val: "today" },
            { label: "Hôm qua", val: "yesterday" },
            { label: "Tuần này", val: "week" },
            { label: "Tháng này", val: "month" },
          ] as { label: string; val: RangePreset }[]).map(({ label, val }, i) => (
            <button
              key={val}
              onClick={() => onPresetChange(val)}
              className={`px-3 py-2 transition-colors ${preset === val
                ? "bg-violet-600 text-white font-medium"
                : "bg-white text-gray-600 hover:bg-gray-50"
              } ${i !== 0 ? "border-l border-gray-200" : ""}`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-500">
          Giờ/ca:
          <input
            type="number"
            min={1}
            max={24}
            value={shiftHours}
            onChange={(e) => onShiftHoursChange(Number(e.target.value) || 7)}
            className="border rounded-lg px-2 py-1.5 text-sm w-16 focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        </label>
        {report && <span className="text-sm text-gray-400">{report.total_calls} cuộc gọi trong khoảng đã chọn</span>}
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-400">Đang tải báo cáo...</div>
      ) : (
        <>
          {/* Bảng so sánh sale */}
          <div className="border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">Nhân viên</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-600">Tổng cuộc gọi</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-600">Đã nghe</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-600">Tỷ lệ nghe máy</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-600">Tổng đàm thoại</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-600">TB/cuộc</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-600" title="Tổng thời gian từ lúc quay số tới khi kết thúc, kể cả cuộc không nghe máy">
                    Tổng thời gian gọi
                  </th>
                  <th className="text-center px-3 py-2 font-medium text-gray-600" title="Tổng thời gian gọi ÷ (số giờ/ca × số ngày có gọi trong khoảng đã chọn)">
                    % thời gian ca
                  </th>
                  <th className="text-center px-3 py-2 font-medium text-gray-600" title="Số cuộc gọi mỗi ngày trong 7 ngày gần nhất (tính tới ngày cuối khoảng đã chọn)">
                    Xu hướng 7 ngày
                  </th>
                </tr>
              </thead>
              <tbody>
                {bySale.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-6 text-gray-400">Không có dữ liệu</td></tr>
                ) : bySale.map((s) => (
                  <tr key={s.extension} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium">{s.name}</td>
                    <td className="px-3 py-2 text-center">{s.total_calls}</td>
                    <td className="px-3 py-2 text-center">{s.answered}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${
                        s.answered_rate >= 50 ? "bg-green-100 text-green-700" : s.answered_rate >= 25 ? "bg-orange-100 text-orange-700" : "bg-red-100 text-red-700"
                      }`}>
                        {s.answered_rate}%
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">{formatDuration(s.total_talk_seconds)}</td>
                    <td className="px-3 py-2 text-center">{formatDuration(s.avg_talk_seconds)}</td>
                    <td className="px-3 py-2 text-center">{formatDuration(s.total_call_time_seconds)}</td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs ${
                          s.call_time_ratio >= 30 ? "bg-green-100 text-green-700" : s.call_time_ratio >= 15 ? "bg-orange-100 text-orange-700" : "bg-gray-100 text-gray-500"
                        }`}
                        title={`Tính trên ${s.active_days} ngày có cuộc gọi`}
                      >
                        {s.call_time_ratio}%
                      </span>
                      <span className="text-[10px] text-gray-400 block">/{s.active_days} ngày</span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Sparkline values={s.trend_7d ?? []} days={report?.trend_days ?? []} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {isSingleDay ? (
            /* Chart xu hướng theo giờ — chỉ có ý nghĩa khi xem 1 ngày */
            <div className="border rounded-xl p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Số cuộc gọi theo giờ</p>
              <div className="flex items-end gap-1 h-32 relative">
                {hourlyTarget > 0 && (
                  <div
                    className="absolute left-0 right-0 border-t border-dashed border-orange-400 pointer-events-none"
                    style={{ bottom: `${Math.min(100, (hourlyTarget / maxHourCalls) * 100)}%` }}
                    title={`Ngưỡng tham chiếu: ~${hourlyTarget} cuộc/giờ`}
                  />
                )}
                {byHour.map((h) => (
                  <div key={h.hour} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                    <div className="text-[10px] text-gray-400 mb-0.5">{h.total_calls > 0 ? h.total_calls : ""}</div>
                    <div
                      className="w-full bg-violet-400 rounded-t hover:bg-violet-600 transition-colors"
                      style={{ height: `${(h.total_calls / maxHourCalls) * 100}%`, minHeight: h.total_calls > 0 ? "2px" : "0" }}
                      title={`${h.hour}h: ${h.total_calls} cuộc, ${h.answered} đã nghe`}
                    />
                    <div className="text-[10px] text-gray-400 mt-1">{h.hour}</div>
                  </div>
                ))}
              </div>
              {hourlyTarget > 0 && (
                <p className="text-[10px] text-gray-400 mt-2">--- Ngưỡng tham chiếu ~{hourlyTarget} cuộc/giờ (trung bình tổng ca ÷ số giờ ca)</p>
              )}
            </div>
          ) : (
            <ComboChart byDay={byDay} selectedExt={selectedExt} onSelectExt={setSelectedExt} />
          )}

          {/* Heatmap giờ × nhân viên — lộ khoảng "chết" của từng người trong ca */}
          <HourHeatmap byHourExt={byHourExt} />
        </>
      )}
    </div>
  )
}

// ---- Sparkline mini: xu hướng số cuộc gọi 7 ngày gần nhất cho 1 nhân viên ----
function Sparkline({ values, days }: { values: number[]; days: string[] }) {
  if (values.length === 0) return <span className="text-gray-300">—</span>
  const max = Math.max(1, ...values)
  const W = 84, H = 24
  const step = values.length > 1 ? W / (values.length - 1) : 0
  const points = values.map((v, i) => ({ x: i * step, y: H - (v / max) * H, v }))
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ")
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="inline-block align-middle">
      <path d={path} fill="none" stroke="#7c3aed" strokeWidth={1.5} />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={1.6} fill="#7c3aed">
          <title>{`${days[i] ?? ""}: ${p.v} cuộc`}</title>
        </circle>
      ))}
    </svg>
  )
}

// ---- Heatmap giờ × nhân viên: màu đậm nhạt theo số cuộc gọi mỗi giờ ----
function HourHeatmap({ byHourExt }: { byHourExt: any[] }) {
  if (byHourExt.length === 0) return null
  const maxCell = Math.max(1, ...byHourExt.flatMap((e) => e.hours.map((h: any) => h.total_calls)))
  const cellColor = (v: number) => {
    if (v === 0) return "#f3f4f6"
    const t = Math.min(1, v / maxCell)
    // nội suy từ tím nhạt tới tím đậm (khớp tông violet của trang)
    const r = Math.round(237 - t * (237 - 91))
    const g = Math.round(233 - t * (233 - 33))
    const b = Math.round(254 - t * (254 - 182))
    return `rgb(${r},${g},${b})`
  }
  return (
    <div className="border rounded-xl p-4 overflow-x-auto">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
        Heatmap cuộc gọi theo giờ × nhân viên
      </p>
      <table className="text-xs border-separate" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            <th className="text-left pr-2 sticky left-0 bg-white font-medium text-gray-600">Nhân viên</th>
            {Array.from({ length: 24 }, (_, h) => (
              <th key={h} className="font-normal text-gray-400 w-6 text-center">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {byHourExt.map((e) => (
            <tr key={e.extension}>
              <td className="pr-2 whitespace-nowrap font-medium text-gray-700 sticky left-0 bg-white">{e.name}</td>
              {e.hours.map((h: any) => (
                <td key={h.hour} className="p-0">
                  <div
                    className="w-6 h-6 rounded flex items-center justify-center"
                    style={{ background: cellColor(h.total_calls) }}
                    title={`${e.name} · ${h.hour}h: ${h.total_calls} cuộc, ${h.answered} đã nghe`}
                  >
                    {h.total_calls > 0 && (
                      <span className={h.total_calls / maxCell > 0.5 ? "text-white" : "text-gray-500"} style={{ fontSize: 9 }}>
                        {h.total_calls}
                      </span>
                    )}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---- Combo chart: cột stacked theo trạng thái + đường tỷ lệ nghe máy, toggle theo nhân viên ----

function ComboChart({ byDay, selectedExt, onSelectExt }: { byDay: any[]; selectedExt: string | null; onSelectExt: (ext: string | null) => void }) {
  if (byDay.length === 0) {
    return <div className="border rounded-xl p-8 text-center text-gray-400">Không có dữ liệu trong khoảng này</div>
  }

  // Danh sách nhân viên duy nhất (để vẽ legend + line riêng từng người)
  const allExtensions = Array.from(
    new Set(byDay.flatMap((d) => d.by_extension.map((e: any) => e.extension)))
  ) as string[]
  const nameByExt: Record<string, string> = {}
  byDay.forEach((d) => d.by_extension.forEach((e: any) => { nameByExt[e.extension] = e.name }))

  const visibleExtensions = selectedExt ? [selectedExt] : allExtensions

  // Tổng cuộc gọi mỗi ngày (chỉ tính nhân viên đang hiển thị) — dùng để scale cột
  const dayTotals = byDay.map((d) => {
    const rows = d.by_extension.filter((e: any) => visibleExtensions.includes(e.extension))
    return rows.reduce((sum: number, e: any) => sum + e.total, 0)
  })
  const maxTotal = Math.max(1, ...dayTotals)

  const W = 900
  const H = 260
  const padLeft = 40
  const padBottom = 30
  const padTop = 10
  const chartW = W - padLeft - 10
  const chartH = H - padTop - padBottom
  const barSlot = chartW / byDay.length
  const barWidth = Math.min(36, barSlot * 0.55)

  function formatDayLabel(day: string) {
    const [, m, dd] = day.split("-")
    return `${dd}/${m}`
  }

  // Đường tỷ lệ nghe máy cho từng nhân viên đang hiển thị
  const linePaths = visibleExtensions.map((ext, idx) => {
    const points = byDay.map((d, i) => {
      const row = d.by_extension.find((e: any) => e.extension === ext)
      const rate = row?.answered_rate ?? 0
      const x = padLeft + i * barSlot + barSlot / 2
      const y = padTop + chartH - (rate / 100) * chartH
      return { x, y, rate }
    })
    const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ")
    return { ext, color: LINE_PALETTE[idx % LINE_PALETTE.length], path, points }
  })

  return (
    <div className="border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Cuộc gọi theo ngày (cột) · Tỷ lệ nghe máy (đường)
        </p>
        {selectedExt && (
          <button onClick={() => onSelectExt(null)} className="text-xs text-violet-600 hover:underline">
            ✕ Bỏ chọn, xem tất cả
          </button>
        )}
      </div>

      {/* Legend — click để chỉ xem 1 người */}
      <div className="flex flex-wrap gap-2 mb-3">
        {allExtensions.map((ext, idx) => (
          <button
            key={ext}
            onClick={() => onSelectExt(selectedExt === ext ? null : ext)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs border transition-colors ${
              selectedExt === ext
                ? "bg-violet-100 border-violet-400 text-violet-700"
                : selectedExt
                ? "opacity-40 border-gray-200 text-gray-400"
                : "border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            <span className="w-2 h-2 rounded-full" style={{ background: LINE_PALETTE[idx % LINE_PALETTE.length] }} />
            {nameByExt[ext] || ext}
          </button>
        ))}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 280 }}>
        {/* Trục Y bên trái: số cuộc gọi (cột) */}
        {[0, 0.25, 0.5, 0.75, 1].map((frac) => (
          <line
            key={frac}
            x1={padLeft} x2={W - 10}
            y1={padTop + chartH * (1 - frac)} y2={padTop + chartH * (1 - frac)}
            stroke="#f0f0f0" strokeWidth={1}
          />
        ))}

        {/* Cột stacked theo trạng thái, tổng hợp các nhân viên đang hiển thị */}
        {byDay.map((d, i) => {
          const rows = d.by_extension.filter((e: any) => visibleExtensions.includes(e.extension))
          const totals = rows.reduce(
            (acc: any, e: any) => ({
              answered: acc.answered + e.answered,
              no_answer: acc.no_answer + e.no_answer,
              busy: acc.busy + e.busy,
              other: acc.other + e.other,
            }),
            { answered: 0, no_answer: 0, busy: 0, other: 0 }
          )
          const x = padLeft + i * barSlot + (barSlot - barWidth) / 2
          let yCursor = padTop + chartH
          const segments = [
            { key: "answered", val: totals.answered, color: CHART_COLORS.ANSWERED },
            { key: "no_answer", val: totals.no_answer, color: CHART_COLORS.no_answer },
            { key: "busy", val: totals.busy, color: CHART_COLORS.busy },
            { key: "other", val: totals.other, color: CHART_COLORS.other },
          ]
          return (
            <g key={d.day}>
              {segments.map((seg) => {
                if (seg.val === 0) return null
                const segH = (seg.val / maxTotal) * chartH
                yCursor -= segH
                return (
                  <rect
                    key={seg.key}
                    x={x} y={yCursor} width={barWidth} height={segH}
                    fill={seg.color}
                  >
                    <title>{`${formatDayLabel(d.day)} — ${seg.key}: ${seg.val}`}</title>
                  </rect>
                )
              })}
              <text x={x + barWidth / 2} y={H - padBottom + 14} textAnchor="middle" fontSize={10} fill="#9ca3af">
                {formatDayLabel(d.day)}
              </text>
            </g>
          )
        })}

        {/* Đường tỷ lệ nghe máy — 1 đường/nhân viên đang hiển thị */}
        {linePaths.map(({ ext, color, path, points }) => (
          <g key={ext}>
            <path d={path} fill="none" stroke={color} strokeWidth={2} />
            {points.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={3} fill={color}>
                <title>{`${formatDayLabel(byDay[i].day)}: ${p.rate}% nghe máy`}</title>
              </circle>
            ))}
          </g>
        ))}

        {/* Trục Y label bên phải: % tỷ lệ nghe máy */}
        {[0, 50, 100].map((pct) => (
          <text key={pct} x={W - 5} y={padTop + chartH * (1 - pct / 100) + 3} textAnchor="end" fontSize={9} fill="#9ca3af">
            {pct}%
          </text>
        ))}
      </svg>
    </div>
  )
}

// ---- Main page ----

const ItyCdrPage = () => {
  const { has, loading: permLoading } = useCurrentPermissions()
  const canManage = has("page.ity-cdr.run")

  // Mốc thời gian dùng chung cho "Báo cáo hiệu suất" + "Danh sách cuộc gọi" — tránh 2 khối
  // hiển thị lệch ngày nhau (trước đây mỗi khối có bộ chọn ngày riêng, dễ đọc nhầm dữ liệu).
  const [preset, setPreset] = useState<RangePreset>("today")
  const [shiftHours, setShiftHours] = useState(7)
  const { from, to } = getPresetRange(preset)

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Cuộc gọi tổng đài (CDR)</h1>
        <p className="text-sm text-gray-400">
          Lịch sử cuộc gọi Sale/CSKH từ tổng đài ITY — lưu vĩnh viễn (ITY chỉ giữ 30 ngày)
        </p>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-gray-600 mb-2">Gán extension ↔ nhân viên</h2>
        {!permLoading && <ExtensionTable canManage={canManage} />}
      </div>

      <div>
        <h2 className="text-sm font-semibold text-gray-600 mb-2">Báo cáo hiệu suất</h2>
        <ReportSection preset={preset} onPresetChange={setPreset} shiftHours={shiftHours} onShiftHoursChange={setShiftHours} />
      </div>

      <div>
        <h2 className="text-sm font-semibold text-gray-600 mb-2">Danh sách cuộc gọi</h2>
        <CallsTable from={from} to={to} />
      </div>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Cuộc gọi (CDR)", rank: 14,
})

export default withRouteGuard(ItyCdrPage)