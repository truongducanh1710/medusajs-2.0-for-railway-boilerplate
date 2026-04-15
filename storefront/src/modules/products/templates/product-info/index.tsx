import { HttpTypes } from "@medusajs/types"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

type ProductInfoProps = {
  product: HttpTypes.StoreProduct
}

const ProductInfo = ({ product }: ProductInfoProps) => {
  return (
    <div id="product-info" className="flex flex-col gap-4">
      {product.collection && (
        <LocalizedClientLink
          href={`/collections/${product.collection.handle}`}
          className="text-xs font-bold uppercase tracking-widest text-orange-500 hover:text-orange-600"
        >
          {product.collection.title}
        </LocalizedClientLink>
      )}

      <h1
        className="text-2xl lg:text-3xl font-extrabold text-gray-900 leading-tight"
        data-testid="product-title"
      >
        {product.title}
      </h1>

      {/* Rating placeholder */}
      <div className="flex items-center gap-2">
        <div className="flex text-orange-400 text-sm">
          {"★★★★★"}
        </div>
        <span className="text-sm text-gray-500">(128 đánh giá)</span>
        <span className="text-sm text-green-600 font-medium">● Còn hàng</span>
      </div>

      {product.description && (
        <p
          className="text-gray-600 leading-relaxed whitespace-pre-line"
          data-testid="product-description"
        >
          {product.description}
        </p>
      )}
    </div>
  )
}

export default ProductInfo
