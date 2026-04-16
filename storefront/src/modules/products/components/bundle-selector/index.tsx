"use client"

import { useState } from "react"
import { HttpTypes } from "@medusajs/types"
import { addToCart } from "@lib/data/cart"
import { useParams } from "next/navigation"

type BundleOption = {
  qty: number
  label: string
  discount: number // % giảm
  badge?: string
}

type Props = {
  product: HttpTypes.StoreProduct
  region: HttpTypes.StoreRegion
}

const BUNDLE_OPTIONS: BundleOption[] = [
  { qty: 1, label: "Mua 1", discount: 0 },
  { qty: 2, label: "Mua 2", discount: 10, badge: "Phổ biến nhất" },
  { qty: 3, label: "Mua 3", discount: 20, badge: "Tiết kiệm nhất 🔥" },
]

function formatVND(amount: number) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(amount)) + "đ"
}

export default function BundleSelector({ product, region }: Props) {
  const [selected, setSelected] = useState(1)
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState(false)
  const params = useParams()
  const countryCode = params.countryCode as string

  const variant = product.variants?.[0]
  const basePrice = variant?.calculated_price?.calculated_amount
    ?? variant?.prices?.[0]?.amount
    ?? 0

  if (!basePrice || basePrice === 0) return null

  const selectedOption = BUNDLE_OPTIONS.find(o => o.qty === selected) || BUNDLE_OPTIONS[0]
  const discountedUnit = basePrice * (1 - selectedOption.discount / 100)
  const total = discountedUnit * selected
  const originalTotal = basePrice * selected
  const saving = originalTotal - total

  const handleAddBundle = async () => {
    if (!variant?.id) return
    setAdding(true)
    try {
      await addToCart({
        variantId: variant.id,
        quantity: selected,
        countryCode,
      })
      setAdded(true)
      setTimeout(() => setAdded(false), 2000)
    } catch (e) {
      console.error(e)
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="border border-orange-200 rounded-xl overflow-hidden bg-orange-50/30">
      {/* Header */}
      <div className="bg-orange-500 px-5 py-3 flex items-center gap-2">
        <span className="text-white font-black text-sm">🎁 CHỌN SỐ LƯỢNG — CÀNG MUA CÀNG TIẾT KIỆM</span>
      </div>

      {/* Options */}
      <div className="p-4 space-y-3">
        {BUNDLE_OPTIONS.map((opt) => {
          const unitPrice = basePrice * (1 - opt.discount / 100)
          const totalPrice = unitPrice * opt.qty
          const isSelected = selected === opt.qty

          return (
            <button
              key={opt.qty}
              onClick={() => setSelected(opt.qty)}
              className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-left ${
                isSelected
                  ? "border-orange-500 bg-orange-50 shadow-sm"
                  : "border-gray-200 bg-white hover:border-orange-300"
              }`}
            >
              {/* Radio */}
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                isSelected ? "border-orange-500" : "border-gray-300"
              }`}>
                {isSelected && <div className="w-2.5 h-2.5 rounded-full bg-orange-500" />}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-gray-900">{opt.label}</span>
                  {opt.badge && (
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      opt.discount >= 20
                        ? "bg-red-500 text-white"
                        : "bg-orange-500 text-white"
                    }`}>
                      {opt.badge}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="text-orange-600 font-black">{formatVND(totalPrice)}</span>
                  {opt.discount > 0 && (
                    <>
                      <span className="text-gray-400 line-through text-sm">{formatVND(basePrice * opt.qty)}</span>
                      <span className="text-green-600 font-bold text-sm">-{opt.discount}%</span>
                    </>
                  )}
                </div>
                {opt.discount > 0 && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    {formatVND(unitPrice)}/sản phẩm · Tiết kiệm {formatVND(basePrice * opt.qty - totalPrice)}
                  </p>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* Summary + CTA */}
      <div className="px-4 pb-4 space-y-3">
        <div className="bg-white rounded-xl p-4 border border-gray-100">
          <div className="flex justify-between text-sm text-gray-600 mb-1">
            <span>Giá gốc ({selected} sản phẩm)</span>
            <span className={saving > 0 ? "line-through" : ""}>{formatVND(originalTotal)}</span>
          </div>
          {saving > 0 && (
            <div className="flex justify-between text-sm text-green-600 font-semibold mb-1">
              <span>Tiết kiệm được</span>
              <span>-{formatVND(saving)}</span>
            </div>
          )}
          <div className="flex justify-between font-black text-lg mt-2 pt-2 border-t border-gray-100">
            <span>Tổng thanh toán</span>
            <span className="text-orange-500">{formatVND(total)}</span>
          </div>
        </div>

        <button
          onClick={handleAddBundle}
          disabled={adding || added}
          className={`w-full py-4 rounded-xl font-black text-lg transition-all ${
            added
              ? "bg-green-500 text-white"
              : "bg-orange-500 hover:bg-orange-600 text-white active:scale-95"
          } disabled:opacity-70`}
        >
          {added ? "✅ Đã thêm vào giỏ!" : adding ? "Đang thêm..." : `🛒 Thêm ${selected} sản phẩm vào giỏ`}
        </button>

        <p className="text-center text-xs text-gray-400">
          🔒 Thanh toán an toàn · 🔄 Đổi trả 7 ngày · 🚚 Miễn phí ship từ 500K
        </p>
      </div>
    </div>
  )
}
