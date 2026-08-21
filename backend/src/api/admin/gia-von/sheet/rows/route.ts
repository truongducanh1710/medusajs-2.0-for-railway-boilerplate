import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"
import { specAt, isValidCell } from "../../../../../admin/lib/gia-von-schema"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

/**
 * Loại bỏ ô sai kiểu trước khi ghi (chữ vào cột số, giá trị lạ ở cột Tính chất).
 * UI đã chặn từ đầu vào; đây là chốt chặn cuối cho paste hàng loạt và gọi API trực tiếp.
 * Ô sai bị BỎ QUA chứ không làm hỏng cả dòng — phần hợp lệ vẫn được lưu.
 */
async function loadColPositions(pool: Pool): Promise<Map<string, number>> {
  const { rows } = await pool.query(`SELECT id, position FROM cost_sheet_column`)
  const posById = new Map<string, number>()
  for (const c of rows) posById.set(String(c.id), Number(c.position))
  return posById
}

function sanitize(posById: Map<string, number>, data: Record<string, string>): {
  clean: Record<string, string>; rejected: string[]
} {
  const clean: Record<string, string> = {}
  const rejected: string[] = []
  for (const [colId, raw] of Object.entries(data ?? {})) {
    const pos = posById.get(colId)
    // Cột không còn trong schema (L..Z cũ): giữ nguyên giá trị, không render nhưng không mất.
    if (pos === undefined) { clean[colId] = String(raw ?? ""); continue }
    const spec = specAt(pos)
    if (isValidCell(spec, String(raw ?? ""))) clean[colId] = String(raw ?? "")
    else rejected.push(`${spec?.name ?? colId}: "${raw}"`)
  }
  return { clean, rejected }
}

/**
 * POST /admin/gia-von/sheet/rows
 * Thêm 1 hoặc nhiều dòng mới
 * Body: { count?: number } — thêm N dòng trống
 *    hoặc { rows: [{ data: {...} }] } — thêm dòng với data sẵn (paste)
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const body: any = req.body ?? {}
    const pool = getPool()

    const { rows: [{ maxpos }] } = await pool.query(
      `SELECT COALESCE(MAX(position), -1) as maxpos FROM cost_sheet_row`
    )
    let nextPos = Number(maxpos) + 1

    const rejectedAll: string[] = []
    let toInsert: { data: Record<string, string> }[] = []
    if (Array.isArray(body.rows)) {
      const posById = await loadColPositions(pool)
      for (const r of body.rows) {
        const { clean, rejected } = sanitize(posById, r.data ?? {})
        toInsert.push({ data: clean })
        rejectedAll.push(...rejected)
      }
    } else {
      const count = Math.max(1, Math.min(Number(body.count ?? 1), 200))
      toInsert = Array.from({ length: count }, () => ({ data: {} }))
    }

    const inserted: any[] = []
    for (const r of toInsert) {
      const { rows: [row] } = await pool.query(
        `INSERT INTO cost_sheet_row (id, position, data, updated_at)
         VALUES (gen_random_uuid(), $1, $2, now()) RETURNING id, position, data, created_at`,
        [nextPos, JSON.stringify(r.data)]
      )
      inserted.push(row)
      nextPos++
    }

    return res.json({ rows: inserted, rejected: rejectedAll })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/**
 * PUT /admin/gia-von/sheet/rows
 * Bulk update cells: { rows: [{ id, data }] }
 * data là toàn bộ JSONB của dòng đó (frontend gửi full data sau mỗi edit)
 */
export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  try {
    const body: any = req.body ?? {}
    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      return res.json({ updated: 0 })
    }
    const pool = getPool()
    let updated = 0
    const rejectedAll: string[] = []
    const posById = await loadColPositions(pool)
    for (const r of body.rows) {
      if (!r.id) continue
      const { clean, rejected } = sanitize(posById, r.data ?? {})
      rejectedAll.push(...rejected)
      await pool.query(
        `UPDATE cost_sheet_row SET data = $1, updated_at = now() WHERE id = $2`,
        [JSON.stringify(clean), r.id]
      )
      updated++
    }
    return res.json({ updated, rejected: rejectedAll })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
