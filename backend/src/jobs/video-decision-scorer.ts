import { MedusaContainer } from "@medusajs/framework"

/**
 * Chấm điểm NGƯỢC các quyết định của video-budget-agent sau 7 ngày.
 *
 * Đây là vòng phản hồi — thứ biến agent từ "chạy theo luật cố định" thành "cải thiện
 * được". Không có nó thì không bao giờ biết ngưỡng roas_kill = 1.5 là quá chặt hay
 * quá lỏng, và luật nào đang sai.
 *
 * Cách chấm từng loại hành động:
 *
 *   kill      — đúng nếu sau khi cắt, video KHÔNG hồi phục. Không đo được trực tiếp
 *               (đã tắt thì làm gì có dữ liệu mới), nên so ROAS lúc cắt với ngưỡng:
 *               cắt ở ROAS rất thấp = chắc chắn đúng; cắt ở ROAS sát ngưỡng = nghi ngờ,
 *               đánh 'neutral' để người xem lại.
 *   scale_up  — đúng nếu ROAS 7 ngày sau vẫn ≥ ngưỡng. Tăng tiền rồi ROAS tụt là sai.
 *   hold      — đúng nếu ROAS không xấu đi.
 *
 * Kết quả gom vào agent_insight để camp-ai-care (agent LLM) đọc được — hai agent
 * dùng chung bộ nhớ thay vì mỗi cái học riêng.
 */
export default async function videoDecisionScorer(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  const sql = container.resolve("cskhAnalysisModule") as any

  // Chỉ chấm quyết định đã đủ 7 ngày và chưa từng chấm.
  const pending = await sql.sql(
    `SELECT l.id, l.vd_code, l.action, l.rule_hit, l.metrics, l.created_at,
            l.budget_before, l.budget_after
     FROM video_decision_log l
     WHERE l.evaluated_at IS NULL
       AND l.created_at < now() - interval '7 days'
       AND l.action <> 'start_test'
     ORDER BY l.created_at
     LIMIT 200`
  ).catch(() => [])

  if (!pending.length) {
    logger?.info?.("[VideoScorer] Không có quyết định nào đến hạn chấm")
    return
  }

  const grant = await sql.sql(
    `SELECT roas_kill, roas_scale FROM agent_budget_grant
     WHERE active = true ORDER BY effective_date DESC LIMIT 1`
  ).catch(() => [])
  const roasKill = Number(grant[0]?.roas_kill ?? 1.5)
  const roasScale = Number(grant[0]?.roas_scale ?? 2.0)

  let dung = 0, sai = 0, trungTinh = 0

  for (const d of pending) {
    try {
      const luc = d.metrics ?? {}
      const roasLuc = luc.roas_est != null ? Number(luc.roas_est)
                    : luc.roas_that != null ? Number(luc.roas_that) : null

      // ROAS hiện tại của video — chỉ có ý nghĩa với video còn chạy.
      const now = await sql.sql(
        `SELECT roas_est, roas_that, spend FROM v_video_roas WHERE vd_code = $1`,
        [d.vd_code]
      ).catch(() => [])
      const roasSau = now[0]?.roas_est != null ? Number(now[0].roas_est)
                    : now[0]?.roas_that != null ? Number(now[0].roas_that) : null

      let verdict: "correct" | "wrong" | "neutral" = "neutral"

      if (d.action === "kill") {
        // Cắt ở ROAS rất thấp (dưới 2/3 ngưỡng) = quyết định dứt khoát, đúng.
        // Cắt ở ROAS sát ngưỡng = có thể đã cắt nhầm video đang lên, đánh neutral
        // để người xem lại thay vì tự nhận là đúng.
        if (roasLuc == null) verdict = "correct"          // không ra đơn, cắt là đúng
        else if (roasLuc < roasKill * 0.67) verdict = "correct"
        else verdict = "neutral"
      } else if (d.action === "scale_up") {
        if (roasSau == null) verdict = "neutral"
        else if (roasSau >= roasScale) verdict = "correct"
        else if (roasSau < roasKill) verdict = "wrong"     // tăng tiền rồi tụt hẳn
        else verdict = "neutral"
      } else if (d.action === "hold") {
        if (roasSau == null || roasLuc == null) verdict = "neutral"
        else if (roasSau >= roasLuc) verdict = "correct"
        else if (roasSau < roasKill) verdict = "wrong"
        else verdict = "neutral"
      }

      await sql.sql(
        `UPDATE video_decision_log
         SET outcome_roas_7d = $1, outcome_verdict = $2, evaluated_at = now()
         WHERE id = $3`,
        [roasSau, verdict, d.id]
      ).catch(() => {})

      if (verdict === "correct") dung++
      else if (verdict === "wrong") sai++
      else trungTinh++
    } catch (e: any) {
      logger?.warn?.(`[VideoScorer] Lỗi chấm ${d.id}: ${e.message}`)
    }
  }

  // ---- Tổng kết theo LUẬT, không theo từng quyết định ----
  // Mục đích: phát hiện luật nào sai hệ thống. Một luật sai 40% lần là luật cần sửa
  // ngưỡng, không phải xui.
  const theoLuat = await sql.sql(
    `SELECT rule_hit,
            COUNT(*) FILTER (WHERE outcome_verdict = 'correct') dung,
            COUNT(*) FILTER (WHERE outcome_verdict = 'wrong') sai,
            COUNT(*) tong
     FROM video_decision_log
     WHERE evaluated_at IS NOT NULL AND rule_hit IS NOT NULL
       AND created_at > now() - interval '30 days'
     GROUP BY 1 HAVING COUNT(*) >= 5`
  ).catch(() => [])

  for (const r of theoLuat) {
    const tong = Number(r.tong) || 1
    const tyLeDung = Math.round(Number(r.dung) * 100 / tong)
    const tyLeSai = Math.round(Number(r.sai) * 100 / tong)

    await sql.sql(
      `INSERT INTO agent_insight
       (scope, category, insight, evidence, confidence_pct, times_correct, times_wrong,
        source, skill_type, active)
       VALUES ('video', 'rule_performance', $1, $2::jsonb, $3, $4, $5, 'video_scorer', 'rule', true)`,
      [
        `Luật "${r.rule_hit}": đúng ${tyLeDung}% trên ${tong} lần áp dụng` +
        (tyLeSai > 30 ? ` — SAI ${tyLeSai}%, cần xem lại ngưỡng` : ""),
        JSON.stringify({ rule: r.rule_hit, dung: r.dung, sai: r.sai, tong }),
        tyLeDung, Number(r.dung), Number(r.sai),
      ]
    ).catch(() => {})
  }

  logger?.info?.(
    `[VideoScorer] Chấm ${pending.length} quyết định — đúng=${dung} sai=${sai} trung tính=${trungTinh}`
  )
}

export const config = {
  name: "video-decision-scorer",
  schedule: "30 3 * * *", // 03:30 hàng ngày — giờ thấp điểm
}
