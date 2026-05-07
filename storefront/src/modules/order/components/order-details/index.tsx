import { HttpTypes } from "@medusajs/types"
import { Text } from "@medusajs/ui"

type OrderDetailsProps = {
  order: HttpTypes.StoreOrder
  showStatus?: boolean
}

const OrderDetails = ({ order, showStatus }: OrderDetailsProps) => {
  const isGuestEmail = !order.email || order.email.startsWith("guest") || order.email.includes("@example.com")
  return (
    <div>
      {!isGuestEmail && (
        <Text>
          Chúng tôi đã gửi xác nhận đơn hàng đến{" "}
          <span
            className="text-ui-fg-medium-plus font-semibold"
            data-testid="order-email"
          >
            {order.email}
          </span>
          .
        </Text>
      )}
      <Text className="mt-2">
        Ngày đặt hàng:{" "}
        <span data-testid="order-date">
          {new Date(order.created_at).toLocaleDateString("vi-VN")}
        </span>
      </Text>
      <Text className="mt-2 text-ui-fg-interactive">
        Mã đơn hàng: <span data-testid="order-id">{order.display_id}</span>
      </Text>
    </div>
  )
}

export default OrderDetails
