import { MedusaContainer } from "@medusajs/framework"

/**
 * Job: Tự đổi rec pending > 6h sang status='expired'
 * Tránh marketer thấy rec cũ stale, agent không recommend lại vì status không phải 'pending'
 */
export default async function expireAgentRecs(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  const sql = container.resolve("cskhAnalysisModule") as any

  const result = await sql.sql(`
    UPDATE agent_camp_recommendation
    SET status = 'expired'
    WHERE status = 'pending'
      AND created_at < now() - interval '6 hours'
    RETURNING id
  `).catch((e: any) => {
    logger?.error?.("[ExpireAgentRecs] error:", e.message)
    return []
  })

  if (Array.isArray(result) && result.length > 0) {
    logger?.info?.(`[ExpireAgentRecs] Expired ${result.length} pending recs > 6h`)
  }
}

export const config = {
  name: "expire-agent-recs",
  schedule: "0 * * * *", // Mỗi giờ
}
