import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getOwnScope } from "../../../../../lib/freelance-scope"
import { MKT_OF_ORDER_SQL, ORDER_REVENUE_SQL, MKT_ORDER_FILTER_SQL } from "../../../../../lib/mkt-today"

/**
 * GET /admin/pancake-sync/report/mkt-product
 * ?from=2026-05-01&to=2026-05-27&mkt=KIENLB
 *
 * Chi phí + doanh số theo SP (và theo MKT × SP):
 * - SP của 1 camp = mã SP đầu tên camp (PHVVN026CV_...) so với mkt_product.code bỏ gạch dưới
 *   (PHVVN026_CV). Camp không theo convention → SP chính hay gặp nhất trong đơn của camp (365 ngày).
 * - Đơn gán SP theo camp trong UTM của đơn (cùng cách với chi phí); đơn không có camp mã SP →
 *   SP chính của đơn (dòng hàng giá trị cao nhất, quà 0đ không bao giờ thắng).
 * - Đếm ĐƠN (không đếm dòng hàng), doanh số = tiền khách trả thật — cùng bộ lọc/công thức với
 *   tab Theo MKT (lib/mkt-today.ts) để tổng 2 tab khớp nhau.
 * - Áp bàn giao MKT (mkt_handover) theo ngày cho cả chi phí lẫn đơn.
 */

// SP chính của camp không theo convention tên (camp → dòng hàng hay gặp nhất trong đơn).
// Tra lịch sử 365 ngày phải bung raw ~8KB của ~100k đơn (~8s) — kết quả gần như không đổi nên
// cache trong RAM: hết hạn thì trả bản cũ và làm mới nền; camp chưa từng gặp tra nhanh 30 ngày.
const HIST_TTL_MS = 6 * 3600_000
const campHistCache = new Map<string, { item: string | null; at: number }>()
let histRefreshing = false

async function queryCampHist(svc: any, camps: string[], days: number, campOfPo: string, mainItemOfPo: string) {
  if (!camps.length) return
  const rows = await svc.sql(`
    SELECT DISTINCT ON (campaign_name) campaign_name, main_item
    FROM (
      SELECT ${campOfPo} AS campaign_name, ${mainItemOfPo} AS main_item, COUNT(*) AS cnt
      FROM pancake_order po
      WHERE po.deleted_at IS NULL
        AND po.status NOT IN (-2, 7)
        AND po.pancake_created_at >= (now() - ($2::int * interval '1 day'))
        AND ${campOfPo} = ANY($1::text[])
      GROUP BY 1, 2
    ) t
    WHERE main_item IS NOT NULL
    ORDER BY campaign_name, cnt DESC
  `, [camps, days])
  const now = Date.now()
  const found = new Map<string, string>(rows.map((r: any) => [r.campaign_name, r.main_item]))
  for (const c of camps) {
    const prev = campHistCache.get(c)
    // Tra 30 ngày không thấy thì giữ kết quả cũ (nếu có) thay vì ghi đè null
    campHistCache.set(c, { item: found.get(c) ?? (days < 365 ? prev?.item ?? null : null), at: days < 365 ? 0 : now })
  }
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10)
    const q = req.query as Record<string, string>
    const fromDate = q.from ?? today
    const toDate = q.to ?? today
    const mkt = (q.mkt ?? "").trim().toUpperCase()

    const cskhService = req.scope.resolve("cskhAnalysisModule") as any

    const UNKNOWN_SP = "CHƯA RÕ SP (camp chưa có đơn match)"
    const GG_SP = "GOOGLE ADS (chưa tách SP)"
    const campOf = (alias: string) => `CASE WHEN ${alias}.raw->>'p_utm_source' = 'fb'
      THEN ${alias}.raw->>'p_utm_campaign' ELSE ${alias}.raw->>'p_utm_source' END`
    // Dòng hàng giá trị cao nhất của đơn — quà tặng 0đ không thành SP chính
    const mainItemOf = (alias: string) => `(
      SELECT i->>'name' FROM jsonb_array_elements(COALESCE(${alias}.items, '[]'::jsonb)) i
      ORDER BY COALESCE((i->>'price')::numeric, 0) * COALESCE((i->>'quantity')::numeric, 1) DESC
      LIMIT 1)`
    const handoverOf = (mktExpr: string, dateExpr: string) => `COALESCE((
      SELECT h.to_code FROM handover h
      WHERE h.from_code = ${mktExpr} AND ${dateExpr} >= h.ef AND (h.et IS NULL OR ${dateExpr} <= h.et)
      ORDER BY h.ef DESC LIMIT 1), ${mktExpr})`

    // Camp trong khoảng ngày không mang mã SP → cần fallback SP chính từ lịch sử đơn
    const codeless: string[] = (await cskhService.sql(`
      WITH prod AS (SELECT DISTINCT upper(replace(code, '_', '')) AS code_key FROM mkt_product WHERE active = true),
      camps AS (
        SELECT DISTINCT campaign_name FROM mkt_ads_cost
        WHERE deleted_at IS NULL AND date >= $1::date AND date <= $2::date AND campaign_name IS NOT NULL
        UNION
        SELECT DISTINCT ${campOf("po")} FROM pancake_order po
        WHERE ${MKT_ORDER_FILTER_SQL}
          AND po.pancake_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND po.pancake_created_at <  (($2::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
      )
      SELECT campaign_name FROM camps cc
      WHERE campaign_name IS NOT NULL AND campaign_name <> ''
        AND NOT EXISTS (SELECT 1 FROM prod p WHERE p.code_key = upper(split_part(cc.campaign_name, '_', 1)))
    `, [fromDate, toDate])).map((r: any) => r.campaign_name)

    const now = Date.now()
    const unseen = codeless.filter(c => !campHistCache.has(c))
    const stale = codeless.filter(c => { const e = campHistCache.get(c); return e && now - e.at > HIST_TTL_MS })
    if (unseen.length) await queryCampHist(cskhService, unseen, 30, campOf("po"), mainItemOf("po"))
    const toRefresh = [...new Set([...stale, ...unseen])]
    if (toRefresh.length && !histRefreshing) {
      histRefreshing = true
      queryCampHist(cskhService, toRefresh, 365, campOf("po"), mainItemOf("po"))
        .catch((e: any) => console.error("[report/mkt-product] camp_hist refresh", e.message))
        .finally(() => { histRefreshing = false })
    }
    const campHist: Record<string, string> = {}
    for (const c of codeless) { const it = campHistCache.get(c)?.item; if (it) campHist[c] = it }

    const rows = await cskhService.sql(`
      WITH handover AS (
        SELECT from_code, to_code, effective_from::date AS ef, effective_to::date AS et
        FROM mkt_handover WHERE deleted_at IS NULL
      ),
      prod AS (
        SELECT DISTINCT ON (upper(replace(code, '_', ''))) upper(replace(code, '_', '')) AS code_key, name
        FROM mkt_product WHERE active = true
        ORDER BY upper(replace(code, '_', '')), name
      ),
      spend_raw AS (
        SELECT c.campaign_name, ${handoverOf("c.mkt_name", "c.date")} AS mkt_name, c.spend
        FROM mkt_ads_cost c
        WHERE c.deleted_at IS NULL AND c.date >= $1::date AND c.date <= $2::date
      ),
      order_raw AS (
        SELECT po.id,
          (po.pancake_created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS d,
          ${MKT_OF_ORDER_SQL} AS mkt_raw,
          ${campOf("po")} AS campaign_name,
          ${ORDER_REVENUE_SQL} AS revenue,
          ${mainItemOf("po")} AS main_item
        FROM pancake_order po
        WHERE ${MKT_ORDER_FILTER_SQL}
          AND po.status NOT IN (-2, 7)
          AND po.pancake_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND po.pancake_created_at <  (($2::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
      ),
      camps AS (
        SELECT DISTINCT campaign_name FROM spend_raw WHERE campaign_name IS NOT NULL
        UNION
        SELECT DISTINCT campaign_name FROM order_raw WHERE campaign_name IS NOT NULL AND campaign_name <> ''
      ),
      -- Fallback cho camp không có mã SP: SP chính hay gặp nhất trong đơn của camp (tra sẵn ở
      -- trên qua cache, không giới hạn theo khoảng ngày báo cáo)
      camp_hist AS (
        SELECT key AS campaign_name, value AS main_item FROM jsonb_each_text($4::jsonb)
      ),
      camp_sp AS (
        SELECT cc.campaign_name, p.name AS sp_from_code, ch.main_item AS sp_from_orders
        FROM camps cc
        LEFT JOIN prod p ON p.code_key = upper(split_part(cc.campaign_name, '_', 1))
        LEFT JOIN camp_hist ch ON ch.campaign_name = cc.campaign_name
      ),
      spend_agg AS (
        SELECT s.mkt_name,
          COALESCE(cs.sp_from_code, cs.sp_from_orders, '${UNKNOWN_SP}') AS item_name,
          SUM(s.spend)::bigint AS spend,
          COUNT(DISTINCT s.campaign_name)::int AS camps
        FROM spend_raw s
        LEFT JOIN camp_sp cs ON cs.campaign_name = s.campaign_name
        GROUP BY 1, 2
        UNION ALL
        SELECT ${handoverOf("g.mkt_name", "g.date")} AS mkt_name, '${GG_SP}', SUM(g.cost)::bigint, 0
        FROM mkt_ads_cost_gg g
        WHERE g.deleted_at IS NULL AND g.date >= $1::date AND g.date <= $2::date
        GROUP BY 1
      ),
      order_agg AS (
        SELECT ${handoverOf("o.mkt_raw", "o.d")} AS mkt_name,
          COALESCE(cs.sp_from_code, o.main_item, 'KHÔNG CÓ SP') AS item_name,
          COUNT(*)::int AS don,
          SUM(o.revenue)::bigint AS doanh_so
        FROM order_raw o
        LEFT JOIN camp_sp cs ON cs.campaign_name = o.campaign_name
        GROUP BY 1, 2
      ),
      combined AS (
        SELECT
          COALESCE(sa.mkt_name, oa.mkt_name) AS mkt_name,
          COALESCE(sa.item_name, oa.item_name) AS item_name,
          COALESCE(sa.spend, 0) AS spend,
          COALESCE(sa.camps, 0) AS camps,
          COALESCE(oa.don, 0) AS don,
          COALESCE(oa.doanh_so, 0) AS doanh_so
        FROM (SELECT mkt_name, item_name, SUM(spend)::bigint AS spend, SUM(camps)::int AS camps
              FROM spend_agg GROUP BY 1, 2) sa
        FULL OUTER JOIN order_agg oa USING (mkt_name, item_name)
      )
      SELECT mkt_name, item_name, spend, camps, don,
        CASE WHEN don > 0 THEN spend / don ELSE 0 END AS chi_phi_don,
        doanh_so,
        CASE WHEN doanh_so > 0 THEN ROUND(spend::numeric / doanh_so * 100, 1) ELSE NULL END AS pct_ads
      FROM combined
      WHERE ($3 = '' OR mkt_name = $3)
        AND (spend > 0 OR don > 0)
      ORDER BY mkt_name, spend DESC
    `, [fromDate, toDate, mkt, JSON.stringify(campHist)])

    // Freelancer chỉ thấy dòng mang mã MKT của mình (giống report/mkt)
    const scope = getOwnScope(req)
    const ownRows = rows.filter((r: any) => !scope || scope.mktCodes.includes(String(r.mkt_name ?? "").toUpperCase()))

    // Gộp theo SP (mọi MKT) — trả lời "SP này còn đáng chạy không"
    const byProduct: Record<string, any> = {}
    for (const r of ownRows) {
      const p = (byProduct[r.item_name] ||= { item_name: r.item_name, spend: 0, camps: 0, don: 0, doanh_so: 0, mkts: [] as string[] })
      p.spend += Number(r.spend)
      p.camps += Number(r.camps)
      p.don += Number(r.don)
      p.doanh_so += Number(r.doanh_so)
      if (r.mkt_name && !p.mkts.includes(r.mkt_name)) p.mkts.push(r.mkt_name)
    }
    const products = Object.values(byProduct).map((p: any) => ({
      ...p,
      chi_phi_don: p.don > 0 ? Math.round(p.spend / p.don) : 0,
      pct_ads: p.doanh_so > 0 ? Math.round(p.spend / p.doanh_so * 1000) / 10 : null,
    })).sort((a: any, b: any) => b.spend - a.spend)

    return res.json({ rows: ownRows, products, from: fromDate, to: toDate, mkt: mkt || null })
  } catch (err: any) {
    console.error("[report/mkt-product]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
