import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/pancake-sync/report/mkt-cost-status
 * Trả về trạng thái sync chi phí FB Ads hôm nay:
 * - Lần sync gần nhất (updated_at mới nhất trong mkt_ads_cost)
 * - Tổng campaigns đã sync hôm nay
 * - Số accounts có data
 * - Có lỗi không (account nào missing so với fb_ad_account)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const cskhService = req.scope.resolve("cskhAnalysisModule") as any
    const today = new Date().toISOString().slice(0, 10)

    const [todayStats, lastSync, activeAccounts, accountsWithData] = await Promise.all([
      // Tổng campaigns + spend hôm nay
      cskhService.sql(`
        SELECT
          COUNT(DISTINCT campaign_id)::int AS campaigns,
          COUNT(DISTINCT ad_account_id)::int AS accounts_with_data,
          SUM(spend)::bigint AS total_spend,
          MAX(updated_at) AS last_updated
        FROM mkt_ads_cost
        WHERE deleted_at IS NULL AND date = $1::date
      `, [today]),

      // Lần sync gần nhất (bất kỳ ngày nào)
      cskhService.sql(`
        SELECT MAX(updated_at) AS last_sync FROM mkt_ads_cost WHERE deleted_at IS NULL
      `),

      // Số accounts active trong DB
      cskhService.sql(`
        SELECT COUNT(*)::int AS total FROM fb_ad_account WHERE deleted_at IS NULL AND active = true
      `),

      // Accounts đã có data hôm nay
      cskhService.sql(`
        SELECT DISTINCT ad_account_id FROM mkt_ads_cost
        WHERE deleted_at IS NULL AND date = $1::date
      `, [today]),
    ])

    const stats = todayStats[0] ?? {}
    const totalActive = activeAccounts[0]?.total ?? 0
    const accountsWithDataToday = accountsWithData.length
    const missingAccounts = totalActive - accountsWithDataToday

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
      accounts_active: totalActive,
      missing_accounts: missingAccounts,
      last_updated: lastUpdated,
      minutes_ago: minutesAgo,
    })
  } catch (err: any) {
    console.error("[mkt-cost-status]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
