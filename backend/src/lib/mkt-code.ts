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
 * Camp do agent lên đặt tên theo ĐÚNG quy ước cũ, chỉ thêm hậu tố _AGENT ở cuối:
 *   PHVVN026CV_18/9_ANHTD_CHẢO VÀNG HẤP_ADS342_VD133_30ALL_AGENT
 *
 * Giữ mã MKT gốc (ANHTD) là cố ý: chi phí vẫn quy về đúng tài khoản Ads và đúng
 * người chịu trách nhiệm, nên mọi báo cáo hiện có không đổi. Hậu tố chỉ để tách
 * người vs máy khi cần so sánh hiệu quả — không tạo ra một MKT giả trong báo cáo.
 */
const HAU_TO_AGENT = "AGENT"

/** Camp này do agent lên? Nhận biết qua hậu tố _AGENT ở cuối tên camp. */
export function laCampAgent(campaignName: string): boolean {
  const t = (campaignName ?? "").trim().toUpperCase()
  return t.endsWith(`_${HAU_TO_AGENT}`) || t.endsWith(`-${HAU_TO_AGENT}`)
}

/**
 * Extract MKT code từ campaign name.
 * Hỗ trợ 2 format delimiter: _ và -
 * Format: MÃSP_DD/MM_MKTCODE_SẢN PHẨM_... hoặc DD/MM-MKTCODE-...
 * Bỏ prefix: TEST_, MESS_, TEST_MESS_
 */
export function extractMkt(campaignName: string): string {
  // Bỏ hậu tố _AGENT trước khi quét: nếu không, camp thiếu mã MKT sẽ khớp nhầm
  // vào chính chữ AGENT và tạo ra một MKT không có thật trong báo cáo.
  const cleaned = campaignName
    .replace(/^(TEST[_-]|MESS[_-])+/gi, "")
    .replace(/[_-]AGENT$/i, "")
  for (const sep of ["_", "-"]) {
    const parts = cleaned.split(sep)
    for (let i = 1; i < parts.length; i++) {
      const t = parts[i].trim()
      if (/^[A-Z]{3,8}$/.test(t)) return MKT_ALIASES[t] ?? t
    }
  }
  return "KHÁC"
}
