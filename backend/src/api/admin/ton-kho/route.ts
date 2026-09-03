import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}
async function sql(q: string, p?: any[]): Promise<any[]> {
  const c = await getPool().connect()
  try { return (await c.query(q, p ?? [])).rows } finally { c.release() }
}

/**
 * Theo dõi tồn kho + dự báo lượng cần nhập.
 *
 * Cách vận hành: kho đếm tay và chốt tồn mỗi chiều (17–18h). Từ mốc chốt đó, mọi đơn
 * phát sinh trên POS được trừ dần để ra tồn hiện tại. Kho báo sao thì tin vậy — không
 * đối chiếu, không cảnh báo lệch.
 *
 * Tốc độ bán và dự báo nhập lấy từ SỐ LƯỢNG BÁN TRÊN POS, không phụ thuộc số kho báo.
 *
 * KHÔNG dùng cột product_cost.stock_qty: cột đó chỉ cộng dồn lượng NHẬP vào qua các lô,
 * chưa bao giờ trừ hàng bán ra, nên không phải tồn thật.
 */
let _init = false
async function ensureTable() {
  await sql(`
    CREATE TABLE IF NOT EXISTS ton_kho_snapshot (
      id          VARCHAR PRIMARY KEY,
      product_code VARCHAR NOT NULL,
      product_name VARCHAR NOT NULL DEFAULT '',
      qty         INT NOT NULL DEFAULT 0,
      counted_at  TIMESTAMPTZ NOT NULL,
      note        VARCHAR NOT NULL DEFAULT '',
      created_by  VARCHAR NULL,
      created_at  TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ton_kho_snapshot_idx
      ON ton_kho_snapshot (product_code, counted_at DESC);
  `)
  _init = true
}
async function init() { if (!_init) await ensureTable() }

const clean = (v: unknown, max = 300) => String(v ?? "").trim().slice(0, max)

/** Trạng thái đơn được tính là ĐÃ BÁN (trừ kho): xác nhận trở đi, chưa huỷ/hoàn. */
const SOLD_STATUS = "(1,2,3,8,9,11)"

/**
 * GET /admin/ton-kho?days=30&lead_days=25
 *
 * Trả mỗi SP: tồn kho chốt gần nhất, số đã bán từ lúc chốt, tồn hiện tại, tốc độ bán,
 * số ngày còn bán được, và lượng đề xuất nhập.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    await init()
    const q = req.query as Record<string, string>
    const days = Math.max(7, Math.min(Number(q.days) || 30, 90))
    const leadDays = Math.max(0, Math.min(Number(q.lead_days) || 25, 120))

    // Tốc độ bán: lấy từ POS theo mã biến thể, quy về mã chuẩn trong mkt_product.
    const velocity = await sql(`
      SELECT
        upper(COALESCE(it->'variation_info'->>'display_id','')) AS code,
        SUM(COALESCE((it->>'quantity')::numeric,1))::int AS sold
      FROM pancake_order po
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(po.raw->'items','[]'::jsonb)) it
      WHERE po.deleted_at IS NULL AND COALESCE(NULLIF(po.market,''),'VN') = 'VN'
        AND po.status IN ${SOLD_STATUS}
        AND po.pancake_created_at >= CURRENT_DATE - $1::int
      GROUP BY 1
    `, [days])

    // Tồn chốt gần nhất của từng mã.
    const snaps = await sql(`
      SELECT DISTINCT ON (product_code)
        product_code, product_name, qty, counted_at, note
      FROM ton_kho_snapshot
      ORDER BY product_code, counted_at DESC
    `)

    // Đã bán KỂ TỪ lúc chốt — đây là phần trừ dần.
    const soldSince = snaps.length === 0 ? [] : await sql(`
      SELECT
        upper(COALESCE(it->'variation_info'->>'display_id','')) AS code,
        SUM(COALESCE((it->>'quantity')::numeric,1))::int AS sold
      FROM pancake_order po
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(po.raw->'items','[]'::jsonb)) it
      JOIN (VALUES ${snaps.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2}::timestamptz)`).join(",")})
        AS s(code, since) ON s.code = upper(COALESCE(it->'variation_info'->>'display_id',''))
      WHERE po.deleted_at IS NULL AND COALESCE(NULLIF(po.market,''),'VN') = 'VN'
        AND po.status IN ${SOLD_STATUS}
        AND po.pancake_created_at > s.since
      GROUP BY 1
    `, snaps.flatMap(s => [s.product_code, s.counted_at]))

    const products = await sql(
      `SELECT code, name FROM mkt_product WHERE active IS NOT FALSE`,
    ).catch(() => [])

    const nameByCode: Record<string, string> = {}
    for (const p of products) nameByCode[String(p.code).toUpperCase()] = p.name

    const soldMap: Record<string, number> = {}
    for (const r of velocity) if (r.code) soldMap[r.code] = Number(r.sold) || 0
    const sinceMap: Record<string, number> = {}
    for (const r of soldSince) if (r.code) sinceMap[r.code] = Number(r.sold) || 0
    const snapMap: Record<string, any> = {}
    for (const s of snaps) snapMap[s.product_code] = s

    // Gộp mọi mã: có bán trong kỳ HOẶC đã từng chốt tồn.
    const codes = Array.from(new Set([...Object.keys(soldMap), ...Object.keys(snapMap)]))
      .filter(Boolean)

    const rows = codes.map(code => {
      const snap = snapMap[code]
      const sold = soldMap[code] ?? 0
      const perDay = Math.round((sold / days) * 100) / 100
      const soldAfter = sinceMap[code] ?? 0
      // Không cho tồn âm: kho đếm sót hoặc đơn về muộn thì coi như hết hàng.
      const onHand = snap ? Math.max(0, Number(snap.qty) - soldAfter) : null

      const daysLeft = onHand != null && perDay > 0
        ? Math.round((onHand / perDay) * 10) / 10
        : null
      // Điểm đặt hàng = bán hết trong lúc chờ hàng về.
      const reorderPoint = Math.ceil(perDay * leadDays)

      return {
        product_code: code,
        product_name: snap?.product_name || nameByCode[code] || code,
        // Tồn
        last_qty: snap ? Number(snap.qty) : null,
        counted_at: snap?.counted_at ?? null,
        sold_since_count: soldAfter,
        on_hand: onHand,
        // Tốc độ bán (từ POS, độc lập với số kho báo)
        sold_in_period: sold,
        per_day: perDay,
        days_left: daysLeft,
        // Dự báo nhập
        reorder_point: reorderPoint,
        need_7d: Math.ceil(perDay * 7),
        need_30d: Math.ceil(perDay * 30),
        // Cần đặt = bù đủ cho kỳ + dự phòng chờ hàng, trừ tồn đang có
        suggest_7d: Math.max(0, Math.ceil(perDay * (7 + leadDays)) - (onHand ?? 0)),
        suggest_30d: Math.max(0, Math.ceil(perDay * (30 + leadDays)) - (onHand ?? 0)),
        // Cảnh báo
        need_order: onHand != null && perDay > 0 && onHand < reorderPoint,
        dead_stock: (onHand ?? 0) > 0 && sold === 0,
        no_snapshot: !snap,
      }
    }).sort((a, b) => {
      // Sắp theo mức khẩn: mã sắp hết lên đầu, mã chưa chốt tồn xuống cuối.
      const da = a.days_left ?? (a.no_snapshot ? 1e9 : 1e8)
      const db = b.days_left ?? (b.no_snapshot ? 1e9 : 1e8)
      return da - db
    })

    return res.json({ days, lead_days: leadDays, rows })
  } catch (err: any) {
    _init = false
    return res.status(500).json({ error: err.message })
  }
}

/**
 * POST /admin/ton-kho — kho chốt tồn.
 * Body: { rows: [{ product_code, product_name?, qty, note? }], counted_at? }
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    await init()
    const b: any = req.body ?? {}
    const list = Array.isArray(b.rows) ? b.rows.slice(0, 500) : []
    if (!list.length) return res.status(400).json({ error: "Không có dòng nào để lưu" })

    // Mặc định là thời điểm bấm lưu — mốc này quyết định đơn nào bị trừ.
    const countedAt = b.counted_at ? new Date(b.counted_at) : new Date()
    if (isNaN(countedAt.getTime()))
      return res.status(400).json({ error: "Thời điểm chốt không hợp lệ" })

    const createdBy: string | null = (req as any).auth_context?.actor_id ?? null
    let saved = 0
    for (const r of list) {
      const code = clean(r.product_code, 100).toUpperCase()
      if (!code) continue
      const qty = Math.max(0, Math.round(Number(r.qty) || 0))
      await sql(
        `INSERT INTO ton_kho_snapshot
           (id, product_code, product_name, qty, counted_at, note, created_by)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
        [code, clean(r.product_name), qty, countedAt, clean(r.note), createdBy],
      )
      saved++
    }
    return res.json({ saved, counted_at: countedAt.toISOString() })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
