import { Metadata } from "next"

import OrderOverview from "@modules/account/components/order-overview"
import { notFound } from "next/navigation"
import { listOrders } from "@lib/data/orders"

export const metadata: Metadata = {
  title: "Đơn hàng",
  description: "Xem các đơn hàng trước đây của bạn.",
}

export default async function Orders() {
  const orders = await listOrders()

  if (!orders) {
    notFound()
  }

  return (
    <div className="w-full" data-testid="orders-page-wrapper">
      <div className="mb-8 flex flex-col gap-y-4">
        <h1 className="text-2xl-semi">Đơn hàng</h1>
        <p className="text-base-regular">
          Xem các đơn hàng trước đây và trạng thái của chúng. Bạn cũng có thể
          tạo yêu cầu trả hàng hoặc đổi hàng nếu cần.
        </p>
      </div>
      <div>
        <OrderOverview orders={orders} />
      </div>
    </div>
  )
}
