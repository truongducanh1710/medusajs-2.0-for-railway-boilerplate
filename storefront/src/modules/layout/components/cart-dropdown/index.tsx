"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { HttpTypes } from "@medusajs/types"
import { convertToLocale } from "@lib/util/money"

// Format VND luôn — không phụ thuộc region
function fmtVND(amount: number) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(amount)) + "đ"
}
import { deleteLineItem, updateLineItem } from "@lib/data/cart"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

function Countdown({ seconds = 299 }: { seconds?: number }) {
  const [secs, setSecs] = useState(seconds)
  useEffect(() => {
    const t = setInterval(() => setSecs(s => s > 0 ? s - 1 : 0), 1000)
    return () => clearInterval(t)
  }, [])
  const m = String(Math.floor(secs / 60)).padStart(2, "0")
  const s = String(secs % 60).padStart(2, "0")
  return <span className="font-black tabular-nums">{m}:{s}</span>
}

const CartDropdown = ({ cart }: { cart?: HttpTypes.StoreCart | null }) => {
  const [open, setOpen] = useState(false)
  const [updating, setUpdating] = useState<string | null>(null)
  const itemRef = useRef(0)
  const pathname = usePathname()

  const totalItems = cart?.items?.reduce((acc, i) => acc + i.quantity, 0) || 0
  const subtotal = cart?.subtotal ?? 0

  // Tính tiết kiệm
  const originalTotal = cart?.items?.reduce((acc, item) => {
    const orig = (item.unit_price || 0) * item.quantity
    return acc + orig
  }, 0) || 0
  const savings = originalTotal - subtotal

  // Auto-open khi thêm sản phẩm
  useEffect(() => {
    if (itemRef.current !== totalItems && !pathname.includes("/cart") && !pathname.includes("/checkout")) {
      setOpen(true)
    }
    itemRef.current = totalItems
  }, [totalItems, pathname])

  const handleDelete = async (id: string) => {
    setUpdating(id)
    await deleteLineItem(id)
    setUpdating(null)
  }

  const handleQtyChange = async (id: string, qty: number) => {
    if (qty < 1) return
    setUpdating(id)
    await updateLineItem({ lineId: id, quantity: qty })
    setUpdating(null)
  }

  const sortedItems = [...(cart?.items || [])].sort((a, b) =>
    (a.created_at ?? "") > (b.created_at ?? "") ? -1 : 1
  )

  return (
    <>
      {/* Cart icon trigger */}
      <button
        onClick={() => setOpen(true)}
        className="relative hover:bg-slate-100 p-2 rounded-full transition-all"
        aria-label="Giỏ hàng"
      >
        <span className="text-xl">🛒</span>
        {totalItems > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-orange-500 text-white text-[10px] font-black w-4 h-4 flex items-center justify-center rounded-full">
            {totalItems}
          </span>
        )}
      </button>

      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-40 transition-opacity"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Drawer */}
      <div style={{
        position: "fixed", top: 0, right: 0, height: "100%",
        width: "100%", maxWidth: 420, backgroundColor: "white",
        zIndex: 50, boxShadow: "-4px 0 24px rgba(0,0,0,0.15)",
        display: "flex", flexDirection: "column",
        transform: open ? "translateX(0)" : "translateX(100%)",
        transition: "transform 0.3s ease-out",
        fontFamily: "inherit"
      }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-black text-lg text-gray-900">
            Giỏ hàng {totalItems > 0 && <span className="text-gray-400 font-normal text-base">• {totalItems} sản phẩm</span>}
          </h2>
          <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700 text-2xl leading-none font-light">×</button>
        </div>

        {/* Countdown */}
        {totalItems > 0 && (
          <div className="bg-blue-950 text-white text-center py-2 text-sm font-semibold">
            ⏰ Giỏ hàng được giữ trong <Countdown seconds={299} />
          </div>
        )}

        {/* Items */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
          {sortedItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
              <span className="text-5xl">🛒</span>
              <p className="text-gray-500">Giỏ hàng của bạn đang trống</p>
              <LocalizedClientLink
                href="/store"
                onClick={() => setOpen(false)}
                className="bg-orange-500 text-white px-6 py-2.5 rounded-xl font-bold text-sm hover:bg-orange-600"
              >
                Khám phá sản phẩm
              </LocalizedClientLink>
            </div>
          ) : (
            sortedItems.map((item) => {
              const gifts = (() => {
                try { return JSON.parse((item.metadata?.gifts as string) || "[]") } catch { return [] }
              })()

              return (
                <div key={item.id} style={{ border: "1px solid #f3f4f6", borderRadius: 12, padding: 12, marginBottom: 12, display: "block" }}>
                  <div style={{ display: "flex", gap: 12 }}>
                    {/* Thumbnail */}
                    <div className="w-16 h-16 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center">
                      {item.variant?.product?.thumbnail ? (
                        <img
                          src={item.variant.product.thumbnail}
                          alt={item.title || ""}
                          className="w-full h-full object-cover"
                        />
                      ) : (item as any).thumbnail ? (
                        <img
                          src={(item as any).thumbnail}
                          alt={item.title || ""}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-2xl">🛍️</span>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-gray-900 line-clamp-2">
                        {item.title || (item as any).product_title}
                      </p>
                      <p className="text-orange-500 font-black text-sm mt-0.5">
                        {fmtVND(item.unit_price * item.quantity)}
                      </p>

                      {/* Qty controls */}
                      <div className="flex items-center gap-2 mt-2">
                        <button
                          onClick={() => handleQtyChange(item.id, item.quantity - 1)}
                          disabled={!!updating}
                          className="w-7 h-7 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 hover:border-orange-400 disabled:opacity-40"
                        >−</button>
                        <span className="text-sm font-bold w-5 text-center">{item.quantity}</span>
                        <button
                          onClick={() => handleQtyChange(item.id, item.quantity + 1)}
                          disabled={!!updating}
                          className="w-7 h-7 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 hover:border-orange-400 disabled:opacity-40"
                        >+</button>
                      </div>
                    </div>

                    {/* Delete */}
                    <button
                      onClick={() => handleDelete(item.id)}
                      disabled={updating === item.id}
                      className="text-gray-300 hover:text-red-400 text-lg leading-none self-start disabled:opacity-40"
                    >×</button>
                  </div>

                  {/* Gift items */}
                  {gifts.length > 0 && (
                    <div className="mt-3 bg-orange-50 border border-orange-200 rounded-lg p-2.5 space-y-2">
                      <p className="text-[10px] font-black text-orange-500 uppercase tracking-wider">🎁 Quà tặng kèm ({gifts.length} món)</p>
                      {gifts.map((gift: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 bg-white rounded-lg px-2.5 py-2 border border-orange-100">
                          {gift.image
                            ? <img src={gift.image} className="w-9 h-9 rounded-lg object-cover flex-shrink-0" alt={gift.name} />
                            : <span className="text-xl flex-shrink-0">🎁</span>
                          }
                          <p className="text-xs text-gray-700 flex-1 font-medium line-clamp-1">{gift.name}</p>
                          <span className="text-xs text-gray-400 line-through flex-shrink-0">
                            {fmtVND(gift.value || 0)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        {sortedItems.length > 0 && (
          <div style={{ borderTop: "1px solid #f3f4f6", padding: "16px", backgroundColor: "#fafafa" }}>
            {savings > 0 && (
              <div className="flex justify-between text-sm text-green-600 font-semibold">
                <span>Tiết kiệm được</span>
                <span>-{fmtVND(savings)}</span>
              </div>
            )}
            <div className="flex justify-between font-black text-lg">
              <span>Tổng cộng</span>
              <span className="text-orange-500">
                {fmtVND(subtotal)}
              </span>
            </div>
            <LocalizedClientLink
              href="/checkout"
              onClick={() => setOpen(false)}
              className="block w-full bg-blue-950 hover:bg-blue-900 text-white font-black text-base py-4 rounded-xl text-center transition-all active:scale-95"
            >
              TIẾN HÀNH THANH TOÁN →
            </LocalizedClientLink>
            <button
              onClick={() => setOpen(false)}
              className="block w-full text-center text-sm text-gray-400 hover:text-gray-600"
            >
              Tiếp tục mua hàng
            </button>
          </div>
        )}
      </div>
    </>
  )
}

export default CartDropdown
