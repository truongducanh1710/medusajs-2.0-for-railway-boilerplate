import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool } from "../../../../lib/db"
import { loadOrderForPancake, pushAndRecord } from "../../../../lib/pancake-push"

/**
 * POST /admin/pancake-sync/repush-order
 * Body: { display_ids?: number[], order_ids?: string[] }
 *
 * Đẩy lại đơn web chưa vào được Pancake. Bỏ qua đơn đã có pancake_order_id để
 * không tạo trùng trên POS.
 *
 * GET: liệt kê đơn web đang chưa có trên Pancake (để biết cần đẩy lại gì).
 */
export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  const { rows } = await getPool().query(
    `SELECT id, display_id, created_at, metadata->>'pancake_push_error' AS loi,
            metadata->>'utm_source' AS camp
     FROM "order"
     WHERE deleted_at IS NULL AND metadata->>'pancake_order_id' IS NULL
       AND created_at > now() - interval '60 days'
     ORDER BY created_at DESC`
  )
  return res.json({ chua_vao_pancake: rows })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { display_ids, order_ids } = (req.body as any) || {}
  let ids: string[] = Array.isArray(order_ids) ? order_ids : []
  if (Array.isArray(display_ids) && display_ids.length) {
    const { rows } = await getPool().query(
      `SELECT id FROM "order" WHERE display_id = ANY($1::int[]) AND deleted_at IS NULL`,
      [display_ids.map(Number)]
    )
    ids = ids.concat(rows.map((r) => r.id))
  }
  if (!ids.length) return res.status(400).json({ error: "Cần display_ids hoặc order_ids" })

  const ketqua: any[] = []
  for (const id of ids) {
    try {
      const { order, shippingAddress } = await loadOrderForPancake(req.scope, id)
      if (order.metadata?.pancake_order_id) {
        ketqua.push({ id, display_id: order.display_id, bo_qua: "đã có trên Pancake", pancake_order_id: order.metadata.pancake_order_id })
        continue
      }
      const kq = await pushAndRecord(req.scope, order, shippingAddress)
      ketqua.push({ id, display_id: order.display_id, ...kq })
    } catch (e: any) {
      ketqua.push({ id, ok: false, loi: e.message })
    }
  }
  return res.json({ ketqua })
}
