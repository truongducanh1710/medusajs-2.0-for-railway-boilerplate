import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useEffect, useState, useCallback, useMemo } from "react"
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
 * LNG sàn không trừ được ads — giờ nhập thẳng ở đây, tách theo thị trường (VN/MY) và
 * từng shop vì MY chạy nhiều shop song song.
 */

const fmtMoney = (n: any) => Number(n || 0).toLocaleString("vi-VN") + "đ"

function todayVN(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
}
function daysAgoVN(n: number): string {
  return new Date(Date.now() + 7 * 3600_000 - n * 86400_000).toISOString().slice(0, 10)
}

type Tab = "google" | "san" | "tong"

const PLATFORMS = [
  { key: "tiktok", label: "TikTok Shop", color: "#111827" },
  { key: "shopee", label: "Shopee", color: "#ee4d2d" },
]
const MARKETS = [
  { key: "VN", label: "🇻🇳 Việt Nam" },
  { key: "MY", label: "🇲🇾 Malaysia" },
]
const platLabel = (k: string) => PLATFORMS.find(p => p.key === k)?.label ?? k

const inputCls = "w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-violet-400"

function NhapChiPhiPage() {
  const [tab, setTab] = useState<Tab>("google")
  return (
    <div className="p-3 sm:p-6 max-w-6xl">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Nhập chi phí quảng cáo</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Điền chi phí hằng ngày để báo cáo LNG trừ được đúng — số nhập ở đây dùng ngay, không cần sync.
        </p>
      </div>

      <div className="flex gap-1 mb-5 border-b border-gray-200 overflow-x-auto">
        {([["google", "🔍 Google Ads"], ["san", "🛒 Sàn TMĐT"], ["tong", "📋 Tổng hợp & kiểm tra"]] as [Tab, string][]).map(([k, label]) => (
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
      {tab === "tong" && <TongHopTab />}
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
  const [shops, setShops] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const [date, setDate] = useState(todayVN())
  const [platform, setPlatform] = useState("tiktok")
  const [market, setMarket] = useState("VN")
  const [shop, setShop] = useState("")
  const [cost, setCost] = useState("")
  const [note, setNote] = useState("")

  const from = daysAgoVN(30), to = todayVN()

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const d = await apiJson(`/admin/pancake-sync/report/mkt-cost-marketplace?from=${from}&to=${to}`)
      setRows(d?.rows ?? []); setTotals(d?.totals ?? []); setShops(d?.shops ?? [])
    } catch (e: any) { setErr(e.message) } finally { setLoading(false) }
  }, [from, to])
  useEffect(() => { load() }, [load])

  // Shop khả dụng theo (sàn, thị trường) đang chọn — lấy từ đơn thật, tránh gõ sai tên
  // làm vỡ grain (mỗi cách viết thành 1 dòng chi phí riêng).
  const shopOptions = useMemo(
    () => shops.filter(s => s.platform === platform && s.market === market),
    [shops, platform, market]
  )
  // Đổi sàn/thị trường mà shop cũ không còn hợp lệ thì bỏ chọn.
  // Chỉ có đúng 1 shop thì chọn sẵn cho đỡ thao tác.
  useEffect(() => {
    if (shop && !shopOptions.some(s => s.shop === shop)) { setShop(""); return }
    if (!shop && shopOptions.length === 1) setShop(shopOptions[0].shop)
  }, [shopOptions, shop])

  const existing = rows.find(r =>
    r.date === date && r.platform === platform && r.market === market && (r.shop ?? "") === shop)

  const save = async (del = false) => {
    setSaving(true); setErr(null); setOk(null)
    try {
      const d = await apiJson("/admin/pancake-sync/report/mkt-cost-marketplace", "PUT", {
        date, platform, market, shop,
        cost: del ? null : Number(String(cost).replace(/[^\d]/g, "")) || 0,
        note: note.trim() || null,
      })
      setOk(del ? `Đã xoá ${date}` : `Đã lưu ${date} · ${platLabel(platform)} ${market} · ${shop}: ${fmtMoney(d?.cost ?? 0)}`)
      if (!del) { setCost(""); setNote("") }
      await load()
    } catch (e: any) { setErr(e.message) } finally { setSaving(false) }
  }

  const canSave = !saving && !!cost.trim() && !!shop

  return (
    <div className="space-y-4">
      {totals.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {totals.map((t: any) => {
            const p = PLATFORMS.find(x => x.key === t.platform)
            return (
              <div key={`${t.platform}-${t.market}`} className="bg-white border rounded-xl p-4 shadow-sm"
                style={{ borderTop: `3px solid ${p?.color ?? "#666666"}` }}>
                <div className="text-xs text-gray-500 uppercase tracking-wide">
                  {p?.label ?? t.platform} · {t.market}
                </div>
                <div className="text-xl font-bold mt-1 text-gray-900">{fmtMoney(t.cost)}</div>
                <div className="text-xs text-gray-400 mt-0.5">{t.days} ngày · {t.entries} dòng</div>
              </div>
            )
          })}
        </div>
      )}

      <div className="bg-white border rounded-xl p-5 shadow-sm space-y-3">
        <div className="rounded-lg bg-blue-50 px-3 py-2 text-[12px] text-blue-800">
          💡 Nhập chi phí bằng <b>VNĐ</b> cho cả 2 thị trường. Đơn Malaysia lưu bằng RM nên nếu
          báo cáo sàn hiển thị RM, hãy quy đổi trước khi điền để tổng chi phí không lẫn 2 loại tiền.
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Ngày">
            <input type="date" value={date} max={todayVN()} onChange={e => setDate(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Thị trường">
            <div className="flex gap-2">
              {MARKETS.map(m => (
                <button key={m.key} type="button" onClick={() => setMarket(m.key)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold ${
                    market === m.key ? "bg-violet-600 text-white border-violet-600" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}>
                  {m.label}
                </button>
              ))}
            </div>
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
          <Field label="Shop">
            <select value={shop} onChange={e => setShop(e.target.value)}
              className={`${inputCls} ${shop ? "" : "border-amber-300"}`}>
              <option value="">— Chọn shop —</option>
              {shopOptions.map(s => (
                <option key={s.shop} value={s.shop}>{s.shop || "(không tên)"} · {s.orders} đơn</option>
              ))}
            </select>
            {!shop && (
              <p className="text-[11px] text-amber-600 mt-1">
                {shopOptions.length
                  ? "Điền chi phí theo từng shop — chọn shop trước khi lưu."
                  : "Chưa thấy shop nào có đơn ở sàn/thị trường này trong 30 ngày."}
              </p>
            )}
          </Field>
        </div>

        <Field label="Chi phí quảng cáo (VNĐ) — bắt buộc">
          <input value={cost} onChange={e => setCost(e.target.value)} inputMode="numeric"
            placeholder={existing ? `Đang có: ${fmtMoney(existing.cost)}` : "VD: 573363"}
            className={`${inputCls} text-base font-bold`} />
          {existing && <p className="text-[11px] text-amber-600 mt-1">⚠ Kênh này ngày {date} đã có {fmtMoney(existing.cost)} — lưu sẽ ghi đè.</p>}
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
        cols={["Ngày", "TT", "Sàn", "Shop", "Chi phí", "Ghi chú"]}
        renderRow={(r: any) => [
          r.date, r.market, platLabel(r.platform),
          r.shop || "(chưa rõ shop)", fmtMoney(r.cost), r.note || "—",
        ]}
        isActive={(r: any) => r.date === date && r.platform === platform && r.market === market && (r.shop ?? "") === shop}
        onPick={(r: any) => {
          setDate(r.date); setPlatform(r.platform); setMarket(r.market); setShop(r.shop ?? "")
          setCost(String(r.cost ?? "")); setNote(r.note ?? "")
        }}
        moneyCol={4}
      />
    </div>
  )
}

// ─── Tổng hợp & kiểm tra (cho quản lý) ───────────────────────────────────────
function TongHopTab() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [from, setFrom] = useState(daysAgoVN(30))
  const [to, setTo] = useState(todayVN())
  const [fMarket, setFMarket] = useState("")
  const [fPlatform, setFPlatform] = useState("")

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const q = new URLSearchParams({ from, to })
      if (fMarket) q.set("market", fMarket)
      if (fPlatform) q.set("platform", fPlatform)
      const d = await apiJson(`/admin/pancake-sync/report/mkt-cost-marketplace?${q}`)
      setData(d)
    } catch (e: any) { setErr(e.message) } finally { setLoading(false) }
  }, [from, to, fMarket, fPlatform])
  useEffect(() => { load() }, [load])

  const rows: any[] = data?.rows ?? []
  const missing: any[] = data?.missing ?? []
  const grand = rows.reduce((s, r) => s + Number(r.cost || 0), 0)
  const isAdminView = !!data?.is_admin

  return (
    <div className="space-y-4">
      {data && !isAdminView && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-[12px] text-gray-600">
          👤 Bạn đang xem <b>chi phí do chính bạn điền</b>. Quản lý xem được của tất cả mọi người.
        </div>
      )}
      <div className="bg-white border rounded-xl p-4 shadow-sm">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label="Từ ngày"><input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} /></Field>
          <Field label="Đến ngày"><input type="date" value={to} max={todayVN()} onChange={e => setTo(e.target.value)} className={inputCls} /></Field>
          <Field label="Thị trường">
            <select value={fMarket} onChange={e => setFMarket(e.target.value)} className={inputCls}>
              <option value="">Tất cả</option>
              {MARKETS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </Field>
          <Field label="Sàn">
            <select value={fPlatform} onChange={e => setFPlatform(e.target.value)} className={inputCls}>
              <option value="">Tất cả</option>
              {PLATFORMS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </Field>
        </div>
      </div>

      {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">⚠ {err}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {(data?.totals ?? []).map((t: any) => {
          const p = PLATFORMS.find(x => x.key === t.platform)
          return (
            <div key={`${t.platform}-${t.market}`} className="bg-white border rounded-xl p-4 shadow-sm"
              style={{ borderTop: `3px solid ${p?.color ?? "#666666"}` }}>
              <div className="text-xs text-gray-500 uppercase tracking-wide">{p?.label ?? t.platform} · {t.market}</div>
              <div className="text-xl font-bold mt-1 text-gray-900">{fmtMoney(t.cost)}</div>
              <div className="text-xs text-gray-400 mt-0.5">{t.days} ngày · {t.entries} dòng</div>
            </div>
          )
        })}
      </div>

      <div className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
        <b>Tổng chi phí sàn trong kỳ: {fmtMoney(grand)}</b>
        <span className="text-violet-700"> · {rows.length} dòng đã điền</span>
      </div>

      {/* Cảnh báo bỏ sót — kênh có đơn nhưng chưa điền chi phí ngày đó */}
      <div className="bg-white border rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold text-gray-800 text-sm">⚠ Kênh có đơn nhưng chưa điền chi phí</h3>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Chỉ liệt kê kênh có từ 3 đơn/ngày trở lên — bỏ qua ngày lẻ tẻ vài đơn.
            </p>
          </div>
          <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
            missing.length === 0 ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
            {missing.length === 0 ? "Đủ hết" : `${missing.length} kênh-ngày thiếu`}
          </span>
        </div>
        <div className="overflow-x-auto max-h-[320px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b text-xs text-gray-500 sticky top-0">
              <tr>
                <th className="px-4 py-2 text-left">Ngày</th>
                <th className="px-4 py-2 text-left">TT</th>
                <th className="px-4 py-2 text-left">Sàn</th>
                <th className="px-4 py-2 text-left">Shop</th>
                <th className="px-4 py-2 text-right">Số đơn</th>
              </tr>
            </thead>
            <tbody className="divide-y text-gray-900">
              {!loading && missing.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-green-600">✓ Mọi kênh có đơn đều đã điền chi phí</td></tr>
              )}
              {missing.map((m, i) => (
                <tr key={i} className="bg-amber-50/40">
                  <td className="px-4 py-2 font-mono">{m.date}</td>
                  <td className="px-4 py-2">{m.market}</td>
                  <td className="px-4 py-2">{platLabel(m.platform)}</td>
                  <td className="px-4 py-2">{m.shop || "(không tên)"}</td>
                  <td className="px-4 py-2 text-right font-mono">{m.orders}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Toàn bộ dòng đã điền — truy vết ai điền, khi nào */}
      <div className="bg-white border rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b text-sm font-semibold text-gray-700">
          Chi tiết đã điền {loading && <span className="font-normal text-gray-400">· đang tải…</span>}
        </div>
        <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b text-xs text-gray-500 sticky top-0">
              <tr>
                <th className="px-4 py-2 text-left">Ngày</th>
                <th className="px-4 py-2 text-left">TT</th>
                <th className="px-4 py-2 text-left">Sàn</th>
                <th className="px-4 py-2 text-left">Shop</th>
                <th className="px-4 py-2 text-right">Chi phí</th>
                {isAdminView && <th className="px-4 py-2 text-left">Người điền</th>}
                <th className="px-4 py-2 text-left">Ghi chú</th>
              </tr>
            </thead>
            <tbody className="divide-y text-gray-900">
              {!loading && rows.length === 0 && (
                <tr><td colSpan={isAdminView ? 7 : 6} className="px-4 py-6 text-center text-sm text-gray-400">Chưa có dữ liệu trong kỳ</td></tr>
              )}
              {rows.map((r, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono">{r.date}</td>
                  <td className="px-4 py-2">{r.market}</td>
                  <td className="px-4 py-2">{platLabel(r.platform)}</td>
                  <td className="px-4 py-2">{r.shop || <span className="text-gray-400">(chưa rõ shop)</span>}</td>
                  <td className="px-4 py-2 text-right font-semibold">{fmtMoney(r.cost)}</td>
                  {isAdminView && <td className="px-4 py-2 text-[11px] text-gray-500">{r.created_by || "—"}</td>}
                  <td className="px-4 py-2 text-[11px] text-gray-500">{r.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
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

function HistoryTable({ title, loading, rows, cols, renderRow, isActive, onPick, moneyCol = 2 }: {
  title: string; loading: boolean; rows: any[]; cols: string[]
  renderRow: (r: any) => (string | number)[]
  isActive: (r: any) => boolean
  onPick: (r: any) => void
  moneyCol?: number
}) {
  return (
    <div className="bg-white border rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b text-sm font-semibold text-gray-700">
        {title} {loading && <span className="font-normal text-gray-400">· đang tải…</span>}
      </div>
      <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b text-xs text-gray-500 sticky top-0">
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
                  <td key={j} className={`px-4 py-2 ${j === 0 ? "font-mono" : ""} ${j === moneyCol ? "font-semibold" : ""}`}>{cell}</td>
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
