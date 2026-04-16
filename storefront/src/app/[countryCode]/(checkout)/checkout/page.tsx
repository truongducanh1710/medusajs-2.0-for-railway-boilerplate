import { Metadata } from "next"
import { notFound } from "next/navigation"
import { enrichLineItems, retrieveCart } from "@lib/data/cart"
import { HttpTypes } from "@medusajs/types"
import SimpleCheckout from "@modules/checkout/templates/simple-checkout"

export const metadata: Metadata = {
  title: "Đặt hàng | Phan Viet",
}

const fetchCart = async () => {
  const cart = await retrieveCart()
  if (!cart) return notFound()

  if (cart?.items?.length) {
    const enrichedItems = await enrichLineItems(cart.items, cart.region_id!)
    cart.items = enrichedItems as HttpTypes.StoreCartLineItem[]
  }

  return cart
}

export default async function Checkout() {
  const cart = await fetchCart()
  return <SimpleCheckout cart={cart} />
}
