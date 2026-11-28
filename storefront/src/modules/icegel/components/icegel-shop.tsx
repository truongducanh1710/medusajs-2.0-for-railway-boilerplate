"use client"

import { useEffect, useMemo, useState } from "react"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { generateEventId } from "@lib/pixel"
import { trackFunnel } from "@lib/funnel"
import CheckoutTracker from "@components/CheckoutTracker"
import PromoOverride from "@components/PromoOverride"

// Site banner says "free ship for every order" and "12-month warranty" — both wrong for ICEgel
const ICEGEL_PROMO = [
  "🎁 Mua 2 hộp ICEgel bất kỳ — tặng 2 miếng dán",
  "🚚 Từ 3 hộp: tặng 4 miếng + miễn phí giao hàng",
  "📦 Nhận hàng, kiểm tra rồi mới trả tiền",
]
import { ICEGEL, SLUG_TO_GIFT, nextTier, tierFor } from "@lib/bundle-groups"
import { LINES, type IcegelItem } from "../data"
import IcegelCheckout, { Stepper } from "./icegel-checkout"
import { formatK, formatVND } from "./format"

const STORAGE_KEY = "pv_icegel_pick_v1"

type Props = {
  items: IcegelItem[]
  // Product detail page: this product is pre-selected with 1 box on first visit
  focus?: IcegelItem
  // "grid" = full shop with filters; "addons" = compact "mua kèm" list on a product page
  mode?: "grid" | "addons"
}

export default function IcegelShop({ items, focus, mode = "grid" }: Props) {
  const [qty, setQty] = useState<Record<string, number>>({})
  const [giftPicks, setGiftPicks] = useState<string[]>([])
  const [line, setLine] = useState("all")
  const [open, setOpen] = useState(false)
  const [everOpened, setEverOpened] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // Picks survive moving between /icegel and product pages
  useEffect(() => {
    let saved: { qty?: Record<string, number>; gifts?: string[] } = {}
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")
    } catch {}
    const known = new Set(items.map((item) => item.variantId))
    const restored = Object.fromEntries(Object.entries(saved.qty ?? {}).filter(([id, n]) => known.has(id) && Number(n) > 0).map(([id, n]) => [id, Math.min(ICEGEL.maxBoxes, Number(n))]))
    if (focus && !restored[focus.variantId]) restored[focus.variantId] = 1
    setQty(restored)
    setGiftPicks(Array.isArray(saved.gifts) ? saved.gifts.filter((g) => typeof g === "string") : [])
    setLoaded(true)
  }, [items, focus])

  useEffect(() => {
    if (!loaded) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ qty, gifts: giftPicks }))
    } catch {}
  }, [qty, giftPicks, loaded])

  const picked = items.filter((item) => (qty[item.variantId] ?? 0) > 0)
  const boxes = picked.reduce((sum, item) => sum + qty[item.variantId], 0)
  const goods = picked.reduce((sum, item) => sum + item.price * qty[item.variantId], 0)
  const tier = tierFor(boxes)
  const next = nextTier(boxes)

  // Default gift suggestions: types the customer is not buying yet
  const defaultPicks = useMemo(() => {
    const bought = new Set(picked.map((item) => SLUG_TO_GIFT[item.slug]))
    const fresh = ICEGEL.giftChoices.filter((choice) => !bought.has(choice.key)).map((choice) => choice.key)
    return fresh.length ? fresh : ICEGEL.giftChoices.map((choice) => choice.key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked.map((item) => item.slug).join(",")])
  const effectivePicks = Array.from({ length: 3 }, (_, i) => giftPicks[i] ?? defaultPicks[i % defaultPicks.length])

  const setOne = (variantId: string, n: number) => {
    const item = items.find((entry) => entry.variantId === variantId)
    const before = qty[variantId] ?? 0
    setQty((prev) => {
      const nextQty = { ...prev }
      if (n <= 0) delete nextQty[variantId]
      else nextQty[variantId] = Math.min(ICEGEL.maxBoxes, n)
      return nextQty
    })
    if (item && n > before) {
      // "icegel_add" was not an accepted funnel event and had no handle, so it was always dropped
      trackFunnel("variant_select", item.slug, { repeat: true, handle: focus?.handle || item.handle })
      if (typeof window !== "undefined" && window.fbq) {
        window.fbq("track", "AddToCart", {
          content_ids: [variantId], content_name: item.title, content_type: "product",
          value: item.price, currency: "VND", num_items: 1,
        }, { eventID: generateEventId() })
      }
    }
  }

  const openCheckout = () => {
    if (!boxes) return
    setOpen(true)
    setEverOpened(true)
  }

  // Product page: the viewed product first (its own stepper), then the add-ons
  const visible = mode === "addons"
    ? [...items].sort((a, b) => Number(b.variantId === focus?.variantId) - Number(a.variantId === focus?.variantId))
    : items.filter((item) => line === "all" || item.line === line)

  return (
    <>
      <PromoOverride messages={ICEGEL_PROMO} />
      {mode === "grid" && (
        <div className="sticky top-0 z-20 -mx-4 px-4 py-2 bg-white/95 backdrop-blur border-b border-gray-100 flex gap-2 overflow-x-auto no-scrollbar" role="tablist" aria-label="Lọc theo nhóm">
          {[{ key: "all", label: "Tất cả" }, ...LINES].map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={line === entry.key}
              onClick={() => setLine(entry.key)}
              className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-[13px] font-bold border transition-colors ${line === entry.key ? "bg-sky-700 border-sky-700 text-white" : "bg-white border-gray-200 text-gray-700"}`}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}

      {mode === "grid" ? (
        <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mt-3">
          {visible.map((item) => (
            <li key={item.variantId} className="rounded-2xl border border-gray-100 bg-white overflow-hidden flex flex-col shadow-sm">
              <LocalizedClientLink href={`/icegel/${item.slug}`} className="block relative aspect-square bg-gray-50">
                <img src={item.thumb} alt={item.title} loading="lazy" className="absolute inset-0 w-full h-full object-contain p-2" />
                {item.badges[0] && (
                  <span className={`absolute top-2 left-2 text-[10px] font-black px-2 py-0.5 rounded-full ${item.badges[0] === "Bán chạy" ? "bg-orange-500 text-white" : "bg-white/90 text-sky-800 border border-sky-100"}`}>{item.badges[0]}</span>
                )}
              </LocalizedClientLink>
              <div className="p-2.5 flex flex-col flex-1">
                <LocalizedClientLink href={`/icegel/${item.slug}`} className="text-[13px] font-black text-gray-900 leading-snug line-clamp-2 hover:text-sky-700">{item.short}</LocalizedClientLink>
                <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-1">{item.pack}</p>
                <p className="text-[12px] text-gray-600 mt-1 line-clamp-2 leading-snug">{item.benefits[0]}</p>
                <div className="mt-auto pt-2 flex items-center justify-between gap-1">
                  <span className="leading-tight">
                    <span className="font-black text-[15px] text-orange-600">{formatK(item.price)}</span>
                    {item.compareAt > 0 && <s className="block text-[11px] text-gray-400">{formatK(item.compareAt)}</s>}
                  </span>
                  {(qty[item.variantId] ?? 0) > 0 ? (
                    <Stepper value={qty[item.variantId]} onChange={(n) => setOne(item.variantId, n)} label={item.short} />
                  ) : (
                    <button type="button" onClick={() => setOne(item.variantId, 1)} className="px-3 py-1.5 rounded-full bg-sky-700 text-white text-[12px] font-black active:scale-95">+ Thêm</button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-2xl border border-gray-100 bg-white">
          {visible.map((item) => (
            <li key={item.variantId} className={`flex items-center gap-3 p-2.5 ${item.variantId === focus?.variantId ? "bg-sky-50 rounded-t-2xl" : ""}`}>
              <LocalizedClientLink href={`/icegel/${item.slug}`} className="w-14 h-14 flex-shrink-0 rounded-lg bg-gray-50 overflow-hidden">
                <img src={item.thumb} alt={item.title} loading="lazy" className="w-full h-full object-contain" />
              </LocalizedClientLink>
              <div className="flex-1 min-w-0">
                <LocalizedClientLink href={`/icegel/${item.slug}`} className="text-[13px] font-bold text-gray-900 line-clamp-1">{item.short}</LocalizedClientLink>
                <p className="text-[12px] text-gray-500 line-clamp-1">{item.pack} · <span className="font-bold text-orange-600">{formatK(item.price)}</span>{item.compareAt > 0 && <s className="ml-1 text-gray-400">{formatK(item.compareAt)}</s>}</p>
              </div>
              {(qty[item.variantId] ?? 0) > 0 ? (
                <Stepper value={qty[item.variantId]} onChange={(n) => setOne(item.variantId, n)} label={item.short} />
              ) : (
                <button type="button" onClick={() => setOne(item.variantId, 1)} className="px-3 py-1.5 rounded-full border border-sky-700 text-sky-700 text-[12px] font-black flex-shrink-0">+ Thêm</button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Sticky cart bar — the tier progress nudges customers to the next combo */}
      <div className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-gray-200 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="max-w-5xl mx-auto px-4 pt-2 pb-2.5">
          <TierProgress boxes={boxes} />
          <div className="flex items-center gap-3 mt-2">
            <div className="flex-1 min-w-0">
              <p className="text-[12px] text-gray-500 leading-tight">
                {boxes ? `${boxes} hộp${tier.giftPatches ? ` · tặng ${tier.giftPatches} miếng` : ""}` : "Chưa chọn sản phẩm"}
              </p>
              <p className="font-black text-lg text-gray-900 leading-tight">
                {formatVND(goods)}
                {boxes > 0 && <span className="ml-1.5 text-[11px] font-semibold text-gray-500">{tier.fee ? "chưa gồm ship · khách mới freeship" : "miễn phí ship"}</span>}
              </p>
            </div>
            <button
              type="button"
              disabled={!boxes}
              onClick={openCheckout}
              className="px-5 py-3 rounded-xl bg-orange-500 disabled:bg-gray-300 text-white font-black text-[15px] active:scale-[0.98] flex-shrink-0"
            >
              Đặt hàng
            </button>
          </div>
          {next && boxes > 0 && (
            <p className="mt-1 text-[12px] font-bold text-sky-800">
              Thêm {next.minBoxes - boxes} hộp bất kỳ → tặng {next.giftPatches} miếng{next.fee === 0 && tier.fee > 0 ? " + miễn phí ship" : ""}
            </p>
          )}
        </div>
      </div>
      <div className="h-32" aria-hidden="true" />

      {open && (
        <IcegelCheckout
          items={items}
          qty={qty}
          onQty={setOne}
          giftPicks={effectivePicks}
          onGiftPick={(index, key) => setGiftPicks(() => {
            const nextPicks = [...effectivePicks]
            nextPicks[index] = key
            return nextPicks
          })}
          onClose={() => setOpen(false)}
        />
      )}
      {everOpened && (
        <CheckoutTracker
          contentIds={picked.map((item) => item.variantId)}
          value={goods}
          currency="VND"
          numItems={boxes}
          skipProductPixelInit
        />
      )}
    </>
  )
}

export function TierProgress({ boxes }: { boxes: number }) {
  return (
    <ol className="grid grid-cols-3 gap-1.5" aria-label="Ưu đãi theo số hộp">
      {ICEGEL.tiers.filter((tier) => tier.giftPatches > 0).map((tier) => {
        const reached = boxes >= tier.minBoxes
        return (
          <li key={tier.minBoxes} className={`rounded-lg px-1.5 py-1 text-center border ${reached ? "bg-sky-700 border-sky-700 text-white" : "bg-sky-50 border-sky-100 text-sky-900"}`}>
            <span className="block text-[11px] font-black leading-tight">{tier.minBoxes} hộp</span>
            <span className="block text-[10px] font-semibold leading-tight opacity-90">tặng {tier.giftPatches} miếng{tier.fee === 0 ? " · free ship" : ""}</span>
          </li>
        )
      })}
    </ol>
  )
}
