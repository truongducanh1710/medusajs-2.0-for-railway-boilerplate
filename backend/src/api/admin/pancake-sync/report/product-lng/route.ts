import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"
import { computeAvgCost, lookupCost, resolveDisplayId, DISPLAY_ID_ALIASES, toVNDate } from "../../../gia-von/avg-cost/route"

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
      from: fromRaw = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
      to: toRaw = new Date().toISOString().slice(0, 10),
      market,
    } = req.query as Record<string, string>

    // Chuẩn hoá về NGÀY LỊCH VN (xem toVNDate) — tránh lệch sớm 1 ngày khi frontend gửi ISO.
    const from = toVNDate(fromRaw)
    const to = toVNDate(toRaw)

    // Báo cáo này chưa hỗ trợ market ngoài VN (COGS/fullfill chỉ đúng cho VN)
    if (market && market !== "VN") {
      return res.json({ not_supported: true, market, rows: [], totals: {} })
    }

    // ── Bảng giá vốn TB (code → giá, tên → giá) ─────────────────────────────────
    const avgCost = await computeAvgCost(getPool())

    // Tên SP chuẩn theo code (để hiển thị thay vì tên item tự do, vd "Giẻ..." vs "Bộ...").
    const prodNames = await sql(`SELECT code, name FROM mkt_product WHERE active = true`)
    const codeToName: Record<string, string> = {}
    const codeSet = new Set<string>()
    for (const p of prodNames) {
      if (p.code) {
        const c = String(p.code).trim().toUpperCase()
        codeToName[c] = p.name
        codeSet.add(c)
      }
    }

    // ── Chi phí Ads gán về từng SP ─────────────────────────────────────────────
    // Attribution (tương đối, đủ để biết SP lãi/lỗ):
    //   1) Camp có mã SP ở ĐẦU tên (vd "PHVVN026CV_...") → gán trực tiếp cho SP đó.
    //      Tên camp viết mã LIỀN (PHVVN026CV) còn mã chuẩn có gạch (PHVVN026_CV) → chuẩn hoá
    //      bằng cách bỏ hết gạch/space rồi so khớp codeSet.
    //   2) Camp KHÔNG có mã đầu tên → gom vào "chưa phân bổ", rồi CHIA theo tỷ lệ % chi phí
    //      của phần đã map (SP tiêu ads nhiều gánh nhiều hơn) → 100% ads được phân bổ.
    const stripKey = (s: string) => s.replace(/[_\s]/g, "").toUpperCase()
    const stripToCode: Record<string, string> = {}
    for (const c of codeSet) stripToCode[stripKey(c)] = c
    const reHead = /^(PHVVN\d{2,3}[A-ZĐ]*)/i

    // Sửa mã SP bị MKT đặt nhầm khi tạo camp trên Facebook. Đổi tên camp bên FB không sửa
    // được dữ liệu ads ĐÃ sync, nên chặn ngay ở bước gán chi phí: camp khớp `when` (mã sai
    // + dấu hiệu nhận biết trong tên) sẽ được quy về `to` là mã đúng.
    //
    // Case T7-T8/2026: 10 camp mang tiền tố PHVVN033NCDTMS (NỒI CHỐNG DÍNH TRÁNG MEN SỨ)
    // nhưng tên camp ghi rõ "NỒI SỨ" và thực chất chạy cho NỒI SỨ HOA VĂN (PHVVN044_NS).
    // Hậu quả trước khi sửa: PHVVN033 gánh 13,5tr ads dù bán 0 sản phẩm → LNG -16,9tr,
    // còn NỒI SỨ được báo lãi ảo vì không phải chịu phần ads của chính nó.
    const CAMPAIGN_CODE_FIXES: { when: RegExp; to: string }[] = [
      { when: /^PHVVN033NCDTMS.*NỒI\s*SỨ/i, to: "PHVVN044_NS" },
    ]

    const adsRows = await sql(`
      SELECT campaign_name, SUM(spend)::bigint AS spend
      FROM mkt_ads_cost
      WHERE deleted_at IS NULL AND date >= $1::date AND date <= $2::date
      GROUP BY campaign_name
    `, [from, to])

    const adsDirect: Record<string, number> = {}  // code → spend (map trực tiếp)
    let adsUnassigned = 0                          // spend camp không có mã đầu tên
    let adsMappedTotal = 0
    for (const r of adsRows) {
      const spend = Number(r.spend) || 0
      const name = String(r.campaign_name || "")
      const fix = CAMPAIGN_CODE_FIXES.find(f => f.when.test(name))
      const m = name.match(reHead)
      const code = fix ? fix.to : (m ? stripToCode[stripKey(m[1])] : undefined)
      if (code) {
        adsDirect[code] = (adsDirect[code] || 0) + spend
        adsMappedTotal += spend
      } else {
        adsUnassigned += spend
      }
    }
    // adsByCode = trực tiếp + phần chưa phân bổ chia theo tỷ lệ % của phần đã map.
    const adsByCode: Record<string, number> = {}
    for (const [code, direct] of Object.entries(adsDirect)) {
      const share = adsMappedTotal > 0 ? direct / adsMappedTotal : 0
      adsByCode[code] = Math.round(direct + adsUnassigned * share)
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

    // Bảng giá vốn đẩy vào SQL để xác định SP chính + tính vốn cả đơn ngay trong query.
    // Khớp theo thứ tự của lookupCost(): code đầy đủ → prefix PHVVN### → tên SP.
    const costEntries = [
      ...Object.entries(avgCost.costs).map(([k, v]) => ["code", k, v] as const),
      ...Object.entries(avgCost.byPrefix).map(([k, v]) => ["prefix", k, v] as const),
      ...Object.entries(avgCost.byName).map(([k, v]) => ["name", k, v] as const),
    ]
    const costValues = costEntries.length
      ? costEntries.map(([kind, key, val]) =>
          `('${kind}', '${String(key).replace(/'/g, "''")}', ${Number(val) || 0})`).join(",")
      : `('code', '__none__', 0)`

    // ── Query: explode item, gom theo (đơn, SP) rồi group theo SP ───────────────
    // Nguyên tắc (theo cách nhìn của người kinh doanh): 1 đơn = 1 SP chính.
    //   • Doanh thu: GÁN TRỌN số tiền khách trả cho SP chính, KHÔNG chia theo giá niêm yết.
    //     Giá niêm yết không phản ánh giá bán thật (combo giảm 36-40%), chia theo nó khiến
    //     SP chính mất doanh thu về tay SP tặng kèm → %giá vốn phồng giả (nồi sứ 53% vs 44,5% thật).
    //   • Giá vốn: cộng vốn TOÀN BỘ item trong đơn (gồm cả SP tặng kèm) vào SP chính.
    //   • Ship/fullfill/đếm đơn: cũng gán trọn SP chính → 1 đơn chỉ đếm 1 lần.
    // SP chính = item có (GIÁ VỐN × SL) cao nhất đơn, KHÔNG dùng giá niêm yết:
    // hàng tặng kèm luôn có vốn thấp hơn hàng bán chính, nên tiêu chí này đúng bản chất hơn
    // và không lệ thuộc vào giá niêm yết/khuyến mãi. Đã đối chiếu T8/2026: trong 127 đơn
    // nhiều SP tính được vốn, hai tiêu chí cho CÙNG kết quả (0 đơn khác), và dùng giá vốn
    // còn khử được ca hoà giá trị (1 đơn từng bị đếm 2 lần vì 2 SP cùng giá niêm yết cao nhất).
    // Tie-break bằng sp_key để mỗi đơn luôn chốt đúng 1 SP chính duy nhất.
    const rows = await sql(`
      WITH cost_map(kind, key, unit) AS (VALUES ${costValues}),
      oi AS (
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
          COALESCE((po.raw->>'partner_fee')::numeric, 0) AS partner_fee
        FROM pancake_order po
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(po.raw->'items', '[]'::jsonb)) AS mi
        WHERE po.deleted_at IS NULL
          AND po.source IN ('manual', 'facebook', 'medusa', 'unknown', 'webcake')
          AND po.pancake_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND po.pancake_created_at < (($2::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND po.raw->'items' IS NOT NULL
      ),
      -- gán sp_key + giá vốn đơn vị cho từng item (khớp code → prefix → tên, như lookupCost)
      oi2 AS (
        SELECT
          oi.*,
          COALESCE(NULLIF(sp_code, ''), sp_name_up, 'CHƯA RÕ SP') AS sp_key,
          COALESCE(
            (SELECT unit FROM cost_map c WHERE c.kind = 'code'   AND c.key = upper(oi.sp_code)),
            (SELECT unit FROM cost_map c WHERE c.kind = 'prefix' AND c.key = (regexp_match(upper(oi.sp_code), '^(PHVVN[0-9]{2,3})'))[1]),
            (SELECT unit FROM cost_map c WHERE c.kind = 'name'   AND c.key = oi.sp_name_up),
            0
          ) AS unit_cost
        FROM oi
      ),
      -- Giá trị vốn từng item + tổng vốn cả đơn (dùng chọn SP chính và gán vốn trọn đơn)
      oi3 AS (
        SELECT
          oi2.*,
          (unit_cost * qty) AS item_cost,
          SUM(unit_cost * qty) OVER (PARTITION BY order_id) AS order_total_cost,
          SUM(item_value)     OVER (PARTITION BY order_id) AS order_total_value,
          -- SP chính = vốn cao nhất; hoà thì lấy sp_key nhỏ nhất để chốt duy nhất 1 SP
          (ROW_NUMBER() OVER (
            PARTITION BY order_id
            ORDER BY (unit_cost * qty) DESC, item_value DESC, COALESCE(NULLIF(sp_code, ''), sp_name_up, 'CHƯA RÕ SP') ASC
          )) AS cost_rank
        FROM oi2
      ),
      -- Quà tặng của đơn = item giá 0 trong đơn CÓ ít nhất 1 item bán.
      -- Giữ lại để hiển thị chi tiết combo (gift_detail) — giá vốn quà giờ đã nằm trong
      -- order_total_cost nên KHÔNG cộng lại lần nữa ở JS (tránh tính đôi).
      gifts AS (
        SELECT
          order_id,
          jsonb_agg(jsonb_build_object(
            'code', NULLIF(sp_code, ''),
            'name', sp_name_up,
            'qty',  qty,
            'unit', unit_cost
          )) AS gift_items
        FROM oi3
        WHERE item_value = 0 AND order_total_value > 0
        GROUP BY order_id
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
          -- SP chính (vốn cao nhất đơn) nhận TRỌN doanh thu + TRỌN vốn cả đơn; SP phụ nhận 0.
          bool_or(cost_rank = 1) AS is_main,
          CASE WHEN bool_or(cost_rank = 1) THEN MAX(order_revenue) ELSE 0 END AS sp_revenue,
          CASE WHEN bool_or(cost_rank = 1) THEN MAX(order_total_cost) ELSE 0 END AS sp_cost,
          SUM(qty) AS sp_qty,
          MAX(partner_fee) AS partner_fee,
          -- Quà tặng của đơn (chỉ gắn vào SP chính, dùng để hiển thị chi tiết)
          (array_agg(g.gift_items))[1] AS gift_items
        FROM oi3
        LEFT JOIN gifts g USING (order_id)
        GROUP BY order_id, sp_key
      )
      SELECT
        sp_key,
        MAX(sp_label) AS sp_label,
        MAX(sp_code)  AS sp_code,
        COUNT(*) FILTER (WHERE is_main AND status NOT IN (-2) AND NOT ${excludeCond})::int AS total_orders,
        SUM(CASE WHEN status NOT IN (-2) AND NOT ${excludeCond} THEN sp_revenue ELSE 0 END)::bigint AS revenue_total,
        SUM(CASE WHEN status = 3 AND NOT ${excludeCond} THEN sp_revenue ELSE 0 END)::bigint AS revenue_delivered,
        -- DT đơn còn treo (chưa chốt: mới/xác nhận/đóng hàng/chờ chuyển/gửi hàng/chờ hàng)
        -- dùng cho công thức tạm tính B (ước lượng phần chưa ngã ngũ).
        SUM(CASE WHEN status IN (0, 1, 2, 8, 9, 11) AND NOT ${excludeCond} THEN sp_revenue ELSE 0 END)::bigint AS revenue_treo,
        SUM(CASE WHEN is_main AND status NOT IN (-2) AND NOT ${excludeCond} THEN partner_fee ELSE 0 END)::bigint AS ship_cost,
        -- Doanh thu của ĐÚNG TẬP ĐƠN đã phát sinh phí ship (đơn đã rời kho: đang giao,
        -- đã nhận, hoàn). Dùng làm mẫu số cho %VC — chia cho revenue_delivered là hai vế
        -- khác tập và %VC bị thổi lên khi nhiều đơn còn đang trên đường.
        SUM(CASE WHEN status IN (2, 3, 4, 5, 8) AND NOT ${excludeCond} THEN sp_revenue ELSE 0 END)::bigint AS revenue_shipped,
        SUM(CASE WHEN status = 3 AND NOT ${excludeCond} THEN sp_qty ELSE 0 END)::numeric AS delivered_qty,
        -- Giá vốn TRỌN ĐƠN của các đơn đã nhận mà SP này là SP chính (đã gồm SP tặng kèm).
        SUM(CASE WHEN status = 3 AND NOT ${excludeCond} THEN sp_cost ELSE 0 END)::bigint AS cogs_order,
        -- Chi tiết quà tặng kèm (chỉ để hiển thị) — giá vốn quà ĐÃ nằm trong cogs_order.
        COALESCE(jsonb_agg(gift_items) FILTER (
          WHERE is_main AND status = 3 AND NOT ${excludeCond} AND gift_items IS NOT NULL
        ), '[]'::jsonb) AS gift_agg,
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
          total_orders: 0, main_orders: 0, revenue_total: 0, revenue_delivered: 0, revenue_treo: 0,
          revenue_shipped: 0, ship_cost: 0,
          delivered_qty: 0, cogs_order: 0, da_nhan: 0, da_hoan: 0, dang_hoan: 0, da_huy: 0,
          don_nhap_trung: 0, da_xoa: 0, da_gui_hang: 0, moi: 0, cho_hang: 0,
          da_xac_nhan: 0, dang_dong_hang: 0, cho_chuyen_hang: 0,
          gift_qty: {} as Record<string, { qty: number; label: string; unit: number | null }>,
        }
      }
      const g = merged[key]
      for (const k of ["total_orders", "main_orders", "revenue_total", "revenue_delivered", "revenue_treo",
        "revenue_shipped", "ship_cost",
        "delivered_qty", "cogs_order", "da_nhan", "da_hoan", "dang_hoan", "da_huy", "don_nhap_trung",
        "da_xoa", "da_gui_hang", "moi", "cho_hang", "da_xac_nhan", "dang_dong_hang",
        "cho_chuyen_hang"]) {
        g[k] += Number(row[k] ?? 0)
      }
      // Gom quà tặng: gift_agg = mảng-của-mảng (mỗi đơn 1 mảng item quà) → cộng SL theo mã quà.
      for (const perOrder of (row.gift_agg ?? [])) {
        for (const gi of (perOrder ?? [])) {
          const code = gi?.code ? String(gi.code).trim().toUpperCase() : null
          const label = gi?.name ? String(gi.name) : "CHƯA RÕ SP"
          const gkey = code || `NAME:${label.toUpperCase()}`
          const gunit = gi?.unit != null ? Number(gi.unit) : null
          if (!g.gift_qty[gkey]) g.gift_qty[gkey] = { qty: 0, label, unit: gunit }
          g.gift_qty[gkey].qty += Number(gi?.qty ?? 0)
        }
      }
    }

    const pct = (part: number, whole: number) => whole > 0 ? Math.round(part / whole * 10000) / 100 : null

    // DỰ KIẾN HOÀN HỦY — thay giả định "1/3 đơn đang giao sẽ hoàn" bằng tỷ lệ hoàn THẬT.
    // Tỷ lệ hoàn thực tế của kênh ổn định quanh 10–12,6% suốt tháng 4–8, nên 1/3 (33,3%)
    // thổi con số lên gấp ba: đầu tháng khi phần lớn đơn còn đang giao, DKHH bị đội và
    // doanh thu tạm tính bị cắt oan, khiến bảng tạm tính không dùng được.
    // Mỗi SP dùng tỷ lệ hoàn của CHÍNH NÓ trong kỳ; chưa đủ đơn đã chốt thì lùi về tỷ lệ
    // chung của kỳ, và nếu kỳ cũng chưa đủ thì về mức mặc định.
    const MIN_DON_CHOT = 20
    const TY_LE_HOAN_MAC_DINH = 0.11
    // Tỷ lệ hoàn CHUNG của kỳ — tính trước vòng map vì mỗi dòng SP có thể phải lùi về nó.
    const grpAll = Object.values(merged) as any[]
    const chotAll = grpAll.reduce((a, g) => a + g.da_nhan + g.da_hoan + g.dang_hoan, 0)
    const hoanAll = grpAll.reduce((a, g) => a + g.da_hoan + g.dang_hoan, 0)
    const tyLeHoanChung = chotAll >= MIN_DON_CHOT ? hoanAll / chotAll : TY_LE_HOAN_MAC_DINH

    const result = Object.entries(merged).map(([key, g]: [string, any]) => {
      // Giá vốn = vốn TRỌN ĐƠN của các đơn đã nhận mà SP này là SP chính (tính sẵn trong SQL,
      // đã gồm cả SP tặng kèm). Không nhân lại unit × delivered_qty vì đơn combo còn có
      // vốn của SP phụ đi kèm — nhân lại sẽ bỏ sót phần đó.
      const cogs = Math.round(Number(g.cogs_order) || 0)

      // ── Tách phần vốn của quà tặng kèm (chỉ để hiển thị "combo ăn bao nhiêu vào lãi") ──
      // Số này ĐÃ nằm trong cogs ở trên, không cộng thêm lần nữa.
      let cogs_gift = 0
      const gift_detail: { label: string; qty: number; unit_cost: number | null; cost: number }[] = []
      for (const [gkey, gv] of Object.entries(g.gift_qty as Record<string, { qty: number; label: string; unit: number | null }>)) {
        const gcode = gkey.startsWith("NAME:") ? null : gkey
        const gunit = gv.unit != null && gv.unit > 0 ? gv.unit : lookupCost(avgCost, gcode, gv.label)
        const gcost = gunit != null ? Math.round(gunit * gv.qty) : 0
        cogs_gift += gcost
        gift_detail.push({ label: gv.label, qty: gv.qty, unit_cost: gunit, cost: gcost })
      }
      gift_detail.sort((a, b) => b.cost - a.cost)
      // Quà chưa khai giá vốn → hiện cảnh báo thay vì âm thầm tính 0 (làm LNG đẹp giả).
      const gift_missing_cost = gift_detail.filter(d => d.unit_cost == null || d.unit_cost === 0).map(d => d.label)
      const cogs_sp = Math.max(0, cogs - cogs_gift)

      // Chi phí ads gán theo mã SP (attribution từ tên camp, xem adsByCode). SP không map
      // được camp nào → 0. Tương đối nhưng đủ để so lãi/lỗ theo SP.
      const ads_cost = g.sp_code ? (adsByCode[String(g.sp_code).toUpperCase()] ?? 0) : 0

      // ── KHỐI THỰC ──
      // Fullfill chỉ tính cho đơn mà SP này là SP chính (mỗi đơn chịu 1 lần fullfill).
      const fullfill = FULLFILL_PER_ORDER * g.main_orders
      const lng = g.revenue_delivered - (cogs + g.ship_cost + ads_cost + fullfill)

      // ── KHỐI TẠM TÍNH (công thức B — xem giải thích ở marketer-lng) ──
      // DT tạm tính = DT đã nhận (thực) + DT đơn còn treo × tỷ lệ nhận kỳ vọng.
      // Hết tháng → đơn treo = 0 → tạm tính hội tụ về thực.
      const nGiao = g.total_orders
      const nDaChot = g.da_nhan + g.da_hoan + g.dang_hoan + g.da_huy
      const tyLeNhan = nDaChot > 0 ? g.da_nhan / nDaChot : 0.8
      // Tỷ lệ hoàn của chính SP này (trên đơn đã ngã ngũ), lùi dần khi thiếu dữ liệu.
      const chotSP = g.da_nhan + g.da_hoan + g.dang_hoan
      const tyLeHoanSP = chotSP >= MIN_DON_CHOT
        ? (g.da_hoan + g.dang_hoan) / chotSP
        : tyLeHoanChung
      const dkhh = nGiao > 0
        ? (g.da_hoan + g.dang_hoan + g.da_huy + g.da_gui_hang * tyLeHoanSP) / nGiao
        : 0
      const pctVon = g.revenue_delivered > 0 ? cogs / g.revenue_delivered : 0
      // %VC phải chia cho doanh thu của ĐÚNG TẬP ĐƠN đã phát sinh phí ship. ship_cost gồm
      // cả đơn đang trên đường, nên chia cho revenue_delivered (chỉ đơn đã nhận) là hai vế
      // khác tập: tháng 9 có 195/359 đơn đang giao và %VC vọt lên 29,9% trong khi mức thật
      // của kênh là ~7%. Cộng thêm doanh thu đơn còn treo vào mẫu số.
      const revenueDaGui = g.revenue_shipped || g.revenue_delivered
      const pctShip = revenueDaGui > 0 ? g.ship_cost / revenueDaGui : 0
      const revenueTamTinh = Math.round(g.revenue_delivered + g.revenue_treo * tyLeNhan)
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
        // Tách giá vốn SP / quà tặng để biết combo "ăn" bao nhiêu vào lãi
        cogs_sp, cogs_gift, gift_detail, gift_missing_cost,
        cogs_sp_pct: pct(cogs_sp, g.revenue_delivered),
        cogs_gift_pct: pct(cogs_gift, g.revenue_delivered),
        fullfill, lng, lng_thuc: lng,
        cogs_pct: pct(cogs, g.revenue_delivered),
        // Mẫu số là doanh thu của đơn ĐÃ GỬI (gồm đơn đang đi) — cùng tập với ship_cost.
        ship_pct: pct(g.ship_cost, revenueDaGui),
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
      cogs: sum("cogs"), cogs_sp: sum("cogs_sp"), cogs_gift: sum("cogs_gift"),
      ship_cost: sum("ship_cost"), ads_cost: sum("ads_cost"),
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
      du_kien_hoan_huy: pctT(sum("da_hoan") + sum("dang_hoan") + sum("da_huy")
        + sum("da_gui_hang") * tyLeHoanChung),
    }

    return res.json({ rows: result, totals, from, to })
  } catch (err: any) {
    console.error("[report/product-lng]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
