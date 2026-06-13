"use server"

import { sdk } from "@lib/config"
import medusaError from "@lib/util/medusa-error"
import { cache } from "react"
import { getAuthHeaders } from "./cookies"

export const retrieveOrder = cache(async function (id: string) {
  return sdk.store.order
    .retrieve(
      id,
      {
        // Lấy luôn thumbnail + metadata của line items trong 1 call để trang confirmed
        // không phải gọi enrichLineItems (1 round-trip API thừa).
        fields:
          "*payment_collections.payments,*items,+items.thumbnail,+items.metadata,+items.product_id,+items.title,+items.quantity,+items.unit_price",
      },
      { next: { tags: ["order"] }, ...getAuthHeaders() }
    )
    .then(({ order }) => order)
    .catch((err) => medusaError(err))
})

export const listOrders = cache(async function (
  limit: number = 10,
  offset: number = 0
) {
  return sdk.store.order
    .list({ limit, offset }, { next: { tags: ["order"] }, ...getAuthHeaders() })
    .then(({ orders }) => orders)
    .catch((err) => medusaError(err))
})
