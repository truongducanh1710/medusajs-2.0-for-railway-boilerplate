import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"
import { SHEET_SCHEMA, SHEET_COL_COUNT } from "../../../../admin/lib/gia-von-schema"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

const DEFAULT_ROW_COUNT = 30

async function ensureTables(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cost_sheet_column (
      id         VARCHAR PRIMARY KEY,
      position   INT NOT NULL,
      name       VARCHAR NOT NULL,
      col_type   VARCHAR DEFAULT 'text',
      width      INT DEFAULT 120,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS cost_sheet_row (
      id         VARCHAR PRIMARY KEY,
      position   INT NOT NULL,
      data       JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS cost_sheet_row_position_idx ON cost_sheet_row (position);
  `)

  // Cấu trúc cột khoá cứng theo SHEET_SCHEMA: thiếu thì tạo, sai tên/kiểu thì nắn
  // lại, thừa (cột L..Z của bản A-Z cũ) thì xoá. Chạy mỗi lần khởi động nên bảng
  // luôn về đúng schema kể cả khi ai đó lỡ sửa thẳng DB.
  const { rows: existingCols } = await pool.query(
    `SELECT id, position, name, col_type, width FROM cost_sheet_column ORDER BY position ASC`
  )
  const byPos = new Map<number, any>()
  for (const c of existingCols) byPos.set(Number(c.position), c)

  for (const spec of SHEET_SCHEMA) {
    const cur = byPos.get(spec.position)
    if (!cur) {
      await pool.query(
        `INSERT INTO cost_sheet_column (id, position, name, col_type, width)
         VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
        [spec.position, spec.name, spec.col_type, spec.width]
      )
    } else if (cur.name !== spec.name || cur.col_type !== spec.col_type) {
      await pool.query(
        `UPDATE cost_sheet_column SET name = $1, col_type = $2 WHERE id = $3`,
        [spec.name, spec.col_type, cur.id]
      )
    }
  }

  // Cột thừa (L..Z của bản A-Z cũ): chỉ xoá cột KHÔNG có dữ liệu. Cột thừa mà đang
  // chứa số liệu thì giữ nguyên và để nguyên đó — thà bảng hơi rộng còn hơn làm
  // biến mất thứ mua hàng đã nhập; dọn tay sau khi đã xem là gì.
  const { rows: extraCols } = await pool.query(
    `SELECT id FROM cost_sheet_column WHERE position >= $1`, [SHEET_COL_COUNT]
  )
  if (extraCols.length > 0) {
    const { rows: allRows } = await pool.query(`SELECT data FROM cost_sheet_row`)
    const nonEmpty = new Set<string>()
    for (const r of allRows) {
      for (const [cid, v] of Object.entries(r.data ?? {})) {
        if (String(v ?? "").trim()) nonEmpty.add(cid)
      }
    }
    const removable = extraCols.map((c: any) => String(c.id)).filter(id => !nonEmpty.has(id))
    if (removable.length > 0) {
      await pool.query(`DELETE FROM cost_sheet_column WHERE id = ANY($1::varchar[])`, [removable])
    }
    const kept = extraCols.length - removable.length
    if (kept > 0) console.warn(`[gia-von sheet] giữ ${kept} cột ngoài schema vì đang có dữ liệu`)
  }

  // Seed 30 dòng trống nếu chưa có
  const { rows: existingRows } = await pool.query(`SELECT COUNT(*) as n FROM cost_sheet_row`)
  if (Number(existingRows[0].n) === 0) {
    for (let i = 0; i < DEFAULT_ROW_COUNT; i++) {
      await pool.query(
        `INSERT INTO cost_sheet_row (id, position, data, updated_at) VALUES (gen_random_uuid(), $1, '{}', now())`,
        [i]
      )
    }
  }
}

let _initialized = false

/**
 * GET /admin/gia-von/sheet
 * Trả về toàn bộ columns + rows, tự tạo bảng nếu chưa có
 */
export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    if (!_initialized) {
      await ensureTables(pool)
      _initialized = true
    }
    const { rows: columns } = await pool.query(
      `SELECT id, position, name, col_type, width FROM cost_sheet_column ORDER BY position ASC`
    )
    const { rows } = await pool.query(
      `SELECT id, position, data, created_at FROM cost_sheet_row ORDER BY position ASC`
    )
    return res.json({ columns, rows })
  } catch (err: any) {
    _initialized = false // reset để retry lần sau
    return res.status(500).json({ error: err.message })
  }
}
