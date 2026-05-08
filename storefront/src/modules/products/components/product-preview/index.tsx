import { Text } from "@medusajs/ui"

import { getProductPrice } from "@lib/util/get-product-price"
import { convertToLocale } from "@lib/util/money"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import Thumbnail from "../thumbnail"
import PreviewPrice from "./price"
import { getProductsById } from "@lib/data/products"
import { HttpTypes } from "@medusajs/types"

function getBundleStartPrice(product: HttpTypes.StoreProduct): number | null {
  try {
    const v2 = product.metadata?.bundle_options_v2 as string
    if (v2) {
      const parsed = JSON.parse(v2)
      if (parsed?.variants?.length > 0) {
        const prices: number[] = []
        for (const variant of parsed.variants) {
          if (variant.options?.length > 0) {
            const qty1 = variant.options.find((o: any) => o.qty === 1) || variant.options[0]
            if (qty1?.price) prices.push(qty1.price)
          }
        }
        if (prices.length > 0) return Math.min(...prices)
      }
    }
  } catch {}
  try {
    const v1 = product.metadata?.bundle_options as string
    if (v1) {
      const parsed = JSON.parse(v1)
      if (parsed?.length > 0) {
        const qty1 = parsed.find((o: any) => o.qty === 1) || parsed[0]
        if (qty1?.price) return qty1.price
      }
    }
  } catch {}
  return null
}

export default async function ProductPreview({
  product,
  isFeatured,
  region,
}: {
  product: HttpTypes.StoreProduct
  isFeatured?: boolean
  region: HttpTypes.StoreRegion
}) {
  let pricedProduct: HttpTypes.StoreProduct | undefined
  try {
    ;[pricedProduct] = await getProductsById({
      ids: [product.id!],
      regionId: region.id,
    })
  } catch {
    return null
  }

  if (!pricedProduct) {
    return null
  }

  let cheapestPrice: ReturnType<typeof getProductPrice>["cheapestPrice"]
  try {
    cheapestPrice = getProductPrice({ product: pricedProduct }).cheapestPrice
  } catch {
    cheapestPrice = null
  }

  // Override with bundle price when available — bundle prices are what customers actually pay
  const bundleStartPrice = getBundleStartPrice(pricedProduct)
  if (bundleStartPrice && cheapestPrice) {
    const currencyCode = cheapestPrice.currency_code || "VND"
    cheapestPrice = {
      ...cheapestPrice,
      calculated_price_number: bundleStartPrice,
      calculated_price: convertToLocale({ amount: bundleStartPrice, currency_code: currencyCode }),
      original_price_number: bundleStartPrice,
      original_price: convertToLocale({ amount: bundleStartPrice, currency_code: currencyCode }),
      price_type: null,
      percentage_diff: "0",
    }
  }

  return (
    <LocalizedClientLink href={`/products/${product.handle}`} className="group">
      <div data-testid="product-wrapper">
        <Thumbnail
          thumbnail={product.thumbnail}
          images={product.images}
          size="square"
          isFeatured={isFeatured}
        />
        <div className="flex txt-compact-medium mt-4 justify-between">
          <Text className="text-ui-fg-subtle" data-testid="product-title">
            {product.title}
          </Text>
          <div className="flex items-center gap-x-2">
            {cheapestPrice && <PreviewPrice price={cheapestPrice} />}
          </div>
        </div>
      </div>
    </LocalizedClientLink>
  )
}
