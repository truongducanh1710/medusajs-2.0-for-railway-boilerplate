import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

/**
 * Lịch sử gán extension ↔ nhân viên theo mốc thời gian.
 *
 * Vì sao cần: một máy nhánh được bàn giao qua nhiều người. Bảng ity_extension_map
 * chỉ giữ NGƯỜI ĐANG DÙNG, nên khi đổi người thì toàn bộ cuộc gọi cũ cũng bị gán
 * sang tên người mới — số của người cũ biến mất, người mới bị cộng thêm việc
 * mình không làm. Ví dụ ext 207491003: Đỗ Quỳnh dùng tháng 6–7 (6.219 cuộc),
 * Hà Đàm nhận từ 01/08 (3.000 cuộc).
 *
 * Cùng ý tưởng với bảng mkt_handover đang dùng cho marketer.
 */
let _initialized = false

async function ensureTable(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ity_extension_history (
      id             VARCHAR PRIMARY KEY,
      extension      VARCHAR NOT NULL,
      display_name   VARCHAR NOT NULL DEFAULT '',
      user_id        VARCHAR NULL,
      effective_from DATE NOT NULL,
      effective_to   DATE NULL,
      note           VARCHAR NOT NULL DEFAULT '',
      created_at     TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ity_ext_history_idx
      ON ity_extension_history (extension, effective_from);
  `)
}

async function init(pool: Pool) {
  if (_initialized) return
  await ensureTable(pool)
  _initialized = true
}

function validDate(v: unknown): string | null {
  const s = String(v ?? "").trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

function clean(v: unknown, max = 300): string {
  return String(v ?? "").trim().slice(0, max)
}

/** GET /admin/ity-cdr-sync/extension-history */
export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    await init(pool)
    const { rows } = await pool.query(
      `SELECT id, extension, display_name, user_id,
              effective_from::text, effective_to::text, note
       FROM ity_extension_history
       ORDER BY extension ASC, effective_from DESC`,
    )
    return res.json({ history: rows })
  } catch (err: any) {
    _initialized = false
    return res.status(500).json({ error: err.message })
  }
}

/**
 * POST /admin/ity-cdr-sync/extension-history
 * Body: { extension, display_name, user_id?, effective_from, effective_to?, note? }
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    await init(pool)
    const b: any = req.body ?? {}
    const extension = clean(b.extension, 50)
    const displayName = clean(b.display_name, 200)
    const from = validDate(b.effective_from)
    const to = b.effective_to ? validDate(b.effective_to) : null

    if (!extension) return res.status(400).json({ error: "Thiếu extension" })
    if (!displayName) return res.status(400).json({ error: "Thiếu tên nhân viên" })
    if (!from) return res.status(400).json({ error: "Ngày bắt đầu không hợp lệ (YYYY-MM-DD)" })
    if (b.effective_to && !to)
      return res.status(400).json({ error: "Ngày kết thúc không hợp lệ (YYYY-MM-DD)" })

    const { rows: [row] } = await pool.query(
      `INSERT INTO ity_extension_history
         (id, extension, display_name, user_id, effective_from, effective_to, note)
       VALUES (gen_random_uuid(), $1, $2, $3, $4::date, $5::date, $6)
       RETURNING id, extension, display_name, user_id,
                 effective_from::text, effective_to::text, note`,
      [extension, displayName, b.user_id || null, from, to, clean(b.note, 500)],
    )
    return res.json({ history: row })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/** DELETE /admin/ity-cdr-sync/extension-history?id=... */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    await init(pool)
    const id = clean((req.query as any).id, 100)
    if (!id) return res.status(400).json({ error: "Thiếu id" })
    await pool.query(`DELETE FROM ity_extension_history WHERE id = $1`, [id])
    return res.json({ deleted: true })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
