import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useEffect, useState, useMemo } from "react"
import { apiJson } from "../../lib/api-client"
import { withRouteGuard } from "../../components/route-guard"
import { useCurrentPermissions } from "../../lib/use-permissions"

/**
 * Theo dõi tồn kho + dự báo lượng cần nhập.
 *
 * Kho đếm tay và chốt tồn mỗi chiều; từ mốc đó hệ thống trừ dần theo đơn trên POS.
 * Kho báo sao tin vậy — không đối chiếu, không cảnh báo lệch.
 *
 * Tốc độ bán và đề xuất nhập lấy từ SỐ LƯỢNG BÁN TRÊN POS, độc lập với số kho báo.
 */

type Row = {
  product_code: string
  product_name: string
  last_qty: number | null
  counted_at: string | null
  sold_since_count: number
  on_hand: number | null
  sold_in_period: number
  per_day: number
  days_left: number | null
  reorder_point: number
  need_7d: number
  need_30d: number
  suggest_7d: number
  suggest_30d: number
  need_order: boolean
  dead_stock: boolean
  no_snapshot: boolean
}

const nf = (n: any) => Number(n || 0).toLocaleString("vi-VN")

/** Ngày giờ VN, dạng ngắn "28/08 17:32". */
function whenVN(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(new Date(iso).getTime() + 7 * 3600 * 1000)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

function TonKhoPage() {
  const { has } = useCurrentPermissions()
  const canManage = has("page.ton-kho.manage")

  const [rows, setRows] = useState<Row[]>([])
  const [days, setDays] = useState(30)
  const [leadDays, setLeadDays] = useState(25)
  const [horizon, setHorizon] = useState<7 | 30>(30)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState("")
  const [onlyNeed, setOnlyNeed] = useState(false)
  // Số kho đang gõ, chưa lưu. Chỉ mã nào gõ mới nằm ở đây.
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  function load() {
    setLoading(true)
    apiJson(`/admin/ton-kho?days=${days}&lead_days=${leadDays}`, "GET")
      .then(d => setRows(d.rows ?? []))
      .catch(e => alert("Lỗi tải tồn kho: " + e.message))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [days, leadDays])

  async function saveSnapshot() {
    const list = Object.entries(draft)
      .filter(([, v]) => String(v).trim() !== "")
      .map(([code, v]) => {
        const r = rows.find(x => x.product_code === code)
        return { product_code: code, product_name: r?.product_name ?? "", qty: Number(v) || 0 }
      })
    if (!list.length) { alert("Chưa nhập số nào"); return }
    if (!confirm(`Chốt tồn cho ${list.length} mã?\n\nTừ lúc này, đơn mới sẽ được trừ khỏi số vừa nhập.`)) return
    setSaving(true)
    try {
      await apiJson("/admin/ton-kho", "POST", { rows: list })
      setDraft({})
      load()
    } catch (e: any) {
      alert("Lỗi lưu: " + e.message)
    } finally {
      setSaving(false)
    }
  }

  /**
   * Xoá bản chốt tồn. Mặc định rút lại lần chốt GẦN NHẤT của mã đó — chốt nhầm số thì
   * bỏ đúng lần vừa nhập. Giữ Shift để xoá sạch mọi bản chốt của mã (mã nhập nhầm hẳn,
   * vd một lô hàng bị đếm hai lần dưới hai mã khác nhau).
   */
  async function removeSnapshot(r: Row, all: boolean) {
    const what = all
      ? `Xoá TOÀN BỘ lịch sử chốt tồn của mã này?`
      : `Xoá lần chốt gần nhất (${nf(r.last_qty ?? 0)}) của mã này?`
    if (!confirm(`${what}

${r.product_name}
${r.product_code}`)) return
    try {
      await apiJson(
        `/admin/ton-kho?product_code=${encodeURIComponent(r.product_code)}${all ? "&all=1" : ""}`,
        "DELETE",
      )
      load()
    } catch (e: any) {
      alert("Xoá thất bại: " + (e?.message ?? ""))
    }
  }

  const shown = useMemo(() => {
    const k = q.trim().toLowerCase()
    return rows.filter(r => {
      if (onlyNeed && !r.need_order) return false
      if (!k) return true
      return r.product_name.toLowerCase().includes(k) || r.product_code.toLowerCase().includes(k)
    })
  }, [rows, q, onlyNeed])

  const stat = useMemo(() => ({
    canDat: rows.filter(r => r.need_order).length,
    chuaChot: rows.filter(r => r.no_snapshot && r.sold_in_period > 0).length,
    hangChet: rows.filter(r => r.dead_stock).length,
    tienNhap: rows.reduce((s, r) => s + (horizon === 7 ? r.suggest_7d : r.suggest_30d), 0),
  }), [rows, horizon])

  const draftCount = Object.values(draft).filter(v => String(v).trim() !== "").length

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Tồn kho</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Kho chốt số mỗi chiều · đơn phát sinh sau đó tự trừ dần · dự báo nhập tính từ lượng bán trên POS
        </p>
      </div>

      {/* Thẻ tổng */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { k: "Cần đặt hàng", v: stat.canDat, hint: "Tồn dưới điểm đặt hàng", tone: stat.canDat ? "text-red-600" : "text-gray-900" },
          { k: "Chưa chốt tồn", v: stat.chuaChot, hint: "Có bán nhưng chưa đếm lần nào", tone: stat.chuaChot ? "text-amber-600" : "text-gray-900" },
          { k: "Hàng chết", v: stat.hangChet, hint: `Còn tồn nhưng ${days} ngày không bán`, tone: stat.hangChet ? "text-amber-600" : "text-gray-900" },
          { k: `Cần nhập ${horizon} ngày`, v: nf(stat.tienNhap), hint: "Tổng số lượng đề xuất", tone: "text-violet-700" },
        ].map(c => (
          <div key={c.k} className="bg-white border rounded-xl p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{c.k}</div>
            <div className={`text-2xl font-bold mt-1 font-mono ${c.tone}`}>{c.v}</div>
            <div className="text-[11px] text-gray-400 mt-0.5">{c.hint}</div>
          </div>
        ))}
      </div>

      {/* Thanh công cụ */}
      <div className="flex flex-wrap gap-2 items-center bg-white border rounded-xl px-4 py-3">
        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder="Tìm tên hoặc mã sản phẩm…"
          className="border rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[180px] max-w-[280px] outline-none focus:ring-2 focus:ring-violet-500/20" />

        <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" checked={onlyNeed} onChange={e => setOnlyNeed(e.target.checked)} />
          Chỉ mã cần đặt
        </label>

        <span className="text-xs text-gray-400 ml-2">Tốc độ bán:</span>
        <select value={days} onChange={e => setDays(Number(e.target.value))}
          className="border rounded-lg px-2 py-1.5 text-xs outline-none">
          {[7, 14, 30, 60].map(d => <option key={d} value={d}>{d} ngày gần nhất</option>)}
        </select>

        <span className="text-xs text-gray-400 ml-1" title="Số ngày từ lúc đặt tới lúc hàng về kho">Chờ hàng về:</span>
        <input type="number" min={0} max={120} value={leadDays}
          onChange={e => setLeadDays(Math.max(0, Math.min(120, Number(e.target.value) || 0)))}
          className="border rounded-lg px-2 py-1.5 text-xs w-16 outline-none" />
        <span className="text-xs text-gray-400">ngày</span>

        <div className="flex gap-1 ml-2">
          {([7, 30] as const).map(h => (
            <button key={h} onClick={() => setHorizon(h)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                horizon === h ? "bg-violet-600 text-white border-violet-600" : "bg-white text-gray-600"}`}>
              Nhập cho {h} ngày
            </button>
          ))}
        </div>

        {canManage && draftCount > 0 && (
          <button onClick={saveSnapshot} disabled={saving}
            className="ml-auto px-4 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white disabled:opacity-50">
            {saving ? "Đang lưu…" : `Chốt tồn ${draftCount} mã`}
          </button>
        )}
      </div>

      {/* Bảng */}
      <div className="bg-white border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b text-[11px] text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2.5">Sản phẩm</th>
                <th className="text-right px-3 py-2.5" title="Số kho đếm được lần gần nhất">Kho chốt</th>
                <th className="text-right px-3 py-2.5" title="Đã bán kể từ lúc kho chốt">Đã bán sau</th>
                <th className="text-right px-3 py-2.5" title="Kho chốt trừ đi đã bán sau đó">Tồn hiện tại</th>
                <th className="text-right px-3 py-2.5" title={`Trung bình ${days} ngày gần nhất`}>Bán/ngày</th>
                <th className="text-right px-3 py-2.5" title="Tồn hiện tại ÷ tốc độ bán">Còn bán được</th>
                <th className="text-right px-3 py-2.5" title="Tồn xuống mức này là phải đặt ngay">Điểm đặt</th>
                <th className="text-right px-3 py-2.5" title="Đủ bán trong kỳ + dự phòng chờ hàng, trừ tồn đang có">Đề xuất nhập</th>
                {canManage && <th className="text-right px-3 py-2.5">Nhập tồn mới</th>}
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr><td colSpan={canManage ? 9 : 8} className="px-4 py-10 text-center text-gray-400">Đang tải…</td></tr>
              ) : shown.length === 0 ? (
                <tr><td colSpan={canManage ? 9 : 8} className="px-4 py-10 text-center text-gray-400 text-sm">
                  {q || onlyNeed ? "Không có mã nào khớp" : "Chưa có dữ liệu"}
                </td></tr>
              ) : shown.map(r => {
                const suggest = horizon === 7 ? r.suggest_7d : r.suggest_30d
                return (
                  <tr key={r.product_code} className={r.need_order ? "bg-red-50/50" : r.dead_stock ? "bg-amber-50/40" : ""}>
                    <td className="px-4 py-2.5">
                      <div className="text-gray-900 max-w-[260px] truncate" title={r.product_name}>{r.product_name}</div>
                      <div className="text-[10.5px] text-gray-400 font-mono">
                        {r.product_code}
                        {r.counted_at && <span className="ml-1.5">· chốt {whenVN(r.counted_at)}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-gray-600">
                      {r.last_qty == null ? <span className="text-gray-300">—</span> : nf(r.last_qty)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-gray-500">
                      {r.last_qty == null ? <span className="text-gray-300">—</span> : `−${nf(r.sold_since_count)}`}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold text-gray-900">
                      {r.on_hand == null
                        ? <span className="text-amber-600 text-xs font-sans">chưa chốt</span>
                        : nf(r.on_hand)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-gray-700">{r.per_day}</td>
                    <td className="px-3 py-2.5 text-right">
                      {r.days_left == null ? <span className="text-gray-300">—</span> : (
                        <span className={`font-mono font-semibold ${
                          r.days_left < 7 ? "text-red-600" : r.days_left < 15 ? "text-amber-600" : "text-gray-900"}`}>
                          {r.days_left} ngày
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-gray-500">{nf(r.reorder_point)}</td>
                    <td className="px-3 py-2.5 text-right">
                      {suggest > 0
                        ? <span className="font-mono font-semibold text-violet-700">{nf(suggest)}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    {canManage && (
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <input type="number" min={0}
                            value={draft[r.product_code] ?? ""}
                            onChange={e => setDraft(d => ({ ...d, [r.product_code]: e.target.value }))}
                            placeholder={r.on_hand != null ? String(r.on_hand) : "—"}
                            className="border rounded-lg px-2 py-1 text-sm w-24 text-right font-mono outline-none focus:ring-2 focus:ring-emerald-500/20" />
                          {r.last_qty != null && (
                            <button type="button"
                              onClick={e => removeSnapshot(r, e.shiftKey)}
                              title="Xoá lần chốt gần nhất — giữ Shift để xoá toàn bộ lịch sử chốt của mã này"
                              className="px-1.5 py-1 text-gray-300 hover:text-red-600 leading-none">
                              ×
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t bg-gray-50 px-4 py-2.5 text-[11px] text-gray-500">
          Kho nhập số đếm được vào cột cuối rồi bấm "Chốt tồn" — ô để trống nghĩa là không đổi.
          Ô gợi ý sẵn số hệ thống đang tính, chỉ cần sửa mã nào lệch.
          {" "}Đề xuất nhập = đủ bán {horizon} ngày + dự phòng {leadDays} ngày chờ hàng, trừ tồn đang có.
        </div>
      </div>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Tồn kho", rank: 3,
})

export default withRouteGuard(TonKhoPage)
