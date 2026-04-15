import React, { Suspense } from "react"

import ImageGallery from "@modules/products/components/image-gallery"
import ProductActions from "@modules/products/components/product-actions"
import ProductOnboardingCta from "@modules/products/components/product-onboarding-cta"
import ProductTabs from "@modules/products/components/product-tabs"
import RelatedProducts from "@modules/products/components/related-products"
import ProductInfo from "@modules/products/templates/product-info"
import SkeletonRelatedProducts from "@modules/skeletons/templates/skeleton-related-products"
import { notFound } from "next/navigation"
import ProductActionsWrapper from "./product-actions-wrapper"
import { HttpTypes } from "@medusajs/types"

type ProductTemplateProps = {
  product: HttpTypes.StoreProduct
  region: HttpTypes.StoreRegion
  countryCode: string
}

const ProductTemplate: React.FC<ProductTemplateProps> = ({
  product,
  region,
  countryCode,
}) => {
  if (!product || !product.id) {
    return notFound()
  }

  return (
    <div className="bg-white min-h-screen">
      {/* Breadcrumb */}
      <div className="border-b border-gray-100 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 py-3 text-sm text-gray-500">
          <span>Trang chủ</span>
          <span className="mx-2">›</span>
          <span>Sản phẩm</span>
          <span className="mx-2">›</span>
          <span className="text-gray-800 font-medium">{product.title}</span>
        </div>
      </div>

      {/* Main product section */}
      <div
        className="max-w-7xl mx-auto px-4 py-8"
        data-testid="product-container"
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          {/* Left: Image Gallery */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <ImageGallery images={product?.images || []} />
          </div>

          {/* Right: Product Info + Actions */}
          <div className="flex flex-col gap-6">
            {/* Category badge */}
            {product.collection && (
              <span className="text-xs font-bold uppercase tracking-widest text-orange-500">
                {product.collection.title}
              </span>
            )}

            {/* Product title */}
            <ProductInfo product={product} />

            {/* Trust badges */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: "✅", text: "Hàng chính hãng 100%" },
                { icon: "🔄", text: "Đổi trả trong 7 ngày" },
                { icon: "🚚", text: "Miễn phí ship từ 500K" },
                { icon: "🛡️", text: "Bảo hành chính hãng" },
              ].map((badge) => (
                <div
                  key={badge.text}
                  className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2"
                >
                  <span className="text-base">{badge.icon}</span>
                  <span className="text-xs text-gray-600 font-medium">{badge.text}</span>
                </div>
              ))}
            </div>

            {/* Onboarding CTA (dev only) */}
            <ProductOnboardingCta />

            {/* Product variants + Add to cart */}
            <div className="border border-gray-100 rounded-xl p-6 bg-gray-50/50">
              <Suspense
                fallback={
                  <ProductActions
                    disabled={true}
                    product={product}
                    region={region}
                  />
                }
              >
                <ProductActionsWrapper id={product.id} region={region} />
              </Suspense>
            </div>

            {/* Product tabs (description, specs) */}
            <ProductTabs product={product} />
          </div>
        </div>
      </div>

      {/* Related products */}
      <div className="max-w-7xl mx-auto px-4 py-16 border-t border-gray-100">
        <h2 className="text-2xl font-extrabold text-gray-900 mb-8">
          Sản phẩm liên quan
        </h2>
        <Suspense fallback={<SkeletonRelatedProducts />}>
          <RelatedProducts product={product} countryCode={countryCode} />
        </Suspense>
      </div>
    </div>
  )
}

export default ProductTemplate
