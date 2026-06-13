import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

// Tên cột mặc định A-Z
const DEFAULT_COL_NAMES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")
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

  // Seed cột A-Z nếu chưa có
  const { rows: existingCols } = await pool.query(`SELECT COUNT(*) as n FROM cost_sheet_column`)
  if (Number(existingCols[0].n) === 0) {
    for (let i = 0; i < DEFAULT_COL_NAMES.length; i++) {
      await pool.query(
        `INSERT INTO cost_sheet_column (id, position, name, col_type, width) VALUES (gen_random_uuid(), $1, $2, 'text', 100)`,
        [i, DEFAULT_COL_NAMES[i]]
      )
    }
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
      `SELECT id, position, data FROM cost_sheet_row ORDER BY position ASC`
    )
    return res.json({ columns, rows })
  } catch (err: any) {
    _initialized = false // reset để retry lần sau
    return res.status(500).json({ error: err.message })
  }
}
