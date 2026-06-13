import { Metadata } from "next"
import { redirect } from "next/navigation"
import { retrieveCart } from "@lib/data/cart"
import { listCartShippingMethods } from "@lib/data/fulfillment"
import SimpleCheckout from "@modules/checkout/templates/simple-checkout"
import CheckoutTracker from "@components/CheckoutTracker"

export const metadata: Metadata = {
  title: "Đặt hàng | Phan Viet",
}

export default async function Checkout({
  params,
}: {
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await params
  const cart = await retrieveCart()
  if (!cart) redirect(`/${countryCode}`)

  // retrieveCart đã trả về items.variant.product.{thumbnail,images} — checkout chỉ
  // dùng những field này, nên KHÔNG cần enrichLineItems (1 round-trip API thừa).
  const shippingOptions = await listCartShippingMethods(cart.id)

  const contentIds = (cart.items ?? [])
    .map((i) => i.variant_id || i.id)
    .filter(Boolean) as string[]
  const numItems = (cart.items ?? []).reduce((sum, i) => sum + (i.quantity ?? 0), 0)

  // Quick-buy flow: cart holds a single product — use its own pixel if set
  const firstProductMeta = (cart.items?.[0] as any)?.variant?.product?.metadata ?? {}

  return (
    <>
      <CheckoutTracker
        contentIds={contentIds}
        value={cart.total ?? 0}
        currency={(cart.currency_code ?? "vnd").toUpperCase()}
        numItems={numItems}
        productPixelId={firstProductMeta.fb_pixel_id}
        productCapiToken={firstProductMeta.fb_capi_token}
      />
      <SimpleCheckout cart={cart} shippingOptions={shippingOptions} />
    </>
  )
}
