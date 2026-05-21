import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/pancake-sync/logs/stats
 * Trả về: status distribution từ DB, cron summary 24h, webhook summary 24h
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const cskhService = req.scope.resolve("cskhAnalysisModule") as any
    const syncService = req.scope.resolve("pancakeSyncModule") as any

    // Status counts từ DB
    const statusCounts = await cskhService.sql(`
      SELECT status, status_name, COUNT(*) as count
      FROM pancake_order
      WHERE deleted_at IS NULL
      GROUP BY status, status_name
      ORDER BY count DESC
    `).catch(() => [])

    // Cron stats 24h
    const cronStats = await cskhService.sql(`
      SELECT
        COUNT(*) as total_runs,
        SUM(total_orders) as total_orders,
        SUM(total_updated) as total_updated,
        SUM(total_created) as total_created,
        SUM(total_errors) as total_errors,
        AVG(duration_ms) as avg_duration_ms,
        MAX(started_at) as last_run_at
      FROM pancake_cron_log
      WHERE started_at > NOW() - INTERVAL '24 hours'
        AND deleted_at IS NULL
    `).catch(() => [{}])

    // Webhook stats 24h
    const webhookStats = await cskhService.sql(`
      SELECT
        COUNT(*) as total_events,
        COUNT(*) FILTER (WHERE upsert_success = true) as success,
        COUNT(*) FILTER (WHERE fallback_used = true) as fallback,
        COUNT(*) FILTER (WHERE upsert_success = false OR error_message IS NOT NULL) as failed,
        AVG(duration_ms) as avg_duration_ms,
        MAX(received_at) as last_event_at
      FROM pancake_webhook_log
      WHERE received_at > NOW() - INTERVAL '24 hours'
        AND deleted_at IS NULL
    `).catch(() => [{}])

    // Last sync time
    const lastSync = await cskhService.sql(`
      SELECT MAX(synced_at) as last_sync FROM pancake_order WHERE deleted_at IS NULL
    `).catch(() => [{}])

    return res.json({
      status_counts: statusCounts,
      cron_24h: cronStats[0] ?? {},
      webhook_24h: webhookStats[0] ?? {},
      last_sync_at: lastSync[0]?.last_sync ?? null,
    })
  } catch (err: any) {
    console.error("[pancake-sync/logs/stats]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
