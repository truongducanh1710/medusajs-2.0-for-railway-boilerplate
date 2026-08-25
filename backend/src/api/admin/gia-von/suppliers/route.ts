import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

/**
 * Danh mục nhà cung cấp — bản GỌN, chỉ thông tin cơ bản.
 *
 * Giai đoạn 1 phục vụ tab "Chi phí đóng gói": thay vì gõ tay tên NCC mỗi dòng
 * (dẫn tới "Shoppe"/"Shopee" mỗi nơi một kiểu) thì chọn từ danh mục này.
 *
 * Cột để dành cho sau: MOQ/giá CNY/WeChat cho NCC Trung Quốc, MST/VAT/công nợ
 * cho NCC Việt Nam. Chưa thêm vào để bảng không rỗng quá nửa ngay từ đầu.
 */
let _initialized = false

async function ensureTable(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS supplier (
      id           VARCHAR PRIMARY KEY,
      name         VARCHAR NOT NULL,
      origin       VARCHAR NOT NULL DEFAULT 'VN',
      contact_name VARCHAR NOT NULL DEFAULT '',
      phone        VARCHAR NOT NULL DEFAULT '',
      link         VARCHAR NOT NULL DEFAULT '',
      products     VARCHAR NOT NULL DEFAULT '',
      status       VARCHAR NOT NULL DEFAULT 'active',
      note         VARCHAR NOT NULL DEFAULT '',
      created_by   VARCHAR NULL,
      created_at   TIMESTAMPTZ DEFAULT now(),
      updated_at   TIMESTAMPTZ DEFAULT now(),
      deleted_at   TIMESTAMPTZ NULL
    );
    CREATE INDEX IF NOT EXISTS supplier_name_idx ON supplier (lower(name));
  `)
}

async function init(pool: Pool) {
  if (_initialized) return
  await ensureTable(pool)
  _initialized = true
}

function clean(v: unknown, max = 500): string {
  return String(v ?? "").trim().slice(0, max)
}

/** VN = mua trong nước, CN = nhập hàng Trung Quốc. */
function validOrigin(v: unknown): string {
  return String(v ?? "").trim().toUpperCase() === "CN" ? "CN" : "VN"
}

/**
 * GET /admin/gia-von/suppliers?q=&origin=
 * Kèm số liệu thực tế từ tab Chi phí đóng gói (đã mua bao nhiêu, tháng gần nhất)
 * — khớp theo TÊN vì các dòng nhập trước đây chưa có supplier_id.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    await init(pool)
    const q = clean((req.query as any).q, 200)
    const origin = clean((req.query as any).origin, 10).toUpperCase()

    const params: any[] = []
    const where: string[] = ["s.deleted_at IS NULL"]
    if (q) {
      params.push(`%${q}%`)
      where.push(`(s.name ILIKE $${params.length} OR s.products ILIKE $${params.length}
                   OR s.contact_name ILIKE $${params.length})`)
    }
    if (origin === "VN" || origin === "CN") {
      params.push(origin)
      where.push(`s.origin = $${params.length}`)
    }

    // to_regclass: tab Chi phí đóng gói có thể chưa được mở lần nào nên bảng
    // packing_cost_item chưa tồn tại — khi đó bỏ qua phần thống kê.
    const { rows: [chk] } = await pool.query(
      `SELECT to_regclass('public.packing_cost_item') AS t`,
    )
    const hasPacking = !!chk?.t

    const statSql = hasPacking
      ? `LEFT JOIN LATERAL (
           SELECT SUM(amount)::bigint AS total_amount,
                  COUNT(*)::int       AS order_count,
                  MAX(period)         AS last_period
           FROM packing_cost_item pc
           WHERE lower(trim(pc.supplier)) = lower(trim(s.name))
         ) p ON TRUE`
      : `LEFT JOIN LATERAL (SELECT NULL::bigint AS total_amount,
                                   0::int AS order_count,
                                   NULL::varchar AS last_period) p ON TRUE`

    const { rows } = await pool.query(
      `SELECT s.*, COALESCE(p.total_amount,0)::bigint AS total_amount,
              COALESCE(p.order_count,0)::int AS order_count, p.last_period
       FROM supplier s ${statSql}
       WHERE ${where.join(" AND ")}
       ORDER BY s.status ASC, s.name ASC`,
      params,
    )

    return res.json({
      suppliers: rows.map(r => ({
        ...r,
        total_amount: Number(r.total_amount || 0),
        order_count: Number(r.order_count || 0),
      })),
    })
  } catch (err: any) {
    _initialized = false
    return res.status(500).json({ error: err.message })
  }
}

/** POST /admin/gia-von/suppliers — tạo NCC mới. */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    await init(pool)
    const b: any = req.body ?? {}
    const name = clean(b.name)
    if (!name) return res.status(400).json({ error: "Thiếu tên nhà cung cấp" })

    const createdBy: string | null = (req as any).auth_context?.actor_id ?? null
    const { rows: [row] } = await pool.query(
      `INSERT INTO supplier
         (id, name, origin, contact_name, phone, link, products, status, note, created_by)
       VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [name, validOrigin(b.origin), clean(b.contact_name, 200), clean(b.phone, 50),
       clean(b.link, 1000), clean(b.products, 1000),
       clean(b.status, 40) || "active", clean(b.note, 2000), createdBy],
    )
    return res.json({ supplier: row })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/** PUT /admin/gia-von/suppliers — sửa 1 NCC (body.id bắt buộc). */
export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    await init(pool)
    const b: any = req.body ?? {}
    if (!b?.id) return res.status(400).json({ error: "Thiếu id" })
    const name = clean(b.name)
    if (!name) return res.status(400).json({ error: "Tên nhà cung cấp không được trống" })

    const { rows: [row] } = await pool.query(
      `UPDATE supplier SET
         name=$1, origin=$2, contact_name=$3, phone=$4, link=$5, products=$6,
         status=$7, note=$8, updated_at=now()
       WHERE id=$9 AND deleted_at IS NULL RETURNING *`,
      [name, validOrigin(b.origin), clean(b.contact_name, 200), clean(b.phone, 50),
       clean(b.link, 1000), clean(b.products, 1000),
       clean(b.status, 40) || "active", clean(b.note, 2000), b.id],
    )
    if (!row) return res.status(404).json({ error: "Không tìm thấy nhà cung cấp" })
    return res.json({ supplier: row })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/**
 * DELETE /admin/gia-von/suppliers?id=...
 * Xoá mềm: dòng chi phí cũ vẫn giữ tên NCC dạng text, xoá cứng là mất đối chiếu.
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pool = getPool()
    await init(pool)
    const id = clean((req.query as any).id, 100)
    if (!id) return res.status(400).json({ error: "Thiếu id" })
    await pool.query(`UPDATE supplier SET deleted_at = now() WHERE id = $1`, [id])
    return res.json({ deleted: true })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
