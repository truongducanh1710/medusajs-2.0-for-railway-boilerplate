// Tổng doanh số + chi phí ads THEO MKT — một nguồn duy nhất cho báo cáo /report/mkt và tự scale.
// Gán đơn cho MKT: marketer->name trên Pancake POS, fallback mã MKT trong UTM (giữ đồng bộ
// extractMkt() trong lib/mkt-code.ts). Doanh số = mọi đơn trừ huỷ/xoá, như cột "Doanh số MKT".

import { getPool } from "./db"

// Normalize tên marketer Pancake → MKT code (khớp với campaign name FB Ads)
// raw->'marketer'->>'name' trả về tên hiển thị có space/dấu (VD: "Nam DV", "Phạm Du")
const MKT_EXPR = `
  CASE UPPER(TRIM(COALESCE(NULLIF(TRIM(raw->'marketer'->>'name'), ''), '')))
    WHEN 'NAM DV'     THEN 'NAMDV'
    WHEN 'PHẠM DU'    THEN 'DUPD'
    WHEN 'NGUYỄN MAI' THEN 'NGUYEN MAI'
    WHEN 'TRUONGAN'   THEN 'ANHTD'
    WHEN ''           THEN NULL
    ELSE UPPER(TRIM(NULLIF(TRIM(raw->'marketer'->>'name'), '')))
  END
`

// Fallback UTM nếu marketer name null.
// Format camp: MÃSP_DD/MM_MKTCODE_... — token số 2 là NGÀY, không phải mã MKT.
// Phải quét từng token và chỉ nhận token khớp pattern mã MKT (3-8 chữ in hoa).
const MKT_CODE_PATTERN = `^[A-Z]{3,8}$`
const MKT_RAW = `
  COALESCE(
    ${MKT_EXPR},
    (
      SELECT UPPER(t.tok)
      FROM unnest(string_to_array(COALESCE(raw->>'p_utm_campaign', ''), '_')) WITH ORDINALITY AS t(tok, ord)
      WHERE t.ord > 1 AND UPPER(TRIM(t.tok)) ~ '${MKT_CODE_PATTERN}'
      ORDER BY t.ord
      LIMIT 1
    ),
    (
      SELECT UPPER(t.tok)
      FROM unnest(string_to_array(COALESCE(raw->>'p_utm_source', ''), '_')) WITH ORDINALITY AS t(tok, ord)
      WHERE t.ord > 1 AND UPPER(TRIM(t.tok)) ~ '${MKT_CODE_PATTERN}'
      ORDER BY t.ord
      LIMIT 1
    ),
    'KHÁC'
  )
`

/** Biểu thức SQL (trên bảng pancake_order) ra mã MKT của đơn. Alias camp-name code → tên Pancake. */
export const MKT_OF_ORDER_SQL = `
  CASE WHEN ${MKT_RAW} = 'TRUONGAN' THEN 'ANHTD' ELSE ${MKT_RAW} END
`

/** Điều kiện đơn tính vào doanh số MKT (cùng báo cáo /report/mkt). */
export const MKT_ORDER_FILTER_SQL = `
  deleted_at IS NULL
  AND source IN ('manual', 'facebook', 'medusa', 'unknown', 'webcake')
  AND NOT (tags @> '[{"name":"Đơn nháp"}]'::jsonb AND status IN (0, 11, 6, 7, -1))
  AND NOT (tags @> '[{"name": "Đơn trùng"}]'::jsonb)
`

type Handover = { from_code: string; to_code: string; effective_from: string; effective_to: string | null }

/** Áp quy tắc bàn giao MKT (mkt_handover) cho 1 ngày. */
function handoverMap(rules: Handover[], date: string, code: string): string {
  for (const r of rules) {
    if (code === r.from_code && date >= r.effective_from && (!r.effective_to || date <= r.effective_to)) return r.to_code
  }
  return code
}

export type MktTotal = { spend: number; revenue: number; orders: number; pct: number | null }

/** Doanh số + chi phí ads (FB + GG) theo MKT cho 1 ngày (YYYY-MM-DD, giờ VN). */
export async function mktTotalsForDate(date: string): Promise<Record<string, MktTotal>> {
  const pool = getPool()
  const handover: Handover[] = await pool
    .query(`SELECT from_code, to_code, effective_from::text, effective_to::text FROM mkt_handover WHERE deleted_at IS NULL`)
    .then((r) => r.rows)
    .catch(() => [])

  const { rows: rev } = await pool.query(
    `SELECT ${MKT_OF_ORDER_SQL} AS mkt,
            COUNT(*) FILTER (WHERE status NOT IN (-2, 7))::int AS orders,
            SUM(CASE WHEN status NOT IN (-2, 7) THEN GREATEST(cod_amount, total::bigint) ELSE 0 END)::bigint AS revenue
       FROM pancake_order
      WHERE ${MKT_ORDER_FILTER_SQL}
        AND pancake_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND pancake_created_at < (($1::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
      GROUP BY 1`,
    [date]
  )
  const { rows: cost } = await pool.query(
    `SELECT mkt_name AS mkt, SUM(spend)::bigint AS spend FROM mkt_ads_cost
      WHERE deleted_at IS NULL AND date = $1::date GROUP BY 1
     UNION ALL
     SELECT mkt_name AS mkt, SUM(cost)::bigint AS spend FROM mkt_ads_cost_gg
      WHERE deleted_at IS NULL AND date = $1::date GROUP BY 1`,
    [date]
  ).catch(async () => pool.query(
    `SELECT mkt_name AS mkt, SUM(spend)::bigint AS spend FROM mkt_ads_cost
      WHERE deleted_at IS NULL AND date = $1::date GROUP BY 1`,
    [date]
  ))

  const out: Record<string, MktTotal> = {}
  const get = (m: string) => (out[m] ||= { spend: 0, revenue: 0, orders: 0, pct: null })
  for (const r of rev) {
    const t = get(handoverMap(handover, date, String(r.mkt)))
    t.revenue += Number(r.revenue || 0)
    t.orders += Number(r.orders || 0)
  }
  for (const r of cost) {
    if (!r.mkt) continue
    get(handoverMap(handover, date, String(r.mkt))).spend += Number(r.spend || 0)
  }
  for (const t of Object.values(out)) t.pct = t.revenue > 0 ? Math.round((t.spend / t.revenue) * 1000) / 10 : null
  return out
}
