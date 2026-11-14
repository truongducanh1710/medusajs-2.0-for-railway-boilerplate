import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { backfillOrderFunnel, orderFunnelStatus, BACKFILL_FROM } from "../../../../lib/order-funnel"

/**
 * GET /admin/order-funnel/backfill — trạng thái lượt dựng order_funnel đang chạy / lượt gần nhất.
 */
export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  return res.json(orderFunnelStatus())
}

/**
 * POST /admin/order-funnel/backfill   Body: { from?: "2026-07-20" } (ngày tạo đơn, giờ VN)
 * Dựng lại order_funnel cho mọi đơn tạo từ `from`, lô 2.000 đơn. Chạy NỀN, trả về ngay;
 * theo dõi bằng GET. Một lượt/lúc (job 15 phút sẽ tự bỏ qua khi backfill đang chạy).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const from = String((req.body as any)?.from || BACKFILL_FROM)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return res.status(400).json({ error: "from phải dạng YYYY-MM-DD" })
  const st = orderFunnelStatus()
  if (st.running) return res.status(409).json({ error: `Đang chạy "${st.running}"`, ...st })

  backfillOrderFunnel(from, (m) => console.log(`[OrderFunnelBackfill] ${m}`))
    .then((r) => console.log(`[OrderFunnelBackfill] done from=${from} orders=${r.orders} batches=${r.batches}`))
    .catch((e) => console.error(`[OrderFunnelBackfill] failed from=${from}:`, e?.message))

  return res.status(202).json({ started: true, from })
}
