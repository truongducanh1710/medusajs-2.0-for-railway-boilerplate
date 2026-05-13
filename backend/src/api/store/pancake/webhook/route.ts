import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createHmac, timingSafeEqual } from "crypto"
import { PANCAKE_WEBHOOK_SECRET } from "../../../../lib/constants"

const STATUS_VI: Record<number, string> = {
  0: "Chờ xử lý", 1: "Đã xác nhận", 2: "Đang đóng gói", 3: "Chờ giao hàng",
  4: "Đang giao", 5: "Hoàn thành", 6: "Đã gửi VC", 7: "Đã hủy",
  9: "Đã gửi VC", 11: "Chờ hàng", [-1]: "Đã hủy", [-2]: "Hoàn hàng",
}

function statusLabel(status: number): string {
  return STATUS_VI[status] ?? STATUS_VI[String(status)] ?? `Trạng thái ${status}`
}

/**
 * Verify HMAC signature from Pancake webhook.
 * Uses SHA-256 with PANCAKE_WEBHOOK_SECRET.
 */
function verifyHmac(rawBody: string, signature: string | null): boolean {
  if (!PANCAKE_WEBHOOK_SECRET) {
    // Secret not configured — skip verification (backward compat)
    return true
  }
  if (!signature) {
    return false
  }
  try {
    const hmac = createHmac("sha256", PANCAKE_WEBHOOK_SECRET)
    hmac.update(rawBody)
    const computed = hmac.digest("hex")
    // Constant-time comparison to prevent timing attacks
    const bufA = Buffer.from(computed)
    const bufB = Buffer.from(signature)
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
  } catch {
    return false
  }
}

/**
 * POST /store/pancake/webhook
 * Pancake POS calls this endpoint on any change (orders, warehouse, products...).
 *
 * Phase 3: HMAC verification + upsert into pancake_order table.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = req.body as any

  try {
    // --- HMAC Signature Verification ---
    if (PANCAKE_WEBHOOK_SECRET) {
      const rawBody = req.rawBody ?? JSON.stringify(body)
      const signature = (req.headers["x-pancake-signature"] as string) ?? null
      if (!verifyHmac(rawBody, signature)) {
        console.warn("[Pancake Webhook] Invalid HMAC signature — rejecting")
        return res.status(401).json({ error: "Invalid signature" })
      }
    }

    // --- Event type detection ---
    const isWarehouseEvent = body?.type === "variations_warehouses" || body?.order_id
    const isProductEvent = Array.isArray(body?.variations) && !body?.system_id

    if (isWarehouseEvent || isProductEvent) {
      // Not an order event — silently ignore
      return res.json({ success: true })
    }

    // --- Order event detection ---
    const pancakeOrderId = String(body?.system_id || body?.id || "")
    const pancakeStatus: number = Number(body?.status ?? -999)
    const isOrderEvent = /^\d+$/.test(pancakeOrderId) && pancakeStatus !== -999

    if (!isOrderEvent) {
      return res.json({ success: true })
    }

    const label = statusLabel(pancakeStatus)
    console.log(`[Pancake Webhook] ✅ Đơn #${pancakeOrderId} → ${label} (${pancakeStatus})`)

    // --- 1. Upsert into pancake_order table ---
    try {
      const syncService = req.scope.resolve("pancakeSyncModule") as any

      const existing = await syncService.listPancakeOrders(
        { id: pancakeOrderId },
        { take: 1 }
      )

      if (existing.length > 0) {
        const prev = existing[0]
        const prevHistory: any[] = Array.isArray(prev.status_history) ? prev.status_history : []
        const statusChanged = prev.status !== pancakeStatus

        await syncService.updatePancakeOrders({
          id: pancakeOrderId,
          status: pancakeStatus,
          status_name: label,
          status_history: statusChanged
            ? [
                ...prevHistory,
                {
                  status: pancakeStatus,
                  status_name: label,
                  changed_at: new Date().toISOString(),
                  source: "webhook",
                },
              ]
            : prevHistory,
          ...(body?.partner?.extend_code
            ? { tracking_code: body.partner.extend_code }
            : {}),
          synced_at: new Date(),
        })

        if (statusChanged) {
          console.log(`[Pancake Webhook] Updated pancake_order #${pancakeOrderId} → ${label}`)
        }
      } else {
        // Order not yet synced — insert minimal row (no items/raw, data_quality=partial)
        await syncService.createPancakeOrders([{
          id: pancakeOrderId,
          status: pancakeStatus,
          status_name: label,
          status_history: [{
            status: pancakeStatus,
            status_name: label,
            changed_at: new Date().toISOString(),
            source: "webhook",
          }],
          customer_name: body?.bill_full_name ?? "",
          customer_phone: body?.bill_phone_number ?? "",
          total: body?.total_price ?? 0,
          tracking_code: body?.partner?.extend_code ?? "",
          data_quality: "partial",
          synced_at: new Date(),
        }])
        console.log(`[Pancake Webhook] Created minimal pancake_order #${pancakeOrderId}`)
      }
    } catch (dbErr: any) {
      console.error("[Pancake Webhook] DB upsert error:", dbErr.message)
      // Don't fail — continue to Medusa update
    }

    // --- 2. Update Medusa order metadata (backward compat) ---
    try {
      const orderService = req.scope.resolve("orderModuleService") as any

      const orders = await orderService.listOrders(
        {},
        { take: 200, order: { created_at: "DESC" } }
      )

      const medusaOrder = orders.find(
        (o: any) => String(o.metadata?.pancake_order_id) === pancakeOrderId
      )

      if (medusaOrder) {
        await orderService.updateOrders([{
          id: medusaOrder.id,
          metadata: {
            ...medusaOrder.metadata,
            pancake_status: pancakeStatus,
            pancake_status_name: label,
            pancake_status_updated_at: new Date().toISOString(),
            ...(body?.partner?.extend_code ? { vtp_tracking: body.partner.extend_code } : {}),
          }
        }])
        console.log(`[Pancake Webhook] Updated Medusa order #${medusaOrder.display_id} → ${label}`)
      } else {
        console.log(`[Pancake Webhook] No Medusa order linked to pancake_order_id=${pancakeOrderId}`)
      }
    } catch (medusaErr: any) {
      console.error("[Pancake Webhook] Medusa update error:", medusaErr.message)
    }

    return res.json({ success: true })

  } catch (err: any) {
    console.error("[Pancake Webhook] Error:", err.message)
    return res.json({ success: true }) // Always 200 to prevent Pancake retry
  }
}
