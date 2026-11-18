import { Modules } from "@medusajs/framework/utils"
import { EmailTemplates } from "../modules/email-notifications/templates"
import { notifyTelegramByEmail } from "./notify"

/**
 * Digital products (product.metadata.digital_delivery = true) are paid by SePay only.
 * Once payment is confirmed the customer gets an email with the product's Drive folder
 * (product.metadata.digital_drive_url). Variants with metadata.requires_shipping = true
 * (e.g. printed calendar) also get the files; the physical item ships later via Pancake.
 * Those shipped variants may also be COD: then the files go out when Pancake marks the
 * order delivered (status 3), see api/store/pancake/webhook.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isDigitalFlag(value: unknown): boolean {
  return value === true || value === "true"
}

export function isRealCustomerEmail(email?: string | null): boolean {
  return !!email && EMAIL_RE.test(email) && !/@example\.com$/i.test(email)
}

export type GiftLink = { name: string; url: string; when?: "any" | "transfer" }

/**
 * Bonus files sent with a shipped variant: variant.metadata.gift_links = [{ name, url, when }].
 * when "transfer" = only for orders paid by QR transfer (SePay), "any" (default) = COD too.
 * The product page shows the same gifts from bundle_options_v2 (gifts[].when).
 */
export function giftLinksFor(variantMeta: Record<string, any> | null | undefined, paidByTransfer: boolean): GiftLink[] {
  let raw = variantMeta?.gift_links
  if (typeof raw === "string") { try { raw = JSON.parse(raw) } catch { raw = [] } }
  if (!Array.isArray(raw)) return []
  return raw
    .filter((g: any) => g && typeof g.name === "string" && typeof g.url === "string" && /^https:\/\//.test(g.url))
    .filter((g: any) => g.when !== "transfer" || paidByTransfer)
    .map((g: any) => ({ name: g.name, url: g.url, when: g.when === "transfer" ? "transfer" : "any" }))
}

export async function sendDigitalDeliveryIfNeeded(
  scope: any,
  orderId: string,
  opts: { codDelivered?: boolean } = {}
): Promise<"sent" | "skipped" | "already_sent"> {
  const orderService = scope.resolve(Modules.ORDER) as any
  const productService = scope.resolve(Modules.PRODUCT) as any

  const order = await orderService.retrieveOrder(orderId, {
    select: ["id", "display_id", "email", "metadata"],
    relations: ["items", "shipping_address"],
  })
  const meta = (order.metadata ?? {}) as Record<string, any>
  if (meta.digital_sent_at) return "already_sent"
  const codDelivered = !!opts.codDelivered && meta.payment_method === "cod"
  if (meta.payment_status !== "paid" && !codDelivered) return "skipped"

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
  // COD delivery is only offered for shipped variants; a download-only COD order is never sent
  if (codDelivered && !shipsPhysical) return "skipped"
  const orderCode = `#${order.display_id ?? order.id}`
  const gifts = giftLinksFor(variant?.metadata, meta.payment_method === "sepay" && !codDelivered)

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
        // COD: the calendar has already arrived, don't promise it again
        shipsPhysical: shipsPhysical && !codDelivered,
        gifts,
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
  console.info("[DigitalDelivery] sent", { orderId, email, shipsPhysical, gifts: gifts.length })
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
  // bundle_price = server-set line total (quantity tiers), else unit price × quantity
  const listTotal = Number(order.items?.reduce((s: number, i: any) => s + (i.metadata?.bundle_price != null ? Number(i.metadata.bundle_price) : Number(i.unit_price ?? 0) * Number(i.quantity ?? 1)), 0) ?? 0)
  const qty = Number(order.items?.find((i: any) => i.variant_id === variant?.id)?.quantity ?? 1)
  // Paid amount: list price minus the QR incentive (e.g. printed calendar 149K → 139K)
  const total = Math.max(0, listTotal - (meta.payment_method === "sepay" ? Number(meta.sepay_discount ?? 0) || 0 : 0))
  // Orders the Messenger sale bot closed: the bot sends the link in the chat once paid (no email needed)
  const viaBot = meta.checkout_mode === "messenger_bot"
  const mailLine = meta.digital_sent_at
    ? `✅ Đã gửi email tới ${esc(order.email)}`
    : viaBot
      ? `💬 Đơn chốt qua Messenger (bot) → bot tự gửi link trong tin nhắn`
      : `⚠️ Email CHƯA gửi được (${esc(meta.digital_send_error || "chưa rõ")}) → gửi link qua Zalo tay`
  const lines = [
    `🧾 <b>Đơn mới: ${esc(product.title)}</b>`,
    `Đơn #${esc(order.display_id ?? order.id)} · ${esc(variant?.title)}${qty > 1 ? ` × ${qty}` : ""} · ${total.toLocaleString("vi-VN")}đ · ĐÃ THANH TOÁN`,
    `👤 ${esc(name)}`,
    a.phone ? `📱 Zalo: ${esc(a.phone)}` : "",
    isRealCustomerEmail(order.email) ? `📧 ${esc(order.email)}` : "",
    ships ? `📦 Giao lịch: ${esc([a.address_1, a.city, a.province].filter(Boolean).join(", "))}` : `📄 Bản tải về (không giao hàng)`,
    mailLine,
    product.metadata?.digital_drive_url ? `🔗 Link gửi khách: ${esc(product.metadata.digital_drive_url)}` : "",
  ].filter(Boolean)

  // Ready-to-copy message for Zalo/manual email (tap the block in Telegram to copy)
  const drive = String(product.metadata?.digital_drive_url ?? "")
  // Telegram fires only for paid orders: COD orders paid on delivery are not "sepay"
  const gifts = giftLinksFor(variant?.metadata, meta.payment_method === "sepay")
  if (gifts.length) lines.push(`🎁 Quà: ${gifts.map((g) => esc(g.name)).join(" · ")}`)
  const greet = a.first_name ? `Chào anh/chị ${a.first_name}` : "Chào anh/chị"
  const msg = [
    `${greet}, Phan Việt đã nhận thanh toán đơn #${order.display_id ?? order.id} — ${product.title}. Cảm ơn anh/chị ạ!`,
    "",
    "📂 Link tài liệu (PDF 28 trang + 27 video):",
    drive,
    ...gifts.flatMap((g) => ["", `🎁 Quà tặng: ${g.name}`, g.url]),
    "",
    "Cách dùng: bấm link là mở được ngay trên điện thoại, không cần cài gì. Video xem trực tiếp; file PDF có thể tải về để in. Nên lưu link này lại để dùng lâu dài.",
    ...(ships ? ["", "📦 Lịch để bàn sẽ được giao tới địa chỉ anh/chị đã đặt trong 3–5 ngày tuỳ vùng miền."] : []),
    "",
    "Mở link không được hoặc cần hỗ trợ, anh/chị nhắn lại Zalo này giúp shop nhé. Chúc bé học tốt! 🌟",
  ].join(String.fromCharCode(10))
  lines.push("", "📋 <b>Tin gửi khách (bấm để copy):</b>", `<pre>${esc(msg)}</pre>`)

  const userModule = scope.resolve(Modules.USER)
  for (const e of emails) await notifyTelegramByEmail(userModule, e, lines.join("\n"), "digital_order")
  await orderService.updateOrders([{ id: orderId, metadata: { ...meta, digital_tg_at: new Date().toISOString() } }])
}
