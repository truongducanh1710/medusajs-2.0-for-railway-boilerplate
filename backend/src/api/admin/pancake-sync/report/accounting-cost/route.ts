import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

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

// Map ad_account_id (Facebook) → mã ADS gợi nhớ. Verify từ campaign_name thực tế.
// Dùng để nhập "tiền nạp" theo mã ADS thay vì id dài, và để tính % tiêu thực/NV theo tài khoản.
const AD_ACCOUNTS: { account_id: string; ads_code: string }[] = [
  { account_id: "act_899712815703406", ads_code: "ADS329" },
  { account_id: "act_1336247387117837", ads_code: "ADS343" },
  { account_id: "act_1397084955139677", ads_code: "ADS344" },
  { account_id: "act_1133464788237858", ads_code: "ADS327" },
  { account_id: "act_2801056226892845", ads_code: "ADS346" },
]
const codeToAccount: Record<string, string> = {}
for (const a of AD_ACCOUNTS) codeToAccount[a.ads_code] = a.account_id

async function ensureTable() {
  await sql(`
    CREATE TABLE IF NOT EXISTS mkt_monthly_cost (
      id         SERIAL PRIMARY KEY,
      month      TEXT NOT NULL,               -- 'YYYY-MM'
      kind       TEXT NOT NULL,               -- 'nap' (tiền nạp tài khoản) | 'chung' (chi phí chung)
      ads_code   TEXT,                        -- cho kind='nap': ADS329...
      label      TEXT,                        -- cho kind='chung': NL / ITY / ZALO / thuê...
      amount     BIGINT NOT NULL DEFAULT 0,
      alloc      TEXT NOT NULL DEFAULT 'ty_le', -- 'ty_le' (theo % tiêu ads) | 'deu' (chia đều NV) | 'nv:<CODE>' (gán 1 NV)
      note       TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )
  `)
}

// Danh sách NV MKT THỰC = người có phát sinh chi phí ads trong kỳ (từ mkt_ads_cost).
// Dùng để chia đều chi phí chung (NL...). KHÔNG lấy mọi marketer trong đơn — nhiều tên
// nhiễu (sale/CSKH lọt vào raw.marketer) sẽ làm chia đều sai cho quá nhiều người.
async function getMarketerCodes(from: string, to: string): Promise<string[]> {
  const rows = await sql(`
    SELECT UPPER(TRIM(mkt_name)) AS code, SUM(spend)::bigint AS spend
    FROM mkt_ads_cost
    WHERE deleted_at IS NULL AND date >= $1::date AND date <= $2::date
      AND mkt_name IS NOT NULL AND TRIM(mkt_name) <> '' AND UPPER(TRIM(mkt_name)) <> 'KHÁC'
    GROUP BY UPPER(TRIM(mkt_name))
    HAVING SUM(spend) > 0
  `, [from, to])
  return rows.map(r => r.code).filter(Boolean)
}

// % tiêu thực của mỗi NV trên từng TÀI KHOẢN ads (từ mkt_ads_cost) — để phân bổ tiền nạp.
async function getSpendByAccountNV(from: string, to: string): Promise<Record<string, Record<string, number>>> {
  const rows = await sql(`
    SELECT ad_account_id, UPPER(TRIM(mkt_name)) AS nv, SUM(spend)::bigint AS spend
    FROM mkt_ads_cost
    WHERE deleted_at IS NULL AND date >= $1::date AND date <= $2::date
    GROUP BY ad_account_id, UPPER(TRIM(mkt_name))
  `, [from, to])
  const map: Record<string, Record<string, number>> = {}
  for (const r of rows) {
    const acc = r.ad_account_id || "unknown"
    if (!map[acc]) map[acc] = {}
    map[acc][r.nv || "KHÁC"] = (map[acc][r.nv || "KHÁC"] || 0) + Number(r.spend)
  }
  return map
}

function monthOf(from: string): string {
  return from.slice(0, 7)
}

/**
 * Tính phân bổ CP thực kế toán về từng NV cho kỳ [from,to].
 * Dùng chung bởi GET (trang chi phí) và marketer-lng (cột CP thực).
 * Trả costByNV (code → CP thực) — rỗng nếu tháng chưa nhập khoản nào.
 */
export async function computeAccountingCost(
  from: string,
  to: string
): Promise<{ costByNV: Record<string, number>; items: any[]; nvCodes: string[]; spendByAcc: Record<string, Record<string, number>> }> {
  await ensureTable()
  const month = monthOf(from)
  const items = await sql(
    `SELECT id, month, kind, ads_code, label, amount, alloc, note
     FROM mkt_monthly_cost WHERE deleted_at IS NULL AND month = $1 ORDER BY kind DESC, id ASC`,
    [month]
  )
  const nvCodes = await getMarketerCodes(from, to)
  const spendByAcc = await getSpendByAccountNV(from, to)

  const costByNV: Record<string, number> = {}
  const add = (code: string, amt: number) => { costByNV[code] = (costByNV[code] || 0) + amt }

  for (const it of items) {
    const amount = Number(it.amount)
    if (it.kind === "nap") {
      const acc = it.ads_code ? codeToAccount[it.ads_code] : null
      const spend = acc ? spendByAcc[acc] : null
      if (spend && Object.keys(spend).length) {
        const totalSpend = Object.values(spend).reduce((s, v) => s + v, 0)
        for (const [nv, sp] of Object.entries(spend)) {
          if (nv === "KHÁC") continue
          add(nv, totalSpend > 0 ? amount * (sp / totalSpend) : 0)
        }
      }
    } else {
      if (it.alloc === "deu") {
        const per = nvCodes.length ? amount / nvCodes.length : 0
        for (const nv of nvCodes) add(nv, per)
      } else if (it.alloc?.startsWith("nv:")) {
        add(it.alloc.slice(3).toUpperCase(), amount)
      } else if (it.alloc === "ty_le") {
        const totalByNV: Record<string, number> = {}
        let grand = 0
        for (const acc of Object.values(spendByAcc)) for (const [nv, sp] of Object.entries(acc)) {
          if (nv === "KHÁC") continue
          totalByNV[nv] = (totalByNV[nv] || 0) + sp; grand += sp
        }
        for (const [nv, sp] of Object.entries(totalByNV)) add(nv, grand > 0 ? amount * (sp / grand) : 0)
      }
    }
  }
  // Làm tròn.
  for (const k of Object.keys(costByNV)) costByNV[k] = Math.round(costByNV[k])
  return { costByNV, items, nvCodes, spendByAcc }
}

// GET: trả các khoản chi phí + bảng phân bổ CP thực về từng NV.
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { from, to } = req.query as Record<string, string>
    if (!from || !to) return res.status(400).json({ error: "Thiếu from/to" })

    const { costByNV, items, nvCodes, spendByAcc } = await computeAccountingCost(from, to)
    const rows = Object.entries(costByNV)
      .map(([nv, cp]) => ({ nv, cp_thuc: cp }))
      .sort((a, b) => b.cp_thuc - a.cp_thuc)
    const total = rows.reduce((s, r) => s + r.cp_thuc, 0)

    return res.json({
      month: monthOf(from), items, rows, total,
      ad_accounts: AD_ACCOUNTS,
      marketer_codes: nvCodes,
      spend_by_account: spendByAcc,
    })
  } catch (err: any) {
    console.error("[report/accounting-cost GET]", err.message)
    return res.status(500).json({ error: err.message })
  }
}

// POST: thêm 1 khoản chi phí.
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    await ensureTable()
    const { month, kind, ads_code = null, label = null, amount, alloc = "ty_le", note = "" } = req.body as any
    if (!month || !kind || amount == null) return res.status(400).json({ error: "Thiếu month/kind/amount" })
    const rows = await sql(
      `INSERT INTO mkt_monthly_cost (month, kind, ads_code, label, amount, alloc, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [month, kind, ads_code, label, Math.round(Number(amount)), alloc, note]
    )
    return res.json({ id: rows[0].id })
  } catch (err: any) {
    console.error("[report/accounting-cost POST]", err.message)
    return res.status(500).json({ error: err.message })
  }
}

// PATCH: sửa 1 khoản.
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    await ensureTable()
    const { id, amount, alloc, ads_code, label, note } = req.body as any
    if (!id) return res.status(400).json({ error: "Thiếu id" })
    await sql(
      `UPDATE mkt_monthly_cost SET
         amount = COALESCE($2, amount), alloc = COALESCE($3, alloc),
         ads_code = COALESCE($4, ads_code), label = COALESCE($5, label),
         note = COALESCE($6, note), updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL`,
      [id, amount != null ? Math.round(Number(amount)) : null, alloc ?? null, ads_code ?? null, label ?? null, note ?? null]
    )
    return res.json({ ok: true })
  } catch (err: any) {
    console.error("[report/accounting-cost PATCH]", err.message)
    return res.status(500).json({ error: err.message })
  }
}

// DELETE: xóa mềm 1 khoản (?id=).
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    await ensureTable()
    const { id } = req.query as Record<string, string>
    if (!id) return res.status(400).json({ error: "Thiếu id" })
    await sql(`UPDATE mkt_monthly_cost SET deleted_at = now() WHERE id = $1`, [id])
    return res.json({ ok: true })
  } catch (err: any) {
    console.error("[report/accounting-cost DELETE]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
