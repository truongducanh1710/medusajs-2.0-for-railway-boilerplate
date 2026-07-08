import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

// Nhóm gọn 3 trạng thái cho agency dễ theo dõi — chi tiết đầy đủ xem GLOSSARY.md
const CONFIRMED_STATUSES = new Set([2, 3, 6, 9])
const CANCELLED_STATUSES = new Set([-1, -2, 4, 5, 7])

function simpleStatus(status: number): { label: string; cls: string } {
  if (CONFIRMED_STATUSES.has(status)) return { label: "Đã xác nhận", cls: "confirmed" }
  if (CANCELLED_STATUSES.has(status)) return { label: "Đã hủy", cls: "cancelled" }
  return { label: "Đang xử lý", cls: "pending" }
}

function maskPhone(phone: string): string {
  const digits = (phone || "").replace(/\D/g, "")
  if (digits.length < 6) return phone || ""
  return `${digits.slice(0, 3)}***${digits.slice(-3)}`
}

function maskName(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ""
  return parts
    .map((p, i) => (i === parts.length - 1 ? p : p[0] + "**"))
    .join(" ")
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

/**
 * GET /store/google-orders
 * Public — bảng đơn hàng từ nguồn Google Ads (ad_platform='google') cho agency GG xem, không cần login.
 * ?format=json để lấy raw JSON thay vì trang HTML.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { format, days } = req.query as Record<string, string | undefined>
    const pool = getPool()
    const dayRange = Math.min(Number(days) || 30, 90)

    const { rows } = await pool.query(
      `SELECT id, status, status_name, customer_name, customer_phone, province,
              total, items, items_count, tracking_code, pancake_created_at,
              COALESCE(raw->>'link', raw->>'order_link', '') AS order_link
       FROM pancake_order
       WHERE ad_platform = 'google'
         AND pancake_created_at >= NOW() - ($1 || ' days')::interval
       ORDER BY pancake_created_at DESC
       LIMIT 500`,
      [dayRange]
    )

    const orders = rows.map((o: any) => ({
      id: o.id,
      status: Number(o.status),
      ...simpleStatus(Number(o.status)),
      customer_name: maskName(o.customer_name),
      customer_phone: maskPhone(o.customer_phone),
      province: o.province,
      total: Number(o.total),
      items_count: Number(o.items_count),
      product_names: Array.isArray(o.items)
        ? o.items.map((it: any) => it?.name).filter(Boolean).join(", ")
        : "",
      tracking_code: o.tracking_code,
      campaign_id: extractCampaignId(o.order_link),
      created_at: o.pancake_created_at,
    }))

    if (format === "json") {
      return res.json({ orders, count: orders.length, days: dayRange })
    }

    const rowsHtml = orders
      .map(
        (o) => `<tr>
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
        <td><span class="badge status-${o.cls}">${escapeHtml(o.label)}</span></td>
      </tr>`
      )
      .join("\n")

    const html = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Đơn hàng Google Ads — Phan Việt</title>
<meta http-equiv="refresh" content="120">
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 24px; background: #f7f7f8; color: #1a1a1a; }
  @media (prefers-color-scheme: dark) { body { background: #16161a; color: #e6e6e6; } }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #666; font-size: 13px; margin-bottom: 16px; }
  @media (prefers-color-scheme: dark) { .sub { color: #999; } }
  table { border-collapse: collapse; width: 100%; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.08); font-size: 13px; }
  @media (prefers-color-scheme: dark) { table { background: #222; } }
  th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid #eee; white-space: nowrap; }
  @media (prefers-color-scheme: dark) { th, td { border-bottom: 1px solid #333; } }
  th { background: #fafafa; font-weight: 600; position: sticky; top: 0; }
  @media (prefers-color-scheme: dark) { th { background: #1c1c20; } }
  .badge { padding: 2px 8px; border-radius: 12px; font-size: 12px; white-space: nowrap; }
  .status-confirmed { background: #d1f7d6; color: #146c2e; }
  .status-cancelled { background: #f8d7da; color: #842029; }
  .status-pending { background: #e2e3e5; color: #41464b; }
  @media (prefers-color-scheme: dark) {
    .status-confirmed { background: #123d20; color: #7ee39a; }
    .status-cancelled { background: #3d1518; color: #f5a3ab; }
    .status-pending { background: #2a2a2e; color: #c0c0c5; }
  }
  .wrap { overflow-x: auto; }
</style>
</head>
<body>
  <h1>Đơn hàng nguồn Google Ads</h1>
  <div class="sub">${orders.length} đơn trong ${dayRange} ngày gần nhất · Tự động cập nhật mỗi 2 phút · SĐT/tên đã ẩn 1 phần</div>
  <div class="wrap">
  <table>
    <thead><tr>
      <th>Mã đơn</th><th>Ngày tạo</th><th>Khách hàng</th><th>SĐT</th><th>Tỉnh/TP</th><th>Sản phẩm</th><th>SL SP</th><th>Tổng tiền</th><th>Mã vận đơn</th><th>Mã Campaign GG</th><th>Trạng thái</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  </div>
</body>
</html>`

    res.setHeader("Content-Type", "text/html; charset=utf-8")
    return res.send(html)
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
