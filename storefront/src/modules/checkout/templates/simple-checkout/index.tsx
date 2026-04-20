"use client"

import { useState, useEffect } from "react"
import { HttpTypes } from "@medusajs/types"
import {
  updateCart,
  placeOrder,
  setShippingMethod,
  ensurePaymentSession,
  applyPromotions,
  updateLineItem,
  deleteLineItem,
} from "@lib/data/cart"
import { convertToLocale } from "@lib/util/money"
import { useRouter } from "next/navigation"
import { useParams } from "next/navigation"
import Thumbnail from "@modules/products/components/thumbnail"

const BACKEND = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY || ""
const SEPAY_DISCOUNT = 20000

const sepayHeaders = {
  "Content-Type": "application/json",
  "x-publishable-api-key": PUB_KEY,
}

async function readResponseBody(response: Response) {
  const raw = await response.text()

  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function logCheckoutError(
  stage: string,
  error: unknown,
  extra?: Record<string, unknown>
) {
  const payload =
    error instanceof Error
      ? {
          message: error.message,
          stack: error.stack,
          name: error.name,
        }
      : { error }

  console.error(`[SimpleCheckout] ${stage}`, {
    ...payload,
    ...extra,
  })
}

function formatVND(n: number) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(n)) + "đ"
}

function SepayModal({ orderCode, amount, onClose, onSuccess }: {
  orderCode: string
  amount: number
  onClose: () => void
  onSuccess: () => void
}) {
  const [qrUrl, setQrUrl] = useState("")
  const [info, setInfo] = useState<any>(null)
  const [paid, setPaid] = useState(false)

  useEffect(() => {
    console.info("[SimpleCheckout][SePay] open modal", { orderCode, amount })

    const loadQr = async () => {
      try {
        const response = await fetch(`${BACKEND}/store/sepay/qr`, {
          method: "POST",
          headers: sepayHeaders,
          body: JSON.stringify({ orderCode, amount }),
        })
        const body = await readResponseBody(response)

        if (!response.ok) {
          console.error("[SimpleCheckout][SePay] QR request failed", {
            orderCode,
            amount,
            status: response.status,
            statusText: response.statusText,
            body,
          })
          return
        }

        console.info("[SimpleCheckout][SePay] QR response received", {
          orderCode,
          amount,
          hasQrUrl: Boolean(body?.qrUrl),
        })
        setQrUrl(body?.qrUrl || "")
        setInfo(body)
      } catch (error) {
        logCheckoutError("SePay QR request threw", error, { orderCode, amount })
      }
    }

    void loadQr()

    const iv = setInterval(async () => {
      try {
        const response = await fetch(`${BACKEND}/store/sepay/qr?orderCode=${orderCode}`, {
          headers: sepayHeaders,
        })
        const body = await readResponseBody(response)

        if (!response.ok) {
          console.error("[SimpleCheckout][SePay] status poll failed", {
            orderCode,
            status: response.status,
            statusText: response.statusText,
            body,
          })
          return
        }

        if (body?.paid) {
          console.info("[SimpleCheckout][SePay] payment confirmed", {
            orderCode,
            body,
          })
          setPaid(true)
          clearInterval(iv)
          setTimeout(onSuccess, 1500)
        } else {
          console.info("[SimpleCheckout][SePay] payment not found yet", {
            orderCode,
            body,
          })
        }
      } catch (error) {
        logCheckoutError("SePay status poll threw", error, { orderCode })
      }
    }, 5000)
    return () => clearInterval(iv)
  }, [])

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-sm w-full overflow-hidden shadow-2xl">
        <div className="bg-blue-600 px-5 py-4 text-white text-center">
          <p className="font-black text-lg">Quét mã QR để thanh toán</p>
          <p className="text-blue-200 text-sm mt-1">Mã: <strong className="text-white">PV{orderCode}</strong></p>
        </div>
        <div className="p-5">
          {paid ? (
            <div className="text-center py-8">
              <div className="text-6xl mb-4">✅</div>
              <p className="font-black text-xl text-green-600">Thanh toán thành công!</p>
            </div>
          ) : (
            <>
              <div className="flex justify-center mb-4">
                {qrUrl
                  ? <img src={qrUrl} alt="QR" className="w-56 h-56 rounded-xl border border-gray-200" />
                  : <div className="w-56 h-56 bg-gray-100 rounded-xl flex items-center justify-center"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>
                }
              </div>
              {info && (
                <div className="bg-gray-50 rounded-xl p-4 text-sm space-y-2 mb-4">
                  <div className="flex justify-between"><span className="text-gray-500">Ngân hàng</span><span className="font-bold">{info.bank}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Số tài khoản</span><span className="font-mono font-bold">{info.accountNumber}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Số tiền</span><span className="font-black text-orange-500">{formatVND(amount)}</span></div>
                  <div className="flex justify-between border-t pt-2"><span className="text-gray-500">Nội dung CK</span><span className="font-black text-blue-600">PV{orderCode}</span></div>
                </div>
              )}
              <p className="text-center text-xs text-gray-400 mb-3">🔄 Tự động xác nhận khi nhận được tiền</p>
              <button onClick={onClose} className="w-full py-2.5 rounded-xl border border-gray-300 text-gray-600 text-sm hover:bg-gray-50">Quay lại chọn COD</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function useCountdown(minutes: number) {
  const [secs, setSecs] = useState(minutes * 60)
  useEffect(() => {
    const t = setInterval(() => setSecs(s => (s > 0 ? s - 1 : 0)), 1000)
    return () => clearInterval(t)
  }, [])
  const m = String(Math.floor(secs / 60)).padStart(2, "0")
  const s = String(secs % 60).padStart(2, "0")
  return { m, s, expired: secs === 0 }
}

export default function SimpleCheckout({ cart, shippingOptions }: { cart: HttpTypes.StoreCart, shippingOptions: any[] | null }) {
  const router = useRouter()
  const params = useParams()
  const countryCode = params.countryCode as string
  const countdown = useCountdown(12)

  const [form, setForm] = useState({ name: "", phone: "", street: "", note: "", province: "", ward: "" })
  const [provinces, setProvinces] = useState<{ code: number; name: string }[]>([])
  const [wards, setWards] = useState<{ code: number; name: string }[]>([])
  const [wardSearch, setWardSearch] = useState("")
  const [wardOpen, setWardOpen] = useState(false)
  const [loadingWards, setLoadingWards] = useState(false)
  const [provinceSearch, setProvinceSearch] = useState("")
  const [provinceOpen, setProvinceOpen] = useState(false)
  const [payment, setPayment] = useState<"cod" | "sepay">("cod")
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [showQR, setShowQR] = useState(false)
  const [orderId, setOrderId] = useState("")
  const [promoCode, setPromoCode] = useState("")
  const [promoApplied, setPromoApplied] = useState(false)
  const [promoError, setPromoError] = useState("")
  const [promoLoading, setPromoLoading] = useState(false)
  const [qtyLoading, setQtyLoading] = useState<Record<string, boolean>>({})

  const handleQtyChange = async (lineId: string, newQty: number) => {
    setQtyLoading(s => ({ ...s, [lineId]: true }))
    try {
      if (newQty < 1) {
        await deleteLineItem(lineId)
      } else {
        await updateLineItem({ lineId, quantity: newQty })
      }
      window.location.reload()
    } catch (e) {
      console.error("[SimpleCheckout] qty change failed", e)
    } finally {
      setQtyLoading(s => ({ ...s, [lineId]: false }))
    }
  }

  // Load provinces on mount
  useEffect(() => {
    fetch("https://provinces.open-api.vn/api/?depth=1")
      .then(r => r.json())
      .then((data: any[]) => setProvinces(data.map((p: any) => ({ code: p.code, name: p.name }))))
      .catch(() => {})
  }, [])

  // Load wards when province changes
  useEffect(() => {
    if (!form.province) { setWards([]); return }
    const prov = provinces.find(p => p.name === form.province)
    if (!prov) return
    setLoadingWards(true)
    setWards([])
    setForm((f: typeof form) => ({ ...f, ward: "" }))
    setWardSearch("")
    fetch(`https://provinces.open-api.vn/api/p/${prov.code}?depth=3`)
      .then(r => r.json())
      .then((data: any) => {
        const allWards = (data.districts || []).flatMap((d: any) => d.wards || [])
        setWards(allWards.map((w: any) => ({ code: w.code, name: w.name })))
      })
      .catch(() => {})
      .finally(() => setLoadingWards(false))
  }, [form.province, provinces])

  // Load saved form data
  useEffect(() => {
    const saved = localStorage.getItem('phanviet_checkout_form')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        setForm(parsed.form || { name: "", phone: "", street: "", note: "", province: "", ward: "" })
        setPayment(parsed.payment || "cod")
      } catch (e) {
        // ignore
      }
    }
  }, [])

  // Save form data on change
  useEffect(() => {
    localStorage.setItem('phanviet_checkout_form', JSON.stringify({ form, payment }))
  }, [form, payment])

  useEffect(() => {
    console.info("[SimpleCheckout] checkout screen ready", {
      cartId: cart.id,
      countryCode,
      payment,
      itemCount: cart.items?.length ?? 0,
      shippingOptions: shippingOptions?.length ?? 0,
    })
  }, [cart.id, countryCode, payment, shippingOptions?.length])

  const sortedItems = [...(cart.items || [])].sort((a, b) =>
    (a.created_at ?? "") > (b.created_at ?? "") ? -1 : 1
  )

  const subtotal = cart.subtotal ?? 0
  const promoDiscount = (cart as any).discount_total ?? 0
  const sepayTotal = Math.max(0, subtotal - promoDiscount - SEPAY_DISCOUNT)
  const baseTotal = Math.max(0, subtotal - promoDiscount)
  const finalTotal = payment === "sepay" ? sepayTotal : baseTotal

  const handleApplyPromo = async () => {
    if (!promoCode.trim()) return
    setPromoLoading(true)
    setPromoError("")
    try {
      await applyPromotions([promoCode.trim().toUpperCase()])
      setPromoApplied(true)
      // Reload page to get updated cart totals from server
      window.location.reload()
    } catch (e: any) {
      setPromoError("Mã không hợp lệ hoặc đã hết hạn")
      setPromoApplied(false)
    } finally {
      setPromoLoading(false)
    }
  }

  const buildAddress = () =>
    [form.street, form.ward, form.province].filter(Boolean).join(", ")

  const validate = () => {
    const e: Record<string, string> = {}
    if (!form.name.trim()) e.name = "Vui lòng nhập họ tên"
    if (!/^(0|\+84)[0-9]{8,9}$/.test(form.phone.replace(/\s/g, ""))) e.phone = "Số điện thoại không hợp lệ"
    if (!form.street.trim()) e.street = "Vui lòng nhập số nhà, tên đường"
    if (!form.province) e.province = "Vui lòng chọn tỉnh/thành phố"
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = async () => {
    if (!validate()) return
    setSubmitting(true)

    try {
      console.info("[SimpleCheckout] submit start", {
        cartId: cart.id,
        payment,
        countryCode,
      })

      // Cập nhật cart với thông tin giao hàng
      const fullAddress = buildAddress()
      const updatedCart = await updateCart({
        email: `guest${Date.now()}@example.com`,
        shipping_address: {
          first_name: form.name,
          last_name: "",
          address_1: fullAddress,
          city: form.province || "Việt Nam",
          country_code: countryCode || "vn",
          phone: form.phone,
        },
        billing_address: {
          first_name: form.name,
          last_name: "",
          address_1: fullAddress,
          city: form.province || "Việt Nam",
          country_code: countryCode || "vn",
          phone: form.phone,
        },
        metadata: {
          note: form.note,
          payment_method: payment,
        }
      })
      console.info("[SimpleCheckout] cart updated", {
        cartId: updatedCart.id,
        email: updatedCart.email,
        shippingMethods: updatedCart.shipping_methods?.length ?? 0,
      })

      // Set default shipping method
      if (shippingOptions && shippingOptions.length > 0) {
        await setShippingMethod({
          cartId: updatedCart.id,
          shippingMethodId: shippingOptions[0].id,
        })
        console.info("[SimpleCheckout] shipping method set", {
          cartId: updatedCart.id,
          shippingMethodId: shippingOptions[0].id,
        })
      }

      const preferredProviderId = payment === "sepay" ? "sepay" : "pp_system_default"
      const resolvedProviderId = await ensurePaymentSession(
        updatedCart.id,
        preferredProviderId
      )

      console.info("[SimpleCheckout] payment session ready", {
        cartId: updatedCart.id,
        preferredProviderId,
        resolvedProviderId,
      })

      if (payment === "sepay") {
        const code = Date.now().toString(36).toUpperCase()
        setOrderId(code)
        setShowQR(true)
        setSubmitting(false)
        return
      }

      // COD: đặt hàng sau khi payment session đã được tạo
      console.info("[SimpleCheckout] placing COD order", {
        cartId: updatedCart.id,
      })

      const result: any = await placeOrder().catch((error) => {
        logCheckoutError("placeOrder failed for COD", error, {
          cartId: updatedCart.id,
          payment,
        })
        throw error
      })

      console.info("[SimpleCheckout] placeOrder result", {
        cartId: updatedCart.id,
        resultType: result?.type,
        orderId: result?.order?.id,
      })

      if (result?.type === "order") {
        router.push(`/${countryCode}/order/confirmed/${result.order.id}`)
      }
    } catch (err) {
      logCheckoutError("handleSubmit failed", err, {
        cartId: cart.id,
        payment,
        countryCode,
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleSepaySuccess = async () => {
    setShowQR(false)
    setSubmitting(true)
    try {
      console.info("[SimpleCheckout] SePay confirmed, placing order", {
        cartId: cart.id,
        orderCode: orderId,
      })

      const result: any = await placeOrder().catch((error) => {
        logCheckoutError("placeOrder failed after SePay success", error, {
          cartId: cart.id,
          orderCode: orderId,
        })
        throw error
      })

      console.info("[SimpleCheckout] placeOrder result after SePay", {
        cartId: cart.id,
        orderCode: orderId,
        resultType: result?.type,
        orderId: result?.order?.id,
      })

      if (result?.type === "order") {
        router.push(`/${countryCode}/order/confirmed/${result.order.id}`)
      }
    } catch (err) {
      logCheckoutError("handleSepaySuccess failed", err, {
        cartId: cart.id,
        orderCode: orderId,
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {showQR && (
        <SepayModal
          orderCode={orderId}
          amount={sepayTotal}
          onClose={() => setShowQR(false)}
          onSuccess={handleSepaySuccess}
        />
      )}

      <div className="min-h-screen bg-gray-50">
        {/* Countdown banner */}
        <div className={`px-4 py-2.5 text-center text-sm font-black tracking-wide ${countdown.expired ? "bg-red-600" : "bg-orange-500"} text-white`}>
          {countdown.expired
            ? "⚠️ Hết thời gian giữ đơn — hãy đặt hàng ngay!"
            : <>⏳ Đơn hàng được giữ trong <span className="tabular-nums bg-white/20 rounded px-1">{countdown.m}:{countdown.s}</span> — Hoàn tất ngay kẻo mất!</>
          }
        </div>

        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-4 py-4">
          <div className="max-w-4xl mx-auto flex items-center gap-3">
            <a href={`/${countryCode}`} className="text-gray-400 hover:text-gray-600 text-xl">←</a>
            <span className="font-black text-lg text-gray-900">PHAN VIỆT</span>
            <span className="text-gray-300">|</span>
            <span className="text-gray-500 text-sm">Đặt hàng</span>
          </div>
        </div>

        <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">

          {/* ĐƠN HÀNG — luôn hiện trên cùng */}
          <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100">
            <div className="bg-orange-500 px-5 py-3 flex items-center justify-between">
              <h2 className="font-black text-white text-base">📦 Đơn hàng của bạn</h2>
              <span className="text-orange-100 text-xs font-semibold">{sortedItems.length} sản phẩm</span>
            </div>
            <div className="p-5 space-y-4">
              {sortedItems.map((item) => {
                const gifts = (() => {
                  try {
                    const parsed = JSON.parse((item.metadata?.gifts as string) || "[]")
                    console.log("[checkout debug] item", item.id, "metadata:", item.metadata, "gifts:", parsed)
                    return parsed
                  } catch { return [] }
                })()

                return (
                  <div key={item.id}>
                    <div className="flex gap-3 items-start">
                      <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 border border-gray-100">
                        <Thumbnail
                          thumbnail={item.variant?.product?.thumbnail}
                          images={item.variant?.product?.images}
                          size="square"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm text-gray-900 line-clamp-2">{item.title}</p>
                        <p className="font-black text-orange-500 text-sm mt-1">
                          {convertToLocale({ amount: item.unit_price * item.quantity, currency_code: cart.currency_code })}
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          <button
                            onClick={() => handleQtyChange(item.id, item.quantity - 1)}
                            disabled={qtyLoading[item.id]}
                            className="w-7 h-7 rounded-lg border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-100 disabled:opacity-40 font-bold text-base leading-none"
                          >−</button>
                          <span className="text-sm font-bold text-gray-900 w-6 text-center">
                            {qtyLoading[item.id] ? "…" : item.quantity}
                          </span>
                          <button
                            onClick={() => handleQtyChange(item.id, item.quantity + 1)}
                            disabled={qtyLoading[item.id]}
                            className="w-7 h-7 rounded-lg border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-100 disabled:opacity-40 font-bold text-base leading-none"
                          >+</button>
                        </div>
                      </div>
                    </div>

                    {/* Gifts — hiện nổi bật */}
                    {gifts.length > 0 && (
                      <div className="mt-3 bg-orange-50 border border-orange-100 rounded-xl p-3 space-y-2">
                        {gifts.map((g: any, i: number) => (
                          <div key={i} className="flex items-center gap-2.5">
                            <span className="text-lg flex-shrink-0">🎁</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-orange-600">QUÀ TẶNG MIỄN PHÍ</p>
                              <p className="text-xs text-gray-700 font-semibold line-clamp-1">{g.name}</p>
                            </div>
                            <span className="text-xs text-gray-400 line-through flex-shrink-0">{formatVND(g.value || 0)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Promo code */}
              <div className="border-t border-gray-100 pt-4">
                {promoApplied || (cart as any).promotions?.length > 0 ? (
                  <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2.5">
                    <span className="text-green-500 text-lg">✅</span>
                    <div className="flex-1">
                      <p className="text-sm font-bold text-green-700">Mã giảm giá đã áp dụng!</p>
                      <p className="text-xs text-green-600">Bạn tiết kiệm thêm {formatVND(promoDiscount)}</p>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-2">🏷️ Mã giảm giá</p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={promoCode}
                        onChange={e => { setPromoCode(e.target.value); setPromoError("") }}
                        onKeyDown={e => e.key === "Enter" && handleApplyPromo()}
                        placeholder="Nhập mã (VD: LANHDAU5)"
                        className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400 uppercase placeholder:normal-case"
                      />
                      <button
                        onClick={handleApplyPromo}
                        disabled={promoLoading || !promoCode.trim()}
                        className="bg-gray-900 text-white text-sm font-bold px-4 py-2.5 rounded-xl disabled:opacity-40 hover:bg-gray-700 transition-colors whitespace-nowrap"
                      >
                        {promoLoading ? "..." : "Áp dụng"}
                      </button>
                    </div>
                    {promoError && <p className="text-red-500 text-xs mt-1.5">{promoError}</p>}
                    <p className="text-xs text-blue-600 font-semibold mt-1.5">💡 Lần đầu mua? Dùng mã <strong>LANHDAU5</strong> giảm 5%</p>
                  </div>
                )}
              </div>

              {/* Totals */}
              <div className="border-t border-gray-100 pt-4 space-y-2">
                <div className="flex justify-between text-sm text-gray-500">
                  <span>Giá gốc</span>
                  <span className="line-through">{convertToLocale({ amount: subtotal, currency_code: cart.currency_code })}</span>
                </div>
                {promoDiscount > 0 && (
                  <div className="flex justify-between text-sm text-green-600 font-semibold">
                    <span>Mã giảm giá</span>
                    <span>-{formatVND(promoDiscount)}</span>
                  </div>
                )}
                {payment === "sepay" && (
                  <div className="flex justify-between text-sm text-green-600 font-semibold">
                    <span>Giảm thanh toán QR</span>
                    <span>-{formatVND(SEPAY_DISCOUNT)}</span>
                  </div>
                )}
                <div className="flex justify-between font-black text-xl pt-2 border-t border-gray-200">
                  <span>Tổng cộng</span>
                  <span className="text-orange-500">{formatVND(finalTotal)}</span>
                </div>
                {(() => {
                  const saved = subtotal - finalTotal
                  return saved > 0 ? (
                    <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-2.5 flex items-center gap-2">
                      <span className="text-green-500 text-lg">🎉</span>
                      <p className="text-sm font-black text-green-700">
                        Bạn tiết kiệm được <span className="text-green-600">{formatVND(saved)}</span> cho đơn hàng này!
                      </p>
                    </div>
                  ) : null
                })()}
              </div>
            </div>
          </div>

          {/* FORM + PAYMENT — 1 cột, đơn giản */}
          <div className="space-y-4">
            {/* Shipping info */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <h2 className="font-black text-base text-gray-900 mb-4">🚚 Thông tin giao hàng</h2>
              <div className="space-y-3">
                <div>
                  <input
                    type="text"
                    placeholder="Họ và tên *"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className={`w-full border rounded-xl px-4 py-3 text-sm outline-none focus:border-orange-400 transition-colors ${errors.name ? "border-red-400" : "border-gray-200"}`}
                  />
                  {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name}</p>}
                </div>
                <div>
                  <input
                    type="tel"
                    placeholder="Số điện thoại *"
                    value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    className={`w-full border rounded-xl px-4 py-3 text-sm outline-none focus:border-orange-400 transition-colors ${errors.phone ? "border-red-400" : "border-gray-200"}`}
                  />
                  {errors.phone && <p className="text-red-500 text-xs mt-1">{errors.phone}</p>}
                </div>
                {/* Tỉnh/Thành phố — searchable */}
                <div className="relative">
                  <div
                    onClick={() => setProvinceOpen(o => !o)}
                    className={`w-full border rounded-xl px-4 py-3 text-sm cursor-pointer flex items-center justify-between bg-white ${errors.province ? "border-red-400" : "border-gray-200"}`}
                  >
                    <span className={form.province ? "text-gray-900" : "text-gray-400"}>
                      {form.province || "-- Chọn Tỉnh / Thành phố * --"}
                    </span>
                    <span className="text-gray-400 text-xs">{provinceOpen ? "▲" : "▼"}</span>
                  </div>
                  {provinceOpen && (
                    <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                      <div className="p-2 border-b border-gray-100">
                        <input
                          autoFocus
                          type="text"
                          value={provinceSearch}
                          onChange={e => setProvinceSearch(e.target.value)}
                          placeholder="Tìm tỉnh/thành phố..."
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-orange-400"
                        />
                      </div>
                      <div className="max-h-48 overflow-y-auto">
                        {provinces
                          .filter(p => p.name.toLowerCase().includes(provinceSearch.toLowerCase()))
                          .map(p => (
                            <div
                              key={p.code}
                              onClick={() => { setForm((f: typeof form) => ({ ...f, province: p.name, ward: "" })); setProvinceOpen(false); setProvinceSearch("") }}
                              className={`px-4 py-2.5 text-sm cursor-pointer hover:bg-orange-50 ${form.province === p.name ? "bg-orange-50 font-bold text-orange-600" : "text-gray-700"}`}
                            >
                              {p.name}
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                  {errors.province && <p className="text-red-500 text-xs mt-1">{errors.province}</p>}
                </div>

                {/* Phường/Xã — searchable */}
                {form.province && (
                  <div className="relative">
                    <div
                      onClick={() => { if (!loadingWards && wards.length > 0) setWardOpen(o => !o) }}
                      className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm cursor-pointer flex items-center justify-between bg-white"
                    >
                      <span className={form.ward ? "text-gray-900" : "text-gray-400"}>
                        {loadingWards ? "Đang tải phường/xã..." : form.ward || "Chọn Phường / Xã (tuỳ chọn)"}
                      </span>
                      <span className="text-gray-400 text-xs">{wardOpen ? "▲" : "▼"}</span>
                    </div>
                    {wardOpen && (
                      <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                        <div className="p-2 border-b border-gray-100">
                          <input
                            autoFocus
                            type="text"
                            value={wardSearch}
                            onChange={e => setWardSearch(e.target.value)}
                            placeholder="Tìm phường/xã..."
                            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-orange-400"
                          />
                        </div>
                        <div className="max-h-48 overflow-y-auto">
                          {wards
                            .filter(w => w.name.toLowerCase().includes(wardSearch.toLowerCase()))
                            .map(w => (
                              <div
                                key={w.code}
                                onClick={() => { setForm(f => ({ ...f, ward: w.name })); setWardOpen(false); setWardSearch("") }}
                                className={`px-4 py-2.5 text-sm cursor-pointer hover:bg-orange-50 ${form.ward === w.name ? "bg-orange-50 font-bold text-orange-600" : "text-gray-700"}`}
                              >
                                {w.name}
                              </div>
                            ))}
                          {wards.filter(w => w.name.toLowerCase().includes(wardSearch.toLowerCase())).length === 0 && (
                            <p className="px-4 py-3 text-sm text-gray-400">Không tìm thấy</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Số nhà, tên đường */}
                <div>
                  <input
                    type="text"
                    placeholder="Số nhà, tên đường *"
                    value={form.street}
                    onChange={e => setForm(f => ({ ...f, street: e.target.value }))}
                    className={`w-full border rounded-xl px-4 py-3 text-sm outline-none focus:border-orange-400 transition-colors ${errors.street ? "border-red-400" : "border-gray-200"}`}
                  />
                  {errors.street && <p className="text-red-500 text-xs mt-1">{errors.street}</p>}
                </div>
                <textarea
                  placeholder="Ghi chú (màu sắc, số lượng khác...)"
                  value={form.note}
                  onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                  rows={2}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-orange-400 transition-colors resize-none"
                />
              </div>
            </div>

            {/* Payment method */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <h2 className="font-black text-base text-gray-900 mb-4">💳 Phương thức thanh toán</h2>
              <div className="space-y-3">
                <label className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${payment === "cod" ? "border-orange-500 bg-orange-50" : "border-gray-200"}`}>
                  <input type="radio" name="payment" value="cod" checked={payment === "cod"} onChange={() => setPayment("cod")} className="accent-orange-500" />
                  <div className="flex-1">
                    <p className="font-bold text-sm text-gray-900">Thu tiền khi nhận hàng (COD)</p>
                    <p className="text-xs text-gray-500">Kiểm tra hàng trước, thanh toán sau</p>
                  </div>
                  <span className="text-2xl">💵</span>
                </label>

                <label className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${payment === "sepay" ? "border-blue-600 bg-blue-50" : "border-gray-200"}`}>
                  <input type="radio" name="payment" value="sepay" checked={payment === "sepay"} onChange={() => setPayment("sepay")} className="accent-blue-600" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-sm text-gray-900">Chuyển khoản QR</p>
                      <span className="bg-green-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full">GIẢM {formatVND(SEPAY_DISCOUNT)}</span>
                    </div>
                    <p className="text-xs text-gray-500">Quét mã QR — mọi ngân hàng đều được</p>
                  </div>
                  <span className="text-2xl">📱</span>
                </label>
              </div>
            </div>

            {/* Trust badges */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                { icon: "✅", text: "Kiểm tra hàng trước khi thanh toán" },
                { icon: "🔄", text: "Đổi trả miễn phí trong 7 ngày" },
                { icon: "🛡️", text: "Bảo hành chính hãng 12 tháng" },
                { icon: "🚚", text: "Giao hàng toàn quốc 1-3 ngày" },
              ].map(b => (
                <div key={b.text} className="flex items-center gap-1.5 bg-gray-50 rounded-lg px-2.5 py-2">
                  <span>{b.icon}</span>
                  <span className="text-gray-600 font-medium leading-tight">{b.text}</span>
                </div>
              ))}
            </div>

            {/* CTA */}
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-black text-xl py-5 rounded-xl transition-all active:scale-95 disabled:opacity-70 shadow-lg shadow-orange-200"
            >
              {submitting ? "⏳ Đang xử lý..." : payment === "sepay" ? "💳 THANH TOÁN QR NGAY" : "🛒 ĐẶT HÀNG NGAY →"}
            </button>

            <p className="text-center text-xs text-gray-400">
              Bằng cách đặt hàng, bạn đồng ý với <span className="underline">chính sách đổi trả</span> của chúng tôi
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
