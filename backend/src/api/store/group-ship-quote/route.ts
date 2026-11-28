import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { GROUPS, groupShippingQuote } from "../../../lib/bundle-group"
import { isNewCustomerPhone } from "../../../lib/bundle-shipping"

// Per-IP cap: the answer hints whether a phone has ordered before, so keep lookups slow to farm
const LIMIT = 30
const WINDOW_MS = 10 * 60_000
const hits = new Map<string, { n: number; reset: number }>()
function allow(ip: string): boolean {
  const now = Date.now()
  if (hits.size > 5000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k)
  const h = hits.get(ip)
  if (!h || h.reset <= now) { hits.set(ip, { n: 1, reset: now + WINDOW_MS }); return true }
  return ++h.n <= LIMIT
}

/**
 * POST /store/group-ship-quote { group, boxes, province, phone } → { fee, reason }
 * Display-only preview for the checkout once an address is typed; the cart's fee is still decided
 * by lib/bundle-shipping when the order is placed.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.body ?? {}) as any
  const group = GROUPS[String(body.group ?? "")]
  const boxes = Number(body.boxes)
  if (!group || !Number.isSafeInteger(boxes) || boxes < 1 || boxes > group.maxBoxes) return res.status(400).json({ message: "Yêu cầu không hợp lệ." })
  const ip = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.ip || "?"
  const phone = typeof body.phone === "string" ? body.phone.slice(0, 20) : ""
  const checkHistory = !!group.shipping?.newCustomerFree && !!phone && allow(ip)
  const isNewCustomer = checkHistory ? await isNewCustomerPhone(req.scope, phone).catch(() => false) : false
  const quote = groupShippingQuote(group, boxes, { province: typeof body.province === "string" ? body.province.slice(0, 80) : "", isNewCustomer })
  return res.json(quote)
}
