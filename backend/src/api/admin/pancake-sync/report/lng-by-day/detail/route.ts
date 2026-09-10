import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"
import { computeAvgCost, lookupCost, resolveDisplayId, toVNDate } from "../../../../gia-von/avg-cost/route"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}
async function sql(query: string, params?: any[]): Promise<any[]> {
  const client = await getPool().connect()
  try { return (await client.query(query, params ?? [])).rows } finally { client.release() }
}

const FULLFILL_PER_ORDER = 5000

/**
 * GET /admin/pancake-sync/report/lng-by-day/detail?date=YYYY-MM-DD&market=VN
 *
 * Bóc một dòng của bảng "LNG theo ngày" ra chi tiết, để biết ngày đó món nào kéo LNG
 * xuống. Trả về HAI cách nhìn cùng lúc:
 *   - by_product: gộp theo sản phẩm — trả lời "hôm nay món nào lỗ"
 *   - by_order  : từng đơn — soi đơn cụ thể khi cần
 *
 * TỔNG CỦA CẢ HAI PHẢI KHỚP DÒNG NGÀY, nên mọi tham số dự phóng (tỷ lệ nhận, %vốn,
 * %ship) lấy đúng cách ../route.ts tính, kể cả quy tắc "ngày chưa chín thì mượn tỷ lệ
 * kỳ" — tính riêng ở đây sẽ ra số khác và hai bảng đá nhau.
 *
 * Chi phí ads chỉ có ở mức NGÀY (kênh FB/COD không tách được theo SP), nên chia theo
 * tỷ trọng doanh thu và ghi rõ đó là số chia, không phải số đo riêng.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const q = req.query as Record<string, string>
    const dateRaw = String(q.date || "")
    const market = q.market
    if (!dateRaw) return res.status(400).json({ error: "Thiếu date" })
    if (market && market !== "VN") return res.json({ not_supported: true, rows: [] })
    // Bảng ngày đã tính sẵn 3 tham số dự phóng (có quy tắc "ngày chưa chín mượn tỷ lệ
    // kỳ"). Nhận lại đúng số đó để chi tiết khớp dòng ngày tuyệt đối; thiếu thì tự tính.
    const numOrNull = (v: any) => {
      const n = Number(v)
      return Number.isFinite(n) && v !== "" && v != null ? n : null
    }
    const tyLeNhanIn = numOrNull(q.ty_le_nhan)
    const pctVonIn = numOrNull(q.pct_von)
    const pctShipIn = numOrNull(q.pct_ship)

    const date = toVNDate(dateRaw)
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

    // Một đơn có thể nhiều SP. Doanh thu/phí ship của đơn chia cho từng dòng hàng theo
    // tỷ trọng GIÁ TRỊ NIÊM YẾT của dòng đó — cùng cách bảng theo SP ở tab Sàn TMĐT làm.
    const rows = await sql(`
      WITH don AS (
        SELECT
          id, status,
          ${revenueExpr} AS order_revenue,
          COALESCE((raw->>'partner_fee')::numeric, 0)::bigint AS ship,
          raw->'items' AS items
        FROM pancake_order
        WHERE deleted_at IS NULL
          AND source IN ('manual', 'facebook', 'medusa', 'unknown', 'webcake')
          AND NOT ${excludeCond}
          AND status NOT IN (-2)
          AND pancake_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND pancake_created_at < (($1::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
      ),
      dong AS (
        SELECT
          d.id, d.status, d.order_revenue, d.ship,
          upper(trim(COALESCE(it->'variation_info'->>'display_id',''))) AS sp_code,
          COALESCE(it->'variation_info'->>'name', it->>'name', 'CHƯA RÕ SP') AS sp_label,
          upper(trim(COALESCE(it->'variation_info'->>'name', it->>'name',''))) AS sp_name_up,
          COALESCE((it->>'quantity')::numeric, 1) AS qty,
          (COALESCE((it->'variation_info'->>'retail_price')::numeric, (it->>'price')::numeric, 0)
            * COALESCE((it->>'quantity')::numeric, 1)) AS gia_tri
        FROM don d
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.items, '[]'::jsonb)) it
      ),
      -- SP CHÍNH của đơn = dòng hàng giá trị cao nhất. Quà tặng kèm có giá 0 nên không
      -- bao giờ thành SP chính, và KHÔNG được tách thành dòng riêng: trước đây quà tặng
      -- ra một dòng có doanh thu 0đ, vốn 0đ nhưng vẫn gánh ads và fullfill, nên hiện lỗ
      -- giả (BỘ KHAY LỌC DẦU: 36 đơn, DT 0đ, lỗ 388.813đ).
      -- Cả đơn quy về SP chính: doanh thu, phí ship, ads, fullfill đều tính cho nó.
      xep_hang AS (
        SELECT dong.*,
          ROW_NUMBER() OVER (
            PARTITION BY id
            ORDER BY gia_tri DESC, COALESCE(NULLIF(sp_code,''), sp_name_up) ASC
          ) AS hang
        FROM dong
      ),
      -- Mỗi đơn còn đúng một dòng, mang SP chính; qty gộp cả đơn để biết bán mấy món.
      don_sp AS (
        SELECT
          x.id, x.status, x.order_revenue, x.ship,
          x.sp_code, x.sp_label, x.sp_name_up,
          (SELECT SUM(y.qty) FROM xep_hang y WHERE y.id = x.id) AS qty,
          (SELECT jsonb_agg(jsonb_build_object('code', y.sp_code, 'name', y.sp_name_up, 'qty', y.qty))
             FROM xep_hang y WHERE y.id = x.id) AS items
        FROM xep_hang x
        WHERE x.hang = 1
      )
      SELECT
        COALESCE(NULLIF(sp_code,''), sp_name_up) AS sp_key,
        MAX(sp_label) AS sp_label,
        MAX(NULLIF(sp_code,'')) AS sp_code,
        MAX(sp_name_up) AS sp_name_up,
        COUNT(DISTINCT id)::int AS tong_don,
        COUNT(DISTINCT id) FILTER (WHERE status = 3)::int AS da_nhan,
        COUNT(DISTINCT id) FILTER (WHERE status IN (4,5))::int AS hoan,
        COUNT(DISTINCT id) FILTER (WHERE status IN (6,-1))::int AS huy,
        SUM(CASE WHEN status = 3 THEN qty ELSE 0 END)::numeric AS sl_da_nhan,
        SUM(CASE WHEN status = 3 THEN order_revenue ELSE 0 END)::bigint AS dt_da_nhan,
        SUM(CASE WHEN status IN (0,1,2,8,9,11) THEN order_revenue ELSE 0 END)::bigint AS dt_treo,
        SUM(ship)::bigint AS ship,
        jsonb_agg(items) FILTER (WHERE status = 3) AS items_da_nhan,
        jsonb_agg(items) FILTER (WHERE status IN (0,1,2,8,9,11)) AS items_treo
      FROM don_sp
      GROUP BY sp_key
      ORDER BY SUM(CASE WHEN status = 3 THEN order_revenue ELSE 0 END) DESC
    `, [date])

    // Ads cả ngày (FB + Google).
    const adsRows = await sql(`
      SELECT SUM(spend)::bigint AS spend FROM (
        SELECT spend FROM mkt_ads_cost WHERE deleted_at IS NULL AND date = $1::date
        UNION ALL
        SELECT cost AS spend FROM mkt_ads_cost_gg WHERE deleted_at IS NULL AND date = $1::date
      ) u
    `, [date])
    const adsNgay = Number(adsRows[0]?.spend || 0)

    // Ads THEO SẢN PHẨM: tên camp mở đầu bằng mã SP (PHVVN042KGV_28/6_ANHNT_KỆ GIA VỊ…),
    // nên bóc prefix ra để biết tiền chạy cho món nào. Camp không theo quy ước đặt tên
    // rơi vào nhóm "không rõ SP" và được chia đều cho các đơn còn lại.
    const adsByProdRows = await sql(`
      SELECT (regexp_match(upper(campaign_name), '(PHVVN[0-9]{2,3})'))[1] AS prefix,
             SUM(spend)::bigint AS spend
      FROM mkt_ads_cost
      WHERE deleted_at IS NULL AND date = $1::date
      GROUP BY 1
    `, [date])
    const adsByPrefix: Record<string, number> = {}
    let adsKhongRoSP = 0
    for (const a of adsByProdRows) {
      const v = Number(a.spend) || 0
      if (a.prefix) adsByPrefix[String(a.prefix)] = (adsByPrefix[String(a.prefix)] ?? 0) + v
      else adsKhongRoSP += v
    }
    // Google Ads: bảng mkt_ads_cost_gg không có cột sản phẩm (chỉ ngày + người chạy),
    // nhưng thực tế GG chỉ chạy CHẢO VÀNG nên gán trọn về mã đó. Khi nào GG chạy thêm
    // món khác thì phải thêm cột product_code vào bảng thay vì sửa hằng số ở đây.
    const GG_PRODUCT_PREFIX = "PHVVN026"   // CHẢO VÀNG CHỐNG DÍNH KÈM KHAY HẤP
    const adsGgRows = await sql(
      `SELECT COALESCE(SUM(cost), 0)::bigint AS c FROM mkt_ads_cost_gg
        WHERE deleted_at IS NULL AND date = $1::date`, [date])
    const adsGg = Number(adsGgRows[0]?.c || 0)
    if (adsGg > 0) {
      adsByPrefix[GG_PRODUCT_PREFIX] = (adsByPrefix[GG_PRODUCT_PREFIX] ?? 0) + adsGg
    }
    // Quy mã dòng hàng về prefix để khớp mã trong tên camp. Phải qua resolveDisplayId
    // trước: đơn chảo vàng mang mã PHVVN027_CV còn camp đặt tên PHVVN026CV, alias nối
    // hai mã đó lại — bỏ qua thì tiền camp chảo vàng không tìm được dòng nào để gánh.
    const prefixOf = (code: string | null) => {
      const c = resolveDisplayId(code) ?? (code ? String(code).toUpperCase() : "")
      return c.match(/^(PHVVN\d{2,3})/)?.[1] ?? null
    }

    // items giờ là mảng-của-mảng (mỗi đơn một mảng dòng hàng) vì SQL gom theo đơn rồi
    // mới gom theo SP — duyệt hai tầng. Giá vốn tính TRỌN ĐƠN, gồm cả quà tặng kèm,
    // và gán hết cho SP chính.
    const cogsOf = (groups: any): number => {
      if (!Array.isArray(groups)) return 0
      let c = 0
      for (const items of groups) {
        if (!Array.isArray(items)) continue
        for (const it of items) {
          const qty = Number(it?.qty ?? 0)
          if (!qty) continue
          const unit = lookupCost(avgCost, resolveDisplayId(it?.code), String(it?.name ?? ""))
          if (unit != null) c += unit * qty
        }
      }
      return c
    }

    // Tỷ lệ nhận: ưu tiên số bảng ngày đã dùng (khớp tuyệt đối), không thì tự tính.
    let sumNhan = 0, sumChot = 0
    for (const r of rows) {
      sumNhan += r.da_nhan
      sumChot += r.da_nhan + r.hoan + r.huy
    }
    const tyLeNhan = tyLeNhanIn ?? (sumChot > 0 ? sumNhan / sumChot : 0.8)

    const tmp = rows.map((r: any) => {
      const dtNhan = Number(r.dt_da_nhan)
      const dtTreo = Number(r.dt_treo)
      const dtTamTinh = Math.round(dtNhan + dtTreo * tyLeNhan)
      const cogs = Math.round(cogsOf(r.items_da_nhan))
      // Giá vốn tạm tính = vốn thật đơn đã nhận + vốn thật đơn treo × tỷ lệ nhận —
      // cùng nhịp với doanh thu tạm tính. Suy từ %vốn trung bình ngày là sai: chảo vàng
      // vốn 381.233đ bị tính thành 363.483đ vì %vốn ngày (45,6%) thấp hơn %vốn của nó.
      const cogsTreo = Math.round(cogsOf(r.items_treo))
      const cogsTamTinhRieng = cogs + Math.round(cogsTreo * tyLeNhan)
      return {
        r, dtNhan, dtTamTinh, cogs, cogsTamTinhRieng,
        pctVon: dtTamTinh > 0 ? cogsTamTinhRieng / dtTamTinh : (pctVonIn ?? 0),
        ship: Number(r.ship),
      }
    })

    const tongDT = tmp.reduce((a, x) => a + x.dtTamTinh, 0)
    const donCoSP = tmp.reduce((a, x) => a + x.r.tong_don, 0)

    // ── ADS VỀ ĐÚNG SẢN PHẨM ────────────────────────────────────────────────────
    // Tiền camp của SP nào thì SP đó gánh, chia cho SỐ ĐƠN của chính nó — 100k ads cho
    // SP A có 10 đơn thì mỗi đơn A chịu 10k. Chia theo doanh thu là sai: đơn mua 3 món
    // sẽ gánh gấp ba dù cũng chỉ là một đơn mà camp mang về, che mất chuyện đơn nhiều
    // món mới là đơn lãi tốt (cùng một suất ads, doanh thu cao hơn).
    // Nhiều biến thể có thể chung một prefix (PHVVN020_TDH_MEDIUM và _LARGE đều là
    // PHVVN020). Tiền camp của prefix đó phải CHIA cho các biến thể theo số đơn, không
    // để mỗi dòng nhận trọn — nếu không tổng ads vượt thực chi (19,4tr vs 18,2tr).
    const donTheoPrefix: Record<string, number> = {}
    for (const x of tmp) {
      const px = prefixOf(x.r.sp_code)
      if (px && (adsByPrefix[px] ?? 0) > 0) {
        donTheoPrefix[px] = (donTheoPrefix[px] ?? 0) + x.r.tong_don
      }
    }
    const adsRieng: Record<string, number> = {}   // sp_key -> ads phần của SP đó
    let donKhongCoAds = 0
    for (const x of tmp) {
      const px = prefixOf(x.r.sp_code)
      const pool = px ? (adsByPrefix[px] ?? 0) : 0
      const donPx = px ? (donTheoPrefix[px] ?? 0) : 0
      if (pool > 0 && donPx > 0) {
        adsRieng[x.r.sp_key] = pool * (x.r.tong_don / donPx)
      } else {
        donKhongCoAds += x.r.tong_don
      }
    }
    // Camp chạy cho SP mà ngày đó KHÔNG bán được đơn nào: prefix có tiền nhưng không
    // dòng nào mang nó, tiền sẽ rơi mất khỏi bảng. Dồn vào nhóm chung để tổng khớp thực
    // chi — và đó cũng là tín hiệu đáng biết: camp tiêu tiền mà không ra đơn.
    for (const [px, v] of Object.entries(adsByPrefix)) {
      if (!(donTheoPrefix[px] > 0)) adsKhongRoSP += v
    }
    // Camp không rõ SP (tên không theo quy ước + Google Ads) ưu tiên chia cho các SP
    // CHƯA có camp riêng. Nhưng khi mọi SP đều đã có camp riêng thì nhóm đó rỗng và
    // khoản này rơi mất — ngày 01/09 có 1.017.212đ biến khỏi bảng. Lúc đó chia cho
    // TOÀN BỘ đơn để tiền không mất, tổng vẫn khớp thực chi.
    const donNhanAdsChung = donKhongCoAds > 0 ? donKhongCoAds : donCoSP
    const adsChungMoiDon = donNhanAdsChung > 0 ? adsKhongRoSP / donNhanAdsChung : 0
    const chiaChungChoTatCa = donKhongCoAds === 0

    const result = tmp.map(({ r, dtNhan, dtTamTinh, cogs, cogsTamTinhRieng, ship }) => {
      const adsCuaSP = adsRieng[r.sp_key]
      const ads = Math.round(
        (adsCuaSP ?? 0)
        + ((adsCuaSP == null || chiaChungChoTatCa) ? adsChungMoiDon * r.tong_don : 0))
      // Giá vốn thật trọn đơn (gồm quà tặng kèm) — không kéo về %vốn trung bình ngày,
      // vì làm thế thì mọi SP ra cùng %GV và bảng không nói được SP nào lỗ.
      const cogsTT = cogsTamTinhRieng
      const shipTT = pctShipIn != null
        ? Math.round(dtTamTinh * pctShipIn)
        : (dtTamTinh > 0 && dtNhan > 0 ? Math.round(dtTamTinh * (ship / dtNhan)) : ship)
      // Mỗi đơn giờ chỉ thuộc đúng một SP (đã quy về SP chính) nên đếm thẳng, không
      // còn cảnh đơn nhiều món bị tính fullfill ở mọi dòng.
      const fullfill = FULLFILL_PER_ORDER * r.tong_don
      const lngTT = dtTamTinh - (cogsTT + shipTT + ads + fullfill)
      const lngThuc = dtNhan - (cogs + ship + ads + fullfill)
      const chot = r.da_nhan + r.hoan
      return {
        sp_label: r.sp_label, sp_code: r.sp_code,
        tong_don: r.tong_don, da_nhan: r.da_nhan, hoan: r.hoan, huy: r.huy,
        sl_da_nhan: Number(r.sl_da_nhan),
        ty_le_hoan: chot > 0 ? Math.round(r.hoan / chot * 1000) / 10 : 0,
        dt_da_nhan: dtNhan, dt_tam_tinh: dtTamTinh,
        cogs, cogs_tam_tinh: cogsTT,
        cogs_pct: dtTamTinh > 0 ? Math.round(cogsTT / dtTamTinh * 1000) / 10 : 0,
        ship, ship_tam_tinh: shipTT,
        ship_pct: dtTamTinh > 0 ? Math.round(shipTT / dtTamTinh * 1000) / 10 : 0,
        ads, ads_pct: dtTamTinh > 0 ? Math.round(ads / dtTamTinh * 1000) / 10 : 0,
        ads_moi_don: r.tong_don > 0 ? Math.round(ads / r.tong_don) : 0,
        ads_co_camp_rieng: adsCuaSP != null,
        fullfill,
        fullfill_pct: dtTamTinh > 0 ? Math.round(fullfill / dtTamTinh * 1000) / 10 : 0,
        lng_tam_tinh: lngTT,
        lng_pct: dtTamTinh > 0 ? Math.round(lngTT / dtTamTinh * 1000) / 10 : 0,
        lng_thuc: lngThuc,
      }
    }).sort((a, b) => a.lng_tam_tinh - b.lng_tam_tinh)

    // ── TAB 2: TỪNG ĐƠN ────────────────────────────────────────────────────────
    // Cùng ngày, cùng bộ lọc, cùng tham số dự phóng — nên tổng khớp tab theo SP.
    const orderRows = await sql(`
      SELECT
        po.id::text AS order_id,
        po.raw->>'id' AS pos_id,
        po.status,
        po.status_name,
        po.customer_name,
        po.province,
        COALESCE(NULLIF(TRIM(po.sale_name), ''), '') AS sale_name,
        (po.pancake_created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS created_at_vn,
        ${revenueExpr} AS revenue,
        COALESCE((po.raw->>'partner_fee')::numeric, 0)::bigint AS ship,
        po.raw->'items' AS items
      FROM pancake_order po
      WHERE po.deleted_at IS NULL
        AND po.source IN ('manual', 'facebook', 'medusa', 'unknown', 'webcake')
        AND NOT ${excludeCond}
        AND po.status NOT IN (-2)
        AND po.pancake_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND po.pancake_created_at < (($1::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
      ORDER BY po.pancake_created_at
    `, [date])

    const cogsOfRaw = (items: any): number => {
      if (!Array.isArray(items)) return 0
      let c = 0
      for (const it of items) {
        const qty = Number(it?.quantity ?? 0)
        if (!qty) continue
        const vi = it?.variation_info ?? {}
        const unit = lookupCost(avgCost, resolveDisplayId(vi.display_id),
          String(vi.name ?? it?.name ?? "").toUpperCase())
        if (unit != null) c += unit * qty
      }
      return c
    }

    // Ads của mỗi ĐƠN = suất ads của SP CHÍNH trong đơn đó (SP có giá trị cao nhất).
    // Cùng nguyên tắc với tab theo SP: tiền camp của SP nào thì đơn chứa SP đó gánh,
    // mỗi đơn một suất — đơn mua 3 món vẫn chỉ tốn một suất, nên LNG cao hơn hẳn.
    // adsMoiDonTheoSP tính từ tab SP ở trên để hai tab ra cùng một con số.
    const adsMoiDonTheoSP: Record<string, number> = {}
    for (const x of tmp) {
      const v = adsRieng[x.r.sp_key]
      const rieng = x.r.tong_don > 0 && v != null ? v / x.r.tong_don : 0
      const chung = (v == null || chiaChungChoTatCa) ? adsChungMoiDon : 0
      adsMoiDonTheoSP[x.r.sp_key] = rieng + chung
    }
    const donTmp = orderRows.map((o: any) => {
      const daNhan = o.status === 3
      const treo = [0, 1, 2, 8, 9, 11].includes(o.status)
      const rev = Number(o.revenue) || 0
      const dtTamTinh = daNhan ? rev : (treo ? Math.round(rev * tyLeNhan) : 0)
      // SP chính của đơn = dòng hàng có giá trị niêm yết cao nhất — đơn gánh suất ads
      // của món đó, giống cách bảng LNG vẫn quy đơn về một SP chính.
      let spChinh: string | null = null
      let maxVal = -1
      for (const it of (Array.isArray(o.items) ? o.items : [])) {
        const vi = it?.variation_info ?? {}
        const val = Number(vi.retail_price ?? it?.price ?? 0) * Number(it?.quantity ?? 1)
        if (val > maxVal) {
          maxVal = val
          spChinh = String(vi.display_id ?? "").trim().toUpperCase()
            || String(vi.name ?? it?.name ?? "").trim().toUpperCase()
        }
      }
      return {
        o, daNhan, dtTamTinh, spChinh,
        // Giá vốn tra được cho MỌI đơn, không riêng đơn đã nhận: món trong đơn đã biết
        // ngay từ lúc đặt. Chỉ tính đơn đã nhận thì đơn đang giao rơi vào ước theo %vốn
        // trung bình ngày — chảo vàng vốn thật 381.233đ bị tính thành 363.483đ.
        cogsFull: Math.round(cogsOfRaw(o.items)),
        cogsThuc: daNhan ? Math.round(cogsOfRaw(o.items)) : 0,
      }
    })

    const byOrder = donTmp.map(({ o, daNhan, dtTamTinh, cogsThuc, cogsFull, spChinh }) => {
      // Đơn không có dòng hàng nào (đơn rỗng trên POS) không xuất hiện ở tab theo SP,
      // nên cũng không được gánh ads — nếu không hai tab lệch đúng bằng suất của nó
      // (ngày 08/09: đơn 82127 rỗng nhưng ôm 1.686.965đ).
      const ads = Math.round(
        (spChinh && adsMoiDonTheoSP[spChinh] != null)
          ? adsMoiDonTheoSP[spChinh]
          : (spChinh ? adsChungMoiDon : 0))
      const ship = Number(o.ship) || 0
      // Giá vốn thật của chính đơn; đơn treo chưa biết kết cục thì ước theo %vốn ngày.
      // Đơn đã nhận: vốn thật trọn đơn. Đơn còn treo: vốn thật × tỷ lệ nhận, cùng nhịp
      // với doanh thu tạm tính. Chỉ khi không tra được vốn (SP chưa khai) mới ước theo
      // %vốn trung bình ngày.
      const cogsTT = daNhan
        ? cogsThuc
        : (cogsFull > 0
            ? Math.round(cogsFull * tyLeNhan)
            : (pctVonIn != null ? Math.round(dtTamTinh * pctVonIn) : 0))
      const shipTT = pctShipIn != null ? Math.round(dtTamTinh * pctShipIn) : ship
      const lngTT = dtTamTinh - (cogsTT + shipTT + ads + FULLFILL_PER_ORDER)
      return {
        order_id: o.order_id, pos_id: o.pos_id,
        status: o.status, status_name: o.status_name,
        customer_name: o.customer_name, province: o.province, sale_name: o.sale_name,
        created_at: o.created_at_vn,
        san_pham: (Array.isArray(o.items) ? o.items : []).map((it: any) => ({
          code: it?.variation_info?.display_id ?? null,
          label: it?.variation_info?.name ?? it?.name ?? "CHƯA RÕ SP",
          qty: Number(it?.quantity ?? 0),
        })),
        revenue: Number(o.revenue) || 0,
        dt_tam_tinh: dtTamTinh,
        cogs: cogsThuc, cogs_tam_tinh: cogsTT,
        ship, ship_tam_tinh: shipTT,
        ads, fullfill: FULLFILL_PER_ORDER,
        lng_tam_tinh: lngTT,
        lng_pct: dtTamTinh > 0 ? Math.round(lngTT / dtTamTinh * 1000) / 10 : 0,
      }
    }).sort((a, b) => a.lng_tam_tinh - b.lng_tam_tinh)

    const sumBy = (arr: any[], k: string) => arr.reduce((a, r) => a + (Number(r[k]) || 0), 0)
    return res.json({
      date,
      by_product: result,
      by_order: byOrder,
      ads_ngay: adsNgay,
      ty_le_nhan: Math.round(tyLeNhan * 1000) / 10,
      // Tổng của hai tab — dùng để đối chiếu với dòng ngày.
      totals: {
        tong_don: orderRows.length,
        dt_tam_tinh: sumBy(byOrder, "dt_tam_tinh"),
        cogs_tam_tinh: sumBy(byOrder, "cogs_tam_tinh"),
        ship_tam_tinh: sumBy(byOrder, "ship_tam_tinh"),
        ads: sumBy(byOrder, "ads"),
        fullfill: sumBy(byOrder, "fullfill"),
        lng_tam_tinh: sumBy(byOrder, "lng_tam_tinh"),
      },
      totals_by_product: {
        tong_don: sumBy(result, "tong_don"),
        dt_tam_tinh: sumBy(result, "dt_tam_tinh"),
        cogs_tam_tinh: sumBy(result, "cogs_tam_tinh"),
        ship_tam_tinh: sumBy(result, "ship_tam_tinh"),
        ads: sumBy(result, "ads"),
        fullfill: sumBy(result, "fullfill"),
        lng_tam_tinh: sumBy(result, "lng_tam_tinh"),
      },
    })
  } catch (err: any) {
    console.error("[report/lng-by-day/detail]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
