// ============================================================================
// Extract MKT code từ campaign name — nguồn sự thật dùng chung.
// Trước đây hàm này bị copy ở 6 chỗ (mkt-cost route, backfill, jobs...) — mọi
// thay đổi alias/format PHẢI sửa ở đây, không copy lại.
// ============================================================================

/**
 * Alias: tên dùng trong camp FB → tên marketer chuẩn trên Pancake.
 * Báo cáo MKT join chi phí với doanh số qua mkt_name, nên code trong tên camp
 * phải khớp tên marketer Pancake — nếu lệch thì map tại đây.
 */
export const MKT_ALIASES: Record<string, string> = {
  TRUONGAN: "ANHTD", // Trường An đặt camp "TRUONGAN" nhưng Pancake là "ANHTD"
}

/**
 * Mã MKT của agent tự động. Agent được đối xử như một marketer bình thường:
 * có mã riêng, tài khoản Ads riêng, và số liệu hiện song song với người trong
 * MỌI báo cáo — doanh số MKT, LNG theo MKT, chi phí, ROAS.
 *
 * Nhờ vậy không cần thêm cột hay nhánh xử lý nào: camp đặt tên chứa "AGENT"
 * thì extractMkt() trả về "AGENT", và toàn bộ pipeline sẵn có tự chạy đúng.
 *
 * Quy ước đặt tên camp cho agent, giống hệt camp của người:
 *   PHVVN026CV_18/9_AGENT_CHẢO VÀNG HẤP_ADS349_VD133_30ALL
 */
export const AGENT_MKT_CODE = "AGENT"

/** Camp này do agent quản lý? Dùng để tách số liệu người vs máy khi so sánh. */
export function laCampAgent(campaignName: string): boolean {
  return extractMkt(campaignName) === AGENT_MKT_CODE
}

/**
 * Extract MKT code từ campaign name.
 * Hỗ trợ 2 format delimiter: _ và -
 * Format: MÃSP_DD/MM_MKTCODE_SẢN PHẨM_... hoặc DD/MM-MKTCODE-...
 * Bỏ prefix: TEST_, MESS_, TEST_MESS_
 */
export function extractMkt(campaignName: string): string {
  const cleaned = campaignName.replace(/^(TEST[_-]|MESS[_-])+/gi, "")
  for (const sep of ["_", "-"]) {
    const parts = cleaned.split(sep)
    for (let i = 1; i < parts.length; i++) {
      const t = parts[i].trim()
      if (/^[A-Z]{3,8}$/.test(t)) return MKT_ALIASES[t] ?? t
    }
  }
  return "KHÁC"
}
