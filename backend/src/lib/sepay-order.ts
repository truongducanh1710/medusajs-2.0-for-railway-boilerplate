import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { completeCartWorkflow } from "@medusajs/medusa/core-flows"
import { sendPurchaseEvent } from "./fb-capi"

/**
 * SePay QR flow: storefront shows QR with content `PV{cartId without "cart_"}`.
 * Both the SePay webhook and the storefront status poll call confirmSepayPayment,
 * so the order is created server-side even if the customer closes the tab after paying.
 */

// Allowed shortfall: storefront rounds promo discount up to 1.000đ steps + legacy 1.000đ rounding
const AMOUNT_TOLERANCE = 2000

export type SepayTx = {
  amount: number
  content?: string
  reference?: string
  transactionDate?: string
  gateway?: string
}

// Flat shape (not a discriminated union): backend tsconfig is non-strict, so `ok` narrowing doesn't work
export type SepayConfirmResult = {
  ok: boolean
  orderId?: string
  reason?: "cart_not_found" | "amount_mismatch"
  expected?: number
  received?: number
}

// Cart ids are "cart_" + 26-char ULID; banks may glue extra chars after the code
export function cartIdFromTransferContent(content?: string | null): string | null {
  const m = content?.toUpperCase().match(/PV([0-9A-Z]{26})/)
  return m ? `cart_${m[1]}` : null
}

export function cartIdFromOrderCode(orderCode: string): string {
  return `cart_${orderCode.replace(/^PV/i, "").toUpperCase()}`
}

export async function findOrderIdForCart(scope: any, cartId: string): Promise<string | null> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order_cart",
    fields: ["order_id"],
    filters: { cart_id: cartId },
  })
  return data?.[0]?.order_id ?? null
}

// Mirror of storefront SimpleCheckout total: sum(bundle_price ?? unit_price*qty)
// - promo (rounded up to 1.000đ) - sepay_discount, min 1.000đ
function expectedSepayAmount(cart: any): number {
  const items = cart.items ?? []
  const subtotal = items.reduce((sum: number, item: any) => {
    const bundlePrice = item.metadata?.bundle_price
    return sum + (bundlePrice != null ? Number(bundlePrice) : Number(item.unit_price) * Number(item.quantity))
  }, 0)
  const rawDiscount = items.reduce(
    (sum: number, item: any) =>
      sum + (item.adjustments ?? []).reduce((s: number, a: any) => s + Number(a.amount ?? 0), 0),
    0
  )
  const discount = Math.min(subtotal, rawDiscount > 0 ? Math.ceil(rawDiscount / 1000) * 1000 : 0)
  const sepayDiscount = Number(cart.metadata?.sepay_discount ?? 0)
  return Math.max(1000, subtotal - discount - sepayDiscount)
}

export async function confirmSepayPayment(
  scope: any,
  cartId: string,
  tx: SepayTx
): Promise<SepayConfirmResult> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: carts } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "email",
      "completed_at",
      "metadata",
      "items.id",
      "items.variant_id",
      "items.unit_price",
      "items.quantity",
      "items.metadata",
      "items.adjustments.amount",
      "shipping_address.first_name",
      "shipping_address.last_name",
      "shipping_address.phone",
      "shipping_address.city",
    ],
    filters: { id: cartId },
  })
  const cart = carts?.[0]
  if (!cart) {
    return { ok: false, reason: "cart_not_found" }
  }

  const expected = expectedSepayAmount(cart)
  if (tx.amount + AMOUNT_TOLERANCE < expected) {
    console.warn("[SePay] amount mismatch", { cartId, expected, received: tx.amount })
    return { ok: false, reason: "amount_mismatch", expected, received: tx.amount }
  }

  const paymentMeta = {
    payment_status: "paid",
    sepay_transaction_date: tx.transactionDate,
    sepay_reference_code: tx.reference,
    sepay_amount: tx.amount,
    sepay_content: tx.content,
    sepay_gateway: tx.gateway,
  }
  const alreadyPaid = cart.metadata?.payment_status === "paid"

  let orderId = await findOrderIdForCart(scope, cartId)

  if (!orderId) {
    // Write payment info on the cart first: completeCartWorkflow copies cart.metadata to the
    // order, so order-placed subscriber (Pancake push) sees payment_status=paid from the start.
    const cartService = scope.resolve(Modules.CART) as any
    await cartService.updateCarts([{ id: cartId, metadata: { ...(cart.metadata ?? {}), ...paymentMeta } }])

    try {
      // Idempotent + locked in Medusa 2.12: concurrent webhook/poll get the same order id
      const { result } = await completeCartWorkflow(scope).run({ input: { id: cartId } })
      orderId = result.id
    } catch (err) {
      orderId = await findOrderIdForCart(scope, cartId)
      if (!orderId) throw err
    }
    console.info("[SePay] order created from payment", { cartId, orderId, amount: tx.amount })
  } else {
    const orderService = scope.resolve(Modules.ORDER) as any
    const order = await orderService.retrieveOrder(orderId, { select: ["id", "metadata"] })
    if (order.metadata?.payment_status !== "paid") {
      await orderService.updateOrders([{ id: orderId, metadata: { ...(order.metadata ?? {}), ...paymentMeta } }])
    }
  }

  if (!alreadyPaid) {
    await firePurchase(scope, orderId as string, cart, tx.amount).catch((err) =>
      console.warn("[SePay] CAPI Purchase error:", err?.message)
    )
  }

  return { ok: true, orderId: orderId as string }
}

// Purchase fires at payment time for SePay; pancake webhook skips orders with payment_status=paid.
// CompleteRegistration is already sent by the order-placed subscriber.
async function firePurchase(scope: any, orderId: string, cart: any, amount: number) {
  const meta = cart.metadata ?? {}

  let storePixelId: string | undefined
  let storeCapiToken: string | undefined
  try {
    const stores = await scope.resolve(Modules.STORE).listStores({}, { select: ["id", "metadata"] })
    storePixelId = stores?.[0]?.metadata?.fb_pixel_id
    storeCapiToken = stores?.[0]?.metadata?.fb_capi_token
  } catch {}

  let productPixelId: string | undefined
  let productCapiToken: string | undefined
  try {
    const variantId = cart.items?.[0]?.variant_id
    if (variantId) {
      const productService = scope.resolve(Modules.PRODUCT) as any
      const variants = await productService.listProductVariants({ id: [variantId] }, { select: ["id", "product_id"] })
      const productId = variants?.[0]?.product_id
      if (productId) {
        const products = await productService.listProducts({ id: [productId] }, { select: ["id", "metadata"] })
        productPixelId = products?.[0]?.metadata?.fb_pixel_id
        productCapiToken = products?.[0]?.metadata?.fb_capi_token
      }
    }
  } catch {}

  const addr = cart.shipping_address ?? {}
  await sendPurchaseEvent({
    orderId,
    phone: addr.phone,
    email: cart.email,
    customerName: addr.first_name ? `${addr.first_name} ${addr.last_name ?? ""}`.trim() : undefined,
    city: addr.city,
    fbclid: meta.fbclid,
    fbp: meta.fbp,
    fbc: meta.fbc,
    client_ip_address: meta.client_ip_address,
    client_user_agent: meta.client_user_agent,
    value: amount,
    contentIds: (cart.items ?? []).map((i: any) => i.variant_id || i.id).filter(Boolean),
    storePixelId,
    storeCapiToken,
    productPixelId,
    productCapiToken,
  })
}
