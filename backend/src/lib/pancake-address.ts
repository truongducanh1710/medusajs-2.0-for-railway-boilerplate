/**
 * Map tên tỉnh/thành (từ provinces.open-api.vn) → Pancake province_id (84_VNxxx format)
 * Pancake province_id = "84_VN" + zero-padded open-api code (3 digits)
 *
 * open-api codes: https://provinces.open-api.vn/api/?depth=1
 */
const PROVINCE_CODE_MAP: Record<string, string> = {
  "Thành phố Hà Nội": "84_VN101",
  "Tỉnh Hà Giang": "84_VN102",
  "Tỉnh Cao Bằng": "84_VN104",
  "Tỉnh Bắc Kạn": "84_VN106",
  "Tỉnh Tuyên Quang": "84_VN108",
  "Tỉnh Lào Cai": "84_VN110",
  "Tỉnh Điện Biên": "84_VN111",
  "Tỉnh Lai Châu": "84_VN112",
  "Tỉnh Sơn La": "84_VN114",
  "Tỉnh Yên Bái": "84_VN115",
  "Tỉnh Hoà Bình": "84_VN117",
  "Tỉnh Thái Nguyên": "84_VN119",
  "Tỉnh Lạng Sơn": "84_VN120",
  "Tỉnh Quảng Ninh": "84_VN122",
  "Tỉnh Bắc Giang": "84_VN124",
  "Tỉnh Phú Thọ": "84_VN125",
  "Tỉnh Vĩnh Phúc": "84_VN126",
  "Tỉnh Bắc Ninh": "84_VN127",
  "Tỉnh Hải Dương": "84_VN130",
  "Thành phố Hải Phòng": "84_VN103",
  "Tỉnh Hưng Yên": "84_VN133",
  "Tỉnh Thái Bình": "84_VN134",
  "Tỉnh Hà Nam": "84_VN135",
  "Tỉnh Nam Định": "84_VN136",
  "Tỉnh Ninh Bình": "84_VN137",
  "Tỉnh Thanh Hóa": "84_VN138",
  "Tỉnh Nghệ An": "84_VN140",
  "Tỉnh Hà Tĩnh": "84_VN142",
  "Tỉnh Quảng Bình": "84_VN144",
  "Tỉnh Quảng Trị": "84_VN145",
  "Thành phố Huế": "84_VN146",
  "Thành phố Đà Nẵng": "84_VN148",
  "Tỉnh Quảng Nam": "84_VN149",
  "Tỉnh Quảng Ngãi": "84_VN151",
  "Tỉnh Bình Định": "84_VN152",
  "Tỉnh Phú Yên": "84_VN154",
  "Tỉnh Khánh Hòa": "84_VN156",
  "Tỉnh Ninh Thuận": "84_VN158",
  "Tỉnh Bình Thuận": "84_VN160",
  "Tỉnh Kon Tum": "84_VN162",
  "Tỉnh Gia Lai": "84_VN164",
  "Tỉnh Đắk Lắk": "84_VN166",
  "Tỉnh Đắk Nông": "84_VN167",
  "Tỉnh Lâm Đồng": "84_VN168",
  "Tỉnh Bình Phước": "84_VN170",
  "Tỉnh Tây Ninh": "84_VN172",
  "Tỉnh Bình Dương": "84_VN174",
  "Tỉnh Đồng Nai": "84_VN175",
  "Tỉnh Bà Rịa - Vũng Tàu": "84_VN177",
  "Thành phố Hồ Chí Minh": "84_VN129",
  "Tỉnh Long An": "84_VN180",
  "Tỉnh Tiền Giang": "84_VN182",
  "Tỉnh Bến Tre": "84_VN183",
  "Tỉnh Trà Vinh": "84_VN184",
  "Tỉnh Vĩnh Long": "84_VN186",
  "Tỉnh Đồng Tháp": "84_VN187",
  "Tỉnh An Giang": "84_VN189",
  "Tỉnh Kiên Giang": "84_VN191",
  "Thành phố Cần Thơ": "84_VN192",
  "Tỉnh Hậu Giang": "84_VN193",
  "Tỉnh Sóc Trăng": "84_VN194",
  "Tỉnh Bạc Liêu": "84_VN195",
  "Tỉnh Cà Mau": "84_VN196",
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

    // Pancake commune format: "84_VN" + ward code (open-api ward code là 5 chữ số)
    const communeId = `84_VN${foundWard.code}`
    wardCache.set(cacheKey, communeId)
    return communeId
  } catch {
    wardCache.set(cacheKey, null)
    return null
  }
}
