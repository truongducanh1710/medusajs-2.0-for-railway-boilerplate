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
      chia AS (
        SELECT dong.*,
          CASE WHEN SUM(gia_tri) OVER (PARTITION BY id) > 0
            THEN gia_tri / SUM(gia_tri) OVER (PARTITION BY id)
            ELSE 1.0 / COUNT(*) OVER (PARTITION BY id)
          END AS ty_trong
        FROM dong
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
        SUM(CASE WHEN status = 3 THEN order_revenue * ty_trong ELSE 0 END)::bigint AS dt_da_nhan,
        SUM(CASE WHEN status IN (0,1,2,8,9,11) THEN order_revenue * ty_trong ELSE 0 END)::bigint AS dt_treo,
        SUM(ship * ty_trong)::bigint AS ship,
        jsonb_agg(jsonb_build_object('code', sp_code, 'name', sp_name_up, 'qty', qty))
          FILTER (WHERE status = 3) AS items_da_nhan
      FROM chia
      GROUP BY sp_key
      ORDER BY SUM(CASE WHEN status = 3 THEN order_revenue * ty_trong ELSE 0 END) DESC
    `, [date])

    // Ads cả ngày (FB + Google) — chỉ có ở mức ngày, không tách được theo SP.
    const adsRows = await sql(`
      SELECT SUM(spend)::bigint AS spend FROM (
        SELECT spend FROM mkt_ads_cost WHERE deleted_at IS NULL AND date = $1::date
        UNION ALL
        SELECT cost AS spend FROM mkt_ads_cost_gg WHERE deleted_at IS NULL AND date = $1::date
      ) u
    `, [date])
    const adsNgay = Number(adsRows[0]?.spend || 0)

    const cogsOf = (items: any): number => {
      if (!Array.isArray(items)) return 0
      let c = 0
      for (const it of items) {
        const qty = Number(it?.qty ?? 0)
        if (!qty) continue
        const unit = lookupCost(avgCost, resolveDisplayId(it?.code), String(it?.name ?? ""))
        if (unit != null) c += unit * qty
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
      // %vốn và %ship lấy MỨC NGÀY (bảng ngày truyền sang) chứ không tính riêng từng SP:
      // SP mới bán vài đơn có dtNhan rất nhỏ, tỷ lệ riêng dao động mạnh và tổng lệch dòng
      // ngày. Mức ngày cho tổng khớp, và vẫn đủ để so SP nào lỗ nặng hơn.
      const pctVon = pctVonIn ?? (dtNhan > 0 ? cogs / dtNhan : 0)
      return { r, dtNhan, dtTamTinh, cogs, pctVon, ship: Number(r.ship) }
    })

    // Ads chia theo tỷ trọng DOANH THU TẠM TÍNH — số chia, không phải số đo riêng SP.
    const tongDT = tmp.reduce((a, x) => a + x.dtTamTinh, 0)
    // Fullfill: mỗi ĐƠN chịu một lần. tong_don ở dòng SP là "số đơn CÓ CHỨA SP này", nên
    // đơn nhiều SP bị đếm ở mọi dòng và tổng vượt số đơn thật (160 vs 114 ngày 08/09).
    // Chia theo tỷ trọng doanh thu để tổng khớp đúng số đơn distinct của ngày.
    const soDonThat = await sql(`
      SELECT COUNT(*)::int AS n FROM pancake_order
      WHERE deleted_at IS NULL
        AND source IN ('manual', 'facebook', 'medusa', 'unknown', 'webcake')
        AND NOT ${excludeCond}
        AND status NOT IN (-2)
        AND pancake_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND pancake_created_at < (($1::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
    `, [date])
    const fullfillNgay = FULLFILL_PER_ORDER * Number(soDonThat[0]?.n || 0)

    const result = tmp.map(({ r, dtNhan, dtTamTinh, cogs, pctVon, ship }) => {
      const ads = tongDT > 0 ? Math.round(adsNgay * (dtTamTinh / tongDT)) : 0
      const cogsTT = Math.round(dtTamTinh * pctVon)
      const shipTT = pctShipIn != null
        ? Math.round(dtTamTinh * pctShipIn)
        : (dtTamTinh > 0 && dtNhan > 0 ? Math.round(dtTamTinh * (ship / dtNhan)) : ship)
      const fullfill = tongDT > 0 ? Math.round(fullfillNgay * (dtTamTinh / tongDT)) : 0
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
        fullfill,
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

    // Ads chia đều theo doanh thu tạm tính của từng đơn, cùng tổng với tab theo SP.
    const donTmp = orderRows.map((o: any) => {
      const daNhan = o.status === 3
      const treo = [0, 1, 2, 8, 9, 11].includes(o.status)
      const rev = Number(o.revenue) || 0
      const dtTamTinh = daNhan ? rev : (treo ? Math.round(rev * tyLeNhan) : 0)
      return { o, daNhan, dtTamTinh, cogsThuc: daNhan ? Math.round(cogsOfRaw(o.items)) : 0 }
    })
    const tongDTDon = donTmp.reduce((a, x) => a + x.dtTamTinh, 0)

    const byOrder = donTmp.map(({ o, daNhan, dtTamTinh, cogsThuc }) => {
      const ads = tongDTDon > 0 ? Math.round(adsNgay * (dtTamTinh / tongDTDon)) : 0
      const ship = Number(o.ship) || 0
      const cogsTT = pctVonIn != null ? Math.round(dtTamTinh * pctVonIn) : cogsThuc
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
