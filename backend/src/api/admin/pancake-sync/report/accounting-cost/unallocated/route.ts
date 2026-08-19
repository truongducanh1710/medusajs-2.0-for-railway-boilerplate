import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"
import { AD_ACCOUNTS, codeToAccount, computeAccountingCost } from "../route"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}
async function sql(query: string, params?: any[]): Promise<any[]> {
  const client = await getPool().connect()
  try {
    return (await client.query(query, params ?? [])).rows
  } finally {
    client.release()
  }
}

const accountToCode: Record<string, string> = {}
for (const a of AD_ACCOUNTS) accountToCode[a.account_id] = a.ads_code

/**
 * Chi tiết dòng "KHÁC" ở bảng phân bổ CP thực: tiền chưa quy được về NV nào
 * đến từ camp nào, tài khoản nào, ngày nào — để kế toán đi gán mã MKT.
 *
 * Lưu ý quan trọng: cột `amount` KHÔNG phải số tiền camp đã tiêu, mà là phần
 * TIỀN NẠP tương ứng với camp đó — bằng spend camp × (tiền nạp / tổng tiêu của
 * tài khoản). Đúng bằng đơn vị đang thiếu ở bảng phân bổ, nên cộng lại khớp.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { from, to } = req.query as Record<string, string>
    if (!from || !to) return res.status(400).json({ error: "Thiếu from/to" })

    const { items, spendByAcc, unallocated, unallocatedNotes } =
      await computeAccountingCost(from, to)

    // Tiền nạp theo từng tài khoản FB trong kỳ (nhiều khoản nạp cùng 1 mã ADS
    // thì cộng dồn — tỷ lệ quy đổi spend → tiền vẫn đúng).
    const napByAccount: Record<string, number> = {}
    for (const it of items) {
      if (it.kind !== "nap" || !it.ads_code) continue
      const acc = codeToAccount[it.ads_code]
      if (!acc) continue
      napByAccount[acc] = (napByAccount[acc] || 0) + Number(it.amount)
    }

    // Các camp chưa gắn mã MKT, chỉ ở những tài khoản THỰC SỰ có tiền nạp —
    // camp ở tài khoản không nạp thì không tạo ra chênh lệch nào để đi tìm.
    const accounts = Object.keys(napByAccount)
    const campaigns = accounts.length
      ? await sql(
          `SELECT date::text AS date, ad_account_id, campaign_id, campaign_name,
                  SUM(spend)::bigint AS spend
           FROM mkt_ads_cost
           WHERE deleted_at IS NULL
             AND date >= $1::date AND date <= $2::date
             AND ad_account_id = ANY($3)
             AND (mkt_name IS NULL OR TRIM(mkt_name) = '' OR UPPER(TRIM(mkt_name)) = 'KHÁC')
           GROUP BY date, ad_account_id, campaign_id, campaign_name
           HAVING SUM(spend) > 0
           ORDER BY SUM(spend) DESC, date ASC`,
          [from, to, accounts]
        )
      : []

    const rows = campaigns.map((c: any) => {
      const spend = Number(c.spend)
      const accSpend = spendByAcc[c.ad_account_id] || {}
      const totalSpend = Object.values(accSpend).reduce((s: number, v: any) => s + Number(v), 0)
      const nap = napByAccount[c.ad_account_id] || 0
      // Quy đổi spend của camp sang phần tiền nạp tương ứng.
      const amount = totalSpend > 0 ? Math.round(nap * (spend / totalSpend)) : 0
      return {
        date: c.date,
        ads_code: accountToCode[c.ad_account_id] || c.ad_account_id,
        ad_account_id: c.ad_account_id,
        campaign_id: c.campaign_id,
        campaign_name: c.campaign_name,
        spend,
        amount,
      }
    })

    const matched = rows.reduce((s, r) => s + r.amount, 0)
    // Phần còn lại không truy được về camp nào (mã ADS chưa khai, tài khoản
    // không có chi tiêu, chi phí chung không chia được, sai số làm tròn).
    const unmatched = unallocated - matched

    // Gom theo tài khoản để kế toán nhìn nhanh chỗ nào nặng nhất.
    const byAccountMap: Record<string, { ads_code: string; amount: number; spend: number; campaigns: number }> = {}
    for (const r of rows) {
      const k = r.ads_code
      if (!byAccountMap[k]) byAccountMap[k] = { ads_code: k, amount: 0, spend: 0, campaigns: 0 }
      byAccountMap[k].amount += r.amount
      byAccountMap[k].spend += r.spend
      byAccountMap[k].campaigns += 1
    }
    const by_account = Object.values(byAccountMap).sort((a, b) => b.amount - a.amount)

    return res.json({
      from, to,
      unallocated,
      unallocated_notes: unallocatedNotes,
      matched, unmatched,
      by_account,
      rows,
    })
  } catch (err: any) {
    console.error("[report/accounting-cost/unallocated GET]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
