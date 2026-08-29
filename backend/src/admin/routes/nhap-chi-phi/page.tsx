import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useEffect, useState, useCallback, useMemo, useRef, Fragment } from "react"
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

/**
 * Nhớ lựa chọn qua các lần F5 (tab đang mở, sàn/thị trường/shop, bộ lọc kỳ).
 * CHỦ Ý không nhớ ô số tiền và ghi chú: số của hôm qua nổi lại trong form của
 * hôm nay là cách nhanh nhất để lưu nhầm chi phí.
 * Ngày cũng không nhớ — mặc định luôn là hôm nay, đúng với việc điền hằng ngày.
 */
function useSticky<T extends string = string>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => {
    try { return (localStorage.getItem("nhapchiphi_" + key) as T) || initial } catch { return initial }
  })
  // ref để đọc giá trị hiện tại trong callback mà không phải đưa state vào deps
  const ref = useRef(v)
  const set = useCallback((next: T) => {
    ref.current = next
    setV(next)
    try { localStorage.setItem("nhapchiphi_" + key, next) } catch { /* private mode */ }
  }, [key])
  return [v, set, ref] as const
}

function NhapChiPhiPage() {
  const [tab, setTab] = useSticky<Tab>("tab", "google")
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
      {tab === "san" && <MarketplaceAdsCostTab />}
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
  const [mktCode, setMktCode, mktCodeRef] = useSticky<string>("gg_mkt", "")
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
      // Mã đã nhớ từ lần trước thì giữ, nhưng chỉ khi còn hợp lệ (mã có thể đã đổi,
      // hoặc admin từng chọn mã người khác rồi mất quyền admin).
      const codes: string[] = d?.mkt_codes ?? []
      const remembered = mktCodeRef.current
      if (!remembered || (codes.length && !codes.includes(remembered))) {
        setMktCode(d?.my_mkt_code || codes[0] || "")
      }
    } catch (e: any) { setErr(e.message) } finally { setLoading(false) }
  }, [from, to, mktCodeRef, setMktCode])
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

// ─── Sàn TMĐT · Nhập nhanh nhiều dòng ────────────────────────────────────────
/**
 * Bảng nhập dạng danh sách (Ngày · Sản phẩm · Chi phí) — đúng cách nhân sự đang làm
 * trên Excel: điền hết SP của một ngày rồi xuống ngày tiếp theo.
 *
 * Vì sao cần: form điền lẻ mỗi lần chỉ lưu 1 ô, 5 SP × 7 ngày = 35 lần chọn-điền-lưu.
 * Ở đây gõ thẳng vào lưới, Enter xuống dòng, dán được cột số từ Excel, bấm lưu 1 lần.
 *
 * Ngày nào KHÔNG tách được theo SP thì điền dòng "Chung cả shop" — báo cáo vẫn chia
 * trung bình cho mọi đơn ngày đó, y như trước. Điền tới đâu chính xác tới đó.
 */
function MarketplaceBulkEntry({ onDone }: { onDone: () => void }) {
  const [shops, setShops] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const [platform, setPlatform] = useSticky<string>("san_platform", "tiktok")
  const [market, setMarket] = useSticky<string>("san_market", "VN")
  const [shop, setShop] = useSticky<string>("san_shop", "")

  // grid[date][product_code] = chuỗi tiền đang gõ. Mã "" = dòng "Chung cả shop".
  const [grid, setGrid] = useState<Record<string, Record<string, string>>>({})
  const [dates, setDates] = useState<string[]>([todayVN()])
  // SP hiện trong lưới — mặc định lấy SP shop đang bán, nhân sự bỏ bớt/thêm được.
  const [picked, setPicked] = useState<string[]>([])

  const from = daysAgoVN(60), to = todayVN()

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const d = await apiJson(`/admin/pancake-sync/report/mkt-cost-marketplace?from=${from}&to=${to}`)
      setShops(d?.shops ?? []); setProducts(d?.products ?? []); setRows(d?.rows ?? [])
    } catch (e: any) { setErr(e.message) } finally { setLoading(false) }
  }, [from, to])
  useEffect(() => { load() }, [load])

  const shopOptions = useMemo(
    () => shops.filter(s => s.platform === platform && s.market === market),
    [shops, platform, market])
  useEffect(() => {
    if (shop && !shopOptions.some(s => s.shop === shop)) { setShop(""); return }
    if (!shop && shopOptions.length === 1) setShop(shopOptions[0].shop)
  }, [shopOptions, shop])

  const productOptions = useMemo(
    () => products.filter(p => p.platform === platform && p.market === market && p.shop === shop),
    [products, platform, market, shop])

  // Thứ tự dòng trong 1 ngày: các SP đã chọn, rồi tới dòng "Chung cả shop".
  const allCodes = useMemo(() => [...picked, ""], [picked])

  // Đổi shop: nạp lại lưới từ số ĐÃ LƯU của shop đó, để nhân sự thấy ngay đã điền gì
  // và sửa trực tiếp — không phải nhớ hôm qua khai tới đâu.
  useEffect(() => {
    if (!shop) { setGrid({}); setPicked([]); return }
    const mine = rows.filter(r =>
      r.platform === platform && r.market === market && (r.shop ?? "") === shop)
    const g: Record<string, Record<string, string>> = {}
    for (const r of mine) {
      (g[r.date] ??= {})[r.product_code ?? ""] = String(r.cost)
    }
    setGrid(g)
    const usedDates = Object.keys(g).sort().reverse().slice(0, 14)
    setDates(usedDates.length ? usedDates : [todayVN()])
    // SP đã từng điền + SP đang bán nhiều nhất, tối đa 8 dòng cho gọn.
    const used = new Set<string>()
    for (const r of mine) if (r.product_code) used.add(r.product_code)
    for (const p of products.filter(x => x.platform === platform && x.market === market && x.shop === shop).slice(0, 8)) {
      used.add(p.product_code)
    }
    setPicked([...used])
  }, [shop, platform, market, rows, products])

  const nameOf = (code: string) =>
    code === "" ? "Chung cả shop (chia đều)"
      : (productOptions.find(p => p.product_code === code)?.product_name ?? code)

  const onlyDigits = (v: string) => v.replace(/[^0-9]/g, "")

  const setCell = (date: string, code: string, v: string) =>
    setGrid(g => ({ ...g, [date]: { ...(g[date] ?? {}), [code]: v } }))

  const dayTotal = (date: string) =>
    Object.values(grid[date] ?? {}).reduce((a, v) => a + (Number(onlyDigits(String(v))) || 0), 0)

  const addDate = () => {
    // Ngày mới = lùi 1 ngày so với ngày cũ nhất đang hiện, theo đúng nhịp điền lùi dần.
    const oldest = dates.length ? dates[dates.length - 1] : todayVN()
    const d = new Date(oldest + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 1)
    const iso = d.toISOString().slice(0, 10)
    if (!dates.includes(iso)) setDates(ds => [...ds, iso])
  }

  /** Dán 1 cột số từ Excel vào các dòng của cùng ngày, theo thứ tự đang hiện. */
  const onPaste = (date: string, startIdx: number) => (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text")
    // 1 ô đơn lẻ thì để trình duyệt dán như thường.
    if (!/[\n\t]/.test(text)) return
    e.preventDefault()
    const vals = text.split(/\r?\n/).map(x => x.trim()).filter(x => x !== "")
    setGrid(g => {
      const day = { ...(g[date] ?? {}) }
      vals.forEach((v, i) => {
        const code = allCodes[startIdx + i]
        if (code !== undefined) day[code] = onlyDigits(v)
      })
      return { ...g, [date]: day }
    })
  }

  const save = async () => {
    setSaving(true); setErr(null); setOk(null)
    try {
      const entries: any[] = []
      for (const date of dates) {
        for (const code of allCodes) {
          const raw = grid[date]?.[code]
          // Ô chưa từng chạm thì không gửi — tránh xoá nhầm số người khác đã điền.
          if (raw === undefined) continue
          entries.push({ date, product_code: code, cost: onlyDigits(String(raw)) })
        }
      }
      if (!entries.length) { setErr("Chưa điền ô nào"); return }
      const d = await apiJson("/admin/pancake-sync/report/mkt-cost-marketplace", "POST", {
        platform, market, shop, entries,
      })
      const parts = [`Đã lưu ${d?.saved ?? 0} dòng`]
      if (d?.deleted) parts.push(`xoá ${d.deleted}`)
      if (d?.skipped?.length) parts.push(`bỏ qua ${d.skipped.length} (${d.skipped[0].reason})`)
      setOk(parts.join(" · "))
      await load(); onDone()
    } catch (e: any) { setErr(e.message) } finally { setSaving(false) }
  }

  if (loading) return <div className="p-8 text-center text-gray-400 text-sm animate-pulse">Đang tải…</div>

  return (
    <div className="space-y-4">
      <div className="bg-white border rounded-xl p-4 shadow-sm space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
          </Field>
        </div>
        <div className="rounded-lg bg-blue-50 px-3 py-2 text-[12px] text-blue-800">
          💡 Gõ số rồi <b>Enter</b> để xuống dòng · <b>dán cả cột từ Excel</b> vào ô đầu của ngày ·
          ngày nào không tách được theo SP thì điền dòng <b>"Chung cả shop"</b>, báo cáo vẫn chia
          trung bình như cũ.
        </div>
      </div>

      {!shop ? (
        <div className="bg-white border rounded-xl p-8 text-center text-sm text-gray-400">
          Chọn shop để bắt đầu điền.
        </div>
      ) : (
        <>
          {productOptions.length === 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-[12.5px] text-amber-800">
              Chưa thấy sản phẩm nào có đủ đơn ở shop này trong 90 ngày — vẫn điền được dòng "Chung cả shop".
            </div>
          )}

          {/* Chọn SP nào hiện trong lưới — mỗi shop chỉ chạy vài SP, không cần đủ 51 dòng. */}
          {productOptions.length > 0 && (
            <div className="bg-white border rounded-xl p-3 shadow-sm">
              <div className="text-[11.5px] font-semibold text-gray-500 mb-2">Sản phẩm hiện trong bảng</div>
              <div className="flex flex-wrap gap-1.5">
                {productOptions.map(p => {
                  const on = picked.includes(p.product_code)
                  return (
                    <button key={p.product_code} type="button"
                      onClick={() => setPicked(ps => on ? ps.filter(c => c !== p.product_code) : [...ps, p.product_code])}
                      className={`rounded-md border px-2 py-1 text-[11.5px] font-medium ${
                        on ? "border-violet-300 bg-violet-50 text-violet-700" : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50"}`}>
                      {on ? "✓ " : "+ "}{p.product_name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div className="bg-white border rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b text-xs text-gray-500">
                  <tr>
                    <th className="text-left px-4 py-2.5 w-32">Ngày</th>
                    <th className="text-left px-3 py-2.5">Sản phẩm</th>
                    <th className="text-right px-3 py-2.5 w-44">Chi phí (VNĐ)</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {dates.map(date => {
                    const dd = new Date(date + "T00:00:00Z")
                    const wd = ["CN", "Th2", "Th3", "Th4", "Th5", "Th6", "Th7"][dd.getUTCDay()]
                    return (
                      <Fragment key={date}>
                        {allCodes.map((code, i) => (
                          <tr key={`${date}-${code}`} className={code === "" ? "bg-amber-50/40" : ""}>
                            <td className="px-4 py-1.5 text-gray-500 whitespace-nowrap">
                              {i === 0 && (
                                <span className="font-semibold text-gray-700">
                                  {date.slice(8, 10)}/{date.slice(5, 7)}
                                  <span className="ml-1 font-normal text-gray-400">({wd})</span>
                                </span>
                              )}
                            </td>
                            <td className={`px-3 py-1.5 ${code === "" ? "text-amber-700 font-medium" : "text-gray-700"}`}>
                              {nameOf(code)}
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              <input
                                value={grid[date]?.[code] ?? ""}
                                onChange={e => setCell(date, code, onlyDigits(e.target.value))}
                                onPaste={onPaste(date, i)}
                                onKeyDown={e => {
                                  if (e.key !== "Enter") return
                                  e.preventDefault()
                                  const body = e.currentTarget.closest("tbody") as HTMLElement | null
                                  if (!body) return
                                  const inputs = Array.from(body.querySelectorAll("input")) as HTMLInputElement[]
                                  const idx = inputs.indexOf(e.currentTarget)
                                  inputs[idx + 1]?.focus()
                                }}
                                inputMode="numeric" placeholder="—"
                                className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-right text-sm text-gray-900 outline-none focus:border-violet-400" />
                            </td>
                          </tr>
                        ))}
                        <tr className="bg-gray-50 border-t">
                          <td className="px-4 py-1.5" />
                          <td className="px-3 py-1.5 text-right text-[11.5px] font-semibold text-gray-500">
                            Tổng ngày {date.slice(8, 10)}/{date.slice(5, 7)}
                          </td>
                          <td className="px-3 py-1.5 text-right text-[12.5px] font-bold text-gray-900">
                            {fmtMoney(dayTotal(date))}
                          </td>
                        </tr>
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 border-t bg-gray-50/60 flex items-center gap-2 flex-wrap">
              <button type="button" onClick={addDate}
                className="rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-violet-700 hover:bg-violet-50">
                + Thêm ngày
              </button>
              <span className="text-[11.5px] text-gray-400">
                Đang hiện {dates.length} ngày × {allCodes.length} dòng
              </span>
            </div>
          </div>

          <Alerts err={err} ok={ok} />

          <button onClick={save} disabled={saving || !shop}
            className={`w-full rounded-lg px-4 py-2.5 text-sm font-bold text-white ${
              !saving && shop ? "bg-green-600 hover:bg-green-700" : "bg-gray-300 cursor-not-allowed"}`}>
            {saving ? "Đang lưu…" : "Lưu tất cả"}
          </button>
        </>
      )}
    </div>
  )
}

// ─── Sàn TMĐT ────────────────────────────────────────────────────────────────
/**
 * Tab "Sàn TMĐT" — 2 cách nhập cho cùng một dữ liệu:
 *  • Nhập nhanh (mặc định): lưới Ngày · SP · Chi phí, điền cả tuần rồi lưu 1 lần.
 *  • Điền lẻ: form từng ô như trước, giữ lại cho ai quen dùng và để xoá dòng.
 */
function MarketplaceAdsCostTab() {
  const [mode, setMode] = useState<"bulk" | "single">("bulk")
  const [reloadKey, setReloadKey] = useState(0)
  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        {([["bulk", "⚡ Nhập nhanh nhiều dòng"], ["single", "✏️ Điền lẻ từng ô"]] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setMode(k)}
            className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold ${
              mode === k ? "border-violet-600 bg-violet-600 text-white" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>
            {label}
          </button>
        ))}
      </div>
      {mode === "bulk"
        ? <MarketplaceBulkEntry key={reloadKey} onDone={() => setReloadKey(k => k + 1)} />
        : <MarketplaceAdsCost />}
    </div>
  )
}

function MarketplaceAdsCost() {
  const [rows, setRows] = useState<any[]>([])
  const [totals, setTotals] = useState<any[]>([])
  const [shops, setShops] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const [date, setDate] = useState(todayVN())
  const [platform, setPlatform] = useSticky<string>("san_platform", "tiktok")
  const [market, setMarket] = useSticky<string>("san_market", "VN")
  const [shop, setShop] = useSticky<string>("san_shop", "")
  // Mã SP (tuỳ chọn). Chọn SP = chi phí của riêng SP đó, báo cáo phân bổ đúng vào các đơn
  // chứa SP; để trống = chi phí chung cả shop, chia đều như cách cũ.
  const [productCode, setProductCode] = useState("")
  const [cost, setCost] = useState("")
  const [note, setNote] = useState("")

  const from = daysAgoVN(30), to = todayVN()

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const d = await apiJson(`/admin/pancake-sync/report/mkt-cost-marketplace?from=${from}&to=${to}`)
      setRows(d?.rows ?? []); setTotals(d?.totals ?? []); setShops(d?.shops ?? [])
      setProducts(d?.products ?? [])
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
    r.date === date && r.platform === platform && r.market === market
    && (r.shop ?? "") === shop && (r.product_code ?? "") === productCode)

  // SP đã bán trên đúng (sàn × thị trường × shop) đang chọn — lấy từ đơn thật.
  const productOptions = useMemo(
    () => products.filter(p => p.platform === platform && p.market === market && p.shop === shop),
    [products, platform, market, shop]
  )
  // Đổi shop mà SP cũ không còn bán ở đó thì bỏ chọn, tránh điền nhầm chỗ.
  useEffect(() => {
    if (productCode && !productOptions.some(p => p.product_code === productCode)) setProductCode("")
  }, [productOptions, productCode])

  // Các dòng đã điền cho đúng ngày/sàn/shop này — để thấy đã khai SP nào, còn thiếu gì.
  const sameChannelRows = rows.filter(r =>
    r.date === date && r.platform === platform && r.market === market && (r.shop ?? "") === shop)

  const save = async (del = false) => {
    setSaving(true); setErr(null); setOk(null)
    try {
      const d = await apiJson("/admin/pancake-sync/report/mkt-cost-marketplace", "PUT", {
        date, platform, market, shop, product_code: productCode,
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

        <div className="grid grid-cols-1 gap-3">
          <Field label="Sản phẩm (khuyến nghị)">
            <select value={productCode} onChange={e => setProductCode(e.target.value)}
              disabled={!shop} className={inputCls}>
              <option value="">— Chi phí chung cả shop (chia đều mọi đơn) —</option>
              {productOptions.map(p => (
                <option key={p.product_code} value={p.product_code}>
                  {p.product_name} · {p.product_code} · {p.orders} đơn
                </option>
              ))}
            </select>
            <p className="text-[11px] text-gray-500 mt-1">
              {productCode
                ? "✅ Chi phí này sẽ được tính đúng vào các đơn có sản phẩm trên — LNG từng đơn chính xác."
                : !shop
                  ? "Chọn shop trước để thấy danh sách sản phẩm."
                  : productOptions.length
                    ? "⚠ Để trống thì chi phí bị chia đều cho mọi đơn — đơn giá trị nhỏ sẽ hiện lỗ giả. Nên chọn sản phẩm."
                    : "Chưa thấy sản phẩm nào có đủ đơn ở shop này trong 90 ngày."}
            </p>
          </Field>
        </div>

        <Field label="Chi phí quảng cáo (VNĐ) — bắt buộc">
          <input value={cost} onChange={e => setCost(e.target.value)} inputMode="numeric"
            placeholder={existing ? `Đang có: ${fmtMoney(existing.cost)}` : "VD: 573363"}
            className={`${inputCls} text-base font-bold`} />
          {existing && (
            <p className="text-[11px] text-amber-600 mt-1">
              ⚠ {productCode ? "Sản phẩm này" : "Chi phí chung của shop"} ngày {date} đã có{" "}
              {fmtMoney(existing.cost)} — lưu sẽ ghi đè.
            </p>
          )}
        </Field>

        <Field label="Ghi chú (tuỳ chọn)">
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="VD: gồm cả hoa hồng Affiliate" className={inputCls} />
        </Field>

        {/* Đã điền gì cho đúng ngày/shop này — điền nhiều SP là việc lặp nhiều lần, cần
            thấy ngay đã khai xong SP nào để khỏi trùng hoặc sót. */}
        {shop && sameChannelRows.length > 0 && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
            <div className="text-[11.5px] font-semibold text-gray-600 mb-1.5">
              Đã điền cho {date} · {shop}
              <span className="ml-2 font-normal text-gray-400">
                tổng {fmtMoney(sameChannelRows.reduce((a: number, r: any) => a + Number(r.cost || 0), 0))}
              </span>
            </div>
            <div className="space-y-1">
              {sameChannelRows.map((r: any) => {
                const pr = products.find((x: any) => x.product_code === r.product_code)
                return (
                  <button key={r.product_code ?? ""} type="button"
                    onClick={() => { setProductCode(r.product_code ?? ""); setCost(String(r.cost)); setNote(r.note ?? "") }}
                    title="Bấm để sửa dòng này"
                    className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-[12px] hover:bg-white">
                    <span className={r.product_code ? "text-gray-700" : "text-amber-700"}>
                      {r.product_code
                        ? (pr?.product_name ?? r.product_code)
                        : "Chi phí chung cả shop (chia đều)"}
                    </span>
                    <span className="font-semibold text-gray-900">{fmtMoney(r.cost)}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

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

  const [from, setFrom] = useSticky<string>("tong_from", daysAgoVN(30))
  const [to, setTo] = useSticky<string>("tong_to", todayVN())
  const [fMarket, setFMarket] = useSticky<string>("tong_market", "")
  const [fPlatform, setFPlatform] = useSticky<string>("tong_platform", "")

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
