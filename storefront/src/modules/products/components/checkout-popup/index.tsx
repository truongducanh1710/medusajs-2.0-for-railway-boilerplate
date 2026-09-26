"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { HttpTypes } from "@medusajs/types"
import { prepareQuickCheckout } from "@lib/data/cart"
import SimpleCheckout from "@modules/checkout/templates/simple-checkout"

export type PopupBundleOption = {
  qty: number
  label: string
  badge?: string
  badgeColor?: string
  price: number
  originalPrice: number
  gifts?: { name: string; value: number; image?: string }[]
  image?: string
}

export type CartLineInput = Parameters<typeof prepareQuickCheckout>[0]

type Props = {
  product: HttpTypes.StoreProduct
  options: PopupBundleOption[]
  variantLabels: string[] // empty when product has a single variant
  activeVariantIdx: number
  onVariantChange: (idx: number) => void
  selected: number
  onSelect: (qty: number) => void
  // Cart line for the current pick — the popup keeps the cart in sync with it
  cartLine: CartLineInput
  onClose: () => void
}

function formatVND(amount: number) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(amount)) + "đ"
}

/**
 * Checkout popup on the product page: customer switches bundle and fills the form without
 * leaving the ad landing page. The cart is created/updated in the background while they type;
 * submit waits for the latest sync (ensureReady) and then runs the normal SimpleCheckout flow.
 */
export default function CheckoutPopup({
  product,
  options,
  variantLabels,
  activeVariantIdx,
  onVariantChange,
  selected,
  onSelect,
  cartLine,
  onClose,
}: Props) {
  const [cart, setCart] = useState<HttpTypes.StoreCart | null>(null)
  const [syncing, setSyncing] = useState(true)
  const [syncError, setSyncError] = useState(false)
  const chainRef = useRef<Promise<any[] | null>>(Promise.resolve(null))
  const seqRef = useRef(0)

  // Serialize cart syncs (delete old bundle + add new must not interleave) and skip
  // intermediate picks when the customer taps through bundles quickly
  const syncCart = useCallback((line: CartLineInput) => {
    const seq = ++seqRef.current
    setSyncing(true)
    setSyncError(false)
    const run = chainRef.current
      .catch(() => null)
      .then(async () => {
        if (seq !== seqRef.current) return null
        const res = await prepareQuickCheckout(line)
        if (seq === seqRef.current) {
          setCart(res.cart)
          setSyncing(false)
        }
        return res.shippingOptions
      })
    run.catch((err) => {
      console.error("[CheckoutPopup] cart sync failed", err)
      if (seq === seqRef.current) {
        setSyncing(false)
        setSyncError(true)
      }
    })
    chainRef.current = run
  }, [])

  const lineKey = `${cartLine.variantId}:${cartLine.quantity}`
  useEffect(() => {
    syncCart(cartLine)
    // cartLine is rebuilt every render — only resync when the pick actually changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineKey, syncCart])

  const ensureReady = useCallback(() => chainRef.current, [])

  // Back button closes the popup instead of leaving the landing page (FB/Zalo in-app browsers)
  // Track our history entry in a ref: Next's router replaceState()s right after, dropping custom keys
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const historyPushedRef = useRef(false)
  useEffect(() => {
    window.history.pushState({ pvCheckout: true }, "")
    historyPushedRef.current = true
    const onPop = () => {
      historyPushedRef.current = false
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

  const requestClose = () => {
    if (historyPushedRef.current) {
      window.history.back() // popstate → onClose
    } else {
      onClose()
    }
  }

  const selectedOpt = options.find((o) => o.qty === selected) || options[0]

  const bundlePicker = (
    <div className="space-y-2">
      {variantLabels.length > 1 && (
        <div className="flex gap-2 flex-wrap pb-1">
          {variantLabels.map((label, vi) => (
            <button
              key={label + vi}
              onClick={() => onVariantChange(vi)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all ${
                activeVariantIdx === vi
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-gray-300 bg-white text-gray-600"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {options.map((opt) => {
        const isSelected = opt.qty === selectedOpt?.qty
        return (
          <button
            key={opt.qty}
            onClick={() => onSelect(opt.qty)}
            className={`w-full text-left rounded-xl border-2 transition-all overflow-hidden ${
              isSelected ? "border-blue-600 bg-blue-50/40" : "border-gray-200"
            }`}
          >
            <div className="px-3 py-2.5 flex items-center gap-2.5">
              <span
                className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                  isSelected ? "border-blue-600" : "border-gray-300"
                }`}
              >
                {isSelected && <span className="w-2 h-2 rounded-full bg-blue-600" />}
              </span>
              {(opt.image || product.thumbnail) && (
                <img
                  src={opt.image || product.thumbnail!}
                  alt={opt.label}
                  className="w-10 h-10 object-cover rounded-lg flex-shrink-0"
                />
              )}
              <span className="flex-1 min-w-0">
                <span className="block font-black text-sm text-gray-900 line-clamp-1">{opt.label}</span>
                {opt.badge ? (
                  <span className="block text-[11px] font-bold text-red-500">{opt.badge}</span>
                ) : opt.gifts && opt.gifts.length > 0 ? (
                  <span className="block text-[11px] font-semibold text-blue-600">
                    +{opt.gifts.length} quà tặng miễn phí
                  </span>
                ) : null}
              </span>
              <span className="text-right flex-shrink-0">
                <span className="block font-black text-sm text-orange-500">{formatVND(opt.price)}</span>
                <span className="block text-[11px] text-gray-400 line-through">{formatVND(opt.originalPrice)}</span>
              </span>
            </div>
            {isSelected && opt.gifts && opt.gifts.length > 0 && (
              <div className="border-t border-dashed border-blue-200 bg-blue-50 px-3 py-2 space-y-1">
                {opt.gifts.map((g, i) => (
                  <p key={i} className="text-[11px] text-gray-700 font-semibold line-clamp-1">
                    🎁 <span className="text-blue-600 font-black">TẶNG</span> {g.name}
                  </p>
                ))}
              </div>
            )}
          </button>
        )
      })}
      {syncError && (
        <p className="text-xs text-red-600 font-semibold">
          Chưa cập nhật được giỏ hàng —{" "}
          <button className="underline" onClick={() => syncCart(cartLine)}>thử lại</button>
        </p>
      )}
    </div>
  )

  const bundleVariantIds = (product.variants ?? []).map((v) => v.id)

  // Portal to body: a transformed ancestor on the product page would break position: fixed
  return createPortal(
    // Above ChatBot / FloatingContact / SocialProofPopup (zIndex 9997–9999)
    <div className="fixed inset-0 flex items-end sm:items-center justify-center" style={{ zIndex: 10000 }}>
      <div className="absolute inset-0 bg-black/50 pv-fade-in" onClick={requestClose} />
      {/* No transform left after the animation — SepayModal inside uses position: fixed */}
      <div
        className="relative w-full sm:max-w-lg bg-gray-50 rounded-t-2xl sm:rounded-2xl overflow-y-auto overscroll-contain shadow-2xl pv-sheet-in"
        style={{ maxHeight: "92dvh" }}
        role="dialog"
        aria-modal="true"
        aria-label="Đặt hàng"
      >
        <SimpleCheckout
          cart={cart}
          shippingOptions={null}
          embedded
          onClose={requestClose}
          bundlePicker={bundlePicker}
          bundleVariantIds={bundleVariantIds}
          pendingBundlePrice={selectedOpt?.price}
          syncing={syncing}
          ensureReady={ensureReady}
        />
      </div>
      <style>{`
        @keyframes pvFadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes pvSheetIn { from { transform: translateY(24px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
        .pv-fade-in { animation: pvFadeIn .18s ease-out }
        .pv-sheet-in { animation: pvSheetIn .22s ease-out }
      `}</style>
    </div>,
    document.body
  )
}
