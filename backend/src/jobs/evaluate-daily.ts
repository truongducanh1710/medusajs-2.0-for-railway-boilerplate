import { MedusaContainer } from "@medusajs/framework"

/**
 * Job 23:05 mỗi ngày: evaluate tất cả predictions trong ngày
 * - So sánh predicted vs actual EOD spend/COD/care
 * - Tính prediction_correct (care_error < 5%)
 * - Update skill confidence dựa trên outcome
 * - Auto-invalidate skills sai quá nhiều
 */
export default async function evaluateDaily(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  const sql = container.resolve("cskhAnalysisModule") as any

  const now = new Date()
  const vnNow = new Date(now.getTime() + 7 * 3600 * 1000)
  const vnDate = vnNow.toISOString().slice(0, 10)

  try {
    // 1. Lấy predictions chưa eval cho ngày hôm nay
    const preds = await sql.sql(
      `SELECT id, scope, scope_id, predicted_eod_spend, predicted_eod_cod,
              predicted_eod_care, skills_used
       FROM agent_prediction
       WHERE date = $1 AND evaluated_at IS NULL`,
      [vnDate]
    ).catch(() => [])

    if (!preds.length) {
      logger?.info?.(`[EvalDaily] No predictions to evaluate for ${vnDate}`)
      return
    }

    let correctCount = 0
    let wrongCount = 0
    const skillOutcomes: Map<string, { correct: number; wrong: number }> = new Map()

    for (const p of preds) {
      // 2. Lấy actual EOD cho scope tương ứng
      let actualSpend = 0
      let actualCod = 0

      if (p.scope === "shop") {
        const r = await sql.sql(
          `SELECT total_spend, total_cod FROM v_shop_care_daily WHERE date = $1`,
          [vnDate]
        ).catch(() => [])
        actualSpend = Number(r[0]?.total_spend ?? 0)
        actualCod = Number(r[0]?.total_cod ?? 0)
      } else if (p.scope === "mkt" && p.scope_id) {
        const r = await sql.sql(
          `SELECT spend, cod_amount FROM v_mkt_daily WHERE mkt_name = $1 AND date = $2`,
          [p.scope_id, vnDate]
        ).catch(() => [])
        actualSpend = Number(r[0]?.spend ?? 0)
        actualCod = Number(r[0]?.cod_amount ?? 0)
      } else if (p.scope === "camp" && p.scope_id) {
        const r = await sql.sql(
          `SELECT spend_today, cod_today FROM v_camp_dashboard WHERE campaign_id = $1`,
          [p.scope_id]
        ).catch(() => [])
        actualSpend = Number(r[0]?.spend_today ?? 0)
        actualCod = Number(r[0]?.cod_today ?? 0)
      }

      const actualCare = actualCod > 0 ? Math.round((actualSpend / actualCod) * 1000) / 10 : null
      const predCare = Number(p.predicted_eod_care)

      const careErrorPct = (actualCare !== null && predCare > 0)
        ? Math.abs(actualCare - predCare) / Math.max(actualCare, 1) * 100
        : null

      const correct = careErrorPct !== null && careErrorPct < 5

      await sql.sql(
        `UPDATE agent_prediction
         SET actual_eod_spend = $1, actual_eod_cod = $2, actual_eod_care = $3,
             care_error_pct = $4, prediction_correct = $5, evaluated_at = now()
         WHERE id = $6`,
        [actualSpend, actualCod, actualCare, careErrorPct, correct, p.id]
      ).catch(() => {})

      if (correct === true) correctCount++
      else if (correct === false) wrongCount++

      // 3. Track skills_used outcomes
      const skills: string[] = Array.isArray(p.skills_used) ? p.skills_used : []
      for (const sid of skills) {
        if (!skillOutcomes.has(sid)) skillOutcomes.set(sid, { correct: 0, wrong: 0 })
        const o = skillOutcomes.get(sid)!
        if (correct === true) o.correct++
        else if (correct === false) o.wrong++
      }
    }

    // 4. Update skill confidence
    for (const [sid, o] of skillOutcomes) {
      const delta = (o.correct * 3) - (o.wrong * 5)
      await sql.sql(
        `UPDATE agent_insight
         SET times_correct = times_correct + $1,
             times_wrong   = times_wrong + $2,
             confidence_pct = GREATEST(10, LEAST(95, confidence_pct + $3)),
             last_used_at = now()
         WHERE id = $4`,
        [o.correct, o.wrong, delta, sid]
      ).catch(() => {})
    }

    // 5. Auto-invalidate skills confidence < 30 + nhiều lần sai
    const invalidated = await sql.sql(
      `UPDATE agent_insight
       SET active = false,
           invalidated_at = now(),
           invalidation_reason = 'auto: confidence < 30 và times_wrong > times_correct + 3'
       WHERE active = true
         AND skill_type = 'skill'
         AND confidence_pct < 30
         AND times_wrong > times_correct + 3
       RETURNING id`
    ).catch(() => [])

    // 6. Save 1 insight tổng kết ngày
    const shopRow = await sql.sql(
      `SELECT total_spend, total_cod, care_pct FROM v_shop_care_daily WHERE date = $1`,
      [vnDate]
    ).catch(() => [])

    if (shopRow.length) {
      const r = shopRow[0]
      const codTr = Math.round(Number(r.total_cod) / 1_000_000)
      const dualGoalMet = Number(r.care_pct) < 30 && Number(r.total_cod) >= 50_000_000
      await sql.sql(
        `INSERT INTO agent_insight
           (insight, category, scope, evidence, agent_model, skill_type, source, confidence_pct)
         VALUES ($1, 'diagnosis', $2::jsonb, $3::jsonb, 'evaluate-daily', 'insight', 'agent', 70)`,
        [
          `Ngày ${vnDate}: shop COD=${codTr}tr (target 50tr ${codTr >= 50 ? "✓đạt" : "✗miss"}), care=${r.care_pct}% (${Number(r.care_pct) < 30 ? "✓đạt" : "✗miss"} <30%). Dual goal: ${dualGoalMet ? "MET" : "MISSED"}. Predictions: ${correctCount} đúng / ${wrongCount} sai (tổng ${preds.length}).`,
          JSON.stringify({ date: vnDate, cod_today_vnd: Number(r.total_cod), care_today_pct: Number(r.care_pct), dual_goal_met: dualGoalMet }),
          JSON.stringify({ predictions_total: preds.length, predictions_correct: correctCount, predictions_wrong: wrongCount, skills_invalidated: invalidated.length }),
        ]
      ).catch(() => {})
    }

    logger?.info?.(`[EvalDaily] ${vnDate}: evaluated ${preds.length} preds (${correctCount}✓/${wrongCount}✗), updated ${skillOutcomes.size} skills, auto-invalidated ${invalidated.length}`)
  } catch (e: any) {
    logger?.error?.("[EvalDaily] fatal:", e.message)
  }
}

export const config = {
  name: "evaluate-daily",
  schedule: "5 23 * * *",  // 23:05 mỗi ngày (giờ server — Railway thường UTC, agent run sẽ chạy 06:05 VN sáng hôm sau)
}
