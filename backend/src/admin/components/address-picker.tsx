import { useEffect, useMemo, useState } from "react"
import { apiFetch } from "../lib/api-client"

// Delivery address picker for the sale order card. POS only accepts the NEW address (34
// provinces, ward/commune, no district). Customers often give the OLD one (63 provinces,
// district, commune), so the sale can pick the old address and we convert it through
// Pancake's own old→new mapping. ~15% of old communes have no mapping: POS silently ignores
// those, so the sale must pick the new ward by hand.

export type AddressValue = { provinceId: string; communeId: string; provinceName?: string; communeName?: string }

const fold = (s: string) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d")
const bare = (s: string) => fold(s).replace(/^(tinh|thanh pho|tp\.?|phuong|xa|thi tran|thi xa|quan|huyen|dac khu)\s+/, "").trim()
const textHas = (text: string, name: string) => { const b = bare(name); return b.length > 2 && new RegExp(`(^|[^a-z0-9])${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(text) }

const geoCache = new Map<string, Promise<any>>()
const geo = (q: string) => {
  if (!geoCache.has(q)) geoCache.set(q, apiFetch(`/admin/pancake-sync/call-board/geo${q}`).then((r) => r.json()).catch(() => ({})))
  return geoCache.get(q)!
}

// Abbreviations customers use for the big cities.
const ALIASES: [RegExp, string][] = [
  [/(^|[^a-z0-9])(tp\.?\s*hcm|tphcm|hcm|sai gon|sg)([^a-z0-9]|$)/g, "$1ho chi minh$3"],
  [/(^|[^a-z0-9])(hn|tp\.?\s*hn)([^a-z0-9]|$)/g, "$1ha noi$3"],
  [/(^|[^a-z0-9])(dn|tp\.?\s*dn)([^a-z0-9]|$)/g, "$1da nang$3"],
  [/(^|[^a-z0-9])(hp)([^a-z0-9]|$)/g, "$1hai phong$3"],
]
const expandAliases = (t: string) => ALIASES.reduce((s, [re, to]) => s.replace(re, to), t)

export type Suggestion = { from: string; provinceId: string; communeId: string; provinceName: string; communeName: string }

/**
 * Read the customer's free text. A full old match (province + district + commune) is the
 * strongest evidence, so it wins; otherwise a new ward inside a named province. A ward named
 * like its province ("Lào Cai") is skipped — the text usually only names the province.
 */
export async function suggestFrom(raw: string): Promise<Suggestion | null> {
  const text = expandAliases(fold(raw))
  if (!text.trim()) return null
  const { provinces: newProv = [] } = await geo("")
  const { provinces: oldProv = [] } = await geo("?old=1")
  const old = await suggestOld(text, newProv, oldProv)
  if (old) return old
  for (const p of newProv.filter((x: any) => textHas(text, x.name))) {
    const { communes = [] } = await geo(`?province_id=${p.id}`)
    const c = communes.find((x: any) => bare(x.name) !== bare(p.name) && textHas(text, x.name))
    if (c) return { from: `${c.name}, ${p.name}`, provinceId: p.id, communeId: c.id, provinceName: p.name, communeName: c.name }
  }
  return null
}

async function suggestOld(text: string, newProv: any[], oldProv: any[]): Promise<Suggestion | null> {
  for (const p of oldProv.filter((x: any) => textHas(text, x.name) && x.new_id)) {
    const { districts = [] } = await geo(`?old=1&province_id=${p.id}`)
    for (const d of districts.filter((x: any) => textHas(text, x.name))) {
      const { communes = [] } = await geo(`?old=1&district_id=${d.id}`)
      const c = communes.find((x: any) => textHas(text, x.name))
      if (!c?.new_id) continue
      const { communes: news = [] } = await geo(`?province_id=${p.new_id}`)
      const nc = news.find((x: any) => x.id === c.new_id)
      const np = newProv.find((x: any) => x.id === p.new_id)
      if (nc && np) return { from: `${c.name}, ${d.name}, ${p.name} (cũ)`, provinceId: np.id, communeId: nc.id, provinceName: np.name, communeName: nc.name }
    }
  }
  return null
}

/**
 * pickerOnly: the order card shows the customer's text + suggestion in its "Địa chỉ giao"
 * check box, so the picker renders just the mode switch and the selects.
 */
export default function AddressPicker({ rawText, value, onChange, disabled, pickerOnly }: {
  rawText: string; value: AddressValue; onChange: (v: AddressValue) => void; disabled?: boolean; pickerOnly?: boolean
}) {
  const [mode, setMode] = useState<"new" | "old">("new")
  const [provinces, setProvinces] = useState<any[]>([])
  const [communes, setCommunes] = useState<any[]>([])
  const [q, setQ] = useState("")
  const [sugg, setSugg] = useState<Suggestion | null>(null)
  const [suggLoading, setSuggLoading] = useState(false)
  // Old address state
  const [oldProv, setOldProv] = useState<any[]>([])
  const [oldP, setOldP] = useState("")
  const [districts, setDistricts] = useState<any[]>([])
  const [oldD, setOldD] = useState("")
  const [oldCommunes, setOldCommunes] = useState<any[]>([])
  const [oldQ, setOldQ] = useState("")
  const [unmapped, setUnmapped] = useState<string | null>(null)

  useEffect(() => { geo("").then((d) => setProvinces(d.provinces ?? [])) }, [])
  useEffect(() => {
    if (!value.provinceId) return setCommunes([])
    geo(`?province_id=${value.provinceId}`).then((d) => setCommunes(d.communes ?? []))
  }, [value.provinceId])
  useEffect(() => {
    if (value.communeId || disabled || pickerOnly) return
    setSuggLoading(true)
    suggestFrom(rawText).then(setSugg).finally(() => setSuggLoading(false))
  }, [rawText])
  useEffect(() => { if (mode === "old" && !oldProv.length) geo("?old=1").then((d) => setOldProv(d.provinces ?? [])) }, [mode])
  useEffect(() => { setDistricts([]); setOldD(""); if (oldP) geo(`?old=1&province_id=${oldP}`).then((d) => setDistricts(d.districts ?? [])) }, [oldP])
  useEffect(() => { setOldCommunes([]); if (oldD) geo(`?old=1&district_id=${oldD}`).then((d) => setOldCommunes(d.communes ?? [])) }, [oldD])

  const province = provinces.find((p) => p.id === value.provinceId)
  const commune = communes.find((c) => c.id === value.communeId)
  const set = (provinceId: string, communeId: string, provinceName?: string, communeName?: string) =>
    onChange({ provinceId, communeId, provinceName, communeName })

  const pickOld = async (c: any) => {
    setOldQ("")
    const p = oldProv.find((x) => x.id === oldP)
    if (!c.new_id || !p?.new_id) {
      setUnmapped(`${c.name} (cũ) đã sáp nhập nhưng POS không tự đổi được — chọn phường/xã mới bên dưới.`)
      setMode("new")
      if (p?.new_id) set(p.new_id, "", provinces.find((x) => x.id === p.new_id)?.name)
      return
    }
    const { communes: news = [] } = await geo(`?province_id=${p.new_id}`)
    const nc = news.find((x: any) => x.id === c.new_id)
    setUnmapped(null)
    set(p.new_id, c.new_id, provinces.find((x) => x.id === p.new_id)?.name, nc?.name)
    setMode("new")
  }

  const filteredOld = useMemo(() => oldCommunes.filter((c) => fold(c.name).includes(fold(oldQ))).slice(0, 40), [oldCommunes, oldQ])

  return (
    <div>
      {!pickerOnly && <>
      <div className="text-xs text-gray-500">Khách ghi</div>
      <div className="text-sm mb-2">{rawText || "—"}</div>
      {!value.communeId && <div className="text-xs text-red-600 mb-2">⚠ Chưa chọn phường/xã — kho không giao được</div>}
      </>}
      {!pickerOnly && !disabled && !value.communeId && (suggLoading
        ? <div className="mb-2 text-xs text-gray-400">Đang đọc địa chỉ khách ghi...</div>
        : sugg && (
          <div className="mb-2 p-2 rounded bg-violet-50 text-violet-800 text-sm flex justify-between items-center gap-2">
            <span>Gợi ý: <b>{sugg.communeName}, {sugg.provinceName}</b>{sugg.from.includes("(cũ)") && <span className="block text-xs text-violet-600">đọc theo địa chỉ cũ: {sugg.from}</span>}</span>
            <button onClick={() => set(sugg.provinceId, sugg.communeId, sugg.provinceName, sugg.communeName)} className="px-2 py-0.5 border border-violet-400 rounded text-xs bg-white">Dùng</button>
          </div>
        ))}
      {unmapped && <div className="mb-2 p-2 rounded bg-yellow-50 text-yellow-800 text-xs">{unmapped}</div>}

      {!disabled && (
        <div className="inline-flex border rounded overflow-hidden text-xs mb-2">
          <button onClick={() => setMode("new")} className={`px-3 py-1 ${mode === "new" ? "bg-violet-600 text-white" : ""}`}>Địa chỉ mới (34 tỉnh)</button>
          <button onClick={() => setMode("old")} className={`px-3 py-1 border-l ${mode === "old" ? "bg-violet-600 text-white" : ""}`}>Địa chỉ cũ (63 tỉnh)</button>
        </div>
      )}

      {mode === "new" ? (
        <>
          <label className="text-sm block">Tỉnh / thành
            <select disabled={disabled} value={value.provinceId} onChange={(e) => set(e.target.value, "", provinces.find((p) => p.id === e.target.value)?.name)} className="w-full border rounded px-2 py-1.5">
              <option value="">— Chọn tỉnh —</option>
              {provinces.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="text-sm block mt-2">Phường / xã
            <input disabled={disabled || !value.provinceId} value={q} onChange={(e) => setQ(e.target.value)} placeholder={commune ? commune.name : "Gõ không dấu để tìm: bai chay"} className="w-full border rounded px-2 py-1.5" />
          </label>
          {q && (
            <div className="border rounded mt-1 max-h-40 overflow-y-auto">
              {communes.filter((c) => fold(c.name).includes(fold(q))).slice(0, 30).map((c) => (
                <button key={c.id} onClick={() => { set(value.provinceId, c.id, province?.name, c.name); setQ(""); setUnmapped(null) }} className="block w-full text-left px-2 py-1 text-sm hover:bg-violet-50">{c.name}</button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <label className="text-sm block">Tỉnh / thành (cũ)
            <select value={oldP} onChange={(e) => setOldP(e.target.value)} className="w-full border rounded px-2 py-1.5">
              <option value="">— Chọn tỉnh cũ —</option>
              {oldProv.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="text-sm block mt-2">Quận / huyện
            <select disabled={!oldP} value={oldD} onChange={(e) => setOldD(e.target.value)} className="w-full border rounded px-2 py-1.5">
              <option value="">— Chọn quận/huyện —</option>
              {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <label className="text-sm block mt-2">Phường / xã (cũ)
            <input disabled={!oldD} value={oldQ} onChange={(e) => setOldQ(e.target.value)} placeholder="Gõ không dấu để tìm: son duong" className="w-full border rounded px-2 py-1.5" />
          </label>
          {oldD && (
            <div className="border rounded mt-1 max-h-40 overflow-y-auto">
              {filteredOld.map((c) => (
                <button key={c.id} onClick={() => pickOld(c)} className="flex w-full justify-between gap-2 text-left px-2 py-1 text-sm hover:bg-violet-50">
                  <span>{c.name}</span>
                  <span className="text-xs text-gray-400">{c.new_id ? "→ đổi sang địa chỉ mới" : "chưa có địa chỉ mới"}</span>
                </button>
              ))}
            </div>
          )}
          <div className="text-xs text-gray-500 mt-1">Chọn xong, hệ thống tự đổi sang địa chỉ mới để lưu lên POS.</div>
        </>
      )}
      {commune && <div className="text-xs text-green-700 mt-1">✓ Lưu lên POS: {commune.name}, {province?.name}</div>}
    </div>
  )
}
