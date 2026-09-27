/**
 * Map tên tỉnh/thành (từ provinces.open-api.vn) → Pancake province_id (84_VNxxx format)
 * Pancake province_id = "84_VN" + zero-padded open-api code (3 digits)
 *
 * open-api codes: https://provinces.open-api.vn/api/?depth=1
 */
// Mã tỉnh Pancake theo 34 tỉnh SAU SÁP NHẬP (01/07/2025). Bảng cũ dùng mã 63 tỉnh
// nên gửi 84_VN120 (Lạng Sơn cũ) Pancake hiểu là Huế — kiểm chứng 27/09/2026 trên
// 3 đơn web. Mã mới lấy từ đơn thật trên Pancake (86% đơn 3 ngày gần nhất dùng
// định dạng này). Tên tỉnh cũ vẫn giữ làm khoá để khách gõ tên cũ vẫn ra đúng.
const PROVINCE_CODE_MAP: Record<string, string> = {
  "Thành phố Hà Nội": "84_VN101",   // → Hà Nội
  "Tỉnh Hà Giang": "84_VN108",   // → Tuyên Quang
  "Tỉnh Cao Bằng": "84_VN107",   // → Cao Bằng
  "Tỉnh Bắc Kạn": "84_VN110",   // → Thái Nguyên
  "Tỉnh Tuyên Quang": "84_VN108",   // → Tuyên Quang
  "Tỉnh Lào Cai": "84_VN109",   // → Lào Cai
  "Tỉnh Điện Biên": "84_VN113",   // → Điện Biên
  "Tỉnh Lai Châu": "84_VN114",   // → Lai Châu
  "Tỉnh Sơn La": "84_VN115",   // → Sơn La
  "Tỉnh Yên Bái": "84_VN109",   // → Lào Cai
  "Tỉnh Hoà Bình": "84_VN112",   // → Phú Thọ
  "Tỉnh Thái Nguyên": "84_VN110",   // → Thái Nguyên
  "Tỉnh Lạng Sơn": "84_VN111",   // → Lạng Sơn
  "Tỉnh Quảng Ninh": "84_VN103",   // → Quảng Ninh
  "Tỉnh Bắc Giang": "84_VN102",   // → Bắc Ninh
  "Tỉnh Phú Thọ": "84_VN112",   // → Phú Thọ
  "Tỉnh Vĩnh Phúc": "84_VN112",   // → Phú Thọ
  "Tỉnh Bắc Ninh": "84_VN102",   // → Bắc Ninh
  "Tỉnh Hải Dương": "84_VN104",   // → Hải Phòng
  "Thành phố Hải Phòng": "84_VN104",   // → Hải Phòng
  "Tỉnh Hưng Yên": "84_VN105",   // → Hưng Yên
  "Tỉnh Thái Bình": "84_VN105",   // → Hưng Yên
  "Tỉnh Hà Nam": "84_VN106",   // → Ninh Bình
  "Tỉnh Nam Định": "84_VN106",   // → Ninh Bình
  "Tỉnh Ninh Bình": "84_VN106",   // → Ninh Bình
  "Tỉnh Thanh Hóa": "84_VN116",   // → Thanh Hoá
  "Tỉnh Nghệ An": "84_VN117",   // → Nghệ An
  "Tỉnh Hà Tĩnh": "84_VN118",   // → Hà Tĩnh
  "Tỉnh Quảng Bình": "84_VN119",   // → Quảng Trị
  "Tỉnh Quảng Trị": "84_VN119",   // → Quảng Trị
  "Thành phố Huế": "84_VN120",   // → Huế
  "Thành phố Đà Nẵng": "84_VN121",   // → Đà Nẵng
  "Tỉnh Quảng Nam": "84_VN121",   // → Đà Nẵng
  "Tỉnh Quảng Ngãi": "84_VN122",   // → Quảng Ngãi
  "Tỉnh Bình Định": "84_VN124",   // → Gia Lai
  "Tỉnh Phú Yên": "84_VN125",   // → Đắk Lắk
  "Tỉnh Khánh Hòa": "84_VN123",   // → Khánh Hoà
  "Tỉnh Ninh Thuận": "84_VN123",   // → Khánh Hoà
  "Tỉnh Bình Thuận": "84_VN126",   // → Lâm Đồng
  "Tỉnh Kon Tum": "84_VN122",   // → Quảng Ngãi
  "Tỉnh Gia Lai": "84_VN124",   // → Gia Lai
  "Tỉnh Đắk Lắk": "84_VN125",   // → Đắk Lắk
  "Tỉnh Đắk Nông": "84_VN126",   // → Lâm Đồng
  "Tỉnh Lâm Đồng": "84_VN126",   // → Lâm Đồng
  "Tỉnh Bình Phước": "84_VN128",   // → Đồng Nai
  "Tỉnh Tây Ninh": "84_VN127",   // → Tây Ninh
  "Tỉnh Bình Dương": "84_VN129",   // → Hồ Chí Minh
  "Tỉnh Đồng Nai": "84_VN128",   // → Đồng Nai
  "Tỉnh Bà Rịa - Vũng Tàu": "84_VN129",   // → Hồ Chí Minh
  "Thành phố Hồ Chí Minh": "84_VN129",   // → Hồ Chí Minh
  "Tỉnh Long An": "84_VN127",   // → Tây Ninh
  "Tỉnh Tiền Giang": "84_VN131",   // → Đồng Tháp
  "Tỉnh Bến Tre": "84_VN130",   // → Vĩnh Long
  "Tỉnh Trà Vinh": "84_VN130",   // → Vĩnh Long
  "Tỉnh Vĩnh Long": "84_VN130",   // → Vĩnh Long
  "Tỉnh Đồng Tháp": "84_VN131",   // → Đồng Tháp
  "Tỉnh An Giang": "84_VN132",   // → An Giang
  "Tỉnh Kiên Giang": "84_VN132",   // → An Giang
  "Thành phố Cần Thơ": "84_VN133",   // → Cần Thơ
  "Tỉnh Hậu Giang": "84_VN133",   // → Cần Thơ
  "Tỉnh Sóc Trăng": "84_VN133",   // → Cần Thơ
  "Tỉnh Bạc Liêu": "84_VN134",   // → Cà Mau
  "Tỉnh Cà Mau": "84_VN134",   // → Cà Mau
  "Tỉnh Thanh Hoá": "84_VN116",   // tên tỉnh mới
  "Tỉnh Khánh Hoà": "84_VN123",   // tên tỉnh mới
}

// Viết tắt khách hay gõ ở cuối địa chỉ
const PROVINCE_ALIAS: Record<string, string> = {
  "hn": "Thành phố Hà Nội",
  "ha noi": "Thành phố Hà Nội",
  "hcm": "Thành phố Hồ Chí Minh",
  "tphcm": "Thành phố Hồ Chí Minh",
  "tp hcm": "Thành phố Hồ Chí Minh",
  "sai gon": "Thành phố Hồ Chí Minh",
  "saigon": "Thành phố Hồ Chí Minh",
  "sg": "Thành phố Hồ Chí Minh",
  "hp": "Thành phố Hải Phòng",
  "dn": "Thành phố Đà Nẵng",
  // Huế chỉ nhận khi có chữ đi kèm — "Huế" đơn lẻ trùng tên đường Nguyễn Huệ
  "thua thien hue": "Thành phố Huế",
  "tp hue": "Thành phố Huế",
  "thanh pho hue": "Thành phố Huế",
  "tinh hue": "Thành phố Huế",
}

function khongDau(s: string): string {
  return s.toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/**
 * Đoán tỉnh từ chuỗi địa chỉ tự do.
 *
 * Form checkout trên web cho khách gõ cả địa chỉ vào một ô (address_1) và ghi
 * "Việt Nam" vào city, nên getPancakeProvinceId(city) luôn null — đơn vào Pancake
 * thiếu tỉnh, sale phải sửa tay. Kiểm chứng 27/09 trên 5 đơn web: cả 5 có city =
 * "Việt Nam", tỉnh nằm ở cuối address_1 ("...hải phòng", "...tây hồ hn").
 *
 * Lấy tỉnh xuất hiện MUỘN NHẤT trong chuỗi — tỉnh thường đứng cuối, còn phần
 * đầu có thể trùng tên phường/quận (vd "phường Hà Nam" ở tỉnh khác).
 */
export function detectProvinceFromText(text: string): string | null {
  if (!text) return null
  const t = ` ${khongDau(text)} `
  let best: { pos: number; len: number; id: string } | null = null
  const consider = (ten: string, id: string) => {
    const n = ` ${khongDau(ten)} `
    const pos = t.lastIndexOf(n)
    if (pos < 0) return
    if (!best || pos > best.pos || (pos === best.pos && n.length > best.len)) {
      best = { pos, len: n.length, id }
    }
  }
  for (const [key, id] of Object.entries(PROVINCE_CODE_MAP)) {
    const ten = key.replace(/^(Tỉnh|Thành phố) /, "")
    if (ten === "Huế") continue   // xem PROVINCE_ALIAS
    consider(ten, id)
  }
  for (const [alias, key] of Object.entries(PROVINCE_ALIAS)) {
    const id = PROVINCE_CODE_MAP[key]
    if (id) consider(alias, id)
  }
  return best ? (best as { id: string }).id : null
}

// Cache ward lookup: provinceName+wardName → commune_id
const wardCache = new Map<string, string | null>()

/**
 * Lookup Pancake province_id từ tên tỉnh
 * Thử exact match, rồi normalize (bỏ "Tỉnh"/"Thành phố")
 */
export function getPancakeProvinceId(provinceName: string): string | null {
  if (!provinceName) return null

  // Exact match
  if (PROVINCE_CODE_MAP[provinceName]) return PROVINCE_CODE_MAP[provinceName]

  // Normalize: thử thêm prefix
  const withTinh = "Tỉnh " + provinceName
  const withTP = "Thành phố " + provinceName
  if (PROVINCE_CODE_MAP[withTinh]) return PROVINCE_CODE_MAP[withTinh]
  if (PROVINCE_CODE_MAP[withTP]) return PROVINCE_CODE_MAP[withTP]

  // Partial match
  const lower = provinceName.toLowerCase()
  for (const [key, val] of Object.entries(PROVINCE_CODE_MAP)) {
    if (key.toLowerCase().includes(lower) || lower.includes(key.toLowerCase().replace(/^(tỉnh|thành phố) /, ""))) {
      return val
    }
  }

  return null
}

/**
 * Lookup Pancake commune_id từ tên phường/xã + tên tỉnh
 * Dùng provinces.open-api.vn để tìm ward code, map sang Pancake format 84_VNxxxxx
 */
export async function getPancakeCommuneId(wardName: string, provinceName: string): Promise<string | null> {
  if (!wardName || !provinceName) return null

  const cacheKey = `${provinceName}||${wardName}`
  if (wardCache.has(cacheKey)) return wardCache.get(cacheKey)!

  try {
    // Tìm province code từ open-api
    const provRes = await fetch(`https://provinces.open-api.vn/api/?depth=1`)
    const provinces: Array<{ code: number; name: string }> = await provRes.json()

    const normalize = (s: string) => s.toLowerCase()
      .replace(/^(tỉnh|thành phố|tp\.?)\s+/i, "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .trim()

    const provNorm = normalize(provinceName)
    const province = provinces.find(p => normalize(p.name) === provNorm)
    if (!province) { wardCache.set(cacheKey, null); return null }

    // Lấy tất cả wards của tỉnh (depth=3)
    const wardRes = await fetch(`https://provinces.open-api.vn/api/p/${province.code}?depth=3`)
    const provData = await wardRes.json()

    const wardNorm = normalize(wardName)
    let foundWard: { code: number; name: string } | null = null

    for (const district of provData.districts || []) {
      const w = (district.wards || []).find((ward: any) => normalize(ward.name) === wardNorm)
      if (w) { foundWard = w; break }
    }

    if (!foundWard) { wardCache.set(cacheKey, null); return null }

    // Pancake commune format: "84_VN" + ward code zero-padded to 5 digits
    const communeId = `84_VN${String(foundWard.code).padStart(5, '0')}`
    wardCache.set(cacheKey, communeId)
    return communeId
  } catch {
    wardCache.set(cacheKey, null)
    return null
  }
}
