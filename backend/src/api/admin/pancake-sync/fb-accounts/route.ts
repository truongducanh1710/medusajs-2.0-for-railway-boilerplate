import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

function getService(req: MedusaRequest) {
  return req.scope.resolve("cskhAnalysisModule") as any
}

/**
 * GET /admin/pancake-sync/fb-accounts
 * Lấy danh sách tài khoản FB Ads đã cấu hình
 */
const FB_API_BASE = "https://graph.facebook.com/v18.0"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const svc = getService(req)
    await svc.sql(`ALTER TABLE fb_ad_account ADD COLUMN IF NOT EXISTS allowed_mkt_codes TEXT[] DEFAULT '{}'`)
    const accounts = await svc.sql(`
      SELECT id, account_id, account_name, mkt_name, active, note, created_at, allowed_mkt_codes
      FROM fb_ad_account
      WHERE deleted_at IS NULL
      ORDER BY active DESC, created_at ASC
    `)

    // Backfill tên cho các account chưa có — gọi FB API rồi trả về ngay
    const missing = accounts.filter((a: any) => !a.account_name)
    if (missing.length > 0) {
      const token = process.env.FB_ACCESS_TOKEN ?? ""
      if (token) {
        await Promise.allSettled(missing.map(async (a: any) => {
          try {
            const r = await fetch(`${FB_API_BASE}/${a.account_id}?fields=name&access_token=${token}`)
            const j: any = await r.json()
            if (j.name) {
              a.account_name = j.name
              await svc.sql(`UPDATE fb_ad_account SET account_name = $1, updated_at = now() WHERE account_id = $2`, [j.name, a.account_id])
            }
          } catch { /* ignore */ }
        }))
      }
    }

    // Gắn thêm: số camp ACTIVE hôm nay + ngày có spend gần nhất
    const today = new Date().toISOString().slice(0, 10)
    const stats = await svc.sql(`
      SELECT
        ad_account_id,
        MAX(date)::text                                            AS last_spend_date,
        SUM(CASE WHEN date = $1::date AND effective_status = 'ACTIVE' THEN 1 ELSE 0 END)::int AS active_camps_today
      FROM mkt_ads_cost
      WHERE deleted_at IS NULL
        AND ad_account_id = ANY($2::text[])
      GROUP BY ad_account_id
    `, [today, accounts.map((a: any) => a.account_id)])

    const statsMap: Record<string, any> = {}
    for (const s of stats) statsMap[s.ad_account_id] = s

    for (const a of accounts) {
      const s = statsMap[a.account_id]
      a.active_camps_today = s?.active_camps_today ?? 0
      a.last_spend_date = s?.last_spend_date ?? null
    }

    return res.json({ accounts })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/**
 * POST /admin/pancake-sync/fb-accounts
 * Thêm tài khoản mới
 * Body: { account_id, account_name?, mkt_name?, note? }
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { account_id, account_name = "", mkt_name = "", note = "" } = req.body as any
    if (!account_id) return res.status(400).json({ error: "account_id là bắt buộc" })

    const rawId = account_id.toString().replace(/^act_/i, "").trim()
    if (!/^\d+$/.test(rawId)) return res.status(400).json({ error: "account_id không hợp lệ (chỉ gồm số)" })

    const actId = `act_${rawId}`
    const svc = getService(req)

    await svc.sql(`
      INSERT INTO fb_ad_account (account_id, account_name, mkt_name, note, active)
      VALUES ($1, $2, $3, $4, true)
      ON CONFLICT (account_id) DO UPDATE SET
        account_name = EXCLUDED.account_name,
        mkt_name = EXCLUDED.mkt_name,
        note = EXCLUDED.note,
        active = true,
        deleted_at = NULL,
        updated_at = now()
    `, [actId, account_name.trim(), mkt_name.trim().toUpperCase(), note.trim()])

    const [row] = await svc.sql(`SELECT * FROM fb_ad_account WHERE account_id = $1`, [actId])
    return res.json({ account: row })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
