import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useEffect, useState } from "react"
import { apiJson } from "../../lib/api-client"
import { useCurrentPermissions } from "../../lib/use-permissions"

function todayVN(): string {
  const d = new Date()
  const vn = new Date(d.getTime() + 7 * 3600 * 1000)
  return vn.toISOString().slice(0, 10)
}

function formatDateTime(iso: string) {
  const d = new Date(iso)
  const pad = (x: number) => String(x).padStart(2, "0")
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDuration(sec: number) {
  if (sec <= 0) return "—"
  const m = Math.floor(sec / 60)
  const s = sec % 60
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

function CallsTable() {
  const [calls, setCalls] = useState<any[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [date, setDate] = useState(todayVN)
  const [extension, setExtension] = useState("")
  const [disposition, setDisposition] = useState("")
  const [offset, setOffset] = useState(0)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const limit = 50

  const fetchData = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        from: `${date}T00:00:00`,
        to: `${date}T23:59:59`,
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

  useEffect(() => { fetchData() }, [date, extension, disposition, offset])
  useEffect(() => { setOffset(0) }, [date, extension, disposition])

  const totalAnswered = calls.filter((c) => c.disposition === "ANSWERED").length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
        />
        <input
          type="text"
          placeholder="Extension (vd 207491001)"
          value={extension}
          onChange={(e) => setExtension(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-violet-500"
        />
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
          {count} cuộc gọi trong ngày{calls.length > 0 && ` · ${totalAnswered}/${calls.length} đã nghe (trang này)`}
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

// ---- Main page ----

const ItyCdrPage = () => {
  const { has, loading: permLoading } = useCurrentPermissions()
  const canManage = has("page.ity-cdr.run")

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
        <h2 className="text-sm font-semibold text-gray-600 mb-2">Danh sách cuộc gọi</h2>
        <CallsTable />
      </div>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Cuộc gọi (CDR)",
})

export default ItyCdrPage
