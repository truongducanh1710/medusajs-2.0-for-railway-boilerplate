"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { HttpTypes } from "@medusajs/types"
import { useParams } from "next/navigation"
import { prepareGroupCheckout } from "@lib/data/cart"
import SimpleCheckout from "@modules/checkout/templates/simple-checkout"
import { ICEGEL, tierFor, nextTier } from "@lib/bundle-groups"
import type { IcegelItem } from "../data"
import { formatVND } from "./format"

type Props = {
  items: IcegelItem[]
  qty: Record<string, number>
  onQty: (variantId: string, next: number) => void
  giftPicks: string[]
  onGiftPick: (index: number, key: string) => void
  onClose: () => void
}

/**
 * ICEgel order sheet: the customer's box picks are synced to the cart in the background
 * (server prices them and writes tier fee + gifts) while they fill the SimpleCheckout form.
 */
export default function IcegelCheckout({ items, qty, onQty, giftPicks, onGiftPick, onClose }: Props) {
  const params = useParams()
  const countryCode = (params.countryCode as string) || "vn"
  const [cart, setCart] = useState<HttpTypes.StoreCart | null>(null)
  const [syncing, setSyncing] = useState(true)
  const [syncError, setSyncError] = useState("")
  const chainRef = useRef<Promise<any>>(Promise.resolve(null))
  const seqRef = useRef(0)

  const picked = items.filter((item) => (qty[item.variantId] ?? 0) > 0)
  const boxes = picked.reduce((sum, item) => sum + qty[item.variantId], 0)
  const goods = picked.reduce((sum, item) => sum + item.price * qty[item.variantId], 0)
  const tier = tierFor(boxes)
  const next = nextTier(boxes)
  const packs = Math.floor(tier.giftPatches / ICEGEL.giftPackSize)

  const lines = picked.map((item) => ({ variant_id: item.variantId, quantity: qty[item.variantId] }))
  const picks = giftPicks.slice(0, packs)
  const syncKey = JSON.stringify([lines, picks])

  const sync = useCallback(() => {
    const seq = ++seqRef.current
    setSyncing(true)
    setSyncError("")
    const payload = JSON.parse(syncKey) as [typeof lines, string[]]
    const run = chainRef.current
      .catch(() => null)
      .then(async () => {
        if (seq !== seqRef.current) return null
        // Wait a beat so quick +/− taps collapse into one request
        await new Promise((resolve) => setTimeout(resolve, 350))
        if (seq !== seqRef.current) return null
        const fresh = await prepareGroupCheckout({ group: ICEGEL.key, countryCode, items: payload[0], giftPicks: payload[1] })
        if (seq === seqRef.current) {
          setCart(fresh)
          setSyncing(false)
        }
        return null
      })
    run.catch((error) => {
      console.error("[IcegelCheckout] cart sync failed", error)
      if (seq === seqRef.current) {
        setSyncing(false)
        setSyncError(error instanceof Error ? error.message : "Chưa cập nhật được giỏ hàng")
      }
    })
    chainRef.current = run
  }, [syncKey, countryCode])

  useEffect(() => {
    if (lines.length) sync()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncKey])

  // Wait for the latest sync before submitting; a sync still pending means the chain changed
  const ensureReady = useCallback(async () => {
    let current: Promise<any>
    do {
      current = chainRef.current
      await current.catch(() => null)
    } while (current !== chainRef.current)
    return null
  }, [])

  // Back button closes the sheet instead of leaving the page (FB/Zalo in-app browsers)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const pushedRef = useRef(false)
  useEffect(() => {
    window.history.pushState({ pvCheckout: true }, "")
    pushedRef.current = true
    const onPop = () => {
      pushedRef.current = false
      onCloseRef.current()
    }
    window.addEventListener("popstate", onPop)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("popstate", onPop)
      document.body.style.overflow = prevOverflow
    }
  }, [])
  const requestClose = () => (pushedRef.current ? window.history.back() : onClose())

  const picker = (
    <div className="space-y-2.5">
      <p className="font-black text-sm text-gray-900">Sản phẩm đã chọn</p>
      {picked.length === 0 && <p className="text-sm text-gray-500">Chưa chọn hộp nào.</p>}
      {picked.map((item) => (
        <div key={item.variantId} className="flex items-center gap-2.5">
          <img src={item.thumb} alt="" className="w-12 h-12 rounded-lg object-cover border border-gray-100 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold text-gray-900 leading-snug line-clamp-2">{item.short}</p>
            <p className="text-[12px] text-gray-500">{formatVND(item.price)} / hộp</p>
          </div>
          <Stepper value={qty[item.variantId]} onChange={(n) => onQty(item.variantId, n)} label={item.short} />
        </div>
      ))}

      <div className="rounded-xl bg-sky-50 border border-sky-100 px-3 py-2.5">
        {packs > 0 ? (
          <>
            <p className="text-[13px] font-black text-sky-900">🎁 Quà tặng: {tier.giftPatches} miếng — chọn loại bạn thích</p>
            <div className="mt-2 space-y-1.5">
              {Array.from({ length: packs }, (_, i) => (
                <label key={i} className="flex items-center gap-2 text-[13px] text-gray-700">
                  <span className="w-16 flex-shrink-0 font-semibold">{ICEGEL.giftPackSize} miếng</span>
                  <select
                    value={giftPicks[i] ?? ICEGEL.giftChoices[0].key}
                    onChange={(event) => onGiftPick(i, event.target.value)}
                    className="flex-1 min-w-0 rounded-lg border border-sky-200 bg-white px-2 py-1.5 text-[13px] font-semibold"
                  >
                    {ICEGEL.giftChoices.map((choice) => (
                      <option key={choice.key} value={choice.key}>{choice.short}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </>
        ) : (
          <p className="text-[13px] font-semibold text-sky-900">Mua từ 2 hộp để được tặng miếng dán.</p>
        )}
        {next && (
          <p className="mt-2 text-[12px] font-bold text-orange-600">
            Thêm {next.minBoxes - boxes} hộp: tặng {next.giftPatches} miếng{next.fee === 0 && tier.fee > 0 ? " + miễn phí ship" : ""}
          </p>
        )}
      </div>
      {syncError && (
        <p className="text-xs text-red-600 font-semibold">
          {syncError} — <button className="underline" onClick={sync}>thử lại</button>
        </p>
      )}
    </div>
  )

  return createPortal(
    <div className="fixed inset-0 flex items-end sm:items-center justify-center" style={{ zIndex: 10000 }}>
      <div className="absolute inset-0 bg-black/50" onClick={requestClose} />
      <div
        className="relative w-full sm:max-w-lg bg-gray-50 rounded-t-2xl sm:rounded-2xl overflow-y-auto overscroll-contain shadow-2xl"
        style={{ maxHeight: "92dvh" }}
        role="dialog"
        aria-modal="true"
        aria-label="Đặt hàng ICEgel"
      >
        <SimpleCheckout
          cart={cart}
          shippingOptions={null}
          embedded
          onClose={requestClose}
          bundlePicker={picker}
          bundleVariantIds={items.map((item) => item.variantId)}
          pendingBundlePrice={goods}
          pendingShippingFee={tier.fee}
          pendingPaymentDiscount={0}
          syncing={syncing || picked.length === 0}
          ensureReady={ensureReady}
        />
      </div>
    </div>,
    document.body
  )
}

export function Stepper({ value, onChange, label, size = "sm" }: { value: number; onChange: (next: number) => void; label: string; size?: "sm" | "lg" }) {
  const box = size === "lg" ? "w-10 h-10 text-xl" : "w-8 h-8 text-lg"
  return (
    <div className="flex items-center rounded-full border border-gray-200 bg-white flex-shrink-0">
      <button type="button" aria-label={`Bớt 1 hộp ${label}`} onClick={() => onChange(Math.max(0, value - 1))} className={`${box} flex items-center justify-center font-bold text-gray-600 rounded-full active:bg-gray-100`}>−</button>
      <output className={`min-w-[1.75rem] text-center font-black text-gray-900 ${size === "lg" ? "text-base" : "text-sm"}`} aria-live="polite">{value}</output>
      <button type="button" aria-label={`Thêm 1 hộp ${label}`} onClick={() => onChange(Math.min(ICEGEL.maxBoxes, value + 1))} className={`${box} flex items-center justify-center font-bold text-sky-700 rounded-full active:bg-sky-50`}>+</button>
    </div>
  )
}
