import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createHmac, timingSafeEqual } from "crypto"
import { Modules } from "@medusajs/framework/utils"
import { PANCAKE_WEBHOOK_SECRET } from "../../../../lib/constants"
import { mapPancakeOrder, statusLabel } from "../../../../modules/pancake-sync/service"
import { extractNotesForOrder, extractTags } from "../../../../modules/pancake-sync/extractors"
import { sendPurchaseEvent } from "../../../../lib/fb-capi"

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
    // Medusa không filter được nested JSONB metadata qua listOrders, nên vẫn .find() in-memory.
    // Nâng take lên 1000 (từ 200): COD giao 3-7 ngày, top-200 không đủ khi volume cao → miss order.
    const orders = await orderService.listOrders({}, { take: 1000, order: { created_at: "DESC" } })
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

        // Bắn FB CAPI Purchase khi đơn giao thành công (status=3)
        if (pancakeStatus === 3) {
          try {
            const order = rawOrder ?? body
            const phone = order?.bill_phone_number ?? order?.customer?.phone ?? ""
            const customerName = order?.bill_full_name ?? order?.customer?.name ?? ""
            const city = order?.bill_province ?? order?.shipping_address?.province ?? ""
            const total = Number(order?.total_price ?? order?.total ?? 0)

            // Lấy fbclid/fbp + pixel riêng sản phẩm từ Medusa order metadata
            const orderService = req.scope.resolve(Modules.ORDER) as any
            // take:1000: COD giao 3-7 ngày, top-200 không đủ khi volume cao.
            // Không thêm relations vào listOrders — Medusa v2 không support dot-notation nested
            // relations (items.variant.product) và sẽ throw "targetMeta" error. Load shallow trước,
            // rồi retrieveOrder riêng để lấy deep relations cho pixel SP.
            const medusaOrders = await orderService.listOrders(
              {},
              { take: 1000, order: { created_at: "DESC" } }
            )
            const medusaOrderShallow = medusaOrders.find(
              (o: any) => String(o.metadata?.pancake_order_id) === pancakeOrderId
            )
            // Load deep relations chỉ khi tìm thấy order (1 query thay vì load tất cả 1000 đơn kèm relations)
            const medusaOrder = medusaOrderShallow
              ? await orderService.retrieveOrder(medusaOrderShallow.id, {
                  relations: ["items", "items.variant", "items.variant.product"],
                }).catch(() => medusaOrderShallow)
              : undefined
            const meta = medusaOrder?.metadata ?? {}

            // Đơn đã thanh toán SePay → Purchase đã bắn lúc thanh toán, không bắn lại.
            // FB chỉ dedup trong 48h, giao hàng thường sau vài ngày nên phải tự guard.
            if (meta.payment_status === "paid") {
              console.log(`[Pancake Webhook] Skip Purchase CAPI — order ${medusaOrder?.id} đã bắn lúc thanh toán SePay`)
            } else {
              // Lấy pixel + token từ store metadata (PX_CHUNG)
              let storePixelId: string | undefined
              let storeCapiToken: string | undefined
              try {
                const storeService = req.scope.resolve(Modules.STORE) as any
                const stores = await storeService.listStores({}, { select: ["id", "metadata"] })
                const storeMeta = stores?.[0]?.metadata ?? {}
                storePixelId = storeMeta.fb_pixel_id
                storeCapiToken = storeMeta.fb_capi_token
              } catch {}

              // Lấy pixel + token riêng từ sản phẩm đầu tiên trong đơn
              const firstItem = medusaOrder?.items?.[0]
              const productPixelId = firstItem?.variant?.product?.metadata?.fb_pixel_id as string | undefined
              const productCapiToken = firstItem?.variant?.product?.metadata?.fb_capi_token as string | undefined

              // content_ids cho catalog matching
              const contentIds = medusaOrder?.items?.map((i: any) => i.variant_id || i.id).filter(Boolean)

              await sendPurchaseEvent({
                // event_id thống nhất theo Medusa order id (dedup với mọi nguồn khác);
                // đơn POS không có trên web thì mới dùng pancake id
                orderId: medusaOrder?.id ?? pancakeOrderId,
                phone,
                customerName,
                city,
                fbclid: meta.fbclid,
                fbp: meta.fbp,
                fbc: meta.fbc,
                client_user_agent: meta.client_user_agent,
                value: total,
                storePixelId,
                storeCapiToken,
                productPixelId,
                productCapiToken,
                contentIds,
              })
            }
          } catch (capiErr: any) {
            console.warn("[Pancake Webhook] CAPI error:", capiErr.message)
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
