import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"
import { computeAvgCost } from "../../../gia-von/avg-cost/route"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}
async function sql(query: string, params?: any[]): Promise<any[]> {
  const client = await getPool().connect()
  try {
    const result = await client.query(query, params ?? [])
    return result.rows
  } finally {
    client.release()
  }
}

/**
 * GET /admin/pancake-sync/report/lng-errors?from=...&to=...
 *
 * Chẩn đoán dữ liệu làm lệch báo cáo LNG:
 *  1. no_marketer  — đơn không quy được về marketer (marketer rỗng / fallback ra 'KHÁC')
 *  2. no_cost       — SP trong đơn giao TC nhưng không map được giá vốn
 *  3. unlinked_cost — SP có trong bảng giá vốn nhưng tên chưa khớp mkt_product (chưa ra code)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const {
      from = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
      to = new Date().toISOString().slice(0, 10),
    } = req.query as Record<string, string>

    // Marketer expr giống report/mkt — đơn lỗi = ra NULL hoặc 'KHÁC'
    const mktExpr = `
      CASE UPPER(TRIM(COALESCE(NULLIF(TRIM(raw->'marketer'->>'name'), ''), '')))
        WHEN 'NAM DV'     THEN 'NAMDV'
        WHEN 'PHẠM DU'    THEN 'DUPD'
        WHEN 'NGUYỄN MAI' THEN 'NGUYEN MAI'
        WHEN 'TRUONGAN'   THEN 'ANHTD'
        WHEN ''           THEN NULL
        ELSE UPPER(TRIM(NULLIF(TRIM(raw->'marketer'->>'name'), '')))
      END
    `
    const mktFallback = `
      COALESCE(
        ${mktExpr},
        CASE
          WHEN raw->>'p_utm_campaign' LIKE '%\\_%\\_%'
            THEN split_part(raw->>'p_utm_campaign', '_', 2)
          WHEN raw->>'p_utm_source' LIKE '%\\_%\\_%'
            THEN split_part(raw->>'p_utm_source', '_', 2)
          ELSE 'KHÁC'
        END
      )
    `

    // Filter dùng chung — viết với alias rỗng (cột trần) cho query 1,
    // và bản có prefix "po." cho query join (query 2).
    const commonFilter = (p = "") => `
      AND ${p}source IN ('manual', 'facebook', 'medusa', 'unknown', 'webcake')
      AND NOT (${p}tags @> '[{"name": "Đơn nháp"}]'::jsonb)
      AND NOT (${p}tags @> '[{"name": "Đơn trùng"}]'::jsonb)
      AND ${p}pancake_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
      AND ${p}pancake_created_at <  (($2::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
    `

    // ── 1. Đơn chưa có marketer ────────────────────────────────────────────────
    const noMarketer = await sql(`
      SELECT
        id AS system_id,
        raw->>'order_link' AS order_link,
        customer_name,
        province,
        status,
        status_name,
        GREATEST(cod_amount, total::bigint) AS amount,
        to_char(pancake_created_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI') AS created,
        raw->'marketer'->>'name' AS raw_marketer,
        raw->>'p_utm_campaign' AS utm_campaign
      FROM pancake_order
      WHERE deleted_at IS NULL
        ${commonFilter()}
        AND ${mktFallback} = 'KHÁC'
      ORDER BY pancake_created_at DESC
      LIMIT 300
    `, [from, to])

    // ── SP trong đơn giao TC (status=3) — tổng hợp theo display_id ──────────────
    const productAgg = await sql(`
      SELECT
        item->'variation_info'->>'display_id' AS display_id,
        item->>'name' AS name,
        SUM((item->>'quantity')::int) AS qty_sold,
        COUNT(DISTINCT po.id) AS order_count
      FROM pancake_order po,
        jsonb_array_elements(po.raw->'items') AS item
      WHERE po.deleted_at IS NULL
        AND po.status = 3
        ${commonFilter("po.")}
        AND po.raw->'items' IS NOT NULL
        AND (item->>'quantity') IS NOT NULL
      GROUP BY display_id, name
      ORDER BY qty_sold DESC
    `, [from, to])

    // ── Lấy bảng giá vốn (code → giá, byName) ──────────────────────────────────
    const avg = await computeAvgCost(getPool())

    // 2. SP chưa có giá vốn (không map được qua code lẫn tên)
    const noCost = productAgg.filter((p: any) => {
      const code = p.display_id
      const name = (p.name ?? "").toUpperCase()
      const hasCost = (code && avg.costs[code] != null) || (name && avg.byName[name] != null)
      return !hasCost
    }).map((p: any) => ({
      display_id: p.display_id,
      name: p.name,
      qty_sold: Number(p.qty_sold),
      order_count: Number(p.order_count),
    }))

    // 3. SP có trong bảng giá vốn nhưng chưa liên kết code (byName có, costs không)
    //    = tên SP chính trong bảng nhưng không khớp mkt_product
    const linkedNames = new Set<string>()
    // byName keys mà có code tương ứng → đã link. Suy ra qua so sánh: nếu 1 tên trong byName
    // ứng với code nào đó trong costs cùng giá thì coi như linked. Đơn giản: dựng map code→giá đã có (avg.costs)
    // Ta cần biết tên nào chưa link → load mkt_product names để so.
    const products = await sql(`SELECT name, code FROM mkt_product WHERE active = true`)
    const mktNameSet = new Set(products.map((p: any) => String(p.name).trim().toUpperCase()))
    const unlinkedCost = Object.keys(avg.byName)
      .filter(name => !mktNameSet.has(name))
      .map(name => ({ name, gia_tb: avg.byName[name] }))

    return res.json({
      from, to,
      no_marketer: {
        count: noMarketer.length,
        total_amount: noMarketer.reduce((s: number, r: any) => s + Number(r.amount), 0),
        orders: noMarketer,
      },
      no_cost: {
        count: noCost.length,
        products: noCost,
      },
      unlinked_cost: {
        count: unlinkedCost.length,
        products: unlinkedCost,
      },
    })
  } catch (err: any) {
    console.error("[report/lng-errors]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
