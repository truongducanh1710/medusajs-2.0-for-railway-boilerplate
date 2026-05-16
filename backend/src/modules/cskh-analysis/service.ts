import { MedusaService } from "@medusajs/framework/utils"
import { Pool } from "pg"

// Singleton pg pool dùng chung — tránh tạo connection mới mỗi lần gọi
let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  }
  return _pool
}

const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions"
const MODEL = "qwen/qwen2.5-vl-72b-instruct"
const BATCH_SIZE = 8

// Thẻ trigger AI — Pancake tự gắn khi ship báo thất bại
export const TAG_GIAO_KHONG_THANH = "Giao không thành"

// Thẻ lý do hoàn hợp lệ
export const HOAN_TAGS = [
  "Hoan_DoKhach", "Hoan_DoKhongLienLacDuoc", "Hoan_DoDVVC",
  "Hoan_DoKho", "Hoan_DoSanPham", "Hoan_GiaoHangLau", "Hoan_KhachTuChoi",
]

function todayVN(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)
}

function buildSystemPrompt(): string {
  const nowVN = new Date(Date.now() + 7 * 3600 * 1000).toISOString().replace("Z", "+07:00")
  return `Bạn hỗ trợ CSKH công ty bán hàng online Việt Nam theo dõi vận đơn.
Bây giờ: ${nowVN} (giờ Việt Nam UTC+7).

Với mỗi đơn, ưu tiên đọc cskh_notes TRƯỚC (note của nhân viên CSKH), rồi mới xem delivery_history (lịch sử bưu tá).
Note CSKH quan trọng hơn trạng thái bưu tá vì phản ánh thỏa thuận thực tế với khách.

Viết current_step bằng tiếng Việt ngắn gọn, mô tả tình trạng thực tế:
- Dựa vào note CSKH gần nhất + lịch sử bưu tá gần nhất
- KHÔNG chép nguyên raw status bưu tá (vd: "undeliverable", "on_the_way")
- Ví dụ tốt: "Khách hẹn giao lại chiều nay", "Bưu tá sắp hoàn - chưa liên lạc được khách", "Đang chờ bưu tá phát lại sau khi hẹn"

Quy tắc call_time (ISO 8601 timezone +07:00, hoặc null):
- Khách hẹn giờ cụ thể trong note/delivery → call_time = 30 phút TRƯỚC giờ hẹn
- Bưu cục báo "Thông báo chuyển hoàn" và chưa liên lạc được khách → urgency=critical, call_time = ngay bây giờ (${nowVN})
- Chưa liên lạc được khách, không có hẹn → call_time = hôm nay 08:00+07:00
- CSKH note lịch gọi cụ thể ("gl chiều", "gl 15h") → call_time = giờ đó hôm nay
- Đã có thỏa thuận ổn (khách hẹn, bưu tá xác nhận giao lại) → call_time = null (đang chờ, không cần gọi)
- Bưu tá xác nhận đang giao lại, chưa có vấn đề → call_time = null

Urgency: critical (sắp hoàn ngay/khẩn cấp) | high (cần gọi hôm nay) | medium (có thể hôm nay/mai) | low (đang ổn, đang chờ)
Priority_score 0-100: +3/ngày kể từ sự cố, +10/lần giao thất bại, +25 nếu sắp hoàn, +15 nếu CSKH không note >3 ngày, +10 nếu COD>500k.

Trả về JSON với key "results" chứa array, KHÔNG giải thích thêm:
{"results": [{"order_id":"...","current_step":"...","next_action":"...","call_time":"...|null","urgency":"...","priority_score":0}]}`
}

function buildOrderContext(raw: any, orderId: string): object {
  const partner = raw?.partner ?? {}
  const extendUpdate: any[] = Array.isArray(partner.extend_update) ? partner.extend_update : []
  const allNotes: any[] = Array.isArray(raw?.customer?.notes) ? raw.customer.notes : []

  // Lọc note đúng đơn này theo order_id
  const systemId = String(raw?.system_id ?? "")
  const trackingId = partner.extend_code ?? ""
  const trackingNoPrefix = trackingId.replace(/^(PKE|SPXVN|TT)/i, "")

  const cskhNotes = allNotes
    .filter(n => {
      const nid = String(n.order_id ?? "")
      return nid === systemId || nid === trackingNoPrefix || trackingId.includes(nid)
    })
    .slice(-10)
    .map(n => ({
      time: new Date(n.created_at).toISOString(),
      by: n.created_by?.name ?? "CSKH",
      message: n.message,
    }))

  return {
    order_id: orderId,
    picked_up_at: partner.picked_up_at ?? null,
    count_of_delivery: partner.count_of_delivery ?? 0,
    partner_status: partner.partner_status ?? null,
    delivery_history: extendUpdate.slice(0, 6).map(e => ({
      time: e.updated_at,
      status: e.status,
      note: e.note ?? null,
    })),
    cskh_notes: cskhNotes,
  }
}

async function callQwen(contexts: object[]): Promise<any[]> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set")

  const res = await fetch(OPENROUTER_API, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://api.phanviet.vn",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: JSON.stringify(contexts) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenRouter error ${res.status}: ${err}`)
  }

  const data = await res.json() as any
  const content = data.choices?.[0]?.message?.content ?? "{}"
  const parsed = JSON.parse(content)
  return Array.isArray(parsed.results) ? parsed.results : []
}

export class CskhAnalysisService extends MedusaService({}) {
  // Thực thi SQL qua pg pool (DATABASE_URL) — không dùng MikroORM manager vì service không có model
  private async sql(query: string, params?: any[]): Promise<any[]> {
    const client = await getPool().connect()
    try {
      const result = await client.query(query, params ?? [])
      return result.rows
    } finally {
      client.release()
    }
  }

  // Upsert kết quả AI vào cskh_analysis
  private async upsertAnalysis(results: any[]): Promise<void> {
    for (const r of results) {
      await this.sql(
        `INSERT INTO cskh_analysis (order_id, current_step, next_action, call_time, urgency, priority_score, analyzed_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (order_id) DO UPDATE SET
           current_step   = EXCLUDED.current_step,
           next_action    = EXCLUDED.next_action,
           call_time      = EXCLUDED.call_time,
           urgency        = EXCLUDED.urgency,
           priority_score = EXCLUDED.priority_score,
           analyzed_at    = now()`,
        [
          r.order_id,
          r.current_step ?? null,
          r.next_action ?? null,
          r.call_time ?? null,
          r.urgency ?? "medium",
          r.priority_score ?? 0,
        ]
      )
    }
  }

  // analyzeOrders: nhận danh sách order IDs, query raw, gọi AI, lưu kết quả
  async analyzeOrders(orderIds: string[]): Promise<void> {
    if (!orderIds.length) return

    const placeholders = orderIds.map((_, i) => `$${i + 1}`).join(",")
    const rows = await this.sql(
      `SELECT id, raw, last_note_at FROM pancake_order WHERE id IN (${placeholders})`,
      orderIds
    )

    if (!rows.length) return

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE)
      const contexts = batch
        .filter((r: any) => r.raw)
        .map((r: any) => buildOrderContext(r.raw, r.id))

      if (!contexts.length) continue

      try {
        const results = await callQwen(contexts)
        await this.upsertAnalysis(results)
        console.log(`[CskhAnalysis] Batch ${Math.floor(i / BATCH_SIZE) + 1}: analyzed ${results.length} orders`)
      } catch (err: any) {
        console.error(`[CskhAnalysis] Batch error:`, err.message)
      }
    }
  }

  // Query JOIN pancake_order + cskh_analysis cho trang CSKH
  async queryOrdersWithRaw(careFilter?: string): Promise<any[]> {
    const careWhere = careFilter ? `AND po.care_name = $1` : ""
    const params = careFilter ? [careFilter] : []
    return this.sql(
      `SELECT
         po.id,
         po.raw->'partner'->>'delivery_name'     AS delivery_name,
         po.raw->'partner'->>'delivery_tel'      AS delivery_tel,
         po.raw->'partner'->>'partner_status'    AS partner_status,
         po.raw->'partner'->>'count_of_delivery' AS count_of_delivery,
         po.raw->'partner'->>'picked_up_at'      AS picked_up_at,
         (po.raw->'partner'->'extend_update'->0->>'status')     AS last_delivery_status,
         (po.raw->'partner'->'extend_update'->0->>'updated_at') AS last_delivery_at,
         po.raw->'tags'                          AS raw_tags,
         ca.order_id, ca.current_step, ca.next_action, ca.call_time,
         ca.urgency, ca.priority_score, ca.analyzed_at
       FROM pancake_order po
       LEFT JOIN cskh_analysis ca ON ca.order_id = po.id
       WHERE po.status IN (2, 4)
         AND po.source IN ('manual', 'facebook', 'zalo', 'unknown', 'medusa')
         ${careWhere}`,
      params
    )
  }

  // Force re-analyze tất cả đơn GKT (xóa analyzed_at để bypass 2h cache)
  async getOrderIdsForForceReanalyze(careFilter?: string): Promise<string[]> {
    const careWhere = careFilter ? `AND po.care_name = $1` : ""
    const params = careFilter ? [careFilter] : []
    // Reset analyzed_at về null để getOrdersNeedingAnalysis pick up lại
    await this.sql(
      `UPDATE cskh_analysis ca
       SET analyzed_at = '2000-01-01'
       FROM pancake_order po
       WHERE ca.order_id = po.id
         AND po.status IN (2, 4)
         AND po.source IN ('manual', 'facebook', 'zalo', 'unknown', 'medusa')
         AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(COALESCE(po.raw->'tags','[]'::jsonb)) t
           WHERE t->>'name' = '${TAG_GIAO_KHONG_THANH}'
         )
         ${careWhere}`,
      params
    )
    return this.getOrdersNeedingAnalysis(careFilter)
  }

  // getOrdersNeedingAnalysis: IDs đơn có thẻ "Giao không thành"
  // chưa analyze hoặc có note mới kể từ lần analyze trước
  async getOrdersNeedingAnalysis(careFilter?: string): Promise<string[]> {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString()
    let paramIdx = 1
    const params: any[] = []

    params.push(twoHoursAgo)
    const twoHoursPh = `$${paramIdx++}`

    let careClause = ""
    if (careFilter) {
      params.push(careFilter)
      careClause = `AND po.care_name = $${paramIdx++}`
    }

    const rows = await this.sql(
      `SELECT po.id
       FROM pancake_order po
       LEFT JOIN cskh_analysis ca ON ca.order_id = po.id
       WHERE po.status IN (2, 4)
         AND po.source IN ('manual', 'facebook', 'zalo', 'unknown', 'medusa')
         AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(
             COALESCE(po.raw->'tags', '[]'::jsonb)
           ) AS t
           WHERE t->>'name' = '${TAG_GIAO_KHONG_THANH}'
         )
         AND (
           ca.analyzed_at IS NULL
           OR ca.analyzed_at < ${twoHoursPh}
           OR (po.last_note_at IS NOT NULL AND po.last_note_at > ca.analyzed_at)
         )
         ${careClause}
       ORDER BY po.pancake_created_at ASC
       LIMIT 200`,
      params
    )

    return rows.map((r: any) => r.id)
  }
}

export default CskhAnalysisService
