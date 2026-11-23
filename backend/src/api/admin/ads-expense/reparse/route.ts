import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool } from "../../../../lib/db"
import { ADS_EXPENSE_CHANNEL_NAME, ingestAdsExpenseMessage } from "../../mkt-chat/_ads-expense-parser"

// POST /admin/ads-expense/reparse?from=YYYY-MM-DD
// Quét lại tin nhắn nhóm kế toán (gửi từ ngày `from`, mặc định 60 ngày trước) để bắt giao dịch
// mà parser cũ bỏ sót. Giao dịch đã có (trùng mã FACEBK *XXXX hoặc thẻ+tiền+thời điểm) được bỏ qua.
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const svc = req.scope.resolve("mktTaskModule") as any
    const { from } = req.query as any
    const since = from ? new Date(`${from}T00:00:00+07:00`) : new Date(Date.now() - 60 * 86400000)
    if (Number.isNaN(since.getTime())) return res.status(400).json({ error: "from khong hop le" })

    const pool = getPool()
    const { rows: channels } = await pool.query(
      `select id from mkt_channel where name = $1 and deleted_at is null`,
      [ADS_EXPENSE_CHANNEL_NAME]
    )
    const totals = { messages: 0, parsed: 0, inserted: 0, skipped: 0 }
    for (const ch of channels) {
      const { rows: msgs } = await pool.query(
        `select id, channel_id, content, created_at from mkt_message
          where channel_id = $1 and msg_type = 'text' and deleted_at is null and recalled_at is null
            and created_at >= $2
          order by created_at asc`,
        [ch.id, since]
      )
      for (const m of msgs) {
        const r = await ingestAdsExpenseMessage(svc, m)
        totals.messages++
        totals.parsed += r.parsed
        totals.inserted += r.inserted
        totals.skipped += r.skipped
      }
    }
    res.json(totals)
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
