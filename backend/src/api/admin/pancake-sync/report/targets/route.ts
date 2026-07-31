import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * Ke hoach doanh so (target) theo NGAY x NEN TANG.
 *
 * GET  /admin/pancake-sync/report/targets?month=2026-07
 *      -> { month, days: [{ date, vn_fb, vn_tt, vn_sp, my_tt, my_sp }], totals }
 *
 * PUT  /admin/pancake-sync/report/targets
 *      body { month, days: [{ date, vn_fb?, vn_tt?, vn_sp?, my_tt?, my_sp? }] }
 *      Upsert theo (date, market, platform). Chi ghi cac ngay client gui len.
 *
 * amount luu VND cho ca 2 thi truong (MY quy doi san khi nhap) — xem migration
 * Migration20260731000000 de biet ly do.
 */

// Cot UI  ->  (market, platform) trong DB
const FIELDS: Record<string, { market: "VN" | "MY"; platform: string }> = {
  vn_fb: { market: "VN", platform: "facebook" },
  vn_tt: { market: "VN", platform: "tiktok" },
  vn_sp: { market: "VN", platform: "shopee" },
  my_tt: { market: "MY", platform: "tiktok" },
  my_sp: { market: "MY", platform: "shopee" },
}
const FIELD_KEYS = Object.keys(FIELDS)

// month "YYYY-MM" -> ["YYYY-MM-01", ..., cuoi thang]. Dung Date.UTC de tranh
// lech mui gio: new Date("2026-07-01") la UTC, getDate() cua browser/server o
// +07 co the tra ve ngay hom truoc.
function daysOfMonth(month: string): string[] {
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const out: string[] = []
  for (let d = 1; d <= last; d++) {
    out.push(`${month}-${String(d).padStart(2, "0")}`)
  }
  return out
}

function isValidMonth(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s)
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const month = (req.query.month as string) || new Date().toISOString().slice(0, 7)
    if (!isValidMonth(month)) {
      return res.status(400).json({ error: "Invalid month, expected YYYY-MM" })
    }

    const cskhService = req.scope.resolve("cskhAnalysisModule") as any
    const rows = await cskhService.sql(
      `SELECT date::text AS date, market, platform, amount::bigint AS amount
         FROM mkt_revenue_target
        WHERE date >= $1::date AND date < ($1::date + INTERVAL '1 month')`,
      [`${month}-01`]
    )

    // Index theo date -> field key de ghep vao khung ngay day du.
    const byDate = new Map<string, Record<string, number>>()
    for (const r of rows) {
      const key = FIELD_KEYS.find(
        k => FIELDS[k].market === r.market && FIELDS[k].platform === r.platform
      )
      if (!key) continue
      const e = byDate.get(r.date) ?? {}
      e[key] = Number(r.amount)
      byDate.set(r.date, e)
    }

    const days = daysOfMonth(month).map(date => {
      const e = byDate.get(date) ?? {}
      const row: any = { date }
      for (const k of FIELD_KEYS) row[k] = Number(e[k] ?? 0)
      return row
    })

    const totals: any = { vn: 0, my: 0, all: 0 }
    for (const k of FIELD_KEYS) {
      totals[k] = days.reduce((a, d) => a + d[k], 0)
      totals[FIELDS[k].market === "VN" ? "vn" : "my"] += totals[k]
    }
    totals.all = totals.vn + totals.my

    return res.json({ month, days, totals, has_target: rows.length > 0 })
  } catch (err: any) {
    console.error("[Report Targets GET] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}

export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  try {
    const body = (req.body ?? {}) as { month?: string; days?: any[] }
    const { month, days } = body

    if (!isValidMonth(month)) {
      return res.status(400).json({ error: "Invalid month, expected YYYY-MM" })
    }
    if (!Array.isArray(days)) {
      return res.status(400).json({ error: "Missing days[]" })
    }

    const valid = new Set(daysOfMonth(month))
    const auth = (req as any).auth_context
    const updatedBy = String(auth?.actor_id ?? "").slice(0, 120) || null

    // Gom moi cell thanh 1 statement VALUES duy nhat — 31 ngay x 5 nen tang =
    // 155 dong, mot round-trip thay vi 155.
    const values: string[] = []
    const params: any[] = []
    for (const row of days) {
      const date = String(row?.date ?? "")
      if (!valid.has(date)) continue // bo qua ngay ngoai thang dang luu
      for (const k of FIELD_KEYS) {
        if (row[k] == null) continue
        const amount = Math.max(0, Math.round(Number(row[k]) || 0))
        params.push(date, FIELDS[k].market, FIELDS[k].platform, amount, updatedBy)
        const i = params.length
        values.push(`($${i - 4}::date, $${i - 3}, $${i - 2}, $${i - 1}::bigint, $${i})`)
      }
    }

    if (!values.length) {
      return res.json({ ok: true, saved: 0 })
    }

    const cskhService = req.scope.resolve("cskhAnalysisModule") as any
    await cskhService.sql(
      `INSERT INTO mkt_revenue_target (date, market, platform, amount, updated_by)
       VALUES ${values.join(", ")}
       ON CONFLICT (date, market, platform)
       DO UPDATE SET amount = EXCLUDED.amount,
                     updated_by = EXCLUDED.updated_by,
                     updated_at = NOW()`,
      params
    )

    return res.json({ ok: true, saved: values.length })
  } catch (err: any) {
    console.error("[Report Targets PUT] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
