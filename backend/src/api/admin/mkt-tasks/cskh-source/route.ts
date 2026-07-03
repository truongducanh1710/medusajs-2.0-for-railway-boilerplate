import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

/**
 * GET /admin/mkt-tasks/cskh-source?keyword=chảo vàng&status=3&from=2026-06-01&to=2026-07-01&limit=200
 * Preview khách hàng đã mua 1 sản phẩm (theo tên trong pancake_order.items) để bulk-tạo
 * task gọi CSKH. Mặc định status=3 (Giao thành công) — chỉ khách đã thực nhận hàng.
 * from/to lọc theo pancake_created_at (khoảng ngày); nếu không truyền thì mặc định 30 ngày gần nhất.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const q = req.query as Record<string, string>
    const keyword = (q.keyword || "chảo vàng").trim()
    if (!keyword) return res.status(400).json({ error: "keyword required" })
    const status = q.status !== undefined && q.status !== "" ? Number(q.status) : 3
    const limit = Math.min(Math.max(parseInt(q.limit || "200", 10) || 200, 1), 1000)

    // Khoảng ngày: ưu tiên from/to; fallback "days" (số ngày gần nhất) để tương thích ngược
    let fromDate: Date
    let toDate: Date
    if (q.from || q.to) {
      fromDate = q.from ? new Date(q.from) : new Date(0)
      toDate = q.to ? new Date(new Date(q.to).getTime() + 24 * 3600 * 1000) : new Date() // to inclusive hết ngày
    } else {
      const days = Math.min(Math.max(parseInt(q.days || "30", 10) || 30, 1), 365)
      toDate = new Date()
      fromDate = new Date(toDate.getTime() - days * 24 * 3600 * 1000)
    }

    const pool = getPool()
    const { rows } = await pool.query(
      `SELECT o.id, o.customer_name, o.customer_phone, o.pancake_created_at,
              (SELECT array_agg(DISTINCT i->>'name') FROM jsonb_array_elements(o.items) i
               WHERE i->>'name' ILIKE $1) AS matched_items
       FROM pancake_order o
       WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(o.items) i WHERE i->>'name' ILIKE $1)
         AND ($2::int IS NULL OR o.status = $2)
         AND o.customer_phone IS NOT NULL AND o.customer_phone != ''
         AND o.pancake_created_at >= $3 AND o.pancake_created_at <= $4
       ORDER BY o.pancake_created_at DESC
       LIMIT $5`,
      [`%${keyword}%`, Number.isNaN(status) ? null : status, fromDate, toDate, limit]
    )

    // Group theo customer_phone — dedupe khách nhiều đơn
    const byPhone = new Map<string, {
      customer_phone: string; customer_name: string; order_ids: string[]
      order_count: number; latest_order_at: string; matched_items: string[]
    }>()
    for (const r of rows) {
      const key = r.customer_phone
      const existing = byPhone.get(key)
      const items: string[] = r.matched_items || []
      if (!existing) {
        byPhone.set(key, {
          customer_phone: key,
          customer_name: r.customer_name || "",
          order_ids: [r.id],
          order_count: 1,
          latest_order_at: r.pancake_created_at,
          matched_items: items,
        })
      } else {
        existing.order_ids.push(r.id)
        existing.order_count++
        for (const it of items) if (!existing.matched_items.includes(it)) existing.matched_items.push(it)
        // rows đã ORDER BY DESC nên bản ghi đầu tiên gặp là mới nhất — giữ nguyên latest_order_at/tên
      }
    }

    const customers = Array.from(byPhone.values())
    if (customers.length === 0) return res.json({ customers: [] })

    // Đánh dấu khách đã có task cskh_call active (status != cancelled) trỏ order trùng
    const svc = req.scope.resolve("mktTaskModule") as any
    const existingTasks = await svc.listMktTasks(
      { type: "cskh_call" },
      { select: ["id", "pancake_order_id", "status"] }
    )
    const activeOrderIds = new Set(
      existingTasks
        .filter((t: any) => t.status !== "cancelled" && t.pancake_order_id)
        .map((t: any) => t.pancake_order_id)
    )
    const result = customers.map(c => ({
      ...c,
      already_has_task: c.order_ids.some(id => activeOrderIds.has(id)),
    }))

    res.json({ customers: result, total_orders_matched: rows.length })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
