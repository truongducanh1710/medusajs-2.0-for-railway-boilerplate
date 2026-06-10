import Product from "../product-preview"
import { getRegion } from "@lib/data/regions"
import { getProductsList } from "@lib/data/products"
import { HttpTypes } from "@medusajs/types"

type RelatedProductsProps = {
  product: HttpTypes.StoreProduct
  countryCode: string
}

type StoreProductWithTags = HttpTypes.StoreProduct & {
  tags?: { id: string; value: string }[]
}

export default async function RelatedProducts({
  product,
  countryCode,
}: RelatedProductsProps) {
  const region = await getRegion(countryCode)

  if (!region) {
    return null
  }

  const queryParams: any = {
    region_id: region.id,
    is_giftcard: false,
  }

  if ((product as any).collection_id) {
    queryParams.collection_id = [(product as any).collection_id]
  }

  // Filter related products by shared tags. Medusa's store API only accepts
  // `tag_id` (array of tag IDs) — passing `tags` (values) returns a 400 and
  // crashes the page, so map to IDs and only set the param when tags exist.
  const productWithTags = product as StoreProductWithTags
  const tagIds = productWithTags.tags?.map((t) => t.id).filter(Boolean) ?? []
  if (tagIds.length) {
    queryParams.tag_id = tagIds
  }

  const products = await getProductsList({
    queryParams,
    countryCode,
  }).then(({ response }) => {
    return response.products.filter(
      (responseProduct) => responseProduct.id !== product.id
    )
  })

  if (!products.length) {
    return null
  }

  return (
    <div className="product-page-constraint">
      <div className="flex flex-col items-center text-center mb-16">
        <span className="text-base-regular text-gray-600 mb-6">
          Sản phẩm gợi ý
        </span>
        <p className="text-2xl-regular text-ui-fg-base max-w-lg">
          Có thể bạn cũng muốn xem những sản phẩm này.
        </p>
      </div>

      <ul className="grid grid-cols-2 small:grid-cols-3 medium:grid-cols-4 gap-x-6 gap-y-8">
        {products.map((product) => (
          <li key={product.id}>{region && <Product region={region} product={product} />}</li>
        ))}
      </ul>
    </div>
  )
}
