// ============================================================================
// Quy tắc đặt tên Camp & UTM — nguồn sự thật dùng chung
// (tách từ bao-cao-mkt/page.tsx để boost-camp + marketing-video dùng lại)
// ============================================================================

/** Mã SP trên POS ↔ tên sản phẩm. Mã dùng trong camp = pos bỏ dấu _. */
export const SKU_LIST: { pos: string; name: string }[] = [
  { pos: "PHVVN040_KG",     name: "KẸP GẮP ĐỒ" },
  { pos: "PHVVN016_CCD",    name: "CHẢO CHỐNG DÍNH KÈM KHAY HẤP" },
  { pos: "PHVVN014_MBDN",   name: "DỤNG CỤ BÀO ĐA NĂNG" },
  { pos: "PHVVN026_CV",     name: "CHẢO VÀNG CHỐNG DÍNH KÈM KHAY HẤP" },
  { pos: "PHVVN034_KĐĐ",    name: "KỆ ĐỂ ĐỒ HAI TẦNG" },
  { pos: "PHVVN030_NAS",    name: "NỒI ÁP SUẤT" },
  { pos: "PHVVN036_NC",     name: "NỒI CHIÊN INOX 304" },
  { pos: "PHVVN023_GĐQA",   name: "GIỎ ĐỰNG QUẦN ÁO ĐA NĂNG" },
  { pos: "PHVVN035_GCNG",   name: "GẬY CHỐNG CHO NGƯỜI GIÀ" },
  { pos: "PHVVN031_BCX",    name: "BỘ CÂY LAU NHÀ XANH" },
  { pos: "PHVVN038_KLD",    name: "BỘ KHAY LỌC DẦU" },
  { pos: "PHVVN004_GBLN",   name: "GIẺ LAU NHÀ TÁCH NƯỚC" },
  { pos: "PHVVN001_XKC",    name: "DỤNG CỤ XỎ KIM CHỈ" },
  { pos: "PHVVN037_HDTP",   name: "HỘP ĐỰNG THỰC PHẨM INOX" },
  { pos: "PHVVN003_BLN",    name: "BỘ LAU NHÀ TÁCH NƯỚC" },
  { pos: "PHVVN033_NCDTMS", name: "NỒI CHỐNG DÍNH TRÁNG MEN SỨ" },
  { pos: "PHVVN028_BL",     name: "BALO CHẠY BỘ" },
  { pos: "PHVVN008_GLNTV",  name: "GIẺ LAU NHÀ TỰ VẮT PHUN SƯƠNG" },
  { pos: "PHVVN015_MXCLN",  name: "MÚT XỐP CÂY LAU NHÀ TỰ VẮT" },
]

/** Mã POS → mã dùng trong camp (bỏ dấu _): PHVVN026_CV → PHVVN026CV */
export const toCampCode = (pos: string): string => pos.replace(/_/g, "")

export const MKT_CODES = ["KIENLB", "XUANLT", "NAMDV", "LINHMT", "ANHNT", "DUPD"]

/** Regex parse tên camp: MÃSP_DD/MM_MKT_TÊN SP_ADSXXX_AUDIENCE_VIDEO[_SUFFIX] */
export const CAMP_REGEX = /^([A-Z0-9]+)_(\d{1,2}\/\d{1,2})_([A-Z]+)_(.+?)_(ADS\d+)_(.+?)_(VD[\w\d\-\.]+)(_.+)?$/i

/** UTM string chính thức — set vào creative.url_tags, FB tự thay macro. */
export const UTM_STATIC =
  "utm_source={{campaign.name}}&utm_medium={{adset.name}}&utm_campaign={{campaign.id}}&utm_content={{ad.name}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}&placement={{placement}}"

/** Tìm mã camp (PHVVN...) khớp gần đúng theo tên sản phẩm. Trả "" nếu không match. */
export function matchSkuByName(productName: string): string {
  if (!productName) return ""
  const norm = (s: string) => s.toLowerCase().normalize("NFC").trim()
  const p = norm(productName)
  // Exact name match trước
  const exact = SKU_LIST.find(s => norm(s.name) === p)
  if (exact) return toCampCode(exact.pos)
  // Chứa nhau (tên SP dài hơn / ngắn hơn)
  const partial = SKU_LIST.find(s => norm(s.name).includes(p) || p.includes(norm(s.name)))
  return partial ? toCampCode(partial.pos) : ""
}

/** Ngày dạng D/M không zero-pad: 4/6 */
export function todayDM(d = new Date()): string {
  return `${d.getDate()}/${d.getMonth() + 1}`
}

/** Parse số ads account từ account_name: "PHV - Ads341 - ..." → "ADS341" */
export function parseAdsCode(accountName: string): string {
  const m = accountName?.match(/ads\s*(\d+)/i)
  return m ? `ADS${m[1]}` : "ADS"
}

/**
 * Tên Campaign theo convention:
 * MÃSP_DD/MM_MKTCODE_TÊN SP_ADSXXX_AUDIENCE_VDXXX[_SUFFIX]
 */
export function buildCampaignName(o: {
  skuCode: string       // PHVVN026CV (đã bỏ dấu)
  mktCode: string       // XUANLT
  productName: string   // CHẢO VÀNG HẤP (sẽ uppercase)
  adsCode: string       // ADS341
  audience: string      // 30ALL
  vdCode: string        // VD1023
  suffix?: string       // S2
  date?: Date
}): string {
  const parts = [
    o.skuCode,
    todayDM(o.date),
    o.mktCode.toUpperCase(),
    o.productName.toUpperCase().trim(),
    o.adsCode,
    o.audience.trim(),
    o.vdCode,
  ]
  let name = parts.join("_")
  if (o.suffix) name += `_${o.suffix.trim()}`
  return name
}

/** Tên Ad: [VD_CODE] - [post_id]. Khi chưa có post_id → chỉ VD_CODE. */
export function buildAdName(vdCode: string, postId?: string): string {
  return postId ? `${vdCode} - ${postId}` : vdCode
}
