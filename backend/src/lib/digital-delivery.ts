import { Modules } from "@medusajs/framework/utils"
import { EmailTemplates } from "../modules/email-notifications/templates"
import { notifyTelegramByEmail } from "./notify"

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

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/**
 * Telegram alert for a paid digital-product order (once per order, via metadata.digital_tg_at).
 * Recipients: product.metadata.notify_tg_emails (comma-separated admin emails linked to the bot).
 * Shows whether the email went out so staff know when to send the Drive link by Zalo manually.
 */
export async function notifyDigitalOrderTelegram(scope: any, orderId: string): Promise<void> {
  const orderService = scope.resolve(Modules.ORDER) as any
  const productService = scope.resolve(Modules.PRODUCT) as any
  const order = await orderService.retrieveOrder(orderId, {
    select: ["id", "display_id", "email", "metadata", "total"],
    relations: ["items", "shipping_address"],
  })
  const meta = (order.metadata ?? {}) as Record<string, any>
  if (meta.digital_tg_at || meta.payment_status !== "paid") return

  const variantIds = (order.items ?? []).map((i: any) => i.variant_id).filter(Boolean)
  if (!variantIds.length) return
  const variants = await productService.listProductVariants({ id: variantIds }, { select: ["id", "title", "metadata", "product_id"] })
  const products = await productService.listProducts(
    { id: [...new Set(variants.map((v: any) => v.product_id))] },
    { select: ["id", "title", "metadata"] }
  )
  const product = products.find((p: any) => isDigitalFlag(p.metadata?.digital_delivery))
  if (!product) return
  const emails = String(product.metadata?.notify_tg_emails ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  if (!emails.length) return

  const variant = variants.find((v: any) => v.product_id === product.id)
  const ships = isDigitalFlag(variant?.metadata?.requires_shipping)
  const a = order.shipping_address ?? {}
  const name = [a.first_name, a.last_name].filter(Boolean).join(" ")
  const total = Number(order.items?.reduce((s: number, i: any) => s + Number(i.unit_price ?? 0) * Number(i.quantity ?? 1), 0) ?? 0)
  const mailLine = meta.digital_sent_at
    ? `✅ Đã gửi email tới ${esc(order.email)}`
    : `⚠️ Email CHƯA gửi được (${esc(meta.digital_send_error || "chưa rõ")}) → gửi link qua Zalo tay`
  const lines = [
    `🧾 <b>Đơn mới: ${esc(product.title)}</b>`,
    `Đơn #${esc(order.display_id ?? order.id)} · ${esc(variant?.title)} · ${total.toLocaleString("vi-VN")}đ · ĐÃ THANH TOÁN`,
    `👤 ${esc(name)}`,
    `📱 Zalo: ${esc(a.phone)}`,
    `📧 ${esc(order.email)}`,
    ships ? `📦 Giao lịch: ${esc([a.address_1, a.city, a.province].filter(Boolean).join(", "))}` : `📄 Bản tải về (không giao hàng)`,
    mailLine,
    product.metadata?.digital_drive_url ? `🔗 Link gửi khách: ${esc(product.metadata.digital_drive_url)}` : "",
  ].filter(Boolean)

  const userModule = scope.resolve(Modules.USER)
  for (const e of emails) await notifyTelegramByEmail(userModule, e, lines.join("\n"), "digital_order")
  await orderService.updateOrders([{ id: orderId, metadata: { ...meta, digital_tg_at: new Date().toISOString() } }])
}
