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

    // Kho đếm theo SẢN PHẨM LẺ, còn POS bán theo combo ("SET COMBO 2 Chổi" = 2 cái).
    // Bảng marketplace_sku_map (tab "Khớp SP sàn") đã khai sẵn combo → SP lẻ kèm số
    // lượng, nên quy đổi qua đó: bán 1 combo = trừ kho 2 cái SP lẻ.
    const skuMap = await sql(
      `SELECT sku_key, product_code, qty FROM marketplace_sku_map`,
    ).catch(() => [])
    // Một sku_key có thể gồm nhiều thành phần (combo nhiều món).
    const partsByKey: Record<string, { code: string; qty: number }[]> = {}
    for (const m of skuMap) {
      const k = String(m.sku_key || "").trim().replace(/\s+/g, " ").toUpperCase()
      if (!k) continue
      ;(partsByKey[k] ??= []).push({
        code: String(m.product_code || "").toUpperCase(),
        qty: Number(m.qty) || 1,
      })
    }

    // Lấy cả MÃ lẫn TÊN trên đơn — map khai được theo một trong hai.
    const velocityRaw = await sql(`
      SELECT
        upper(COALESCE(it->'variation_info'->>'display_id','')) AS code,
        upper(trim(COALESCE(it->'variation_info'->>'name', it->>'name',''))) AS name_up,
        SUM(COALESCE((it->>'quantity')::numeric,1))::int AS sold
      FROM pancake_order po
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(po.raw->'items','[]'::jsonb)) it
      WHERE po.deleted_at IS NULL AND COALESCE(NULLIF(po.market,''),'VN') = 'VN'
        AND po.status IN ${SOLD_STATUS}
        AND po.pancake_created_at >= CURRENT_DATE - $1::int
      GROUP BY 1, 2
    `, [days])

    /** Quy 1 dòng hàng trên POS về danh sách (SP lẻ × số lượng). */
    const explode = (code: string, nameUp: string, qty: number) => {
      // Mã trước tên: biến thể cùng tên khác số lượng (CCX01 = 1 cây, CCX02 = 2 cây)
      // chỉ phân biệt được bằng mã — tra theo tên sẽ trừ tồn sai bội số.
      const parts = partsByKey[code] ?? partsByKey[nameUp]
      if (parts?.length) return parts.map(p => ({ code: p.code, qty: qty * p.qty }))
      return code ? [{ code, qty }] : []
    }

    const velocity: { code: string; sold: number }[] = []
    {
      const acc: Record<string, number> = {}
      for (const r of velocityRaw) {
        for (const p of explode(String(r.code || ""), String(r.name_up || ""), Number(r.sold) || 0)) {
          acc[p.code] = (acc[p.code] ?? 0) + p.qty
        }
      }
      for (const [code, sold] of Object.entries(acc)) velocity.push({ code, sold })
    }

    // Tồn chốt gần nhất của từng mã.
    const snaps = await sql(`
      SELECT DISTINCT ON (product_code)
        product_code, product_name, qty, counted_at, note
      FROM ton_kho_snapshot
      ORDER BY product_code, counted_at DESC
    `)

    // Bản chốt tồn cũng phải quy đổi như lúc bán. Kho hay gõ mã bao bì trên sàn
    // (PHVVN037_HDTP01 = gói 1 hộp) thay vì mã hàng lẻ (PHVVN037_HDTP), mà số bán ra
    // đã quy về mã lẻ — không quy đổi thì một mặt hàng tách thành hai dòng: dòng có
    // tồn nhưng "bán/ngày = 0" (không bao giờ cảnh báo hết hàng) và dòng có tốc độ bán
    // nhưng "chưa chốt". Đúng cái đã xảy ra với hộp đựng thực phẩm.
    const snapMap: Record<string, any> = {}
    for (const s of snaps) {
      const raw = String(s.product_code || "").toUpperCase()
      // Chốt 600 gói loại 5 hộp = 3000 hộp lẻ.
      for (const p of explode(raw, String(s.product_name || "").trim().toUpperCase(), Number(s.qty) || 0)) {
        const prev = snapMap[p.code]
        // Cùng một mã lẻ có thể nhận nhiều bản chốt (kho gõ 2 mã bao bì khác nhau):
        // lấy bản MỚI NHẤT, vì bản cũ đã lỗi thời chứ không phải hàng nằm thêm kho.
        if (prev && new Date(prev.counted_at) >= new Date(s.counted_at)) continue
        snapMap[p.code] = { ...s, product_code: p.code, qty: p.qty }
      }
    }

    // Đã bán KỂ TỪ lúc chốt — phần trừ dần. Phải quy đổi combo giống trên, nên lấy
    // mọi dòng hàng bán sau mốc chốt SỚM NHẤT rồi lọc theo từng mã trong JS: không
    // join sẵn theo mã được, vì combo bán ra mang mã khác với mã SP lẻ đã chốt tồn.
    const snapList = Object.values(snapMap)
    const earliestSnap = snapList.reduce<Date | null>((min, s: any) => {
      const d = new Date(s.counted_at)
      return !min || d < min ? d : min
    }, null)
    const soldSinceRaw = !earliestSnap ? [] : await sql(`
      SELECT
        upper(COALESCE(it->'variation_info'->>'display_id','')) AS code,
        upper(trim(COALESCE(it->'variation_info'->>'name', it->>'name',''))) AS name_up,
        po.pancake_created_at AS at,
        COALESCE((it->>'quantity')::numeric,1)::int AS qty
      FROM pancake_order po
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(po.raw->'items','[]'::jsonb)) it
      WHERE po.deleted_at IS NULL AND COALESCE(NULLIF(po.market,''),'VN') = 'VN'
        AND po.status IN ${SOLD_STATUS}
        AND po.pancake_created_at > $1::timestamptz
    `, [earliestSnap.toISOString()])

    const sinceBy: Record<string, number> = {}
    for (const r of soldSinceRaw) {
      const at = new Date(r.at)
      for (const p of explode(String(r.code || ""), String(r.name_up || ""), Number(r.qty) || 0)) {
        // Tra trong bản chốt ĐÃ QUY ĐỔI: dòng hàng đã về mã lẻ, còn snaps thô vẫn
        // mang mã kho gõ — so thẳng sẽ không khớp và tồn không bao giờ bị trừ.
        const snap = snapMap[p.code]
        // Chỉ trừ những gì bán SAU mốc chốt của chính mã đó.
        if (snap && at > new Date(snap.counted_at)) {
          sinceBy[p.code] = (sinceBy[p.code] ?? 0) + p.qty
        }
      }
    }
    const soldSince = Object.entries(sinceBy).map(([code, sold]) => ({ code, sold }))

    // Tên SP: lấy thẳng từ dòng hàng đơn POS — đây là tên kho/POS đang dùng, và phủ
    // được cả mã biến thể (PHVVN043_CCX01...) vốn không có trong mkt_product.
    // Mỗi mã lấy tên xuất hiện nhiều nhất. mkt_product chỉ dùng để bù mã chưa bán đơn nào.
    const posNames = await sql(`
      SELECT upper(COALESCE(it->'variation_info'->>'display_id','')) AS code,
             COALESCE(it->'variation_info'->>'name', it->>'name','') AS name,
             COUNT(*)::int AS n
      FROM pancake_order po
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(po.raw->'items','[]'::jsonb)) it
      WHERE po.deleted_at IS NULL
        AND po.pancake_created_at >= CURRENT_DATE - 180
        AND COALESCE(it->'variation_info'->>'display_id','') <> ''
        AND COALESCE(it->'variation_info'->>'name', it->>'name','') <> ''
      GROUP BY 1, 2
    `).catch(() => [])
    const products = await sql(
      `SELECT code, name FROM mkt_product WHERE active IS NOT FALSE`,
    ).catch(() => [])

    const nameByCode: Record<string, string> = {}
    for (const p of products) nameByCode[String(p.code).toUpperCase()] = p.name
    const nameFreq: Record<string, number> = {}
    for (const r of posNames) {
      const c = String(r.code || "").toUpperCase()
      const n = Number(r.n) || 0
      if (!c || n <= (nameFreq[c] ?? 0)) continue
      nameFreq[c] = n
      nameByCode[c] = String(r.name).trim()
    }

    const soldMap: Record<string, number> = {}
    for (const r of velocity) if (r.code) soldMap[r.code] = Number(r.sold) || 0
    const sinceMap: Record<string, number> = {}
    for (const r of soldSince) if (r.code) sinceMap[r.code] = Number(r.sold) || 0

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
        product_name: nameByCode[code] || snap?.product_name || code,
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

/**
 * DELETE /admin/ton-kho?product_code=…[&all=1]
 *
 * Xoá bản chốt tồn. Mặc định chỉ xoá bản MỚI NHẤT của mã đó — chốt nhầm thì rút lại
 * đúng lần vừa nhập, các lần chốt cũ giữ nguyên làm lịch sử. `all=1` xoá sạch mọi bản
 * chốt của mã (dùng khi mã bị nhập nhầm hẳn, vd đếm trùng một lô dưới hai mã).
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    await init()
    const q: any = req.query ?? {}
    const code = clean(q.product_code, 100).toUpperCase()
    if (!code) return res.status(400).json({ error: "Thiếu product_code" })

    const all = String(q.all ?? "") === "1"
    const rows = all
      ? await sql(`DELETE FROM ton_kho_snapshot WHERE product_code = $1 RETURNING id`, [code])
      : await sql(
          `DELETE FROM ton_kho_snapshot WHERE id = (
             SELECT id FROM ton_kho_snapshot WHERE product_code = $1
             ORDER BY counted_at DESC LIMIT 1
           ) RETURNING id`,
          [code],
        )
    return res.json({ deleted: rows.length, product_code: code, all })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
