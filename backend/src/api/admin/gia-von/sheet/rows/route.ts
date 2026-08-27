import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"
import { specAt, isValidCell, isProductCode } from "../../../../../admin/lib/gia-von-schema"

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

/** TÊN SP (upper) → mã, để nắn cột K khi người dùng/paste đưa vào tên thay vì mã. */
async function loadNameToCode(pool: Pool): Promise<Map<string, string>> {
  const { rows } = await pool.query(
    `SELECT name, code FROM mkt_product WHERE active = true AND name <> '' AND code <> ''`
  )
  const m = new Map<string, string>()
  for (const p of rows) m.set(String(p.name).trim().toUpperCase(), String(p.code).trim().toUpperCase())
  return m
}

function sanitize(
  posById: Map<string, number>,
  data: Record<string, string>,
  nameToCode: Map<string, string>
): { clean: Record<string, string>; rejected: string[]; fixed: string[] } {
  const clean: Record<string, string> = {}
  const rejected: string[] = []
  const fixed: string[] = []
  for (const [colId, raw] of Object.entries(data ?? {})) {
    const pos = posById.get(colId)
    // Cột không còn trong schema (L..Z cũ): giữ nguyên giá trị, không render nhưng không mất.
    if (pos === undefined) { clean[colId] = String(raw ?? ""); continue }
    const spec = specAt(pos)
    const val = String(raw ?? "")

    // Cột "Mã SP": nắn TÊN SP về mã thay vì vứt ô. PUT gửi full data mỗi lần sửa, nên
    // nếu chỉ chặn thì sửa bất kỳ ô nào trên dòng cũ (cột K đang ghi tên) cũng làm mất
    // luôn mã của dòng đó. Nắn được thì lưu mã; không nắn được mới loại.
    if (spec?.kind === "code" && val.trim() && !isProductCode(val)) {
      const mapped = nameToCode.get(val.trim().toUpperCase())
      if (mapped) {
        clean[colId] = mapped
        fixed.push(`${spec.name}: "${val}" → ${mapped}`)
      } else {
        rejected.push(`${spec.name}: "${val}"`)
      }
      continue
    }

    if (isValidCell(spec, val)) clean[colId] = val
    else rejected.push(`${spec?.name ?? colId}: "${val}"`)
  }
  return { clean, rejected, fixed }
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
    const fixedAll: string[] = []
    let toInsert: { data: Record<string, string> }[] = []
    if (Array.isArray(body.rows)) {
      const [posById, nameToCode] = await Promise.all([loadColPositions(pool), loadNameToCode(pool)])
      for (const r of body.rows) {
        const { clean, rejected, fixed } = sanitize(posById, r.data ?? {}, nameToCode)
        toInsert.push({ data: clean })
        rejectedAll.push(...rejected)
        fixedAll.push(...fixed)
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

    return res.json({ rows: inserted, rejected: rejectedAll, fixed: fixedAll })
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
    const fixedAll: string[] = []
    const [posById, nameToCode] = await Promise.all([loadColPositions(pool), loadNameToCode(pool)])
    for (const r of body.rows) {
      if (!r.id) continue
      const { clean, rejected, fixed } = sanitize(posById, r.data ?? {}, nameToCode)
      rejectedAll.push(...rejected)
      fixedAll.push(...fixed)
      await pool.query(
        `UPDATE cost_sheet_row SET data = $1, updated_at = now() WHERE id = $2`,
        [JSON.stringify(clean), r.id]
      )
      updated++
    }
    return res.json({ updated, rejected: rejectedAll, fixed: fixedAll })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
