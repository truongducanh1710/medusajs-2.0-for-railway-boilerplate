// ============================================================================
// Sync "Hiệu quả" theo ad/ngày → mkt_ads_video (hook rate, thruplay theo VD).
// Dùng chung cho POST /admin/pancake-sync/report/video-performance (bấm tay) và
// job video-performance-daily-sync (tự chạy mỗi tối cho hôm qua + hôm nay, giờ VN).
// ============================================================================

import { fbFetchJson } from "./fb-fetch"
import { extractVdCode } from "./mkt-cost-levels"

const FB_API_BASE = "https://graph.facebook.com/v25.0"

/** Lấy action value theo type từ mảng actions của FB insights. */
function actionVal(actions: any[] | undefined, type: string): number {
  if (!Array.isArray(actions)) return 0
  const a = actions.find((x) => x.action_type === type)
  return a ? Number(a.value || 0) : 0
}

/** "YYYY-MM-DD" theo giờ VN (UTC+7), lệch offsetDays ngày. Không parse chuỗi ngày trần bằng new Date(). */
export function dateVN(offsetDays = 0): string {
  return new Date(Date.now() + 7 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10)
}

export type VideoPerfResult = { date: string; synced: number; withVd: number; errors: number }

/**
 * Pull insights level=ad của mọi tài khoản active cho 1 ngày (YYYY-MM-DD giờ VN) → upsert mkt_ads_video.
 * Tài khoản tuần tự (1 request/lúc) để không dồn rate limit với các job cost.
 */
export async function syncVideoPerformance(cskhService: any, token: string, date: string): Promise<VideoPerfResult> {
  const timeRange = encodeURIComponent(JSON.stringify({ since: date, until: date }))
  const dbAccounts = await cskhService.sql(`
    SELECT account_id FROM fb_ad_account WHERE deleted_at IS NULL AND active = true ORDER BY created_at ASC
  `)

  let synced = 0, errors = 0, withVd = 0
  const fields = "ad_id,ad_name,spend,impressions,clicks,ctr,cpm,actions,video_thruplay_watched_actions"

  for (const { account_id: rawAccount } of dbAccounts) {
    const actId = rawAccount.startsWith("act_") ? rawAccount : `act_${rawAccount.replace(/^act_/, "")}`
    let nextUrl: string | null = `${FB_API_BASE}/${actId}/insights?level=ad&fields=${fields}&time_range=${timeRange}&limit=200&access_token=${token}`
    try {
      while (nextUrl) {
        const data: any = await fbFetchJson(nextUrl, { label: "video-perf" })
        if (data.error) { console.error(`[video-perf] FB error ${actId} date=${date}:`, data.error.message); errors++; break }
        for (const ad of data.data ?? []) {
          const spend = Math.round(Number(ad.spend ?? 0))
          const vdCode = extractVdCode(ad.ad_name ?? "")
          if (vdCode) withVd++
          const impressions = Number(ad.impressions ?? 0)
          const clicks = Number(ad.clicks ?? 0)
          const ctr = Number(ad.ctr ?? 0)
          const cpm = Number(ad.cpm ?? 0)
          // Lượt xem 3 giây = actions[video_view]. KHÔNG lấy video_play_actions: đó là lượt BẮT ĐẦU phát
          // (mọi thời lượng) → hook rate bị thổi; bản cũ ưu tiên nhầm field này (bảng chưa có dòng nào).
          const v3s = actionVal(ad.actions, "video_view")
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
    } catch (e: any) { console.error(`[video-perf] account ${actId} date=${date}:`, e.message); errors++ }
  }

  return { date, synced, withVd, errors }
}
