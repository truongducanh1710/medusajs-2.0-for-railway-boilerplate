import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { getPool } from "../../../../lib/db"

/**
 * POST /admin/agent-video/lock
 * Body: { vd_code, locked: boolean }        — khoá / mở khoá một video
 *       { vd_code, action: "revive" }       — bật lại video agent đã cắt
 *
 * Khoá = agent bỏ qua video này hoàn toàn, người tự điều khiển. Dùng khi biết
 * điều gì đó agent không thể biết: sắp hết hàng, video đang chờ đổi nội dung,
 * đang chạy thử nghiệm riêng.
 *
 * Hồi sinh phải do người bấm: agent cố ý KHÔNG tự bật lại video đã cắt, vì lý do
 * cắt thường nằm ngoài số liệu (nội dung sai, sản phẩm hết hàng).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    const b = req.body as any
    const vd = String(b?.vd_code ?? "").trim()
    if (!vd) return res.status(400).json({ error: "Thiếu mã video" })

    let email = ""
    try {
      const userModule = req.scope.resolve(Modules.USER) as any
      const u = await userModule.retrieveUser((req as any).auth_context.actor_id, { select: ["email"] })
      email = u?.email ?? ""
    } catch {}

    if (b?.action === "revive") {
      // Đưa về testing với ngân sách thử, để agent chấm lại từ đầu thay vì
      // trả về mức cũ — dữ liệu cũ đã là lý do nó bị cắt.
      const { rows: g } = await pool.query(
        `SELECT test_budget FROM agent_budget_grant
         WHERE active = true ORDER BY effective_date DESC LIMIT 1`
      )
      const testBudget = Number(g[0]?.test_budget ?? 300_000)

      await pool.query(
        `UPDATE video_budget_state
         SET phase = 'testing', daily_budget = $2, killed_reason = NULL,
             last_action = 'revive_by_human', last_action_at = now(), updated_at = now()
         WHERE vd_code = $1`,
        [vd, testBudget]
      )
      await pool.query(
        `INSERT INTO video_decision_log (vd_code, action, reason, rule_hit, budget_after, executed)
         VALUES ($1, 'revive', $2, 'human_override', $3, false)`,
        [vd, `${email} bật lại video, cấp lại ngân sách thử`, testBudget]
      )
      return res.json({ ok: true, phase: "testing", daily_budget: testBudget })
    }

    const locked = b?.locked === true
    // Video agent chưa từng chạm tới thì chưa có dòng state — tạo mới để khoá được ngay.
    await pool.query(
      `INSERT INTO video_budget_state (vd_code, locked_by_human, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (vd_code) DO UPDATE
       SET locked_by_human = EXCLUDED.locked_by_human, updated_at = now()`,
      [vd, locked]
    )
    await pool.query(
      `INSERT INTO video_decision_log (vd_code, action, reason, rule_hit, executed)
       VALUES ($1, $2, $3, 'human_override', false)`,
      [vd, locked ? "lock" : "unlock",
       `${email} ${locked ? "khoá" : "mở khoá"} video — agent ${locked ? "bỏ qua" : "được phép điều khiển lại"}`]
    )

    return res.json({ ok: true, locked })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
