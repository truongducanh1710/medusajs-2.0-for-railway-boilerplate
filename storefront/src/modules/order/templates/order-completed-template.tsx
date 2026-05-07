import { Heading } from "@medusajs/ui"
import { cookies } from "next/headers"

import CartTotals from "@modules/common/components/cart-totals"
import Help from "@modules/order/components/help"
import Items from "@modules/order/components/items"
import OnboardingCta from "@modules/order/components/onboarding-cta"
import OrderDetails from "@modules/order/components/order-details"
import ShippingDetails from "@modules/order/components/shipping-details"
import PaymentDetails from "@modules/order/components/payment-details"
import { HttpTypes } from "@medusajs/types"

type OrderCompletedTemplateProps = {
  order: HttpTypes.StoreOrder
}

export default function OrderCompletedTemplate({
  order,
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
          <Heading level="h2" className="flex flex-row text-3xl-regular">
            Tóm tắt
          </Heading>
          <Items items={order.items} />
          <CartTotals totals={correctedTotals} />
          <ShippingDetails order={order} />
          <PaymentDetails order={order} />
          <Help />
        </div>
      </div>
    </div>
  )
}
