import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { getPool } from "../../../../lib/db"

/**
 * POST /admin/agent-video/grant — cấp hoặc sửa hạn mức ngân sách cho agent
 *
 * Đây là điểm giao tiếp chính giữa người và agent: người quyết định agent được
 * tiêu bao nhiêu và theo ngưỡng nào; agent chỉ được đọc bảng này, không bao giờ ghi.
 *
 * Mỗi lần cấp tạo một BẢN GHI MỚI thay vì sửa bản cũ (bản cũ chuyển active=false),
 * để giữ lịch sử ai cấp bao nhiêu lúc nào — cần khi đối chiếu về sau.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    const b = req.body as any

    const mkt = String(b?.mkt_name ?? "").trim()
    const dailyCap = Number(b?.daily_cap)
    if (!Number.isFinite(dailyCap) || dailyCap <= 0) {
      return res.status(400).json({ error: "Trần ngân sách ngày phải là số dương" })
    }

    // Chặn trên cứng: dù người nhập nhầm thêm số 0 cũng không cho agent tiêu quá 50tr/ngày.
    // Muốn vượt thì phải sửa code — cố ý làm khó để tránh sai sót một chữ số.
    const TRAN_CUNG = 50_000_000
    if (dailyCap > TRAN_CUNG) {
      return res.status(400).json({
        error: `Trần ngày tối đa ${TRAN_CUNG.toLocaleString("vi-VN")}đ. Nhập ${dailyCap.toLocaleString("vi-VN")}đ — kiểm tra lại số.`,
      })
    }

    const perVideo = Number(b?.per_video_cap) || 3_000_000
    if (perVideo > dailyCap) {
      return res.status(400).json({ error: "Trần mỗi video không được lớn hơn trần ngày" })
    }

    const roasKill = Number(b?.roas_kill) || 1.5
    const roasScale = Number(b?.roas_scale) || 2.0
    if (roasScale <= roasKill) {
      return res.status(400).json({ error: "Ngưỡng tăng phải cao hơn ngưỡng cắt" })
    }

    let email = ""
    try {
      const userModule = req.scope.resolve(Modules.USER) as any
      const u = await userModule.retrieveUser((req as any).auth_context.actor_id, { select: ["email"] })
      email = u?.email ?? ""
    } catch {}

    // Vô hiệu hoá bản cũ của cùng MKT rồi tạo bản mới — giữ lịch sử thay vì ghi đè.
    await pool.query(
      `UPDATE agent_budget_grant SET active = false
       WHERE mkt_name = $1 AND active = true`,
      [mkt]
    )

    const { rows } = await pool.query(
      `INSERT INTO agent_budget_grant
       (mkt_name, effective_date, daily_cap, per_video_cap, test_budget,
        roas_kill, roas_scale, cancel_rate_kill, granted_by, note, active)
       VALUES ($1, current_date, $2, $3, $4, $5, $6, $7, $8, $9, true)
       RETURNING *`,
      [
        mkt, Math.round(dailyCap), Math.round(perVideo),
        Math.round(Number(b?.test_budget) || 300_000),
        roasKill, roasScale, Number(b?.cancel_rate_kill) || 45,
        email, String(b?.note ?? ""),
      ]
    )

    return res.json({ grant: rows[0] })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/** DELETE /admin/agent-video/grant?mkt_name= — thu hồi quyền tiêu tiền của agent */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    const { mkt_name } = req.query as Record<string, string>
    const { rowCount } = await pool.query(
      `UPDATE agent_budget_grant SET active = false
       WHERE mkt_name = $1 AND active = true`,
      [String(mkt_name ?? "")]
    )
    // Không có grant hiệu lực thì job tự dừng ngay vòng sau — không cần tắt cron.
    return res.json({ ok: true, da_thu_hoi: rowCount })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
