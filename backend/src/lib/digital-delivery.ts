import { Modules } from "@medusajs/framework/utils"
import { EmailTemplates } from "../modules/email-notifications/templates"

/**
 * Digital products (product.metadata.digital_delivery = true) are paid by SePay only.
 * Once payment is confirmed the customer gets an email with the product's Drive folder
 * (product.metadata.digital_drive_url). Variants with metadata.requires_shipping = true
 * (e.g. printed calendar) also get the files; the physical item ships later via Pancake.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isDigitalFlag(value: unknown): boolean {
  return value === true || value === "true"
}

export function isRealCustomerEmail(email?: string | null): boolean {
  return !!email && EMAIL_RE.test(email) && !/@example\.com$/i.test(email)
}

export async function sendDigitalDeliveryIfNeeded(scope: any, orderId: string): Promise<"sent" | "skipped" | "already_sent"> {
  const orderService = scope.resolve(Modules.ORDER) as any
  const productService = scope.resolve(Modules.PRODUCT) as any

  const order = await orderService.retrieveOrder(orderId, {
    select: ["id", "display_id", "email", "metadata"],
    relations: ["items", "shipping_address"],
  })
  const meta = (order.metadata ?? {}) as Record<string, any>
  if (meta.digital_sent_at) return "already_sent"
  if (meta.payment_status !== "paid") return "skipped"

  const variantIds = (order.items ?? []).map((i: any) => i.variant_id).filter(Boolean)
  if (!variantIds.length) return "skipped"
  const variants = await productService.listProductVariants(
    { id: variantIds },
    { select: ["id", "title", "metadata", "product_id"] }
  )
  const productIds = [...new Set(variants.map((v: any) => v.product_id))]
  const products = await productService.listProducts({ id: productIds }, { select: ["id", "title", "metadata"] })
  const digitalProduct = products.find((p: any) => isDigitalFlag(p.metadata?.digital_delivery))
  if (!digitalProduct) return "skipped"

  const driveUrl = String(digitalProduct.metadata?.digital_drive_url ?? "").trim()
  const email = order.email
  const failure = !driveUrl ? "missing_drive_url" : !isRealCustomerEmail(email) ? "invalid_email" : null
  if (failure) {
    console.error("[DigitalDelivery] cannot send", { orderId, failure, email })
    await orderService.updateOrders([{ id: orderId, metadata: { ...meta, digital_send_error: failure } }])
    return "skipped"
  }

  const variant = variants.find((v: any) => v.product_id === digitalProduct.id)
  const shipsPhysical = isDigitalFlag(variant?.metadata?.requires_shipping)
  const orderCode = `#${order.display_id ?? order.id}`

  const notificationService = scope.resolve(Modules.NOTIFICATION) as any
  try {
    await notificationService.createNotifications({
      to: email,
      channel: "email",
      template: EmailTemplates.DIGITAL_DELIVERY,
      data: {
        emailOptions: {
          subject: `Tài liệu ${digitalProduct.title} — đơn ${orderCode}`,
        },
        customerName: order.shipping_address?.first_name || undefined,
        productTitle: digitalProduct.title,
        variantTitle: variant?.title,
        orderCode,
        driveUrl,
        shipsPhysical,
      },
    })
  } catch (err: any) {
    console.error("[DigitalDelivery] send failed", { orderId, message: err?.message })
    await orderService.updateOrders([{ id: orderId, metadata: { ...meta, digital_send_error: String(err?.message ?? err).slice(0, 300) } }])
    return "skipped"
  }

  const { digital_send_error, ...rest } = meta
  await orderService.updateOrders([{
    id: orderId,
    metadata: { ...rest, digital_sent_at: new Date().toISOString(), digital_sent_to: email },
  }])
  console.info("[DigitalDelivery] sent", { orderId, email, shipsPhysical })
  return "sent"
}
