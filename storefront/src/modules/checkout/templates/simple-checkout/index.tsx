"use client"

import { useState, useEffect } from "react"
import { HttpTypes } from "@medusajs/types"
import {
  updateCart,
  placeOrder,
  setShippingMethod,
  ensurePaymentSession,
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

export default function SimpleCheckout({ cart, shippingOptions }: { cart: HttpTypes.StoreCart, shippingOptions: any[] | null }) {
  const router = useRouter()
  const params = useParams()
  const countryCode = params.countryCode as string

  const [form, setForm] = useState({ name: "", phone: "", address: "", note: "" })
  const [payment, setPayment] = useState<"cod" | "sepay">("cod")
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [showQR, setShowQR] = useState(false)
  const [orderId, setOrderId] = useState("")

  // Load saved form data
  useEffect(() => {
    const saved = localStorage.getItem('phanviet_checkout_form')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        setForm(parsed.form || { name: "", phone: "", address: "", note: "" })
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
  const sepayTotal = Math.max(0, subtotal - SEPAY_DISCOUNT)
  const finalTotal = payment === "sepay" ? sepayTotal : subtotal

  const validate = () => {
    const e: Record<string, string> = {}
    if (!form.name.trim()) e.name = "Vui lòng nhập họ tên"
    if (!/^(0|\+84)[0-9]{8,9}$/.test(form.phone.replace(/\s/g, ""))) e.phone = "Số điện thoại không hợp lệ"
    if (!form.address.trim()) e.address = "Vui lòng nhập địa chỉ"
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
      const updatedCart = await updateCart({
        email: `guest${Date.now()}@example.com`,
        shipping_address: {
          first_name: form.name,
          last_name: "",
          address_1: form.address,
          city: "Việt Nam",
          country_code: countryCode || "vn",
          phone: form.phone,
        },
        billing_address: {
          first_name: form.name,
          last_name: "",
          address_1: form.address,
          city: "Việt Nam",
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
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-4 py-4">
          <div className="max-w-4xl mx-auto flex items-center gap-3">
            <a href={`/${countryCode}`} className="text-gray-400 hover:text-gray-600 text-xl">←</a>
            <span className="font-black text-lg text-gray-900">PHAN VIỆT</span>
            <span className="text-gray-300">|</span>
            <span className="text-gray-500 text-sm">Đặt hàng</span>
          </div>
        </div>

        <div className="max-w-4xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6">

          {/* LEFT — Order summary */}
          <div className="order-2 lg:order-1">
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <h2 className="font-black text-base text-gray-900 mb-4">📦 Đơn hàng của bạn</h2>

              <div className="space-y-4">
                {sortedItems.map((item) => {
                  const gifts = (() => {
                    try { return JSON.parse((item.metadata?.gifts as string) || "[]") } catch { return [] }
                  })()

                  return (
                    <div key={item.id}>
                      <div className="flex gap-3">
                        <div className="w-14 h-14 rounded-lg overflow-hidden flex-shrink-0">
                          <Thumbnail
                            thumbnail={item.variant?.product?.thumbnail}
                            images={item.variant?.product?.images}
                            size="square"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm text-gray-900 line-clamp-2">{item.title}</p>
                          <p className="text-xs text-gray-400 mt-0.5">x{item.quantity}</p>
                        </div>
                        <p className="font-black text-orange-500 text-sm flex-shrink-0">
                          {convertToLocale({ amount: item.unit_price * item.quantity, currency_code: cart.currency_code })}
                        </p>
                      </div>

                      {/* Gifts */}
                      {gifts.length > 0 && (
                        <div className="mt-2 pl-[68px] space-y-1.5">
                          {gifts.map((g: any, i: number) => (
                            <div key={i} className="flex items-center gap-2">
                              <span className="text-sm">🎁</span>
                              <span className="text-xs text-gray-600 flex-1"><strong className="text-orange-500">TẶNG!</strong> {g.name}</span>
                              <span className="text-xs text-gray-400 line-through">{formatVND(g.value || 0)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Totals */}
              <div className="border-t border-gray-100 mt-5 pt-4 space-y-2">
                <div className="flex justify-between text-sm text-gray-500">
                  <span>Tạm tính</span>
                  <span>{convertToLocale({ amount: subtotal, currency_code: cart.currency_code })}</span>
                </div>
                {payment === "sepay" && (
                  <div className="flex justify-between text-sm text-green-600 font-semibold">
                    <span>Giảm thanh toán QR</span>
                    <span>-{formatVND(SEPAY_DISCOUNT)}</span>
                  </div>
                )}
                <div className="flex justify-between font-black text-lg pt-2 border-t border-gray-100">
                  <span>Tổng cộng</span>
                  <span className="text-orange-500">{formatVND(finalTotal)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT — Form */}
          <div className="order-1 lg:order-2 space-y-4">
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
                <div>
                  <input
                    type="text"
                    placeholder="Địa chỉ giao hàng *"
                    value={form.address}
                    onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                    className={`w-full border rounded-xl px-4 py-3 text-sm outline-none focus:border-orange-400 transition-colors ${errors.address ? "border-red-400" : "border-gray-200"}`}
                  />
                  {errors.address && <p className="text-red-500 text-xs mt-1">{errors.address}</p>}
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

            {/* Trust */}
            <div className="flex justify-around text-xs text-gray-400 px-2">
              <span>✅ Kiểm tra hàng trước khi thanh toán</span>
              <span>🛡️ Bảo hành 12 tháng</span>
            </div>

            {/* CTA */}
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-black text-lg py-4 rounded-xl transition-all active:scale-95 disabled:opacity-70 shadow-lg"
            >
              {submitting ? "Đang xử lý..." : payment === "sepay" ? "💳 THANH TOÁN QR NGAY" : "🛒 ĐẶT HÀNG NGAY"}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
