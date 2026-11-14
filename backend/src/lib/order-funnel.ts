// ============================================================================
// order_funnel — mỗi đơn Pancake 1 dòng (bảng dẫn xuất, Migration20261114010000).
// Dựng lại hoàn toàn từ DB (pancake_order, ity_cdr_call, ad_video_map, mkt_ads_cost(_ad),
// mkt_product, mkt_handover) — KHÔNG gọi API ngoài, KHÔNG ghi vào pancake_order.
//
// Định nghĩa doanh số/MKT import từ lib/mkt-today.ts (một nguồn): in_ds_mkt = MKT_ORDER_FILTER_SQL
// AND status NOT IN (-2, 7) — đúng bộ lọc của mktTotalsForDate / report mkt; revenue = ORDER_REVENUE_SQL.
//
// Ai gọi:
//   jobs/order-funnel-sync.ts     */15 phút: đơn tạo 3 ngày gần nhất + đơn vừa đổi (30 phút)
//   jobs/order-funnel-nightly.ts  02:40 VN : quét lại 60 ngày + lấp đơn còn thiếu từ BACKFILL_FROM
//   POST /admin/order-funnel/backfill       : chạy tay backfill từ 1 ngày (mặc định BACKFILL_FROM)
// ============================================================================

import { getPool } from "./db"
import { MKT_OF_ORDER_SQL, MKT_ORDER_FILTER_SQL, ORDER_REVENUE_SQL } from "./mkt-today"

/** Ngày đầu có chi phí cấp ad (mkt_ads_cost_ad) — mốc backfill. Giờ VN. */
export const BACKFILL_FROM = "2026-07-20"
const BATCH = 2000

// Chuỗi thời gian trong jsonb: có múi giờ (webhook: ISO …Z) → timestamptz; không múi giờ (Pancake
// raw: "2026-11-13T08:12:34") → giờ UTC (cùng cách service.ts đọc inserted_at). Rác → NULL, không làm hỏng cả lô.
const TS = (e: string) => `(CASE WHEN (${e}) ~ '^\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}'
  THEN (CASE WHEN (${e}) ~ '(Z|[+-]\\d{2}(:?\\d{2})?)$' THEN (${e})::timestamptz ELSE ((${e})::timestamp AT TIME ZONE 'UTC') END) END)`

const arr = (e: string) => `(CASE WHEN jsonb_typeof(${e}) = 'array' THEN ${e} ELSE '[]'::jsonb END)`

/** Lần đầu đơn vào một trong các status: sớm nhất giữa lịch sử webhook (changed_at) và lịch sử Pancake trong raw (updated_at). */
const firstAt = (statuses: number[]) => {
  const list = statuses.map((s) => `'${s}'`).join(",")
  return `LEAST(
    (SELECT min(${TS("h->>'changed_at'")}) FROM jsonb_array_elements(${arr("status_history")}) h WHERE h->>'status' IN (${list})),
    (SELECT min(${TS("h->>'updated_at'")}) FROM jsonb_array_elements(${arr("raw->'status_history'")}) h WHERE h->>'status' IN (${list}))
  )`
}

/**
 * Câu upsert cho 1 lô order id ($1 text[]). CTE `base` đọc RIÊNG pancake_order vì các biểu thức của
 * mkt-today.ts dùng tên cột trần (raw, status, tags, deleted_at…).
 */
const UPSERT_SQL = `
WITH base AS (
  SELECT
    id, pancake_created_at, source, status, status_name, customer_phone, fb_campaign_id,
    (pancake_created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS created_date,
    ${MKT_OF_ORDER_SQL} AS mkt_raw,
    NULLIF(trim(raw->>'p_utm_source'), '')   AS utm_source,
    NULLIF(trim(raw->>'p_utm_campaign'), '') AS utm_campaign,
    NULLIF(trim(raw->>'p_utm_term'), '')     AS utm_term,
    NULLIF(trim(raw->>'p_utm_content'), '')  AS utm_content,
    COALESCE((${MKT_ORDER_FILTER_SQL}) AND status NOT IN (-2, 7), false) AS in_ds_mkt,
    ${ORDER_REVENUE_SQL} AS revenue,
    COALESCE(tags @> '[{"name":"Đơn nháp"}]'::jsonb, false) AS is_draft,
    ${firstAt([1])} AS confirmed_at,
    ${firstAt([3])} AS delivered_at,
    ${firstAt([6])} AS canceled_at,
    ${firstAt([4, 5])} AS returned_at,
    CASE WHEN jsonb_typeof(notes) = 'array' THEN jsonb_array_length(notes) ELSE 0 END AS notes_n,
    GREATEST(updated_at, synced_at) AS source_updated_at
  FROM pancake_order
  WHERE id = ANY($1::text[])
),
-- tên camp (utm_source / utm_campaign dạng tên) → campaign_id
camp_by_name AS (
  SELECT DISTINCT ON (campaign_name) campaign_name, campaign_id
  FROM mkt_ads_cost
  WHERE deleted_at IS NULL
    AND campaign_name IN (SELECT utm_source FROM base UNION SELECT utm_campaign FROM base)
  ORDER BY campaign_name, date DESC
),
a1 AS (
  SELECT b.*,
    COALESCE(
      b.fb_campaign_id,
      CASE WHEN b.utm_campaign ~ '^\\d{10,}$' THEN b.utm_campaign END,
      c1.campaign_id, c2.campaign_id
    ) AS campaign_id_utm,
    CASE WHEN b.utm_term ~ '^\\d{10,}$' THEN b.utm_term END AS adset_utm,
    -- utm_content: "VD133 - <post_id>" (camp ANHTD) | ad_id | tên camp
    upper(substring(b.utm_content from '^\\s*([Vv][Dd][0-9]+)')) AS vd_utm,
    substring(b.utm_content from '-\\s*([0-9]{6,}(_[0-9]{6,})?)\\s*$') AS post_utm,
    CASE WHEN b.utm_content ~ '^\\d{10,}$' THEN b.utm_content END AS num_utm
  FROM base b
  LEFT JOIN camp_by_name c1 ON c1.campaign_name = b.utm_source
  LEFT JOIN camp_by_name c2 ON c2.campaign_name = b.utm_campaign
),
-- utm_content là ad_id có trong bảng chi phí cấp ad
ad_direct AS (
  SELECT DISTINCT ON (ad_id) ad_id, vd_code, campaign_id, adset_id
  FROM mkt_ads_cost_ad
  WHERE deleted_at IS NULL AND ad_id IN (SELECT num_utm FROM a1 WHERE num_utm IS NOT NULL)
  ORDER BY ad_id, date DESC
),
a2 AS (
  SELECT a1.*,
    COALESCE(a1.campaign_id_utm, ad.campaign_id) AS campaign_id,
    COALESCE(a1.adset_utm, ad.adset_id) AS adset_id_x,
    ad.ad_id AS ad_direct_id, ad.vd_code AS ad_direct_vd
  FROM a1 LEFT JOIN ad_direct ad ON ad.ad_id = a1.num_utm
),
-- post trong utm → ad của post đó TRONG camp của đơn (ad_video_map: post_id dạng {page}_{post})
post_ad AS (
  SELECT DISTINCT ON (c.campaign_id, m.post_id) c.campaign_id, m.post_id, split_part(m.post_id, '_', 2) AS post_tail,
         m.ad_id, c.adset_id, c.vd_code
  FROM ad_video_map m
  JOIN mkt_ads_cost_ad c ON c.ad_id = m.ad_id AND c.deleted_at IS NULL
  WHERE m.post_id IS NOT NULL
    AND c.campaign_id IN (SELECT campaign_id FROM a2 WHERE post_utm IS NOT NULL)
  ORDER BY c.campaign_id, m.post_id, c.date DESC
),
camp_name AS (
  SELECT DISTINCT ON (campaign_id) campaign_id, campaign_name
  FROM mkt_ads_cost
  WHERE deleted_at IS NULL AND campaign_id IN (SELECT campaign_id FROM a2 WHERE campaign_id IS NOT NULL)
  ORDER BY campaign_id, date DESC
),
prod AS (
  SELECT DISTINCT ON (upper(replace(code, '_', ''))) upper(replace(code, '_', '')) AS code_key, code
  FROM mkt_product WHERE active = true
  ORDER BY upper(replace(code, '_', '')), code
),
fin AS (
  SELECT a2.*,
    COALESCE(cn.campaign_name,
      CASE WHEN a2.utm_source IS NOT NULL AND lower(a2.utm_source) <> 'fb' AND a2.utm_source !~ '^\\d+$' THEN a2.utm_source END
    ) AS campaign_name_x,
    COALESCE(a2.ad_direct_id, pa.ad_id) AS ad_id,
    COALESCE(a2.adset_id_x, pa.adset_id) AS adset_id,
    COALESCE(pa.post_id, a2.post_utm) AS post_id,
    COALESCE(a2.vd_utm, a2.ad_direct_vd, pa.vd_code) AS vd_code,
    COALESCE((
      SELECT h.to_code FROM mkt_handover h
      WHERE h.deleted_at IS NULL AND h.from_code = a2.mkt_raw
        AND a2.created_date >= h.effective_from::date
        AND (h.effective_to IS NULL OR a2.created_date <= h.effective_to::date)
      ORDER BY h.effective_from DESC LIMIT 1), a2.mkt_raw) AS mkt,
    cdr.first_call_at, COALESCE(cdr.calls_n, 0) AS calls_n, COALESCE(cdr.calls_answered_n, 0) AS calls_answered_n,
    CASE WHEN a2.status IN (3, 4, 5, 6) THEN a2.status END AS final_status,
    CASE a2.status WHEN 3 THEN a2.delivered_at WHEN 6 THEN a2.canceled_at WHEN 4 THEN a2.returned_at WHEN 5 THEN a2.returned_at END AS final_at
  FROM a2
  LEFT JOIN camp_name cn ON cn.campaign_id = a2.campaign_id
  LEFT JOIN LATERAL (
    SELECT p.ad_id, p.adset_id, p.vd_code, p.post_id FROM post_ad p
    WHERE a2.post_utm IS NOT NULL AND p.campaign_id = a2.campaign_id
      AND (p.post_id = a2.post_utm OR p.post_tail = a2.post_utm)
    LIMIT 1
  ) pa ON true
  -- Cuộc gọi tới SĐT của đơn trong 30 ngày kể từ lúc tạo đơn (first_call_at chỉ tính cuộc gọi đi)
  LEFT JOIN LATERAL (
    SELECT min(k.calldate) FILTER (WHERE k.direction <> 'incoming') AS first_call_at,
           count(*)::int AS calls_n,
           count(*) FILTER (WHERE k.billsec > 0)::int AS calls_answered_n
    FROM ity_cdr_call k
    WHERE a2.customer_phone <> '' AND a2.pancake_created_at IS NOT NULL
      AND k.customer_phone = a2.customer_phone AND k.deleted_at IS NULL
      AND k.calldate >= a2.pancake_created_at
      AND k.calldate < a2.pancake_created_at + interval '30 days'
  ) cdr ON true
)
INSERT INTO order_funnel (
  order_id, order_created_at, created_date, source, mkt,
  attr_source, utm_source, utm_campaign, utm_term, utm_content,
  campaign_id, campaign_name, adset_id, ad_id, post_id, vd_code, product_code,
  in_ds_mkt, revenue, is_draft,
  confirmed_at, first_call_at, calls_n, calls_answered_n, notes_n,
  status, status_name, delivered_at, canceled_at, returned_at, final_status, final_seen_at,
  source_updated_at, synced_at
)
SELECT
  f.id, f.pancake_created_at, f.created_date, f.source, f.mkt,
  CASE WHEN f.campaign_id IS NOT NULL OR f.campaign_name_x IS NOT NULL THEN 'utm' ELSE 'none' END,
  f.utm_source, f.utm_campaign, f.utm_term, f.utm_content,
  f.campaign_id, f.campaign_name_x, f.adset_id, f.ad_id, f.post_id, f.vd_code,
  (SELECT p.code FROM prod p WHERE p.code_key = upper(split_part(f.campaign_name_x, '_', 1))),
  f.in_ds_mkt, f.revenue, f.is_draft,
  f.confirmed_at, f.first_call_at, f.calls_n, f.calls_answered_n, f.notes_n,
  f.status, f.status_name, f.delivered_at, f.canceled_at, f.returned_at, f.final_status,
  CASE WHEN f.final_status IS NOT NULL THEN COALESCE(f.final_at, now()) END,
  f.source_updated_at, now()
FROM fin f
ON CONFLICT (order_id) DO UPDATE SET
  order_created_at = EXCLUDED.order_created_at, created_date = EXCLUDED.created_date,
  source = EXCLUDED.source, mkt = EXCLUDED.mkt,
  attr_source = EXCLUDED.attr_source, utm_source = EXCLUDED.utm_source, utm_campaign = EXCLUDED.utm_campaign,
  utm_term = EXCLUDED.utm_term, utm_content = EXCLUDED.utm_content,
  campaign_id = EXCLUDED.campaign_id, campaign_name = EXCLUDED.campaign_name, adset_id = EXCLUDED.adset_id,
  ad_id = EXCLUDED.ad_id, post_id = EXCLUDED.post_id, vd_code = EXCLUDED.vd_code, product_code = EXCLUDED.product_code,
  in_ds_mkt = EXCLUDED.in_ds_mkt, revenue = EXCLUDED.revenue, is_draft = EXCLUDED.is_draft,
  confirmed_at = EXCLUDED.confirmed_at, first_call_at = EXCLUDED.first_call_at,
  calls_n = EXCLUDED.calls_n, calls_answered_n = EXCLUDED.calls_answered_n, notes_n = EXCLUDED.notes_n,
  status = EXCLUDED.status, status_name = EXCLUDED.status_name,
  delivered_at = EXCLUDED.delivered_at, canceled_at = EXCLUDED.canceled_at, returned_at = EXCLUDED.returned_at,
  final_status = EXCLUDED.final_status,
  -- giữ mốc "thấy lần đầu" khi status chốt không đổi; đổi status chốt → mốc mới
  final_seen_at = CASE WHEN order_funnel.final_status IS NOT DISTINCT FROM EXCLUDED.final_status
                       THEN COALESCE(order_funnel.final_seen_at, EXCLUDED.final_seen_at)
                       ELSE EXCLUDED.final_seen_at END,
  source_updated_at = EXCLUDED.source_updated_at, synced_at = now()
`

// 1 lượt chạy/lúc trong process (job 15 phút, job đêm, backfill tay dùng chung).
let running: string | null = null
type RunInfo = { kind: string; startedAt: string; finishedAt?: string; orders: number; batches: number; error?: string }
let lastRun: RunInfo | null = null

/** Trạng thái cho GET /admin/order-funnel/backfill. */
export function orderFunnelStatus(): { running: string | null; lastRun: RunInfo | null } {
  return { running, lastRun }
}

async function upsertIds(ids: string[], log: (m: string) => void): Promise<{ orders: number; batches: number }> {
  const pool = getPool()
  let orders = 0, batches = 0
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH)
    await pool.query(UPSERT_SQL, [chunk])
    orders += chunk.length
    batches++
    if (ids.length > BATCH) log(`${orders}/${ids.length}`)
  }
  return { orders, batches }
}

/** Mốc 00:00 VN của ngày "YYYY-MM-DD" dưới dạng ISO UTC (không parse chuỗi trần bằng new Date()). */
function vnDayStartIso(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Ngày không hợp lệ: ${date}`)
  return `${date}T00:00:00+07:00`
}

async function runExclusive(kind: string, pickIds: () => Promise<string[]>, log: (m: string) => void) {
  if (running) {
    log(`bỏ qua — đang chạy "${running}"`)
    return { skipped: true, orders: 0, batches: 0 }
  }
  running = kind
  const startedAt = new Date().toISOString()
  lastRun = { kind, startedAt, orders: 0, batches: 0 }
  try {
    const ids = await pickIds()
    const r = await upsertIds(ids, log)
    lastRun = { kind, startedAt, finishedAt: new Date().toISOString(), ...r }
    return { skipped: false, ...r }
  } catch (e: any) {
    lastRun = { kind, startedAt, finishedAt: new Date().toISOString(), orders: 0, batches: 0, error: e?.message }
    throw e
  } finally {
    running = null
  }
}

const idsOf = (rows: any[]) => rows.map((r) => String(r.id))

/** Job 15 phút: đơn tạo trong 3 ngày + đơn có thay đổi trong 30 phút gần nhất (từ BACKFILL_FROM). */
export function syncRecentOrderFunnel(log: (m: string) => void = console.log) {
  return runExclusive("recent", async () => idsOf((await getPool().query(
    `SELECT id FROM pancake_order
      WHERE pancake_created_at >= $1::timestamptz
        AND (pancake_created_at >= now() - interval '3 days'
             OR GREATEST(updated_at, synced_at) >= now() - interval '30 minutes')`,
    [vnDayStartIso(BACKFILL_FROM)]
  )).rows), log)
}

/** Job đêm: quét lại đơn tạo trong 60 ngày (giao/hoàn đổi muộn) + lấp tối đa `fillLimit` đơn còn thiếu từ BACKFILL_FROM. */
export function syncNightlyOrderFunnel(log: (m: string) => void = console.log, fillLimit = 15000) {
  return runExclusive("nightly", async () => {
    const pool = getPool()
    const recent = idsOf((await pool.query(
      `SELECT id FROM pancake_order
        WHERE pancake_created_at >= GREATEST(now() - interval '60 days', $1::timestamptz)
        ORDER BY pancake_created_at`,
      [vnDayStartIso(BACKFILL_FROM)]
    )).rows)
    const missing = idsOf((await pool.query(
      `SELECT po.id FROM pancake_order po
        WHERE po.pancake_created_at >= $1::timestamptz
          AND po.pancake_created_at < now() - interval '60 days'
          AND NOT EXISTS (SELECT 1 FROM order_funnel f WHERE f.order_id = po.id)
        ORDER BY po.pancake_created_at DESC
        LIMIT $2`,
      [vnDayStartIso(BACKFILL_FROM), fillLimit]
    )).rows)
    log(`60 ngày: ${recent.length} đơn, lấp thiếu: ${missing.length} đơn`)
    return [...recent, ...missing]
  }, log)
}

/** Backfill tay: mọi đơn tạo từ `from` (YYYY-MM-DD giờ VN), lô 2.000. */
export function backfillOrderFunnel(from: string = BACKFILL_FROM, log: (m: string) => void = console.log) {
  return runExclusive(`backfill:${from}`, async () => idsOf((await getPool().query(
    `SELECT id FROM pancake_order WHERE pancake_created_at >= $1::timestamptz ORDER BY pancake_created_at`,
    [vnDayStartIso(from)]
  )).rows), log)
}
