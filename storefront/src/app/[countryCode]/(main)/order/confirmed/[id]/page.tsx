import { Metadata } from "next"

import OrderCompletedTemplate from "@modules/order/templates/order-completed-template"
import { notFound } from "next/navigation"
import { enrichLineItems } from "@lib/data/cart"
import { retrieveOrder } from "@lib/data/orders"
import { HttpTypes } from "@medusajs/types"
import PurchaseTracker from "@components/PurchaseTracker"

type Props = {
  params: { id: string }
}

async function getOrder(id: string) {
  const order = await retrieveOrder(id)

  if (!order) {
    return
  }

  const enrichedItems = await enrichLineItems(order.items, order.region_id!)

  return {
    ...order,
    items: enrichedItems,
  } as unknown as HttpTypes.StoreOrder
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
  const value = (order.total ?? 0) / 100
  const currency = order.currency_code?.toUpperCase() ?? "VND"

  return (
    <>
      <PurchaseTracker
        orderId={order.id}
        value={value}
        currency={currency}
        contentIds={contentIds}
      />
      <OrderCompletedTemplate order={order} />
    </>
  )
}
