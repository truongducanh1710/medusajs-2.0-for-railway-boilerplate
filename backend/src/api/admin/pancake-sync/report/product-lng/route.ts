import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"
import { computeAvgCost, resolveDisplayId, DISPLAY_ID_ALIASES } from "../../../gia-von/avg-cost/route"

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
 * GET /admin/pancake-sync/report/product-lng?from=2026-06-01&to=2026-06-30
 *
 * Báo cáo Hoàn hủy + LNG (thực & tạm tính) theo SẢN PHẨM.
 * Mỗi đơn được gán cho 1 "SP chính" = item có (giá × SL) cao nhất trong đơn.
 * Đơn/số đếm (total_orders, da_nhan, da_hoan...) CHỈ tính cho SP chính của đơn,
 * nên 1 đơn không bị đếm ở nhiều SP (không double-count qua SP phụ).
 * Doanh thu/giá vốn vẫn chia theo tỷ trọng giá trị item trong đơn.
 * Công thức field copy nguyên từ report theo MKT (marketer-lng + marketer-performance),
 * chỉ đổi chiều group marketer → SP.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const {
      from = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
      to = new Date().toISOString().slice(0, 10),
    } = req.query as Record<string, string>

    // ── Bảng giá vốn TB (code → giá, tên → giá) ─────────────────────────────────
    const avgCost = await computeAvgCost(getPool())

    // Tên SP chuẩn theo code (để hiển thị thay vì tên item tự do, vd "Giẻ..." vs "Bộ...").
    const prodNames = await sql(`SELECT code, name FROM mkt_product WHERE active = true`)
    const codeToName: Record<string, string> = {}
    for (const p of prodNames) {
      if (p.code) codeToName[String(p.code).trim().toUpperCase()] = p.name
    }

    // SQL alias map display_id (đồng bộ DISPLAY_ID_ALIASES) để gom biến thể mã về code chuẩn.
    const aliasCases = Object.entries(DISPLAY_ID_ALIASES)
      .map(([from, to]) => `WHEN '${from}' THEN '${to}'`)
      .join("\n          ")
    const resolveSql = (expr: string) => `
      CASE upper(trim(${expr}))
          ${aliasCases}
          ELSE upper(trim(${expr}))
      END`

    // Đơn nháp/trùng + điều kiện loại trừ (copy marketer-lng).
    const tagNhap = `tags @> '[{"name":"Đơn nháp"}]'::jsonb`
    const tagTrung = `tags @> '[{"name":"Đơn trùng"}]'::jsonb`
    const nhapTrungCond = `status IN (6, -1) AND (${tagNhap} OR ${tagTrung})`
    const excludeCond = `(
      status = 7
      OR (${tagNhap} AND status IN (0, 11))
      OR (${nhapTrungCond})
    )`
    const revenueExpr = `COALESCE(NULLIF((raw->>'total_price_after_sub_discount')::numeric, 0), cod_amount::numeric, total::numeric)::bigint`
    // Giá item: raw.items không có field 'price' ở cấp item — giá nằm ở variation_info.retail_price.
    const itemPrice = `COALESCE((mi->'variation_info'->>'retail_price')::numeric, (mi->>'price')::numeric, 0)`
    const itemValueExpr = `(${itemPrice} * COALESCE((mi->>'quantity')::numeric, 1))`

    // ── Query: explode item, gom theo (đơn, SP) rồi group theo SP ───────────────
    // Đếm đơn (total_orders, da_nhan, da_hoan...): CHỈ tính khi SP này là SP chính
    // của đơn (is_main) → 1 đơn chỉ được đếm đúng 1 lần, quy về đúng 1 SP.
    // Tiền (doanh thu/cogs): chia theo tỷ trọng giá trị item của SP trong đơn.
    // Ship/fullfill: gán trọn cho SP chính (item giá trị cao nhất) của đơn.
    const rows = await sql(`
      WITH oi AS (
        SELECT
          po.id AS order_id,
          po.status,
          po.tags,
          ${resolveSql("mi->'variation_info'->>'display_id'")} AS sp_code,
          upper(trim(COALESCE(mi->'variation_info'->>'name', mi->>'name', ''))) AS sp_name_up,
          COALESCE(mi->'variation_info'->>'name', mi->>'name', 'CHƯA RÕ SP') AS sp_label,
          COALESCE((mi->>'quantity')::numeric, 1) AS qty,
          ${itemValueExpr} AS item_value,
          ${revenueExpr} AS order_revenue,
          COALESCE((po.raw->>'partner_fee')::numeric, 0) AS partner_fee,
          SUM(${itemValueExpr}) OVER (PARTITION BY po.id) AS order_total_value,
          MAX(${itemValueExpr}) OVER (PARTITION BY po.id) AS order_max_value
        FROM pancake_order po
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(po.raw->'items', '[]'::jsonb)) AS mi
        WHERE po.deleted_at IS NULL
          AND po.source IN ('manual', 'facebook', 'medusa', 'unknown', 'webcake')
          AND po.pancake_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND po.pancake_created_at < (($2::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND po.raw->'items' IS NOT NULL
      ),
      -- gán sp_key cho từng item (cột thường để GROUP BY được)
      oi2 AS (
        SELECT *, COALESCE(NULLIF(sp_code, ''), sp_name_up, 'CHƯA RÕ SP') AS sp_key
        FROM oi
      ),
      -- gom item trùng SP trong cùng đơn → 1 dòng / (đơn, SP)
      os AS (
        SELECT
          order_id,
          sp_key,
          MAX(status) AS status,
          (array_agg(tags))[1] AS tags,
          MAX(sp_label) AS sp_label,
          NULLIF(MAX(sp_code), '') AS sp_code,
          -- phần doanh thu của SP = revenue đơn × (giá trị item SP / tổng giá trị item đơn)
          CASE WHEN MAX(order_total_value) > 0
            THEN MAX(order_revenue) * (SUM(item_value) / MAX(order_total_value))
            ELSE 0 END AS sp_revenue,
          SUM(qty) AS sp_qty,
          -- SP có chứa item giá trị cao nhất đơn → chịu ship/fullfill
          bool_or(item_value = order_max_value AND order_max_value > 0) AS is_main,
          MAX(partner_fee) AS partner_fee
        FROM oi2
        GROUP BY order_id, sp_key
      )
      SELECT
        sp_key,
        MAX(sp_label) AS sp_label,
        MAX(sp_code)  AS sp_code,
        COUNT(*) FILTER (WHERE is_main AND status NOT IN (-2) AND NOT ${excludeCond})::int AS total_orders,
        SUM(CASE WHEN status NOT IN (-2) AND NOT ${excludeCond} THEN sp_revenue ELSE 0 END)::bigint AS revenue_total,
        SUM(CASE WHEN status = 3 AND NOT ${excludeCond} THEN sp_revenue ELSE 0 END)::bigint AS revenue_delivered,
        SUM(CASE WHEN is_main AND status NOT IN (-2) AND NOT ${excludeCond} THEN partner_fee ELSE 0 END)::bigint AS ship_cost,
        SUM(CASE WHEN status = 3 AND NOT ${excludeCond} THEN sp_qty ELSE 0 END)::numeric AS delivered_qty,
        COUNT(*) FILTER (WHERE is_main AND status NOT IN (-2) AND NOT ${excludeCond})::int AS main_orders,
        COUNT(*) FILTER (WHERE is_main AND status = 3 AND NOT ${excludeCond})::int AS da_nhan,
        COUNT(*) FILTER (WHERE is_main AND status = 5 AND NOT ${excludeCond})::int AS da_hoan,
        COUNT(*) FILTER (WHERE is_main AND status = 4 AND NOT ${excludeCond})::int AS dang_hoan,
        COUNT(*) FILTER (WHERE is_main AND status IN (6, -1) AND NOT (${nhapTrungCond}))::int AS da_huy,
        COUNT(*) FILTER (WHERE is_main AND ${nhapTrungCond})::int AS don_nhap_trung,
        COUNT(*) FILTER (WHERE is_main AND status = 7)::int AS da_xoa,
        COUNT(*) FILTER (WHERE is_main AND status = 2 AND NOT ${excludeCond})::int AS da_gui_hang,
        COUNT(*) FILTER (WHERE is_main AND status = 0 AND NOT ${excludeCond})::int AS moi,
        COUNT(*) FILTER (WHERE is_main AND status = 11 AND NOT ${excludeCond})::int AS cho_hang,
        COUNT(*) FILTER (WHERE is_main AND status = 1 AND NOT ${excludeCond})::int AS da_xac_nhan,
        COUNT(*) FILTER (WHERE is_main AND status = 8 AND NOT ${excludeCond})::int AS dang_dong_hang,
        COUNT(*) FILTER (WHERE is_main AND status = 9 AND NOT ${excludeCond})::int AS cho_chuyen_hang
      FROM os
      GROUP BY sp_key
    `, [from, to])

    // Ads KHÔNG gán được theo SP (tên camp không chứa mã SP ở vị trí cố định) → để 0.
    // LNG theo SP vì vậy không trừ chi phí ads.

    // ── Merge theo sp_key (gom các biến thể tên cùng code) + tính field ─────────
    const merged: Record<string, any> = {}
    for (const row of rows) {
      // gom theo code nếu có, để biến thể tên cùng SP về 1 dòng
      const key = row.sp_code || row.sp_key
      if (!merged[key]) {
        // Tên hiển thị: ưu tiên tên chuẩn mkt_product theo code, else tên item.
        const stdName = row.sp_code ? codeToName[String(row.sp_code).toUpperCase()] : null
        merged[key] = {
          sp_label: stdName || row.sp_label, sp_code: row.sp_code || null,
          total_orders: 0, main_orders: 0, revenue_total: 0, revenue_delivered: 0, ship_cost: 0,
          delivered_qty: 0, da_nhan: 0, da_hoan: 0, dang_hoan: 0, da_huy: 0,
          don_nhap_trung: 0, da_xoa: 0, da_gui_hang: 0, moi: 0, cho_hang: 0,
          da_xac_nhan: 0, dang_dong_hang: 0, cho_chuyen_hang: 0,
        }
      }
      const g = merged[key]
      for (const k of ["total_orders", "main_orders", "revenue_total", "revenue_delivered", "ship_cost",
        "delivered_qty", "da_nhan", "da_hoan", "dang_hoan", "da_huy", "don_nhap_trung",
        "da_xoa", "da_gui_hang", "moi", "cho_hang", "da_xac_nhan", "dang_dong_hang",
        "cho_chuyen_hang"]) {
        g[k] += Number(row[k] ?? 0)
      }
    }

    const pct = (part: number, whole: number) => whole > 0 ? Math.round(part / whole * 10000) / 100 : null

    const result = Object.entries(merged).map(([key, g]: [string, any]) => {
      // giá vốn / sp từ avgCost: ưu tiên code, fallback tên
      const unit = (g.sp_code && avgCost.costs[g.sp_code] != null)
        ? avgCost.costs[g.sp_code]
        : (avgCost.byName[(g.sp_label || "").toUpperCase()] ?? null)
      const cogs = unit != null ? Math.round(unit * g.delivered_qty) : 0
      const ads_cost = 0  // không gán ads theo SP

      // ── KHỐI THỰC ──
      // Fullfill chỉ tính cho đơn mà SP này là SP chính (mỗi đơn chịu 1 lần fullfill).
      const fullfill = FULLFILL_PER_ORDER * g.main_orders
      const lng = g.revenue_delivered - (cogs + g.ship_cost + ads_cost + fullfill)

      // ── KHỐI TẠM TÍNH ──
      const nGiao = g.total_orders
      const dkhh = nGiao > 0 ? (g.da_hoan + g.dang_hoan + g.da_huy + g.da_gui_hang / 3) / nGiao : 0
      const pctVon = g.revenue_delivered > 0 ? cogs / g.revenue_delivered : 0
      const pctShip = g.revenue_delivered > 0 ? g.ship_cost / g.revenue_delivered : 0
      const revenueTamTinh = Math.round(g.revenue_total * (1 - dkhh))
      const cogsTamTinh = Math.round(revenueTamTinh * pctVon)
      const shipTamTinh = Math.round(revenueTamTinh * pctShip)
      const fullfillTamTinh = FULLFILL_PER_ORDER * g.main_orders
      const lngTamTinh = revenueTamTinh - (cogsTamTinh + shipTamTinh + ads_cost + fullfillTamTinh)

      // ── Hoàn hủy ──
      // total_orders chỉ đếm đơn mà SP này là SP chính, ĐÃ loại đã xóa + nháp/trùng qua
      // excludeCond, nên chính nó = tổng đơn giao (KHÔNG trừ lại da_xoa/don_nhap_trung — sẽ trừ trùng).
      const nGui = g.total_orders
      const pctN = (part: number) => nGui > 0 ? Math.round(part / nGui * 1000) / 10 : 0
      const ty_le_hoan = pctN(g.dang_hoan + g.da_hoan)
      const ty_le_huy = pctN(g.da_huy)

      return {
        mkt_name: g.sp_label,  // dùng key "mkt_name" cho khớp type frontend tái dùng
        sp_label: g.sp_label,
        sp_code: g.sp_code,
        // hoàn hủy
        da_nhan: g.da_nhan, da_hoan: g.da_hoan, dang_hoan: g.dang_hoan, da_huy: g.da_huy,
        don_nhap_trung: g.don_nhap_trung, da_xoa: g.da_xoa, da_gui_hang: g.da_gui_hang,
        moi: g.moi, cho_hang: g.cho_hang, da_xac_nhan: g.da_xac_nhan,
        dang_dong_hang: g.dang_dong_hang, cho_chuyen_hang: g.cho_chuyen_hang,
        tong_giao: g.da_nhan, tong_don_giao: nGui,
        ty_le_hoan, ty_le_huy, ty_le_giao: pctN(g.da_nhan),
        hoan_huy: Math.round((ty_le_hoan + ty_le_huy) * 10) / 10,
        du_kien_hoan_huy: pctN(g.da_hoan + g.dang_hoan + g.da_huy + g.da_gui_hang / 3),
        // LNG thực
        total_orders: g.total_orders, revenue_total: g.revenue_total,
        revenue_delivered: g.revenue_delivered, cogs, ship_cost: g.ship_cost, ads_cost,
        fullfill, lng, lng_thuc: lng,
        cogs_pct: pct(cogs, g.revenue_delivered),
        ship_pct: pct(g.ship_cost, g.revenue_delivered),
        ads_pct: pct(ads_cost, g.revenue_total),
        fullfill_pct: pct(fullfill, g.revenue_delivered),
        lng_pct: pct(lng, g.revenue_delivered),
        // LNG tạm tính
        revenue_tam_tinh: revenueTamTinh, cogs_tam_tinh: cogsTamTinh,
        ship_tam_tinh: shipTamTinh, fullfill_tam_tinh: fullfillTamTinh, lng_tam_tinh: lngTamTinh,
        cogs_tt_pct: pct(cogsTamTinh, revenueTamTinh),
        ship_tt_pct: pct(shipTamTinh, revenueTamTinh),
        ads_tt_pct: pct(ads_cost, g.revenue_total),
        fullfill_tt_pct: pct(fullfillTamTinh, revenueTamTinh),
        lng_tt_pct: pct(lngTamTinh, revenueTamTinh),
      }
    }).sort((a, b) => b.lng_thuc - a.lng_thuc)

    // ── Totals ─────────────────────────────────────────────────────────────────
    const sum = (k: string) => result.reduce((s, r: any) => s + (r[k] ?? 0), 0)
    const N = sum("tong_don_giao")
    const pctT = (part: number) => N > 0 ? Math.round(part / N * 1000) / 10 : 0
    const totalRevenueTamTinh = sum("revenue_tam_tinh")
    const tlh = pctT(sum("dang_hoan") + sum("da_hoan"))
    const tlhuy = pctT(sum("da_huy"))
    const totals = {
      total_orders: sum("total_orders"),
      revenue_total: sum("revenue_total"),
      revenue_delivered: sum("revenue_delivered"),
      cogs: sum("cogs"), ship_cost: sum("ship_cost"), ads_cost: sum("ads_cost"),
      fullfill: sum("fullfill"), lng: sum("lng"), lng_thuc: sum("lng"),
      revenue_tam_tinh: totalRevenueTamTinh, cogs_tam_tinh: sum("cogs_tam_tinh"),
      ship_tam_tinh: sum("ship_tam_tinh"), fullfill_tam_tinh: sum("fullfill_tam_tinh"),
      lng_tam_tinh: sum("lng_tam_tinh"),
      // hoàn hủy totals
      da_nhan: sum("da_nhan"), da_hoan: sum("da_hoan"), dang_hoan: sum("dang_hoan"),
      da_huy: sum("da_huy"), don_nhap_trung: sum("don_nhap_trung"), da_xoa: sum("da_xoa"),
      da_gui_hang: sum("da_gui_hang"), moi: sum("moi"), cho_hang: sum("cho_hang"),
      da_xac_nhan: sum("da_xac_nhan"), dang_dong_hang: sum("dang_dong_hang"),
      cho_chuyen_hang: sum("cho_chuyen_hang"), tong_giao: sum("da_nhan"), tong_don_giao: N,
      ty_le_hoan: tlh, ty_le_huy: tlhuy, ty_le_giao: pctT(sum("da_nhan")),
      hoan_huy: Math.round((tlh + tlhuy) * 10) / 10,
      du_kien_hoan_huy: pctT(sum("da_hoan") + sum("dang_hoan") + sum("da_huy") + sum("da_gui_hang") / 3),
    }

    return res.json({ rows: result, totals, from, to })
  } catch (err: any) {
    console.error("[report/product-lng]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
