import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getOwnScope } from "../../../../../lib/freelance-scope"
import { syncVideoPerformance, dateVN } from "../../../../../lib/video-performance"

const FB_TOKEN = process.env.FB_SYSTEM_TOKEN || process.env.FB_ACCESS_TOKEN || ""

/**
 * GET /admin/pancake-sync/report/video-performance?from=&to=
 * Hiệu quả per video: GROUP BY vd_code (SUM mọi ad cùng vd_code, across accounts),
 * JOIN mkt_video (người làm/loại/SP) + đếm đơn confirmed theo campaign (best-effort).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const {
      from = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
      to = new Date().toISOString().slice(0, 10),
    } = req.query as Record<string, string>

    const cskhService = req.scope.resolve("cskhAnalysisModule") as any

    const params: any[] = [from, to]
    // Freelancer: chỉ cộng các AD của chính họ (ad_name mang tiền tố mã MKT của họ) —
    // lọc theo ad chứ không theo video, vì một video có thể được MKT khác chạy ad.
    let own = ""
    const scope = getOwnScope(req)
    if (scope) {
      params.push(scope.mktCodes)
      own = `AND upper(split_part(av.ad_name, '_', 1)) = ANY($3::text[])`
    }

    const rows = await cskhService.sql(`
      SELECT
        av.vd_code,
        SUM(av.spend)::bigint            AS spend,
        SUM(av.impressions)::bigint      AS impressions,
        SUM(av.clicks)::bigint           AS clicks,
        SUM(av.video_3s)::bigint         AS video_3s,
        SUM(av.video_thruplay)::bigint   AS video_thruplay,
        COUNT(DISTINCT av.ad_id)::int    AS ad_count,
        COUNT(DISTINCT av.account_id)::int AS account_count,
        v.maker, v.product, v.video_type, v.source
      FROM mkt_ads_video av
      LEFT JOIN mkt_video v ON v.vd_code = av.vd_code
      WHERE av.stat_date >= $1::date AND av.stat_date <= $2::date
        AND av.vd_code IS NOT NULL
        ${own}
      GROUP BY av.vd_code, v.maker, v.product, v.video_type, v.source
      ORDER BY spend DESC
    `, params)

    const result = rows.map((r: any) => {
      const impressions = Number(r.impressions) || 0
      const spend = Number(r.spend) || 0
      const clicks = Number(r.clicks) || 0
      const v3s = Number(r.video_3s) || 0
      const thru = Number(r.video_thruplay) || 0
      return {
        vdCode: r.vd_code,
        maker: r.maker || "—",
        product: r.product || "—",
        videoType: r.video_type || "—",
        spend,
        impressions,
        clicks,
        adCount: r.ad_count,
        accountCount: r.account_count,
        ctr: impressions ? +(clicks / impressions * 100).toFixed(2) : 0,
        cpm: impressions ? Math.round(spend / impressions * 1000) : 0,
        hookRate: impressions ? +(v3s / impressions * 100).toFixed(1) : 0,
        thruplayRate: impressions ? +(thru / impressions * 100).toFixed(1) : 0,
      }
    })

    return res.json({ rows: result, from, to })
  } catch (err: any) {
    console.error("[video-performance GET]", err.message)
    return res.status(500).json({ error: err.message })
  }
}

/**
 * POST /admin/pancake-sync/report/video-performance
 * Body: { date?: "2026-06-03" } — sync ad-level insights → mkt_ads_video (mặc định hôm nay giờ VN).
 * Job video-performance-daily-sync tự chạy mỗi tối cho hôm qua + hôm nay; route này để bấm tay ngày khác.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    if (!FB_TOKEN) return res.status(400).json({ error: "FB_ACCESS_TOKEN chưa được cấu hình" })
    const body = req.body as any
    const date = (body?.date as string) || dateVN()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "date phải dạng YYYY-MM-DD" })
    const cskhService = req.scope.resolve("cskhAnalysisModule") as any

    const [{ n }] = await cskhService.sql(`SELECT count(*)::int n FROM fb_ad_account WHERE deleted_at IS NULL AND active = true`)
    if (!n) return res.status(400).json({ error: "Chưa có tài khoản FB Ads nào" })

    const r = await syncVideoPerformance(cskhService, FB_TOKEN, date)
    return res.json({ ok: true, ...r })
  } catch (err: any) {
    console.error("[video-performance POST]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
