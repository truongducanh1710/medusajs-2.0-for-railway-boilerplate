export const ADS_EXPENSE_CHANNEL_NAME = "KẾ TOÁN - MKT - Báo Ngưỡng"

export type ParsedAdsExpense = {
  card_last4: string | null
  merchant: string | null
  amount: number
  currency: string
  txn_at: Date | null
  raw_text: string
}

// "The Visa 438103...3793 su dung tai FACEBK *M6Z5MVVXY2 Dublin IE so tien 5,500,000 VND luc 13-07-2026 22:30:35."
const TXN_REGEX = /Visa\s+([\d.]+)\s+su dung tai\s+(.+?)\s+so tien\s+([\d,.]+)\s*(VND|USD)?\s*luc\s+(\d{2}-\d{2}-\d{4})\s+(\d{2}:\d{2}:\d{2})/i

export function parseAdsExpenseText(text: string): ParsedAdsExpense | null {
  const match = TXN_REGEX.exec(text)
  if (!match) return null

  const [, cardRaw, merchant, amountRaw, currency, dateStr, timeStr] = match
  const cardDigits = cardRaw.replace(/\D/g, "")
  const cardLast4 = cardDigits.slice(-4) || null
  const amount = Number(amountRaw.replace(/[.,]/g, ""))
  if (!amount || Number.isNaN(amount)) return null

  const [day, month, year] = dateStr.split("-").map(Number)
  const [hh, mm, ss] = timeStr.split(":").map(Number)
  const txnAt = new Date(Date.UTC(year, month - 1, day, hh - 7, mm, ss))

  return {
    card_last4: cardLast4,
    merchant: merchant.trim(),
    amount,
    currency: currency || "VND",
    txn_at: Number.isNaN(txnAt.getTime()) ? null : txnAt,
    raw_text: text,
  }
}
