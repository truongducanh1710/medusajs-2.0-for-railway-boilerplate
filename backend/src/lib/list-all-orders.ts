/**
 * Tải HẾT pancake_order khớp filter, theo từng trang — thay cho `take: 10000` cứng.
 *
 * Các report cũ gọi listPancakeOrders(filter, { take: 10000 }) một lần. Từ tháng 8/2026
 * riêng VN đã vượt 10.000 đơn/tháng (08: 13.176, 09: 12.736), nên tab Tổng quan xem
 * "Tháng này" bị thiếu ~20–25% đơn mà không báo gì — và vì không có ORDER BY, phần bị
 * cắt là ngẫu nhiên chứ không chỉ cuối kỳ.
 *
 * Phân trang theo (pancake_created_at, id) để thứ tự cố định giữa các trang — thiếu id
 * thì các đơn cùng timestamp có thể nhảy trang, gây trùng/sót.
 *
 * `hardCap` chỉ là lưới an toàn bộ nhớ; vượt thì ghi cảnh báo thay vì im lặng cắt.
 */
export async function listAllPancakeOrders(
  syncService: any,
  filters: Record<string, any>,
  opts: { select?: string[]; direction?: "ASC" | "DESC"; pageSize?: number; hardCap?: number; label?: string } = {}
): Promise<any[]> {
  const pageSize = opts.pageSize ?? 5000
  const hardCap = opts.hardCap ?? 300_000
  const dir = opts.direction ?? "ASC"
  const out: any[] = []
  for (let skip = 0; ; skip += pageSize) {
    const page = await syncService.listPancakeOrders(filters, {
      ...(opts.select ? { select: opts.select } : {}),
      order: { pancake_created_at: dir, id: dir },
      skip,
      take: pageSize,
    })
    out.push(...page)
    if (page.length < pageSize) break
    if (out.length >= hardCap) {
      console.warn(`[listAllPancakeOrders] ${opts.label ?? ""} chạm trần an toàn ${hardCap} đơn — số liệu có thể thiếu`)
      break
    }
  }
  return out
}
