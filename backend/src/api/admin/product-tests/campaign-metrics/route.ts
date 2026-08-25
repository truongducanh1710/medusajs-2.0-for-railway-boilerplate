import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { getPool } from "../../../../lib/db";
import {
  apiError,
  getProductTestActor,
  PRODUCT_TEST_PERMS,
  requireActorPermission,
} from "../_lib";

/**
 * GET /admin/product-tests/campaign-metrics?campaign=<tên>&date=YYYY-MM-DD
 *
 * Trả số liệu ads của campaign trong đúng ngày đó để MKT khỏi gõ tay lại.
 *
 * Nguồn: bảng `mkt_ads_cost` — chính bảng trang bao-cao-mkt đang đọc, được job
 * mkt-cost-intraday-sync cập nhật mỗi 5 phút. Không gọi thẳng Facebook API để
 * số ở đây luôn khớp số ở báo cáo, và không tốn thêm quota Graph.
 *
 * Khớp tên campaign KHÔNG phân biệt hoa thường và cho phép khớp một phần
 * (ILIKE %...%) vì MKT hay gõ thiếu/thừa khoảng trắng so với tên thật trên FB.
 * Nhiều camp cùng khớp thì cộng dồn và trả về danh sách tên để người dùng biết.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const actor = await getProductTestActor(req);
    if (!actor) return res.status(401).json({ error: "Unauthenticated" });
    requireActorPermission(actor, PRODUCT_TEST_PERMS.view);

    const q = req.query as Record<string, string>;
    const campaign = String(q.campaign ?? "").trim();
    const date = String(q.date ?? "").trim();

    if (!campaign)
      return res.status(400).json({ error: "Thiếu tên campaign" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      return res.status(400).json({ error: "Ngày không hợp lệ" });

    const { rows } = await getPool().query(
      `SELECT
         COALESCE(SUM(spend), 0)::bigint      AS spend,
         COALESCE(SUM(impressions), 0)::int   AS impressions,
         COALESCE(SUM(clicks), 0)::int        AS clicks,
         COUNT(DISTINCT campaign_id)::int     AS campaign_count,
         ARRAY_AGG(DISTINCT campaign_name)    AS campaign_names
       FROM mkt_ads_cost
       WHERE deleted_at IS NULL
         AND date = $1::date
         AND campaign_name ILIKE '%' || $2 || '%'`,
      [date, campaign],
    );

    const row = rows[0] ?? {};
    const spend = Number(row.spend ?? 0);
    const impressions = Number(row.impressions ?? 0);
    const clicks = Number(row.clicks ?? 0);
    const found = Number(row.campaign_count ?? 0) > 0;

    return res.json({
      found,
      date,
      campaign_count: Number(row.campaign_count ?? 0),
      campaign_names: found ? row.campaign_names ?? [] : [],
      metrics: {
        ad_spend: spend,
        impressions,
        clicks,
        // Cùng công thức với report/mkt-campaign để hai nơi không ra số khác nhau.
        cpm: impressions > 0 ? Math.round((spend / impressions) * 1000) : null,
        ctr_pct:
          impressions > 0
            ? Math.round((clicks / impressions) * 10000) / 100
            : null,
        cpc: clicks > 0 ? Math.round(spend / clicks) : null,
      },
    });
  } catch (error) {
    return apiError(res, error);
  }
}
