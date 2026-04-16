"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import { HttpTypes } from "@medusajs/types"
import { deleteLineItem, updateLineItem, applyPromotions } from "@lib/data/cart"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

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

const CartDropdown = ({ cart }: { cart?: HttpTypes.StoreCart | null }) => {
  const [open, setOpen] = useState(false)
  const [updating, setUpdating] = useState<string | null>(null)
  const [promoCode, setPromoCode] = useState("")
  const [applyingPromo, setApplyingPromo] = useState(false)
  const itemRef = useRef(0)
  const pathname = usePathname()

  const totalItems = cart?.items?.reduce((acc, i) => acc + i.quantity, 0) || 0
  const subtotal = cart?.subtotal ?? 0
  const originalTotal = cart?.items?.reduce((acc, item) => acc + (item.unit_price || 0) * item.quantity, 0) || 0
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
    if (qty < 1) return
    setUpdating(id)
    await updateLineItem({ lineId: id, quantity: qty })
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
        style={{ position: "relative", background: "none", border: "none", cursor: "pointer", padding: 8 }}
        aria-label="Giỏ hàng"
      >
        <span style={{ fontSize: 20 }}>🛒</span>
        {totalItems > 0 && (
          <span style={{
            position: "absolute", top: 0, right: 0,
            backgroundColor: "#f97316", color: "#fff",
            fontSize: 10, fontWeight: 900,
            width: 16, height: 16, borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {totalItems > 9 ? "9+" : totalItems}
          </span>
        )}
      </button>

      {/* Overlay */}
      {open && <div style={S.overlay} onClick={() => setOpen(false)} />}

      {/* Drawer */}
      <div style={S.drawer}>
        {/* Header */}
        <div style={S.header}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 900, color: "#111827" }}>
            Giỏ hàng
            {totalItems > 0 && (
              <span style={{ fontWeight: 400, fontSize: 14, color: "#9ca3af", marginLeft: 6 }}>
                • {totalItems} sản phẩm
              </span>
            )}
          </h2>
          <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 24, color: "#9ca3af", lineHeight: 1 }}>×</button>
        </div>

        {/* Urgency Bar */}
        {totalItems > 0 && (
          <div style={S.urgencyBar}>
            ⏰ Giỏ hàng sẽ hết hạn sau <Countdown seconds={299} />
          </div>
        )}



        {/* Items */}
        <div style={S.itemsArea}>
          {sortedItems.length === 0 ? (
             <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12, textAlign: "center" }}>
               <span style={{ fontSize: 48 }}>🛒</span>
               <p style={{ color: "#6b7280", margin: 0 }}>Giỏ hàng của bạn đang trống</p>
               <LocalizedClientLink
                 href="/store"
                 onClick={() => setOpen(false)}
                 style={{ backgroundColor: "#f97316", color: "#fff", padding: "10px 20px", borderRadius: 10, fontWeight: 700, fontSize: 13, textDecoration: "none" }}
               >
                 Khám phá sản phẩm
               </LocalizedClientLink>
             </div>
          ) : (
            sortedItems.map((item) => {
              const gifts = (() => {
                try { return JSON.parse((item.metadata?.gifts as string) || "[]") } catch { return [] }
              })()
              const thumb = item.variant?.product?.thumbnail || (item as any).thumbnail
              const originalPrice = (item.unit_price || 0) * 1.5 / 100
              const salePrice = (item.unit_price || 0) / 100
              const savings = (originalPrice - salePrice) * item.quantity
              const variantText = item.variant?.options?.map(o => `${o.option?.title}: ${o.value}`).join(" | ") || ""

              return (
                <div key={item.id} style={S.itemCard}>
                  <div style={S.itemRow}>
                    {/* Thumb */}
                    <div style={S.thumb}>
                      {thumb
                        ? <img src={thumb} alt={item.title || ""} style={S.thumbImg} />
                        : <span style={{ fontSize: 24 }}>🛍️</span>
                      }
                    </div>

                    {/* Info */}
                    <div style={S.info}>
                      <p style={S.name}>{item.title || (item as any).product_title}</p>
                      {variantText && <p style={S.variant}>{variantText}</p>}
                      <div style={{ display: "flex", alignItems: "center", marginTop: 4 }}>
                        <span style={S.originalPrice}>{fmtVND(originalPrice)}</span>
                        <span style={S.salePrice}>{fmtVND(salePrice)}</span>
                        <span style={S.tag}>ƯU ĐÃI GIỚI HẠN</span>
                      </div>
                      <p style={S.totalPrice}>{fmtVND(salePrice * item.quantity)}</p>
                      <p style={S.savings}>✓ Bạn tiết kiệm {fmtVND(savings)}</p>
                      <div style={S.qtyRow}>
                        <button
                          onClick={() => handleQtyChange(item.id, item.quantity - 1)}
                          disabled={!!updating}
                          style={{ ...S.qtyBtn, opacity: updating ? 0.4 : 1 }}
                        >−</button>
                        <span style={{ fontWeight: 700, fontSize: 13, minWidth: 20, textAlign: "center" }}>{item.quantity}</span>
                        <button
                          onClick={() => handleQtyChange(item.id, item.quantity + 1)}
                          disabled={!!updating}
                          style={{ ...S.qtyBtn, opacity: updating ? 0.4 : 1 }}
                        >+</button>
                      </div>
                    </div>

                    {/* Delete */}
                     <button
                       onClick={() => handleDelete(item.id)}
                       disabled={updating === item.id}
                       style={{ ...S.deleteBtn, opacity: updating === item.id ? 0.4 : 1 }}
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
          <div style={S.trustBadges}>
            <div style={S.trustItem}>
              <span style={S.trustIcon}>⭐</span>
              <span style={S.trustText}>10.000+ ĐÁNH GIÁ 5 SAO</span>
            </div>
            <div style={S.trustItem}>
              <span style={S.trustIcon}>🔄</span>
              <span style={S.trustText}>ĐỔI TRẢ MIỄN PHÍ TRONG 7 NGÀY</span>
            </div>
            <div style={S.trustItem}>
              <span style={S.trustIcon}>🚚</span>
              <span style={S.trustText}>FREESHIP ĐƠN TỪ 0Đ CHO THÀNH VIÊN</span>
            </div>
            <div style={S.trustItem}>
              <span style={S.trustIcon}>📞</span>
              <span style={S.trustText}>HỖ TRỢ 24/7: 1900.XXX.XXX</span>
            </div>
          </div>
        )}

        {/* Footer */}
        {sortedItems.length > 0 && (
          <div style={S.footer}>
            {/* Promo Code */}
            <div style={S.promoRow}>
              <input
                type="text"
                placeholder="Nhập mã giảm giá"
                value={promoCode}
                onChange={e => setPromoCode(e.target.value)}
                style={S.promoInput}
              />
              <button onClick={handleApplyPromo} disabled={applyingPromo} style={{ ...S.promoBtn, opacity: applyingPromo ? 0.6 : 1 }}>
                {applyingPromo ? "Đang áp dụng..." : "Áp dụng"}
              </button>
            </div>

            {/* Freeship Reminder */}
            {subtotal < freeshipThreshold ? (
              <div style={S.freeship}>
                🎁 Mua thêm {fmtVND(freeshipThreshold - subtotal / 100)} để được FREESHIP
              </div>
            ) : (
              <div style={{ ...S.freeship, backgroundColor: "#d1fae5", color: "#065f46" }}>
                ✅ Đơn hàng của bạn được FREESHIP
              </div>
            )}

            {savings > 0 && (
              <div style={{ ...S.totalRow, marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: "#16a34a", fontWeight: 600 }}>Tiết kiệm được</span>
                <span style={{ fontSize: 13, color: "#16a34a", fontWeight: 700 }}>-{fmtVND(savings / 100)}</span>
              </div>
            )}
            <div style={{ ...S.totalRow, marginBottom: 14 }}>
              <span style={{ fontWeight: 900, fontSize: 16, color: "#111827" }}>Tổng cộng</span>
              <span style={{ fontWeight: 900, fontSize: 18, color: "#f97316" }}>{fmtVND(subtotal / 100)}</span>
            </div>
            <LocalizedClientLink href="/checkout" onClick={() => setOpen(false)} style={S.checkoutBtn}>
              Tiến hành thanh toán
            </LocalizedClientLink>
            <div style={S.paymentIcons}>
              <span style={S.paymentIcon}>💵 COD</span>
              <span style={S.paymentIcon}>💳 Momo</span>
              <span style={S.paymentIcon}>🏦 VNPay</span>
              <span style={S.paymentIcon}>💳 Visa</span>
              <span style={S.paymentIcon}>🍎 Pay</span>
              <span style={S.paymentIcon}>🇬 Pay</span>
              <span style={S.paymentIcon}>💳 MC</span>
            </div>
            <button onClick={() => setOpen(false)} style={S.continueBtn}>
              Tiếp tục mua hàng
            </button>
          </div>
        )}
      </div>
    </>
  )
}

export default CartDropdown
