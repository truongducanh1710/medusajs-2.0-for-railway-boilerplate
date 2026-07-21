import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"
import { computeAvgCost, resolveDisplayId, toVNDate } from "../../../gia-von/avg-cost/route"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}
async function sql(query: string, params?: any[]): Promise<any[]> {
  const client = await getPool().connect()
  try {
    const result = await client.query(query, params ?? [])
    return result.rows
  } finally {
    client.release()
  }
}

const FULLFILL_PER_ORDER = 5000

/**
 * GET /admin/pancake-sync/report/lng-by-day?from=...&to=...
 *
 * LNG TẠM TÍNH theo TỪNG NGÀY (độc lập) để xem xu hướng trong tháng — ngày nào đang
 * tốt lên / tệ đi. KHÔNG tích lũy: mỗi ngày là 1 con số riêng của đơn TẠO ngày đó.
 *
 * Dùng công thức tạm tính B (giống marketer-lng) cho từng ngày: DT tạm tính = DT đã nhận
 * + DT đơn treo × tỷ lệ nhận kỳ vọng — nhờ vậy ngày gần nhất (đơn chưa kịp giao xong)
 * KHÔNG bị âm giả như khi chỉ tính đơn đã nhận.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { from: fromRaw, to: toRaw, market } = req.query as Record<string, string>
    if (!fromRaw || !toRaw) return res.status(400).json({ error: "Thiếu from/to" })
    if (market && market !== "VN") {
      return res.json({ not_supported: true, market, rows: [] })
    }

    const from = toVNDate(fromRaw)
    const to = toVNDate(toRaw)

    const avgCost = await computeAvgCost(getPool())

    const revenueExpr = `COALESCE(NULLIF((raw->>'total_price_after_sub_discount')::numeric, 0), cod_amount::numeric, total::numeric)::bigint`
    const tagNhap = `tags @> '[{"name":"Đơn nháp"}]'::jsonb`
    const tagTrung = `tags @> '[{"name":"Đơn trùng"}]'::jsonb`
    const nhapTrungCond = `status IN (6, -1) AND (${tagNhap} OR ${tagTrung})`
    const excludeCond = `(
      status = 7
      OR (${tagNhap} AND status IN (0, 11))
      OR (${nhapTrungCond})
    )`

    // Group theo NGÀY tạo đơn (giờ VN). Mỗi ngày: doanh thu/đơn/status + delivered_items để tính COGS.
    const rows = await sql(`
      SELECT
        to_char(date_trunc('day', pancake_created_at AT TIME ZONE 'Asia/Ho_Chi_Minh'), 'YYYY-MM-DD') AS date,
        COUNT(*) FILTER (WHERE status NOT IN (-2) AND NOT ${excludeCond})::int AS total_orders,
        SUM(CASE WHEN status = 3 AND NOT ${excludeCond} THEN ${revenueExpr} ELSE 0 END)::bigint AS revenue_delivered,
        SUM(CASE WHEN status IN (0,1,2,8,9,11) AND NOT ${excludeCond} THEN ${revenueExpr} ELSE 0 END)::bigint AS revenue_treo,
        SUM(CASE WHEN status NOT IN (-2) AND NOT ${excludeCond} THEN COALESCE((raw->>'partner_fee')::numeric, 0) ELSE 0 END)::bigint AS ship_cost,
        COUNT(*) FILTER (WHERE status = 3 AND NOT ${excludeCond})::int AS n_nhan,
        COUNT(*) FILTER (WHERE status = 5 AND NOT ${excludeCond})::int AS da_hoan,
        COUNT(*) FILTER (WHERE status = 4 AND NOT ${excludeCond})::int AS dang_hoan,
        COUNT(*) FILTER (WHERE status IN (6, -1) AND NOT (${nhapTrungCond}))::int AS da_huy,
        jsonb_agg(raw->'items') FILTER (WHERE status = 3 AND NOT ${excludeCond} AND raw->'items' IS NOT NULL) AS delivered_items
      FROM pancake_order
      WHERE deleted_at IS NULL
        AND source IN ('manual', 'facebook', 'medusa', 'unknown', 'webcake')
        AND pancake_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND pancake_created_at < (($2::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
      GROUP BY date
      ORDER BY date
    `, [from, to])

    // Ads theo ngày.
    const adsRows = await sql(`
      SELECT to_char(date_trunc('day', date), 'YYYY-MM-DD') AS date, SUM(spend)::bigint AS spend
      FROM mkt_ads_cost
      WHERE deleted_at IS NULL AND date >= $1::date AND date <= $2::date
      GROUP BY date_trunc('day', date)
    `, [from, to])
    const adsByDay: Record<string, number> = {}
    for (const a of adsRows) adsByDay[a.date] = Number(a.spend)

    function cogsFromItems(deliveredItems: any): number {
      let cogs = 0
      if (!Array.isArray(deliveredItems)) return 0
      for (const itemsArr of deliveredItems) {
        if (!Array.isArray(itemsArr)) continue
        for (const it of itemsArr) {
          const qty = Number(it?.quantity ?? 0)
          if (!qty) continue
          const vi = it?.variation_info ?? {}
          const code = resolveDisplayId(vi.display_id)
          const name = (vi.name ?? it?.name ?? "").toUpperCase()
          let unit: number | undefined
          if (code && avgCost.costs[code] != null) unit = avgCost.costs[code]
          else if (name && avgCost.byName[name] != null) unit = avgCost.byName[name]
          if (unit != null) cogs += unit * qty
        }
      }
      return cogs
    }

    // Tỷ lệ nhận TRUNG BÌNH toàn kỳ — dùng làm fallback cho ngày có mẫu quá nhỏ.
    // Các ngày MỚI TẠO (18-20/07 khi xem trong tháng) chưa đơn nào kịp giao xong nên
    // n_nhan=0, nhưng đã có vài đơn hủy → tỷ lệ nhận riêng ngày = 0% → dự phóng doanh thu
    // treo = 0 → LNG âm giả (chỉ còn ads). Sai: đơn treo đó đa số SẼ nhận trong vài ngày
    // tới. Nguyên tắc thống kê: mẫu nhỏ thì mượn tỷ lệ tổng thể.
    let sumNhan = 0, sumChot = 0, sumRevDeliv = 0, sumCogs = 0, sumShip = 0
    for (const r of rows) {
      sumNhan += r.n_nhan
      sumChot += r.n_nhan + r.da_hoan + r.dang_hoan + r.da_huy
      sumRevDeliv += Number(r.revenue_delivered)
      sumCogs += cogsFromItems(r.delivered_items)
      sumShip += Number(r.ship_cost)
    }
    const tyLeNhanKy = sumChot > 0 ? sumNhan / sumChot : 0.8
    // Tỷ lệ giá vốn/ship trung bình kỳ — dùng cho ngày chưa có doanh thu nhận (revDeliv=0)
    // để dự phóng vẫn trừ giá vốn/ship, tránh LNG cao giả.
    const pctVonKy = sumRevDeliv > 0 ? sumCogs / sumRevDeliv : 0
    const pctShipKy = sumRevDeliv > 0 ? sumShip / sumRevDeliv : 0
    // Ngày được coi là "đủ chín" để tin tỷ lệ nhận RIÊNG khi phần lớn đơn đã ngã ngũ.
    // Chỉ dựa số đơn đã chốt tuyệt đối (ngưỡng cứng 10) là chưa đủ: ngày 19-20/07 có 12 đơn
    // đã chốt nhưng 84 đơn còn treo → mẫu 12 đơn KHÔNG đại diện, tỷ lệ riêng dao động mạnh
    // (58%~83%) làm LNG âm/dương thất thường. Đúng hơn: đơn đã chốt phải chiếm ≥ RIPE_RATIO
    // tổng đơn ngày; chưa đạt → mượn tỷ lệ nhận trung bình kỳ (ổn định).
    const RIPE_RATIO = 0.6

    const result = rows.map((r: any) => {
      const revDeliv = Number(r.revenue_delivered)
      const revTreo = Number(r.revenue_treo)
      const ship = Number(r.ship_cost)
      const nOrders = Number(r.total_orders)
      const ads = adsByDay[r.date] ?? 0
      const cogs = Math.round(cogsFromItems(r.delivered_items))

      // Công thức B: tỷ lệ nhận kỳ vọng. Ngày đã chín (≥60% đơn đã ngã ngũ) → dùng tỷ lệ
      // riêng; chưa chín → mượn tỷ lệ trung bình kỳ (tránh dao động do mẫu nhỏ).
      const nDaChot = r.n_nhan + r.da_hoan + r.dang_hoan + r.da_huy
      const isRipe = nOrders > 0 && nDaChot / nOrders >= RIPE_RATIO
      const tyLeNhan = isRipe ? r.n_nhan / nDaChot : tyLeNhanKy
      const revTamTinh = Math.round(revDeliv + revTreo * tyLeNhan)
      // Ngày đã có doanh thu nhận → dùng tỷ lệ vốn/ship riêng; chưa có → mượn tỷ lệ kỳ.
      const pctVon = revDeliv > 0 ? cogs / revDeliv : pctVonKy
      const pctShip = revDeliv > 0 ? ship / revDeliv : pctShipKy
      const cogsTamTinh = Math.round(revTamTinh * pctVon)
      const shipTamTinh = Math.round(revTamTinh * pctShip)
      const fullfill = FULLFILL_PER_ORDER * nOrders
      const lngTamTinh = revTamTinh - (cogsTamTinh + shipTamTinh + ads + fullfill)

      // LNG THỰC: chỉ đơn ĐÃ NHẬN thật (không dự phóng). Các ngày mới tạo (chưa kịp giao
      // xong) sẽ âm/thấp vì doanh thu chưa về đủ — đó là con số thực tại thời điểm xem,
      // để cạnh tạm tính cho thấy khoảng cách "đã thu vs dự phóng".
      const lngThuc = revDeliv - (cogs + ship + ads + fullfill)

      return {
        date: r.date,
        total_orders: nOrders,
        revenue_tam_tinh: revTamTinh,
        revenue_delivered: revDeliv,
        cogs_tam_tinh: cogsTamTinh,
        ship_tam_tinh: shipTamTinh,
        cogs, ship_cost: ship,
        ads_cost: ads,
        fullfill,
        lng_tam_tinh: lngTamTinh,
        lng_thuc: lngThuc,
        // Tỷ suất (để so chất lượng, không bị quy mô đánh lừa):
        lng_pct: revTamTinh > 0 ? Math.round(lngTamTinh / revTamTinh * 1000) / 10 : 0,
        lng_thuc_pct: revDeliv > 0 ? Math.round(lngThuc / revDeliv * 1000) / 10 : 0,
        roas: ads > 0 ? Math.round(revTamTinh / ads * 100) / 100 : null,
      }
    })

    return res.json({ rows: result, from, to })
  } catch (err: any) {
    console.error("[report/lng-by-day]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
