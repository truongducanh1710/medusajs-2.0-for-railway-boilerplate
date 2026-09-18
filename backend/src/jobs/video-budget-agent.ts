import { MedusaContainer } from "@medusajs/framework"
import { randomUUID } from "crypto"
import { callFbApi } from "../api/admin/pancake-sync/report/camp-control/_lib"
import { AGENT_EMAIL } from "./camp-ai-care"

/**
 * Agent phân bổ ngân sách theo VIDEO — mô hình giống Smart Performance của TikTok:
 * mỗi video được cấp một khoản thử, không đạt ROAS thì cắt, đạt thì nhân dần lên.
 *
 * KHÁC với camp-ai-care.ts (agent LLM suy nghĩ ở mức camp): job này KHÔNG gọi LLM.
 * Toàn bộ quyết định là luật số học thuần trên v_video_roas.
 *
 * Vì sao cố ý không dùng LLM ở đây:
 *   - Quyết định tiền phải giải thích được từng đồng và lặp lại y hệt khi cùng dữ liệu
 *   - Không tốn token, chạy được 2 giờ/lần mà không lo chi phí
 *   - Không có rủi ro model "sáng tạo" ra hành động ngoài dự kiến
 * LLM vẫn có chỗ của nó ở camp-ai-care: nhìn bối cảnh rộng, phát hiện điều luật bỏ sót.
 *
 * NGƯỠNG lấy từ agent_budget_grant (DB) chứ không hardcode — chỉnh được không cần deploy.
 *
 * TẮT KHẨN CẤP: đặt VIDEO_AGENT=off trên Railway.
 */

type Grant = {
  mkt_name: string
  daily_cap: number
  per_video_cap: number
  test_budget: number
  roas_kill: number
  roas_scale: number
  cancel_rate_kill: number
}

type VideoRow = {
  vd_code: string
  spend: number
  don_tong: number
  don_nhan: number
  dt_nhan: number
  roas_that: number | null
  roas_est: number | null
  ty_le_huy: number | null
  last_spend_date: string | null
}

const PHASE = {
  TESTING: "testing",
  SCALING: "scaling",
  HOLDING: "holding",
  KILLED: "killed",
} as const

/** Quyết định cho một video. Trả về null nghĩa là không đụng vào. */
function quyetDinh(v: VideoRow, state: any, g: Grant): {
  action: string
  rule: string
  reason: string
  budget?: number
} | null {
  const spend = Number(v.spend) || 0
  const budgetHienTai = Number(state?.daily_budget) || 0
  const phase = state?.phase ?? PHASE.TESTING

  // Đã tắt rồi thì thôi — không tự bật lại. Bật lại là quyết định của người,
  // vì video đã bị cắt thường có lý do nằm ngoài số liệu (nội dung sai, hết hàng...).
  if (phase === PHASE.KILLED) return null

  // ---- Van an toàn 1: tỷ lệ huỷ quá cao, cắt ngay không cần đợi ROAS ----
  // Đặt trước kiểm tra ROAS vì đơn huỷ nhiều còn tốn thêm phí ship hai chiều,
  // ROAS chưa kịp xấu nhưng tiền đã mất thật.
  const tyLeHuy = v.ty_le_huy == null ? null : Number(v.ty_le_huy)
  if (tyLeHuy != null && tyLeHuy > g.cancel_rate_kill && Number(v.don_tong) >= 10) {
    return {
      action: "kill",
      rule: "cancel_rate_kill",
      reason: `Tỷ lệ huỷ ${tyLeHuy}% vượt ngưỡng ${g.cancel_rate_kill}% trên ${v.don_tong} đơn — cắt ngay`,
    }
  }

  // ---- Chưa tiêu hết ngân sách thử thì chưa chấm điểm ----
  const nguongCham = g.test_budget * 3
  if (spend < nguongCham) {
    if (budgetHienTai === 0) {
      return {
        action: "start_test",
        rule: "new_video",
        reason: `Video mới, cấp ngân sách thử ${g.test_budget.toLocaleString("vi-VN")}đ/ngày`,
        budget: g.test_budget,
      }
    }
    return null // đang thử, để yên
  }

  // ---- Chấm điểm: ưu tiên roas_est (có tính đơn chưa chốt) ----
  // roas_that luôn trễ 3-5 ngày vì đơn chưa biết nhận hay huỷ. Dùng nó một mình
  // thì agent luôn quyết định trên dữ liệu cũ. roas_est đã nhân tỷ lệ nhận CỦA
  // CHÍNH video đó nên phản ánh sớm hơn mà vẫn trung thực.
  const roas = v.roas_est != null ? Number(v.roas_est)
             : v.roas_that != null ? Number(v.roas_that)
             : null

  // Chưa đủ đơn để tính roas_est mà đã tiêu quá 2x ngưỡng chấm → cắt.
  // Tiêu nhiều mà không ra nổi 5 đơn chốt thì bản thân điều đó đã là câu trả lời.
  if (roas == null) {
    if (spend > nguongCham * 2) {
      return {
        action: "kill",
        rule: "no_conversion",
        reason: `Đã tiêu ${Math.round(spend / 1000)}k mà chưa đủ 5 đơn chốt để tính ROAS — cắt`,
      }
    }
    return null
  }

  const r = Math.round(roas * 100) / 100

  // ---- Dưới ngưỡng sống: cắt ----
  if (r < g.roas_kill) {
    return {
      action: "kill",
      rule: "roas_kill",
      reason: `ROAS ${r} dưới ngưỡng ${g.roas_kill} sau khi tiêu ${Math.round(spend / 1000)}k — cắt`,
    }
  }

  // ---- Vùng giữa: giữ nguyên, theo dõi thêm ----
  if (r < g.roas_scale) {
    if (phase !== PHASE.HOLDING) {
      return {
        action: "hold",
        rule: "roas_marginal",
        reason: `ROAS ${r} nằm giữa ${g.roas_kill}–${g.roas_scale}, giữ nguyên ngân sách và theo dõi`,
      }
    }
    return null
  }

  // ---- Trên ngưỡng: tăng dần ----
  // Tăng theo bậc chứ không nhảy vọt: Facebook reset learning phase khi ngân sách
  // đổi quá mạnh, đang chạy tốt mà tăng gấp đôi thường làm hiệu quả tụt.
  const heSo = r >= g.roas_scale * 1.5 ? 1.5 : 1.3
  const moi = Math.min(
    Math.round((budgetHienTai || g.test_budget) * heSo),
    g.per_video_cap
  )

  if (moi <= budgetHienTai) return null // đã chạm trần

  return {
    action: "scale_up",
    rule: r >= g.roas_scale * 1.5 ? "roas_strong" : "roas_good",
    reason: `ROAS ${r} vượt ngưỡng ${g.roas_scale}, tăng ngân sách ${Math.round((heSo - 1) * 100)}% lên ${moi.toLocaleString("vi-VN")}đ`,
    budget: moi,
  }
}

export default async function videoBudgetAgent(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  const sql = container.resolve("cskhAnalysisModule") as any

  if (String(process.env.VIDEO_AGENT ?? "on").toLowerCase() === "off") {
    logger?.info?.("[VideoAgent] Skip — VIDEO_AGENT=off")
    return
  }

  const runId = randomUUID()

  // Hạn mức do NGƯỜI duyệt. Không có bản ghi nào đang hiệu lực → không chạy.
  // Cố ý không có giá trị mặc định: agent chỉ được tiêu tiền khi có người cấp phép.
  const grants: Grant[] = await sql.sql(
    `SELECT mkt_name, daily_cap, per_video_cap, test_budget,
            roas_kill, roas_scale, cancel_rate_kill
     FROM agent_budget_grant
     WHERE active = true AND effective_date <= current_date
     ORDER BY effective_date DESC`
  ).catch(() => [])

  if (!grants.length) {
    logger?.info?.("[VideoAgent] Chưa có agent_budget_grant nào hiệu lực — không chạy")
    return
  }

  // Chế độ đề xuất: ghi log nhưng không gọi Facebook. Dùng cho giai đoạn chạy thử.
  const chiDeXuat = String(process.env.VIDEO_AGENT_DRY ?? "on").toLowerCase() !== "off"

  for (const g of grants) {
    try {
      // Grant cho AGENT = camp cua chinh agent. Grant cho mot MKT nguoi = agent
      // duoc uy quyen quan ly camp cua nguoi do. Loc theo mkt_name cua camp chu
      // khong lay tat ca, neu khong hai grant se tranh nhau cung mot video.
      const videos: VideoRow[] = await sql.sql(
        `SELECT r.vd_code, r.spend, r.don_tong, r.don_nhan, r.dt_nhan,
                r.roas_that, r.roas_est, r.ty_le_huy, r.last_spend_date
         FROM v_video_roas r
         WHERE r.spend > 0
           AND ($1 = '' OR EXISTS (
             SELECT 1 FROM mkt_ads_cost_ad a
             WHERE a.vd_code = r.vd_code AND a.mkt_name = $1
               AND a.date > current_date - 31
           ))
         ORDER BY r.spend DESC`,
        [g.mkt_name || ""]
      ).catch(() => [])

      const states = await sql.sql(
        `SELECT * FROM video_budget_state WHERE mkt_name = $1 OR mkt_name = ''`,
        [g.mkt_name]
      ).catch(() => [])
      const stateMap = new Map<string, any>(states.map((s: any) => [s.vd_code, s]))

      // Tổng đang tiêu hôm nay — dùng để chặn vượt trần trước khi tăng bất cứ video nào.
      const tongRow = await sql.sql(
        `SELECT COALESCE(SUM(daily_budget),0) tong FROM video_budget_state
         WHERE phase <> 'killed' AND (mkt_name = $1 OR mkt_name = '')`,
        [g.mkt_name]
      ).catch(() => [{ tong: 0 }])
      let tongNganSach = Number(tongRow[0]?.tong ?? 0)

      let soKill = 0, soScale = 0, soHold = 0, soTest = 0

      for (const v of videos) {
        const state = stateMap.get(v.vd_code)

        // Người đã khoá video này thì agent không đụng vào.
        if (state?.locked_by_human) continue

        const qd = quyetDinh(v, state, g)
        if (!qd) continue

        // Trần tổng: chỉ chặn hành động LÀM TĂNG tiền. kill/hold luôn được phép
        // vì chúng chỉ giảm chi tiêu.
        if (qd.budget != null) {
          const budgetCu = Number(state?.daily_budget) || 0
          const chenh = qd.budget - budgetCu
          if (chenh > 0 && tongNganSach + chenh > g.daily_cap) {
            await ghiLog(sql, runId, v, qd, state, false,
              `Vượt trần ngày ${g.daily_cap.toLocaleString("vi-VN")}đ — cần duyệt thêm ngân sách`)
            continue
          }
        }

        let thucThi = false
        let fbResp: any = null

        if (!chiDeXuat) {
          const camps = await sql.sql(
            `SELECT DISTINCT campaign_id, ad_id FROM mkt_ads_cost_ad
             WHERE vd_code = $1 AND date > current_date - 8`,
            [v.vd_code]
          ).catch(() => [])

          for (const c of camps) {
            const path = qd.action === "kill"
              ? `/${c.ad_id}?status=PAUSED`
              : qd.budget != null ? `/${c.campaign_id}?daily_budget=${qd.budget}` : ""
            if (!path) continue
            fbResp = await callFbApi("POST", path)
            if (fbResp?.ok) {
              thucThi = true
              // Ghi vao camp_action_log — cung bang voi thao tac cua NGUOI, de mot
              // truy van duy nhat tra loi duoc "camp nay ai da dong vao".
              await sql.sql(
                `INSERT INTO camp_action_log
                 (campaign_id, campaign_name, action, old_value, new_value, source,
                  user_email, fb_response, success)
                 VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, 'agent', $6, $7::jsonb, true)`,
                [
                  c.campaign_id, v.vd_code, qd.action,
                  JSON.stringify({ daily_budget: Number(state?.daily_budget) || 0 }),
                  JSON.stringify({ daily_budget: qd.budget ?? null }),
                  AGENT_EMAIL, JSON.stringify(fbResp.data ?? {}),
                ]
              ).catch(() => {})
            }
          }
        }

        await ghiLog(sql, runId, v, qd, state, thucThi, null, fbResp)
        await capNhatState(sql, v, qd, g, thucThi || chiDeXuat)

        if (qd.budget != null) {
          tongNganSach += qd.budget - (Number(state?.daily_budget) || 0)
        }

        if (qd.action === "kill") soKill++
        else if (qd.action === "scale_up") soScale++
        else if (qd.action === "hold") soHold++
        else if (qd.action === "start_test") soTest++
      }

      logger?.info?.(
        `[VideoAgent] ${g.mkt_name || "ALL"} — kill=${soKill} scale=${soScale} ` +
        `hold=${soHold} test=${soTest} ${chiDeXuat ? "(chỉ đề xuất)" : "(đã thực thi)"}`
      )
    } catch (e: any) {
      logger?.error?.(`[VideoAgent] Lỗi với ${g.mkt_name}: ${e.message}`)
    }
  }
}

async function ghiLog(
  sql: any, runId: string, v: VideoRow, qd: any, state: any,
  executed: boolean, error: string | null = null, fbResp: any = null
) {
  // metrics snapshot BẮT BUỘC: 3 ngày sau số sẽ khác, không có nó thì không bao giờ
  // chấm được quyết định này đúng hay sai trên dữ liệu nào.
  await sql.sql(
    `INSERT INTO video_decision_log
     (run_id, vd_code, action, reason, rule_hit, budget_before, budget_after,
      metrics, executed, fb_response, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11)`,
    [
      runId, v.vd_code, qd.action, qd.reason, qd.rule,
      Number(state?.daily_budget) || 0,
      qd.budget ?? (Number(state?.daily_budget) || 0),
      JSON.stringify({
        spend_total: Number(v.spend) || 0,
        roas_est: v.roas_est, roas_that: v.roas_that,
        ty_le_huy: v.ty_le_huy,
        don_tong: v.don_tong, don_nhan: v.don_nhan, dt_nhan: v.dt_nhan,
      }),
      executed,
      fbResp ? JSON.stringify(fbResp.data ?? {}) : null,
      error,
    ]
  ).catch(() => {})
}

async function capNhatState(sql: any, v: VideoRow, qd: any, g: Grant, apDung: boolean) {
  if (!apDung) return
  const phaseMoi =
    qd.action === "kill" ? PHASE.KILLED :
    qd.action === "scale_up" ? PHASE.SCALING :
    qd.action === "hold" ? PHASE.HOLDING :
    PHASE.TESTING

  await sql.sql(
    `INSERT INTO video_budget_state
     (vd_code, mkt_name, phase, daily_budget, spend_total, roas_est, roas_real,
      cancel_rate, orders_total, last_action, last_action_at, killed_reason, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),$11,now())
     ON CONFLICT (vd_code) DO UPDATE SET
       phase = EXCLUDED.phase,
       daily_budget = EXCLUDED.daily_budget,
       spend_total = EXCLUDED.spend_total,
       roas_est = EXCLUDED.roas_est,
       roas_real = EXCLUDED.roas_real,
       cancel_rate = EXCLUDED.cancel_rate,
       orders_total = EXCLUDED.orders_total,
       last_action = EXCLUDED.last_action,
       last_action_at = now(),
       killed_reason = EXCLUDED.killed_reason,
       updated_at = now()`,
    [
      v.vd_code, g.mkt_name, phaseMoi,
      qd.budget ?? 0, Number(v.spend) || 0,
      v.roas_est, v.roas_that, v.ty_le_huy, Number(v.don_tong) || 0,
      qd.action, qd.action === "kill" ? qd.reason : null,
    ]
  ).catch(() => {})
}

export const config = {
  name: "video-budget-agent",
  // 2 giờ/lần. Nhanh hơn camp-ai-care (4h) vì không gọi LLM nên không tốn gì,
  // nhưng vẫn đủ thưa để Facebook kịp phân phối sau mỗi lần đổi ngân sách.
  schedule: "15 */2 * * *",
}
