import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/pancake-sync/report/mkt-cost-status
 * Trả về trạng thái sync chi phí FB Ads hôm nay:
 * - Lần sync gần nhất (updated_at mới nhất trong mkt_ads_cost)
 * - Tổng campaigns đã sync hôm nay
 * - Số accounts có data
 * - Có lỗi không (account nào missing so với fb_ad_account)
 */
// Giờ VN UTC+7
function todayVN(): string {
  const now = new Date()
  now.setMinutes(now.getMinutes() + now.getTimezoneOffset() + 420)
  return now.toISOString().slice(0, 10)
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const cskhService = req.scope.resolve("cskhAnalysisModule") as any
    const today = todayVN()

    const [todayStats, lastSync, accountsWithData, permErrorAccounts] = await Promise.all([
      // Tổng campaigns + spend hôm nay (theo giờ VN)
      cskhService.sql(`
        SELECT
          COUNT(DISTINCT campaign_id)::int AS campaigns,
          COUNT(DISTINCT ad_account_id)::int AS accounts_with_data,
          SUM(spend)::bigint AS total_spend,
          MAX(updated_at) AS last_updated
        FROM mkt_ads_cost
        WHERE deleted_at IS NULL
          AND (date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = $1::date
      `, [today]),

      // Lần sync gần nhất (bất kỳ ngày nào)
      cskhService.sql(`
        SELECT MAX(updated_at) AS last_sync FROM mkt_ads_cost WHERE deleted_at IS NULL
      `),

      // Accounts đã có data hôm nay (theo giờ VN)
      cskhService.sql(`
        SELECT DISTINCT ad_account_id FROM mkt_ads_cost
        WHERE deleted_at IS NULL
          AND (date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = $1::date
      `, [today]),

      // Accounts có spend 7 ngày qua nhưng không có hôm nay = thực sự missing
      cskhService.sql(`
        SELECT DISTINCT a.account_id
        FROM fb_ad_account a
        WHERE a.deleted_at IS NULL AND a.active = true
          AND EXISTS (
            SELECT 1 FROM mkt_ads_cost m
            WHERE m.ad_account_id = a.account_id
              AND (m.date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= $1::date - 7
              AND m.spend > 0
          )
          AND NOT EXISTS (
            SELECT 1 FROM mkt_ads_cost m
            WHERE m.ad_account_id = a.account_id
              AND (m.date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = $1::date
          )
      `, [today]),
    ])

    const stats = todayStats[0] ?? {}
    const accountsWithDataToday = accountsWithData.length
    // Chỉ cảnh báo account có spend 7 ngày qua nhưng hôm nay mất — không đếm account PAUSED hoàn toàn
    const missingAccounts = permErrorAccounts.length

    const lastUpdated = stats.last_updated ?? lastSync[0]?.last_sync ?? null
    const minutesAgo = lastUpdated
      ? Math.floor((Date.now() - new Date(lastUpdated).getTime()) / 60000)
      : null

    const status = minutesAgo === null ? "unknown"
      : minutesAgo <= 10 ? "ok"
      : minutesAgo <= 30 ? "warning"
      : "error"

    return res.json({
      status,           // ok | warning | error | unknown
      today,
      campaigns_today: stats.campaigns ?? 0,
      total_spend_today: stats.total_spend ?? 0,
      accounts_with_data: accountsWithDataToday,
      accounts_active: accountsWithDataToday + missingAccounts,
      missing_accounts: missingAccounts,
      last_updated: lastUpdated,
      minutes_ago: minutesAgo,
    })
  } catch (err: any) {
    console.error("[mkt-cost-status]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
