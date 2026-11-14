import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FUNNEL_EXTRAS, FUNNEL_MIN_SAMPLE, FUNNEL_STEPS, FUNNEL_V2_SINCE, ensureFunnelTable, funnelPool, funnelReport } from "../../../lib/funnel"

const vnToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** GET /admin/funnel?handle=&from=&to=&group=none|ad|campaign — landing funnel by distinct session */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const q = req.query as Record<string, string>
  const from = DATE.test(q.from ?? "") ? q.from : vnToday()
  const to = DATE.test(q.to ?? "") ? q.to : from
  const group = (["ad", "campaign"].includes(q.group) ? q.group : "none") as "none" | "ad" | "campaign"
  await ensureFunnelTable()
  const { rows: handles } = await funnelPool().query(
    `SELECT handle, count(DISTINCT session_id)::int AS n FROM web_funnel_event WHERE created_at > now() - interval '30 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 30`)
  const handle = q.handle || handles[0]?.handle || ""
  const rows = handle ? await funnelReport(handle, from, to, group) : []
  res.json({ handle, from, to, group, steps: FUNNEL_STEPS, extras: FUNNEL_EXTRAS, min_sample: FUNNEL_MIN_SAMPLE, v2_since: FUNNEL_V2_SINCE, handles, rows })
}
