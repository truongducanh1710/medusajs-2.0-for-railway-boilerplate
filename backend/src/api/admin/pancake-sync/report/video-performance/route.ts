import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

const FB_API_BASE = "https://graph.facebook.com/v25.0"
const FB_TOKEN = process.env.FB_SYSTEM_TOKEN || process.env.FB_ACCESS_TOKEN || ""

/** Parse VD-code (VD + số) từ ad_name. Trả null nếu không có. */
function extractVdCode(adName: string): string | null {
  const m = (adName || "").match(/VD\d+/i)
  return m ? m[0].toUpperCase() : null
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url)
  return res.json()
}

/** Lấy action value theo type từ mảng actions của FB insights. */
function actionVal(actions: any[] | undefined, type: string): number {
  if (!Array.isArray(actions)) return 0
  const a = actions.find((x) => x.action_type === type)
  return a ? Number(a.value || 0) : 0
}

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
      GROUP BY av.vd_code, v.maker, v.product, v.video_type, v.source
      ORDER BY spend DESC
    `, [from, to])

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
 * Body: { date?: "2026-06-03" } — sync ad-level insights → mkt_ads_video.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    if (!FB_TOKEN) return res.status(400).json({ error: "FB_ACCESS_TOKEN chưa được cấu hình" })
    const body = req.body as any
    const date = (body?.date as string) || new Date().toISOString().slice(0, 10)
    const timeRange = encodeURIComponent(JSON.stringify({ since: date, until: date }))
    const cskhService = req.scope.resolve("cskhAnalysisModule") as any

    const dbAccounts = await cskhService.sql(`
      SELECT account_id FROM fb_ad_account WHERE deleted_at IS NULL AND active = true ORDER BY created_at ASC
    `)
    if (!dbAccounts.length) return res.status(400).json({ error: "Chưa có tài khoản FB Ads nào" })

    let synced = 0, errors = 0, withVd = 0
    const fields = "ad_id,ad_name,spend,impressions,clicks,ctr,cpm,actions,video_play_actions,video_thruplay_watched_actions"

    for (const { account_id: rawAccount } of dbAccounts) {
      const actId = rawAccount.startsWith("act_") ? rawAccount : `act_${rawAccount.replace(/^act_/, "")}`
      let nextUrl: string | null = `${FB_API_BASE}/${actId}/insights?level=ad&fields=${fields}&time_range=${timeRange}&limit=200&access_token=${FB_TOKEN}`
      try {
        while (nextUrl) {
          const data: any = await fetchJson(nextUrl)
          if (data.error) { console.error(`[video-perf] FB error ${actId}:`, data.error.message); errors++; break }
          for (const ad of data.data ?? []) {
            const spend = Math.round(Number(ad.spend ?? 0))
            const vdCode = extractVdCode(ad.ad_name ?? "")
            if (vdCode) withVd++
            const impressions = Number(ad.impressions ?? 0)
            const clicks = Number(ad.clicks ?? 0)
            const ctr = Number(ad.ctr ?? 0)
            const cpm = Number(ad.cpm ?? 0)
            // 3s plays
            const v3s = actionVal(ad.video_play_actions, "video_view") || actionVal(ad.actions, "video_view")
            // thruplay
            const thru = actionVal(ad.video_thruplay_watched_actions, "video_view")

            await cskhService.sql(`
              INSERT INTO mkt_ads_video (ad_id, ad_name, vd_code, account_id, stat_date, spend, impressions, clicks, ctr, cpm, video_3s, video_thruplay, updated_at)
              VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10,$11,$12, now())
              ON CONFLICT (ad_id, stat_date) DO UPDATE SET
                ad_name = EXCLUDED.ad_name, vd_code = EXCLUDED.vd_code, account_id = EXCLUDED.account_id,
                spend = EXCLUDED.spend, impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks,
                ctr = EXCLUDED.ctr, cpm = EXCLUDED.cpm, video_3s = EXCLUDED.video_3s,
                video_thruplay = EXCLUDED.video_thruplay, updated_at = now()
            `, [ad.ad_id, ad.ad_name ?? "", vdCode, actId, date, spend, impressions, clicks, ctr, cpm, v3s, thru])
            synced++
          }
          nextUrl = data.paging?.next ?? null
        }
      } catch (e: any) { console.error(`[video-perf] account ${actId}:`, e.message); errors++ }
    }

    return res.json({ ok: true, date, synced, withVd, errors })
  } catch (err: any) {
    console.error("[video-performance POST]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
