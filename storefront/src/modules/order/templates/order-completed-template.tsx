import { Heading } from "@medusajs/ui"
import { cookies } from "next/headers"
import { Suspense } from "react"

import CartTotals from "@modules/common/components/cart-totals"
import Help from "@modules/order/components/help"
import Items from "@modules/order/components/items"
import OnboardingCta from "@modules/order/components/onboarding-cta"
import OrderDetails from "@modules/order/components/order-details"
import ShippingDetails from "@modules/order/components/shipping-details"
import PaymentDetails from "@modules/order/components/payment-details"
import ProductPreview from "@modules/products/components/product-preview"
import { getProductsList } from "@lib/data/products"
import { getRegion } from "@lib/data/regions"
import { HttpTypes } from "@medusajs/types"

type OrderCompletedTemplateProps = {
  order: HttpTypes.StoreOrder
  countryCode: string
}

async function OrderCrossSell({ order, countryCode }: { order: HttpTypes.StoreOrder; countryCode: string }) {
  const region = await getRegion(countryCode)
  if (!region) return null

  const boughtIds = (order.items || []).map((i: any) => i.product_id).filter(Boolean)
  const { response } = await getProductsList({ queryParams: { limit: 8 }, countryCode })
  const products = response.products.filter((p: any) => !boughtIds.includes(p.id)).slice(0, 4)
  if (!products.length) return null

  return (
    <div style={{ marginTop: 40, paddingTop: 32, borderTop: "1px solid #e5e7eb" }}>
      <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 16, color: "#1a1a2e" }}>
        🛍️ Bạn có thể thích
      </h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
        {products.map((p: any) => (
          <ProductPreview key={p.id} product={p} region={region} />
        ))}
      </div>
    </div>
  )
}

export default function OrderCompletedTemplate({
  order,
  countryCode,
}: OrderCompletedTemplateProps) {
  const isOnboarding = cookies().get("_medusa_onboarding")?.value === "true"

  // Tính lại subtotal từ bundle_price nếu có
  const bundleSubtotal = (order.items || []).reduce((sum, item) => {
    const meta = item.metadata as any
    const bundlePrice = meta?.bundle_price != null ? Number(meta.bundle_price) : null
    return sum + (bundlePrice != null ? bundlePrice : (item.unit_price * item.quantity))
  }, 0)

  const shippingTotal = order.shipping_total ?? 0
  const taxTotal = order.tax_total ?? 0
  const discountTotal = order.discount_total ?? 0
  const bundleTotal = Math.max(0, bundleSubtotal - discountTotal) + shippingTotal + taxTotal

  const correctedTotals = {
    ...order,
    subtotal: bundleSubtotal,
    total: bundleTotal,
  }

  return (
    <div className="py-6 min-h-[calc(100vh-64px)]">
      <div className="content-container flex flex-col justify-center items-center gap-y-10 max-w-4xl h-full w-full">
        {isOnboarding && <OnboardingCta orderId={order.id} />}
        <div
          className="flex flex-col gap-4 max-w-4xl h-full bg-white w-full py-10"
          data-testid="order-complete-container"
        >
          <Heading
            level="h1"
            className="flex flex-col gap-y-3 text-ui-fg-base text-3xl mb-4"
          >
            <span>Cảm ơn bạn!</span>
            <span>Đơn hàng của bạn đã được đặt thành công.</span>
          </Heading>
          <OrderDetails order={order} />

          {/* Banner nhắc khách để ý điện thoại */}
          <div style={{
            background: "linear-gradient(135deg, #fff7ed, #ffedd5)",
            border: "2px solid #fb923c",
            borderRadius: 16,
            padding: "20px 24px",
            display: "flex",
            gap: 16,
            alignItems: "flex-start",
          }}>
            <span style={{ fontSize: 32, lineHeight: 1 }}>📞</span>
            <div>
              <p style={{ fontWeight: 800, color: "#c2410c", fontSize: 16, margin: "0 0 4px" }}>
                Hãy để ý điện thoại nhé!
              </p>
              <p style={{ color: "#9a3412", fontSize: 14, margin: 0, lineHeight: 1.6 }}>
                Nhân viên bên em sẽ gọi xác nhận đơn hàng cho mình trong thời gian sớm nhất ạ 🙏
              </p>
            </div>
          </div>

          <Heading level="h2" className="flex flex-row text-3xl-regular">
            Tóm tắt
          </Heading>
          <Items items={order.items} />
          <CartTotals totals={correctedTotals} />
          <ShippingDetails order={order} />
          <PaymentDetails order={order} correctedTotal={bundleTotal} />
          <Help />

          <Suspense fallback={<div style={{ height: 200 }} />}>
            <OrderCrossSell order={order} countryCode={countryCode} />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
