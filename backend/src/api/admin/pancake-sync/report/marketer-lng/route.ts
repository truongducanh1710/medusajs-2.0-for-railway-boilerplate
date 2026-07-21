import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"
import { computeAvgCost, resolveDisplayId, toVNDate } from "../../../gia-von/avg-cost/route"
import { computeAccountingCost } from "../accounting-cost/route"

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
 * GET /admin/pancake-sync/report/marketer-lng?from=2026-06-01&to=2026-06-16
 *
 * Báo cáo Lợi nhuận gộp (LNG) tạm tính theo marketer.
 *   LNG = Doanh thu tạm tính − (Giá vốn + Vận chuyển + Ads + Fullfill)
 *   - Doanh thu tạm tính = doanh thu đơn giao thành công (status=3)
 *   - Giá vốn   = SUM(giá TB/sp từ bảng gia-von × quantity) cho đơn status=3
 *   - Vận chuyển = SUM(raw.partner_fee) cho đơn status=3
 *   - Ads       = SUM(mkt_ads_cost.spend)
 *   - Fullfill  = 5000 × tổng số đơn (trừ hủy/xóa)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const {
      from: fromRaw = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
      to: toRaw = new Date().toISOString().slice(0, 10),
      market,
    } = req.query as Record<string, string>

    // Chuẩn hoá from/to về NGÀY LỊCH VN trước khi query (xem toVNDate). Frontend gửi ISO
    // UTC đã trừ 7h; nếu ép `$1::date` thẳng thì lệch sớm 1 ngày → gộp nhầm đơn hôm trước.
    const from = toVNDate(fromRaw)
    const to = toVNDate(toRaw)

    // Báo cáo này chưa hỗ trợ market ngoài VN (COGS/fullfill/marketer mapping chỉ đúng cho VN)
    if (market && market !== "VN") {
      return res.json({ not_supported: true, market, rows: [], totals: {} })
    }

    // ── Marketer attribution (copy từ report/mkt) ──────────────────────────────
    const mktExpr = `
      CASE UPPER(TRIM(COALESCE(NULLIF(TRIM(raw->'marketer'->>'name'), ''), '')))
        WHEN 'NAM DV'     THEN 'NAMDV'
        WHEN 'PHẠM DU'    THEN 'DUPD'
        WHEN 'NGUYỄN MAI' THEN 'NGUYEN MAI'
        WHEN 'TRUONGAN'   THEN 'ANHTD'
        WHEN ''           THEN NULL
        ELSE UPPER(TRIM(NULLIF(TRIM(raw->'marketer'->>'name'), '')))
      END
    `
    const mktRaw = `
      COALESCE(
        ${mktExpr},
        CASE
          WHEN raw->>'p_utm_campaign' LIKE '%\\_%\\_%'
            THEN split_part(raw->>'p_utm_campaign', '_', 2)
          WHEN raw->>'p_utm_source' LIKE '%\\_%\\_%'
            THEN split_part(raw->>'p_utm_source', '_', 2)
          ELSE 'KHÁC'
        END
      )
    `
    const mktWithFallback = `CASE WHEN ${mktRaw} = 'TRUONGAN' THEN 'ANHTD' ELSE ${mktRaw} END`

    // Handover rules
    let handoverRules: { from_code: string; to_code: string; effective_from: string; effective_to: string | null }[] = []
    try {
      handoverRules = await sql(
        `SELECT from_code, to_code, effective_from::text, effective_to::text FROM mkt_handover WHERE deleted_at IS NULL`
      )
    } catch { /* bảng chưa tồn tại */ }

    // ── Bảng giá vốn TB từ gia-von (code → giá TB) ─────────────────────────────
    const avgCost = await computeAvgCost(getPool())

    // ── Query orders + ads, group theo (ngày, marketer) ─────────────────────────
    // Phải group theo ngày để áp handover rule per-day giống report/mkt — nếu gom
    // thẳng theo marketer thì không có chiều ngày để test rule, dẫn tới ads/doanh
    // số của tuần bàn giao bị tính nhầm cho người gốc thay vì người nhận.
    // Tag nháp/trùng (match chính xác name).
    const tagNhap = `tags @> '[{"name":"Đơn nháp"}]'::jsonb`
    const tagTrung = `tags @> '[{"name":"Đơn trùng"}]'::jsonb`
    // Đơn HỦY có tag nháp/trùng (cho cột Đơn nháp/trùng + dự kiến hoàn hủy).
    const nhapTrungCond = `status IN (6, -1) AND (${tagNhap} OR ${tagTrung})`
    // Đơn LOẠI khỏi Doanh số (và mọi metric phái sinh), theo định nghĩa sheet:
    //   - Đã xóa (status 7)
    //   - Đơn nháp CHƯA XÁC NHẬN: tag nháp ở status 0 (Chờ xử lý) hoặc 11 (Chờ hàng)
    //   - Đơn HỦY có tag nháp/trùng (status 6/-1)
    // Đơn nháp đã xác nhận/đang giao/đã nhận (status 1,2,3,4,5,8,9) VẪN tính doanh số.
    const excludeCond = `(
      status = 7
      OR (${tagNhap} AND status IN (0, 11))
      OR (${nhapTrungCond})
    )`
    // Doanh thu = tiền thực khách phải trả SAU giảm giá (gồm cả COD lẫn trả trước),
    // không phải total (giá trước giảm). total_price_after_sub_discount nhất quán cho
    // cả đơn COD lẫn đơn trả trước; fallback cod_amount → total cho đơn cũ thiếu field.
    const revenueExpr = `COALESCE(NULLIF((raw->>'total_price_after_sub_discount')::numeric, 0), cod_amount::numeric, total::numeric)::bigint`
    const rows = await sql(`
      SELECT
        COALESCE(o.date, c.date)          AS date,
        COALESCE(o.mkt_name, c.mkt_name)  AS mkt_name,
        COALESCE(o.total_orders, 0)       AS total_orders,
        COALESCE(o.revenue_total, 0)      AS revenue_total,
        COALESCE(o.revenue_delivered, 0)  AS revenue_delivered,
        COALESCE(o.n_nhan, 0)             AS n_nhan,
        COALESCE(o.ship_cost, 0)          AS ship_cost,
        o.delivered_items                 AS delivered_items,
        COALESCE(o.da_hoan, 0)            AS da_hoan,
        COALESCE(o.dang_hoan, 0)          AS dang_hoan,
        COALESCE(o.da_huy, 0)             AS da_huy,
        COALESCE(o.don_nhap_trung, 0)     AS don_nhap_trung,
        COALESCE(o.da_gui_hang, 0)        AS da_gui_hang,
        COALESCE(o.treo_khac, 0)          AS treo_khac,
        COALESCE(o.revenue_treo, 0)       AS revenue_treo,
        COALESCE(o.da_xoa, 0)             AS da_xoa,
        COALESCE(c.spend, 0)::bigint      AS ads_cost
      FROM (
        SELECT
          to_char(date_trunc('day', pancake_created_at AT TIME ZONE 'Asia/Ho_Chi_Minh'), 'YYYY-MM-DD') AS date,
          ${mktWithFallback} AS mkt_name,
          COUNT(*) FILTER (WHERE status NOT IN (-2) AND NOT ${excludeCond})::int AS total_orders,
          SUM(CASE WHEN status NOT IN (-2) AND NOT ${excludeCond} THEN ${revenueExpr} ELSE 0 END)::bigint AS revenue_total,
          SUM(CASE WHEN status = 3 AND NOT ${excludeCond} THEN ${revenueExpr} ELSE 0 END)::bigint AS revenue_delivered,
          COUNT(*) FILTER (WHERE status = 3 AND NOT ${excludeCond})::int AS n_nhan,
          SUM(CASE WHEN status NOT IN (-2) AND NOT ${excludeCond} THEN COALESCE((raw->>'partner_fee')::numeric, 0) ELSE 0 END)::bigint AS ship_cost,
          COUNT(*) FILTER (WHERE status = 5 AND NOT ${excludeCond})::int AS da_hoan,
          COUNT(*) FILTER (WHERE status = 4 AND NOT ${excludeCond})::int AS dang_hoan,
          COUNT(*) FILTER (WHERE status IN (6, -1) AND NOT (${nhapTrungCond}))::int AS da_huy,
          COUNT(*) FILTER (WHERE ${nhapTrungCond})::int AS don_nhap_trung,
          COUNT(*) FILTER (WHERE status = 2 AND NOT ${excludeCond})::int AS da_gui_hang,
          -- Đơn CÒN TREO chưa "đã gửi hàng": Mới(0)/Đã xác nhận(1)/Chờ hàng(11).
          -- Dùng cho công thức tạm tính B (ước lượng phần chưa chốt).
          COUNT(*) FILTER (WHERE status IN (0, 1, 11) AND NOT ${excludeCond})::int AS treo_khac,
          -- DT đơn còn treo (đã gửi hàng + mới/xác nhận/chờ hàng) — phần sẽ ước lượng tỷ lệ nhận.
          SUM(CASE WHEN status IN (0, 1, 2, 11) AND NOT ${excludeCond} THEN ${revenueExpr} ELSE 0 END)::bigint AS revenue_treo,
          COUNT(*) FILTER (WHERE status = 7)::int AS da_xoa,
          jsonb_agg(raw->'items') FILTER (WHERE status = 3 AND NOT ${excludeCond} AND raw->'items' IS NOT NULL) AS delivered_items
        FROM pancake_order
        WHERE deleted_at IS NULL
          AND source IN ('manual', 'facebook', 'medusa', 'unknown', 'webcake')
          AND pancake_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND pancake_created_at < (($2::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        GROUP BY date, mkt_name
      ) o
      FULL OUTER JOIN (
        SELECT to_char(date_trunc('day', date), 'YYYY-MM-DD') AS date, mkt_name, SUM(spend)::bigint AS spend
        FROM mkt_ads_cost
        WHERE deleted_at IS NULL
          AND date >= $1::date
          AND date <= $2::date
        GROUP BY date_trunc('day', date), mkt_name
      ) c ON c.date = o.date AND c.mkt_name = o.mkt_name
    `, [from, to])

    // ── Apply handover rules (per-day) ──────────────────────────────────────────
    for (const row of rows) {
      for (const rule of handoverRules) {
        if (
          row.mkt_name === rule.from_code &&
          row.date >= rule.effective_from &&
          (!rule.effective_to || row.date <= rule.effective_to)
        ) {
          row.mkt_name = rule.to_code
          break
        }
      }
    }

    // ── Helper: tính COGS từ delivered_items qua bảng giá vốn ───────────────────
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

    // ── Merge duplicate mkt_name (handover có thể tạo trùng) + tính field ───────
    const merged: Record<string, any> = {}
    for (const row of rows) {
      const m = row.mkt_name
      if (!merged[m]) {
        merged[m] = {
          mkt_name: m, total_orders: 0, revenue_total: 0, revenue_delivered: 0,
          ship_cost: 0, ads_cost: 0, cogs: 0, item_qty: 0, mapped_qty: 0,
          da_hoan: 0, dang_hoan: 0, da_huy: 0, da_gui_hang: 0,
          treo_khac: 0, revenue_treo: 0, n_nhan: 0,
        }
      }
      const g = merged[m]
      g.total_orders += Number(row.total_orders)
      g.revenue_total += Number(row.revenue_total)
      g.revenue_delivered += Number(row.revenue_delivered)
      g.ship_cost += Number(row.ship_cost)
      g.ads_cost += Number(row.ads_cost)
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

    // ── Tính các field dẫn xuất ────────────────────────────────────────────────
    const pct = (part: number, whole: number) => whole > 0 ? Math.round(part / whole * 10000) / 100 : null

    // CP thực kế toán/NV (nếu tháng đã nhập). Rỗng → cột CP thực để trống, không ảnh hưởng LNG cũ.
    let costByNV: Record<string, number> = {}
    try { ({ costByNV } = await computeAccountingCost(from, to)) } catch { /* bảng chưa có */ }
    const hasAccounting = Object.keys(costByNV).length > 0

    const result = Object.values(merged).map((g: any) => {
      // ── KHỐI THỰC (giữ nguyên logic cũ) ──
      const fullfill = FULLFILL_PER_ORDER * g.total_orders
      const cogs = Math.round(g.cogs)
      const lng = g.revenue_delivered - (cogs + g.ship_cost + g.ads_cost + fullfill)

      // ── CP THỰC KẾ TOÁN (thay ads API bằng tiền nạp thực đã phân bổ) ──
      // Chỉ có khi tháng đã nhập chi phí kế toán. LNG thực (KT) = LNG thực nhưng dùng cp_thuc
      // thay g.ads_cost. Giữ nguyên cột ads API + lng cũ để đối chiếu.
      const cpThuc = costByNV[String(g.mkt_name).toUpperCase()] ?? null
      const lngThucKt = cpThuc != null
        ? g.revenue_delivered - (cogs + g.ship_cost + cpThuc + fullfill)
        : null

      // ── KHỐI TẠM TÍNH (công thức B — tách đơn đã chốt khỏi đơn còn treo) ──
      // Khác bản cũ (doanh số toàn bộ × (1 − dkhh), không hội tụ về thực khi hết tháng):
      //   Doanh thu tạm tính = DT đã nhận (CHẮC CHẮN)
      //                      + DT đơn CÒN TREO × tỷ lệ nhận kỳ vọng.
      // Đơn đã nhận/hủy/hoàn lấy số thực; chỉ ước lượng phần đơn chưa chốt (status 0/1/2/11).
      // Khi hết tháng, đơn treo → 0 nên tạm tính tự hội tụ về thực.
      // Tỷ lệ nhận kỳ vọng = tỷ lệ nhận thành công trong SỐ ĐƠN ĐÃ NGÃ NGŨ (nhận/hủy/hoàn);
      // fallback 0.8 khi kỳ chưa có đơn nào chốt (đầu kỳ) để tránh dự phóng bằng 0.
      const nGiao = g.total_orders
      const nDaChot = g.n_nhan + g.da_hoan + g.dang_hoan + g.da_huy
      const tyLeNhan = nDaChot > 0 ? g.n_nhan / nDaChot : 0.8
      // dkhh vẫn tính để hiển thị cột "Dự kiến hoàn hủy" (thông tin), không còn dùng cho DT.
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
        mkt_name: g.mkt_name,
        total_orders: g.total_orders,
        revenue_total: g.revenue_total,
        revenue_delivered: g.revenue_delivered,
        cogs,
        ship_cost: g.ship_cost,
        ads_cost: g.ads_cost,
        fullfill,
        lng,
        lng_thuc: lng,
        // CP thực kế toán + LNG thực (KT). null khi tháng chưa nhập chi phí.
        cp_thuc: cpThuc,
        lng_thuc_kt: lngThucKt,
        cp_thuc_pct: cpThuc != null ? pct(cpThuc, g.revenue_total) : null,
        cogs_pct: pct(cogs, g.revenue_delivered),
        ship_pct: pct(g.ship_cost, g.revenue_delivered),
        ads_pct: pct(g.ads_cost, g.revenue_total),
        fullfill_pct: pct(fullfill, g.revenue_delivered),
        lng_pct: pct(lng, g.revenue_delivered),
        // khối tạm tính
        du_kien_hoan_huy: Math.round(dkhh * 10000) / 100,
        revenue_tam_tinh: revenueTamTinh,
        cogs_tam_tinh: cogsTamTinh,
        ship_tam_tinh: shipTamTinh,
        fullfill_tam_tinh: fullfillTamTinh,
        lng_tam_tinh: lngTamTinh,
        cogs_tt_pct: pct(cogsTamTinh, revenueTamTinh),
        ship_tt_pct: pct(shipTamTinh, revenueTamTinh),
        ads_tt_pct: pct(g.ads_cost, g.revenue_total),
        fullfill_tt_pct: pct(fullfillTamTinh, revenueTamTinh),
        lng_tt_pct: pct(lngTamTinh, revenueTamTinh),
        item_qty: g.item_qty,
        mapped_qty: g.mapped_qty,
      }
    }).sort((a, b) => b.lng - a.lng)

    // ── Totals ─────────────────────────────────────────────────────────────────
    const sum = (k: string) => result.reduce((s, r: any) => s + (r[k] ?? 0), 0)
    const totalRevenueTamTinh = sum("revenue_tam_tinh")
    const totals = {
      total_orders: sum("total_orders"),
      revenue_total: sum("revenue_total"),
      revenue_delivered: sum("revenue_delivered"),
      cogs: sum("cogs"),
      ship_cost: sum("ship_cost"),
      ads_cost: sum("ads_cost"),
      fullfill: sum("fullfill"),
      lng: sum("lng"),
      lng_thuc: sum("lng"),
      // CP thực kế toán (chỉ khi tháng đã nhập)
      cp_thuc: hasAccounting ? sum("cp_thuc") : null,
      lng_thuc_kt: hasAccounting ? sum("lng_thuc_kt") : null,
      // khối tạm tính
      revenue_tam_tinh: totalRevenueTamTinh,
      cogs_tam_tinh: sum("cogs_tam_tinh"),
      ship_tam_tinh: sum("ship_tam_tinh"),
      fullfill_tam_tinh: sum("fullfill_tam_tinh"),
      lng_tam_tinh: sum("lng_tam_tinh"),
      // dự kiến hoàn hủy tổng = (1 − dt_tạm_tính/doanh_số_toàn_bộ)
      du_kien_hoan_huy: sum("revenue_total") > 0
        ? Math.round((1 - totalRevenueTamTinh / sum("revenue_total")) * 10000) / 100
        : 0,
    }
    const totalItemQty = sum("item_qty")
    const totalMappedQty = sum("mapped_qty")

    return res.json({
      rows: result,
      totals,
      mapped_pct: totalItemQty > 0 ? Math.round(totalMappedQty / totalItemQty * 100) : 0,
      cost_mapped: avgCost.mapped,
      cost_total: avgCost.total,
      has_accounting: hasAccounting,
      from, to,
    })
  } catch (err: any) {
    console.error("[report/marketer-lng]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
