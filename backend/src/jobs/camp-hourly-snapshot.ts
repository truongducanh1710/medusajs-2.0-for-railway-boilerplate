import { MedusaContainer } from "@medusajs/framework"

/**
 * Job: Lưu snapshot intraday mỗi giờ (5 phút sau giờ tròn).
 * Copy data từ mkt_ads_cost (đang được sync mỗi 5 phút) sang camp_hourly_snapshot
 * với hour hiện tại — giữ history theo giờ để agent dự đoán cuối ngày.
 */
export default async function campHourlySnapshot(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  const sql = container.resolve("cskhAnalysisModule") as any

  // Giờ VN = UTC + 7
  const now = new Date()
  const vnNow = new Date(now.getTime() + 7 * 3600 * 1000)
  const vnHour = vnNow.getUTCHours()
  const vnDate = vnNow.toISOString().slice(0, 10)

  try {
    const result = await sql.sql(
      `INSERT INTO camp_hourly_snapshot
         (date, hour, campaign_id, campaign_name, mkt_name,
          spend, impressions, clicks, effective_status, daily_budget)
       SELECT date, $1, campaign_id, campaign_name, mkt_name,
              spend, impressions, clicks, effective_status, daily_budget
       FROM mkt_ads_cost
       WHERE date = $2 AND deleted_at IS NULL
       ON CONFLICT (date, hour, campaign_id) DO UPDATE SET
         spend = EXCLUDED.spend,
         impressions = EXCLUDED.impressions,
         clicks = EXCLUDED.clicks,
         effective_status = EXCLUDED.effective_status,
         daily_budget = EXCLUDED.daily_budget
       RETURNING id`,
      [vnHour, vnDate]
    )
    logger?.info?.(`[HourlySnapshot] date=${vnDate} hour=${vnHour} → ${result.length} camps`)
  } catch (e: any) {
    logger?.error?.("[HourlySnapshot] error:", e.message)
  }
}

export const config = {
  name: "camp-hourly-snapshot",
  schedule: "5 * * * *",   // 5 phút sau mỗi giờ tròn
}
