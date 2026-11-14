import { Pool } from "pg"

/**
 * Landing funnel events (one row per user action on a product page).
 * Steps are counted by distinct session, in the order of FUNNEL_STEPS.
 */
export const FUNNEL_STEPS = [
  { key: "view", label: "Vào trang" },
  { key: "scroll_50", label: "Cuộn 50%" },
  { key: "video_play", label: "Bấm xem video" },
  { key: "scroll_100", label: "Cuộn hết trang" },
  { key: "variant_select", label: "Chọn phiên bản" },
  { key: "checkout_open", label: "Mở form đặt" },
  { key: "checkout_submit", label: "Bấm thanh toán" },
  { key: "qr_shown", label: "Hiện QR" },
  { key: "paid", label: "Đã thanh toán" },
] as const

export const FUNNEL_EVENTS = new Set<string>([
  ...FUNNEL_STEPS.map((s) => s.key),
  "scroll_25", "scroll_75", "video_end", "time_30s", "time_90s", "leave",
])

let _pool: Pool | null = null
export function funnelPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 })
  return _pool
}

let _ready: Promise<void> | null = null
export function ensureFunnelTable(): Promise<void> {
  if (!_ready) {
    _ready = funnelPool().query(`
      CREATE TABLE IF NOT EXISTS web_funnel_event (
        id BIGSERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        session_id TEXT NOT NULL,
        visitor_id TEXT,
        handle TEXT NOT NULL,
        event TEXT NOT NULL,
        value TEXT,
        utm_source TEXT,
        utm_content TEXT,
        campaign_id TEXT,
        device TEXT
      );
      CREATE INDEX IF NOT EXISTS web_funnel_event_h_t ON web_funnel_event (handle, created_at);
    `).then(() => undefined).catch((e) => { _ready = null; throw e })
  }
  return _ready
}

/** VN calendar day → [start, end) as ISO timestamps */
export function vnDayRange(from: string, to: string): [string, string] {
  const start = new Date(`${from}T00:00:00+07:00`)
  const end = new Date(new Date(`${to}T00:00:00+07:00`).getTime() + 864e5)
  return [start.toISOString(), end.toISOString()]
}

export async function funnelReport(handle: string, from: string, to: string, groupBy: "none" | "ad" | "campaign" = "none") {
  await ensureFunnelTable()
  const [s, e] = vnDayRange(from, to)
  const grp = groupBy === "ad" ? "coalesce(nullif(split_part(utm_content,' - ',1),''),'(không rõ)')"
    : groupBy === "campaign" ? "coalesce(nullif(utm_source,''),'(không rõ)')" : "'Tất cả'"
  const { rows } = await funnelPool().query(
    `SELECT ${grp} AS g, event, count(DISTINCT session_id)::int AS n
       FROM web_funnel_event WHERE handle = $1 AND created_at >= $2 AND created_at < $3
      GROUP BY 1, 2`, [handle, s, e])
  // Avg seconds on page per session (from the 'leave' event, value = seconds)
  const { rows: t } = await funnelPool().query(
    `WITH x AS (
       SELECT session_id, max(utm_source) AS utm_source, max(utm_content) AS utm_content, max(value::numeric) AS v
         FROM web_funnel_event WHERE handle = $1 AND created_at >= $2 AND created_at < $3 AND event = 'leave' AND value ~ '^[0-9]{1,6}$'
        GROUP BY session_id)
     SELECT ${grp} AS g, round(avg(least(v, 1800)))::int AS avg_sec FROM x GROUP BY 1`, [handle, s, e])
  const groups: Record<string, Record<string, number>> = {}
  for (const r of rows) (groups[r.g] ??= {})[r.event] = r.n
  return Object.entries(groups)
    .map(([g, ev]) => ({ group: g, events: ev, avg_sec: t.find((x: any) => x.g === g)?.avg_sec ?? null }))
    .sort((a, b) => (b.events.view ?? 0) - (a.events.view ?? 0))
}
