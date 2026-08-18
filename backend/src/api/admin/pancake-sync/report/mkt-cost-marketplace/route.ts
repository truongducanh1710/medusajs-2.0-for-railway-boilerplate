import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * Chi phí quảng cáo sàn TMĐT (TikTok Shop / Shopee) — điền tay theo ngày.
 *
 * Sàn không có API spend như Facebook, cũng không có sheet sync như Google Ads:
 * nhân sự đang ghi tay ra Google Sheet ngoài hệ thống nên báo cáo LNG sàn không trừ
 * được chi phí ads. Route này để nhập thẳng trong app, ghi vào mkt_ads_cost_marketplace.
 *
 * Grain (date, platform) — 1 số tổng mỗi ngày cho mỗi sàn.
 */

const PLATFORMS = ["tiktok", "shopee"] as const
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

async function ensureTable(svc: any) {
  await svc.sql(`
    CREATE TABLE IF NOT EXISTS mkt_ads_cost_marketplace (
      id         uuid NOT NULL DEFAULT gen_random_uuid(),
      date       date NOT NULL,
      platform   varchar(16) NOT NULL,
      cost       bigint NOT NULL DEFAULT 0,
      note       text,
      created_by varchar(255),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz NULL,
      PRIMARY KEY (id),
      CONSTRAINT mkt_ads_cost_marketplace_date_platform_unique UNIQUE (date, platform)
    )
  `)
  await svc.sql(`CREATE INDEX IF NOT EXISTS idx_mkt_ads_cost_mp_date ON mkt_ads_cost_marketplace (date, platform)`)
}

/**
 * GET /admin/pancake-sync/report/mkt-cost-marketplace?from=&to=
 * Trả các dòng chi phí đã điền trong kỳ.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const {
      from = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
      to = new Date().toISOString().slice(0, 10),
    } = req.query as Record<string, string>

    const svc = req.scope.resolve("cskhAnalysisModule") as any
    await ensureTable(svc)

    const rows = await svc.sql(`
      SELECT date::text AS date, platform, cost::bigint AS cost, note, created_by, updated_at
        FROM mkt_ads_cost_marketplace
       WHERE deleted_at IS NULL AND date >= $1::date AND date <= $2::date
       ORDER BY date DESC, platform
    `, [from, to])

    const totals = await svc.sql(`
      SELECT platform, SUM(cost)::bigint AS cost, COUNT(*)::int AS days
        FROM mkt_ads_cost_marketplace
       WHERE deleted_at IS NULL AND date >= $1::date AND date <= $2::date
       GROUP BY platform
    `, [from, to])

    return res.json({ rows, totals, platforms: PLATFORMS, from, to })
  } catch (err: any) {
    console.error("[mkt-cost-marketplace GET]", err.message)
    return res.status(500).json({ error: err.message })
  }
}

/**
 * PUT /admin/pancake-sync/report/mkt-cost-marketplace
 * body: { date: "YYYY-MM-DD", platform: "tiktok"|"shopee", cost: number, note?: string }
 * Gửi cost = null để xoá dòng đã điền nhầm (soft delete, khớp cách query lọc deleted_at).
 */
export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = (req as any).auth_context
    if (auth?.actor_type !== "user" || !auth?.actor_id) {
      return res.status(401).json({ error: "Unauthenticated" })
    }

    const b = req.body as any
    const date = String(b?.date ?? "")
    if (!isDate(date)) return res.status(400).json({ error: "Ngày không hợp lệ (cần YYYY-MM-DD)" })

    const platform = String(b?.platform ?? "").toLowerCase()
    if (!PLATFORMS.includes(platform as any)) {
      return res.status(400).json({ error: `Sàn không hợp lệ — chỉ nhận: ${PLATFORMS.join(", ")}` })
    }

    const svc = req.scope.resolve("cskhAnalysisModule") as any
    await ensureTable(svc)

    if (b?.cost === null || b?.cost === "" || b?.cost === undefined) {
      await svc.sql(
        `UPDATE mkt_ads_cost_marketplace SET deleted_at = now(), updated_at = now()
          WHERE date = $1::date AND platform = $2 AND deleted_at IS NULL`,
        [date, platform]
      )
      return res.json({ ok: true, deleted: true, date, platform })
    }

    const cost = Math.round(Number(b.cost))
    if (!Number.isFinite(cost) || cost < 0) return res.status(400).json({ error: "Chi phí không hợp lệ" })

    // Lưu email người điền để truy vết khi số liệu lệch.
    let email = ""
    try {
      const { Modules } = await import("@medusajs/framework/utils")
      const userModule = req.scope.resolve(Modules.USER)
      const user = await userModule.retrieveUser(auth.actor_id, { select: ["id", "email"] })
      email = user.email || ""
    } catch { /* không chặn việc lưu chỉ vì thiếu email */ }

    await svc.sql(`
      INSERT INTO mkt_ads_cost_marketplace (date, platform, cost, note, created_by)
      VALUES ($1::date, $2, $3, $4, $5)
      ON CONFLICT (date, platform) DO UPDATE SET
        cost       = EXCLUDED.cost,
        note       = EXCLUDED.note,
        created_by = EXCLUDED.created_by,
        deleted_at = NULL,
        updated_at = now()
    `, [date, platform, cost, b?.note ?? null, email])

    return res.json({ ok: true, date, platform, cost })
  } catch (err: any) {
    console.error("[mkt-cost-marketplace PUT]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
