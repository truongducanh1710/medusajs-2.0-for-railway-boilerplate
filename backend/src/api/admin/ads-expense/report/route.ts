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
