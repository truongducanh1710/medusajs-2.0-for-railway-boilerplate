import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createHmac, timingSafeEqual } from "crypto"
import { Modules } from "@medusajs/framework/utils"
import { PANCAKE_WEBHOOK_SECRET } from "../../../../lib/constants"
import { mapPancakeOrder, statusLabel } from "../../../../modules/pancake-sync/service"
import { extractNotesForOrder, extractTags } from "../../../../modules/pancake-sync/extractors"

/**
 * Verify HMAC signature from Pancake webhook.
 */
function verifyHmac(rawBody: string, signature: string | null): boolean {
  if (!PANCAKE_WEBHOOK_SECRET) return true
  if (!signature) return false
  try {
    const hmac = createHmac("sha256", PANCAKE_WEBHOOK_SECRET)
    hmac.update(rawBody)
    const computed = hmac.digest("hex")
    const bufA = Buffer.from(computed)
    const bufB = Buffer.from(signature)
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
  } catch {
    return false
  }
}

async function updateMedusaOrderMetadata(
  scope: any,
  pancakeOrderId: string,
  pancakeStatus: number,
  label: string,
  body: any
) {
  try {
    const orderService = scope.resolve(Modules.ORDER) as any
    const orders = await orderService.listOrders({}, { take: 200, order: { created_at: "DESC" } })
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
    }
  } catch (err: any) {
    console.error("[Pancake Webhook] Medusa update error:", err.message)
  }
}

/**
 * POST /store/pancake/webhook
 * Strategy: return 200 immediately, then async fetch full order from Pancake API and upsert.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = req.body as any

  try {
    // HMAC verification
    if (PANCAKE_WEBHOOK_SECRET) {
      const rawBody = req.rawBody ?? JSON.stringify(body)
      const signature = (req.headers["x-pancake-signature"] as string) ?? null
      if (!verifyHmac(rawBody, signature)) {
        console.warn("[Pancake Webhook] Invalid HMAC signature — rejecting")
        return res.status(401).json({ error: "Invalid signature" })
      }
    }

    // Skip non-order events
    const isWarehouseEvent = body?.type === "variations_warehouses" || body?.order_id
    const isProductEvent = Array.isArray(body?.variations) && !body?.system_id
    if (isWarehouseEvent || isProductEvent) {
      return res.json({ success: true })
    }

    const pancakeOrderId = String(body?.system_id || body?.id || "")
    const pancakeStatus: number = Number(body?.status ?? -999)
    const isOrderEvent = /^\d+$/.test(pancakeOrderId) && pancakeStatus !== -999

    if (!isOrderEvent) {
      return res.json({ success: true })
    }

    const label = statusLabel(pancakeStatus)
    console.log(`[Pancake Webhook] ✅ Đơn #${pancakeOrderId} → ${label} (${pancakeStatus})`)

    // Return 200 immediately so Pancake doesn't retry
    res.json({ success: true })

    // Fire-and-forget: fetch full order and upsert
    ;(async () => {
      const receivedAt = new Date()
      const asyncStart = Date.now()
      let apiFetchSuccess: boolean | undefined
      let upsertSuccess = false
      let fallbackUsed = false
      let errorMessage: string | undefined

      try {
        const syncService = req.scope.resolve("pancakeSyncModule") as any

        // Fetch full order from Pancake API
        const rawOrder = await syncService.fetchOrderById(pancakeOrderId)
        apiFetchSuccess = rawOrder !== null

        const existing = await syncService.listPancakeOrders({ id: pancakeOrderId }, { take: 1 })
        const prev = existing[0] ?? null
        const prevHistory: any[] = Array.isArray(prev?.status_history) ? prev.status_history : []
        const prevStatus = prev?.status ?? null
        const statusChanged = prevStatus !== pancakeStatus

        if (rawOrder) {
          // Full upsert with complete data from API
          const mapped = mapPancakeOrder(rawOrder)
          const { notes, lastNoteAt, callCount } = extractNotesForOrder(rawOrder)
          const tags = extractTags(rawOrder)
          const newHistory = statusChanged
            ? [...prevHistory, { status: pancakeStatus, status_name: label, changed_at: new Date().toISOString(), source: "webhook" }]
            : prevHistory

          if (prev) {
            await syncService.updatePancakeOrders({
              id: pancakeOrderId,
              ...mapped,
              notes,
              last_note_at: lastNoteAt,
              call_count: callCount,
              tags,
              status_history: newHistory as any,
              data_quality: "complete",
              raw_version: "v1",
              synced_at: new Date(),
            } as any)
          } else {
            await syncService.createPancakeOrders([{
              ...mapped,
              notes,
              last_note_at: lastNoteAt,
              call_count: callCount,
              tags,
              status_history: newHistory as any,
              data_quality: "complete",
              raw_version: "v1",
            }] as any)
          }
          upsertSuccess = true
          console.log(`[Pancake Webhook] ✓ Synced order #${pancakeOrderId} → ${label} (full)`)
        } else {
          // Fallback: upsert minimal from webhook body
          fallbackUsed = true
          if (prev) {
            await syncService.updatePancakeOrders({
              id: pancakeOrderId,
              status: pancakeStatus,
              status_name: label,
              status_history: (statusChanged
                ? [...prevHistory, { status: pancakeStatus, status_name: label, changed_at: new Date().toISOString(), source: "webhook" }]
                : prevHistory) as any,
              ...(body?.partner?.extend_code ? { tracking_code: body.partner.extend_code } : {}),
              ...(body?.assigning_care?.name ? { care_name: body.assigning_care.name } : {}),
              synced_at: new Date(),
            } as any)
          } else {
            await syncService.createPancakeOrders([{
              id: pancakeOrderId,
              status: pancakeStatus,
              status_name: label,
              status_history: [{ status: pancakeStatus, status_name: label, changed_at: new Date().toISOString(), source: "webhook" }] as any,
              customer_name: body?.bill_full_name ?? "",
              customer_phone: body?.bill_phone_number ?? "",
              total: body?.total_price ?? 0,
              tracking_code: body?.partner?.extend_code ?? "",
              care_name: body?.assigning_care?.name ?? "",
              pancake_created_at: body?.inserted_at ? new Date(body.inserted_at) : new Date(),
              data_quality: "partial",
              synced_at: new Date(),
            }] as any)
          }
          upsertSuccess = true
          console.warn(`[Pancake Webhook] ⚠ Synced order #${pancakeOrderId} fallback (API fetch failed)`)
        }

        // Trigger AI analyze khi bưu tá báo thất bại
        const newPartnerStatus = rawOrder?.partner?.partner_status ?? body?.partner?.partner_status ?? ""
        const isFailedDelivery = newPartnerStatus === "undeliverable" ||
          (rawOrder?.partner?.extend_update?.[0]?.status ?? body?.partner?.extend_update?.[0]?.status ?? "").includes("chuyển hoàn")
        if (isFailedDelivery) {
          try {
            const cskhService = req.scope.resolve("cskhAnalysisModule") as any
            cskhService.analyzeOrders([pancakeOrderId]).catch((e: any) => {
              console.warn("[Pancake Webhook] CSKH analyze error:", e.message)
            })
          } catch {
            // module chưa sẵn sàng
          }
        }

        // Update Medusa order metadata
        await updateMedusaOrderMetadata(req.scope, pancakeOrderId, pancakeStatus, label, body)

      } catch (asyncErr: any) {
        errorMessage = asyncErr.message
        console.error("[Pancake Webhook] Async sync error:", asyncErr.message)
      } finally {
        try {
          const syncService = req.scope.resolve("pancakeSyncModule") as any
          await syncService.logWebhookEvent({
            pancake_order_id: pancakeOrderId,
            pancake_status: pancakeStatus,
            status_name: label,
            event_type: "order",
            api_fetch_success: apiFetchSuccess,
            upsert_success: upsertSuccess,
            fallback_used: fallbackUsed,
            error_message: errorMessage,
            duration_ms: Date.now() - asyncStart,
            received_at: receivedAt,
          })
        } catch { /* log fail không ảnh hưởng */ }
      }
    })()

  } catch (err: any) {
    console.error("[Pancake Webhook] Error:", err.message)
    res.json({ success: true })
  }
}
