"use client"

import { useEffect, useState } from "react"
import { HttpTypes } from "@medusajs/types"
import { sdk } from "@lib/config"

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

type AddressState = {
  name: string
  phone: string
  address: string
  note: string
}

type CheckoutMethod = "cod" | "sepay"

function formatVND(n: number) {
  return `${new Intl.NumberFormat("vi-VN").format(Math.round(n))} đ`
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return typeof error === "string" ? error : "Unknown error"
}

function Countdown({ minutes = 15 }: { minutes?: number }) {
  const [secs, setSecs] = useState(minutes * 60)

  useEffect(() => {
    const t = setInterval(
      () => setSecs((s) => (s > 0 ? s - 1 : 0)),
      1000
    )

    return () => clearInterval(t)
  }, [])

  const m = String(Math.floor(secs / 60)).padStart(2, "0")
  const s = String(secs % 60).padStart(2, "0")

  return <span className="font-black tabular-nums text-yellow-300">{m}:{s}</span>
}

async function createCart(regionId: string) {
  const { cart } = await sdk.store.cart.create({ region_id: regionId })
  return cart
}

async function addLineItem(cartId: string, variantId: string, quantity: number) {
  await sdk.store.cart.createLineItem(cartId, {
    variant_id: variantId,
    quantity,
  })
}

async function updateCheckoutCart(
  cartId: string,
  payload: HttpTypes.StoreUpdateCart
) {
  const { cart } = await sdk.store.cart.update(cartId, payload)
  return cart
}

async function listShippingOptions(cartId: string) {
  const { shipping_options } = await sdk.store.fulfillment.listCartOptions({
    cart_id: cartId,
  })

  return shipping_options ?? []
}

async function addShippingMethod(cartId: string, shippingOptionId: string) {
  await sdk.store.cart.addShippingMethod(cartId, {
    option_id: shippingOptionId,
  })
}

async function retrieveCart(cartId: string) {
  const { cart } = await sdk.store.cart.retrieve(cartId, {
    fields: "id,region_id,*payment_collection,shipping_methods,total",
  })

  return cart
}

function selectProviderId(
  providers: any[],
  preferredProviderId: string
) {
  const normalizedPreferred = preferredProviderId.trim()

  const preferred = providers.find(
    (provider) =>
      provider.id === normalizedPreferred &&
      provider.is_enabled !== false
  )

  if (preferred) {
    return preferred.id as string
  }

  const defaultProvider = providers.find(
    (provider) =>
      provider.id === "pp_system_default" &&
      provider.is_enabled !== false
  )

  if (defaultProvider) {
    return defaultProvider.id as string
  }

  const firstEnabled = providers.find((provider) => provider.is_enabled !== false)

  return firstEnabled?.id as string | undefined
}

async function ensurePaymentSession(
  cartId: string,
  preferredProviderId = "pp_system_default"
) {
  const cart = await retrieveCart(cartId)
  const existingSessionProviderIds =
    cart.payment_collection?.payment_sessions
      ?.map((session: any) => session.provider_id)
      .filter(Boolean) ?? []

  if (existingSessionProviderIds.length > 0) {
    return existingSessionProviderIds[0] as string
  }

  const providers = await sdk.store.payment
    .listPaymentProviders({ region_id: cart.region_id as string })
    .then(({ payment_providers }) => payment_providers ?? [])
    .catch((error) => {
      console.error("[QuickOrder] listPaymentProviders failed", error, {
        cartId,
        regionId: cart.region_id,
      })
      return []
    })

  const providerId = selectProviderId(providers, preferredProviderId)

  if (!providerId) {
    throw new Error(`No enabled payment provider found for region ${cart.region_id}`)
  }

  console.info("[QuickOrder] ensurePaymentSession", {
    cartId,
    regionId: cart.region_id,
    preferredProviderId,
    providerId,
  })

  await sdk.store.payment.initiatePaymentSession(cart, {
    provider_id: providerId,
  })

  return providerId
}

async function completeOrder(cartId: string) {
  const result: any = await sdk.store.cart.complete(cartId)
  return result
}

// Modal QR thanh toan SePay
function SepayModal({
  orderCode,
  amount,
  onClose,
  onPaid,
  onUseCod,
}: {
  orderCode: string
  amount: number
  onClose: () => void
  onPaid: () => Promise<void>
  onUseCod: () => Promise<void>
}) {
  const [qrUrl, setQrUrl] = useState("")
  const [bankInfo, setBankInfo] = useState<any>(null)
  const [checking, setChecking] = useState(false)
  const [paid, setPaid] = useState(false)
  const [actionLoading, setActionLoading] = useState<"cod" | "paid" | null>(null)
  const [error, setError] = useState("")
  const BACKEND = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL
  const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY || ""
  const apiHeaders = {
    "Content-Type": "application/json",
    "x-publishable-api-key": PUB_KEY,
  }

  useEffect(() => {
    let mounted = true

    fetch(`${BACKEND}/store/sepay/qr`, {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify({ orderCode, amount }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!mounted) {
          return
        }

        setQrUrl(data.qrUrl)
        setBankInfo(data)
      })
      .catch((err) => {
        console.error("[QuickOrder] SePay QR create failed", err)
        if (mounted) {
          setError(getErrorMessage(err))
        }
      })

    const interval = setInterval(async () => {
      setChecking(true)
      try {
        const r = await fetch(
          `${BACKEND}/store/sepay/qr?orderCode=${orderCode}`,
          { headers: apiHeaders }
        )
        const data = await r.json()
        if (data.paid) {
          setPaid(true)
          clearInterval(interval)
          setActionLoading("paid")
          try {
            await onPaid()
          } catch (err) {
            console.error("[QuickOrder] finalize after SePay failed", err)
            setError(getErrorMessage(err))
          } finally {
            setActionLoading(null)
          }
        }
      } catch (err) {
        console.error("[QuickOrder] SePay poll failed", err)
      } finally {
        setChecking(false)
      }
    }, 5000)

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [BACKEND, amount, orderCode])

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-sm w-full overflow-hidden shadow-2xl relative">
        <div className="bg-blue-600 px-5 py-4 text-white text-center">
          <p className="font-black text-lg">Quet ma QR de thanh toan</p>
          <p className="text-sm text-blue-200 mt-1">
            Ma don hang: <strong className="text-white">PV{orderCode}</strong>
          </p>
        </div>

        <div className="p-5">
          {paid ? (
            <div className="text-center py-8">
              <div className="text-6xl mb-4">✅</div>
              <p className="font-black text-xl text-green-600">
                Thanh toan thanh cong
              </p>
              <p className="text-gray-500 text-sm mt-2">
                Don hang cua ban dang duoc xu ly
              </p>
            </div>
          ) : (
            <>
              <div className="flex justify-center mb-4">
                {qrUrl ? (
                  <img
                    src={qrUrl}
                    alt="QR SePay"
                    className="w-56 h-56 rounded-xl border border-gray-200"
                  />
                ) : (
                  <div className="w-56 h-56 bg-gray-100 rounded-xl flex items-center justify-center">
                    <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
                  </div>
                )}
              </div>

              {bankInfo && (
                <div className="bg-gray-50 rounded-xl p-4 text-sm space-y-2 mb-4">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Ngan hang</span>
                    <span className="font-bold">{bankInfo.bank}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">So tai khoan</span>
                    <span className="font-bold font-mono">
                      {bankInfo.accountNumber}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Ten TK</span>
                    <span className="font-bold">{bankInfo.accountName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">So tien</span>
                    <span className="font-black text-orange-500">
                      {formatVND(amount)}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-gray-200 pt-2">
                    <span className="text-gray-500">Noi dung CK</span>
                    <span className="font-black text-blue-600">PV{orderCode}</span>
                  </div>
                </div>
              )}

              {(checking || actionLoading) && (
                <p className="text-center text-xs text-gray-400 mb-4">
                  {actionLoading === "paid"
                    ? "Dang xac nhan don hang..."
                    : "Dang kiem tra thanh toan..."}
                </p>
              )}

              {error && (
                <p className="text-sm text-red-600 text-center mb-4">{error}</p>
              )}

              <button
                onClick={async () => {
                  setActionLoading("cod")
                  setError("")
                  try {
                    await onUseCod()
                  } catch (err) {
                    console.error("[QuickOrder] COD fallback failed", err)
                    setError(getErrorMessage(err))
                  } finally {
                    setActionLoading(null)
                  }
                }}
                disabled={Boolean(actionLoading)}
                className="w-full py-3 rounded-xl border border-gray-300 text-gray-600 text-sm font-semibold hover:bg-gray-50 disabled:opacity-70"
              >
                Hoac chon thanh toan khi nhan hang (COD)
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
  const apiHeaders = {
    "Content-Type": "application/json",
    "x-publishable-api-key": PUB_KEY,
  }

  const basePrice =
    product.variants?.[0]?.calculated_price?.calculated_amount ??
    (product.variants?.[0] as any)?.prices?.[0]?.amount ??
    0

  const bundles: BundleOpt[] = [
    {
      qty: 1,
      label: `1 ${product.title}`,
      price: basePrice,
      originalPrice: Math.round(basePrice * 1.4),
    },
    {
      qty: 2,
      label: "MUA 1 TANG 1",
      badge: "MIEN PHI SHIP",
      price: Math.round(basePrice * 1.6),
      originalPrice: Math.round(basePrice * 2.8),
    },
    {
      qty: 3,
      label: "MUA 2 TANG 1",
      badge: "TIET KIEM NHAT",
      price: Math.round(basePrice * 2.2),
      originalPrice: Math.round(basePrice * 4.2),
    },
  ]

  const [selectedBundle, setSelectedBundle] = useState(0)
  const [form, setForm] = useState<AddressState>({
    name: "",
    phone: "",
    address: "",
    note: "",
  })
  const [submitting, setSubmitting] = useState(false)
  const [showQR, setShowQR] = useState(false)
  const [orderCode, setOrderCode] = useState("")
  const [success, setSuccess] = useState(false)
  const [confirmedOrderId, setConfirmedOrderId] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [checkoutError, setCheckoutError] = useState("")
  const [pendingCartId, setPendingCartId] = useState("")

  const selectedOpt = bundles[selectedBundle]

  const validate = () => {
    const e: Record<string, string> = {}

    if (!form.name.trim()) e.name = "Vui long nhap ho ten"
    if (!/^(0|\+84)[0-9]{8,9}$/.test(form.phone.replace(/\s/g, ""))) {
      e.phone = "So dien thoai khong hop le"
    }
    if (!form.address.trim()) e.address = "Vui long nhap dia chi"

    setErrors(e)
    return Object.keys(e).length === 0
  }

  const getCountryCode = () => {
    return (region.countries?.[0]?.iso_2 || "vn").toLowerCase()
  }

  const getShippingAddress = () => ({
    first_name: form.name.trim(),
    last_name: "",
    address_1: form.address.trim(),
    address_2: "",
    company: "",
    postal_code: "",
    city: region.name || "Vietnam",
    country_code: getCountryCode(),
    province: "",
    phone: form.phone.replace(/\s/g, ""),
  })

  const prepareCheckout = async (paymentMethod: CheckoutMethod) => {
    const variant = product.variants?.[0]
    if (!variant?.id) {
      throw new Error("Product does not have a purchasable variant")
    }

    const cart = await createCart(region.id)
    await addLineItem(cart.id, variant.id, selectedOpt.qty)

    await updateCheckoutCart(cart.id, {
      email: `${form.phone.replace(/\s/g, "")}@phanviet.vn`,
      shipping_address: getShippingAddress(),
      billing_address: getShippingAddress(),
    } as HttpTypes.StoreUpdateCart)

    const shippingOptions = await listShippingOptions(cart.id)
    const shippingOption = shippingOptions[0]

    if (!shippingOption) {
      throw new Error("No shipping option available for this region")
    }

    await addShippingMethod(cart.id, shippingOption.id)

    const providerId = await ensurePaymentSession(
      cart.id,
      paymentMethod === "sepay" ? "sepay" : "pp_system_default"
    )

    return {
      cartId: cart.id,
      providerId,
    }
  }

  const finalizeCheckout = async (cartId: string) => {
    const result = await completeOrder(cartId)
    const orderId = result?.order?.id

    if (!orderId && result?.type !== "order") {
      throw new Error("Order completion did not return an order")
    }

    setConfirmedOrderId(orderId || result?.order?.id || cartId)
    setSuccess(true)
    setShowQR(false)
    setPendingCartId("")

    return result
  }

  const handleSubmit = async (paymentMethod: CheckoutMethod) => {
    if (!validate()) return

    setSubmitting(true)
    setCheckoutError("")

    try {
      console.info("[QuickOrder] prepare checkout", {
        paymentMethod,
        regionId: region.id,
        bundleQty: selectedOpt.qty,
      })

      const { cartId, providerId } = await prepareCheckout(paymentMethod)
      const nextOrderCode = `${Date.now().toString(36).toUpperCase()}`
      setOrderCode(nextOrderCode)
      setPendingCartId(cartId)

      console.info("[QuickOrder] checkout prepared", {
        cartId,
        providerId,
        paymentMethod,
      })

      if (paymentMethod === "sepay") {
        setShowQR(true)
        return
      }

      await finalizeCheckout(cartId)
    } catch (err) {
      console.error("[QuickOrder] checkout failed", err)
      setCheckoutError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  const handlePaid = async () => {
    if (!pendingCartId) {
      throw new Error("Missing cart id for payment confirmation")
    }

    await finalizeCheckout(pendingCartId)
  }

  const handleUseCodFromQR = async () => {
    if (pendingCartId) {
      await finalizeCheckout(pendingCartId)
      return
    }

    await handleSubmit("cod")
  }

  if (success) {
    return (
      <div className="border border-green-200 bg-green-50 rounded-2xl p-8 text-center">
        <div className="text-5xl mb-4">🎉</div>
        <h3 className="font-black text-xl text-green-700 mb-2">
          Dat hang thanh cong
        </h3>
        <p className="text-gray-600 text-sm mb-1">
          Ma don hang: <strong>PV{orderCode}</strong>
        </p>
        {confirmedOrderId && (
          <p className="text-gray-500 text-xs mb-1">Order ID: {confirmedOrderId}</p>
        )}
        <p className="text-gray-600 text-sm">
          Chung toi se lien he <strong>{form.phone}</strong> de xac nhan trong 30 phut.
        </p>
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
          onPaid={handlePaid}
          onUseCod={handleUseCodFromQR}
        />
      )}

      <div className="border-2 border-orange-400 rounded-2xl overflow-hidden shadow-lg">
        <div className="bg-orange-500 px-4 py-3 text-center">
          <p className="text-white font-black">
            Uu dai ket thuc sau: <Countdown minutes={15} />
          </p>
        </div>

        <div className="p-4 bg-white space-y-4">
          <div className="text-center">
            <p className="text-gray-400 line-through text-sm">
              {formatVND(selectedOpt.originalPrice)}
            </p>
            <p className="text-3xl font-black text-orange-500">
              {formatVND(selectedOpt.price)}
            </p>
            <p className="text-green-600 font-bold text-sm">
              Giam {Math.round((1 - selectedOpt.price / selectedOpt.originalPrice) * 100)}% & FREESHIP
            </p>
          </div>

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
                <span className="font-black text-orange-500 text-sm">
                  {formatVND(opt.price)}
                </span>
              </label>
            ))}
          </div>

          <div className="space-y-3">
            <div>
              <input
                type="text"
                placeholder="Ho va ten *"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className={`w-full border rounded-xl px-4 py-3 text-sm outline-none focus:border-orange-400 ${
                  errors.name ? "border-red-400" : "border-gray-300"
                }`}
              />
              {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name}</p>}
            </div>

            <div>
              <input
                type="tel"
                placeholder="So dien thoai *"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className={`w-full border rounded-xl px-4 py-3 text-sm outline-none focus:border-orange-400 ${
                  errors.phone ? "border-red-400" : "border-gray-300"
                }`}
              />
              {errors.phone && <p className="text-red-500 text-xs mt-1">{errors.phone}</p>}
            </div>

            <div>
              <input
                type="text"
                placeholder="Dia chi giao hang *"
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                className={`w-full border rounded-xl px-4 py-3 text-sm outline-none focus:border-orange-400 ${
                  errors.address ? "border-red-400" : "border-gray-300"
                }`}
              />
              {errors.address && <p className="text-red-500 text-xs mt-1">{errors.address}</p>}
            </div>

            <input
              type="text"
              placeholder="Ghi chu"
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm outline-none focus:border-orange-400"
            />
          </div>

          <div className="flex justify-around text-xs text-gray-500">
            <span>✅ Kiem tra hang truoc khi thanh toan</span>
            <span>🛡️ Bao hanh 12 thang</span>
          </div>

          {checkoutError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {checkoutError}
            </div>
          )}

          <div className="space-y-2">
            <button
              onClick={() => handleSubmit("cod")}
              disabled={submitting}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-black text-lg py-4 rounded-xl transition-all active:scale-95 disabled:opacity-70 shadow-md"
            >
              {submitting ? "Dang xu ly..." : "Dat mua ngay - MIEN PHI SHIP"}
            </button>

            <button
              onClick={() => handleSubmit("sepay")}
              disabled={submitting}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm py-3 rounded-xl transition-all active:scale-95 disabled:opacity-70"
            >
              Thanh toan ngay qua QR / Chuyen khoan
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
