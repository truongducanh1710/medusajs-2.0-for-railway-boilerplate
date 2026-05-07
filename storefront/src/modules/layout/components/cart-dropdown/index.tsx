"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { HttpTypes } from "@medusajs/types"
import { deleteLineItem, applyPromotions } from "@lib/data/cart"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

const BACKEND = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL || ""
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY || ""

function fmtVND(amount: number) {
  return new Intl.NumberFormat("vi-VN").format(amount) + " ₫"
}

function Countdown({ seconds = 299 }: { seconds?: number }) {
  const [secs, setSecs] = useState(seconds)
  useEffect(() => {
    const t = setInterval(() => setSecs(s => s > 0 ? s - 1 : 0), 1000)
    return () => clearInterval(t)
  }, [])
  const m = String(Math.floor(secs / 60)).padStart(2, "0")
  const s = String(secs % 60).padStart(2, "0")
  return <span style={{ fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{m}:{s}</span>
}

const CartDropdown = ({ cart: initialCart }: { cart?: HttpTypes.StoreCart | null }) => {
  const [open, setOpen] = useState(false)
  const [updating, setUpdating] = useState<string | null>(null)
  const [promoCode, setPromoCode] = useState("")
  const [applyingPromo, setApplyingPromo] = useState(false)
  // localItems: optimistic state để cập nhật UI ngay mà không trigger server rerender
  const [localItems, setLocalItems] = useState<HttpTypes.StoreCartLineItem[] | null>(null)
  const itemRef = useRef(0)
  const pathname = usePathname()
  const router = useRouter()

  // Sync localItems khi cart prop thay đổi (sau delete, promoCode, v.v.)
  useEffect(() => {
    setLocalItems(null)
  }, [initialCart?.id, initialCart?.items?.length])

  const cart = localItems != null
    ? { ...initialCart, items: localItems } as typeof initialCart
    : initialCart

  const totalItems = cart?.items?.reduce((acc, i) => {
    const meta = i.metadata as any
    return acc + (meta?.bundle_qty != null ? Number(meta.bundle_qty) : i.quantity)
  }, 0) || 0
  const subtotal = cart?.items?.reduce((sum, i) => {
    const meta = i.metadata as any
    return sum + (meta?.bundle_price != null ? Number(meta.bundle_price) : i.unit_price * i.quantity)
  }, 0) ?? 0
  const originalTotal = cart?.items?.reduce((acc, item) => {
    const meta = item.metadata as any
    const bPrice = meta?.bundle_price != null ? Number(meta.bundle_price) : item.unit_price * item.quantity
    return acc + Math.round(bPrice * 1.4)
  }, 0) || 0
  const savings = originalTotal - subtotal
  const freeshipThreshold = 500000

  useEffect(() => {
    if (itemRef.current !== totalItems && !pathname.includes("/checkout")) {
      if (totalItems > itemRef.current) setOpen(true)
    }
    itemRef.current = totalItems
  }, [totalItems, pathname])

  const handleDelete = async (id: string) => {
    setUpdating(id)
    await deleteLineItem(id)
    setUpdating(null)
  }

  const handleQtyChange = async (id: string, qty: number) => {
    if (qty < 1 || qty > 10) return
    setUpdating(id)
    const item = cart?.items?.find(i => i.id === id)
    const meta = item?.metadata as any

    // Tính lại bundle_price theo công thức
    let newMeta: Record<string, unknown> = { ...meta }
    try {
      const bundleOptions: Array<{ qty: number; price: number; originalPrice: number; label: string; gifts?: any[] }> =
        JSON.parse(meta?.bundle_options || "[]")
      if (bundleOptions.length > 0) {
        const sorted = [...bundleOptions].sort((a, b) => a.qty - b.qty)
        const maxOpt = sorted[sorted.length - 1]

        let newPrice: number
        const exact = sorted.find(o => o.qty === qty)
        if (exact) {
          newPrice = exact.price
        } else if (qty > maxOpt.qty) {
          const unitPriceMax = maxOpt.price / maxOpt.qty
          let stepPerUnit = 0
          if (sorted.length >= 2) {
            const prev = sorted[sorted.length - 2]
            stepPerUnit = (prev.price / prev.qty - unitPriceMax) / (maxOpt.qty - prev.qty)
          }
          const extraQty = qty - maxOpt.qty
          const unitExtra = Math.max(unitPriceMax * 0.85, unitPriceMax - stepPerUnit * extraQty)
          newPrice = Math.round(maxOpt.price + unitExtra * extraQty)
        } else {
          let newP = maxOpt.price
          for (let i = 0; i < sorted.length - 1; i++) {
            const lo = sorted[i], hi = sorted[i + 1]
            if (qty > lo.qty && qty < hi.qty) {
              newP = Math.round(lo.price + (hi.price - lo.price) * (qty - lo.qty) / (hi.qty - lo.qty))
              break
            }
          }
          newPrice = newP
        }

        const giftSource = qty >= maxOpt.qty ? maxOpt : (sorted.find(o => o.qty === qty) ?? sorted.filter(o => o.qty <= qty).reverse()[0])
        const newLabel = exact?.label ?? `${qty} SẢN PHẨM`
        const newGifts = giftSource?.gifts

        newMeta = {
          ...meta,
          bundle_qty: qty,
          bundle_price: newPrice,
          bundle_label: newLabel,
          ...(newGifts && newGifts.length > 0 ? { gifts: JSON.stringify(newGifts) } : { gifts: "[]" }),
        }

        // Optimistic update — cập nhật UI ngay, không reload
        setLocalItems(prev => {
          const base = prev ?? (cart?.items ?? [])
          return base.map(i => i.id === id
            ? { ...i, quantity: qty, metadata: newMeta } as any
            : i
          )
        })
      }
    } catch {}

    // Gọi API trực tiếp (không dùng server action) để tránh revalidateTag → timer reset
    try {
      const cartId = cart?.id
      if (cartId) {
        await fetch(`${BACKEND}/store/carts/${cartId}/line-items/${id}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-publishable-api-key": PUB_KEY,
          },
          body: JSON.stringify({ quantity: qty, metadata: newMeta }),
          credentials: "include",
        })
      }
    } catch (e) {
      console.error("[CartDropdown] updateLineItem failed", e)
      setLocalItems(null) // rollback optimistic
    }
    setUpdating(null)
  }

  const handleApplyPromo = async () => {
    if (!promoCode.trim()) return
    setApplyingPromo(true)
    try {
      await applyPromotions([promoCode.trim()])
      setPromoCode("")
    } catch (err) {
      console.error(err)
    } finally {
      setApplyingPromo(false)
    }
  }

  const sortedItems = [...(cart?.items || [])].sort((a, b) =>
    (a.created_at ?? "") > (b.created_at ?? "") ? -1 : 1
  )

  const S = {
    overlay: {
      position: "fixed" as const, inset: 0,
      backgroundColor: "rgba(0,0,0,0.5)", zIndex: 40,
    },
    drawer: {
      position: "fixed" as const, top: 0, right: 0,
      height: "100vh", width: "100%", maxWidth: 420,
      backgroundColor: "#fff", zIndex: 50,
      boxShadow: "-4px 0 24px rgba(0,0,0,0.15)",
      display: "flex", flexDirection: "column" as const,
      minHeight: "100%",
      transform: open ? "translateX(0)" : "translateX(100%)",
      transition: "transform 0.3s ease-out",
      fontFamily: "'Be Vietnam Pro', Inter, sans-serif",
    },
    header: {
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "16px 20px", borderBottom: "1px solid #f3f4f6", flexShrink: 0,
    },
    urgencyBar: {
      backgroundColor: "#172554", color: "#fff",
      textAlign: "center" as const, padding: "8px 16px",
      fontSize: 13, fontWeight: 600, flexShrink: 0,
    },
    itemsArea: {
      flex: 1, overflowY: "auto" as const, padding: "12px 16px", minHeight: 0,
    },
    itemCard: {
      border: "1px solid #f3f4f6", borderRadius: 12,
      padding: 12, marginBottom: 12,
    },
    itemRow: { display: "flex", gap: 16, alignItems: "flex-start" },
    thumb: {
      width: 80, height: 80, borderRadius: 8, overflow: "hidden",
      backgroundColor: "#f3f4f6", flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
    },
    thumbImg: { width: "100%", height: "100%", objectFit: "cover" as const },
    info: { flex: 1, minWidth: 0 },
    name: { fontWeight: 600, fontSize: 13, color: "#111827", margin: 0, lineHeight: 1.4 },
    originalPrice: { textDecoration: "line-through", color: "#9ca3af", fontSize: 13, margin: 0 },
    salePrice: { fontWeight: 900, fontSize: 13, color: "#DC2626", margin: "0 0 0 8px" },
    tag: { backgroundColor: "#f97316", color: "#fff", fontSize: 10, fontWeight: 900, padding: "2px 6px", borderRadius: 4, textTransform: "uppercase" as const, letterSpacing: "0.05em", marginLeft: 8 },
    totalPrice: { fontWeight: 900, fontSize: 13, color: "#f97316", margin: "4px 0 0" },
    savings: { fontSize: 12, color: "#16a34a", fontStyle: "italic", marginTop: 4 },
    variant: { fontSize: 12, color: "#6b7280", marginTop: 2 },
    qtyRow: { display: "flex", alignItems: "center", gap: 8, marginTop: 8 },
    qtyBtn: {
      width: 28, height: 28, borderRadius: "50%",
      border: "1px solid #d1d5db", background: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
      cursor: "pointer", fontSize: 16, color: "#374151",
    },
    deleteBtn: {
      background: "none", border: "none", cursor: "pointer",
      fontSize: 20, color: "#d1d5db", lineHeight: 1, padding: 0,
      flexShrink: 0,
    },
    giftBox: {
      marginTop: 10, backgroundColor: "#fff7ed",
      border: "1px solid #fed7aa", borderRadius: 8, padding: 10,
    },
    giftTitle: {
      fontSize: 10, fontWeight: 900, color: "#f97316",
      textTransform: "uppercase" as const, letterSpacing: "0.05em",
      margin: "0 0 6px",
    },
    giftRow: {
      display: "flex", alignItems: "center", gap: 8,
      backgroundColor: "#fff", borderRadius: 6, padding: "6px 8px",
      border: "1px solid #ffedd5", marginBottom: 4,
    },
    footer: {
      borderTop: "1px solid #f3f4f6", padding: 16,
      backgroundColor: "#fafafa", flexShrink: 0,
    },
    totalRow: {
      display: "flex", justifyContent: "space-between",
      alignItems: "center", marginBottom: 12,
    },
    checkoutBtn: {
      display: "block", width: "100%", backgroundColor: "#172554",
      color: "#fff", fontWeight: 900, fontSize: 15,
      padding: "14px 0", borderRadius: 12, textAlign: "center" as const,
      textDecoration: "none", border: "none", cursor: "pointer",
      marginBottom: 8,
    },
    continueBtn: {
      display: "block", width: "100%", background: "none",
      border: "none", cursor: "pointer", textAlign: "center" as const,
      fontSize: 13, color: "#9ca3af", padding: "4px 0",
    },
    paymentIcons: {
      display: "flex", justifyContent: "center", alignItems: "center", gap: 8,
      marginTop: 12, flexWrap: "wrap" as const,
    },
    paymentIcon: { fontSize: 20, opacity: 0.7 },
    promoRow: { display: "flex", gap: 8, marginBottom: 12 },
    promoInput: { flex: 1, border: "1px solid #d1d5db", borderRadius: 6, padding: "8px 12px", fontSize: 14, outline: "none" },
    promoBtn: { backgroundColor: "#f97316", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer" },
    freeship: { backgroundColor: "#fef3c7", color: "#92400e", padding: "8px 12px", borderRadius: 6, fontSize: 13, marginBottom: 12, textAlign: "center" as const },
    trustBadges: {
      display: "flex", justifyContent: "space-around", alignItems: "center",
      padding: "16px", backgroundColor: "#f9fafb",
      borderTop: "1px solid #e5e7eb", borderBottom: "1px solid #e5e7eb",
    },
    trustItem: {
      display: "flex", flexDirection: "column" as const, alignItems: "center", gap: 4, flex: 1,
    },
    trustIcon: { fontSize: 24 },
    trustText: { fontSize: 10, fontWeight: 600, color: "#374151", textAlign: "center" as const },
  }

  return (
    <>
      {/* Cart icon */}
      <button
        onClick={() => setOpen(true)}
        className="relative bg-none border-none cursor-pointer p-2"
        aria-label="Giỏ hàng"
      >
        <span className="text-xl">🛒</span>
        {totalItems > 0 && (
          <span className="absolute -top-1 -right-1 bg-orange-500 text-white text-[10px] font-black w-4 h-4 rounded-full flex items-center justify-center">
            {totalItems > 9 ? "9+" : totalItems}
          </span>
        )}
      </button>

      {/* Overlay */}
      {open && <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setOpen(false)} />}

      {/* Drawer */}
      <div className={`fixed top-0 right-0 h-screen w-full max-w-sm sm:max-w-md lg:max-w-lg bg-white z-50 shadow-lg flex flex-col min-h-full transform transition-transform duration-300 ease-out font-be-vietnam-pro ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-gray-200 flex-shrink-0">
          <h2 className="m-0 text-base sm:text-lg font-black text-gray-900">
            Giỏ hàng
            {totalItems > 0 && (
              <span className="font-normal text-sm text-gray-400 ml-1.5">
                • {totalItems} sản phẩm
              </span>
            )}
          </h2>
          <button onClick={() => setOpen(false)} className="bg-none border-none cursor-pointer text-xl sm:text-2xl text-gray-400 leading-none">×</button>
        </div>

        {/* Urgency Bar */}
        {totalItems > 0 && (
          <div className="bg-blue-900 text-white text-center py-2 px-4 text-xs sm:text-sm font-semibold flex-shrink-0">
            ⏰ Giỏ hàng sẽ hết hạn sau <Countdown seconds={299} />
          </div>
        )}



        {/* Items */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 min-h-0">
          {sortedItems.length === 0 ? (
             <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
               <span className="text-5xl sm:text-6xl">🛒</span>
               <p className="text-gray-500 m-0">Giỏ hàng của bạn đang trống</p>
               <LocalizedClientLink
                 href="/store"
                 onClick={() => setOpen(false)}
                 className="bg-orange-500 text-white py-2.5 px-5 rounded-lg font-bold text-sm hover:bg-orange-600 transition-colors no-underline"
               >
                 Khám phá sản phẩm
               </LocalizedClientLink>
             </div>
          ) : (
            sortedItems.map((item) => {
              const gifts = (() => {
                try { return JSON.parse((item.metadata?.gifts as string) || "[]") } catch { return [] }
              })()
              const itemMeta = item.metadata as any
              const bundlePrice = itemMeta?.bundle_price != null ? Number(itemMeta.bundle_price) : null
              const bundleQty = itemMeta?.bundle_qty != null ? Number(itemMeta.bundle_qty) : item.quantity
              const bundleLabel = itemMeta?.bundle_label as string | undefined
              const displayPrice = bundlePrice ?? (item.unit_price * item.quantity)
              const originalPrice = Math.round(displayPrice * 1.4)
              const savings = originalPrice - displayPrice
              const thumb = item.variant?.product?.thumbnail || (item as any).thumbnail
              const variantText = item.variant?.options?.map(o => `${o.option?.title}: ${o.value}`).join(" | ") || ""

              return (
                <div key={item.id} className="border border-gray-200 rounded-lg p-3 mb-3">
                  <div className="flex gap-4 items-start">
                    {/* Thumb */}
                    <div className="w-20 h-20 rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center flex-shrink-0">
                      {thumb
                        ? <img src={thumb} alt={item.title || ""} className="w-full h-full object-cover" />
                        : <span className="text-2xl">🛍️</span>
                      }
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-gray-900 line-clamp-2">{item.title || (item as any).product_title}</p>
                      {bundleLabel && <p className="text-xs text-blue-600 font-bold mt-0.5">{bundleLabel}</p>}
                      {variantText && <p className="text-xs text-gray-500 mt-0.5">{variantText}</p>}
                      <div className="flex items-center mt-1">
                        <span className="text-xs text-gray-400 line-through mr-2">{fmtVND(originalPrice)}</span>
                        <span className="bg-orange-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded uppercase">ƯU ĐÃI GIỚI HẠN</span>
                      </div>
                      <p className="text-sm font-black text-orange-500 mt-1">{fmtVND(displayPrice)}</p>
                      <p className="text-xs text-green-600 font-medium mt-1">✓ Bạn tiết kiệm {fmtVND(savings)}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <button
                          onClick={() => handleQtyChange(item.id, bundleQty - 1)}
                          disabled={!!updating}
                          className={`w-7 h-7 rounded-full border border-gray-300 bg-white flex items-center justify-center text-sm hover:bg-gray-50 transition-colors ${updating ? 'opacity-40' : ''}`}
                        >−</button>
                        <span className="font-bold text-sm min-w-[20px] text-center">{bundleQty}</span>
                        <button
                          onClick={() => handleQtyChange(item.id, bundleQty + 1)}
                          disabled={!!updating}
                          className={`w-7 h-7 rounded-full border border-gray-300 bg-white flex items-center justify-center text-sm hover:bg-gray-50 transition-colors ${updating ? 'opacity-40' : ''}`}
                        >+</button>
                      </div>
                    </div>

                    {/* Delete */}
                     <button
                       onClick={() => handleDelete(item.id)}
                       disabled={updating === item.id}
                       className={`text-gray-400 hover:text-gray-600 text-lg leading-none flex-shrink-0 ${updating === item.id ? 'opacity-40' : ''}`}
                     >🗑️</button>
                  </div>

                  {/* Gifts */}
                  {gifts.length > 0 && (
                    <div style={S.giftBox}>
                       <p style={S.giftTitle}>🎁 Quà tặng kèm ({gifts.length} món)</p>
                      {gifts.map((g: any, i: number) => (
                        <div key={i} style={S.giftRow}>
                          {g.image
                            ? <img src={g.image} style={{ width: 32, height: 32, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} alt={g.name} />
                            : <span style={{ fontSize: 18, flexShrink: 0 }}>🎁</span>
                          }
                          <span style={{ fontSize: 12, color: "#374151", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</span>
                          <span style={{ fontSize: 11, color: "#9ca3af", textDecoration: "line-through", flexShrink: 0 }}>{fmtVND(g.value || 0)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Trust Badges */}
        {sortedItems.length > 0 && (
          <div className="flex justify-around items-center p-4 bg-gray-50 border-t border-b border-gray-200 flex-shrink-0">
            <div className="flex flex-col items-center gap-1 flex-1">
              <span className="text-xl">⭐</span>
              <span className="text-[10px] font-semibold text-gray-700 text-center">10.000+ ĐÁNH GIÁ 5 SAO</span>
            </div>
            <div className="flex flex-col items-center gap-1 flex-1">
              <span className="text-xl">🔄</span>
              <span className="text-[10px] font-semibold text-gray-700 text-center">ĐỔI TRẢ MIỄN PHÍ TRONG 7 NGÀY</span>
            </div>
            <div className="flex flex-col items-center gap-1 flex-1">
              <span className="text-xl">🚚</span>
              <span className="text-[10px] font-semibold text-gray-700 text-center">FREESHIP ĐƠN TỪ 0Đ CHO THÀNH VIÊN</span>
            </div>
            <div className="flex flex-col items-center gap-1 flex-1">
              <span className="text-xl">📞</span>
              <span className="text-[10px] font-semibold text-gray-700 text-center">HỖ TRỢ 24/7: 0967 993 609</span>
            </div>
          </div>
        )}

        {/* Footer */}
        {sortedItems.length > 0 && (
          <div className="border-t border-gray-200 p-4 bg-gray-50 flex-shrink-0">
            {/* Promo Code */}
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                placeholder="Nhập mã giảm giá"
                value={promoCode}
                onChange={e => setPromoCode(e.target.value)}
                className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm outline-none focus:border-orange-400"
              />
              <button onClick={handleApplyPromo} disabled={applyingPromo} className={`bg-orange-500 text-white rounded px-4 py-2 text-sm font-semibold hover:bg-orange-600 transition-colors ${applyingPromo ? 'opacity-60' : ''}`}>
                {applyingPromo ? "Đang áp dụng..." : "Áp dụng"}
              </button>
            </div>

            {/* Freeship Reminder */}
            {subtotal < freeshipThreshold ? (
              <div className="bg-yellow-100 text-amber-800 p-3 rounded-lg text-sm mb-3 text-center">
                🎁 Mua thêm {fmtVND(freeshipThreshold - subtotal)} để được FREESHIP
              </div>
            ) : (
              <div className="bg-green-100 text-green-800 p-3 rounded-lg text-sm mb-3 text-center">
                ✅ Đơn hàng của bạn được FREESHIP
              </div>
            )}

            {savings > 0 && (
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-sm text-green-700 font-semibold">Tiết kiệm được</span>
                <span className="text-sm text-green-700 font-bold">-{fmtVND(savings)}</span>
              </div>
            )}
            <div className="flex justify-between items-center mb-3.5">
              <span className="text-base font-black text-gray-900">Tổng cộng</span>
              <span className="text-lg font-black text-orange-500">{fmtVND(subtotal)}</span>
            </div>
            <LocalizedClientLink href="/checkout" onClick={() => setOpen(false)} className="block w-full bg-orange-500 text-white font-black text-base py-3.5 rounded-lg text-center hover:bg-orange-600 transition-colors no-underline">
              Tiến hành thanh toán
            </LocalizedClientLink>
            <div className="flex justify-center items-center gap-3 mt-3 flex-wrap">
              <span className="text-lg opacity-70">💵 COD</span>
              <span className="text-lg opacity-70">💳 Momo</span>
              <span className="text-lg opacity-70">🏦 VNPay</span>
              <span className="text-lg opacity-70">💳 Visa</span>
              <span className="text-lg opacity-70">🍎 Pay</span>
              <span className="text-lg opacity-70">🇬 Pay</span>
              <span className="text-lg opacity-70">💳 MC</span>
            </div>
            <button onClick={() => setOpen(false)} className="block w-full bg-none border-none cursor-pointer text-center text-sm text-gray-500 py-1 hover:text-gray-700">
              Tiếp tục mua hàng
            </button>
          </div>
        )}
      </div>
    </>
  )
}

export default CartDropdown
