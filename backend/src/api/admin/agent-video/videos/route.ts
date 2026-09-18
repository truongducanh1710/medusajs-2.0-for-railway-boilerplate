import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool } from "../../../../lib/db"

/**
 * GET /admin/agent-video/videos
 *
 * Bảng điều khiển chính: mỗi video một dòng, ghép ROAS thật (v_video_roas) với
 * trạng thái agent đang gán cho nó (video_budget_state).
 *
 * LEFT JOIN từ v_video_roas chứ không phải từ state: video đang tiêu tiền mà agent
 * chưa từng chạm tới vẫn phải hiện ra — đó chính là nhóm cần chú ý nhất lúc đầu.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    const { phase, sort } = req.query as Record<string, string>

    const dk: string[] = []
    const val: any[] = []
    if (phase && phase !== "all") {
      val.push(phase)
      dk.push(phase === "chua_quan_ly"
        ? `s.vd_code IS NULL`
        : `s.phase = $${val.length}`)
    }

    // Mặc định sắp theo chi tiêu giảm dần — tiền lớn nhất lên đầu.
    const orderBy =
      sort === "roas"   ? `COALESCE(r.roas_est, r.roas_that) DESC NULLS LAST` :
      sort === "roas_low" ? `COALESCE(r.roas_est, r.roas_that) ASC NULLS LAST` :
      sort === "recent" ? `s.last_action_at DESC NULLS LAST` :
                          `r.spend DESC`

    const { rows } = await pool.query(`
      SELECT
        r.vd_code, r.spend, r.impressions, r.clicks, r.ctr, r.so_ad,
        r.don_tong, r.don_nhan, r.dt_nhan, r.don_huy,
        r.roas_gop, r.roas_that, r.roas_est, r.ty_le_nhan, r.ty_le_huy,
        r.first_spend_date, r.last_spend_date,
        s.phase, s.daily_budget, s.last_action, s.last_action_at,
        s.killed_reason, s.locked_by_human, s.mkt_name,
        v.product, v.maker, v.link, v.ad_name
      FROM v_video_roas r
      LEFT JOIN video_budget_state s ON s.vd_code = r.vd_code
      LEFT JOIN mkt_video v ON v.vd_code = r.vd_code
      ${dk.length ? "WHERE " + dk.join(" AND ") : ""}
      ORDER BY ${orderBy}
      LIMIT 200
    `, val)

    // Tổng quan — tính trên toàn bộ, không phụ thuộc bộ lọc đang chọn.
    const { rows: tong } = await pool.query(`
      SELECT
        COUNT(*)                                          AS tong_video,
        COALESCE(SUM(r.spend), 0)                         AS tong_chi,
        COALESCE(SUM(r.dt_nhan), 0)                       AS tong_dt_nhan,
        ROUND(SUM(r.dt_nhan)::numeric
              / NULLIF(SUM(r.spend), 0), 2)               AS roas_chung,
        COUNT(*) FILTER (WHERE s.phase = 'killed')        AS da_cat,
        COUNT(*) FILTER (WHERE s.phase = 'scaling')       AS dang_tang,
        COUNT(*) FILTER (WHERE s.vd_code IS NULL)         AS chua_quan_ly,
        COALESCE(SUM(s.daily_budget)
                 FILTER (WHERE s.phase <> 'killed'), 0)   AS ngan_sach_dang_cap
      FROM v_video_roas r
      LEFT JOIN video_budget_state s ON s.vd_code = r.vd_code
      WHERE r.spend > 0
    `)

    // Hạn mức đang hiệu lực — UI cần để vẽ thanh "đã dùng / trần".
    const { rows: grant } = await pool.query(`
      SELECT mkt_name, daily_cap, per_video_cap, test_budget,
             roas_kill, roas_scale, cancel_rate_kill, granted_by, effective_date, note
      FROM agent_budget_grant
      WHERE active = true AND effective_date <= current_date
      ORDER BY effective_date DESC
    `)

    return res.json({
      videos: rows,
      summary: tong[0] ?? {},
      grants: grant,
      // Agent chỉ thực sự đụng Facebook khi CẢ HAI cùng bật.
      dry_run: String(process.env.VIDEO_AGENT_DRY ?? "on").toLowerCase() !== "off",
      agent_on: String(process.env.VIDEO_AGENT ?? "on").toLowerCase() !== "off",
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
