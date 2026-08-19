import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"
import { computeAvgCost, DISPLAY_ID_ALIASES, toVNDate } from "../../../gia-von/avg-cost/route"
import { getMyrToVndRate } from "../../../../../lib/db"

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
 * GET /admin/pancake-sync/report/marketplace-lng?from=&to=&platform=&market=VN|MY
 *
 * Luôn chạy trên MỘT thị trường (mặc định VN): đơn MY lưu tiền theo đồng của shop đó,
 * cộng chung VN+MY ra số vô nghĩa nên không có chế độ "tất cả thị trường".
 *
 * TIỀN TỆ: đơn MY lưu bằng SEN (1 RM = 100 sen) — total_price 5800 = RM 58,00. Báo cáo
 * quy hết về VND ngay trong SQL theo tỷ giá tháng (bảng mkt_exchange_rate), vì giá vốn
 * khai bằng VND và chi phí ads cũng nhập bằng VND. Không quy đổi thì %giá vốn và LNG vô
 * nghĩa (đem VND chia cho sen).
 *
 * by_day trả 2 mức song song:
 *  • THỰC   — chỉ đơn status=3 (giao thành công). Tiền chắc chắn về.
 *  • TẠM TÍNH — thêm đơn đã xác nhận cho đi: status 2 (đang giao) + 8 (đang đóng hàng).
 *    Đơn sàn hoàn rất ít nên coi đơn đang đi là sẽ nhận, KHÔNG nhân tỷ lệ dự phóng
 *    như báo cáo FB (marketer-lng dùng revenue_treo × tỷ_lệ_nhận).
 *    Cần 2 mức vì đơn sàn mất vài ngày mới giao xong: ngày gần đây ads đã tiêu hết
 *    nhưng doanh thu chưa kịp ghi nhận → nhìn số "thực" tưởng lỗ nặng.
 *
 * ⚠ Status thực tế trên đơn sàn (quét ~2.000 đơn Shopee+TikTok, 8/2026) — bảng
 * GLOSSARY.md ĐANG SAI ở code 6 và thiếu code 8:
 *    0 Chờ xử lý · 1 Sale đã chốt · 2 Đang giao · 3 Giao thành công
 *    4 Đang hoàn về · 6 ĐÃ HỦY (glossary ghi nhầm "Đã gửi VC") · 8 Đang đóng hàng
 * Code 6 = huỷ đúng trên MỌI nguồn (đã đối chiếu cả facebook/manual), không riêng sàn.
 * Gộp nhầm 6 vào tạm tính từng làm 08/08 Shopee VN ra 21 đơn thay vì 15.
 * Status 9 (glossary ghi "Chờ VTP lấy") KHÔNG tồn tại trên đơn sàn.
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
 *  • Ads: sàn không có API spend — chi phí lấy từ bảng nhân sự điền tay ở trang
 *    /app/nhap-chi-phi (mkt_ads_cost_marketplace), grain (ngày × sàn × thị trường × shop).
 *    Doanh thu chưa tách được tới shop nên khi trừ thì gộp các shop cùng sàn.
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
      market: marketRaw,
    } = req.query as Record<string, string>

    // Mặc định VN. Đơn MY lưu giá trị theo đồng tiền của shop đó, cộng chung với VN ra
    // số vô nghĩa — nên báo cáo luôn chạy trên MỘT thị trường, không có chế độ "tất cả".
    const market = String(marketRaw || "VN").toUpperCase() === "MY" ? "MY" : "VN"

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

    // Đơn MY lưu tiền bằng SEN (1 RM = 100 sen): total_price 5800 = RM 58,00. Quy hết
    // về VND ngay trong SQL để mọi phép tính phía sau (giá vốn, ads, LNG) cùng một đơn
    // vị — giá vốn khai bằng VND và chi phí ads cũng nhập bằng VND.
    const rate = market === "MY" ? await getMyrToVndRate(to) : 1
    const MONEY = market === "MY" ? `* ${rate} / 100.0` : ""

    // Tiền thực nhận (sàn đã trừ phí + khuyến mãi).
    const revenueExpr = `(COALESCE(NULLIF((raw->>'total_price_after_sub_discount')::numeric, 0), cod_amount::numeric, total::numeric) ${MONEY})::bigint`
    const feeExpr = `(COALESCE((raw->>'fee_marketplace')::numeric, 0) ${MONEY})::bigint`
    const listPriceExpr = `(COALESCE((raw->>'total_price')::numeric, 0) ${MONEY})::bigint`

    const platformFilter = platform && ["shopee", "tiktok"].includes(platform)
      ? `AND po.source = '${platform}'` : `AND po.source IN ('shopee','tiktok')`
    const marketFilter = `AND COALESCE(NULLIF(po.market, ''), 'VN') = '${market}'`

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
          ${marketFilter}
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

    // ── LNG THEO NGÀY × SÀN ────────────────────────────────────────────────────
    // Cùng cách tính với bảng theo SP ở trên (chia doanh thu theo tỷ trọng, giá vốn
    // từng dòng hàng), chỉ đổi chiều gom: ngày giao × sàn. Ngày lấy theo giờ VN.
    const dayRows = await sql(`
      WITH cost_map(kind, key, unit) AS (VALUES ${costValues}),
      oi AS (
        SELECT
          po.id AS order_id,
          po.source AS platform,
          po.status,
          (po.pancake_created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS d,
          ${resolveSql("mi->'variation_info'->>'display_id'")} AS sp_code,
          upper(trim(COALESCE(mi->'variation_info'->>'name', mi->>'name', ''))) AS sp_name_up,
          COALESCE((mi->>'quantity')::numeric, 1) AS qty,
          (COALESCE((mi->'variation_info'->>'retail_price')::numeric, (mi->>'price')::numeric, 0)
            * COALESCE((mi->>'quantity')::numeric, 1)) AS retail_value,
          ${revenueExpr} AS order_revenue,
          ${feeExpr} AS fee_marketplace,
          ${listPriceExpr} AS list_price
        FROM pancake_order po
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(po.raw->'items', '[]'::jsonb)) AS mi
        WHERE po.deleted_at IS NULL
          ${platformFilter}
          ${marketFilter}
          AND po.pancake_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND po.pancake_created_at < (($2::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND po.raw->'items' IS NOT NULL
      ),
      oi2 AS (
        SELECT oi.*,
          COALESCE(
            (SELECT unit FROM cost_map c WHERE c.kind = 'accessory' AND c.key = oi.sp_name_up),
            (SELECT unit FROM cost_map c WHERE c.kind = 'name'   AND c.key = oi.sp_name_up),
            (SELECT unit FROM cost_map c WHERE c.kind = 'code'   AND c.key = upper(oi.sp_code)),
            (SELECT unit FROM cost_map c WHERE c.kind = 'prefix' AND c.key = (regexp_match(upper(oi.sp_code), '^(PHVVN[0-9]{2,3})'))[1]),
            0
          ) AS unit_cost
        FROM oi
      ),
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
        d::text AS date,
        platform,
        COUNT(DISTINCT order_id) FILTER (WHERE NOT ${excludeCond})::int AS total_orders,
        COUNT(DISTINCT order_id) FILTER (WHERE status = 3)::int AS da_nhan,
        COUNT(DISTINCT order_id) FILTER (WHERE status = 5)::int AS da_hoan,
        COUNT(DISTINCT order_id) FILTER (WHERE status = 4)::int AS dang_hoan,
        COUNT(DISTINCT order_id) FILTER (WHERE status IN (6, -1))::int AS da_huy,
        SUM(CASE WHEN status = 3 THEN order_revenue   * rev_share ELSE 0 END)::bigint AS revenue_delivered,
        SUM(CASE WHEN status = 3 THEN fee_marketplace * rev_share ELSE 0 END)::bigint AS fee_marketplace,
        SUM(CASE WHEN status = 3 THEN list_price      * rev_share ELSE 0 END)::bigint AS list_price,
        SUM(CASE WHEN status = 3 AND unit_cost > 0 THEN item_cost ELSE 0 END)::bigint AS cogs,
        SUM(CASE WHEN status = 3 AND unit_cost > 0 THEN order_revenue * rev_share ELSE 0 END)::bigint AS revenue_costed,
        SUM(CASE WHEN status = 3 AND unit_cost = 0 THEN order_revenue * rev_share ELSE 0 END)::bigint AS revenue_no_cost,
        COUNT(DISTINCT order_id) FILTER (WHERE status = 3 AND unit_cost > 0)::int AS orders_costed,
        SUM(CASE WHEN status = 3 THEN qty ELSE 0 END)::numeric AS delivered_qty,
        -- TẠM TÍNH: đơn đã xác nhận cho đi — 2 (đang giao), 3 (giao xong),
        -- 8 (đang đóng hàng). KHÔNG dự phóng theo tỷ lệ như báo cáo FB: đơn sàn hoàn
        -- rất ít nên coi đơn đang đi là sẽ nhận.
        -- Loại 0/1 (chưa cho đi) và 4/5/6/7/-1/-2 (hoàn/huỷ/xoá) — xem ghi chú status
        -- ở đầu file: code 6 = ĐÃ HỦY, không phải "đã gửi VC" như GLOSSARY ghi.
        COUNT(DISTINCT order_id) FILTER (WHERE status IN (2,3,8))::int AS orders_tt,
        SUM(CASE WHEN status IN (2,3,8) THEN order_revenue * rev_share ELSE 0 END)::bigint AS revenue_tt,
        SUM(CASE WHEN status IN (2,3,8) THEN fee_marketplace * rev_share ELSE 0 END)::bigint AS fee_tt,
        SUM(CASE WHEN status IN (2,3,8) AND unit_cost > 0 THEN item_cost ELSE 0 END)::bigint AS cogs_tt,
        SUM(CASE WHEN status IN (2,3,8) AND unit_cost > 0 THEN order_revenue * rev_share ELSE 0 END)::bigint AS revenue_costed_tt,
        COUNT(DISTINCT order_id) FILTER (WHERE status IN (2,3,8) AND unit_cost > 0)::int AS orders_costed_tt
      FROM oi3
      GROUP BY d, platform
      ORDER BY d DESC, platform
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

    // Chi phí quảng cáo sàn — nhập tay ở trang "Nhập chi phí" (bảng mkt_ads_cost_marketplace).
    // Sàn không có API spend nên đây là nguồn duy nhất. Điền theo (ngày, sàn) nên chỉ trừ
    // được ở mức TỔNG mỗi sàn, không quy về từng sản phẩm — dòng SP vì vậy vẫn là LNG
    // trước ads, còn thẻ tổng có thêm lng_sau_ads để biết sàn thực lãi/lỗ.
    let adsByPlatform: Record<string, number> = {}
    // Chi phí ads theo (ngày × sàn) — nhân sự điền theo từng shop, ở đây gộp các shop
    // cùng sàn vì doanh thu chưa tách được tới shop.
    const adsByDay: Record<string, number> = {}
    try {
      const adsRows = await sql(`
        SELECT date::text AS date, platform, SUM(cost)::bigint AS cost
          FROM mkt_ads_cost_marketplace
         WHERE deleted_at IS NULL AND date >= $1::date AND date <= $2::date
           AND market = $3
         GROUP BY date, platform
      `, [from, to, market])
      for (const r of adsRows) {
        const c = Number(r.cost) || 0
        adsByPlatform[String(r.platform)] = (adsByPlatform[String(r.platform)] ?? 0) + c
        adsByDay[`${r.date}||${r.platform}`] = c
      }
    } catch { /* bảng chưa tạo (chưa chạy migration) — coi như chưa có chi phí ads */ }

    const withAds = (t: any, ads: number) => ({
      ...t,
      ads_cost: ads,
      ads_pct: pct(ads, t.revenue_delivered),
      lng_sau_ads: t.lng - ads,
      lng_sau_ads_pct: pct(t.lng - ads, t.revenue_costed),
    })

    const byPlatform = ["tiktok", "shopee"].map(p => ({
      platform: p,
      platform_label: p === "tiktok" ? "TikTok Shop" : "Shopee",
      ...withAds(mkTotals(result.filter(r => r.platform === p)), adsByPlatform[p] ?? 0),
    })).filter(p => p.total_orders > 0)

    const totalAds = Object.values(adsByPlatform).reduce((s, v) => s + v, 0)
    const totals = withAds(mkTotals(result), totalAds)
    const hasAds = totalAds > 0
    // Cảnh báo mức phủ giá vốn — biết số LNG đang đại diện cho bao nhiêu % doanh thu.
    const coverage = {
      revenue_costed: totals.revenue_costed,
      revenue_no_cost: totals.revenue_no_cost,
      pct: pct(totals.revenue_costed, totals.revenue_costed + totals.revenue_no_cost),
      missing_products: result.filter(r => r.missing_cost).length,
    }

    // Bảng theo ngày: LNG trước ads (từ đơn) trừ chi phí ads đã điền cho đúng ngày × sàn.
    // ads_missing = ngày đó có đơn giao nhưng chưa ai điền chi phí — số lãi sẽ đẹp giả tạo,
    // nên đánh dấu để không đọc nhầm.
    const byDay = dayRows.map((r: any) => {
      const ff = FULLFILL_PER_ORDER * Number(r.orders_costed || 0)
      const revCosted = Number(r.revenue_costed || 0)
      const cogs = Number(r.cogs || 0)
      const lng = revCosted - (cogs + ff)
      const key = `${r.date}||${r.platform}`
      const ads = adsByDay[key] ?? 0
      const hasAdsEntry = Object.prototype.hasOwnProperty.call(adsByDay, key)
      const rev = Number(r.revenue_delivered || 0)

      // Tạm tính: gồm cả đơn đang trên đường. Ads trừ NGUYÊN (đã tiêu hết trong ngày),
      // chỉ doanh thu và giá vốn mở rộng theo đơn chưa giao xong.
      const ffTT = FULLFILL_PER_ORDER * Number(r.orders_costed_tt || 0)
      const revCostedTT = Number(r.revenue_costed_tt || 0)
      const cogsTT = Number(r.cogs_tt || 0)
      const lngTT = revCostedTT - (cogsTT + ffTT)
      const revTT = Number(r.revenue_tt || 0)

      // Doanh thu TRƯỚC phí sàn = tiền khách thực trả (đã trừ khuyến mãi, chưa trừ
      // phí sàn) = revenue + fee. KHÁC list_price — list_price là giá niêm yết, chưa
      // trừ khuyến mãi, nên %ads tính trên nó sẽ thấp hơn thực tế.
      const fee = Number(r.fee_marketplace || 0)
      const feeTT = Number(r.fee_tt || 0)
      const revGross = rev + fee
      const revGrossTT = revTT + feeTT

      return {
        date: r.date,
        platform: r.platform,
        platform_label: r.platform === "tiktok" ? "TikTok Shop" : "Shopee",
        total_orders: Number(r.total_orders || 0),
        da_nhan: Number(r.da_nhan || 0), da_hoan: Number(r.da_hoan || 0),
        dang_hoan: Number(r.dang_hoan || 0), da_huy: Number(r.da_huy || 0),
        delivered_qty: Number(r.delivered_qty || 0),
        list_price: Number(r.list_price || 0),
        fee_marketplace: Number(r.fee_marketplace || 0),
        fee_pct: pct(Number(r.fee_marketplace || 0), Number(r.list_price || 0)),
        revenue_delivered: rev,
        revenue_costed: revCosted,
        revenue_no_cost: Number(r.revenue_no_cost || 0),
        cogs, cogs_pct: pct(cogs, revCosted),
        fullfill: ff,
        lng, lng_pct: pct(lng, revCosted),
        ads_cost: ads, ads_pct: pct(ads, rev),
        ads_missing: !hasAdsEntry && Number(r.orders_tt || 0) > 0,
        lng_sau_ads: lng - ads,
        lng_sau_ads_pct: pct(lng - ads, revCosted),

        // Doanh thu trước phí sàn + %ads tính trên nó (mức thực)
        revenue_gross: revGross,
        ads_gross_pct: pct(ads, revGross),

        // Tạm tính (gồm đơn đang trên đường)
        orders_tt: Number(r.orders_tt || 0),
        revenue_tt: revTT,
        revenue_costed_tt: revCostedTT,
        fee_tt: feeTT,
        revenue_gross_tt: revGrossTT,
        ads_gross_pct_tt: pct(ads, revGrossTT),
        ads_pct_tt: pct(ads, revTT),
        cogs_tt: cogsTT,
        cogs_tt_pct: pct(cogsTT, revCostedTT),
        fullfill_tt: ffTT,
        lng_tt: lngTT,
        lng_tt_sau_ads: lngTT - ads,
        lng_tt_sau_ads_pct: pct(lngTT - ads, revCostedTT),
        // Số đơn đã rời kho nhưng chưa giao xong — càng lớn thì số "thực" càng
        // chưa phản ánh đủ, dùng để cảnh báo ngày quá mới.
        orders_pending: Number(r.orders_tt || 0) - Number(r.da_nhan || 0),
      }
    })

    return res.json({
      rows: result, by_platform: byPlatform, by_day: byDay,
      totals, coverage, has_ads: hasAds, market, from, to,
      // MY: mọi số tiền đã quy về VND theo tỷ giá này (VND/RM). VN: 1 (không quy đổi).
      myr_to_vnd_rate: market === "MY" ? rate : null,
    })
  } catch (err: any) {
    console.error("[report/marketplace-lng]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
