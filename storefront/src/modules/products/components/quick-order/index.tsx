"use client"

import { useState, useEffect } from "react"
import { HttpTypes } from "@medusajs/types"

type Props = {
  product: HttpTypes.StoreProduct
  region: HttpTypes.StoreRegion
}

type BundleOpt = {
  qty: number
  label: string
  price: number
  originalPrice: number
  badge?: string
}

function formatVND(n: number) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(n)) + "đ"
}

function Countdown({ minutes = 15 }: { minutes?: number }) {
  const [secs, setSecs] = useState(minutes * 60)
  useEffect(() => {
    const t = setInterval(() => setSecs(s => s > 0 ? s - 1 : 0), 1000)
    return () => clearInterval(t)
  }, [])
  const m = String(Math.floor(secs / 60)).padStart(2, "0")
  const s = String(secs % 60).padStart(2, "0")
  return <span className="font-black tabular-nums text-yellow-300">{m}:{s}</span>
}

// Modal QR thanh toán SePay
function SepayModal({ orderCode, amount, onClose, onConfirm }: {
  orderCode: string
  amount: number
  onClose: () => void
  onConfirm: () => void
}) {
  const [qrUrl, setQrUrl] = useState("")
  const [bankInfo, setBankInfo] = useState<any>(null)
  const [checking, setChecking] = useState(false)
  const [paid, setPaid] = useState(false)
  const BACKEND = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL
  const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY || ""
  const apiHeaders = { "Content-Type": "application/json", "x-publishable-api-key": PUB_KEY }

  useEffect(() => {
    // Lấy QR code
    fetch(`${BACKEND}/store/sepay/qr`, {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify({ orderCode, amount }),
    })
      .then(r => r.json())
      .then(data => {
        setQrUrl(data.qrUrl)
        setBankInfo(data)
      })

    // Poll kiểm tra thanh toán mỗi 5 giây
    const interval = setInterval(async () => {
      setChecking(true)
      try {
        const r = await fetch(`${BACKEND}/store/sepay/qr?orderCode=${orderCode}`, { headers: apiHeaders })
        const data = await r.json()
        if (data.paid) {
          setPaid(true)
          clearInterval(interval)
          setTimeout(onConfirm, 1500)
        }
      } catch {}
      setChecking(false)
    }, 5000)

    return () => clearInterval(interval)
  }, [orderCode, amount])

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-sm w-full overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="bg-blue-600 px-5 py-4 text-white text-center">
          <p className="font-black text-lg">Quét mã QR để thanh toán</p>
          <p className="text-sm text-blue-200 mt-1">Mã đơn hàng: <strong className="text-white">PV{orderCode}</strong></p>
        </div>

        <div className="p-5">
          {paid ? (
            <div className="text-center py-8">
              <div className="text-6xl mb-4">✅</div>
              <p className="font-black text-xl text-green-600">Thanh toán thành công!</p>
              <p className="text-gray-500 text-sm mt-2">Đơn hàng của bạn đã được xác nhận</p>
            </div>
          ) : (
            <>
              {/* QR Code */}
              <div className="flex justify-center mb-4">
                {qrUrl ? (
                  <img src={qrUrl} alt="QR SePay" className="w-56 h-56 rounded-xl border border-gray-200" />
                ) : (
                  <div className="w-56 h-56 bg-gray-100 rounded-xl flex items-center justify-center">
                    <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
                  </div>
                )}
              </div>

              {/* Bank info */}
              {bankInfo && (
                <div className="bg-gray-50 rounded-xl p-4 text-sm space-y-2 mb-4">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Ngân hàng</span>
                    <span className="font-bold">{bankInfo.bank}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Số tài khoản</span>
                    <span className="font-bold font-mono">{bankInfo.accountNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Tên TK</span>
                    <span className="font-bold">{bankInfo.accountName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Số tiền</span>
                    <span className="font-black text-orange-500">{formatVND(amount)}</span>
                  </div>
                  <div className="flex justify-between border-t border-gray-200 pt-2">
                    <span className="text-gray-500">Nội dung CK</span>
                    <span className="font-black text-blue-600">PV{orderCode}</span>
                  </div>
                </div>
              )}

              <p className="text-center text-xs text-gray-400 mb-4">
                {checking ? "⏳ Đang kiểm tra thanh toán..." : "🔄 Tự động xác nhận khi nhận được tiền"}
              </p>

              {/* COD option */}
              <button
                onClick={onConfirm}
                className="w-full py-3 rounded-xl border border-gray-300 text-gray-600 text-sm font-semibold hover:bg-gray-50"
              >
                Hoặc chọn thanh toán khi nhận hàng (COD)
              </button>
            </>
          )}
        </div>

        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-white/70 hover:text-white text-2xl leading-none"
        >
          ×
        </button>
      </div>
    </div>
  )
}

export default function QuickOrder({ product, region }: Props) {
  const BACKEND = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL
  const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY || ""
  const apiHeaders = { "Content-Type": "application/json", "x-publishable-api-key": PUB_KEY }
  const basePrice = product.variants?.[0]?.calculated_price?.calculated_amount
    ?? product.variants?.[0]?.prices?.[0]?.amount
    ?? 0

  const bundles: BundleOpt[] = [
    { qty: 1, label: `1 ${product.title}`, price: basePrice, originalPrice: Math.round(basePrice * 1.4) },
    { qty: 2, label: `MUA 1 TẶNG 1`, badge: "MIỄN PHÍ SHIP", price: Math.round(basePrice * 1.6), originalPrice: Math.round(basePrice * 2.8) },
    { qty: 3, label: `MUA 2 TẶNG 1`, badge: "TIẾT KIỆM NHẤT 🔥", price: Math.round(basePrice * 2.2), originalPrice: Math.round(basePrice * 4.2) },
  ]

  const [selectedBundle, setSelectedBundle] = useState(0)
  const [form, setForm] = useState({ name: "", phone: "", address: "", note: "" })
  const [submitting, setSubmitting] = useState(false)
  const [showQR, setShowQR] = useState(false)
  const [orderCode, setOrderCode] = useState("")
  const [success, setSuccess] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const selectedOpt = bundles[selectedBundle]

  const validate = () => {
    const e: Record<string, string> = {}
    if (!form.name.trim()) e.name = "Vui lòng nhập họ tên"
    if (!/^(0|\+84)[0-9]{8,9}$/.test(form.phone.replace(/\s/g, ""))) e.phone = "Số điện thoại không hợp lệ"
    if (!form.address.trim()) e.address = "Vui lòng nhập địa chỉ"
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = async (paymentMethod: "cod" | "sepay") => {
    if (!validate()) return
    setSubmitting(true)

    try {
      // Tạo order qua Medusa store API
      const variant = product.variants?.[0]
      const regionId = region.id

      // Tạo cart
      const cartRes = await fetch(`${BACKEND}/store/carts`, {
        method: "POST",
        headers: apiHeaders,
        body: JSON.stringify({ region_id: regionId })
      })
      const { cart } = await cartRes.json()

      // Thêm sản phẩm vào cart
      await fetch(`${BACKEND}/store/carts/${cart.id}/line-items`, {
        method: "POST",
        headers: apiHeaders,
        body: JSON.stringify({ variant_id: variant?.id, quantity: selectedOpt.qty })
      })

      // Thêm shipping address
      await fetch(`${BACKEND}/store/carts/${cart.id}`, {
        method: "POST",
        headers: apiHeaders,
        body: JSON.stringify({
          email: `${form.phone}@phanviet.vn`,
          shipping_address: {
            first_name: form.name,
            last_name: "",
            address_1: form.address,
            city: "Việt Nam",
            country_code: "vn",
            phone: form.phone,
          }
        })
      })

      const code = `${Date.now().toString(36).toUpperCase()}`
      setOrderCode(code)

      if (paymentMethod === "sepay") {
        setShowQR(true)
      } else {
        setSuccess(true)
      }

    } catch (err) {
      console.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="border border-green-200 bg-green-50 rounded-2xl p-8 text-center">
        <div className="text-5xl mb-4">🎉</div>
        <h3 className="font-black text-xl text-green-700 mb-2">Đặt hàng thành công!</h3>
        <p className="text-gray-600 text-sm mb-1">Mã đơn hàng: <strong>PV{orderCode}</strong></p>
        <p className="text-gray-600 text-sm">Chúng tôi sẽ liên hệ <strong>{form.phone}</strong> để xác nhận trong 30 phút.</p>
      </div>
    )
  }

  return (
    <>
      {showQR && (
        <SepayModal
          orderCode={orderCode}
          amount={selectedOpt.price}
          onClose={() => setShowQR(false)}
          onConfirm={() => { setShowQR(false); setSuccess(true) }}
        />
      )}

      <div className="border-2 border-orange-400 rounded-2xl overflow-hidden shadow-lg">
        {/* Header countdown */}
        <div className="bg-orange-500 px-4 py-3 text-center">
          <p className="text-white font-black">
            ⏰ Ưu đãi kết thúc sau: <Countdown minutes={15} />
          </p>
        </div>

        <div className="p-4 bg-white space-y-4">
          {/* Price display */}
          <div className="text-center">
            <p className="text-gray-400 line-through text-sm">{formatVND(selectedOpt.originalPrice)}</p>
            <p className="text-3xl font-black text-orange-500">{formatVND(selectedOpt.price)}</p>
            <p className="text-green-600 font-bold text-sm">GIẢM {Math.round((1 - selectedOpt.price / selectedOpt.originalPrice) * 100)}% & FREESHIP</p>
          </div>

          {/* Bundle options */}
          <div className="space-y-2">
            {bundles.map((opt, idx) => (
              <label
                key={idx}
                className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                  selectedBundle === idx ? "border-orange-500 bg-orange-50" : "border-gray-200"
                }`}
              >
                <input
                  type="radio"
                  name="bundle"
                  checked={selectedBundle === idx}
                  onChange={() => setSelectedBundle(idx)}
                  className="accent-orange-500"
                />
                <span className="flex-1 font-bold text-sm text-gray-800">{opt.label}</span>
                {opt.badge && (
                  <span className="text-[10px] font-black bg-orange-500 text-white px-2 py-0.5 rounded-full">
                    {opt.badge}
                  </span>
                )}
                <span className="font-black text-orange-500 text-sm">{formatVND(opt.price)}</span>
              </label>
            ))}
          </div>

          {/* Form */}
          <div className="space-y-3">
            <div>
              <input
                type="text"
                placeholder="Họ và tên *"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className={`w-full border rounded-xl px-4 py-3 text-sm outline-none focus:border-orange-400 ${errors.name ? "border-red-400" : "border-gray-300"}`}
              />
              {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name}</p>}
            </div>

            <div>
              <input
                type="tel"
                placeholder="Số điện thoại * (để xác nhận đơn)"
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                className={`w-full border rounded-xl px-4 py-3 text-sm outline-none focus:border-orange-400 ${errors.phone ? "border-red-400" : "border-gray-300"}`}
              />
              {errors.phone && <p className="text-red-500 text-xs mt-1">{errors.phone}</p>}
            </div>

            <div>
              <input
                type="text"
                placeholder="Địa chỉ giao hàng *"
                value={form.address}
                onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                className={`w-full border rounded-xl px-4 py-3 text-sm outline-none focus:border-orange-400 ${errors.address ? "border-red-400" : "border-gray-300"}`}
              />
              {errors.address && <p className="text-red-500 text-xs mt-1">{errors.address}</p>}
            </div>

            <input
              type="text"
              placeholder="Ghi chú (số lượng khác, màu sắc...)"
              value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm outline-none focus:border-orange-400"
            />
          </div>

          {/* Trust */}
          <div className="flex justify-around text-xs text-gray-500">
            <span>✅ Kiểm tra hàng trước khi thanh toán</span>
            <span>🛡️ Bảo hành 12 tháng</span>
          </div>

          {/* CTAs */}
          <div className="space-y-2">
            <button
              onClick={() => handleSubmit("cod")}
              disabled={submitting}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-black text-lg py-4 rounded-xl transition-all active:scale-95 disabled:opacity-70 shadow-md"
            >
              {submitting ? "Đang xử lý..." : "ĐẶT MUA NGAY — MIỄN PHÍ SHIP"}
            </button>

            <button
              onClick={() => handleSubmit("sepay")}
              disabled={submitting}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm py-3 rounded-xl transition-all active:scale-95 disabled:opacity-70"
            >
              💳 Thanh toán ngay qua QR / Chuyển khoản
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
