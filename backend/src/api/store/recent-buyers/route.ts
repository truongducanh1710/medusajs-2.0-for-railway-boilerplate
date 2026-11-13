import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

// Real recent buyers of a product for the "vừa đặt" notification.
// Only masked first-name initial + province + variant are returned (no PII).
// Only orders that were paid / placed — never fabricated.
let cache: Record<string, { at: number; data: any[] }> = {}

function maskName(full?: string | null): string {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return "Một khách"
  const last = parts[parts.length - 1]
  return `Khách ${last.charAt(0).toUpperCase()}.`
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const productId = String((req.query as any).product_id || "")
  if (!productId) return res.json({ buyers: [] })
  const hit = cache[productId]
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return res.json({ buyers: hit.data })

  const query = req.scope.resolve("query")
  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000)
  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id", "created_at", "status", "metadata",
      "shipping_address.first_name", "shipping_address.last_name", "shipping_address.province", "shipping_address.city",
      "items.product_id", "items.variant_title",
    ],
    filters: { created_at: { $gte: since } } as any,
    pagination: { take: 300, order: { created_at: "DESC" } },
  })

  const buyers = (orders || [])
    .filter((o: any) => o.status !== "canceled" && !o.metadata?.is_test)
    .map((o: any) => {
      const item = (o.items || []).find((i: any) => i?.product_id === productId)
      if (!item) return null
      const a = o.shipping_address || {}
      const name = [a.last_name, a.first_name].filter(Boolean).join(" ") || a.first_name
      const place = a.province || ""
      return {
        name: maskName(name),
        place: /sản phẩm số/i.test(place) ? "" : place,
        variant: item.variant_title || "",
        at: o.created_at,
      }
    })
    .filter(Boolean)
    .slice(0, 20)

  cache[productId] = { at: Date.now(), data: buyers }
  res.json({ buyers })
}
