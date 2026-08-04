import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { computeAvgCost, toVNDate } from "../../../gia-von/avg-cost/route"
import { computeAccountingCost } from "../accounting-cost/route"
import {
  applyHandover, computeLngMetrics, fetchLngRows, getLngPool,
  loadHandoverRules, mergeLngRows, pctOf, splitMktPlatformKey, sumMetrics,
} from "../_lng-core"

/**
 * GET /admin/pancake-sync/report/marketer-lng?from=2026-06-01&to=2026-06-16
 *
 * Báo cáo Lợi nhuận gộp (LNG) theo marketer.
 *   LNG = Doanh thu − (Giá vốn + Vận chuyển + Ads + Fullfill)
 *   - Doanh thu thực = doanh thu đơn giao thành công (status=3)
 *   - Giá vốn   = SUM(giá TB/sp từ bảng gia-von × quantity) cho đơn status=3
 *   - Vận chuyển = SUM(raw.partner_fee)
 *   - Ads       = mkt_ads_cost (Facebook) + mkt_ads_cost_gg (Google)
 *   - Fullfill  = 5000 × tổng số đơn (trừ hủy/xóa)
 *
 * Công thức nằm ở ../_lng-core dùng chung với report/platform-lng để 2 bảng
 * (theo NV MKT / theo nền tảng) luôn khớp tổng.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const {
      from: fromRaw = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
      to: toRaw = new Date().toISOString().slice(0, 10),
      market,
    } = req.query as Record<string, string>

    // Chuẩn hoá from/to về NGÀY LỊCH VN trước khi query (xem toVNDate). Frontend gửi ISO
    // UTC đã trừ 7h; nếu ép `$1::date` thẳng thì lệch sớm 1 ngày → gộp nhầm đơn hôm trước.
    const from = toVNDate(fromRaw)
    const to = toVNDate(toRaw)

    // Báo cáo này chưa hỗ trợ market ngoài VN (COGS/fullfill/marketer mapping chỉ đúng cho VN)
    if (market && market !== "VN") {
      return res.json({ not_supported: true, market, rows: [], totals: {} })
    }

    // Group theo (ngày, marketer||nền tảng) để áp handover rule per-day — nếu gom thẳng
    // theo marketer thì không có chiều ngày để test rule, dẫn tới ads/doanh số của tuần
    // bàn giao bị tính nhầm cho người gốc thay vì người nhận.
    const rows = await fetchLngRows(from, to)
    applyHandover(rows, await loadHandoverRules())
    const merged = await mergeLngRows(rows)

    // Tính metric ở grain MKT×nền tảng rồi mới cộng lên từng MKT — cùng cách với
    // report/platform-lng, nên tổng 2 bảng khớp nhau (xem sumMetrics).
    const byMkt: Record<string, ReturnType<typeof computeLngMetrics>[]> = {}
    for (const g of Object.values(merged)) {
      const { mkt } = splitMktPlatformKey(g.key)
      ;(byMkt[mkt] ??= []).push(computeLngMetrics(g))
    }

    // CP thực kế toán/NV (nếu tháng đã nhập). Rỗng → cột CP thực để trống.
    let costByNV: Record<string, number> = {}
    try { ({ costByNV } = await computeAccountingCost(from, to)) } catch { /* bảng chưa có */ }
    const hasAccounting = Object.keys(costByNV).length > 0

    const result = Object.keys(byMkt).map((mkt) => {
      const m = sumMetrics(byMkt[mkt])
      // ── CP THỰC KẾ TOÁN (thay ads API bằng tiền nạp thực đã phân bổ) ──
      // Chỉ có khi tháng đã nhập chi phí kế toán. Giữ nguyên cột ads API + lng để đối chiếu.
      const cpThuc = costByNV[mkt.toUpperCase()] ?? null
      const lngThucKt = cpThuc != null
        ? m.revenue_delivered - (m.cogs + m.ship_cost + cpThuc + m.fullfill)
        : null
      return {
        mkt_name: mkt,
        ...m,
        cp_thuc: cpThuc,
        lng_thuc_kt: lngThucKt,
        cp_thuc_pct: cpThuc != null ? pctOf(cpThuc, m.revenue_total) : null,
      }
    }).sort((a, b) => b.lng - a.lng)

    // ── Totals ─────────────────────────────────────────────────────────────────
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
      cp_thuc: hasAccounting ? sum("cp_thuc") : null,
      lng_thuc_kt: hasAccounting ? sum("lng_thuc_kt") : null,
      revenue_tam_tinh: totalRevenueTamTinh,
      cogs_tam_tinh: sum("cogs_tam_tinh"),
      ship_tam_tinh: sum("ship_tam_tinh"),
      fullfill_tam_tinh: sum("fullfill_tam_tinh"),
      lng_tam_tinh: sum("lng_tam_tinh"),
      // dự kiến hoàn hủy tổng = (1 − dt_tạm_tính/doanh_số_toàn_bộ)
      du_kien_hoan_huy: sum("revenue_total") > 0
        ? Math.round((1 - totalRevenueTamTinh / sum("revenue_total")) * 10000) / 100
        : 0,
    }
    const totalItemQty = sum("item_qty")
    const totalMappedQty = sum("mapped_qty")
    const avgCost = await computeAvgCost(getLngPool())

    return res.json({
      rows: result,
      totals,
      mapped_pct: totalItemQty > 0 ? Math.round(totalMappedQty / totalItemQty * 100) : 0,
      cost_mapped: avgCost.mapped,
      cost_total: avgCost.total,
      has_accounting: hasAccounting,
      from, to,
    })
  } catch (err: any) {
    console.error("[report/marketer-lng]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
