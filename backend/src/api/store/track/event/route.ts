import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FUNNEL_EVENTS, ensureFunnelTable, funnelPool } from "../../../../lib/funnel"

const s = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : null)

// Crawlers, link previewers and scripted clients never count as visitors
const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|facebookcatalog|headless|lighthouse|pagespeed|python|curl|wget|axios|node-fetch|go-http/i

// Per-IP cap (events per minute). Generous because mobile carriers put many real users behind one IP.
const LIMIT = 300
const WINDOW_MS = 60_000
const hits = new Map<string, { n: number; reset: number }>()

function allow(ip: string, count: number): boolean {
  const now = Date.now()
  if (hits.size > 5000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k)
  const h = hits.get(ip)
  if (!h || h.reset <= now) { hits.set(ip, { n: count, reset: now + WINDOW_MS }); return true }
  h.n += count
  return h.n <= LIMIT
}

/** Landing funnel event beacon (fire-and-forget from the product page). Accepts one event or { events: [...] }. */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const ua = String(req.headers["user-agent"] ?? "")
    const ip = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.ip || "?"
    const body = (req.body ?? {}) as any
    const list: any[] = Array.isArray(body.events) ? body.events.slice(0, 20) : [body]
    const rows = list.filter((e) => FUNNEL_EVENTS.has(e?.event) && typeof e?.session_id === "string" && typeof e?.handle === "string")
    if (rows.length && ua && !BOT_UA.test(ua) && allow(ip, rows.length)) {
      await ensureFunnelTable()
      const vals: any[] = []
      const ph = rows.map((e, i) => {
        vals.push(s(e.session_id, 64), s(e.visitor_id, 64), s(e.handle, 120), e.event, s(e.value == null ? null : String(e.value), 120),
          s(e.utm_source, 200), s(e.utm_content, 200), s(e.campaign_id, 40), s(e.device, 20))
        const b = i * 9
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9})`
      })
      await funnelPool().query(
        `INSERT INTO web_funnel_event (session_id, visitor_id, handle, event, value, utm_source, utm_content, campaign_id, device) VALUES ${ph.join(",")}`,
        vals)
    }
  } catch (err: any) {
    console.error("[track/event]", err.message)
  }
  return res.status(204).send()
}
