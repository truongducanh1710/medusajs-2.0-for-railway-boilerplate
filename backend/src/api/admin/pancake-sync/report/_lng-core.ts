import { Pool } from "pg"
import { computeAvgCost, resolveDisplayId } from "../../gia-von/avg-cost/route"

/**
 * Lõi tính LNG dùng chung cho báo cáo "theo NV MKT" và "theo nền tảng".
 *
 * Tách ra để 2 bảng KHÔNG THỂ lệch nhau: cùng bộ lọc đơn, cùng công thức doanh thu,
 * COGS, ship, fullfill và tạm tính — chỉ khác chiều gom nhóm (mkt_name vs platform).
 * Sửa công thức ở đây là cả 2 bảng đổi theo.
 */

export const FULLFILL_PER_ORDER = 5000

let _pool: Pool | null = null
export function getLngPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}
export async function lngSql(query: string, params?: any[]): Promise<any[]> {
  const client = await getLngPool().connect()
  try {
    const result = await client.query(query, params ?? [])
    return result.rows
  } finally {
    client.release()
  }
}

// ── Biểu thức SQL dùng chung ────────────────────────────────────────────────
const tagNhap = `tags @> '[{"name":"Đơn nháp"}]'::jsonb`
const tagTrung = `tags @> '[{"name":"Đơn trùng"}]'::jsonb`
/** Đơn HỦY có tag nháp/trùng (cột Đơn nháp/trùng + dự kiến hoàn hủy). */
export const NHAP_TRUNG_COND = `status IN (6, -1) AND (${tagNhap} OR ${tagTrung})`
/**
 * Đơn LOẠI khỏi Doanh số (và mọi metric phái sinh), theo định nghĩa sheet:
 *   - Đã xóa (status 7)
 *   - Đơn nháp CHƯA XÁC NHẬN: tag nháp ở status 0 (Chờ xử lý) hoặc 11 (Chờ hàng)
 *   - Đơn HỦY có tag nháp/trùng (status 6/-1)
 * Đơn nháp đã xác nhận/đang giao/đã nhận (status 1,2,3,4,5,8,9) VẪN tính doanh số.
 */
export const EXCLUDE_COND = `(
  status = 7
  OR (${tagNhap} AND status IN (0, 11))
  OR (${NHAP_TRUNG_COND})
)`
/**
 * Doanh thu = tiền thực khách phải trả SAU giảm giá (gồm cả COD lẫn trả trước),
 * không phải total (giá trước giảm). total_price_after_sub_discount nhất quán cho
 * cả đơn COD lẫn đơn trả trước; fallback cod_amount → total cho đơn cũ thiếu field.
 */
export const REVENUE_EXPR = `COALESCE(NULLIF((raw->>'total_price_after_sub_discount')::numeric, 0), cod_amount::numeric, total::numeric)::bigint`

/**
 * Phân loại nền tảng ads cho 1 đơn — giữ đồng bộ với report/mkt-platform.
 * Chỉ đơn có marker Google mới tính Google; còn lại (kể cả không xác định) về Facebook.
 */
export const PLATFORM_EXPR = `
  CASE
    WHEN ad_platform = 'google' THEN 'google'
    WHEN ad_platform IS DISTINCT FROM 'facebook' AND (
         raw::text ILIKE '%"ads_source":"Google"%'
      OR raw::text ILIKE '%gclid=%'
      OR raw::text ILIKE '%gbraid=%'
      OR raw::text ILIKE '%wbraid=%'
      OR raw::text ILIKE '%gad_source=%'
      OR raw::text ILIKE '%gad_campaignid=%'
      OR COALESCE(raw->>'p_utm_source', '') ILIKE '%google%'
    ) THEN 'google'
    ELSE 'facebook'
  END
`

/** Marketer attribution — chuẩn hoá tên Pancake → mã MKT. */
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
const MKT_RAW = `
  COALESCE(
    ${MKT_EXPR},
    CASE
      WHEN raw->>'p_utm_campaign' LIKE '%\\_%\\_%'
        THEN split_part(raw->>'p_utm_campaign', '_', 2)
      WHEN raw->>'p_utm_source' LIKE '%\\_%\\_%'
        THEN split_part(raw->>'p_utm_source', '_', 2)
      ELSE 'KHÁC'
    END
  )
`
export const MKT_KEY_EXPR = `CASE WHEN ${MKT_RAW} = 'TRUONGAN' THEN 'ANHTD' ELSE ${MKT_RAW} END`

/**
 * Khoá gom nhóm mịn nhất: "<mã MKT>||<nền tảng>".
 * Cả 2 báo cáo đều tính metric ở grain này rồi mới roll-up (xem sumMetrics),
 * nên tổng của bảng theo NV MKT và bảng theo nền tảng luôn bằng nhau.
 */
export const MKT_PLATFORM_KEY_EXPR = `((${MKT_KEY_EXPR}) || '||' || (${PLATFORM_EXPR}))`
export function splitMktPlatformKey(key: string): { mkt: string; platform: string } {
  const i = key.lastIndexOf("||")
  return i < 0
    ? { mkt: key, platform: "facebook" }
    : { mkt: key.slice(0, i), platform: key.slice(i + 2) }
}

export interface LngGroup {
  key: string
  total_orders: number
  revenue_total: number
  revenue_delivered: number
  ship_cost: number
  ads_cost: number
  ads_cost_fb: number
  ads_cost_gg: number
  cogs: number
  item_qty: number
  mapped_qty: number
  da_hoan: number
  dang_hoan: number
  da_huy: number
  da_gui_hang: number
  treo_khac: number
  revenue_treo: number
  n_nhan: number
}

/**
 * Gom đơn + chi phí ads theo (ngày, "<mã MKT>||<nền tảng>") — grain mịn nhất.
 * Cả 2 báo cáo đều gọi hàm này rồi tự roll-up lên chiều hiển thị của mình.
 */
export async function fetchLngRows(from: string, to: string): Promise<any[]> {
  const keyExpr = MKT_PLATFORM_KEY_EXPR
  const orderAgg = `
    SELECT
      to_char(date_trunc('day', pancake_created_at AT TIME ZONE 'Asia/Ho_Chi_Minh'), 'YYYY-MM-DD') AS date,
      ${keyExpr} AS key,
      COUNT(*) FILTER (WHERE status NOT IN (-2) AND NOT ${EXCLUDE_COND})::int AS total_orders,
      SUM(CASE WHEN status NOT IN (-2) AND NOT ${EXCLUDE_COND} THEN ${REVENUE_EXPR} ELSE 0 END)::bigint AS revenue_total,
      SUM(CASE WHEN status = 3 AND NOT ${EXCLUDE_COND} THEN ${REVENUE_EXPR} ELSE 0 END)::bigint AS revenue_delivered,
      COUNT(*) FILTER (WHERE status = 3 AND NOT ${EXCLUDE_COND})::int AS n_nhan,
      SUM(CASE WHEN status NOT IN (-2) AND NOT ${EXCLUDE_COND} THEN COALESCE((raw->>'partner_fee')::numeric, 0) ELSE 0 END)::bigint AS ship_cost,
      COUNT(*) FILTER (WHERE status = 5 AND NOT ${EXCLUDE_COND})::int AS da_hoan,
      COUNT(*) FILTER (WHERE status = 4 AND NOT ${EXCLUDE_COND})::int AS dang_hoan,
      COUNT(*) FILTER (WHERE status IN (6, -1) AND NOT (${NHAP_TRUNG_COND}))::int AS da_huy,
      COUNT(*) FILTER (WHERE ${NHAP_TRUNG_COND})::int AS don_nhap_trung,
      COUNT(*) FILTER (WHERE status = 2 AND NOT ${EXCLUDE_COND})::int AS da_gui_hang,
      COUNT(*) FILTER (WHERE status IN (0, 1, 11) AND NOT ${EXCLUDE_COND})::int AS treo_khac,
      SUM(CASE WHEN status IN (0, 1, 2, 11) AND NOT ${EXCLUDE_COND} THEN ${REVENUE_EXPR} ELSE 0 END)::bigint AS revenue_treo,
      COUNT(*) FILTER (WHERE status = 7)::int AS da_xoa,
      jsonb_agg(raw->'items') FILTER (WHERE status = 3 AND NOT ${EXCLUDE_COND} AND raw->'items' IS NOT NULL) AS delivered_items
    FROM pancake_order
    WHERE deleted_at IS NULL
      AND source IN ('manual', 'facebook', 'medusa', 'unknown', 'webcake')
      AND pancake_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
      AND pancake_created_at < (($2::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
    GROUP BY date, key
  `

  // Chi phí ads gán về đúng sub-key nền tảng: mkt_ads_cost (FB) → "<MKT>||facebook",
  // mkt_ads_cost_gg (Google) → "<MKT>||google". Giữ tách 2 cột để hiển thị/đối chiếu;
  // ads_cost = tổng cả hai.
  const adsAgg = `
    SELECT date, key, SUM(fb)::bigint AS fb, SUM(gg)::bigint AS gg
    FROM (
      SELECT to_char(date_trunc('day', date), 'YYYY-MM-DD') AS date,
             mkt_name || '||facebook' AS key, spend AS fb, 0 AS gg
      FROM mkt_ads_cost WHERE deleted_at IS NULL AND date >= $1::date AND date <= $2::date
      UNION ALL
      SELECT to_char(date_trunc('day', date), 'YYYY-MM-DD') AS date,
             mkt_name || '||google' AS key, 0 AS fb, cost AS gg
      FROM mkt_ads_cost_gg WHERE deleted_at IS NULL AND date >= $1::date AND date <= $2::date
    ) u GROUP BY date, key
  `

  return lngSql(`
    SELECT
      COALESCE(o.date, c.date)         AS date,
      COALESCE(o.key, c.key)           AS key,
      COALESCE(o.total_orders, 0)      AS total_orders,
      COALESCE(o.revenue_total, 0)     AS revenue_total,
      COALESCE(o.revenue_delivered, 0) AS revenue_delivered,
      COALESCE(o.n_nhan, 0)            AS n_nhan,
      COALESCE(o.ship_cost, 0)         AS ship_cost,
      o.delivered_items                AS delivered_items,
      COALESCE(o.da_hoan, 0)           AS da_hoan,
      COALESCE(o.dang_hoan, 0)         AS dang_hoan,
      COALESCE(o.da_huy, 0)            AS da_huy,
      COALESCE(o.don_nhap_trung, 0)    AS don_nhap_trung,
      COALESCE(o.da_gui_hang, 0)       AS da_gui_hang,
      COALESCE(o.treo_khac, 0)         AS treo_khac,
      COALESCE(o.revenue_treo, 0)      AS revenue_treo,
      COALESCE(o.da_xoa, 0)            AS da_xoa,
      COALESCE(c.fb, 0)::bigint        AS ads_cost_fb,
      COALESCE(c.gg, 0)::bigint        AS ads_cost_gg
    FROM (${orderAgg}) o
    FULL OUTER JOIN (${adsAgg}) c ON c.date = o.date AND c.key = o.key
  `, [from, to])
}

/** Handover rules — đổi mã MKT theo ngày hiệu lực. Không áp dụng cho chiều nền tảng. */
export async function loadHandoverRules(): Promise<
  { from_code: string; to_code: string; effective_from: string; effective_to: string | null }[]
> {
  try {
    return await lngSql(
      `SELECT from_code, to_code, effective_from::text, effective_to::text FROM mkt_handover WHERE deleted_at IS NULL`
    )
  } catch {
    return [] // bảng chưa tồn tại
  }
}

/**
 * Rule chỉ đổi phần MÃ MKT của khoá, giữ nguyên sub-key nền tảng — bàn giao là đổi
 * người phụ trách, không đổi nguồn traffic của đơn.
 */
export function applyHandover(
  rows: any[],
  rules: { from_code: string; to_code: string; effective_from: string; effective_to: string | null }[]
): void {
  for (const row of rows) {
    const { mkt, platform } = splitMktPlatformKey(row.key)
    for (const rule of rules) {
      if (
        mkt === rule.from_code &&
        row.date >= rule.effective_from &&
        (!rule.effective_to || row.date <= rule.effective_to)
      ) {
        row.key = `${rule.to_code}||${platform}`
        break
      }
    }
  }
}

/** Gộp các dòng (ngày × khoá) về từng khoá, cộng COGS từ delivered_items. */
export async function mergeLngRows(rows: any[]): Promise<Record<string, LngGroup>> {
  const avgCost = await computeAvgCost(getLngPool())

  function cogsFromItems(deliveredItems: any): { cogs: number; itemQty: number; mappedQty: number } {
    let cogs = 0, itemQty = 0, mappedQty = 0
    if (!Array.isArray(deliveredItems)) return { cogs, itemQty, mappedQty }
    // deliveredItems = mảng các "items array" (mỗi đơn 1 phần tử là mảng items)
    for (const itemsArr of deliveredItems) {
      if (!Array.isArray(itemsArr)) continue
      for (const it of itemsArr) {
        const qty = Number(it?.quantity ?? 0)
        if (!qty) continue
        itemQty += qty
        const vi = it?.variation_info ?? {}
        const code = resolveDisplayId(vi.display_id)
        const name = (vi.name ?? it?.name ?? "").toUpperCase()
        let unit: number | undefined
        if (code && avgCost.costs[code] != null) unit = avgCost.costs[code]
        else if (name && avgCost.byName[name] != null) unit = avgCost.byName[name]
        if (unit != null) {
          cogs += unit * qty
          mappedQty += qty
        }
      }
    }
    return { cogs, itemQty, mappedQty }
  }

  const merged: Record<string, LngGroup> = {}
  for (const row of rows) {
    const k = row.key
    if (!merged[k]) {
      merged[k] = {
        key: k, total_orders: 0, revenue_total: 0, revenue_delivered: 0,
        ship_cost: 0, ads_cost: 0, ads_cost_fb: 0, ads_cost_gg: 0,
        cogs: 0, item_qty: 0, mapped_qty: 0,
        da_hoan: 0, dang_hoan: 0, da_huy: 0, da_gui_hang: 0,
        treo_khac: 0, revenue_treo: 0, n_nhan: 0,
      }
    }
    const g = merged[k]
    g.total_orders += Number(row.total_orders)
    g.revenue_total += Number(row.revenue_total)
    g.revenue_delivered += Number(row.revenue_delivered)
    g.ship_cost += Number(row.ship_cost)
    g.ads_cost_fb += Number(row.ads_cost_fb)
    g.ads_cost_gg += Number(row.ads_cost_gg)
    g.ads_cost += Number(row.ads_cost_fb) + Number(row.ads_cost_gg)
    g.da_hoan += Number(row.da_hoan)
    g.dang_hoan += Number(row.dang_hoan)
    g.da_huy += Number(row.da_huy)
    g.da_gui_hang += Number(row.da_gui_hang)
    g.treo_khac += Number(row.treo_khac)
    g.revenue_treo += Number(row.revenue_treo)
    g.n_nhan += Number(row.n_nhan)
    const { cogs, itemQty, mappedQty } = cogsFromItems(row.delivered_items)
    g.cogs += cogs
    g.item_qty += itemQty
    g.mapped_qty += mappedQty
  }
  return merged
}

export const pctOf = (part: number, whole: number) =>
  whole > 0 ? Math.round(part / whole * 10000) / 100 : null

/**
 * Cộng dồn nhiều nhóm con thành 1 nhóm — dùng để roll-up từ grain mịn
 * (ngày × MKT × nền tảng) lên chiều hiển thị.
 *
 * VÌ SAO CẦN: tạm tính KHÔNG cộng dồn được. revenueTamTinh dùng tyLeNhan =
 * n_nhan/n_da_chot của riêng từng nhóm, cogsTamTinh/shipTamTinh dùng pctVon/pctShip
 * của riêng từng nhóm. Gom 2 nhóm rồi tính 1 lần ≠ tính riêng rồi cộng (lệch vài %).
 * Nên cả 2 bảng đều tính metric ở CÙNG grain mịn nhất, rồi chỉ cộng các SỐ TIỀN
 * (vốn additive) lên chiều mình cần → tổng luôn khớp nhau.
 */
export function sumMetrics(parts: ReturnType<typeof computeLngMetrics>[]) {
  const ADDITIVE = [
    "total_orders", "revenue_total", "revenue_delivered", "cogs", "ship_cost",
    "ads_cost", "ads_cost_fb", "ads_cost_gg", "fullfill", "lng", "lng_thuc",
    "revenue_tam_tinh", "cogs_tam_tinh", "ship_tam_tinh", "fullfill_tam_tinh",
    "lng_tam_tinh", "item_qty", "mapped_qty",
  ] as const

  const out: any = {}
  for (const k of ADDITIVE) out[k] = parts.reduce((s, p: any) => s + Number(p[k] ?? 0), 0)

  // % và tỷ lệ phải tính LẠI từ số tiền đã cộng, không được cộng trực tiếp.
  out.cogs_pct = pctOf(out.cogs, out.revenue_delivered)
  out.ship_pct = pctOf(out.ship_cost, out.revenue_delivered)
  out.ads_pct = pctOf(out.ads_cost, out.revenue_total)
  out.fullfill_pct = pctOf(out.fullfill, out.revenue_delivered)
  out.lng_pct = pctOf(out.lng, out.revenue_delivered)
  out.cogs_tt_pct = pctOf(out.cogs_tam_tinh, out.revenue_tam_tinh)
  out.ship_tt_pct = pctOf(out.ship_tam_tinh, out.revenue_tam_tinh)
  out.ads_tt_pct = pctOf(out.ads_cost, out.revenue_total)
  out.fullfill_tt_pct = pctOf(out.fullfill_tam_tinh, out.revenue_tam_tinh)
  out.lng_tt_pct = pctOf(out.lng_tam_tinh, out.revenue_tam_tinh)
  out.du_kien_hoan_huy = out.revenue_total > 0
    ? Math.round((1 - out.revenue_tam_tinh / out.revenue_total) * 10000) / 100
    : 0
  return out
}

/**
 * Tính khối THỰC + TẠM TÍNH cho 1 nhóm.
 *
 * Tạm tính dùng công thức B — tách đơn đã chốt khỏi đơn còn treo:
 *   Doanh thu tạm tính = DT đã nhận (CHẮC CHẮN) + DT đơn CÒN TREO × tỷ lệ nhận kỳ vọng.
 * Đơn đã nhận/hủy/hoàn lấy số thực; chỉ ước lượng phần đơn chưa chốt (status 0/1/2/11).
 * Khi hết tháng, đơn treo → 0 nên tạm tính tự hội tụ về thực.
 */
export function computeLngMetrics(g: LngGroup) {
  const fullfill = FULLFILL_PER_ORDER * g.total_orders
  const cogs = Math.round(g.cogs)
  const lng = g.revenue_delivered - (cogs + g.ship_cost + g.ads_cost + fullfill)

  const nGiao = g.total_orders
  const nDaChot = g.n_nhan + g.da_hoan + g.dang_hoan + g.da_huy
  // Tỷ lệ nhận kỳ vọng = tỷ lệ nhận thành công trong SỐ ĐƠN ĐÃ NGÃ NGŨ (nhận/hủy/hoàn);
  // fallback 0.8 khi kỳ chưa có đơn nào chốt (đầu kỳ) để tránh dự phóng bằng 0.
  const tyLeNhan = nDaChot > 0 ? g.n_nhan / nDaChot : 0.8
  // dkhh chỉ để hiển thị cột "Dự kiến hoàn hủy", không còn dùng cho DT.
  const dkhh = nGiao > 0
    ? (g.da_hoan + g.dang_hoan + g.da_huy + g.da_gui_hang / 3) / nGiao
    : 0
  const pctVon = g.revenue_delivered > 0 ? cogs / g.revenue_delivered : 0
  const pctShip = g.revenue_delivered > 0 ? g.ship_cost / g.revenue_delivered : 0
  const revenueTamTinh = Math.round(g.revenue_delivered + g.revenue_treo * tyLeNhan)
  const cogsTamTinh = Math.round(revenueTamTinh * pctVon)
  const shipTamTinh = Math.round(revenueTamTinh * pctShip)
  const fullfillTamTinh = FULLFILL_PER_ORDER * nGiao
  const lngTamTinh = revenueTamTinh - (cogsTamTinh + shipTamTinh + g.ads_cost + fullfillTamTinh)

  return {
    total_orders: g.total_orders,
    revenue_total: g.revenue_total,
    revenue_delivered: g.revenue_delivered,
    cogs,
    ship_cost: g.ship_cost,
    ads_cost: g.ads_cost,
    ads_cost_fb: g.ads_cost_fb,
    ads_cost_gg: g.ads_cost_gg,
    fullfill,
    lng,
    lng_thuc: lng,
    cogs_pct: pctOf(cogs, g.revenue_delivered),
    ship_pct: pctOf(g.ship_cost, g.revenue_delivered),
    ads_pct: pctOf(g.ads_cost, g.revenue_total),
    fullfill_pct: pctOf(fullfill, g.revenue_delivered),
    lng_pct: pctOf(lng, g.revenue_delivered),
    du_kien_hoan_huy: Math.round(dkhh * 10000) / 100,
    revenue_tam_tinh: revenueTamTinh,
    cogs_tam_tinh: cogsTamTinh,
    ship_tam_tinh: shipTamTinh,
    fullfill_tam_tinh: fullfillTamTinh,
    lng_tam_tinh: lngTamTinh,
    cogs_tt_pct: pctOf(cogsTamTinh, revenueTamTinh),
    ship_tt_pct: pctOf(shipTamTinh, revenueTamTinh),
    ads_tt_pct: pctOf(g.ads_cost, g.revenue_total),
    fullfill_tt_pct: pctOf(fullfillTamTinh, revenueTamTinh),
    lng_tt_pct: pctOf(lngTamTinh, revenueTamTinh),
    item_qty: g.item_qty,
    mapped_qty: g.mapped_qty,
  }
}
