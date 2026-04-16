"use client"

import { useState } from "react"
import { HttpTypes } from "@medusajs/types"
import { addToCart } from "@lib/data/cart"
import { useParams } from "next/navigation"

type ComboItem = {
  product: HttpTypes.StoreProduct
  selected: boolean
}

type Props = {
  mainProduct: HttpTypes.StoreProduct
  comboProducts: HttpTypes.StoreProduct[]
  discountPercent?: number
}

function formatVND(amount: number) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(amount)) + "đ"
}

function getPrice(product: HttpTypes.StoreProduct): number {
  return product.variants?.[0]?.calculated_price?.calculated_amount
    ?? product.variants?.[0]?.prices?.[0]?.amount
    ?? 0
}

export default function ComboBundle({ mainProduct, comboProducts, discountPercent = 15 }: Props) {
  const params = useParams()
  const countryCode = params.countryCode as string
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState(false)

  const [items, setItems] = useState<ComboItem[]>(
    comboProducts.map(p => ({ product: p, selected: true }))
  )

  const toggleItem = (idx: number) => {
    setItems(prev => prev.map((item, i) =>
      i === idx ? { ...item, selected: !item.selected } : item
    ))
  }

  const selectedItems = items.filter(i => i.selected)
  const allProducts = [mainProduct, ...selectedItems.map(i => i.product)]

  const originalTotal = allProducts.reduce((sum, p) => sum + getPrice(p), 0)
  const totalSelected = selectedItems.length + 1
  const discount = totalSelected >= 2 ? discountPercent : 0
  const finalTotal = originalTotal * (1 - discount / 100)
  const saving = originalTotal - finalTotal

  const handleAddCombo = async () => {
    setAdding(true)
    try {
      for (const p of allProducts) {
        const variantId = p.variants?.[0]?.id
        if (variantId) {
          await addToCart({ variantId, quantity: 1, countryCode })
        }
      }
      setAdded(true)
      setTimeout(() => setAdded(false), 2500)
    } catch (e) {
      console.error(e)
    } finally {
      setAdding(false)
    }
  }

  if (comboProducts.length === 0) return null

  return (
    <div className="border border-blue-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="bg-blue-950 px-5 py-3">
        <span className="text-white font-black text-sm">🎁 MUA KÈM TIẾT KIỆM {discountPercent}%</span>
      </div>

      <div className="p-4 bg-white">
        {/* Products row */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {/* Main product */}
          <div className="flex flex-col items-center text-center w-20">
            {mainProduct.thumbnail ? (
              <img src={mainProduct.thumbnail} alt={mainProduct.title} className="w-16 h-16 object-cover rounded-lg border border-gray-200" />
            ) : (
              <div className="w-16 h-16 bg-gray-100 rounded-lg flex items-center justify-center text-2xl">🛍️</div>
            )}
            <span className="text-xs text-gray-600 mt-1 line-clamp-2">{mainProduct.title}</span>
            <span className="text-xs font-bold text-orange-500">{formatVND(getPrice(mainProduct))}</span>
          </div>

          {items.map((item, idx) => (
            <div key={item.product.id} className="flex items-center gap-2">
              <span className="text-gray-400 font-bold text-lg">+</span>
              <div
                className={`flex flex-col items-center text-center w-20 cursor-pointer rounded-xl p-1 transition-all ${
                  item.selected ? "opacity-100" : "opacity-40"
                }`}
                onClick={() => toggleItem(idx)}
              >
                <div className="relative">
                  {item.product.thumbnail ? (
                    <img src={item.product.thumbnail} alt={item.product.title} className={`w-16 h-16 object-cover rounded-lg border-2 transition-all ${item.selected ? "border-blue-500" : "border-gray-200"}`} />
                  ) : (
                    <div className={`w-16 h-16 bg-gray-100 rounded-lg flex items-center justify-center text-2xl border-2 ${item.selected ? "border-blue-500" : "border-gray-200"}`}>🛍️</div>
                  )}
                  <div className={`absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${item.selected ? "bg-blue-500 text-white" : "bg-gray-300 text-gray-600"}`}>
                    {item.selected ? "✓" : "+"}
                  </div>
                </div>
                <span className="text-xs text-gray-600 mt-1 line-clamp-2">{item.product.title}</span>
                <span className="text-xs font-bold text-orange-500">{formatVND(getPrice(item.product))}</span>
              </div>
            </div>
          ))}
        </div>

        <p className="text-xs text-gray-400 mb-4">💡 Bấm vào sản phẩm để bỏ chọn / chọn lại</p>

        {/* Price summary */}
        <div className="bg-gray-50 rounded-xl p-4 space-y-2 mb-4">
          <div className="flex justify-between text-sm text-gray-600">
            <span>Giá gốc ({totalSelected} sản phẩm)</span>
            <span className="line-through">{formatVND(originalTotal)}</span>
          </div>
          {discount > 0 && (
            <div className="flex justify-between text-sm text-green-600 font-semibold">
              <span>Giảm giá combo -{discount}%</span>
              <span>-{formatVND(saving)}</span>
            </div>
          )}
          <div className="flex justify-between font-black text-base pt-2 border-t border-gray-200">
            <span>Tổng combo</span>
            <span className="text-orange-500">{formatVND(finalTotal)}</span>
          </div>
        </div>

        {/* CTA */}
        <button
          onClick={handleAddCombo}
          disabled={adding || added || totalSelected < 2}
          className={`w-full py-3.5 rounded-xl font-black text-base transition-all ${
            added
              ? "bg-green-500 text-white"
              : totalSelected < 2
              ? "bg-gray-200 text-gray-400 cursor-not-allowed"
              : "bg-blue-950 hover:bg-blue-900 text-white active:scale-95"
          }`}
        >
          {added
            ? `✅ Đã thêm ${totalSelected} sản phẩm!`
            : adding
            ? "Đang thêm..."
            : `✅ Thêm combo ${totalSelected} sản phẩm — ${formatVND(finalTotal)}`}
        </button>
      </div>
    </div>
  )
}
