import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useEffect, useState, useCallback } from "react"
import { apiJson } from "../../lib/api-client"
import { withRouteGuard } from "../../components/route-guard"

/**
 * Trang gom mọi việc NHẬP chi phí quảng cáo hằng ngày.
 *
 * Trước đây chi phí Google Ads chỉ điền được trong trang Doanh số MKT, mà vào được
 * trang đó phải có page.bao-cao.view — quyền mở toàn bộ báo cáo doanh số/LNG/lợi nhuận,
 * quá rộng cho nhân sự chỉ nhập số. Tách ra trang riêng với quyền
 * page.nhap-chi-phi.manage để cấp đúng phần việc.
 *
 * Chi phí sàn TikTok/Shopee trước đây ghi tay ra Google Sheet ngoài hệ thống nên báo cáo
 * LNG sàn không trừ được ads — giờ nhập thẳng ở đây.
 */

const fmtMoney = (n: any) => Number(n || 0).toLocaleString("vi-VN") + "đ"

function todayVN(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
}
function daysAgoVN(n: number): string {
  return new Date(Date.now() + 7 * 3600_000 - n * 86400_000).toISOString().slice(0, 10)
}

type Tab = "google" | "san"

const PLATFORMS = [
  { key: "tiktok", label: "TikTok Shop", color: "#111827" },
  { key: "shopee", label: "Shopee", color: "#ee4d2d" },
]

const inputCls = "w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-violet-400"

function NhapChiPhiPage() {
  const [tab, setTab] = useState<Tab>("google")
  return (
    <div className="p-3 sm:p-6 max-w-5xl">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Nhập chi phí quảng cáo</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Điền chi phí hằng ngày để báo cáo LNG trừ được đúng — số nhập ở đây dùng ngay, không cần sync.
        </p>
      </div>

      <div className="flex gap-1 mb-5 border-b border-gray-200 overflow-x-auto">
        {([["google", "🔍 Google Ads"], ["san", "🛒 Sàn TMĐT"]] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
              tab === k
                ? "text-violet-600 border-b-2 border-violet-600 bg-violet-50/50"
                : "text-gray-500 hover:text-gray-700 border-b-2 border-transparent"
            }`}>{label}</button>
        ))}
      </div>

      {tab === "google" && <GoogleAdsCost />}
      {tab === "san" && <MarketplaceAdsCost />}
    </div>
  )
}

// ─── Google Ads ──────────────────────────────────────────────────────────────
function GoogleAdsCost() {
  const [rows, setRows] = useState<any[]>([])
  const [mktCodes, setMktCodes] = useState<string[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const [date, setDate] = useState(todayVN())
  const [mktCode, setMktCode] = useState("")
  const [cost, setCost] = useState("")
  const [clicks, setClicks] = useState("")
  const [impressions, setImpressions] = useState("")
  const [conversions, setConversions] = useState("")

  const from = daysAgoVN(30), to = todayVN()

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const d = await apiJson(`/admin/pancake-sync/report/mkt-cost-gg-manual?from=${from}&to=${to}`)
      setRows(d?.rows ?? [])
      setMktCodes(d?.mkt_codes ?? [])
      setIsAdmin(!!d?.is_admin)
      setMktCode(prev => prev || d?.my_mkt_code || (d?.mkt_codes ?? [])[0] || "")
    } catch (e: any) { setErr(e.message) } finally { setLoading(false) }
  }, [from, to])
  useEffect(() => { load() }, [load])

  const existing = rows.find(r => r.date === date && String(r.mkt_name).toUpperCase() === String(mktCode).toUpperCase())

  const save = async (del = false) => {
    setSaving(true); setErr(null); setOk(null)
    try {
      const d = await apiJson("/admin/pancake-sync/report/mkt-cost-gg-manual", "PUT", {
        date, mkt_code: mktCode,
        cost: del ? null : Number(String(cost).replace(/[^\d]/g, "")) || 0,
        clicks: Number(String(clicks).replace(/[^\d]/g, "")) || 0,
        impressions: Number(String(impressions).replace(/[^\d]/g, "")) || 0,
        conversions: Number(String(conversions).replace(/[^\d.]/g, "")) || 0,
      })
      setOk(del ? `Đã xoá ${date}` : `Đã lưu ${date}: ${fmtMoney(d?.cost ?? 0)}`)
      if (!del) { setCost(""); setClicks(""); setImpressions(""); setConversions("") }
      await load()
    } catch (e: any) { setErr(e.message) } finally { setSaving(false) }
  }

  const canSave = !saving && !!cost.trim() && !!mktCode

  return (
    <div className="space-y-4">
      <div className="bg-white border rounded-xl p-5 shadow-sm space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Ngày">
            <input type="date" value={date} max={todayVN()} onChange={e => setDate(e.target.value)} className={inputCls} />
          </Field>
          {isAdmin && (
            <Field label="Marketer">
              <select value={mktCode} onChange={e => setMktCode(e.target.value)} className={inputCls}>
                {mktCodes.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          )}
        </div>

        <Field label="Chi phí Google Ads (đ) — bắt buộc">
          <input value={cost} onChange={e => setCost(e.target.value)} inputMode="numeric"
            placeholder={existing ? `Đang có: ${fmtMoney(existing.cost)}` : "VD: 1250000"}
            className={`${inputCls} text-base font-bold`} />
          {existing && <p className="text-[11px] text-amber-600 mt-1">⚠ Ngày này đã có {fmtMoney(existing.cost)} — lưu sẽ ghi đè.</p>}
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Hiển thị"><input value={impressions} onChange={e => setImpressions(e.target.value)} inputMode="numeric" placeholder="0" className={inputCls} /></Field>
          <Field label="Click"><input value={clicks} onChange={e => setClicks(e.target.value)} inputMode="numeric" placeholder="0" className={inputCls} /></Field>
          <Field label="Chuyển đổi"><input value={conversions} onChange={e => setConversions(e.target.value)} inputMode="decimal" placeholder="0" className={inputCls} /></Field>
        </div>
        <p className="text-[11px] text-gray-400">3 ô trên tuỳ chọn — CTR/CPC/giá mỗi chuyển đổi hệ thống tự tính.</p>

        <Alerts err={err} ok={ok} />

        <div className="flex gap-2">
          <button onClick={() => save(false)} disabled={!canSave}
            className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-bold text-white ${
              canSave ? "bg-green-600 hover:bg-green-700" : "bg-gray-300 cursor-not-allowed"}`}>
            {saving ? "Đang lưu…" : "Lưu chi phí"}
          </button>
          {existing && (
            <button onClick={() => save(true)} disabled={saving}
              className="rounded-lg border border-red-300 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50">Xoá dòng này</button>
          )}
        </div>
      </div>

      <HistoryTable
        title="30 ngày gần nhất"
        loading={loading}
        rows={rows}
        cols={["Ngày", "MKT", "Chi phí"]}
        renderRow={(r: any) => [r.date, r.mkt_name, fmtMoney(r.cost)]}
        isActive={(r: any) => r.date === date && String(r.mkt_name).toUpperCase() === String(mktCode).toUpperCase()}
        onPick={(r: any) => {
          setDate(r.date); setMktCode(String(r.mkt_name).toUpperCase())
          setCost(String(r.cost ?? "")); setImpressions(String(r.impressions ?? ""))
          setClicks(String(r.clicks ?? "")); setConversions(String(r.conversions ?? ""))
        }}
      />
    </div>
  )
}

// ─── Sàn TMĐT ────────────────────────────────────────────────────────────────
function MarketplaceAdsCost() {
  const [rows, setRows] = useState<any[]>([])
  const [totals, setTotals] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const [date, setDate] = useState(todayVN())
  const [platform, setPlatform] = useState("tiktok")
  const [cost, setCost] = useState("")
  const [note, setNote] = useState("")

  const from = daysAgoVN(30), to = todayVN()

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const d = await apiJson(`/admin/pancake-sync/report/mkt-cost-marketplace?from=${from}&to=${to}`)
      setRows(d?.rows ?? []); setTotals(d?.totals ?? [])
    } catch (e: any) { setErr(e.message) } finally { setLoading(false) }
  }, [from, to])
  useEffect(() => { load() }, [load])

  const existing = rows.find(r => r.date === date && r.platform === platform)

  const save = async (del = false) => {
    setSaving(true); setErr(null); setOk(null)
    try {
      const d = await apiJson("/admin/pancake-sync/report/mkt-cost-marketplace", "PUT", {
        date, platform,
        cost: del ? null : Number(String(cost).replace(/[^\d]/g, "")) || 0,
        note: note.trim() || null,
      })
      setOk(del ? `Đã xoá ${date}` : `Đã lưu ${date}: ${fmtMoney(d?.cost ?? 0)}`)
      if (!del) { setCost(""); setNote("") }
      await load()
    } catch (e: any) { setErr(e.message) } finally { setSaving(false) }
  }

  const canSave = !saving && !!cost.trim()

  return (
    <div className="space-y-4">
      {totals.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {totals.map((t: any) => {
            const p = PLATFORMS.find(x => x.key === t.platform)
            return (
              <div key={t.platform} className="bg-white border rounded-xl p-4 shadow-sm" style={{ borderTop: `3px solid ${p?.color ?? "#666666"}` }}>
                <div className="text-xs text-gray-500 uppercase tracking-wide">{p?.label ?? t.platform}</div>
                <div className="text-xl font-bold mt-1 text-gray-900">{fmtMoney(t.cost)}</div>
                <div className="text-xs text-gray-400 mt-0.5">{t.days} ngày đã điền · 30 ngày gần nhất</div>
              </div>
            )
          })}
        </div>
      )}

      <div className="bg-white border rounded-xl p-5 shadow-sm space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Ngày">
            <input type="date" value={date} max={todayVN()} onChange={e => setDate(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Sàn">
            <div className="flex gap-2">
              {PLATFORMS.map(p => (
                <button key={p.key} type="button" onClick={() => setPlatform(p.key)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold ${
                    platform === p.key ? "bg-violet-600 text-white border-violet-600" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}>
                  {p.label}
                </button>
              ))}
            </div>
          </Field>
        </div>

        <Field label="Chi phí quảng cáo (đ) — bắt buộc">
          <input value={cost} onChange={e => setCost(e.target.value)} inputMode="numeric"
            placeholder={existing ? `Đang có: ${fmtMoney(existing.cost)}` : "VD: 573363"}
            className={`${inputCls} text-base font-bold`} />
          {existing && <p className="text-[11px] text-amber-600 mt-1">⚠ Ngày này đã có {fmtMoney(existing.cost)} — lưu sẽ ghi đè.</p>}
        </Field>

        <Field label="Ghi chú (tuỳ chọn)">
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="VD: gồm cả hoa hồng Affiliate" className={inputCls} />
        </Field>

        <Alerts err={err} ok={ok} />

        <div className="flex gap-2">
          <button onClick={() => save(false)} disabled={!canSave}
            className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-bold text-white ${
              canSave ? "bg-green-600 hover:bg-green-700" : "bg-gray-300 cursor-not-allowed"}`}>
            {saving ? "Đang lưu…" : "Lưu chi phí"}
          </button>
          {existing && (
            <button onClick={() => save(true)} disabled={saving}
              className="rounded-lg border border-red-300 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50">Xoá dòng này</button>
          )}
        </div>
      </div>

      <HistoryTable
        title="30 ngày gần nhất"
        loading={loading}
        rows={rows}
        cols={["Ngày", "Sàn", "Chi phí", "Ghi chú"]}
        renderRow={(r: any) => [
          r.date,
          PLATFORMS.find(p => p.key === r.platform)?.label ?? r.platform,
          fmtMoney(r.cost),
          r.note || "—",
        ]}
        isActive={(r: any) => r.date === date && r.platform === platform}
        onPick={(r: any) => {
          setDate(r.date); setPlatform(r.platform)
          setCost(String(r.cost ?? "")); setNote(r.note ?? "")
        }}
      />
    </div>
  )
}

// ─── UI dùng chung ───────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-500">{label}</label>
      {children}
    </div>
  )
}

function Alerts({ err, ok }: { err: string | null; ok: string | null }) {
  return (
    <>
      {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">⚠ {err}</div>}
      {ok && <div className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">✓ {ok}</div>}
    </>
  )
}

function HistoryTable({ title, loading, rows, cols, renderRow, isActive, onPick }: {
  title: string; loading: boolean; rows: any[]; cols: string[]
  renderRow: (r: any) => (string | number)[]
  isActive: (r: any) => boolean
  onPick: (r: any) => void
}) {
  return (
    <div className="bg-white border rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b text-sm font-semibold text-gray-700">
        {title} {loading && <span className="font-normal text-gray-400">· đang tải…</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b text-xs text-gray-500">
            <tr>{cols.map(c => <th key={c} className="px-4 py-2 text-left">{c}</th>)}</tr>
          </thead>
          <tbody className="divide-y text-gray-900">
            {!loading && rows.length === 0 && (
              <tr><td colSpan={cols.length} className="px-4 py-6 text-center text-sm text-gray-400">Chưa có dữ liệu</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={i} onClick={() => onPick(r)}
                className={`cursor-pointer hover:bg-gray-50 ${isActive(r) ? "bg-violet-50" : ""}`}>
                {renderRow(r).map((cell, j) => (
                  <td key={j} className={`px-4 py-2 ${j === 0 ? "font-mono" : ""} ${j === 2 ? "font-semibold" : ""}`}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t bg-gray-50 px-4 py-2 text-[11px] text-gray-500">Bấm 1 dòng để nạp lên form sửa nhanh.</div>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Nhập chi phí", rank: 4,
})

export default withRouteGuard(NhapChiPhiPage)
