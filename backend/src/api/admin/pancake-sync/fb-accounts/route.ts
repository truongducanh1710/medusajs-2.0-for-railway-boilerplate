import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

function getService(req: MedusaRequest) {
  return req.scope.resolve("cskhAnalysisModule") as any
}

/**
 * GET /admin/pancake-sync/fb-accounts
 * Lấy danh sách tài khoản FB Ads đã cấu hình
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const svc = getService(req)
    const accounts = await svc.sql(`
      SELECT id, account_id, account_name, mkt_name, active, note, created_at
      FROM fb_ad_account
      WHERE deleted_at IS NULL
      ORDER BY active DESC, created_at ASC
    `)
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
