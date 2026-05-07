import { HttpTypes } from "@medusajs/types"
import { Table, Text } from "@medusajs/ui"

import LineItemOptions from "@modules/common/components/line-item-options"
import LineItemPrice from "@modules/common/components/line-item-price"
import LineItemUnitPrice from "@modules/common/components/line-item-unit-price"
import Thumbnail from "@modules/products/components/thumbnail"

type ItemProps = {
  item: HttpTypes.StoreCartLineItem | HttpTypes.StoreOrderLineItem
}

function formatVND(n: number) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(n)) + "đ"
}

const Item = ({ item }: ItemProps) => {
  const meta = item.metadata as any
  const bundlePrice: number | null = meta?.bundle_price != null ? Number(meta.bundle_price) : null
  const bundleQty: number = meta?.bundle_qty != null ? Number(meta.bundle_qty) : item.quantity
  const bundleLabel: string | null = meta?.bundle_label ?? null

  return (
    <Table.Row className="w-full" data-testid="product-row">
      <Table.Cell className="!pl-0 p-4 w-24">
        <div className="flex w-16">
          <Thumbnail thumbnail={item.thumbnail} size="square" />
        </div>
      </Table.Cell>

      <Table.Cell className="text-left">
        <Text
          className="txt-medium-plus text-ui-fg-base"
          data-testid="product-name"
        >
          {item.title}
        </Text>
        {bundleLabel && (
          <Text className="text-xs text-blue-600 font-semibold">{bundleLabel}</Text>
        )}
        {item.variant && (
          <LineItemOptions variant={item.variant} data-testid="product-variant" />
        )}
      </Table.Cell>

      <Table.Cell className="!pr-0">
        <span className="!pr-0 flex flex-col items-end h-full justify-center">
          {bundlePrice != null ? (
            <>
              <Text className="text-ui-fg-muted text-sm">
                <span data-testid="product-quantity">{bundleQty}</span>x{" "}
                <span>{formatVND(bundlePrice / bundleQty)}</span>
              </Text>
              <Text className="text-base font-semibold text-ui-fg-base" data-testid="product-price">
                {formatVND(bundlePrice)}
              </Text>
            </>
          ) : (
            <>
              <span className="flex gap-x-1">
                <Text className="text-ui-fg-muted">
                  <span data-testid="product-quantity">{item.quantity}</span>x{" "}
                </Text>
                <LineItemUnitPrice item={item} style="tight" />
              </span>
              <LineItemPrice item={item} style="tight" />
            </>
          )}
        </span>
      </Table.Cell>
    </Table.Row>
  )
}

export default Item
