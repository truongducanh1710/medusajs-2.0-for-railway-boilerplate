import { NextRequest, NextResponse } from "next/server"
import { Pool } from "pg"

export const dynamic = "force-dynamic"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

// Nhóm gọn 3 trạng thái cho agency dễ theo dõi — khớp STATUS_VI trong backend service.ts
// (0 chờ xử lý, 1 sale đã chốt, 2 đang giao, 3 giao thành công, 4 đang hoàn về,
//  5 đã hoàn về kho, 6 đã hủy, 7 đã xóa, 9 chờ chuyển hàng, 11 chờ hàng, -1 đã hủy, -2 hoàn hàng)
const CONFIRMED_STATUSES = new Set([1, 2, 3, 9])
const CANCELLED_STATUSES = new Set([-1, -2, 4, 5, 6, 7])

// Đơn đã được sale xác nhận trở đi. Dùng để quyết định đơn mang tag "Đơn nháp" có được
// tính vào ĐƠN THỰC hay không: tag nháp KHÔNG được gỡ khi sale xác nhận đơn, nên nếu
// loại hết theo tag thì mất cả đơn đã giao thành công (đã kiểm: 174 đơn "nháp" ở trạng
// thái đã nhận trong 30 ngày). Trạng thái mới là bằng chứng đơn có thật, không phải tag.
const ACTIVATED_STATUSES = new Set([1, 2, 3, 8, 9, 11])

function simpleStatus(status: number): { label: string; cls: string } {
  if (CONFIRMED_STATUSES.has(status)) return { label: "Đã xác nhận", cls: "confirmed" }
  if (CANCELLED_STATUSES.has(status)) return { label: "Đã hủy", cls: "cancelled" }
  return { label: "Đang xử lý", cls: "pending" }
}

function hasTag(tags: any, name: string): boolean {
  if (!Array.isArray(tags)) return false
  return tags.some((t: any) => String(t?.name ?? "").trim() === name)
}

function maskPhone(phone: string): string {
  const digits = (phone || "").replace(/\D/g, "")
  if (digits.length < 6) return phone || ""
  return `${digits.slice(0, 3)}***${digits.slice(-3)}`
}

function maskName(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ""
  return parts.map((p, i) => (i === parts.length - 1 ? p : p[0] + "**")).join(" ")
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function extractCampaignId(link: string): string {
  const m = String(link || "").match(/gad_campaignid=(\d+)/)
  return m ? m[1] : ""
}

const money = (n: number) => Math.round(n).toLocaleString("vi-VN") + "đ"
const shortMoney = (n: number) => {
  const v = Math.round(n)
  if (Math.abs(v) >= 1_000_000_000) return (v / 1_000_000_000).toFixed(2) + "B đ"
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(2) + "M đ"
  if (Math.abs(v) >= 1_000) return (v / 1_000).toFixed(1) + "K đ"
  return v.toLocaleString("vi-VN") + "đ"
}

/** Ngày hôm nay theo giờ VN, dạng YYYY-MM-DD. */
function todayVN(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
}
function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
function diffDays(from: string, to: string): number {
  return Math.round(
    (new Date(to + "T00:00:00Z").getTime() - new Date(from + "T00:00:00Z").getTime()) / 86400_000,
  ) + 1
}

/**
 * Nhận diện đơn đến từ Google Ads.
 * Giữ đồng bộ với detectAdPlatform() trong backend modules/pancake-sync/service.ts và
 * PLATFORM_EXPR trong api/admin/pancake-sync/report/mkt-platform — sửa 1 chỗ phải sửa cả 3.
 */
const GOOGLE_WHERE = `(
  ad_platform = 'google'
  OR (
    ad_platform IS DISTINCT FROM 'facebook'
    AND (
      raw::text ILIKE '%"ads_source":"Google"%'
      OR raw::text ILIKE '%gclid=%'
      OR raw::text ILIKE '%gbraid=%'
      OR raw::text ILIKE '%wbraid=%'
      OR raw::text ILIKE '%gad_source=%'
      OR raw::text ILIKE '%gad_campaignid=%'
      OR COALESCE(raw->>'p_utm_source', '') ILIKE '%google%'
    )
  )
)`

type Totals = {
  raw_orders: number
  dup: number
  draft_inactive: number
  draft_activated: number
  real_orders: number
  confirmed: number
  pending: number
  cancelled: number
  delivered: number
  cod: number
  cod_delivered: number
  ads_cost: number
}

const emptyTotals = (): Totals => ({
  raw_orders: 0, dup: 0, draft_inactive: 0, draft_activated: 0, real_orders: 0,
  confirmed: 0, pending: 0, cancelled: 0, delivered: 0,
  cod: 0, cod_delivered: 0, ads_cost: 0,
})

/**
 * Quy tắc ĐƠN THỰC (chốt với sếp 11/09/2026):
 *   Tổng đơn − đơn trùng − đơn nháp CHƯA từng được xác nhận = đơn thực.
 * Đơn nháp đã xác nhận (status 1,2,3,8,9,11) VẪN TÍNH, vì tag nháp không được gỡ khi
 * sale chốt đơn. Đơn trùng thì loại trong mọi trường hợp.
 */
function summarize(orders: any[]): Totals {
  const t = emptyTotals()
  for (const o of orders) {
    t.raw_orders++
    if (o.is_dup) { t.dup++; continue }
    if (o.is_draft && !o.is_activated) { t.draft_inactive++; continue }
    if (o.is_draft) t.draft_activated++

    t.real_orders++
    if (o.cls === "confirmed") t.confirmed++
    else if (o.cls === "cancelled") t.cancelled++
    else t.pending++

    // COD: khớp công thức bao-cao-mkt — GREATEST(cod_amount, total), bỏ status -2 và 7.
    if (o.status !== -2 && o.status !== 7) t.cod += o.cod
    if (o.status === 3) { t.delivered++; t.cod_delivered += o.cod }
  }
  return t
}


/**
 * GET /api/google-orders
 * Public — bảng đơn hàng nguồn Google Ads cho agency xem, không cần login.
 *
 * ?from=YYYY-MM-DD&to=YYYY-MM-DD  khoảng ngày, cắt theo GIỜ VIỆT NAM (mặc định 30 ngày).
 * ?format=json                    trả JSON thay vì HTML.
 * ?days=N                         giữ tương thích link cũ.
 *
 * Bảng chi tiết hiện ĐỦ mọi đơn (kể cả nháp/trùng, có gắn thẻ đánh dấu) để agency thấy
 * được toàn bộ đơn quảng cáo mang về; phần tổng hợp mới trừ ra để lấy ĐƠN THỰC.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const format = searchParams.get("format")

    const today = todayVN()
    let to = searchParams.get("to") || today
    let from = searchParams.get("from") || ""
    if (!from) {
      const days = Math.min(Math.max(Number(searchParams.get("days")) || 30, 1), 90)
      from = addDaysISO(to, -(days - 1))
    }
    // Chặn khoảng ngày vô lý (người dùng gõ tay trên URL).
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) from = addDaysISO(today, -29)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) to = today
    if (from > to) [from, to] = [to, from]
    const span = diffDays(from, to)
    // Kỳ liền trước cùng độ dài, để so sánh ↑↓.
    const prevTo = addDaysISO(from, -1)
    const prevFrom = addDaysISO(prevTo, -(span - 1))

    const pool = getPool()

    // Lấy luôn cả kỳ trước trong 1 query, tách bằng cột `ky`.
    const { rows } = await pool.query(
      `SELECT id, status, customer_name, customer_phone, province,
              total, cod_amount, items, items_count, tracking_code, pancake_created_at,
              COALESCE(tags, '[]'::jsonb) AS tags,
              COALESCE(raw->>'link', raw->>'order_link', '') AS order_link,
              CASE WHEN pancake_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
                   THEN 'nay' ELSE 'truoc' END AS ky
       FROM pancake_order
       WHERE deleted_at IS NULL
         AND pancake_created_at >= ($3::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
         AND pancake_created_at < (($2::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
         AND ${GOOGLE_WHERE}
       ORDER BY pancake_created_at DESC`,
      [from, to, prevFrom],
    )

    // Chi phí Google theo ngày — mkt_ads_cost_gg chỉ có cost thật (impressions/clicks
    // hiện chưa được sheet điền), nên chỉ dùng cost.
    const { rows: costRows } = await pool.query(
      `SELECT to_char(date, 'YYYY-MM-DD') AS date, SUM(cost)::bigint AS cost
       FROM mkt_ads_cost_gg
       WHERE deleted_at IS NULL AND date >= $1::date AND date <= $2::date
       GROUP BY 1`,
      [prevFrom, to],
    )
    const costByDate = new Map<string, number>()
    for (const c of costRows) costByDate.set(c.date, Number(c.cost) || 0)
    const sumCost = (a: string, b: string) => {
      let s = 0
      costByDate.forEach((v, d) => { if (d >= a && d <= b) s += v })
      return s
    }

    const mapOrder = (o: any) => {
      const status = Number(o.status)
      const isDraft = hasTag(o.tags, "Đơn nháp")
      const isActivated = ACTIVATED_STATUSES.has(status)
      return {
        id: o.id,
        status,
        ...simpleStatus(status),
        is_draft: isDraft,
        is_dup: hasTag(o.tags, "Đơn trùng"),
        is_activated: isActivated,
        // Đơn nháp đã xác nhận: vẫn tính, nhưng đánh dấu riêng để nhìn ra ngay.
        draft_kept: isDraft && isActivated,
        customer_name: maskName(o.customer_name),
        customer_phone: maskPhone(o.customer_phone),
        province: o.province,
        total: Number(o.total) || 0,
        cod: Math.max(Number(o.cod_amount) || 0, Number(o.total) || 0),
        items_count: Number(o.items_count) || 0,
        product_names: Array.isArray(o.items)
          ? o.items.map((it: any) => it?.name).filter(Boolean).join(", ")
          : "",
        tracking_code: o.tracking_code,
        campaign_id: extractCampaignId(o.order_link),
        created_at: o.pancake_created_at,
        ky: o.ky as "nay" | "truoc",
      }
    }

    const all = rows.map(mapOrder)
    const orders = all.filter(o => o.ky === "nay")
    const prevOrders = all.filter(o => o.ky === "truoc")

    const totals = summarize(orders)
    totals.ads_cost = sumCost(from, to)
    const prevTotals = summarize(prevOrders)
    prevTotals.ads_cost = sumCost(prevFrom, prevTo)

    const pctCp = (t: Totals) => (t.cod > 0 ? (t.ads_cost / t.cod) * 100 : 0)
    const cpo = (t: Totals) => (t.real_orders > 0 ? t.ads_cost / t.real_orders : 0)
    const cpoDelivered = (t: Totals) => (t.delivered > 0 ? t.ads_cost / t.delivered : 0)
    const closeRate = (t: Totals) => (t.real_orders > 0 ? (t.confirmed / t.real_orders) * 100 : 0)

    // ---- Chuỗi theo ngày cho biểu đồ ----
    const byDate = new Map<string, { cod: number; orders: number; cost: number }>()
    for (let d = from; d <= to; d = addDaysISO(d, 1)) {
      byDate.set(d, { cod: 0, orders: 0, cost: costByDate.get(d) ?? 0 })
    }
    for (const o of orders) {
      if (o.is_dup || (o.is_draft && !o.is_activated)) continue
      const d = new Date(new Date(o.created_at).getTime() + 7 * 3600_000).toISOString().slice(0, 10)
      const cell = byDate.get(d)
      if (!cell) continue
      cell.orders++
      if (o.status !== -2 && o.status !== 7) cell.cod += o.cod
    }
    const series = Array.from(byDate.entries()).map(([date, v]) => ({ date, ...v }))

    // ---- Tổng hợp theo Campaign (chỉ tính đơn thực) ----
    const byCampaign = new Map<string, { total: number; confirmed: number; cancelled: number; pending: number; revenue: number }>()
    for (const o of orders) {
      if (o.is_dup || (o.is_draft && !o.is_activated)) continue
      const key = o.campaign_id || "(không xác định)"
      const agg = byCampaign.get(key) ?? { total: 0, confirmed: 0, cancelled: 0, pending: 0, revenue: 0 }
      agg.total += 1
      if (o.cls === "confirmed") { agg.confirmed += 1; agg.revenue += o.total }
      else if (o.cls === "cancelled") agg.cancelled += 1
      else agg.pending += 1
      byCampaign.set(key, agg)
    }
    const campaignSummary = Array.from(byCampaign.entries())
      .map(([campaign_id, agg]) => ({
        campaign_id,
        ...agg,
        confirm_rate: agg.total > 0 ? (agg.confirmed / agg.total) * 100 : 0,
      }))
      .sort((a, b) => b.total - a.total)

    if (format === "json") {
      return NextResponse.json({
        from, to, days: span,
        totals: { ...totals, pct_cp: pctCp(totals), cpo: cpo(totals), close_rate: closeRate(totals) },
        prev: { from: prevFrom, to: prevTo, ...prevTotals },
        series, campaignSummary,
        orders: orders.map(({ ky, ...o }) => o),
        count: orders.length,
      })
    }


    // ---- Thẻ số liệu, kèm so sánh kỳ trước ----
    const delta = (now: number, before: number) => {
      if (!before) return null
      return ((now - before) / Math.abs(before)) * 100
    }
    const deltaHtml = (d: number | null, goodUp = true) => {
      if (d === null || !isFinite(d)) return `<span class="d flat">— kỳ trước không có dữ liệu</span>`
      const up = d >= 0
      const good = goodUp ? up : !up
      return `<span class="d ${good ? "good" : "bad"}">${up ? "▲" : "▼"} ${Math.abs(d).toFixed(1)}%</span>`
    }
    const card = (label: string, value: string, d: string, note = "") =>
      `<div class="card"><div class="cl">${escapeHtml(label)}</div><div class="cv">${value}</div>${d}${note ? `<div class="cn">${note}</div>` : ""}</div>`

    const cardsOrders = [
      card("Đơn thực", String(totals.real_orders),
        deltaHtml(delta(totals.real_orders, prevTotals.real_orders)),
        `trên tổng ${totals.raw_orders} đơn nhận về`),
      card("Đã xác nhận", String(totals.confirmed),
        deltaHtml(delta(totals.confirmed, prevTotals.confirmed))),
      card("Đang xử lý", String(totals.pending),
        deltaHtml(delta(totals.pending, prevTotals.pending), false)),
      card("Đã hủy", String(totals.cancelled),
        deltaHtml(delta(totals.cancelled, prevTotals.cancelled), false)),
      card("Tỷ lệ chốt", closeRate(totals).toFixed(1) + "%",
        deltaHtml(delta(closeRate(totals), closeRate(prevTotals)))),
    ].join("")

    const cardsMoney = [
      card("Tổng COD", shortMoney(totals.cod),
        deltaHtml(delta(totals.cod, prevTotals.cod)), money(totals.cod)),
      card("Chi phí Google", shortMoney(totals.ads_cost),
        deltaHtml(delta(totals.ads_cost, prevTotals.ads_cost), false), money(totals.ads_cost)),
      card("%CP", pctCp(totals).toFixed(2) + "%",
        deltaHtml(delta(pctCp(totals), pctCp(prevTotals)), false), "chi phí ÷ COD"),
      card("CPO", shortMoney(cpo(totals)),
        deltaHtml(delta(cpo(totals), cpo(prevTotals)), false), "chi phí ÷ đơn thực"),
      card("Chi phí / đơn đã nhận", shortMoney(cpoDelivered(totals)),
        deltaHtml(delta(cpoDelivered(totals), cpoDelivered(prevTotals)), false),
        `${totals.delivered} đơn đã nhận`),
    ].join("")

    // ---- Khối phép trừ ra ĐƠN THỰC ----
    const reconHtml = `
      <div class="recon">
        <div class="rrow"><span>Tổng đơn nhận về</span><b>${totals.raw_orders}</b></div>
        <div class="rrow minus"><span>− Đơn trùng</span><b>${totals.dup}</b></div>
        <div class="rrow minus"><span>− Đơn nháp chưa xác nhận</span><b>${totals.draft_inactive}</b></div>
        <div class="rrow total"><span>Đơn thực</span><b>${totals.real_orders}</b></div>
        ${totals.draft_activated > 0 ? `<div class="rnote">Trong đó <b>${totals.draft_activated}</b> đơn còn thẻ <span class="tag draft">Nháp</span> nhưng <b>đã được xác nhận</b> nên vẫn được tính.</div>` : ""}
      </div>`

    // ---- Biểu đồ đường: COD và Chi phí theo ngày ----
    const chartW = 100, chartH = 34
    const maxCod = Math.max(...series.map(s => s.cod), 1)
    const maxCost = Math.max(...series.map(s => s.cost), 1)
    const path = (vals: number[], max: number) => {
      if (vals.length === 0) return ""
      if (vals.length === 1) return `M0,${chartH - (vals[0] / max) * chartH} L${chartW},${chartH - (vals[0] / max) * chartH}`
      return vals.map((v, i) => {
        const x = (i / (vals.length - 1)) * chartW
        const y = chartH - (v / max) * chartH
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`
      }).join(" ")
    }
    const chartHtml = series.length < 2 ? "" : `
      <div class="charts">
        <div class="chart">
          <div class="ct">COD theo ngày <span>cao nhất ${shortMoney(maxCod)}</span></div>
          <svg viewBox="0 0 ${chartW} ${chartH}" preserveAspectRatio="none">
            <path d="${path(series.map(s => s.cod), maxCod)}" class="ln cod"/>
          </svg>
          <div class="cx"><span>${from.slice(5)}</span><span>${to.slice(5)}</span></div>
        </div>
        <div class="chart">
          <div class="ct">Chi phí Google theo ngày <span>cao nhất ${shortMoney(maxCost)}</span></div>
          <svg viewBox="0 0 ${chartW} ${chartH}" preserveAspectRatio="none">
            <path d="${path(series.map(s => s.cost), maxCost)}" class="ln cost"/>
          </svg>
          <div class="cx"><span>${from.slice(5)}</span><span>${to.slice(5)}</span></div>
        </div>
      </div>`

    const SUMMARY_VISIBLE = 10
    const summaryRowHtml = (c: (typeof campaignSummary)[number]) => `<tr>
        <td>${escapeHtml(c.campaign_id)}</td>
        <td data-v="${c.total}">${c.total}</td>
        <td data-v="${c.confirmed}">${c.confirmed}</td>
        <td data-v="${c.cancelled}">${c.cancelled}</td>
        <td data-v="${c.pending}">${c.pending}</td>
        <td data-v="${c.confirm_rate}">${c.confirm_rate.toFixed(1)}%</td>
        <td data-v="${c.revenue}">${c.revenue.toLocaleString("vi-VN")}đ</td>
      </tr>`

    const summaryRowsHtml = campaignSummary.slice(0, SUMMARY_VISIBLE).map(summaryRowHtml).join("\n")
    const summaryRestHtml = campaignSummary.slice(SUMMARY_VISIBLE).map(summaryRowHtml).join("\n")
    const summaryRestCount = campaignSummary.length - SUMMARY_VISIBLE

    // Bảng chi tiết hiện ĐỦ mọi đơn — thẻ Nháp/Trùng cho biết đơn nào bị trừ ở phần tổng.
    const rowsHtml = orders
      .map((o) => {
        const excluded = o.is_dup || (o.is_draft && !o.is_activated)
        const tags = [
          o.is_dup ? `<span class="tag dup">Trùng</span>` : "",
          o.is_draft ? `<span class="tag draft${o.draft_kept ? " kept" : ""}">Nháp${o.draft_kept ? " ✓" : ""}</span>` : "",
        ].filter(Boolean).join(" ")
        return `<tr class="${excluded ? "excluded" : ""}">
        <td>${escapeHtml(o.id)}</td>
        <td>${o.created_at ? new Date(o.created_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : ""}</td>
        <td>${escapeHtml(o.customer_name)}</td>
        <td>${escapeHtml(o.customer_phone)}</td>
        <td>${escapeHtml(o.province)}</td>
        <td>${escapeHtml(o.product_names)}</td>
        <td>${o.items_count}</td>
        <td>${o.total.toLocaleString("vi-VN")}đ</td>
        <td>${escapeHtml(o.tracking_code)}</td>
        <td>${escapeHtml(o.campaign_id)}</td>
        <td><span class="badge status-${o.cls}">${escapeHtml(o.label)}</span>${tags ? " " + tags : ""}</td>
      </tr>`
      })
      .join("\n")

    const quick = (label: string, f: string, t: string) =>
      `<a class="qb ${from === f && to === t ? "on" : ""}" href="?from=${f}&to=${t}">${label}</a>`
    const quickHtml = [
      quick("Hôm nay", today, today),
      quick("Hôm qua", addDaysISO(today, -1), addDaysISO(today, -1)),
      quick("7 ngày", addDaysISO(today, -6), today),
      quick("30 ngày", addDaysISO(today, -29), today),
      quick("Tháng này", today.slice(0, 8) + "01", today),
    ].join("")


    const html = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Đơn hàng Google Ads — Phan Việt</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 24px; background: #f7f7f8; color: #1a1a1a; }
  @media (prefers-color-scheme: dark) { body { background: #16161a; color: #e6e6e6; } }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 26px 0 10px; }
  .sub { color: #666; font-size: 13px; margin-bottom: 16px; }
  @media (prefers-color-scheme: dark) { .sub { color: #999; } }

  /* ---- Bộ lọc ---- */
  .filter { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; padding: 14px 16px;
            background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.08); margin-bottom: 18px; }
  @media (prefers-color-scheme: dark) { .filter { background: #222; } }
  .filter label { display: block; font-size: 11px; color: #888; margin-bottom: 3px; }
  .filter input[type=date] { padding: 6px 8px; border: 1px solid #ddd; border-radius: 6px; font-size: 13px;
                             background: white; color: inherit; }
  @media (prefers-color-scheme: dark) { .filter input[type=date] { background: #2a2a2e; border-color: #444; } }
  .filter button { padding: 7px 16px; border-radius: 6px; border: 0; background: #1a73e8; color: white;
                   font-size: 13px; font-weight: 600; cursor: pointer; }
  .qb { padding: 6px 12px; border-radius: 6px; border: 1px solid #ddd; font-size: 12.5px;
        text-decoration: none; color: inherit; background: white; }
  .qb.on { background: #e8f0fe; border-color: #1a73e8; color: #1a73e8; font-weight: 600; }
  @media (prefers-color-scheme: dark) {
    .qb { background: #2a2a2e; border-color: #444; }
    .qb.on { background: #17324f; border-color: #6db3ff; color: #6db3ff; }
  }

  /* ---- Thẻ số liệu ---- */
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(168px, 1fr)); gap: 10px; margin-bottom: 10px; }
  .card { background: white; border-radius: 8px; padding: 12px 14px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  @media (prefers-color-scheme: dark) { .card { background: #222; } }
  .cl { font-size: 11.5px; color: #888; margin-bottom: 4px; }
  .cv { font-size: 22px; font-weight: 600; letter-spacing: -.3px; }
  .cn { font-size: 11px; color: #999; margin-top: 3px; }
  .d { font-size: 11.5px; display: inline-block; margin-top: 3px; }
  .d.good { color: #1e8e3e; } .d.bad { color: #d93025; } .d.flat { color: #999; }
  @media (prefers-color-scheme: dark) { .d.good { color: #7ee39a; } .d.bad { color: #f5a3ab; } }

  /* ---- Khối phép trừ ---- */
  .recon { background: white; border-radius: 8px; padding: 14px 16px; box-shadow: 0 1px 3px rgba(0,0,0,.08);
           max-width: 380px; font-size: 13.5px; }
  @media (prefers-color-scheme: dark) { .recon { background: #222; } }
  .rrow { display: flex; justify-content: space-between; padding: 5px 0; }
  .rrow.minus { color: #d93025; }
  @media (prefers-color-scheme: dark) { .rrow.minus { color: #f5a3ab; } }
  .rrow.total { border-top: 2px solid #e5e5e5; margin-top: 5px; padding-top: 8px; font-weight: 700; font-size: 15px; }
  @media (prefers-color-scheme: dark) { .rrow.total { border-top-color: #3a3a3a; } }
  .rnote { margin-top: 9px; padding-top: 9px; border-top: 1px solid #eee; font-size: 11.5px; color: #777; line-height: 1.5; }
  @media (prefers-color-scheme: dark) { .rnote { border-top-color: #333; color: #999; } }

  /* ---- Biểu đồ ---- */
  .charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px; margin-top: 10px; }
  .chart { background: white; border-radius: 8px; padding: 12px 14px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  @media (prefers-color-scheme: dark) { .chart { background: #222; } }
  .ct { font-size: 11.5px; color: #888; margin-bottom: 6px; }
  .ct span { float: right; color: #aaa; }
  .chart svg { width: 100%; height: 54px; display: block; }
  .ln { fill: none; stroke-width: 1.4; vector-effect: non-scaling-stroke; }
  .ln.cod { stroke: #1e8e3e; } .ln.cost { stroke: #e8710a; }
  .cx { display: flex; justify-content: space-between; font-size: 10.5px; color: #aaa; margin-top: 3px; }

  /* ---- Bảng ---- */
  table { border-collapse: collapse; width: 100%; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.08); font-size: 13px; }
  @media (prefers-color-scheme: dark) { table { background: #222; } }
  th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid #eee; white-space: nowrap; }
  @media (prefers-color-scheme: dark) { th, td { border-bottom: 1px solid #333; } }
  th { background: #fafafa; font-weight: 600; position: sticky; top: 0; }
  @media (prefers-color-scheme: dark) { th { background: #1c1c20; } }
  tr.excluded { opacity: .5; }
  tr.excluded td:first-child { border-left: 3px solid #d93025; }
  .badge { padding: 2px 8px; border-radius: 12px; font-size: 12px; white-space: nowrap; }
  .status-confirmed { background: #d1f7d6; color: #146c2e; }
  .status-cancelled { background: #f8d7da; color: #842029; }
  .status-pending { background: #e2e3e5; color: #41464b; }
  .tag { padding: 1px 7px; border-radius: 10px; font-size: 11px; font-weight: 600; }
  .tag.dup { background: #fde2e4; color: #9b2226; }
  .tag.draft { background: #e8e8ea; color: #555; }
  .tag.draft.kept { background: #d1f7d6; color: #146c2e; }
  @media (prefers-color-scheme: dark) {
    .status-confirmed { background: #123d20; color: #7ee39a; }
    .status-cancelled { background: #3d1518; color: #f5a3ab; }
    .status-pending { background: #2a2a2e; color: #c0c0c5; }
    .tag.dup { background: #3d1518; color: #f5a3ab; }
    .tag.draft { background: #2f2f34; color: #bbb; }
    .tag.draft.kept { background: #123d20; color: #7ee39a; }
  }
  .wrap { overflow-x: auto; }
  #campaign-table th[data-sort] { cursor: pointer; user-select: none; }
  #campaign-table th[data-sort]:hover { color: #0066cc; }
  @media (prefers-color-scheme: dark) { #campaign-table th[data-sort]:hover { color: #6db3ff; } }
  th.sort-asc::after { content: " ▲"; font-size: 10px; }
  th.sort-desc::after { content: " ▼"; font-size: 10px; }
  .toggle-btn { margin-top: 8px; padding: 6px 14px; font-size: 13px; border-radius: 6px;
                border: 1px solid #ccc; background: white; cursor: pointer; }
  @media (prefers-color-scheme: dark) { .toggle-btn { background: #222; border-color: #444; color: #e6e6e6; } }
  .legend { font-size: 12px; color: #777; margin: 8px 0 0; line-height: 1.7; }
  @media (prefers-color-scheme: dark) { .legend { color: #999; } }
</style>
</head>
<body>
  <h1>Đơn hàng nguồn Google Ads</h1>
  <div class="sub">${from.split("-").reverse().join("/")} → ${to.split("-").reverse().join("/")} · ${span} ngày · giờ Việt Nam · SĐT/tên đã ẩn 1 phần</div>

  <form class="filter" method="get">
    <div><label>Từ ngày</label><input type="date" name="from" value="${from}" max="${today}"></div>
    <div><label>Đến ngày</label><input type="date" name="to" value="${to}" max="${today}"></div>
    <button type="submit">Xem</button>
    <div style="display:flex;gap:6px;margin-left:auto;align-items:center">${quickHtml}</div>
  </form>

  <h2>Đơn hàng</h2>
  <div class="cards">${cardsOrders}</div>

  <h2>Doanh thu &amp; Chi phí Google</h2>
  <div class="cards">${cardsMoney}</div>
  ${chartHtml}

  <h2>Cách ra con số "Đơn thực"</h2>
  ${reconHtml}

  <h2>Tổng hợp theo Campaign <span style="font-weight:400;font-size:12px;color:#888">· chỉ tính đơn thực</span></h2>
  <div class="wrap">
  <table id="campaign-table">
    <thead><tr>
      <th data-sort="text">Mã Campaign GG</th><th data-sort="num">Tổng đơn</th><th data-sort="num">Đã xác nhận</th><th data-sort="num">Đã hủy</th><th data-sort="num">Đang xử lý</th><th data-sort="num">Tỷ lệ chốt</th><th data-sort="num">Doanh thu (đơn xác nhận)</th>
    </tr></thead>
    <tbody id="campaign-tbody-main">${summaryRowsHtml}</tbody>
    ${summaryRestCount > 0 ? `<tbody id="campaign-tbody-rest" hidden>${summaryRestHtml}</tbody>` : ""}
  </table>
  </div>
  ${summaryRestCount > 0 ? `<button id="campaign-toggle" class="toggle-btn" type="button">Xem thêm ${summaryRestCount} campaign</button>` : ""}

  <h2>Chi tiết đơn hàng <span style="font-weight:400;font-size:12px;color:#888">· ${orders.length} đơn, hiện đủ kể cả đơn bị trừ</span></h2>
  <div class="wrap">
  <table>
    <thead><tr>
      <th>Mã đơn</th><th>Ngày tạo</th><th>Khách hàng</th><th>SĐT</th><th>Tỉnh/TP</th><th>Sản phẩm</th><th>SL SP</th><th>Tổng tiền</th><th>Mã vận đơn</th><th>Mã Campaign GG</th><th>Trạng thái</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  </div>
  <p class="legend">
    <span class="tag dup">Trùng</span> đơn trùng — luôn bị trừ &nbsp;·&nbsp;
    <span class="tag draft">Nháp</span> đơn nháp chưa xác nhận — bị trừ &nbsp;·&nbsp;
    <span class="tag draft kept">Nháp ✓</span> đơn nháp đã được xác nhận — <b>vẫn tính</b><br>
    Dòng mờ có vạch đỏ là đơn không được tính vào "Đơn thực".
  </p>
</body>
</html>`


    // Script sắp xếp bảng campaign — chèn trước </body> để giữ nguyên hành vi cũ.
    const scriptHtml = `
<script>
(function () {
  var VISIBLE = ${SUMMARY_VISIBLE};
  var table = document.getElementById("campaign-table");
  if (!table) return;
  var mainBody = document.getElementById("campaign-tbody-main");
  var restBody = document.getElementById("campaign-tbody-rest");
  var toggleBtn = document.getElementById("campaign-toggle");
  var expanded = false;
  var sortState = { col: -1, dir: 1 };

  function allRows() {
    var rows = Array.prototype.slice.call(mainBody.rows);
    if (restBody) rows = rows.concat(Array.prototype.slice.call(restBody.rows));
    return rows;
  }
  function render(rows) {
    mainBody.innerHTML = "";
    rows.slice(0, VISIBLE).forEach(function (r) { mainBody.appendChild(r); });
    if (restBody) {
      restBody.innerHTML = "";
      rows.slice(VISIBLE).forEach(function (r) { restBody.appendChild(r); });
    }
  }
  if (toggleBtn && restBody) {
    toggleBtn.addEventListener("click", function () {
      expanded = !expanded;
      restBody.hidden = !expanded;
      toggleBtn.textContent = expanded ? "Thu gọn" : "Xem thêm " + restBody.rows.length + " campaign";
    });
  }
  var headers = table.querySelectorAll("th[data-sort]");
  headers.forEach(function (th, colIndex) {
    th.addEventListener("click", function () {
      var rows = allRows();
      var type = th.getAttribute("data-sort");
      var dir = sortState.col === colIndex ? -sortState.dir : (colIndex === 0 ? 1 : -1);
      sortState = { col: colIndex, dir: dir };
      rows.sort(function (a, b) {
        var cellA = a.cells[colIndex], cellB = b.cells[colIndex];
        var va, vb;
        if (type === "num") {
          va = parseFloat(cellA.getAttribute("data-v") || "0");
          vb = parseFloat(cellB.getAttribute("data-v") || "0");
        } else {
          va = cellA.textContent.trim().toLowerCase();
          vb = cellB.textContent.trim().toLowerCase();
        }
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return 0;
      });
      headers.forEach(function (h) { h.classList.remove("sort-asc", "sort-desc"); });
      th.classList.add(dir === 1 ? "sort-asc" : "sort-desc");
      render(rows);
      if (restBody) restBody.hidden = !expanded;
    });
  });
})();
</script>`

    return new NextResponse(html.replace("</body>", scriptHtml + "\n</body>"), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
