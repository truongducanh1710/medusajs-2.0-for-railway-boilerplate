import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

// PATCH /admin/ads-expense/report/:id — sửa giao dịch (regex đọc sai, hoặc chỉnh thủ công)
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const svc = req.scope.resolve("mktTaskModule") as any
    const { id } = req.params
    const { merchant, amount, currency, txn_at, card_last4 } = req.body as any

    const data: any = { id }
    if (merchant !== undefined) data.merchant = merchant
    if (currency !== undefined) data.currency = currency
    if (card_last4 !== undefined) data.card_last4 = card_last4
    if (txn_at !== undefined) data.txn_at = txn_at ? new Date(txn_at) : null
    if (amount !== undefined) {
      const amountNum = Number(amount)
      if (!amountNum || Number.isNaN(amountNum)) return res.status(400).json({ error: "amount khong hop le" })
      data.amount = amountNum
    }

    const row = await svc.updateAdsExpenseTransactions(data)
    res.json({ row })
  } catch (e: any) {
    if (e?.code === "23505") {
      return res.status(409).json({ error: "Giao dịch trùng (cùng thẻ, số tiền, thời điểm) đã tồn tại" })
    }
    res.status(500).json({ error: e.message })
  }
}

// DELETE /admin/ads-expense/report/:id
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const svc = req.scope.resolve("mktTaskModule") as any
    const { id } = req.params
    await svc.deleteAdsExpenseTransactions(id)
    res.json({ id, deleted: true })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
