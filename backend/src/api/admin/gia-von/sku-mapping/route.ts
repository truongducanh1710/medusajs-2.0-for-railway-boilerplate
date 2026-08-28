import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"
import { computeAvgCost, DISPLAY_ID_ALIASES } from "../avg-cost/route"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}
async function sql(q: string, params?: any[]): Promise<any[]> {
  const c = await getPool().connect()
  try { return (await c.query(q, params ?? [])).rows } finally { c.release() }
}

/**
 * ĐỐI CHIẾU SKU SÀN → MÃ SP (tab "Khớp SP sàn" ở trang Giá vốn)
 *
 * Vấn đề: trên Shopee/TikTok, người đăng bán tự đặt tên và sàn tự sinh SKU riêng, ví dụ
 * "336391824840 - SET COMBO 2 Chổi Vệ Sinh INOX 304 Cọ Chà Rửa Nồi…". Tên đó không khớp
 * mã nào trong bảng giá vốn nên báo cáo LNG sàn tra giá vốn ra 0 và đánh dấu "thiếu giá
 * vốn" — đúng cái nhân sự nhìn thấy trong drill-down đơn.
 *
 * Trước đây chỉ vá được bằng cách sửa code (DISPLAY_ID_ALIASES / COMBO_COMPOSITION),
 * nghĩa là mỗi SKU mới phải chờ kỹ thuật. Bảng này cho nhân sự tự khớp:
 *
 *   marketplace_sku_map: sku_key (mã hoặc TÊN sàn viết hoa) → product_code (+ qty)
 *
 * qty > 1 để khai combo: "SET COMBO 2 Chổi" = 2 × PHVVN043_CCX02. Nhiều dòng cùng
 * sku_key = combo nhiều thành phần, giá vốn cộng lại.
 *
 * GET  ?days=30  → SKU sàn chưa có giá vốn (gom từ đơn thật) + map đã khai + gợi ý
 * POST { sku_key, parts: [{product_code, qty}] }  → lưu/ghi đè 1 map
 * DELETE ?sku_key=…                               → xoá map
 */

let _init = false
async function ensureTable() {
  await sql(`
    CREATE TABLE IF NOT EXISTS marketplace_sku_map (
      id            VARCHAR PRIMARY KEY,
      sku_key       VARCHAR NOT NULL,
      product_code  VARCHAR NOT NULL,
      qty           NUMERIC NOT NULL DEFAULT 1,
      note          VARCHAR NOT NULL DEFAULT '',
      created_by    VARCHAR NULL,
      created_at    TIMESTAMPTZ DEFAULT now(),
      updated_at    TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS marketplace_sku_map_key_idx ON marketplace_sku_map (sku_key);
  `)
  _init = true
}
async function init() { if (!_init) await ensureTable() }

/** Chuẩn hoá khoá khớp: bỏ dấu cách thừa + viết hoa, để "  set combo " == "SET COMBO". */
function normKey(v: unknown): string {
  return String(v ?? "").trim().replace(/\s+/g, " ").toUpperCase()
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    await init()
    const days = Math.min(Math.max(parseInt(String((req.query as any).days ?? "30"), 10) || 30, 1), 365)

    const avg = await computeAvgCost(getPool())
    const maps = await sql(`SELECT * FROM marketplace_sku_map ORDER BY sku_key, product_code`)

    // Gom map theo sku_key — 1 SKU có thể gồm nhiều thành phần.
    const mapped: Record<string, any> = {}
    for (const m of maps) {
      const k = String(m.sku_key)
      ;(mapped[k] ??= { sku_key: k, parts: [], note: m.note ?? "" })
        .parts.push({ product_code: m.product_code, qty: Number(m.qty) || 1 })
    }

    // Giá vốn phụ kiện bán lẻ — cùng nguồn với báo cáo sàn (cost_sheet), để "đã khớp"
    // ở đây hiển thị đúng con số báo cáo sẽ dùng.
    const cols = await sql(`SELECT id, position FROM cost_sheet_column ORDER BY position`)
    const rowsSheet = await sql(`SELECT position, data FROM cost_sheet_row ORDER BY position`)
    const accessory: Record<string, number> = {}
    if (rowsSheet.length > 1) {
      const posToId: Record<number, string> = {}
      for (const c of cols) posToId[c.position] = c.id
      const header = rowsSheet[0].data as Record<string, string>
      const h2id: Record<string, string> = {}
      for (const [cid, v] of Object.entries(header)) if (v) h2id[String(v).trim()] = cid
      const cTen = h2id["Sản phẩm"] ?? posToId[1]
      const cTC = h2id["Tính chất"] ?? posToId[2]
      const cGia = h2id["Giá về kho/sp"] ?? posToId[9]
      for (const r of rowsSheet.slice(1)) {
        const d = r.data as Record<string, string>
        const ten = (d[cTen] ?? "").trim()
        if (!ten || (d[cTC] ?? "").trim() === "Sản phẩm chính") continue
        const g = parseFloat(String(d[cGia] ?? "").replace(/\./g, "").replace(",", ".")) || 0
        if (g > 0) accessory[ten.toUpperCase()] = Math.round(g)
      }
    }

    /** Tra giá vốn 1 mã theo đúng thứ tự báo cáo sàn dùng. */
    const costOf = (code: string): number | null => {
      const c = normKey(code)
      if (accessory[c] != null) return accessory[c]
      if (avg.byName[c] != null) return avg.byName[c]
      const alias = DISPLAY_ID_ALIASES[c] ?? c
      if (avg.costs[alias] != null) return avg.costs[alias]
      const m = alias.match(/^(PHVVN\d{2,3})/)
      if (m && avg.byPrefix[m[1]] != null) return avg.byPrefix[m[1]]
      return null
    }

    // SKU sàn thật sự xuất hiện trong đơn gần đây, kèm mức độ ảnh hưởng để nhân sự
    // biết khớp cái nào trước. Chỉ lấy đơn đã cho đi (status 1,2,3,8) như báo cáo.
    const skus = await sql(`
      SELECT
        upper(trim(COALESCE(mi->'variation_info'->>'name', mi->>'name', ''))) AS sku_name,
        MAX(COALESCE(mi->'variation_info'->>'display_id', ''))                AS sku_code,
        MAX(po.source)                                                        AS platform,
        COUNT(DISTINCT po.id)::int                                            AS orders,
        SUM(COALESCE((mi->>'quantity')::numeric, 1))::numeric                 AS qty,
        MAX(po.pancake_created_at)                                            AS last_seen
      FROM pancake_order po
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(po.raw->'items','[]'::jsonb)) AS mi
      WHERE po.deleted_at IS NULL
        AND po.source IN ('shopee','tiktok')
        AND po.status IN (1,2,3,8)
        AND po.pancake_created_at >= now() - ($1 || ' days')::interval
        AND po.raw->'items' IS NOT NULL
      GROUP BY 1
      ORDER BY orders DESC
    `, [String(days)])

    // Danh mục mã SP để dropdown chọn — nguồn duy nhất là mkt_product.
    const products = await sql(`SELECT code, name FROM mkt_product WHERE active = true ORDER BY code`)

    const unmatched: any[] = []
    const matched: any[] = []
    for (const s of skus) {
      const nameKey = normKey(s.sku_name)
      const codeKey = normKey(s.sku_code)
      const map = mapped[nameKey] ?? (codeKey ? mapped[codeKey] : null)

      // Giá vốn hiện tại theo đúng đường báo cáo đi: tên trước, rồi mã.
      const auto = costOf(nameKey) ?? (codeKey ? costOf(codeKey) : null)

      if (map) {
        // Đã khai tay — tính giá vốn từ thành phần; thiếu 1 mã con thì báo chưa đủ.
        let sum = 0, ok = true
        const parts = map.parts.map((p: any) => {
          const c = costOf(p.product_code)
          if (c == null) ok = false; else sum += c * p.qty
          return { ...p, unit_cost: c }
        })
        matched.push({
          sku_name: s.sku_name, sku_code: s.sku_code || null, platform: s.platform,
          orders: s.orders, qty: Number(s.qty), last_seen: s.last_seen,
          parts, cost: ok ? sum : null, incomplete: !ok, note: map.note,
          matched_key: mapped[nameKey] ? nameKey : codeKey,
        })
      } else if (auto == null) {
        // Chưa khớp được bằng cách nào — đây là dòng nhân sự cần xử lý.
        unmatched.push({
          sku_name: s.sku_name, sku_code: s.sku_code || null, platform: s.platform,
          orders: s.orders, qty: Number(s.qty), last_seen: s.last_seen,
        })
      }
      // auto != null && !map → đang tự khớp đúng, không cần hiện ra cho đỡ nhiễu.
    }

    return res.json({
      unmatched, matched, products, days,
      summary: {
        unmatched: unmatched.length,
        unmatched_orders: unmatched.reduce((s, u) => s + u.orders, 0),
        matched: matched.length,
        incomplete: matched.filter(m => m.incomplete).length,
      },
    })
  } catch (err: any) {
    console.error("[gia-von/sku-mapping GET]", err.message)
    return res.status(500).json({ error: err.message })
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    await init()
    const body = (req.body ?? {}) as any
    const key = normKey(body.sku_key)
    if (!key) return res.status(400).json({ error: "Thiếu sku_key" })

    const parts = Array.isArray(body.parts) ? body.parts : []
    const clean = parts
      .map((p: any) => ({ product_code: normKey(p.product_code), qty: Number(p.qty) || 1 }))
      .filter((p: any) => p.product_code && p.qty > 0)
    if (clean.length === 0) return res.status(400).json({ error: "Chưa chọn sản phẩm để khớp" })

    const userId = (req as any).auth_context?.actor_id ?? null
    // Ghi đè trọn bộ thành phần của SKU này: sửa map = khai lại, không cộng dồn.
    await sql(`DELETE FROM marketplace_sku_map WHERE sku_key = $1`, [key])
    for (const p of clean) {
      await sql(
        `INSERT INTO marketplace_sku_map (id, sku_key, product_code, qty, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [`msm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
         key, p.product_code, p.qty, String(body.note ?? ""), userId]
      )
    }
    return res.json({ ok: true, sku_key: key, parts: clean })
  } catch (err: any) {
    console.error("[gia-von/sku-mapping POST]", err.message)
    return res.status(500).json({ error: err.message })
  }
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    await init()
    const key = normKey((req.query as any).sku_key)
    if (!key) return res.status(400).json({ error: "Thiếu sku_key" })
    await sql(`DELETE FROM marketplace_sku_map WHERE sku_key = $1`, [key])
    return res.json({ ok: true })
  } catch (err: any) {
    console.error("[gia-von/sku-mapping DELETE]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
