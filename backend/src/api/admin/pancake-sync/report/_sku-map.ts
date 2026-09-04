import { Pool } from "pg"
import { COMBO_COMPOSITION, DISPLAY_ID_ALIASES, type AvgCostResult } from "../../gia-von/avg-cost/route"

/**
 * Giá vốn cho SKU sàn khai tay ở tab "Khớp SP sàn" (bảng marketplace_sku_map).
 *
 * Trên Shopee/TikTok người đăng bán tự đặt tên và sàn tự sinh SKU, ví dụ
 * "336391824840 - SET COMBO 2 Chổi Vệ Sinh INOX 304…" — không khớp mã nào trong bảng
 * giá vốn nên báo cáo tra ra 0 và đánh dấu "thiếu giá vốn". Nhân sự khai SKU đó gồm
 * những mã nào (kèm số lượng), hàm này quy ra giá vốn 1 đơn vị SKU.
 *
 * Trả về map key → giá vốn, với key là sku_key đã chuẩn hoá (viết hoa, gộp khoảng
 * trắng). Báo cáo nạp vào cost_map dưới kind 'skumap' và tra TRƯỚC mọi nấc khác:
 * nhân sự khai tay là quyết định cuối cùng, đè lên mọi suy đoán tự động.
 *
 * SKU thiếu giá vốn của bất kỳ mã con nào thì KHÔNG ghi vào kết quả — để nó tiếp tục
 * hiện "thiếu giá vốn" thay vì báo một con số thiếu và im lặng tạo lãi ảo.
 */
export async function loadSkuMapCosts(
  pool: Pool,
  avg: AvgCostResult,
  accessoryCost: Record<string, number>,
  // Phụ kiện tra theo MÃ ở cột K của cost_sheet. Phụ kiện bán lẻ trên sàn về với mã
  // riêng (vd PHVVN008_GLNTV) mà computeAvgCost chỉ đưa dòng "Sản phẩm chính" vào
  // costs, nên thiếu map này thì khai tay trỏ vào mã phụ kiện vẫn ra "chưa có giá vốn".
  accessoryByCode: Record<string, number> = {},
): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  let rows: any[]
  try {
    const r = await pool.query(`SELECT sku_key, product_code, qty FROM marketplace_sku_map`)
    rows = r.rows
  } catch {
    return out // bảng chưa tạo (chưa ai mở tab) — coi như chưa khai map nào
  }

  const costOf = (code: string): number | null => {
    const c = String(code).trim().toUpperCase()
    if (accessoryCost[c] != null) return accessoryCost[c]
    if (avg.byName[c] != null) return avg.byName[c]
    const alias = DISPLAY_ID_ALIASES[c] ?? c
    if (avg.costs[alias] != null) return avg.costs[alias]
    // Sau costs để sản phẩm chính luôn được ưu tiên hơn dòng phụ kiện cùng mã.
    if (accessoryByCode[c] != null) return accessoryByCode[c]
    if (accessoryByCode[alias] != null) return accessoryByCode[alias]
    const m = alias.match(/^(PHVVN\d{2,3})/)
    if (m && avg.byPrefix[m[1]] != null) return avg.byPrefix[m[1]]
    return null
  }

  const grouped: Record<string, { code: string; qty: number }[]> = {}
  for (const r of rows) {
    (grouped[String(r.sku_key)] ??= []).push({
      code: String(r.product_code), qty: Number(r.qty) || 1,
    })
  }

  for (const [key, parts] of Object.entries(grouped)) {
    let sum = 0
    let complete = true
    for (const p of parts) {
      const c = costOf(p.code)
      if (c == null) { complete = false; break }
      sum += c * p.qty
    }
    if (complete) out[key] = Math.round(sum)
  }
  return out
}

/**
 * Thành phần của SKU sàn khai tay, để phân bổ CHI PHÍ ADS.
 *
 * Combo mang mã riêng (PHVVN050_CB1 = 2 khay + 5 hộp inox) nên chi phí ads điền cho
 * khay (PHVVN038) và hộp (PHVVN037) không chạm tới đơn combo: doanh thu combo được
 * ghi nhận mà ads kéo ra đơn đó thì không, làm combo lãi ảo còn SP lẻ gánh nặng thêm.
 * Map này cho báo cáo nổ 1 dòng combo thành các mã lẻ để chia ads đúng chỗ.
 *
 * Key trả về gồm CẢ sku_key đã chuẩn hoá VÀ mã SP, vì tab "Khớp SP sàn" cho khai theo
 * mã lẫn theo tên hiển thị — dòng hàng chỉ có một trong hai là tra được.
 */
export async function loadSkuMapParts(
  pool: Pool,
): Promise<Record<string, { code: string; qty: number }[]>> {
  const out: Record<string, { code: string; qty: number }[]> = {}
  let rows: any[] = []
  try {
    const r = await pool.query(`SELECT sku_key, product_code, qty FROM marketplace_sku_map`)
    rows = r.rows
  } catch {
    // bảng chưa tạo (chưa ai mở tab) — vẫn dùng combo khai trong code bên dưới
  }
  for (const r of rows) {
    const key = String(r.sku_key || "").trim().replace(/\s+/g, " ").toUpperCase()
    const code = String(r.product_code || "").trim().toUpperCase()
    if (!key || !code) continue
    ;(out[key] ??= []).push({ code, qty: Number(r.qty) || 1 })
  }
  // Combo khai sẵn trong code (COMBO_COMPOSITION) không nằm ở bảng khai tay và cũng
  // không hiện ở tab "Khớp SP sàn" — tab đó chỉ liệt kê SKU CHƯA tra được giá vốn, mà
  // combo này đã có. Nạp thêm ở đây, không đè lên khai tay của nhân sự.
  for (const [comboCode, parts] of Object.entries(COMBO_COMPOSITION)) {
    const key = comboCode.toUpperCase()
    if (out[key]) continue
    out[key] = parts.map(p => ({ code: p.code.toUpperCase(), qty: p.qty }))
  }
  return out
}
