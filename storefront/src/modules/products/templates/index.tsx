import React, { Suspense } from "react"
import { notFound } from "next/navigation"
import { HttpTypes } from "@medusajs/types"

import ImageGallery from "@modules/products/components/image-gallery"
import RelatedProducts from "@modules/products/components/related-products"
import StickyBuyBar from "@modules/products/components/sticky-buy-bar"
import SkeletonRelatedProducts from "@modules/skeletons/templates/skeleton-related-products"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import ComboBundle from "@modules/products/components/combo-bundle"
import BundleSelector from "@modules/products/components/bundle-selector"
import ProductPageContent from "@modules/products/components/product-page-content"
import ProductPixelTracker from "@components/ProductPixelTracker"
import ProductChatContextInjector from "@components/ProductChatContextInjector"

type Props = {
  product: HttpTypes.StoreProduct
  region: HttpTypes.StoreRegion
  countryCode: string
}

// Helper lấy metadata
function meta(product: HttpTypes.StoreProduct, key: string): string {
  return (product.metadata?.[key] as string) || ""
}

// Section: Trust Bar
function TrustBar() {
  return (
    <div className="bg-orange-50 border-y border-orange-100 py-3">
      <div className="max-w-7xl mx-auto px-4">
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:justify-center gap-x-4 sm:gap-x-8 gap-y-2 text-xs sm:text-sm font-medium text-gray-700">
          <span className="text-center">📦 15.000+ đơn đã bán</span>
          <span className="text-center">⭐ 4.8/5 đánh giá</span>
          <span className="text-center">🚀 Giao trong 1-3 ngày</span>
          <span className="text-center">💰 Hoàn tiền nếu không hài lòng</span>
        </div>
      </div>
    </div>
  )
}

// Section: Video Demo
function VideoSection({ videoUrl }: { videoUrl: string }) {
  if (!videoUrl) return null
  const embedUrl = videoUrl.includes("youtube.com/watch")
    ? videoUrl.replace("watch?v=", "embed/")
    : videoUrl.includes("youtu.be/")
    ? videoUrl.replace("youtu.be/", "www.youtube.com/embed/")
    : videoUrl

  return (
    <div className="py-8 sm:py-12 bg-gray-50">
      <div className="max-w-4xl mx-auto px-4">
        <h2 className="text-xl sm:text-2xl font-extrabold text-center text-gray-900 mb-4 sm:mb-6">
          🎬 Xem sản phẩm hoạt động thực tế
        </h2>
        <div className="relative aspect-video rounded-xl overflow-hidden shadow-lg">
          <iframe
            src={embedUrl}
            className="w-full h-full"
            allowFullScreen
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          />
        </div>
      </div>
    </div>
  )
}

// Section: Pain Points
function PainSolutionSection({ product }: { product: HttpTypes.StoreProduct }) {
  const pains = [
    meta(product, "pain_1"),
    meta(product, "pain_2"),
    meta(product, "pain_3"),
  ].filter(Boolean)

  const solutions = [
    meta(product, "solution_1"),
    meta(product, "solution_2"),
    meta(product, "solution_3"),
  ].filter(Boolean)

  if (!pains.length && !solutions.length) return null

  return (
    <div className="py-8 sm:py-12 bg-white">
      <div className="max-w-4xl mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-8">
          {pains.length > 0 && (
            <div className="bg-red-50 rounded-xl p-6 border border-red-100">
              <h3 className="font-extrabold text-lg text-red-700 mb-4">😤 Bạn có đang gặp?</h3>
              <ul className="space-y-3">
                {pains.map((pain, i) => (
                  <li key={i} className="flex items-start gap-2 text-gray-700">
                    <span className="text-red-500 font-bold mt-0.5">❌</span>
                    <span>{pain}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {solutions.length > 0 && (
            <div className="bg-green-50 rounded-xl p-6 border border-green-100">
              <h3 className="font-extrabold text-lg text-green-700 mb-4">✅ Giải pháp của chúng tôi</h3>
              <ul className="space-y-3">
                {solutions.map((sol, i) => (
                  <li key={i} className="flex items-start gap-2 text-gray-700">
                    <span className="text-green-500 font-bold mt-0.5">✅</span>
                    <span>{sol}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Section: Key Benefits
function BenefitsSection({ product }: { product: HttpTypes.StoreProduct }) {
  const benefits = [
    { icon: meta(product, "benefit_icon_1") || "🔥", title: meta(product, "benefit_title_1"), desc: meta(product, "benefit_desc_1") },
    { icon: meta(product, "benefit_icon_2") || "💧", title: meta(product, "benefit_title_2"), desc: meta(product, "benefit_desc_2") },
    { icon: meta(product, "benefit_icon_3") || "⚡", title: meta(product, "benefit_title_3"), desc: meta(product, "benefit_desc_3") },
    { icon: meta(product, "benefit_icon_4") || "🛡️", title: meta(product, "benefit_title_4"), desc: meta(product, "benefit_desc_4") },
  ].filter(b => b.title)

  if (!benefits.length) return null

  return (
    <div className="py-8 sm:py-12 bg-blue-950 text-white">
      <div className="max-w-5xl mx-auto px-4">
        <h2 className="text-xl sm:text-2xl font-extrabold text-center mb-6 sm:mb-10">Tại sao chọn {product.title}?</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
          {benefits.map((b, i) => (
            <div key={i} className="text-center">
              <div className="text-4xl mb-3">{b.icon}</div>
              <h3 className="font-bold text-orange-400 mb-2">{b.title}</h3>
              <p className="text-sm text-blue-200">{b.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Section: Specs / Thông số kỹ thuật
function SpecsSection({ product }: { product: HttpTypes.StoreProduct }) {
  const specs = [
    { label: "Chất liệu", value: meta(product, "chat_lieu") },
    { label: "Kích thước", value: meta(product, "kich_thuoc") },
    { label: "Xuất xứ", value: meta(product, "xuat_xu") },
    { label: "Bảo hành", value: meta(product, "bao_hanh") },
    { label: "Màu sắc", value: meta(product, "mau_sac") },
    { label: "Trọng lượng", value: meta(product, "trong_luong") },
  ].filter(s => s.value)

  if (!specs.length) return null

  return (
    <div className="py-10 bg-gray-50">
      <div className="max-w-3xl mx-auto px-4">
        <h2 className="text-xl font-extrabold text-gray-900 mb-6">📋 Thông số kỹ thuật</h2>
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {specs.map((spec, i) => (
            <div key={i} className={`flex flex-col sm:flex-row ${i % 2 === 0 ? "bg-white" : "bg-gray-50"} px-4 sm:px-6 py-3 gap-0.5 sm:gap-0`}>
              <span className="w-full sm:w-36 text-xs sm:text-sm font-semibold text-gray-500">{spec.label}</span>
              <span className="text-sm text-gray-900 font-medium">{spec.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Section: Reviews
function ReviewsSection({ product }: { product: HttpTypes.StoreProduct }) {
  const reviewsRaw = meta(product, "reviews")
  let reviews: Array<{ name: string; location: string; rating: number; text: string; date: string }> = []

  if (reviewsRaw) {
    try { reviews = JSON.parse(reviewsRaw) } catch {}
  }

  // Default reviews nếu chưa có
  if (!reviews.length) {
    reviews = [
      { name: "Nguyễn Thị Lan", location: "Hà Nội", rating: 5, text: "Sản phẩm rất tốt, chất lượng vượt mong đợi! Giao hàng nhanh, đóng gói cẩn thận. Sẽ mua lại lần sau.", date: "2 ngày trước" },
      { name: "Trần Văn Nam", location: "TP.HCM", rating: 5, text: "Dùng được 1 tháng vẫn tốt, giá hợp lý. Chất lượng tương xứng với giá tiền, rất hài lòng.", date: "1 tuần trước" },
      { name: "Lê Thị Hoa", location: "Đà Nẵng", rating: 5, text: "Mua về tặng mẹ, mẹ thích lắm! Sản phẩm đúng như mô tả, shop tư vấn nhiệt tình.", date: "2 tuần trước" },
    ]
  }

  return (
    <div className="py-8 sm:py-12 bg-white">
      <div className="max-w-4xl mx-auto px-4">
        <div className="flex items-center justify-between mb-6 sm:mb-8">
          <h2 className="text-xl sm:text-2xl font-extrabold text-gray-900">💬 Khách hàng nói gì?</h2>
          <div className="flex items-center gap-2">
            <span className="text-3xl font-black text-orange-500">4.8</span>
            <div>
              <div className="text-orange-400">★★★★★</div>
              <div className="text-xs text-gray-400">1.247 đánh giá</div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-5">
          {reviews.map((r, i) => (
            <div key={i} className="bg-gray-50 rounded-xl p-5 border border-gray-100">
              <div className="text-orange-400 text-sm mb-2">{"★".repeat(r.rating)}</div>
              <p className="text-gray-700 text-sm italic mb-3">"{r.text}"</p>
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-semibold text-sm text-gray-900">{r.name}</span>
                  <span className="text-xs text-gray-400 ml-1">— {r.location}</span>
                </div>
                <span className="text-xs text-gray-400">{r.date}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Section: FAQ
function FAQSection({ product }: { product: HttpTypes.StoreProduct }) {
  const faqRaw = meta(product, "faq")
  let faqs: Array<{ q: string; a: string }> = []

  if (faqRaw) {
    try { faqs = JSON.parse(faqRaw) } catch {}
  }

  if (!faqs.length) {
    faqs = [
      { q: "Sản phẩm có bảo hành không?", a: "Sản phẩm được bảo hành 12 tháng, đổi trả trong 7 ngày nếu có lỗi từ nhà sản xuất." },
      { q: "Giao hàng mất bao lâu?", a: "Nội thành Hà Nội, HCM: 1-2 ngày. Các tỉnh thành khác: 2-4 ngày làm việc." },
      { q: "Có hỗ trợ thanh toán COD không?", a: "Có! Bạn có thể thanh toán khi nhận hàng (COD) hoặc chuyển khoản qua SePay." },
    ]
  }

  return (
    <div className="py-8 sm:py-12 bg-gray-50">
      <div className="max-w-3xl mx-auto px-4">
        <h2 className="text-xl sm:text-2xl font-extrabold text-gray-900 mb-6 sm:mb-8 text-center">❓ Câu hỏi thường gặp</h2>
        <div className="space-y-4">
          {faqs.map((faq, i) => (
            <div key={i} className="bg-white rounded-xl p-5 border border-gray-200">
              <h3 className="font-bold text-gray-900 mb-2">Q: {faq.q}</h3>
              <p className="text-gray-600 text-sm">→ {faq.a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Section: Final CTA — scroll-to-buy anchor
function FinalCTA({ product }: { product: HttpTypes.StoreProduct; region: HttpTypes.StoreRegion }) {
  return (
    <div className="py-8 sm:py-12 bg-gradient-to-r from-blue-950 to-blue-900 text-white">
      <div className="max-w-2xl mx-auto px-4 text-center">
        <h2 className="text-xl sm:text-2xl font-extrabold mb-2">{product.title}</h2>
        <p className="text-blue-200 mb-4 sm:mb-6">Đừng bỏ lỡ — Còn hàng có hạn</p>
        <a
          href="#bundle-selector"
          className="block w-full bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white font-black text-lg sm:text-xl py-4 px-10 rounded-2xl transition-colors shadow-lg"
          style={{ minHeight: 56 }}
        >
          🛒 ĐẶT HÀNG NGAY
        </a>
        <div className="mt-5 flex flex-wrap justify-center gap-4 sm:gap-6 text-sm text-blue-200">
          <span>🔒 Thanh toán an toàn</span>
          <span>🚚 Miễn phí ship từ 500K</span>
          <span>🔄 Đổi trả 7 ngày</span>
        </div>
      </div>
    </div>
  )
}

// MAIN PRODUCT TEMPLATE
const ProductTemplate: React.FC<Props> = ({ product, region, countryCode }) => {
  if (!product || !product.id) return notFound()

  const videoUrl = meta(product, "video_url")
  const productPixelId = meta(product, "fb_pixel_id")
  const globalPixelId = process.env.NEXT_PUBLIC_FB_PIXEL_ID || ""
  const allPixelIds = [...new Set([globalPixelId, productPixelId].filter(Boolean))]

  const variant = product.variants?.[0]
  const basePrice =
    (variant?.calculated_price?.calculated_amount ??
      variant?.prices?.[0]?.amount ??
      0) as number
  const currency = region.currency_code?.toUpperCase() || "VND"

  const pageContent =
    typeof product.metadata?.page_content === "string"
      ? (product.metadata.page_content as string)
      : ""

  const productContext = [
    `Tên sản phẩm: ${product.title}`,
    product.description ? `Mô tả: ${product.description}` : "",
    basePrice ? `Giá: ${new Intl.NumberFormat("vi-VN").format(basePrice)}đ` : "",
    meta(product, "chat_lieu") ? `Chất liệu: ${meta(product, "chat_lieu")}` : "",
    meta(product, "kich_thuoc") ? `Kích thước: ${meta(product, "kich_thuoc")}` : "",
    meta(product, "xuat_xu") ? `Xuất xứ: ${meta(product, "xuat_xu")}` : "",
    meta(product, "bao_hanh") ? `Bảo hành: ${meta(product, "bao_hanh")}` : "",
  ].filter(Boolean).join("\n")

  return (
    <div className="bg-white">
      <ProductPixelTracker
        pixelIds={allPixelIds}
        productId={product.id}
        productTitle={product.title || ""}
        price={basePrice}
        currency={currency}
      />
      {/* Breadcrumb */}
      <div className="bg-gray-50 border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 py-2.5 text-xs text-gray-500 flex gap-1">
          <LocalizedClientLink href="/" className="hover:text-orange-500">Trang chủ</LocalizedClientLink>
          <span>›</span>
          <LocalizedClientLink href="/store" className="hover:text-orange-500">Sản phẩm</LocalizedClientLink>
          <span>›</span>
          <span className="text-gray-800 font-medium">{product.title}</span>
        </div>
      </div>

      {/* HERO - 2 col */}
      <div className="max-w-7xl mx-auto px-4 py-4 sm:py-8" data-testid="product-container">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-10">
          {/* Left: Gallery */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <ImageGallery images={product?.images || []} />
          </div>

          {/* Right: Info + Actions */}
          <div className="flex flex-col gap-5">
            {/* Rating */}
            <div className="flex items-center gap-2">
              <span className="text-orange-400 text-sm">★★★★★</span>
              <span className="text-sm text-gray-500">4.8 (1.247 đánh giá)</span>
              <span className="text-sm text-green-600 font-semibold">● Còn hàng</span>
            </div>

            {/* Title */}
            <h1 className="text-2xl lg:text-3xl font-extrabold text-gray-900 leading-tight" data-testid="product-title">
              {product.title}
            </h1>

            {/* Short description */}
            {product.description && (
              <p className="text-gray-600 leading-relaxed line-clamp-3">{product.description}</p>
            )}

            {/* Bundle selector: add to cart then checkout */}
            <div id="bundle-selector">
              <BundleSelector product={product} region={region} />
            </div>

            {/* Delivery info */}
            <div className="bg-blue-50 rounded-xl p-3 sm:p-4 text-xs sm:text-sm space-y-2">
              <div className="flex gap-2 items-start"><span className="flex-shrink-0">📦</span><span><strong>Giao hàng:</strong> Nội thành 1-2 ngày, tỉnh 2-4 ngày</span></div>
              <div className="flex gap-2 items-start"><span className="flex-shrink-0">🔒</span><span><strong>Thanh toán:</strong> COD, chuyển khoản, QR SePay</span></div>
              <div className="flex gap-2 items-start"><span className="flex-shrink-0">🛡️</span><span><strong>Bảo hành:</strong> {meta(product, "bao_hanh") || "12 tháng"}</span></div>
            </div>
          </div>
        </div>
      </div>

      {/* Combo Bundle — Mua kèm tiết kiệm */}
      {product.metadata?.combo_products && (
        <div className="max-w-3xl mx-auto px-4 py-8">
          <ComboBundle
            mainProduct={product}
            comboProducts={[]}
            discountPercent={Number(meta(product, "combo_discount")) || 15}
          />
        </div>
      )}

      {pageContent ? (
        <ProductPageContent content={pageContent} />
      ) : (
        <>
          {/* Video */}
          <VideoSection videoUrl={videoUrl} />

          {/* Pain → Solution */}
          <PainSolutionSection product={product} />

          {/* Benefits */}
          <BenefitsSection product={product} />

          {/* Description đầy đủ */}
          {product.description && (
            <div className="py-12 bg-white">
              <div className="max-w-4xl mx-auto px-4">
                <h2 className="text-2xl font-extrabold text-gray-900 mb-6">📖 Mô tả sản phẩm</h2>
                <div
                  className="prose prose-gray max-w-none text-gray-700 leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: product.description }}
                />
              </div>
            </div>
          )}

          {/* Specs */}
          <SpecsSection product={product} />

          {/* Reviews */}
          <ReviewsSection product={product} />

          {/* FAQ */}
          <FAQSection product={product} />
        </>
      )}

      {/* Final CTA */}
      <FinalCTA product={product} region={region} />

      {/* Related Products */}
      <div className="py-12 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4">
          <h2 className="text-2xl font-extrabold text-gray-900 mb-8">🛍️ Sản phẩm liên quan</h2>
          <Suspense fallback={<SkeletonRelatedProducts />}>
            <RelatedProducts product={product} countryCode={countryCode} />
          </Suspense>
        </div>
      </div>

      {/* Sticky buy bar — appears when BundleSelector scrolls off screen */}
      <StickyBuyBar product={product} region={region} anchorId="bundle-selector" />

      <ProductChatContextInjector context={productContext} productName={product.title || ""} />
    </div>
  )
}

export default ProductTemplate
