import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"
import { HOAN_TAGS } from "../../../../modules/cskh-analysis/service"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

const ALLOWED_SOURCES = ["manual", "facebook", "zalo", "unknown", "medusa"]

// Regex detect "khách đồng ý nhận" trong note
const AGREED_REGEX = /khách (đã |)đồng ý|giữ đơn|sẽ nhận|chốt giao|khách nhận r|đã liên lạc|gặp khách/i

// Regex detect "tag không liên lạc được" nhưng note nói ngược lại
const LIEN_LAC_OK_REGEX = /khách (đã |)đồng ý|đã liên lạc|gặp khách|có nhà|đã nhận|nhận hàng/i

/**
 * GET /admin/cskh/suspicious?care=<name>&period=7d
 * Đơn hoàn nghi vấn: note CSKH không khớp lý do hoàn
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { care, period = "7d" } = req.query as Record<string, string>

    const now = Date.now()
    const periodMs = period === "30d" ? 30 * 24 * 3600_000 : period === "today" ? 0 : 7 * 24 * 3600_000
    const startMs = period === "today"
      ? new Date(new Date(now + 7 * 3600_000).toISOString().slice(0, 10) + "T00:00:00+07:00").getTime()
      : now - periodMs

    const pool = getPool()

    const params: any[] = [new Date(startMs).toISOString()]
    let careWhere = ""
    if (care && care !== "all") {
      params.push(care)
      careWhere = `AND po.care_name = $${params.length}`
    }

    const { rows } = await pool.query(`
      SELECT
        po.id, po.care_name, po.status, po.source,
        po.tags, po.notes, po.customer_name, po.customer_phone,
        po.cod_amount, po.tracking_code, po.updated_at
      FROM pancake_order po
      WHERE po.deleted_at IS NULL
        AND po.status = 4
        AND po.updated_at >= $1
        ${careWhere}
      ORDER BY po.updated_at DESC
      LIMIT 500
    `, params)

    const suspicious: any[] = []

    for (const row of rows) {
      if (!ALLOWED_SOURCES.includes(row.source)) continue

      const tags: string[] = Array.isArray(row.tags)
        ? row.tags.map((t: any) => t.name ?? t)
        : (typeof row.tags === "string" ? JSON.parse(row.tags || "[]").map((t: any) => t.name ?? t) : [])

      const notes: any[] = Array.isArray(row.notes)
        ? row.notes
        : (typeof row.notes === "string" ? JSON.parse(row.notes || "[]") : [])

      const lastNote = notes.slice(-1)[0]?.message ?? ""
      const reasons: string[] = []

      // 1. Hoàn nhưng không có note CSKH nào
      if (notes.length === 0) {
        reasons.push("no_notes")
      }

      // 2. Tag Hoan_DoKhongLienLacDuoc nhưng note nói đã liên lạc được
      if (tags.includes("Hoan_DoKhongLienLacDuoc") && LIEN_LAC_OK_REGEX.test(lastNote)) {
        reasons.push("tag_note_mismatch")
      }

      // 3. Note cuối nói khách đồng ý nhận nhưng vẫn hoàn
      if (notes.length > 0 && AGREED_REGEX.test(lastNote)) {
        // Chỉ flag nếu note này gần thời điểm hoàn (trong vòng 3 ngày)
        const noteMs = notes.slice(-1)[0]?.at_ms ?? 0
        const hoanMs = row.updated_at ? new Date(row.updated_at).getTime() : 0
        if (hoanMs - noteMs < 3 * 24 * 3600_000) {
          reasons.push("agreed_but_returned")
        }
      }

      if (reasons.length === 0) continue

      // Kiểm tra có tag lý do hoàn không
      const hasHoanTag = HOAN_TAGS.some(h => tags.includes(h))

      suspicious.push({
        id: row.id,
        care_name: row.care_name,
        customer_name: row.customer_name,
        customer_phone: row.customer_phone,
        cod_amount: row.cod_amount,
        tracking_code: row.tracking_code,
        updated_at: row.updated_at,
        tags: tags.filter(t => HOAN_TAGS.includes(t)),
        has_hoan_tag: hasHoanTag,
        last_note: lastNote,
        reasons,
      })
    }

    return res.json({ orders: suspicious, count: suspicious.length, period })
  } catch (err: any) {
    console.error("[CSKH suspicious]", err.message, err.stack)
    return res.status(500).json({ error: err.message })
  }
}
