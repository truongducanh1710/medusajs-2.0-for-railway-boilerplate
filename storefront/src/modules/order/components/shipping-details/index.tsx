import { convertToLocale } from "@lib/util/money"
import { HttpTypes } from "@medusajs/types"
import { Heading, Text } from "@medusajs/ui"

import Divider from "@modules/common/components/divider"

type ShippingDetailsProps = {
  order: HttpTypes.StoreOrder
}

const ShippingDetails = ({ order }: ShippingDetailsProps) => {
  const isGuestEmail = !order.email || order.email.startsWith("guest") || order.email.includes("@example.com")
  const shippingTotal = order.shipping_methods?.[0]?.total ?? 0
  const shippingLabel = shippingTotal === 0
    ? "Giao hàng tiêu chuẩn — Miễn phí"
    : `Giao hàng tiêu chuẩn — ${convertToLocale({ amount: shippingTotal, currency_code: order.currency_code })}`

  return (
    <div>
      <Heading level="h2" className="flex flex-row text-3xl-regular my-6">
        Giao hàng
      </Heading>
      <div className="flex items-start gap-x-8">
        <div
          className="flex flex-col w-1/3"
          data-testid="shipping-address-summary"
        >
          <Text className="txt-medium-plus text-ui-fg-base mb-1">
            Địa chỉ giao hàng
          </Text>
          <Text className="txt-medium text-ui-fg-subtle">
            {order.shipping_address?.first_name}{" "}
            {order.shipping_address?.last_name}
          </Text>
          {order.shipping_address?.address_1 && (
            <Text className="txt-medium text-ui-fg-subtle">
              {order.shipping_address.address_1}
              {order.shipping_address?.address_2 ? `, ${order.shipping_address.address_2}` : ""}
            </Text>
          )}
          {order.shipping_address?.city && (
            <Text className="txt-medium text-ui-fg-subtle">
              {order.shipping_address.city}
            </Text>
          )}
        </div>

        <div
          className="flex flex-col w-1/3"
          data-testid="shipping-contact-summary"
        >
          <Text className="txt-medium-plus text-ui-fg-base mb-1">Liên hệ</Text>
          <Text className="txt-medium text-ui-fg-subtle">
            {order.shipping_address?.phone}
          </Text>
          {!isGuestEmail && (
            <Text className="txt-medium text-ui-fg-subtle">{order.email}</Text>
          )}
        </div>

        <div
          className="flex flex-col w-1/3"
          data-testid="shipping-method-summary"
        >
          <Text className="txt-medium-plus text-ui-fg-base mb-1">Phương thức</Text>
          <Text className="txt-medium text-ui-fg-subtle">{shippingLabel}</Text>
        </div>
      </div>
      <Divider className="mt-8" />
    </div>
  )
}

export default ShippingDetails
