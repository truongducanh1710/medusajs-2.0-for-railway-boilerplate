import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

// GET /admin/ads-expense/report?from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const svc = req.scope.resolve("mktTaskModule") as any
    const { from, to } = req.query as any

    const filter: any = { deleted_at: null }
    if (from || to) {
      filter.txn_at = {}
      if (from) filter.txn_at.$gte = new Date(`${from}T00:00:00+07:00`)
      if (to) filter.txn_at.$lte = new Date(`${to}T23:59:59+07:00`)
    }

    const rows = await svc.listAdsExpenseTransactions(filter, { order: { txn_at: "DESC" } })
    const total = rows.reduce((s: number, r: any) => s + Number(r.amount || 0), 0)

    res.json({ rows, total, count: rows.length })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

// POST /admin/ads-expense/report — thêm giao dịch thủ công
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const svc = req.scope.resolve("mktTaskModule") as any
    const { merchant, amount, currency, txn_at, card_last4, channel_id } = req.body as any

    const amountNum = Number(amount)
    if (!amountNum || Number.isNaN(amountNum)) {
      return res.status(400).json({ error: "amount khong hop le" })
    }

    const row = await svc.createAdsExpenseTransactions({
      channel_id: channel_id || "manual",
      card_last4: card_last4 || null,
      merchant: merchant || null,
      amount: amountNum,
      currency: currency || "VND",
      txn_at: txn_at ? new Date(txn_at) : new Date(),
      raw_text: null,
      parsed_by: "manual",
    })

    res.json({ row })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
