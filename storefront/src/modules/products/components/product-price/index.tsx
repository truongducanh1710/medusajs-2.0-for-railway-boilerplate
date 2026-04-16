import { getProductPrice } from "@lib/util/get-product-price"
import { HttpTypes } from "@medusajs/types"

function fmtVND(amount: number) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(amount)) + "đ"
}

export default function ProductPrice({
  product,
  variant,
}: {
  product: HttpTypes.StoreProduct
  variant?: HttpTypes.StoreProductVariant
}) {
  const { cheapestPrice, variantPrice } = getProductPrice({
    product,
    variantId: variant?.id,
  })

  const selectedPrice = variant ? variantPrice : cheapestPrice

  if (!selectedPrice) {
    return <div className="block w-32 h-9 bg-gray-100 animate-pulse" />
  }

  const amount = selectedPrice.calculated_price_number ?? 0
  const originalAmount = selectedPrice.original_price_number ?? 0
  const isSale = selectedPrice.price_type === "sale"

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2">
        <span
          className="text-2xl font-black text-orange-500"
          data-testid="product-price"
          data-value={amount}
        >
          {!variant && <span className="text-sm font-normal text-gray-500 mr-1">Từ</span>}
          {fmtVND(amount)}
        </span>
        {isSale && originalAmount > 0 && (
          <span className="text-sm text-gray-400 line-through" data-testid="original-product-price">
            {fmtVND(originalAmount)}
          </span>
        )}
        {isSale && selectedPrice.percentage_diff && (
          <span className="text-sm font-bold text-green-600">
            -{selectedPrice.percentage_diff}%
          </span>
        )}
      </div>
    </div>
  )
}
