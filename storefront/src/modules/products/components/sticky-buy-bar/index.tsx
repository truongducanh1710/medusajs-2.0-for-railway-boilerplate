"use client"

import { useEffect, useRef, useState } from "react"
import { HttpTypes } from "@medusajs/types"
import { addToCart } from "@lib/data/cart"
import { useParams } from "next/navigation"

type Props = {
  product: HttpTypes.StoreProduct
  region: HttpTypes.StoreRegion
  anchorId: string
}

function formatVND(amount: number) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(amount)) + "đ"
}

export default function StickyBuyBar({ product, region, anchorId }: Props) {
  const [visible, setVisible] = useState(false)
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState(false)
  const params = useParams()
  const countryCode = params.countryCode as string

  const variant = product.variants?.[0]
  const basePrice =
    variant?.calculated_price?.calculated_amount ??
    variant?.prices?.[0]?.amount ??
    0

  useEffect(() => {
    const anchor = document.getElementById(anchorId)
    if (!anchor) return

    const observer = new IntersectionObserver(
      ([entry]) => setVisible(!entry.isIntersecting),
      { threshold: 0, rootMargin: "0px" }
    )
    observer.observe(anchor)
    return () => observer.disconnect()
  }, [anchorId])

  const handleBuy = async () => {
    if (!variant?.id) {
      document.getElementById(anchorId)?.scrollIntoView({ behavior: "smooth" })
      return
    }
    setAdding(true)
    try {
      await addToCart({ variantId: variant.id, quantity: 1, countryCode } as any)
      setAdded(true)
      setTimeout(() => setAdded(false), 2500)
    } catch {}
    finally { setAdding(false) }
  }

  const scrollToBuy = () => {
    document.getElementById(anchorId)?.scrollIntoView({ behavior: "smooth" })
  }

  if (!basePrice) return null

  return (
    <div
      className={`lg:hidden fixed bottom-0 inset-x-0 z-40 transition-transform duration-300 ${
        visible ? "translate-y-0" : "translate-y-full"
      }`}
    >
      {/* subtle shadow line on top */}
      <div className="bg-white border-t border-gray-200 shadow-[0_-4px_16px_rgba(0,0,0,0.10)]">
        <div className="flex items-center gap-3 px-4 py-3">
          {/* Price block */}
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-gray-400 font-medium leading-none mb-0.5 truncate">
              {product.title}
            </p>
            <p className="text-lg font-black text-gray-900 leading-none">
              {formatVND(basePrice)}
            </p>
          </div>

          {/* Secondary: scroll to choose bundle */}
          <button
            onClick={scrollToBuy}
            className="flex-shrink-0 h-12 px-4 rounded-xl border-2 border-blue-600 text-blue-600 font-bold text-sm whitespace-nowrap"
          >
            Chọn gói
          </button>

          {/* Primary CTA */}
          <button
            onClick={handleBuy}
            disabled={adding || added}
            className={`flex-shrink-0 h-12 px-5 rounded-xl font-black text-sm text-white whitespace-nowrap transition-colors ${
              added
                ? "bg-green-500"
                : "bg-blue-600 active:bg-blue-700"
            } disabled:opacity-70`}
          >
            {added ? "✅ Đã thêm!" : adding ? "..." : "🛒 Mua ngay"}
          </button>
        </div>

        {/* safe area for iPhone home indicator */}
        <div className="h-safe-bottom bg-white" style={{ height: "env(safe-area-inset-bottom, 0px)" }} />
      </div>
    </div>
  )
}
