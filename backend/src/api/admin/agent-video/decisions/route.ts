import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool } from "../../../../lib/db"
import { getOwnScope, ownAgentVideoSql } from "../../../../lib/freelance-scope"

/**
 * GET /admin/agent-video/decisions?vd_code=&action=&limit=
 *
 * Nhật ký quyết định — nơi trả lời "agent đã làm gì và vì sao".
 * Kèm bảng tổng kết theo LUẬT: luật nào đang sai nhiều thì ngưỡng của nó cần sửa.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    const { vd_code, action, limit } = req.query as Record<string, string>

    const dk: string[] = []
    const val: any[] = []
    // Freelancer: chỉ nhật ký + thống kê trên video của mình.
    const scope = getOwnScope(req)
    const ownVal: any[] = scope ? [scope.email, scope.mktCodes] : []
    // Phải ghi rõ tên bảng: vd_code trần bên trong subquery sẽ bị hiểu là cột của chính
    // subquery (mkt_video cũng có vd_code) → điều kiện luôn đúng, lọc mất tác dụng.
    const own = scope ? `AND ${ownAgentVideoSql("video_decision_log.vd_code", "$1", "$2")}` : ""
    if (scope) {
      val.push(scope.email, scope.mktCodes)
      dk.push(ownAgentVideoSql("l.vd_code", `$${val.length - 1}`, `$${val.length}`))
    }
    if (vd_code) { val.push(vd_code); dk.push(`l.vd_code = $${val.length}`) }
    if (action && action !== "all") { val.push(action); dk.push(`l.action = $${val.length}`) }
    val.push(Math.min(Number(limit) || 100, 500))

    const { rows } = await pool.query(`
      SELECT
        l.id, l.run_id, l.vd_code, l.action, l.reason, l.rule_hit,
        l.budget_before, l.budget_after, l.metrics, l.executed,
        l.error, l.outcome_roas_7d, l.outcome_verdict, l.evaluated_at,
        l.created_at,
        s.phase, s.daily_budget AS budget_hien_tai
      FROM video_decision_log l
      LEFT JOIN video_budget_state s ON s.vd_code = l.vd_code
      ${dk.length ? "WHERE " + dk.join(" AND ") : ""}
      ORDER BY l.created_at DESC
      LIMIT $${val.length}
    `, val)

    // Hiệu quả từng luật — chỉ tính luật đã áp dụng đủ 5 lần, dưới đó chưa đủ mẫu.
    const { rows: theoLuat } = await pool.query(`
      SELECT
        rule_hit,
        COUNT(*)                                              AS tong,
        COUNT(*) FILTER (WHERE outcome_verdict = 'correct')   AS dung,
        COUNT(*) FILTER (WHERE outcome_verdict = 'wrong')     AS sai,
        COUNT(*) FILTER (WHERE outcome_verdict = 'neutral')   AS trung_tinh,
        COUNT(*) FILTER (WHERE evaluated_at IS NULL)          AS cho_cham,
        ROUND(COUNT(*) FILTER (WHERE outcome_verdict = 'correct') * 100.0
              / NULLIF(COUNT(*) FILTER (WHERE evaluated_at IS NOT NULL), 0), 0) AS pct_dung
      FROM video_decision_log
      WHERE rule_hit IS NOT NULL AND created_at > now() - interval '60 days'
        ${own}
      GROUP BY 1
      HAVING COUNT(*) >= 5
      ORDER BY tong DESC
    `, ownVal)

    const { rows: hom_nay } = await pool.query(`
      SELECT
        COUNT(*)                                        AS tong,
        COUNT(*) FILTER (WHERE action = 'kill')         AS kill,
        COUNT(*) FILTER (WHERE action = 'scale_up')     AS scale_up,
        COUNT(*) FILTER (WHERE action = 'hold')         AS hold,
        COUNT(*) FILTER (WHERE action = 'start_test')   AS start_test,
        COUNT(*) FILTER (WHERE executed = true)         AS da_thuc_thi,
        COUNT(*) FILTER (WHERE error IS NOT NULL)       AS co_loi
      FROM video_decision_log
      WHERE created_at > now() - interval '24 hours'
        ${own}
    `, ownVal)

    return res.json({
      decisions: rows,
      rules: theoLuat,
      today: hom_nay[0] ?? {},
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
