export function formatVND(amount: number) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(amount)) + "đ"
}

export function formatK(amount: number) {
  return Math.round(amount / 1000) + "k"
}
