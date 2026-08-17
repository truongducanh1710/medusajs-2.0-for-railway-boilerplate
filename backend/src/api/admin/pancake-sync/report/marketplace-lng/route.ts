import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"
import { computeAvgCost, DISPLAY_ID_ALIASES, toVNDate } from "../../../gia-von/avg-cost/route"

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
 * GET /admin/pancake-sync/report/marketplace-lng?from=2026-08-01&to=2026-08-31
 *
 * LNG đơn sàn TMĐT (TikTok Shop / Shopee) — các báo cáo LNG khác lọc
 * `source IN ('manual','facebook','medusa','unknown','webcake')` nên toàn bộ đơn sàn
 * (T8/2026: 6.404 đơn, 103,5tr doanh thu) không xuất hiện ở đâu cả.
 *
 * Khác biệt so với LNG đơn ads, quyết định cách tính ở đây:
 *  • Doanh thu: dùng total_price_after_sub_discount = tiền THỰC NHẬN, sàn đã trừ sẵn
 *    phí sàn + khuyến mãi. Không tự trừ fee_marketplace lần nữa (sẽ trừ đôi) — chỉ hiển
 *    thị phí sàn để biết sàn giữ bao nhiêu.
 *  • Ship: sàn trả, partner_fee = 0 trên mọi đơn đã kiểm → không tính vào giá vốn.
 *  • Ads: sàn không chạy ads qua hệ thống → không có chi phí ads gán được.
 *  • Marketer: raw.marketer trên đơn sàn là nhân viên vận hành sàn, KHÔNG phải MKT chạy
 *    ads, nên gom theo SÀN + SẢN PHẨM chứ không theo MKT.
 *
 * Giá vốn hiện chỉ phủ ~21% số lượng bán (hàng sàn phần lớn là mặt hàng lẻ chưa khai
 * trong bảng nhập hàng). SP thiếu giá vốn KHÔNG bị tính 0 âm thầm — trả cờ
 * `missing_cost` để UI cảnh báo, và tách `revenue_no_cost` để biết phần doanh thu chưa
 * tính được lãi.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const {
      from: fromRaw = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
      to: toRaw = new Date().toISOString().slice(0, 10),
      platform,
    } = req.query as Record<string, string>

    const from = toVNDate(fromRaw)
    const to = toVNDate(toRaw)

    const avgCost = await computeAvgCost(getPool())

    const prodNames = await sql(`SELECT code, name FROM mkt_product WHERE active = true`)
    const codeToName: Record<string, string> = {}
    for (const p of prodNames) if (p.code) codeToName[String(p.code).trim().toUpperCase()] = p.name

    const aliasCases = Object.entries(DISPLAY_ID_ALIASES)
      .map(([f, t]) => `WHEN '${f}' THEN '${t}'`).join("\n          ")
    const resolveSql = (expr: string) => `
      CASE upper(trim(${expr}))
          ${aliasCases}
          ELSE upper(trim(${expr}))
      END`

    // Đơn sàn không có tag "Đơn nháp/trùng" như đơn ads; chỉ loại đơn đã xoá (status 7).
    const excludeCond = `status = 7`
    // Tiền thực nhận (sàn đã trừ phí + khuyến mãi).
    const revenueExpr = `COALESCE(NULLIF((raw->>'total_price_after_sub_discount')::numeric, 0), cod_amount::numeric, total::numeric)::bigint`
    const feeExpr = `COALESCE((raw->>'fee_marketplace')::numeric, 0)::bigint`
    const listPriceExpr = `COALESCE((raw->>'total_price')::numeric, 0)::bigint`

    const platformFilter = platform && ["shopee", "tiktok"].includes(platform)
      ? `AND po.source = '${platform}'` : `AND po.source IN ('shopee','tiktok')`

    // Giá vốn của PHỤ KIỆN bán lẻ, đọc trực tiếp từ cost_sheet.
    // computeAvgCost() chỉ đưa dòng "Sản phẩm chính" vào byName và gộp tiền phụ kiện vào
    // giá bộ — hợp lý cho đơn ads (phụ kiện chỉ đi kèm), nhưng sàn BÁN LẺ chính những
    // món này: giẻ lau bán 39.000đ mà tra ra 226.540đ của cả bộ (đo được 1263% giá vốn).
    // Ở đây lấy "Giá về kho/sp" của từng dòng phụ kiện làm giá vốn riêng cho nó.
    const sheetCols = await sql(`SELECT id, position FROM cost_sheet_column ORDER BY position`)
    const sheetRows = await sql(`SELECT position, data FROM cost_sheet_row ORDER BY position`)
    const accessoryCost: Record<string, number> = {}
    if (sheetRows.length > 1) {
      const posToId: Record<number, string> = {}
      for (const c2 of sheetCols) posToId[c2.position] = c2.id
      const header = sheetRows[0].data as Record<string, string>
      const headerToId: Record<string, string> = {}
      for (const [colId, val] of Object.entries(header)) if (val) headerToId[String(val).trim()] = colId
      const colTen = headerToId["Sản phẩm"] ?? posToId[1]
      const colTinhChat = headerToId["Tính chất"] ?? posToId[2]
      const colGiaKho = headerToId["Giá về kho/sp"] ?? posToId[9]
      for (const r of sheetRows.slice(1)) {
        const d = r.data as Record<string, string>
        const ten = (d[colTen] ?? "").trim()
        if (!ten || (d[colTinhChat] ?? "").trim() === "Sản phẩm chính") continue
        const gia = parseFloat(String(d[colGiaKho] ?? "").replace(/\./g, "").replace(",", ".")) || 0
        if (gia > 0) accessoryCost[ten.toUpperCase()] = Math.round(gia)
      }
    }

    // Thứ tự tra giá vốn: phụ kiện (tên) → tên SP chính → mã → prefix. Xem oi2 bên dưới.
    const costEntries = [
      ...Object.entries(accessoryCost).map(([k, v]) => ["accessory", k, v] as const),
      ...Object.entries(avgCost.costs).map(([k, v]) => ["code", k, v] as const),
      ...Object.entries(avgCost.byPrefix).map(([k, v]) => ["prefix", k, v] as const),
      ...Object.entries(avgCost.byName).map(([k, v]) => ["name", k, v] as const),
    ]
    const costValues = costEntries.length
      ? costEntries.map(([kind, key, val]) =>
          `('${kind}', '${String(key).replace(/'/g, "''")}', ${Number(val) || 0})`).join(",")
      : `('code', '__none__', 0)`

    const rows = await sql(`
      WITH cost_map(kind, key, unit) AS (VALUES ${costValues}),
      oi AS (
        SELECT
          po.id AS order_id,
          po.source AS platform,
          po.status,
          ${resolveSql("mi->'variation_info'->>'display_id'")} AS sp_code,
          upper(trim(COALESCE(mi->'variation_info'->>'name', mi->>'name', ''))) AS sp_name_up,
          COALESCE(mi->'variation_info'->>'name', mi->>'name', 'CHƯA RÕ SP') AS sp_label,
          COALESCE((mi->>'quantity')::numeric, 1) AS qty,
          -- Giá trị niêm yết của dòng hàng — chỉ dùng làm TỶ TRỌNG chia doanh thu thực
          -- nhận giữa các dòng trong cùng đơn, không dùng làm doanh thu.
          (COALESCE((mi->'variation_info'->>'retail_price')::numeric, (mi->>'price')::numeric, 0)
            * COALESCE((mi->>'quantity')::numeric, 1)) AS retail_value,
          ${revenueExpr} AS order_revenue,
          ${feeExpr} AS fee_marketplace,
          ${listPriceExpr} AS list_price
        FROM pancake_order po
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(po.raw->'items', '[]'::jsonb)) AS mi
        WHERE po.deleted_at IS NULL
          ${platformFilter}
          AND po.pancake_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND po.pancake_created_at < (($2::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND po.raw->'items' IS NOT NULL
      ),
      oi2 AS (
        SELECT oi.*,
          COALESCE(NULLIF(sp_code, ''), sp_name_up, 'CHƯA RÕ SP') AS sp_key,
          -- Khớp theo TÊN sản phẩm TRƯỚC mã (ngược với report/product-lng).
          -- DISPLAY_ID_ALIASES gộp phụ kiện vào mã SP chính (PHVVN004_GBLN "giẻ lau"
          -- -> PHVVN003_BLN "BỘ lau nhà"), đúng cho đơn ads nơi giẻ chỉ đi kèm bộ,
          -- nhưng SAI trên sàn nơi giẻ bán lẻ 39.000đ: tính vốn 226.540đ của cả bộ.
          -- Tên trong cost_sheet tách được "GIẺ LAU NHÀ TÁCH NƯỚC" (10.719đ) khỏi
          -- "BỘ LAU NHÀ TÁCH NƯỚC" (226.540đ) nên khớp tên mới ra đúng món.
          COALESCE(
            (SELECT unit FROM cost_map c WHERE c.kind = 'accessory' AND c.key = oi.sp_name_up),
            (SELECT unit FROM cost_map c WHERE c.kind = 'name'   AND c.key = oi.sp_name_up),
            (SELECT unit FROM cost_map c WHERE c.kind = 'code'   AND c.key = upper(oi.sp_code)),
            (SELECT unit FROM cost_map c WHERE c.kind = 'prefix' AND c.key = (regexp_match(upper(oi.sp_code), '^(PHVVN[0-9]{2,3})'))[1]),
            0
          ) AS unit_cost
        FROM oi
      ),
      -- Chia doanh thu/phí sàn cho từng dòng hàng theo tỷ trọng giá niêm yết của nó.
      -- KHÁC HẲN đơn ads (report/product-lng gán trọn đơn cho 1 "SP chính"): trên sàn
      -- khách tự chọn từng món, không có hàng tặng kèm, nên mỗi dòng phải tự chịu doanh
      -- thu và giá vốn của chính nó. Gán trọn đơn cho SP vốn cao nhất sẽ tạo số vô lý —
      -- đã đo thực tế: giẻ lau bán lẻ ra %giá vốn 1263% vì gánh doanh thu cả đơn.
      oi3 AS (
        SELECT oi2.*,
          (unit_cost * qty) AS item_cost,
          CASE WHEN SUM(retail_value) OVER (PARTITION BY order_id) > 0
            THEN retail_value / SUM(retail_value) OVER (PARTITION BY order_id)
            ELSE 1.0 / COUNT(*) OVER (PARTITION BY order_id)
          END AS rev_share
        FROM oi2
      )
      SELECT
        platform,
        sp_key,
        MAX(sp_label) AS sp_label,
        MAX(NULLIF(sp_code, '')) AS sp_code,
        bool_and(unit_cost > 0) AS has_cost,
        -- Đếm "đơn" ở đây = số đơn có chứa SP này (1 đơn nhiều SP sẽ đếm ở nhiều dòng).
        COUNT(DISTINCT order_id) FILTER (WHERE NOT ${excludeCond})::int AS total_orders,
        COUNT(DISTINCT order_id) FILTER (WHERE status = 3)::int AS da_nhan,
        COUNT(DISTINCT order_id) FILTER (WHERE status = 5)::int AS da_hoan,
        COUNT(DISTINCT order_id) FILTER (WHERE status = 4)::int AS dang_hoan,
        COUNT(DISTINCT order_id) FILTER (WHERE status IN (6, -1))::int AS da_huy,
        SUM(CASE WHEN status = 3 THEN order_revenue   * rev_share ELSE 0 END)::bigint AS revenue_delivered,
        SUM(CASE WHEN status = 3 THEN fee_marketplace * rev_share ELSE 0 END)::bigint AS fee_marketplace,
        SUM(CASE WHEN status = 3 THEN list_price      * rev_share ELSE 0 END)::bigint AS list_price,
        -- Giá vốn của CHÍNH dòng hàng này; dòng chưa khai vốn tách riêng để không tạo lãi ảo.
        SUM(CASE WHEN status = 3 AND unit_cost > 0 THEN item_cost ELSE 0 END)::bigint AS cogs,
        SUM(CASE WHEN status = 3 AND unit_cost > 0 THEN order_revenue * rev_share ELSE 0 END)::bigint AS revenue_costed,
        SUM(CASE WHEN status = 3 AND unit_cost = 0 THEN order_revenue * rev_share ELSE 0 END)::bigint AS revenue_no_cost,
        COUNT(DISTINCT order_id) FILTER (WHERE status = 3 AND unit_cost > 0)::int AS orders_costed,
        SUM(CASE WHEN status = 3 THEN qty ELSE 0 END)::numeric AS delivered_qty
      FROM oi3
      GROUP BY platform, sp_key
    `, [from, to])

    const pct = (part: number, whole: number) => whole > 0 ? Math.round(part / whole * 10000) / 100 : null

    // Gom biến thể cùng mã về 1 dòng, tách theo (sàn × SP)
    const merged: Record<string, any> = {}
    for (const row of rows) {
      const codeKey = row.sp_code || row.sp_key
      const key = `${row.platform}||${codeKey}`
      if (!merged[key]) {
        const stdName = row.sp_code ? codeToName[String(row.sp_code).toUpperCase()] : null
        merged[key] = {
          platform: row.platform, sp_label: stdName || row.sp_label, sp_code: row.sp_code || null,
          has_cost: true,
          total_orders: 0, da_nhan: 0, da_hoan: 0, dang_hoan: 0, da_huy: 0,
          revenue_delivered: 0, fee_marketplace: 0, list_price: 0,
          cogs: 0, revenue_costed: 0, revenue_no_cost: 0, orders_costed: 0, delivered_qty: 0,
        }
      }
      const g = merged[key]
      for (const k of ["total_orders", "da_nhan", "da_hoan", "dang_hoan", "da_huy",
        "revenue_delivered", "fee_marketplace", "list_price", "cogs",
        "revenue_costed", "revenue_no_cost", "orders_costed", "delivered_qty"]) {
        g[k] += Number(row[k] ?? 0)
      }
      if (!row.has_cost) g.has_cost = false
    }

    const result = Object.values(merged).map((g: any) => {
      // Fullfill: 1 đơn chịu 1 lần. Ở dòng SP thì orders_costed là "số đơn có chứa SP
      // này", nên con số này chỉ đúng khi đơn 1 SP; tổng toàn báo cáo được tính lại
      // bằng số đơn distinct ở mkTotals bên dưới để không cộng trùng đơn nhiều SP.
      const fullfill = FULLFILL_PER_ORDER * g.orders_costed
      // LNG chỉ tính trên phần doanh thu có giá vốn — phần còn lại nêu riêng ở revenue_no_cost.
      const lng = g.revenue_costed - (g.cogs + fullfill)
      const nGiao = g.total_orders
      const pctN = (p: number) => nGiao > 0 ? Math.round(p / nGiao * 1000) / 10 : 0
      return {
        platform: g.platform,
        platform_label: g.platform === "tiktok" ? "TikTok Shop" : "Shopee",
        sp_label: g.sp_label, sp_code: g.sp_code,
        missing_cost: !g.has_cost,
        total_orders: g.total_orders, da_nhan: g.da_nhan, da_hoan: g.da_hoan,
        dang_hoan: g.dang_hoan, da_huy: g.da_huy,
        ty_le_hoan: pctN(g.da_hoan + g.dang_hoan), ty_le_huy: pctN(g.da_huy),
        delivered_qty: g.delivered_qty,
        list_price: g.list_price,
        fee_marketplace: g.fee_marketplace,
        fee_pct: pct(g.fee_marketplace, g.list_price),
        revenue_delivered: g.revenue_delivered,
        revenue_costed: g.revenue_costed,
        revenue_no_cost: g.revenue_no_cost,
        cogs: g.cogs, cogs_pct: pct(g.cogs, g.revenue_costed),
        fullfill,
        lng, lng_pct: pct(lng, g.revenue_costed),
      }
    }).sort((a, b) => b.revenue_delivered - a.revenue_delivered)

    const sum = (k: string, rows2 = result) => rows2.reduce((s, r: any) => s + (Number(r[k]) || 0), 0)
    const mkTotals = (rows2: any[]) => {
      const revCosted = sum("revenue_costed", rows2)
      const cogs = sum("cogs", rows2)
      const ff = sum("fullfill", rows2)
      const lng = revCosted - (cogs + ff)
      const list = sum("list_price", rows2)
      const fee = sum("fee_marketplace", rows2)
      return {
        total_orders: sum("total_orders", rows2), da_nhan: sum("da_nhan", rows2),
        da_hoan: sum("da_hoan", rows2), dang_hoan: sum("dang_hoan", rows2), da_huy: sum("da_huy", rows2),
        delivered_qty: sum("delivered_qty", rows2),
        list_price: list, fee_marketplace: fee, fee_pct: pct(fee, list),
        revenue_delivered: sum("revenue_delivered", rows2),
        revenue_costed: revCosted, revenue_no_cost: sum("revenue_no_cost", rows2),
        cogs, cogs_pct: pct(cogs, revCosted), fullfill: ff,
        lng, lng_pct: pct(lng, revCosted),
      }
    }

    const byPlatform = ["tiktok", "shopee"].map(p => ({
      platform: p,
      platform_label: p === "tiktok" ? "TikTok Shop" : "Shopee",
      ...mkTotals(result.filter(r => r.platform === p)),
    })).filter(p => p.total_orders > 0)

    const totals = mkTotals(result)
    // Cảnh báo mức phủ giá vốn — biết số LNG đang đại diện cho bao nhiêu % doanh thu.
    const coverage = {
      revenue_costed: totals.revenue_costed,
      revenue_no_cost: totals.revenue_no_cost,
      pct: pct(totals.revenue_costed, totals.revenue_costed + totals.revenue_no_cost),
      missing_products: result.filter(r => r.missing_cost).length,
    }

    return res.json({ rows: result, by_platform: byPlatform, totals, coverage, from, to })
  } catch (err: any) {
    console.error("[report/marketplace-lng]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
