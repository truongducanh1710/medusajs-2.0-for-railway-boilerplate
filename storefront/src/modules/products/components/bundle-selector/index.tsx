"use client"

import { useState, useEffect } from "react"
import { HttpTypes } from "@medusajs/types"
import { addToCart } from "@lib/data/cart"
import { useParams, useRouter } from "next/navigation"
import { generateEventId } from "@lib/pixel"

type GiftItem = {
  image?: string
  name: string
  value: number
}

type BundleOption = {
  qty: number
  label: string
  badge?: string
  badgeColor?: string
  price: number
  originalPrice: number
  gifts?: GiftItem[]
  image?: string
}

type Props = {
  product: HttpTypes.StoreProduct
  region: HttpTypes.StoreRegion
}

function formatVND(amount: number) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(amount)) + "đ"
}

function Countdown({ minutes = 17 }: { minutes?: number }) {
  const [secs, setSecs] = useState(minutes * 60)

  useEffect(() => {
    const t = setInterval(() => setSecs((s) => (s > 0 ? s - 1 : 0)), 1000)
    return () => clearInterval(t)
  }, [])

  const m = String(Math.floor(secs / 60)).padStart(2, "0")
  const s = String(secs % 60).padStart(2, "0")

  return (
    <span
      className="font-black tabular-nums"
      style={{ display: "inline-block", minWidth: "3.2ch", textAlign: "center" }}
    >
      {m}:{s}
    </span>
  )
}

export default function BundleSelector({ product, region }: Props) {
  const [selected, setSelected] = useState(1)
  const [adding, setAdding] = useState(false)
  const params = useParams()
  const countryCode = params.countryCode as string
  const router = useRouter()

  const variant = product.variants?.[0]
  const basePrice =
    variant?.calculated_price?.calculated_amount ??
    variant?.prices?.[0]?.amount ??
    0

  if (!basePrice || basePrice === 0) return null

  const defaultGifts: GiftItem[] = [
    { name: "Túi đựng sản phẩm cao cấp", value: 89000 },
    { name: "Hướng dẫn sử dụng chi tiết", value: 49000 },
  ]

  // Load custom bundle options from metadata, fallback to ratio-based defaults
  let options: BundleOption[] = []
  try {
    const rawOpts = product.metadata?.bundle_options as string
    if (rawOpts) {
      const parsed = JSON.parse(rawOpts) as Array<{
        qty: number; label: string; price: number; originalPrice: number
        badge?: string; badgeColor?: string; gifts?: GiftItem[]
      }>
      options = parsed.map((o) => ({
        ...o,
        image: o.image || undefined,
        gifts: o.gifts && o.gifts.filter(g => g.name).length > 0
          ? o.gifts.filter(g => g.name)
          : undefined,
      }))
    }
  } catch {}

  if (!options.length) {
    options = [
      {
        qty: 1,
        label: "1 SẢN PHẨM",
        price: basePrice,
        originalPrice: Math.round(basePrice * 1.4),
      },
      {
        qty: 2,
        label: "MUA 1 TẶNG 1",
        badge: "HÔM NAY THÔI",
        badgeColor: "bg-orange-500",
        price: Math.round(basePrice * 1.6),
        originalPrice: Math.round(basePrice * 2.8),
        gifts: defaultGifts,
      },
      {
        qty: 3,
        label: "MUA 2 TẶNG 1",
        badge: "TIẾT KIỆM NHẤT 🔥",
        badgeColor: "bg-red-500",
        price: Math.round(basePrice * 2.2),
        originalPrice: Math.round(basePrice * 4.2),
        gifts: defaultGifts,
      },
    ]
  }

  const selectedOpt = options.find((o) => o.qty === selected) || options[0]

  const handleAdd = async () => {
    if (!variant?.id) return
    setAdding(true)

    // Fire pixel immediately (non-blocking)
    if (typeof window !== "undefined" && window.fbq) {
      window.fbq("track", "AddToCart", {
        content_ids: [variant.id],
        content_name: product.title,
        content_type: "product",
        value: selectedOpt.price / 100,
        currency: "VND",
        num_items: selected,
      }, { eventID: generateEventId() })
    }

    try {
      const giftsToSave = selectedOpt.gifts || []
      await addToCart({
        variantId: variant.id,
        quantity: selected,
        countryCode,
        metadata: giftsToSave.length > 0
          ? { gifts: JSON.stringify(giftsToSave) }
          : undefined,
      })
      // Chỉ redirect sau khi addToCart hoàn tất — đảm bảo số lượng đúng
      router.push(`/${countryCode}/checkout`)
    } catch (e) {
      console.error("[BundleSelector] addToCart failed", e)
      setAdding(false)
    }
  }

  return (
    <div className="rounded-2xl overflow-hidden border border-gray-200 shadow-sm">
      <div className="bg-gray-100 py-2 text-center text-xs font-semibold text-gray-500 tracking-widest uppercase">
        — Đổi trả 7 ngày — Hài lòng hoặc hoàn tiền —
      </div>

      <div className="bg-blue-600 text-white py-3 px-4 text-center" style={{ minHeight: "48px" }}>
        <p className="font-black text-base" style={{ lineHeight: "1.5", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          🔥 NHANH! Ưu đãi kết thúc sau <Countdown minutes={17} /> ⏰
        </p>
      </div>

      <div className="p-3 space-y-2.5 bg-white">
        {options.map((opt) => {
          const isSelected = selected === opt.qty

          return (
            <div
              key={opt.qty}
              onClick={() => setSelected(opt.qty)}
              className={`rounded-xl border-2 cursor-pointer transition-all overflow-hidden ${
                isSelected
                  ? "border-blue-600 shadow-md"
                  : "border-gray-200 hover:border-blue-300"
              }`}
            >
              {opt.badge && (
                <div
                  className={`${opt.badgeColor} text-white text-[10px] font-black px-3 py-1 text-center tracking-wide`}
                >
                  {opt.badge}
                </div>
              )}

              <div className="p-3 sm:p-3.5 flex items-center gap-2 sm:gap-3">
                <div
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                    isSelected ? "border-blue-600" : "border-gray-300"
                  }`}
                >
                  {isSelected && (
                    <div className="w-2.5 h-2.5 rounded-full bg-blue-600" />
                  )}
                </div>

                {(opt.image || product.thumbnail) && (
                  <img
                    src={opt.image || product.thumbnail!}
                    alt={opt.label}
                    className="w-14 h-14 object-cover rounded-lg flex-shrink-0"
                  />
                )}

                <div className="flex-1 min-w-0">
                  <p className="font-black text-gray-900 text-sm">{opt.label}</p>
                  {opt.gifts && opt.gifts.length > 0 && (
                    <p className="text-xs text-blue-600 font-semibold">
                      +{opt.gifts.length} QUÀ TẶNG MIỄN PHÍ
                    </p>
                  )}
                </div>

                <div className="text-right flex-shrink-0">
                  <p className="font-black text-gray-900">{formatVND(opt.price)}</p>
                  <p className="text-xs text-gray-400 line-through">
                    {formatVND(opt.originalPrice)}
                  </p>
                </div>
              </div>

              {isSelected && opt.gifts && opt.gifts.length > 0 && (
                <div className="border-t border-dashed border-blue-200 bg-blue-50 px-3.5 py-2.5 space-y-2">
                  {opt.gifts.map((gift, i) => (
                    <div key={i} className="flex items-center gap-2.5">
                      {gift.image ? (
                        <img
                          src={gift.image}
                          alt={gift.name}
                          className="w-10 h-10 object-cover rounded-lg border border-blue-200"
                        />
                      ) : (
                        <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center text-lg flex-shrink-0">
                          🎁
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-700 line-clamp-1">
                          <span className="text-blue-600 font-black">TẶNG! </span>
                          {gift.name}
                        </p>
                      </div>
                      <p className="text-xs text-gray-400 line-through flex-shrink-0">
                        {formatVND(gift.value)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="px-3 pb-4 pt-1 bg-white space-y-3">
        <button
          onClick={handleAdd}
          disabled={adding}
          className="w-full py-3 sm:py-4 rounded-xl font-black text-base sm:text-lg tracking-wide transition-all bg-blue-600 hover:bg-blue-700 text-white active:scale-[0.98] disabled:opacity-70 shadow-lg"
        >
          {adding ? "⏳ Đang thêm vào giỏ..." : "🛒 ĐẶT HÀNG NGAY"}
        </button>

        <div className="grid grid-cols-4 gap-1 pt-1">
          {[
            { icon: "⭐", line1: "4.8/5", line2: "Đánh giá" },
            { icon: "🔄", line1: "Đổi trả", line2: "7 ngày" },
            { icon: "🇻🇳", line1: "Hàng", line2: "Chính hãng" },
            { icon: "🔒", line1: "Thanh toán", line2: "An toàn" },
          ].map((b) => (
            <div key={b.line1} className="flex flex-col items-center gap-0.5">
              <span className="text-xl sm:text-2xl">{b.icon}</span>
              <span className="text-[10px] text-gray-500 font-semibold text-center leading-tight">
                {b.line1}<br />{b.line2}
              </span>
            </div>
          ))}
        </div>

      </div>
    </div>
  )
}
