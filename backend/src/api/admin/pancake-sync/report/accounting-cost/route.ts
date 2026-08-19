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
export const AD_ACCOUNTS: { account_id: string; ads_code: string }[] = [
  { account_id: "act_899712815703406", ads_code: "ADS329" },
  { account_id: "act_1336247387117837", ads_code: "ADS343" },
  { account_id: "act_1397084955139677", ads_code: "ADS344" },
  { account_id: "act_1133464788237858", ads_code: "ADS327" },
  { account_id: "act_2801056226892845", ads_code: "ADS346" },
]
export const codeToAccount: Record<string, string> = {}
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
  // Gồm cả người chỉ chạy Google — nếu chỉ lấy từ mkt_ads_cost (FB) thì marketer
  // chạy thuần GG bị bỏ sót khỏi danh sách chia đều chi phí chung.
  const rows = await sql(`
    SELECT code, SUM(spend)::bigint AS spend FROM (
      SELECT UPPER(TRIM(mkt_name)) AS code, spend
      FROM mkt_ads_cost
      WHERE deleted_at IS NULL AND date >= $1::date AND date <= $2::date
        AND mkt_name IS NOT NULL AND TRIM(mkt_name) <> '' AND UPPER(TRIM(mkt_name)) <> 'KHÁC'
      UNION ALL
      SELECT UPPER(TRIM(mkt_name)) AS code, cost AS spend
      FROM mkt_ads_cost_gg
      WHERE deleted_at IS NULL AND date >= $1::date AND date <= $2::date
        AND mkt_name IS NOT NULL AND TRIM(mkt_name) <> '' AND UPPER(TRIM(mkt_name)) <> 'KHÁC'
    ) u
    GROUP BY code
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

// % tiêu Google Ads của mỗi NV (từ mkt_ads_cost_gg) — để phân bổ tiền nạp GG.
// Google không tách theo tài khoản như FB (sheet mỗi marketer chỉ có tổng/ngày),
// nên gom thẳng theo NV.
async function getGgSpendByNV(from: string, to: string): Promise<Record<string, number>> {
  const rows = await sql(`
    SELECT UPPER(TRIM(mkt_name)) AS nv, SUM(cost)::bigint AS spend
    FROM mkt_ads_cost_gg
    WHERE deleted_at IS NULL AND date >= $1::date AND date <= $2::date
    GROUP BY UPPER(TRIM(mkt_name))
    HAVING SUM(cost) > 0
  `, [from, to]).catch(() => [])
  const map: Record<string, number> = {}
  for (const r of rows) map[r.nv || "KHÁC"] = Number(r.spend)
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
): Promise<{
  costByNV: Record<string, number>
  unallocated: number
  unallocatedNotes: string[]
  costByPlatform: Record<string, number>
  items: any[]
  nvCodes: string[]
  spendByAcc: Record<string, Record<string, number>>
  ggSpendByNV: Record<string, number>
}> {
  await ensureTable()
  const month = monthOf(from)
  const items = await sql(
    `SELECT id, month, kind, ads_code, label, amount, alloc, note
     FROM mkt_monthly_cost WHERE deleted_at IS NULL AND month = $1 ORDER BY kind DESC, id ASC`,
    [month]
  )
  const nvCodes = await getMarketerCodes(from, to)
  const spendByAcc = await getSpendByAccountNV(from, to)
  const ggSpendByNV = await getGgSpendByNV(from, to)

  const costByNV: Record<string, number> = {}
  const add = (code: string, amt: number) => { costByNV[code] = (costByNV[code] || 0) + amt }
  // Tiền không quy được về NV nào (camp thiếu mã MKT, mã ADS chưa khai báo...).
  // KHÔNG được vứt đi: giữ riêng ở đây để bảng phân bổ hiện dòng KHÁC và tổng
  // luôn khớp đúng tổng tiền đã nhập.
  let unallocated = 0
  const unallocatedNotes: string[] = []
  const addOther = (amt: number, why: string) => {
    if (amt <= 0) return
    unallocated += amt
    if (why && !unallocatedNotes.includes(why)) unallocatedNotes.push(why)
  }

  // Phân bổ song song theo NỀN TẢNG — cho cột CP thực (KT) ở bảng LNG theo nền tảng.
  // 'nap' (tài khoản FB) → facebook, 'nap_gg' → google; chi phí chung (NL/ITY/ZALO...)
  // không thuộc nền tảng nào nên vào 'chung', bảng nền tảng hiển thị riêng.
  const costByPlatform: Record<string, number> = { facebook: 0, google: 0, chung: 0 }

  for (const it of items) {
    const amount = Number(it.amount)
    if (it.kind === "nap") {
      costByPlatform.facebook += amount
      const acc = it.ads_code ? codeToAccount[it.ads_code] : null
      const spend = acc ? spendByAcc[acc] : null
      const totalSpend = spend ? Object.values(spend).reduce((s, v) => s + v, 0) : 0
      if (totalSpend > 0) {
        // Chia theo % tiêu thực của từng NV trên chính tài khoản này. Phần chi
        // tiêu "KHÁC" (camp chưa gắn mã MKT) vẫn nằm trong mẫu số, nên phần
        // tiền tương ứng phải đi vào KHÁC — trước đây nó bị bỏ qua và biến mất.
        let given = 0
        for (const [nv, sp] of Object.entries(spend!)) {
          if (nv === "KHÁC") continue
          const part = amount * (sp / totalSpend)
          add(nv, part)
          given += part
        }
        addOther(amount - given, `${it.ads_code || "?"}: có chi tiêu chưa gắn mã NV`)
      } else {
        // Mã ADS chưa khai báo trong AD_ACCOUNTS, hoặc tài khoản không phát sinh
        // chi tiêu trong kỳ → không có cơ sở chia. Dồn vào KHÁC kèm ghi chú thay
        // vì im lặng bỏ trọn khoản nạp.
        addOther(amount, `${it.ads_code || "?"}: ${acc ? "không có chi tiêu trong kỳ" : "mã ADS chưa khai báo"}`)
      }
    } else if (it.kind === "nap_gg") {
      // Tiền nạp Google Ads — chia về NV theo % tiêu Google thực trong kỳ.
      costByPlatform.google += amount
      const totalGg = Object.entries(ggSpendByNV)
        .filter(([nv]) => nv !== "KHÁC")
        .reduce((s, [, v]) => s + v, 0)
      if (totalGg > 0) {
        for (const [nv, sp] of Object.entries(ggSpendByNV)) {
          if (nv === "KHÁC") continue
          add(nv, amount * (sp / totalGg))
        }
      } else {
        addOther(amount, "Nạp Google Ads: chưa có chi tiêu GG gắn mã NV trong kỳ")
      }
    } else {
      costByPlatform.chung += amount
      if (it.alloc === "deu") {
        if (nvCodes.length) {
          const per = amount / nvCodes.length
          for (const nv of nvCodes) add(nv, per)
        } else {
          addOther(amount, (it.label || "Chi phí chung") + ": kỳ này chưa có NV nào phát sinh chi tiêu")
        }
      } else if (it.alloc?.startsWith("nv:")) {
        add(it.alloc.slice(3).toUpperCase(), amount)
      } else if (it.alloc === "ty_le") {
        // % tiêu ads = FB + Google, để NV chạy Google cũng gánh phần chi phí chung.
        const totalByNV: Record<string, number> = {}
        let grand = 0
        for (const acc of Object.values(spendByAcc)) for (const [nv, sp] of Object.entries(acc)) {
          if (nv === "KHÁC") continue
          totalByNV[nv] = (totalByNV[nv] || 0) + sp; grand += sp
        }
        for (const [nv, sp] of Object.entries(ggSpendByNV)) {
          if (nv === "KHÁC") continue
          totalByNV[nv] = (totalByNV[nv] || 0) + sp; grand += sp
        }
        if (grand > 0) {
          for (const [nv, sp] of Object.entries(totalByNV)) add(nv, amount * (sp / grand))
        } else {
          addOther(amount, (it.label || "Chi phí chung") + ": chưa có chi tiêu gắn mã NV để chia tỷ lệ")
        }
      } else {
        // alloc lạ (dữ liệu cũ / nhập tay sai) — không rơi vào nhánh nào ở trên.
        addOther(amount, (it.label || "Chi phí chung") + ": cách chia không hợp lệ (" + it.alloc + ")")
      }
    }
  }
  // Làm tròn. Sai số làm tròn của từng NV được dồn nốt vào KHÁC để tổng hiển
  // thị luôn bằng đúng tổng tiền đã nhập, không lệch vài đồng.
  const grandTotal = items.reduce((sum: number, it: any) => sum + Number(it.amount), 0)
  for (const k of Object.keys(costByNV)) costByNV[k] = Math.round(costByNV[k])
  const allocatedRounded = Object.values(costByNV).reduce((sum, v) => sum + v, 0)
  unallocated = grandTotal - allocatedRounded
  for (const k of Object.keys(costByPlatform)) costByPlatform[k] = Math.round(costByPlatform[k])
  return { costByNV, unallocated, unallocatedNotes, costByPlatform, items, nvCodes, spendByAcc, ggSpendByNV }
}

// GET: trả các khoản chi phí + bảng phân bổ CP thực về từng NV.
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { from, to } = req.query as Record<string, string>
    if (!from || !to) return res.status(400).json({ error: "Thiếu from/to" })

    const { costByNV, unallocated, unallocatedNotes, costByPlatform, items, nvCodes, spendByAcc, ggSpendByNV } =
      await computeAccountingCost(from, to)
    const rows = Object.entries(costByNV)
      .map(([nv, cp]) => ({ nv, cp_thuc: cp }))
      .sort((a, b) => b.cp_thuc - a.cp_thuc)
    // Dòng KHÁC luôn ở cuối bảng, và chỉ hiện khi thực sự có tiền chưa quy được
    // về NV — để tổng khớp đúng tổng các khoản đã nhập.
    if (unallocated !== 0) rows.push({ nv: "KHÁC", cp_thuc: unallocated })
    const total = rows.reduce((s, r) => s + r.cp_thuc, 0)

    return res.json({
      month: monthOf(from), items, rows, total,
      unallocated, unallocated_notes: unallocatedNotes,
      cost_by_platform: costByPlatform,
      gg_spend_by_nv: ggSpendByNV,
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
    // kind là TEXT tự do trong DB — chặn ở đây để sai chính tả không tạo ra khoản
    // không bao giờ được phân bổ (computeAccountingCost chỉ hiểu 3 giá trị này).
    if (!["nap", "nap_gg", "chung"].includes(kind)) {
      return res.status(400).json({ error: `kind không hợp lệ: ${kind}` })
    }
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
