import { Pool } from "pg"
import { DISPLAY_ID_ALIASES, type AvgCostResult } from "../../gia-von/avg-cost/route"

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
