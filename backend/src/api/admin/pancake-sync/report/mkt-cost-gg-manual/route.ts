import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { resolveUserPerms } from "../../../../middlewares"

/**
 * Điền tay chi phí Google Ads theo ngày.
 *
 * Cơ chế cũ (mkt-cost-gg POST) pull từ Google Sheet của từng marketer qua Apps Script —
 * khi sheet/script hỏng thì không còn số liệu GG nào vào hệ thống. Route này cho MKT tự
 * nhập số hằng ngày, ghi vào ĐÚNG bảng mkt_ads_cost_gg mà mọi báo cáo đang đọc, nên số
 * điền tay dùng được ngay không phải sửa chỗ nào khác.
 *
 * Quyền: MKT chỉ ghi được dòng của chính mình (mkt_code trong metadata); admin/manager
 * (users.manage hoặc super admin) ghi được cho mọi mkt_code — dùng khi MKT nghỉ/quên điền.
 */

type AuthInfo = { email: string; isAdmin: boolean; mktCode: string | null }

async function getAuth(req: MedusaRequest): Promise<AuthInfo | null> {
  const auth = (req as any).auth_context
  if (auth?.actor_type !== "user" || !auth?.actor_id) return null
  const userModule = req.scope.resolve(Modules.USER)
  const user = await userModule.retrieveUser(auth.actor_id, { select: ["id", "email", "metadata"] })
  const isSuper = !!(user.email && user.email === process.env.SUPER_ADMIN_EMAIL)
  const perms = resolveUserPerms(user.metadata)
  return {
    email: user.email || "",
    isAdmin: isSuper || perms.includes("users.manage"),
    mktCode: ((user.metadata as any)?.mkt_code ?? null) as string | null,
  }
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

/**
 * GET /admin/pancake-sync/report/mkt-cost-gg-manual?from=&to=
 * Trả các dòng chi phí GG trong kỳ + danh sách mkt_code người gọi được phép điền,
 * để UI biết hiện dropdown chọn MKT (admin) hay khoá cứng 1 mã (MKT thường).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const me = await getAuth(req)
    if (!me) return res.status(401).json({ error: "Unauthenticated" })

    const {
      from = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
      to = new Date().toISOString().slice(0, 10),
    } = req.query as Record<string, string>

    const svc = req.scope.resolve("cskhAnalysisModule") as any

    // MKT thường chỉ xem dòng của mình; admin xem tất cả.
    const params: any[] = [from, to]
    let scope = ""
    if (!me.isAdmin) {
      params.push(String(me.mktCode ?? "").toUpperCase())
      scope = `AND upper(mkt_name) = $${params.length}`
    }

    const rows = await svc.sql(`
      SELECT date::text AS date, mkt_name, cost::bigint AS cost,
             impressions, clicks, conversions, updated_at
      FROM mkt_ads_cost_gg
      WHERE deleted_at IS NULL AND date >= $1::date AND date <= $2::date ${scope}
      ORDER BY date DESC, mkt_name
    `, params)

    // Danh sách mã MKT cho dropdown (admin) — lấy từ user có mkt_code.
    let mktCodes: string[] = []
    if (me.isAdmin) {
      const users = await svc.sql(`
        SELECT DISTINCT upper(metadata->>'mkt_code') AS code
        FROM "user"
        WHERE deleted_at IS NULL AND metadata->>'mkt_code' IS NOT NULL
        ORDER BY 1
      `)
      mktCodes = users.map((u: any) => u.code).filter(Boolean)
    } else if (me.mktCode) {
      mktCodes = [String(me.mktCode).toUpperCase()]
    }

    return res.json({ rows, mkt_codes: mktCodes, is_admin: me.isAdmin, my_mkt_code: me.mktCode, from, to })
  } catch (err: any) {
    console.error("[mkt-cost-gg-manual GET]", err.message)
    return res.status(500).json({ error: err.message })
  }
}

/**
 * PUT /admin/pancake-sync/report/mkt-cost-gg-manual
 * body: { date: "YYYY-MM-DD", mkt_code?: string, cost: number,
 *         impressions?, clicks?, conversions? }
 *
 * Upsert 1 dòng (date, mkt_name). Gửi cost = null/"" để XOÁ dòng đã điền nhầm.
 */
export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  try {
    const me = await getAuth(req)
    if (!me) return res.status(401).json({ error: "Unauthenticated" })

    const b = req.body as any
    const date = String(b?.date ?? "")
    if (!isDate(date)) return res.status(400).json({ error: "Ngày không hợp lệ (cần YYYY-MM-DD)" })

    // MKT thường bị ép về mã của chính mình, bỏ qua mkt_code client gửi lên — tránh
    // sửa chéo số liệu của người khác dù có gọi thẳng API.
    const target = me.isAdmin
      ? String(b?.mkt_code ?? me.mktCode ?? "").toUpperCase()
      : String(me.mktCode ?? "").toUpperCase()
    if (!target) {
      return res.status(400).json({
        error: me.isAdmin
          ? "Thiếu mkt_code — chọn marketer cần điền."
          : "Tài khoản chưa gán mã MKT, liên hệ admin để cấu hình trước khi điền chi phí.",
      })
    }

    const svc = req.scope.resolve("cskhAnalysisModule") as any

    // cost rỗng/null = xoá dòng (điền nhầm ngày). Dùng soft delete cho khớp deleted_at
    // mà mọi query báo cáo đang lọc.
    if (b?.cost === null || b?.cost === "" || b?.cost === undefined) {
      await svc.sql(
        `UPDATE mkt_ads_cost_gg SET deleted_at = now(), updated_at = now()
          WHERE date = $1::date AND upper(mkt_name) = $2 AND deleted_at IS NULL`,
        [date, target]
      )
      return res.json({ ok: true, deleted: true, date, mkt_code: target })
    }

    const cost = Math.round(Number(b.cost))
    if (!Number.isFinite(cost) || cost < 0) return res.status(400).json({ error: "Chi phí không hợp lệ" })

    const num = (v: any, int = true) => {
      const n = Number(v)
      if (!Number.isFinite(n) || n < 0) return 0
      return int ? Math.round(n) : n
    }
    const impressions = num(b?.impressions)
    const clicks = num(b?.clicks)
    const conversions = num(b?.conversions, false)
    // Suy ra chỉ số phái sinh để đồng nhất với dữ liệu sync từ sheet (cùng ý nghĩa cột).
    const ctr = impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : null
    const avgCpc = clicks > 0 ? Math.round(cost / clicks) : null
    const costPerConv = conversions > 0 ? Math.round(cost / conversions) : null

    await svc.sql(`
      INSERT INTO mkt_ads_cost_gg
        (date, mkt_name, impressions, clicks, ctr, avg_cpc, conversions, cost_per_conv, cost)
      VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (date, mkt_name) DO UPDATE SET
        impressions   = EXCLUDED.impressions,
        clicks        = EXCLUDED.clicks,
        ctr           = EXCLUDED.ctr,
        avg_cpc       = EXCLUDED.avg_cpc,
        conversions   = EXCLUDED.conversions,
        cost_per_conv = EXCLUDED.cost_per_conv,
        cost          = EXCLUDED.cost,
        deleted_at    = NULL,
        updated_at    = now()
    `, [date, target, impressions, clicks, ctr, avgCpc, conversions, costPerConv, cost])

    return res.json({ ok: true, date, mkt_code: target, cost })
  } catch (err: any) {
    console.error("[mkt-cost-gg-manual PUT]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
