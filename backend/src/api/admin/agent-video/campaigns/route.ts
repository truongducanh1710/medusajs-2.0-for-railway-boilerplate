import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { getPool } from "../../../../lib/db"

/**
 * Sổ đăng ký camp do agent quản lý.
 *
 * GET    — danh sách camp đang giao + camp chưa giao (để chọn)
 * POST   — giao camp cho agent
 * DELETE — thu hồi
 *
 * Đây là nguồn sự thật duy nhất về "camp nào của agent". Không suy từ tên camp,
 * vì tên do người gõ nên gõ nhầm là agent mất quyền hoặc nhận nhầm camp người khác.
 */

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()

    // Camp agent đang quản lý, kèm số liệu 7 ngày để biết nó đang chạy ra sao.
    const { rows: daGiao } = await pool.query(`
      SELECT
        m.campaign_id, m.campaign_name, m.ad_account_id, m.mkt_name,
        m.source, m.started_at, m.assigned_by, m.note,
        EXTRACT(day FROM now() - m.started_at)::int   AS so_ngay_chay,
        COALESCE(c.spend_7d, 0)                       AS spend_7d,
        c.effective_status, c.daily_budget
      FROM agent_managed_campaign m
      LEFT JOIN LATERAL (
        SELECT SUM(spend) AS spend_7d,
               (array_agg(effective_status ORDER BY date DESC))[1] AS effective_status,
               (array_agg(daily_budget ORDER BY date DESC))[1]     AS daily_budget
        FROM mkt_ads_cost
        WHERE campaign_id = m.campaign_id AND date > current_date - 8
      ) c ON true
      WHERE m.active = true
      ORDER BY m.started_at DESC
    `)

    // Camp đang chạy mà CHƯA giao — để người chọn giao thêm.
    const { rows: chuaGiao } = await pool.query(`
      SELECT
        a.campaign_id, a.campaign_name, a.ad_account_id, a.mkt_name,
        ROUND(SUM(a.spend))                              AS spend_7d,
        (array_agg(a.effective_status ORDER BY a.date DESC))[1] AS effective_status
      FROM mkt_ads_cost a
      WHERE a.date > current_date - 8
        AND NOT EXISTS (
          SELECT 1 FROM agent_managed_campaign m
          WHERE m.campaign_id = a.campaign_id AND m.active = true
        )
      GROUP BY 1,2,3,4
      HAVING SUM(a.spend) > 0
      ORDER BY spend_7d DESC
      LIMIT 100
    `)

    return res.json({ da_giao: daGiao, chua_giao: chuaGiao })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    const b = req.body as any
    const ids: string[] = Array.isArray(b?.campaign_ids) ? b.campaign_ids
                        : b?.campaign_id ? [String(b.campaign_id)] : []
    if (!ids.length) return res.status(400).json({ error: "Chưa chọn camp nào" })

    let email = ""
    try {
      const userModule = req.scope.resolve(Modules.USER) as any
      const u = await userModule.retrieveUser((req as any).auth_context.actor_id, { select: ["email"] })
      email = u?.email ?? ""
    } catch {}

    // Lấy thông tin camp từ chi phí gần nhất — không bắt người nhập tay.
    const { rows } = await pool.query(`
      SELECT DISTINCT ON (campaign_id)
        campaign_id, campaign_name, ad_account_id, mkt_name
      FROM mkt_ads_cost
      WHERE campaign_id = ANY($1)
      ORDER BY campaign_id, date DESC
    `, [ids])

    if (!rows.length) return res.status(400).json({ error: "Không tìm thấy camp trong dữ liệu chi phí" })

    for (const c of rows) {
      await pool.query(`
        INSERT INTO agent_managed_campaign
          (campaign_id, campaign_name, ad_account_id, mkt_name, source,
           started_at, active, assigned_by, note)
        VALUES ($1,$2,$3,$4,$5,now(),true,$6,$7)
        ON CONFLICT (campaign_id) DO UPDATE SET
          active = true,
          campaign_name = EXCLUDED.campaign_name,
          mkt_name = EXCLUDED.mkt_name,
          assigned_by = EXCLUDED.assigned_by,
          note = EXCLUDED.note,
          -- started_at GIỮ NGUYÊN khi giao lại: nếu reset, camp cũ sẽ được hưởng
          -- lại luật bảo vệ "tài khoản mới" dù đã chạy nhiều tháng.
          updated_at = now()
      `, [
        c.campaign_id, c.campaign_name ?? "", c.ad_account_id ?? "",
        c.mkt_name ?? "", String(b?.source ?? "human_assigned"),
        email, String(b?.note ?? ""),
      ])
    }

    return res.json({ ok: true, da_giao: rows.length })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    const { campaign_id } = req.query as Record<string, string>
    if (!campaign_id) return res.status(400).json({ error: "Thiếu campaign_id" })

    // active=false chứ không xoá: giữ lịch sử camp từng giao cho agent, và giữ
    // started_at để nếu giao lại thì không bị tính là camp mới.
    const { rowCount } = await pool.query(
      `UPDATE agent_managed_campaign SET active = false, updated_at = now()
       WHERE campaign_id = $1 AND active = true`,
      [campaign_id]
    )
    return res.json({ ok: true, da_thu_hoi: rowCount })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
