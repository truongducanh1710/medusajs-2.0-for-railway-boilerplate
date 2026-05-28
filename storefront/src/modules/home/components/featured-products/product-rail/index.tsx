import { HttpTypes } from "@medusajs/types"
import { Text } from "@medusajs/ui"

import InteractiveLink from "@modules/common/components/interactive-link"
import ProductPreview from "@modules/products/components/product-preview"
import { getProductsById } from "@lib/data/products"

export default async function ProductRail({
  collection,
  region,
}: {
  collection: HttpTypes.StoreCollection
  region: HttpTypes.StoreRegion
}) {
  const { products } = collection

  if (!products) {
    return null
  }

  // Fetch tất cả products với price trong 1 request thay vì N requests
  const pricedProducts = await getProductsById({
    ids: products.map((p) => p.id!),
    regionId: region.id,
  })

  const pricedMap = new Map(pricedProducts.map((p) => [p.id, p]))

  return (
    <div className="content-container py-12 small:py-24">
      <div className="flex justify-between mb-8">
        <Text className="txt-xlarge">{collection.title}</Text>
        <InteractiveLink href={`/collections/${collection.handle}`}>
          View all
        </InteractiveLink>
      </div>
      <ul className="grid grid-cols-2 small:grid-cols-3 gap-x-6 gap-y-24 small:gap-y-36">
        {products.map((product, index) => (
          <li key={product.id}>
            {/* @ts-ignore */}
            <ProductPreview
              product={pricedMap.get(product.id!) ?? product}
              region={region}
              isFeatured
              priority={index < 2}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
