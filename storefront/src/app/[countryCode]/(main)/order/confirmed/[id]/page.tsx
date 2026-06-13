import { Metadata } from "next"

import OrderCompletedTemplate from "@modules/order/templates/order-completed-template"
import { notFound } from "next/navigation"
import { retrieveOrder } from "@lib/data/orders"
import { HttpTypes } from "@medusajs/types"
import PurchaseTracker from "@components/PurchaseTracker"

type Props = {
  params: { id: string; countryCode: string }
}

async function getOrder(id: string) {
  // retrieveOrder đã lấy items.{thumbnail,metadata,product_id,...} trong 1 call,
  // nên không cần enrichLineItems (bỏ 1 round-trip API).
  const order = await retrieveOrder(id)
  if (!order) {
    return
  }
  return order as unknown as HttpTypes.StoreOrder
}

export const metadata: Metadata = {
  title: "Đơn hàng đã được xác nhận",
  description: "Đơn mua của bạn đã được tạo thành công.",
}

export default async function OrderConfirmedPage({ params }: Props) {
  const order = await getOrder(params.id)
  if (!order) {
    return notFound()
  }

  const contentIds = order.items?.map((i) => i.variant_id || i.id) ?? []
  // order.total is already real VND (order-summary displays it via convertToLocale
  // without /100), so send it as-is — no minor-unit conversion.
  const value = order.total ?? 0
  const currency = order.currency_code?.toUpperCase() ?? "VND"

  // Lấy pixel riêng từ sản phẩm đầu tiên trong đơn
  const firstItem = order.items?.[0] as any
  const productPixelId = firstItem?.variant?.product?.metadata?.fb_pixel_id as string | undefined
  const productCapiToken = firstItem?.variant?.product?.metadata?.fb_capi_token as string | undefined
  const paymentMethod = (order as any).metadata?.payment_method ?? "cod"

  return (
    <>
      <PurchaseTracker
        orderId={order.id}
        value={value}
        currency={currency}
        contentIds={contentIds}
        productPixelId={productPixelId}
        productCapiToken={productCapiToken}
        paymentMethod={paymentMethod}
      />
      <OrderCompletedTemplate order={order} countryCode={params.countryCode} />
    </>
  )
}
