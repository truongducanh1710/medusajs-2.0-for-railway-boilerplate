import { Metadata } from "next"
import { notFound } from "next/navigation"
import { enrichLineItems, retrieveCart } from "@lib/data/cart"
import { listCartShippingMethods } from "@lib/data/fulfillment"
import { HttpTypes } from "@medusajs/types"
import SimpleCheckout from "@modules/checkout/templates/simple-checkout"

export const metadata: Metadata = {
  title: "Đặt hàng | Phan Viet",
}

const fetchCart = async () => {
  // Retry up to 6 times (3s total) in case addToCart is still in flight
  let cart = null
  for (let i = 0; i < 6; i++) {
    cart = await retrieveCart()
    if (cart?.items?.length) break
    if (i < 5) await new Promise(r => setTimeout(r, 500))
  }

  if (!cart) return notFound()

  if (cart?.items?.length) {
    const enrichedItems = await enrichLineItems(cart.items, cart.region_id!)
    cart.items = enrichedItems as HttpTypes.StoreCartLineItem[]
  }

  return cart
}

export default async function Checkout() {
  const cart = await fetchCart()
  const shippingOptions = await listCartShippingMethods(cart.id)
  return <SimpleCheckout cart={cart} shippingOptions={shippingOptions} />
}
