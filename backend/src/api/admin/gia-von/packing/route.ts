import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

/**
 * Chi phí công cụ dụng cụ đóng gói theo tháng (xốp nổ, băng dính, hộp carton…).
 *
 * Trước đây mua hàng theo dõi trong file Google Sheet "Tiền CCDC" — mỗi tháng
 * một sheet. Đưa vào đây để số nằm cùng chỗ với giá vốn và sau này tính được
 * chi phí đóng gói / đơn mà không phải mở file ngoài.
 *
 * Gom theo `period` (YYYY-MM) thay vì ngày cụ thể: hoá đơn mua vật tư rải rác
 * trong tháng nhưng khi tính chi phí luôn cộng cả tháng.
 */
let _initialized = false

async function ensureTable(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS packing_cost_item (
      id          VARCHAR PRIMARY KEY,
      period      VARCHAR NOT NULL,
      position    INT NOT NULL DEFAULT 0,
      product     VARCHAR NOT NULL DEFAULT '',
      supplier    VARCHAR NOT NULL DEFAULT '',
      quantity    VARCHAR NOT NULL DEFAULT '',
      amount      BIGINT  NOT NULL DEFAULT 0,
      note        VARCHAR NOT NULL DEFAULT '',
      created_by  VARCHAR NULL,
      created_at  TIMESTAMPTZ DEFAULT now(),
      updated_at  TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS packing_cost_item_period_idx
      ON packing_cost_item (period, position);
  `)
  // Cột ngày thêm sau khi bảng đã chạy thật — ADD COLUMN IF NOT EXISTS để không đụng
  // dữ liệu cũ. NULL = dòng cũ chưa ghi ngày (vẫn thuộc tháng `period`), KHÔNG mặc định
  // về hôm nay vì như thế là bịa ngày mua cho hoá đơn cũ.
  await pool.query(`
    ALTER TABLE packing_cost_item ADD COLUMN IF NOT EXISTS item_date DATE NULL;
  `)
}

async function init(pool: Pool) {
  if (_initialized) return
  await ensureTable(pool)
  _initialized = true
}

/** "2026-08" — mặc định tháng hiện tại theo giờ VN. */
function currentPeriod(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 7)
}

function validPeriod(v: unknown): string | null {
  const s = String(v ?? "").trim()
  return /^\d{4}-\d{2}$/.test(s) ? s : null
}

/** Số tiền: nhận cả "15.400.800" lẫn 15400800. */
function toAmount(v: unknown): number {
  if (typeof v === "number") return Math.round(v)
  const s = String(v ?? "").replace(/[^\d-]/g, "")
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n) : 0
}

function clean(v: unknown, max = 500): string {
  return String(v ?? "").trim().slice(0, max)
}

/**
 * Ngày mua của dòng: "YYYY-MM-DD" hoặc null (chưa ghi).
 *
 * Ràng buộc ngày phải THUỘC tháng `period` của dòng — bảng lọc theo period, nên ngày
 * lệch tháng sẽ làm dòng biến mất khỏi màn hình đang xem mà người nhập không hiểu vì
 * sao. Lệch tháng thì trả về null (giữ dòng, chỉ bỏ ngày) thay vì ném lỗi mất cả dòng.
 */
function toItemDate(v: unknown, period: string): string | null {
  const s = String(v ?? "").trim()
  if (!s) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  if (s.slice(0, 7) !== period) return null
  // Chặn ngày không tồn tại (31/02): Date tự "tràn" sang tháng sau nên so lại chuỗi.
  const d = new Date(`${s}T00:00:00Z`)
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null
  return s
}

/** DATE từ pg về dạng Date object — đổi sang "YYYY-MM-DD" theo lịch, không lệch múi giờ. */
function dateOut(v: unknown): string {
  if (!v) return ""
  if (typeof v === "string") return v.slice(0, 10)
  const d = v as Date
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/**
 * GET /admin/gia-von/packing?period=YYYY-MM
 * Trả các dòng của tháng đó + danh sách tháng đã có dữ liệu (để dựng dropdown).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    await init(pool)
    const period = validPeriod((req.query as any).period) ?? currentPeriod()

    // Sắp theo NGÀY trước (dòng chưa ghi ngày xuống cuối), rồi mới tới position — mua
    // hàng nhập rải rác trong tháng nên xem theo thứ tự ngày là tự nhiên nhất.
    const { rows } = await pool.query(
      `SELECT id, period, position, product, supplier, quantity, amount::bigint, note, item_date
       FROM packing_cost_item WHERE period = $1
       ORDER BY item_date ASC NULLS LAST, position ASC, created_at ASC`,
      [period],
    )
    const { rows: periodRows } = await pool.query(
      `SELECT period, SUM(amount)::bigint AS total, COUNT(*)::int AS n
       FROM packing_cost_item GROUP BY period ORDER BY period DESC`,
    )

    return res.json({
      period,
      rows: rows.map(r => ({ ...r, amount: Number(r.amount), item_date: dateOut(r.item_date) })),
      total: rows.reduce((s, r) => s + Number(r.amount || 0), 0),
      periods: periodRows.map(p => ({
        period: p.period, total: Number(p.total), n: Number(p.n),
      })),
    })
  } catch (err: any) {
    _initialized = false
    return res.status(500).json({ error: err.message })
  }
}

/**
 * POST /admin/gia-von/packing
 * Body: { period, count? }            — thêm N dòng trống vào cuối
 *    hoặc { period, rows: [{...}] }   — thêm nhiều dòng có sẵn dữ liệu (paste)
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    await init(pool)
    const body: any = req.body ?? {}
    const period = validPeriod(body.period)
    if (!period) return res.status(400).json({ error: "Tháng không hợp lệ (YYYY-MM)" })

    const createdBy: string | null = (req as any).auth_context?.actor_id ?? null
    const { rows: [{ maxpos }] } = await pool.query(
      `SELECT COALESCE(MAX(position), -1) AS maxpos FROM packing_cost_item WHERE period = $1`,
      [period],
    )
    let pos = Number(maxpos) + 1

    // Chặn 200 dòng/lần cho cả 2 nhánh: nhánh `rows` (paste, hoặc thêm dòng có sẵn ngày)
    // trước đây không giới hạn nên 1 request có thể chèn tuỳ ý.
    const toInsert: any[] = Array.isArray(body.rows) && body.rows.length
      ? body.rows.slice(0, 200)
      : Array.from({ length: Math.max(1, Math.min(Number(body.count ?? 1), 100)) }, () => ({}))

    const inserted: any[] = []
    for (const r of toInsert) {
      const { rows: [row] } = await pool.query(
        `INSERT INTO packing_cost_item
           (id, period, position, product, supplier, quantity, amount, note, created_by, item_date)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, period, position, product, supplier, quantity, amount::bigint, note, item_date`,
        [period, pos, clean(r.product), clean(r.supplier), clean(r.quantity, 100),
         toAmount(r.amount), clean(r.note), createdBy, toItemDate(r.item_date, period)],
      )
      inserted.push({ ...row, amount: Number(row.amount), item_date: dateOut(row.item_date) })
      pos++
    }
    return res.json({ rows: inserted })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/**
 * PUT /admin/gia-von/packing
 * Body: { rows: [{ id, product?, supplier?, quantity?, amount?, note? }] }
 */
export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    await init(pool)
    const body: any = req.body ?? {}
    if (!Array.isArray(body.rows) || !body.rows.length) return res.json({ updated: 0 })

    let updated = 0
    for (const r of body.rows) {
      if (!r?.id) continue
      // Lấy period từ chính dòng trong DB, không tin period client gửi: ngày phải khớp
      // tháng của dòng, mà client chỉ gửi các field đang sửa.
      const { rows: [cur] } = await pool.query(
        `SELECT period FROM packing_cost_item WHERE id = $1`, [r.id],
      )
      if (!cur) continue
      await pool.query(
        `UPDATE packing_cost_item
         SET product=$1, supplier=$2, quantity=$3, amount=$4, note=$5, item_date=$6, updated_at=now()
         WHERE id=$7`,
        [clean(r.product), clean(r.supplier), clean(r.quantity, 100),
         toAmount(r.amount), clean(r.note), toItemDate(r.item_date, cur.period), r.id],
      )
      updated++
    }
    return res.json({ updated })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/** DELETE /admin/gia-von/packing?id=... */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    await init(pool)
    const id = String((req.query as any).id ?? "").trim()
    if (!id) return res.status(400).json({ error: "Thiếu id" })
    await pool.query(`DELETE FROM packing_cost_item WHERE id = $1`, [id])
    return res.json({ deleted: true })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
