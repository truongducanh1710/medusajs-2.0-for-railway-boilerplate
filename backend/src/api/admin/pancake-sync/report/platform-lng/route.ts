import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { toVNDate } from "../../../gia-von/avg-cost/route"
import { computeAccountingCost } from "../accounting-cost/route"
import {
  applyHandover, computeLngMetrics, fetchLngRows, loadHandoverRules,
  mergeLngRows, pctOf, splitMktPlatformKey, sumMetrics,
} from "../_lng-core"

/**
 * GET /admin/pancake-sync/report/platform-lng?from=2026-08-01&to=2026-08-31&market=VN
 *
 * Lợi nhuận gộp (LNG) theo NỀN TẢNG chạy ads (facebook / google).
 *
 * Dùng CHUNG lõi tính với report/marketer-lng (../_lng-core): cùng bộ lọc đơn, cùng
 * công thức, và quan trọng nhất — cùng GRAIN. Cả 2 báo cáo tính metric ở mức
 * (MKT × nền tảng) rồi mới cộng số tiền lên chiều hiển thị của mình, nên tổng LNG
 * thực và LNG tạm tính của 2 bảng luôn bằng nhau.
 *
 * (Không thể gom thẳng theo nền tảng rồi tính 1 lần: tạm tính dùng tỷ lệ nhận và
 * %vốn/%ship RIÊNG của từng nhóm nên không cộng dồn được — gom 2 nhóm rồi tính sẽ
 * lệch vài % so với tính riêng rồi cộng. Xem sumMetrics trong _lng-core.)
 *
 * Phân bổ chi phí ads: mkt_ads_cost → facebook, mkt_ads_cost_gg → google.
 * Đơn phân loại theo PLATFORM_EXPR (marker gclid/gad_campaignid… → google, còn lại
 * kể cả không xác định → facebook), giống tab "Theo nền tảng" ở trang bao-cao-mkt.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const {
      from: fromRaw = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
      to: toRaw = new Date().toISOString().slice(0, 10),
      market,
    } = req.query as Record<string, string>

    const from = toVNDate(fromRaw)
    const to = toVNDate(toRaw)

    // Giống marketer-lng: COGS/fullfill chỉ đúng cho VN
    if (market && market !== "VN") {
      return res.json({ not_supported: true, market, rows: [], totals: {} })
    }

    // Cùng grain + cùng handover với marketer-lng, chỉ khác chiều roll-up cuối.
    const rows = await fetchLngRows(from, to)
    applyHandover(rows, await loadHandoverRules())
    const merged = await mergeLngRows(rows)

    const byPlatform: Record<string, ReturnType<typeof computeLngMetrics>[]> = {}
    for (const g of Object.values(merged)) {
      const { platform } = splitMktPlatformKey(g.key)
      ;(byPlatform[platform] ??= []).push(computeLngMetrics(g))
    }

    // CP thực kế toán quy về nền tảng: tiền nạp tài khoản FB → facebook,
    // tiền nạp Google Ads → google. Chi phí chung (NL/ITY/ZALO...) không thuộc nền
    // tảng nào nên trả riêng ở cost_chung, KHÔNG cộng vào dòng nào.
    let costByPlatform: Record<string, number> = {}
    try { ({ costByPlatform } = await computeAccountingCost(from, to)) } catch { /* bảng chưa có */ }
    const hasAccounting = (costByPlatform.facebook ?? 0) + (costByPlatform.google ?? 0) + (costByPlatform.chung ?? 0) > 0

    const LABELS: Record<string, string> = { facebook: "Facebook Ads", google: "Google Ads" }
    const ORDER = ["facebook", "google"]

    const result = ORDER
      .filter(p => byPlatform[p])
      .map(p => {
        const m = sumMetrics(byPlatform[p])
        const cpThuc = hasAccounting ? (costByPlatform[p] ?? 0) : null
        return {
          platform: p,
          platform_label: LABELS[p] ?? p,
          ...m,
          cp_thuc: cpThuc,
          cp_thuc_pct: cpThuc != null ? pctOf(cpThuc, m.revenue_total) : null,
          lng_thuc_kt: cpThuc != null
            ? m.revenue_delivered - (m.cogs + m.ship_cost + cpThuc + m.fullfill)
            : null,
        }
      })

    const sum = (k: string) => result.reduce((s, r: any) => s + (r[k] ?? 0), 0)
    const totalRevenueTamTinh = sum("revenue_tam_tinh")
    const totals = {
      total_orders: sum("total_orders"),
      revenue_total: sum("revenue_total"),
      revenue_delivered: sum("revenue_delivered"),
      cogs: sum("cogs"),
      ship_cost: sum("ship_cost"),
      ads_cost: sum("ads_cost"),
      ads_cost_fb: sum("ads_cost_fb"),
      ads_cost_gg: sum("ads_cost_gg"),
      fullfill: sum("fullfill"),
      lng: sum("lng"),
      lng_thuc: sum("lng"),
      revenue_tam_tinh: totalRevenueTamTinh,
      cogs_tam_tinh: sum("cogs_tam_tinh"),
      ship_tam_tinh: sum("ship_tam_tinh"),
      fullfill_tam_tinh: sum("fullfill_tam_tinh"),
      lng_tam_tinh: sum("lng_tam_tinh"),
      du_kien_hoan_huy: sum("revenue_total") > 0
        ? Math.round((1 - totalRevenueTamTinh / sum("revenue_total")) * 10000) / 100
        : 0,
      // CP thực (KT) của 2 nền tảng — CHƯA gồm chi phí chung (xem cost_chung).
      cp_thuc: hasAccounting ? sum("cp_thuc") : null,
      lng_thuc_kt: hasAccounting ? sum("lng_thuc_kt") : null,
    }

    return res.json({
      rows: result,
      totals,
      has_accounting: hasAccounting,
      // Chi phí chung không quy được về nền tảng (NL/ITY/ZALO/thuê...) — hiển thị
      // riêng để người xem biết vì sao tổng CP thực ở bảng này nhỏ hơn bảng theo NV.
      cost_chung: hasAccounting ? (costByPlatform.chung ?? 0) : null,
      from, to,
    })
  } catch (err: any) {
    console.error("[report/platform-lng]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
