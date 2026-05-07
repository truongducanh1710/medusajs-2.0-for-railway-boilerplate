import { Heading } from "@medusajs/ui"
import { cookies } from "next/headers"
import { Suspense } from "react"

import OnboardingCta from "@modules/order/components/onboarding-cta"
import OrderDetails from "@modules/order/components/order-details"
import ProductPreview from "@modules/products/components/product-preview"
import { getProductsList } from "@lib/data/products"
import { getRegion } from "@lib/data/regions"
import { HttpTypes } from "@medusajs/types"

type OrderCompletedTemplateProps = {
  order: HttpTypes.StoreOrder
  countryCode: string
}

async function OrderCrossSell({ order, countryCode }: { order: HttpTypes.StoreOrder; countryCode: string }) {
  const region = await getRegion(countryCode)
  if (!region) return null

  const boughtIds = (order.items || []).map((i: any) => i.product_id).filter(Boolean)
  const { response } = await getProductsList({ queryParams: { limit: 8 }, countryCode })
  const products = response.products.filter((p: any) => !boughtIds.includes(p.id)).slice(0, 4)
  if (!products.length) return null

  return (
    <div style={{ marginTop: 40, paddingTop: 32, borderTop: "1px solid #e5e7eb" }}>
      <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 16, color: "#1a1a2e" }}>
        🛍️ Bạn có thể thích
      </h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
        {products.map((p: any) => (
          <ProductPreview key={p.id} product={p} region={region} />
        ))}
      </div>
    </div>
  )
}

export default function OrderCompletedTemplate({
  order,
  countryCode,
}: OrderCompletedTemplateProps) {
  const isOnboarding = cookies().get("_medusa_onboarding")?.value === "true"

  // Tính lại subtotal từ bundle_price nếu có
  const bundleSubtotal = (order.items || []).reduce((sum, item) => {
    const meta = item.metadata as any
    const bundlePrice = meta?.bundle_price != null ? Number(meta.bundle_price) : null
    return sum + (bundlePrice != null ? bundlePrice : (item.unit_price * item.quantity))
  }, 0)

  const shippingTotal = order.shipping_total ?? 0
  const taxTotal = order.tax_total ?? 0
  const discountTotal = order.discount_total ?? 0
  const bundleTotal = Math.max(0, bundleSubtotal - discountTotal) + shippingTotal + taxTotal

  const correctedTotals = {
    ...order,
    subtotal: bundleSubtotal,
    total: bundleTotal,
  }

  return (
    <div className="py-6 min-h-[calc(100vh-64px)]">
      <div className="content-container flex flex-col justify-center items-center gap-y-10 max-w-4xl h-full w-full">
        {isOnboarding && <OnboardingCta orderId={order.id} />}
        <div
          className="flex flex-col gap-4 max-w-4xl h-full bg-white w-full py-10"
          data-testid="order-complete-container"
        >
          <Heading
            level="h1"
            className="flex flex-col gap-y-3 text-ui-fg-base text-3xl mb-4"
          >
            <span>Cảm ơn bạn!</span>
            <span>Đơn hàng của bạn đã được đặt thành công.</span>
          </Heading>
          <OrderDetails order={order} />

          {/* Banner nhắc khách để ý điện thoại */}
          <div style={{
            background: "linear-gradient(135deg, #fff7ed, #ffedd5)",
            border: "2px solid #fb923c",
            borderRadius: 16,
            padding: "20px 24px",
            display: "flex",
            gap: 16,
            alignItems: "flex-start",
          }}>
            <span style={{ fontSize: 32, lineHeight: 1 }}>📞</span>
            <div>
              <p style={{ fontWeight: 800, color: "#c2410c", fontSize: 16, margin: "0 0 4px" }}>
                Hãy để ý điện thoại nhé!
              </p>
              <p style={{ color: "#9a3412", fontSize: 14, margin: 0, lineHeight: 1.6 }}>
                Nhân viên bên em sẽ gọi xác nhận đơn hàng cho mình trong thời gian sớm nhất ạ 🙏
              </p>
            </div>
          </div>

          {/* Tóm tắt gọn */}
          <div style={{ background: "#f9fafb", borderRadius: 12, padding: "16px 20px", fontSize: 14 }}>
            <p style={{ fontWeight: 700, color: "#374151", marginBottom: 10, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.05em" }}>Tóm tắt đơn hàng</p>

            {/* Items gọn */}
            {(order.items || []).map((item: any) => {
              const meta = item.metadata as any
              const bundlePrice = meta?.bundle_price != null ? Number(meta.bundle_price) : item.unit_price * item.quantity
              const bundleQty = meta?.bundle_qty ?? item.quantity
              return (
                <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 }}>
                  <span style={{ color: "#374151", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.title} <span style={{ color: "#9ca3af" }}>×{bundleQty}</span>
                  </span>
                  <span style={{ fontWeight: 700, color: "#111827", flexShrink: 0 }}>
                    {new Intl.NumberFormat("vi-VN").format(bundlePrice)}đ
                  </span>
                </div>
              )
            })}

            {/* Tổng */}
            <div style={{ borderTop: "1px solid #e5e7eb", marginTop: 10, paddingTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 700, color: "#111827" }}>Tổng cộng</span>
              <span style={{ fontWeight: 900, color: "#e8420a", fontSize: 18 }}>
                {new Intl.NumberFormat("vi-VN").format(bundleTotal)}đ
              </span>
            </div>

            {/* Địa chỉ + Thanh toán gọn 1 dòng */}
            <div style={{ borderTop: "1px solid #e5e7eb", marginTop: 10, paddingTop: 10, display: "flex", gap: 16, flexWrap: "wrap", color: "#6b7280", fontSize: 13 }}>
              <span>📍 {[order.shipping_address?.address_1, order.shipping_address?.city].filter(Boolean).join(", ")}</span>
              <span>💳 {order.payment_collections?.[0]?.payments?.[0]?.provider_id === "pp_system_default" ? "COD — Thu khi nhận" : "Đã thanh toán"}</span>
              <span>📞 {order.shipping_address?.phone}</span>
            </div>
          </div>

          <Suspense fallback={<div style={{ height: 200 }} />}>
            <OrderCrossSell order={order} countryCode={countryCode} />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
