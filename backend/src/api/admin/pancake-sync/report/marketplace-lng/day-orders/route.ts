import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"
import { computeAvgCost, DISPLAY_ID_ALIASES, toVNDate } from "../../../../gia-von/avg-cost/route"
import { getMyrToVndRate } from "../../../../../../lib/db"
import { loadSkuMapCosts } from "../../_sku-map"

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

// Phải khớp marketplace-lng/route.ts — hai nơi lệch nhau thì dòng ngày và bảng
// chi tiết đơn của chính ngày đó ra hai số LNG khác nhau.
const FULLFILL_PER_ORDER = 6000

/**
 * GET /admin/pancake-sync/report/marketplace-lng/day-orders
 *      ?date=YYYY-MM-DD&platform=shopee|tiktok&market=VN|MY&mode=tt|thuc
 *
 * Drill-down cho 1 dòng của bảng "LNG theo ngày" ở tab Sàn TMĐT: liệt kê từng ĐƠN của
 * ngày đó với đúng các chỉ số bảng ngày đang hiển thị (giá vốn, DT trước phí sàn,
 * DT thực nhận, LNG).
 *
 * Mọi công thức bám sát ../route.ts để tổng ở đây khớp dòng ngày tương ứng:
 *  • doanh thu thực nhận = total_price_after_sub_discount (fallback cod_amount/total)
 *  • DT trước phí sàn    = thực nhận + fee_marketplace
 *  • giá vốn             = SKU khai tay → tên phụ kiện → tên SP → mã → prefix, × số lượng
 *  • fullfill            = 6.000đ/đơn, chỉ tính đơn đã tra được giá vốn
 *  • mode "thuc" chỉ status=3; mode "tt" gồm status 1,2,3,8 (đã xác nhận cho đi)
 *
 * ADS: sàn chỉ nhập chi phí theo (ngày × sàn), không có spend theo đơn. Ở đây CHIA
 * TRUNG BÌNH cho các đơn trong phạm vi mode (ads_cost_day / số đơn) — đúng theo yêu cầu
 * nhân sự. Là con số phân bổ, KHÔNG phải chi phí thật của từng đơn: 2 đơn cùng ngày
 * gánh ads bằng nhau dù giá trị khác nhau.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { date: dateRaw, platform: platformRaw, market: marketRaw, mode: modeRaw } =
      req.query as Record<string, string>

    if (!dateRaw) return res.status(400).json({ error: "Thiếu tham số 'date'" })
    const date = toVNDate(dateRaw)
    const market = String(marketRaw || "VN").toUpperCase() === "MY" ? "MY" : "VN"
    const mode = modeRaw === "thuc" ? "thuc" : "tt"
    // "thực" = chỉ đơn đã giao xong; "tạm tính" = thêm đơn đã xác nhận cho đi.
    const statusList = mode === "thuc" ? [3] : [1, 2, 3, 8]

    const avgCost = await computeAvgCost(getPool())

    const prodNames = await sql(`SELECT code, name FROM mkt_product WHERE active = true`)
    const codeToName: Record<string, string> = {}
    // Chiều ngược lại: cột K của cost_sheet có thể ghi TÊN sản phẩm thay vì mã (dữ liệu
    // cũ) — cần map tên -> mã, đúng như computeAvgCost() vẫn làm.
    const nameToCode: Record<string, string> = {}
    const codeSet = new Set<string>()
    for (const p of prodNames) {
      if (p.code) {
        const c = String(p.code).trim().toUpperCase()
        codeToName[c] = p.name
        codeSet.add(c)
      }
      if (p.name && p.code) nameToCode[String(p.name).trim().toUpperCase()] = String(p.code).trim().toUpperCase()
    }

    const aliasCases = Object.entries(DISPLAY_ID_ALIASES)
      .map(([f, t]) => `WHEN '${f}' THEN '${t}'`).join("\n          ")
    const resolveSql = (expr: string) => `
      CASE upper(trim(${expr}))
          ${aliasCases}
          ELSE upper(trim(${expr}))
      END`

    // Đơn MY lưu tiền bằng SEN — quy về VND ngay trong SQL (xem ../route.ts).
    const rate = market === "MY" ? await getMyrToVndRate(date) : 1
    const MONEY = market === "MY" ? `* ${rate} / 100.0` : ""

    // NULLIF ở CẢ 3 nấc — xem ghi chú ở ../route.ts: cod_amount/total NOT NULL default 0
    // nên COALESCE trần dừng ở cod_amount = 0, đơn sàn (khách trả trên app, cod = 0)
    // bị tính doanh thu = 0.
    const revenueExpr = `(COALESCE(
      NULLIF((raw->>'total_price_after_sub_discount')::numeric, 0),
      NULLIF(cod_amount::numeric, 0),
      NULLIF(total::numeric, 0),
      0
    ) ${MONEY})::bigint`
    const feeExpr = `(COALESCE((raw->>'fee_marketplace')::numeric, 0) ${MONEY})::bigint`
    const listPriceExpr = `(COALESCE((raw->>'total_price')::numeric, 0) ${MONEY})::bigint`

    const platform = ["shopee", "tiktok"].includes(String(platformRaw)) ? String(platformRaw) : null
    const platformFilter = platform ? `AND po.source = '${platform}'` : `AND po.source IN ('shopee','tiktok')`

    // Giá vốn phụ kiện bán lẻ đọc thẳng từ cost_sheet — giống ../route.ts, vì trên sàn
    // giẻ lau bán lẻ 39.000đ không được gánh giá vốn 226.540đ của cả bộ lau nhà.
    const sheetCols = await sql(`SELECT id, position FROM cost_sheet_column ORDER BY position`)
    const sheetRows = await sql(`SELECT position, data FROM cost_sheet_row ORDER BY position`)
    const accessoryCost: Record<string, number> = {}
    // Phụ kiện tra thêm theo MÃ ở cột K: phụ kiện bán lẻ trên sàn về với mã riêng
    // (vd PHVVN008_GLNTV "giẻ lau nhà phun sương") mà computeAvgCost chỉ đưa dòng
    // "Sản phẩm chính" vào costs — thiếu map này thì tra theo mã trượt, báo thiếu giá vốn.
    const accessoryByCode: Record<string, number> = {}
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
        if (gia <= 0) continue
        accessoryCost[ten.toUpperCase()] = Math.round(gia)
        // Đánh chỉ mục dòng phụ kiện theo MÃ CỦA CHÍNH NÓ trong danh mục, tra bằng TÊN
        // dòng. KHÔNG dùng cột K: cột đó trỏ tới SP CHÍNH mà phụ kiện đi kèm (dòng "giẻ
        // lau nhà phun sương" ghi K = "CÂY LAU NHÀ TỰ VẮT PHUN SƯƠNG"), nên lấy theo K sẽ
        // ra mã cây lau nhà — sai món. Trên sàn giẻ BÁN RIÊNG với mã PHVVN008_GLNTV và
        // phải lấy giá của chính cái giẻ; chỉ khi đi kèm SP chính mới tính gộp vào bộ.
        const tenUp = ten.toUpperCase()
        const maPK = codeSet.has(tenUp) ? tenUp : (nameToCode[tenUp] ?? "")
        // Chỉ ghi khi mã chưa có chủ — không đè giá vốn của sản phẩm chính cùng mã.
        if (maPK && accessoryByCode[maPK] == null) accessoryByCode[maPK] = Math.round(gia)
      }
    }

    // SKU sàn khai tay ở tab "Khớp SP sàn" — tra TRƯỚC mọi nấc tự động (giống ../route.ts).
    const skuMapCost = await loadSkuMapCosts(getPool(), avgCost, accessoryCost, accessoryByCode)

    const costEntries = [
      ...Object.entries(skuMapCost).map(([k, v]) => ["skumap", k, v] as const),
      ...Object.entries(accessoryCost).map(([k, v]) => ["accessory", k, v] as const),
      ...Object.entries(accessoryByCode).map(([k, v]) => ["acccode", k, v] as const),
      ...Object.entries(avgCost.costs).map(([k, v]) => ["code", k, v] as const),
      ...Object.entries(avgCost.byPrefix).map(([k, v]) => ["prefix", k, v] as const),
      ...Object.entries(avgCost.byName).map(([k, v]) => ["name", k, v] as const),
    ]
    const costValues = costEntries.length
      ? costEntries.map(([kind, key, val]) =>
          `('${kind}', '${String(key).replace(/'/g, "''")}', ${Number(val) || 0})`).join(",")
      : `('code', '__none__', 0)`

    // Mỗi dòng = 1 dòng hàng của 1 đơn. Gộp về đơn ở JS để trả kèm danh sách SP.
    const itemRows = await sql(`
      WITH cost_map(kind, key, unit) AS (VALUES ${costValues}),
      oi AS (
        SELECT
          po.id AS order_id,
          -- po.id lưu raw.system_id (số 76xxx) — KHÔNG tìm được trên POS. Ô tìm kiếm
          -- của POS dùng raw.id (số 58xxxxxx, đơn có ổ khoá trong danh sách) và mã đơn
          -- của sàn. Trả cả 3 để nhân sự copy đúng cái tra được.
          po.raw->>'id' AS pos_id,
          po.source AS platform,
          po.status,
          po.status_name,
          po.customer_name,
          po.province,
          po.shop_name,
          po.tracking_code,
          (po.pancake_created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS created_at_vn,
          ${resolveSql("mi->'variation_info'->>'display_id'")} AS sp_code,
          upper(trim(COALESCE(mi->'variation_info'->>'name', mi->>'name', ''))) AS sp_name_up,
          COALESCE(mi->'variation_info'->>'name', mi->>'name', 'CHƯA RÕ SP') AS sp_label,
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
          AND COALESCE(NULLIF(po.market, ''), 'VN') = '${market}'
          AND po.status = ANY($2::int[])
          AND po.pancake_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND po.pancake_created_at < (($1::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND po.raw->'items' IS NOT NULL
      ),
      oi2 AS (
        SELECT oi.*,
          COALESCE(
            (SELECT unit FROM cost_map c WHERE c.kind = 'skumap' AND c.key = oi.sp_name_up),
            (SELECT unit FROM cost_map c WHERE c.kind = 'skumap' AND c.key = upper(oi.sp_code)),
            (SELECT unit FROM cost_map c WHERE c.kind = 'accessory' AND c.key = oi.sp_name_up),
            (SELECT unit FROM cost_map c WHERE c.kind = 'name'   AND c.key = oi.sp_name_up),
            (SELECT unit FROM cost_map c WHERE c.kind = 'code'   AND c.key = upper(oi.sp_code)),
            -- Mã của dòng PHỤ KIỆN trong cost_sheet — sau 'code' để SP chính ưu tiên hơn.
            (SELECT unit FROM cost_map c WHERE c.kind = 'acccode' AND c.key = upper(oi.sp_code)),
            (SELECT unit FROM cost_map c WHERE c.kind = 'prefix' AND c.key = (regexp_match(upper(oi.sp_code), '^(PHVVN[0-9]{2,3})'))[1]),
            0
          ) AS unit_cost
        FROM oi
      )
      SELECT oi2.*,
        (unit_cost * qty) AS item_cost,
        CASE WHEN SUM(retail_value) OVER (PARTITION BY order_id) > 0
          THEN retail_value / SUM(retail_value) OVER (PARTITION BY order_id)
          ELSE 1.0 / COUNT(*) OVER (PARTITION BY order_id)
        END AS rev_share
      FROM oi2
      ORDER BY order_id
    `, [date, statusList])

    // Chi phí ads của ngày. Tách 2 loại:
    //  • Điền THEO SẢN PHẨM (product_code <> '') — phân bổ đúng vào đơn chứa SP đó.
    //  • Điền ở MỨC SHOP (product_code = '') — chia đều cho phần đơn còn lại, như cũ.
    // Chia đều toàn bộ là sai: đơn 28.000đ và đơn 55.000đ gánh ads bằng nhau nên đơn nhỏ
    // luôn hiện lỗ giả. Nhân sự điền theo SP tới đâu thì chính xác tới đó.
    let adsDay = 0
    let hasAdsEntry = false
    const adsByProduct: Record<string, number> = {}
    let adsShopLevel = 0
    try {
      const adsRows = await sql(`
        SELECT COALESCE(product_code, '') AS product_code, SUM(cost)::bigint AS cost
          FROM mkt_ads_cost_marketplace
         WHERE deleted_at IS NULL AND date = $1::date AND market = $2
           ${platform ? `AND platform = '${platform}'` : `AND platform IN ('shopee','tiktok')`}
         GROUP BY 1
      `, [date, market])
      for (const r of adsRows) {
        const c = Number(r.cost) || 0
        adsDay += c
        hasAdsEntry = true
        const code = String(r.product_code || "").trim().toUpperCase()
        if (code) adsByProduct[code] = (adsByProduct[code] ?? 0) + c
        else adsShopLevel += c
      }
    } catch { /* bảng chưa tạo / chưa có cột product_code — coi như chưa có chi phí ads */ }

    // Gộp dòng hàng về đơn.
    const orders: Record<string, any> = {}
    for (const r of itemRows) {
      const id = String(r.order_id)
      if (!orders[id]) {
        orders[id] = {
          order_id: id,
          pos_id: r.pos_id ? String(r.pos_id) : null,
          platform: r.platform,
          platform_label: r.platform === "tiktok" ? "TikTok Shop" : "Shopee",
          status: Number(r.status),
          status_name: r.status_name || "",
          customer_name: r.customer_name || "",
          province: r.province || "",
          shop_name: r.shop_name || "",
          tracking_code: r.tracking_code || "",
          created_at: r.created_at_vn,
          // Tiền cấp ĐƠN — mọi dòng hàng của cùng đơn mang cùng giá trị, lấy 1 lần
          // là đủ (cộng dồn theo dòng sẽ nhân lên số lần bằng số SP trong đơn).
          revenue: Number(r.order_revenue || 0),
          fee_marketplace: Number(r.fee_marketplace || 0),
          list_price: Number(r.list_price || 0),
          cogs: 0,
          revenue_costed: 0,
          revenue_no_cost: 0,
          qty: 0,
          has_cost: true,
          items: [] as any[],
        }
      }
      const o = orders[id]
      const share = Number(r.rev_share || 0)
      const itemRev = Math.round(Number(r.order_revenue || 0) * share)
      const itemCost = Number(r.item_cost || 0)
      const hasCost = Number(r.unit_cost || 0) > 0
      if (hasCost) {
        o.cogs += itemCost
        o.revenue_costed += itemRev
      } else {
        o.has_cost = false
        o.revenue_no_cost += itemRev
      }
      o.qty += Number(r.qty || 0)
      const code = r.sp_code ? String(r.sp_code).toUpperCase() : null
      o.items.push({
        sp_code: code,
        sp_label: (code && codeToName[code]) || r.sp_label,
        qty: Number(r.qty || 0),
        unit_cost: Number(r.unit_cost || 0),
        item_cost: itemCost,
        revenue: itemRev,
        missing_cost: !hasCost,
      })
    }

    const list = Object.values(orders)

    // ── PHÂN BỔ CHI PHÍ ADS ────────────────────────────────────────────────────
    // Ads điền theo SP được chia cho các đơn chứa SP đó, theo SỐ LƯỢNG SP trong đơn
    // (đơn mua 2 cái gánh gấp đôi đơn mua 1 cái — sát thực tế hơn chia theo đầu đơn).
    // Phần điền ở mức shop chia đều cho các đơn KHÔNG chứa SP nào đã điền riêng: nếu
    // chia cho tất cả thì đơn đã có ads riêng bị tính 2 lần.
    // Chi phí điền theo SP được lưu theo PREFIX (PHVVN043), còn dòng hàng mang mã biến
    // thể đầy đủ (PHVVN043_CCX01/_CCX02). Quy mã dòng hàng về prefix để khớp — nhờ vậy
    // mọi biến thể/combo của cùng một SP dùng chung khoản chi phí đã điền.
    const adsKeyOf = (code: string | null): string | null => {
      if (!code) return null
      const c = String(code).toUpperCase()
      if (adsByProduct[c] != null) return c            // điền bằng mã đầy đủ (dữ liệu cũ)
      const m = c.match(/^(PHVVN\d{2,3})/)
      return m && adsByProduct[m[1]] != null ? m[1] : null
    }

    const qtyByProduct: Record<string, number> = {}
    for (const o of list as any[]) {
      for (const it of o.items) {
        const k = adsKeyOf(it.sp_code)
        if (k) qtyByProduct[k] = (qtyByProduct[k] ?? 0) + it.qty
      }
    }
    // Đơn "chưa được ads riêng chạm tới" — nhóm sẽ gánh phần chi phí mức shop.
    const ordersForShopLevel = (list as any[]).filter(
      o => !o.items.some((it: any) => adsKeyOf(it.sp_code)))
    const shopLevelPerOrder = ordersForShopLevel.length > 0
      ? adsShopLevel / ordersForShopLevel.length
      : 0

    const adsOfOrder = (o: any): number => {
      let sum = 0
      for (const it of o.items) {
        const k = adsKeyOf(it.sp_code)
        if (k && qtyByProduct[k] > 0) {
          sum += adsByProduct[k] * (it.qty / qtyByProduct[k])
        }
      }
      // Đơn không dính SP nào có ads riêng thì nhận suất chi phí mức shop.
      if (sum === 0) sum = shopLevelPerOrder
      return Math.round(sum)
    }

    // SP có điền chi phí ads nhưng NGÀY ĐÓ không bán được cái nào. Tiền này không
    // đơn nào gánh, nên tổng các dòng đơn sẽ thấp hơn dòng ngày đúng bằng khoản đó —
    // và quan trọng hơn: đó là tín hiệu camp đốt tiền không ra đơn, phải nói ra chứ
    // không dồn sang đơn của SP khác gánh hộ.
    const adsNoOrder = Object.entries(adsByProduct)
      .filter(([code]) => !(qtyByProduct[code] > 0))
      .map(([code, cost]) => ({
        product_code: code,
        product_name: codeToName[code] || null,
        ads_cost: Number(cost) || 0,
      }))
      .sort((a, b) => b.ads_cost - a.ads_cost)
    const adsUnallocated = adsNoOrder.reduce((s, r) => s + r.ads_cost, 0)

    const pct = (part: number, whole: number) => whole > 0 ? Math.round(part / whole * 10000) / 100 : null

    const result = list.map((o: any) => {
      const adsPerOrder = adsOfOrder(o)
      // Fullfill 6.000đ chỉ tính cho đơn đã tra được giá vốn — giống bảng ngày, để
      // đơn chưa khai vốn không tạo ra khoản lỗ ảo.
      const fullfill = o.revenue_costed > 0 ? FULLFILL_PER_ORDER : 0
      const lng = o.revenue_costed - (o.cogs + fullfill)
      const revenueGross = o.revenue + o.fee_marketplace
      return {
        ...o,
        revenue_gross: revenueGross,
        fee_pct: pct(o.fee_marketplace, o.list_price),
        cogs_pct: pct(o.cogs, o.revenue_costed),
        fullfill,
        lng,
        lng_pct: pct(lng, o.revenue_costed),
        ads_cost: adsPerOrder,
        ads_gross_pct: pct(adsPerOrder, revenueGross),
        lng_sau_ads: lng - adsPerOrder,
        lng_sau_ads_pct: pct(lng - adsPerOrder, o.revenue_costed),
        missing_cost: !o.has_cost,
      }
    }).sort((a: any, b: any) => b.revenue_gross - a.revenue_gross)

    const sum = (k: string) => result.reduce((s: number, r: any) => s + (Number(r[k]) || 0), 0)
    const revCosted = sum("revenue_costed")
    const cogs = sum("cogs")
    const ff = sum("fullfill")
    const lng = revCosted - (cogs + ff)
    // Ads tổng = số đã nhập cho cả ngày, KHÔNG phải adsPerOrder × số đơn (làm tròn
    // từng đơn có thể lệch vài đồng so với tổng thật).
    const totals = {
      orders: result.length,
      qty: sum("qty"),
      list_price: sum("list_price"),
      fee_marketplace: sum("fee_marketplace"),
      revenue: sum("revenue"),
      revenue_gross: sum("revenue_gross"),
      revenue_costed: revCosted,
      revenue_no_cost: sum("revenue_no_cost"),
      cogs, cogs_pct: pct(cogs, revCosted),
      fullfill: ff,
      lng, lng_pct: pct(lng, revCosted),
      ads_cost: adsDay,
      ads_gross_pct: pct(adsDay, sum("revenue_gross")),
      lng_sau_ads: lng - adsDay,
      lng_sau_ads_pct: pct(lng - adsDay, revCosted),
    }

    return res.json({
      date, platform, market, mode,
      orders: result,
      totals,
      ads_cost_day: adsDay,
      // Số đơn có ads riêng theo SP vs phần còn lại chia đều — để UI nói rõ đang
      // dùng cách nào, tránh hiểu nhầm mọi đơn đều là số phân bổ thô.
      ads_by_product: adsShopLevel < adsDay,
      ads_product_count: Object.keys(adsByProduct).length,
      ads_shop_level: adsShopLevel,
      ads_per_order: ordersForShopLevel.length > 0 ? Math.round(shopLevelPerOrder) : 0,
      ads_missing: !hasAdsEntry,
      // Cảnh báo: SP có ads mà không ra đơn nào trong ngày.
      ads_no_order: adsNoOrder,
      ads_unallocated: adsUnallocated,
      myr_to_vnd_rate: market === "MY" ? rate : null,
    })
  } catch (err: any) {
    console.error("[report/marketplace-lng/day-orders]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
