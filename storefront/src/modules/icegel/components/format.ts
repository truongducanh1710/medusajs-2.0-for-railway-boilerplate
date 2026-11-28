export function formatVND(amount: number) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(amount)) + "đ"
}

/** Percent off the list price; 0 when there is no higher compare-at price */
export function discountPct(price: number, compareAt: number) {
  return compareAt > price ? Math.round((1 - price / compareAt) * 100) : 0
}

export function formatK(amount: number) {
  return Math.round(amount / 1000) + "k"
}
