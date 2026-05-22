import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { randomUUID } from "crypto"

/**
 * POST /store/webcake/webhook
 * Nhận đơn hàng từ Webcake landing pages. Payload là custom form fields.
 * Lưu vào bảng webcake_lead (raw JSON + các field chính).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = req.body as Record<string, any>

  // Extract các field phổ biến, phần còn lại lưu trong raw
  const fullName = String(body?.full_name ?? body?.name ?? body?.ho_ten ?? "")
  const phoneNumber = String(body?.phone_number ?? body?.phone ?? body?.sdt ?? body?.so_dien_thoai ?? "")
  const sourceUrl = String(body?.source_url ?? body?.page_url ?? body?.utm_source ?? "")

  // Trả 200 ngay — Webcake không retry nếu nhận được 200
  res.json({ success: true })

  // Fire-and-forget: insert vào webcake_lead (dedup: bỏ qua nếu cùng SĐT trong 60s)
  ;(async () => {
    try {
      const cskhService = req.scope.resolve("cskhAnalysisModule") as any

      if (phoneNumber) {
        const [existing] = await cskhService.sql(
          `SELECT id FROM webcake_lead WHERE phone_number = $1 AND created_at > now() - interval '60 seconds' LIMIT 1`,
          [phoneNumber]
        )
        if (existing) {
          console.log(`[Webcake] Dedup — skip duplicate ${phoneNumber}`)
          return
        }
      }

      const id = randomUUID()
      await cskhService.sql(
        `INSERT INTO webcake_lead (id, full_name, phone_number, raw, status, source_url, created_at, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, 'new', $5, now(), now())`,
        [id, fullName, phoneNumber, JSON.stringify(body), sourceUrl]
      )
      console.log(`[Webcake] ✓ Lead saved #${id} — ${fullName} ${phoneNumber}`)
    } catch (err: any) {
      console.error("[Webcake] Insert error:", err.message)
    }
  })()
}
