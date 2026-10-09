import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { addShippingMethodToCartWorkflow, listShippingOptionsForCartWithPricingWorkflow } from "@medusajs/medusa/core-flows"
import { loadBundleShippingContext, validateBundleShippingCart } from "../../../../../lib/bundle-shipping"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { cart, plan } = await loadBundleShippingContext(req.scope, req.params.id, true)
    if (!plan || cart.completed_at) return res.status(400).json({ message: "Giỏ hàng không hỗ trợ giao combo này." })
    const requestedId = (req.body as any)?.shipping_option_id
    if (requestedId != null && requestedId !== plan.optionId) return res.status(400).json({ message: "Phương thức vận chuyển không đúng với combo." })
    const { result: options } = await listShippingOptionsForCartWithPricingWorkflow(req.scope).run({ input: { cart_id: cart.id, options: [{ id: plan.optionId }] } })
    const option = options.find((entry: any) => entry.id === plan.optionId)
    if (!option || option.price_type !== "flat" || option.shipping_profile_id !== plan.profileId || Number(option.calculated_price?.calculated_amount) !== plan.fee) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Phí vận chuyển của combo chưa được cấu hình đúng.")
    await addShippingMethodToCartWorkflow(req.scope).run({ input: { cart_id: cart.id, options: [{ id: plan.optionId }] } })
    await validateBundleShippingCart(req.scope, cart.id)
    const { data } = await req.scope.resolve(ContainerRegistrationKeys.QUERY).graph({ entity: "cart", fields: ["*", "items.*", "items.metadata", "shipping_methods.*", "shipping_address.*", "billing_address.*", "payment_collection.*", "payment_collection.payment_sessions.*"], filters: { id: cart.id } })
    return res.status(200).json({ cart: data[0] })
  } catch (error: any) {
    return res.status(error?.type === MedusaError.Types.NOT_FOUND ? 404 : 400).json({ message: error?.message || "Không thể cập nhật phí vận chuyển." })
  }
}
