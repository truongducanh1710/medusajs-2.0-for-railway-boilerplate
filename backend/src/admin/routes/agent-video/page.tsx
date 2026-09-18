import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useEffect, useState } from "react"
import { apiFetch } from "../../lib/api-client"
import { withRouteGuard } from "../../components/route-guard"

/**
 * Trang điều khiển Agent Video — nơi người giao tiếp với agent phân bổ ngân sách.
 *
 * Ba việc trang này phục vụ:
 *   1. Xem agent đang cấp tiền cho video nào, vì sao  (tab Video)
 *   2. Đọc nhật ký quyết định + hiệu quả từng luật     (tab Nhật ký)
 *   3. Cấp / thu hồi hạn mức, khoá video               (tab Hạn mức)
 *
 * Agent chỉ ĐỌC agent_budget_grant, không bao giờ ghi — mọi thay đổi hạn mức
 * đều đi qua trang này.
 */

const fmtVND = (n: any) => {
  const v = Number(n)
  if (!Number.isFinite(v) || v === 0) return "—"
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)} tỷ`
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)} tr`
  if (v >= 1e3) return `${Math.round(v / 1e3)}k`
  return new Intl.NumberFormat("vi-VN").format(v)
}
const fmtNum = (n: any) => (n == null ? "—" : new Intl.NumberFormat("vi-VN").format(Number(n)))
const fmtDate = (s: any) => {
  if (!s) return "—"
  const d = new Date(s)
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

const PHASE_LABEL: Record<string, { text: string; cls: string }> = {
  testing: { text: "Đang thử", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  scaling: { text: "Đang tăng", cls: "bg-green-50 text-green-700 border-green-200" },
  holding: { text: "Giữ nguyên", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  killed:  { text: "Đã cắt", cls: "bg-red-50 text-red-600 border-red-200" },
}

const ACTION_LABEL: Record<string, { text: string; cls: string }> = {
  kill:       { text: "Cắt", cls: "bg-red-50 text-red-600" },
  scale_up:   { text: "Tăng tiền", cls: "bg-green-50 text-green-700" },
  scale_down: { text: "Giảm tiền", cls: "bg-orange-50 text-orange-700" },
  hold:       { text: "Giữ nguyên", cls: "bg-gray-100 text-gray-600" },
  start_test: { text: "Bắt đầu thử", cls: "bg-blue-50 text-blue-700" },
  revive:     { text: "Bật lại", cls: "bg-violet-50 text-violet-700" },
  lock:       { text: "Khoá", cls: "bg-gray-100 text-gray-600" },
  unlock:     { text: "Mở khoá", cls: "bg-gray-100 text-gray-600" },
}

function Pill({ map, k }: { map: Record<string, { text: string; cls: string }>; k: string }) {
  const it = map[k]
  if (!it) return <span className="text-xs text-gray-400">{k || "—"}</span>
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${it.cls}`}>{it.text}</span>
}

/** Màu theo ROAS — ngưỡng khớp với luật của agent. */
function roasColor(r: any, kill = 1.5, scale = 2.0) {
  const v = Number(r)
  if (!Number.isFinite(v)) return "text-gray-300"
  if (v < kill) return "text-red-600 font-semibold"
  if (v < scale) return "text-amber-600"
  return "text-green-700 font-semibold"
}

const AgentVideoPage = () => {
  const [tab, setTab] = useState<"video" | "log" | "grant">("video")
  const [data, setData] = useState<any>(null)
  const [logs, setLogs] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [phase, setPhase] = useState("all")
  const [sort, setSort] = useState("spend")
  const [chiTiet, setChiTiet] = useState<string | null>(null)

  async function tai() {
    setLoading(true)
    try {
      const r = await apiFetch(`/admin/agent-video/videos?phase=${phase}&sort=${sort}`)
      setData(await r.json())
    } catch { setData(null) }
    setLoading(false)
  }
  async function taiLog() {
    try {
      const r = await apiFetch(`/admin/agent-video/decisions?limit=120`)
      setLogs(await r.json())
    } catch { setLogs(null) }
  }

  useEffect(() => { tai() }, [phase, sort])
  useEffect(() => { taiLog() }, [])

  async function khoa(vd: string, locked: boolean) {
    await apiFetch("/admin/agent-video/lock", {
      method: "POST", body: JSON.stringify({ vd_code: vd, locked }),
    })
    tai(); taiLog()
  }
  async function batLai(vd: string) {
    if (!confirm(`Bật lại ${vd}? Video sẽ được cấp lại ngân sách thử và agent chấm lại từ đầu.`)) return
    await apiFetch("/admin/agent-video/lock", {
      method: "POST", body: JSON.stringify({ vd_code: vd, action: "revive" }),
    })
    tai(); taiLog()
  }

  if (loading && !data) return <div className="p-6 text-center text-gray-400">Đang tải…</div>

  const s = data?.summary ?? {}
  const grant = data?.grants?.[0]
  const kill = Number(grant?.roas_kill ?? 1.5)
  const scale = Number(grant?.roas_scale ?? 2.0)
  const daDung = Number(s.ngan_sach_dang_cap ?? 0)
  const tran = Number(grant?.daily_cap ?? 0)

  return (
    <div className="p-3 sm:p-6 max-w-7xl">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Agent Video</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Phân bổ ngân sách quảng cáo theo hiệu quả từng video
        </p>
      </div>

      {/* Trạng thái agent — phải nhìn thấy ngay, vì quyết định mọi thứ khác */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {!data?.agent_on ? (
          <span className="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-500 border">
            Agent đang tắt (VIDEO_AGENT=off)
          </span>
        ) : !grant ? (
          <span className="px-3 py-1.5 rounded-lg text-sm font-medium bg-amber-50 text-amber-700 border border-amber-200">
            Chưa cấp hạn mức — agent không chạy
          </span>
        ) : data?.dry_run ? (
          <span className="px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-50 text-blue-700 border border-blue-200">
            Chế độ đề xuất — agent tính toán và ghi log, chưa đụng Facebook
          </span>
        ) : (
          <span className="px-3 py-1.5 rounded-lg text-sm font-medium bg-green-50 text-green-700 border border-green-200">
            Đang chạy thật — agent tự tắt/bật và chỉnh ngân sách
          </span>
        )}
        {grant && (
          <span className="text-xs text-gray-500">
            Ngưỡng cắt ROAS {kill} · ngưỡng tăng {scale} · trần mỗi video {fmtVND(grant.per_video_cap)}
          </span>
        )}
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <div className="bg-white border rounded-xl p-4 shadow-sm">
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Chi phí 30 ngày</div>
          <div className="text-2xl font-bold text-gray-900">{fmtVND(s.tong_chi)}</div>
          <div className="text-xs text-gray-400 mt-0.5">{fmtNum(s.tong_video)} video</div>
        </div>
        <div className="bg-white border rounded-xl p-4 shadow-sm">
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Doanh thu đã nhận</div>
          <div className="text-2xl font-bold text-gray-900">{fmtVND(s.tong_dt_nhan)}</div>
          <div className="text-xs text-gray-400 mt-0.5">chỉ đơn giao thành công</div>
        </div>
        <div className={`bg-white border rounded-xl p-4 shadow-sm ${Number(s.roas_chung) < kill ? "border-l-4 border-l-red-400" : "border-l-4 border-l-green-400"}`}>
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">ROAS thật</div>
          <div className={`text-2xl font-bold ${roasColor(s.roas_chung, kill, scale)}`}>{s.roas_chung ?? "—"}</div>
          <div className="text-xs text-gray-400 mt-0.5">doanh thu nhận ÷ chi phí</div>
        </div>
        <div className="bg-white border rounded-xl p-4 shadow-sm">
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Ngân sách đang cấp</div>
          <div className="text-2xl font-bold text-gray-900">{fmtVND(daDung)}</div>
          {tran > 0 && (
            <>
              <div className="w-full h-1.5 bg-gray-100 rounded mt-2 overflow-hidden">
                <div className={`h-full rounded ${daDung > tran * 0.9 ? "bg-red-500" : "bg-violet-500"}`}
                  style={{ width: `${Math.min(100, daDung / tran * 100)}%` }} />
              </div>
              <div className="text-xs text-gray-400 mt-1">trần {fmtVND(tran)}/ngày</div>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200 overflow-x-auto">
        {([["video", "Video"], ["log", "Nhật ký agent"], ["grant", "Hạn mức"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => { setTab(k); if (k === "log") taiLog() }}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap ${
              tab === k ? "text-violet-600 border-b-2 border-violet-600 bg-violet-50/50"
                        : "text-gray-500 hover:text-gray-700 border-b-2 border-transparent"}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === "video" && (
        <>
          <div className="flex flex-wrap gap-2 mb-3">
            <select value={phase} onChange={e => setPhase(e.target.value)}
              className="border rounded-lg px-3 py-1.5 text-sm">
              <option value="all">Tất cả</option>
              <option value="scaling">Đang tăng</option>
              <option value="testing">Đang thử</option>
              <option value="holding">Giữ nguyên</option>
              <option value="killed">Đã cắt</option>
              <option value="chua_quan_ly">Agent chưa quản lý</option>
            </select>
            <select value={sort} onChange={e => setSort(e.target.value)}
              className="border rounded-lg px-3 py-1.5 text-sm">
              <option value="spend">Chi nhiều nhất</option>
              <option value="roas">ROAS cao nhất</option>
              <option value="roas_low">ROAS thấp nhất</option>
              <option value="recent">Agent vừa động tới</option>
            </select>
            {Number(s.chua_quan_ly) > 0 && (
              <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
                {fmtNum(s.chua_quan_ly)} video đang tiêu tiền mà agent chưa quản lý
              </span>
            )}
          </div>

          <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b text-xs text-gray-500">
                  <tr>
                    <th className="text-left px-4 py-2">Video</th>
                    <th className="text-right px-4 py-2">Chi phí</th>
                    <th className="text-right px-4 py-2">Đơn</th>
                    <th className="text-right px-4 py-2">ROAS thật</th>
                    <th className="text-right px-4 py-2">Ước tính</th>
                    <th className="text-right px-4 py-2">% huỷ</th>
                    <th className="text-center px-4 py-2">Trạng thái</th>
                    <th className="text-right px-4 py-2">Ngân sách</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y text-gray-900">
                  {(data?.videos ?? []).map((v: any) => (
                    <>
                      <tr key={v.vd_code} className={v.locked_by_human ? "bg-gray-50" : ""}>
                        <td className="px-4 py-2.5">
                          <button onClick={() => setChiTiet(chiTiet === v.vd_code ? null : v.vd_code)}
                            className="font-semibold text-gray-900 hover:text-violet-600">
                            {v.vd_code}
                          </button>
                          {v.locked_by_human && <span className="ml-1.5 text-xs text-gray-400">khoá</span>}
                          {v.product && <div className="text-xs text-gray-400 truncate max-w-[200px]">{v.product}</div>}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs">{fmtVND(v.spend)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs">
                          {fmtNum(v.don_nhan)}<span className="text-gray-300">/{fmtNum(v.don_tong)}</span>
                        </td>
                        <td className={`px-4 py-2.5 text-right font-mono text-xs ${roasColor(v.roas_that, kill, scale)}`}>
                          {v.roas_that ?? "—"}
                        </td>
                        <td className={`px-4 py-2.5 text-right font-mono text-xs ${roasColor(v.roas_est, kill, scale)}`}>
                          {v.roas_est ?? "—"}
                        </td>
                        <td className={`px-4 py-2.5 text-right font-mono text-xs ${Number(v.ty_le_huy) > 45 ? "text-red-600 font-semibold" : "text-gray-400"}`}>
                          {v.ty_le_huy == null ? "—" : `${v.ty_le_huy}%`}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {v.phase ? <Pill map={PHASE_LABEL} k={v.phase} />
                                   : <span className="text-xs text-gray-300">chưa quản lý</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs">{fmtVND(v.daily_budget)}</td>
                        <td className="px-2 py-2.5 text-right whitespace-nowrap">
                          {v.phase === "killed" ? (
                            <button onClick={() => batLai(v.vd_code)}
                              className="text-xs text-violet-600 hover:underline">Bật lại</button>
                          ) : (
                            <button onClick={() => khoa(v.vd_code, !v.locked_by_human)}
                              className="text-xs text-gray-400 hover:text-gray-700">
                              {v.locked_by_human ? "Mở" : "Khoá"}
                            </button>
                          )}
                        </td>
                      </tr>
                      {chiTiet === v.vd_code && (
                        <tr key={`${v.vd_code}-d`} className="bg-gray-50">
                          <td colSpan={9} className="px-4 py-3">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                              <div><span className="text-gray-400">Hiển thị</span><div className="font-mono">{fmtNum(v.impressions)}</div></div>
                              <div><span className="text-gray-400">CTR</span><div className="font-mono">{v.ctr ?? "—"}%</div></div>
                              <div><span className="text-gray-400">Số ad</span><div className="font-mono">{fmtNum(v.so_ad)}</div></div>
                              <div><span className="text-gray-400">Tỷ lệ nhận</span><div className="font-mono">{v.ty_le_nhan ?? "—"}%</div></div>
                              <div><span className="text-gray-400">DT đã nhận</span><div className="font-mono">{fmtVND(v.dt_nhan)}</div></div>
                              <div><span className="text-gray-400">Chạy từ</span><div className="font-mono">{v.first_spend_date?.slice(5, 10) ?? "—"}</div></div>
                              <div><span className="text-gray-400">Agent động gần nhất</span><div className="font-mono">{fmtDate(v.last_action_at)}</div></div>
                              <div><span className="text-gray-400">Người làm video</span><div>{v.maker ?? "—"}</div></div>
                            </div>
                            {v.killed_reason && (
                              <div className="mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                                Lý do cắt: {v.killed_reason}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                  {(data?.videos ?? []).length === 0 && (
                    <tr><td colSpan={9} className="px-4 py-12 text-center text-gray-400">Không có video nào</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === "log" && (
        <div className="space-y-4">
          {logs?.today && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {([["tong", "Quyết định 24h"], ["kill", "Cắt"], ["scale_up", "Tăng tiền"],
                 ["hold", "Giữ nguyên"], ["da_thuc_thi", "Đã thực thi"]] as const).map(([k, l]) => (
                <div key={k} className="bg-white border rounded-lg px-4 py-3">
                  <div className="text-xs text-gray-500">{l}</div>
                  <div className="text-xl font-bold">{fmtNum(logs.today[k])}</div>
                </div>
              ))}
            </div>
          )}

          {logs?.rules?.length > 0 && (
            <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b">
                <h3 className="font-semibold text-gray-700 text-sm">Hiệu quả từng luật</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Chấm ngược sau 7 ngày. Luật sai nhiều nghĩa là ngưỡng của nó cần chỉnh.
                </p>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b text-xs text-gray-500">
                  <tr>
                    <th className="text-left px-4 py-2">Luật</th>
                    <th className="text-right px-4 py-2">Áp dụng</th>
                    <th className="text-right px-4 py-2">Đúng</th>
                    <th className="text-right px-4 py-2">Sai</th>
                    <th className="text-right px-4 py-2">Chờ chấm</th>
                    <th className="text-right px-4 py-2">% đúng</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {logs.rules.map((r: any) => (
                    <tr key={r.rule_hit}>
                      <td className="px-4 py-2.5 font-mono text-xs">{r.rule_hit}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs">{fmtNum(r.tong)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-green-700">{fmtNum(r.dung)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-red-600">{fmtNum(r.sai)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-gray-400">{fmtNum(r.cho_cham)}</td>
                      <td className={`px-4 py-2.5 text-right font-mono text-xs font-semibold ${
                        r.pct_dung == null ? "text-gray-300" : Number(r.pct_dung) < 60 ? "text-red-600" : "text-green-700"}`}>
                        {r.pct_dung == null ? "—" : `${r.pct_dung}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b font-semibold text-gray-700 text-sm">Nhật ký quyết định</div>
            <div className="divide-y max-h-[600px] overflow-y-auto">
              {(logs?.decisions ?? []).map((d: any) => (
                <div key={d.id} className="px-4 py-3 hover:bg-gray-50">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{d.vd_code}</span>
                      <Pill map={ACTION_LABEL} k={d.action} />
                      {!d.executed && d.action !== "lock" && d.action !== "unlock" && (
                        <span className="text-xs text-gray-400">chỉ đề xuất</span>
                      )}
                      {d.outcome_verdict && (
                        <span className={`text-xs font-medium ${
                          d.outcome_verdict === "correct" ? "text-green-700"
                          : d.outcome_verdict === "wrong" ? "text-red-600" : "text-gray-400"}`}>
                          {d.outcome_verdict === "correct" ? "✓ đúng"
                           : d.outcome_verdict === "wrong" ? "✗ sai" : "~ chưa rõ"}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-gray-400 font-mono">{fmtDate(d.created_at)}</span>
                  </div>
                  <div className="text-sm text-gray-600 mt-1">{d.reason}</div>
                  {(d.budget_before != null && d.budget_after != null && d.budget_before !== d.budget_after) && (
                    <div className="text-xs text-gray-400 mt-1 font-mono">
                      {fmtVND(d.budget_before)} → {fmtVND(d.budget_after)}
                    </div>
                  )}
                  {d.error && (
                    <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1.5">
                      {d.error}
                    </div>
                  )}
                </div>
              ))}
              {(logs?.decisions ?? []).length === 0 && (
                <div className="px-4 py-12 text-center text-sm text-gray-400">
                  Agent chưa có quyết định nào. Cấp hạn mức ở tab “Hạn mức” để agent bắt đầu chạy.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "grant" && <TabHanMuc grants={data?.grants ?? []} onDone={tai} />}
    </div>
  )
}

function TabHanMuc({ grants, onDone }: { grants: any[]; onDone: () => void }) {
  const g = grants[0]
  const [form, setForm] = useState({
    mkt_name: g?.mkt_name ?? "",
    daily_cap: g?.daily_cap ?? 12000000,
    per_video_cap: g?.per_video_cap ?? 3000000,
    test_budget: g?.test_budget ?? 300000,
    roas_kill: g?.roas_kill ?? 1.5,
    roas_scale: g?.roas_scale ?? 2.0,
    cancel_rate_kill: g?.cancel_rate_kill ?? 45,
    note: "",
  })
  const [dangLuu, setDangLuu] = useState(false)

  async function luu() {
    setDangLuu(true)
    try {
      const r = await apiFetch("/admin/agent-video/grant", {
        method: "POST", body: JSON.stringify(form),
      })
      const d = await r.json()
      if (d.error) { alert(d.error); return }
      onDone()
      alert("Đã cấp hạn mức. Agent sẽ áp dụng ở vòng chạy tiếp theo.")
    } finally { setDangLuu(false) }
  }

  async function thuHoi() {
    if (!confirm(`Thu hồi hạn mức của ${g.mkt_name || "toàn bộ"}? Agent sẽ dừng ngay vòng sau.`)) return
    await apiFetch(`/admin/agent-video/grant?mkt_name=${encodeURIComponent(g.mkt_name ?? "")}`, { method: "DELETE" })
    onDone()
  }

  const F = ({ label, hint, k, suffix }: any) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input type="number" value={(form as any)[k]}
          onChange={e => setForm({ ...form, [k]: Number(e.target.value) })}
          className="flex-1 border rounded-lg px-3 py-2 text-sm font-mono" />
        {suffix && <span className="text-xs text-gray-400 w-12">{suffix}</span>}
      </div>
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  )

  return (
    <div className="space-y-4 max-w-2xl">
      {g && (
        <div className="bg-white border rounded-xl p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-gray-800">Hạn mức đang hiệu lực</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {g.mkt_name || "Toàn bộ MKT"} · cấp bởi {g.granted_by || "—"} ·{" "}
                {String(g.effective_date).slice(0, 10)}
              </p>
              {g.note && <p className="text-sm text-gray-600 mt-2">{g.note}</p>}
            </div>
            <button onClick={thuHoi}
              className="text-xs text-red-600 hover:underline whitespace-nowrap">Thu hồi</button>
          </div>
        </div>
      )}

      <div className="bg-white border rounded-xl p-5 shadow-sm space-y-4">
        <div>
          <h3 className="font-semibold text-gray-800">{g ? "Cấp lại hạn mức" : "Cấp hạn mức cho agent"}</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Agent chỉ tiêu tiền khi có hạn mức. Mỗi lần cấp tạo bản ghi mới, bản cũ lưu lại làm lịch sử.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Áp dụng cho MKT</label>
          <input value={form.mkt_name} onChange={e => setForm({ ...form, mkt_name: e.target.value })}
            placeholder="Để trống = toàn bộ. VD: XUANLT"
            className="w-full border rounded-lg px-3 py-2 text-sm" />
          <p className="text-xs text-gray-400 mt-1">
            Nên bắt đầu với một MKT để theo dõi trước khi mở rộng.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <F label="Trần ngân sách ngày" k="daily_cap" suffix="đ"
            hint="Tổng tối đa agent được cấp mỗi ngày. Vượt thì agent xin duyệt." />
          <F label="Trần mỗi video" k="per_video_cap" suffix="đ"
            hint="Một video không bao giờ vượt mức này." />
          <F label="Ngân sách thử" k="test_budget" suffix="đ"
            hint="Video mới được cấp mức này. Tiêu đủ 3 lần thì agent chấm điểm." />
          <F label="Ngưỡng huỷ để cắt" k="cancel_rate_kill" suffix="%"
            hint="Tỷ lệ huỷ vượt mức này thì cắt ngay, không đợi ROAS." />
          <F label="Ngưỡng ROAS cắt" k="roas_kill"
            hint="Dưới mức này thì tắt video." />
          <F label="Ngưỡng ROAS tăng" k="roas_scale"
            hint="Từ mức này trở lên thì tăng ngân sách dần." />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Ghi chú</label>
          <input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })}
            placeholder="VD: Chạy thử 2 tuần cho XUANLT"
            className="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={luu} disabled={dangLuu}
            className="px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:bg-gray-200">
            {dangLuu ? "Đang lưu…" : "Cấp hạn mức"}
          </button>
        </div>
      </div>

      <div className="bg-gray-50 border rounded-xl p-4 text-xs text-gray-500 space-y-1.5">
        <p><b className="text-gray-700">Agent chạy 2 giờ một lần.</b> Mỗi vòng đọc ROAS từng video rồi quyết định cắt, giữ hay tăng tiền.</p>
        <p><b className="text-gray-700">Chế độ đề xuất</b> (mặc định): agent ghi log đầy đủ nhưng không đụng Facebook. Đặt <code className="bg-white px-1 rounded">VIDEO_AGENT_DRY=off</code> trên Railway để chạy thật.</p>
        <p><b className="text-gray-700">Tắt khẩn cấp:</b> thu hồi hạn mức ở trên, hoặc đặt <code className="bg-white px-1 rounded">VIDEO_AGENT=off</code>.</p>
      </div>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Agent Video", rank: 9,
})

export default withRouteGuard(AgentVideoPage)
