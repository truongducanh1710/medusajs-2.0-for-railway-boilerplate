import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool } from "../../../../../lib/db"
import { SALE_ROSTER, QUEUE_ORDER_SQL, phoneKey, groupAttempts, attemptHasNote } from "../../../../../lib/sale-queue"

const MIN = 60_000
// Orders refreshed from POS recently — avoid re-pulling the same order on every page refresh.
const refreshedAt = new Map<string, number>()

/**
 * GET /admin/pancake-sync/call-board/compliance?date=YYYY-MM-DD&seller=<pancakeSellerId>
 *
 * Luật: mỗi cuộc gọi = 1 note. Đối chiếu cuộc gọi ra (tổng đài ITY) với note của đơn cùng SĐT.
 * Lượt gọi (gọi lại trong 10p gộp 1) không có note trong [-5p, +60p] và đã quá 15p → vi phạm.
 *
 * Note của đơn đã rời status 0 KHÔNG được sync thường cập nhật, nên trước khi gắn cờ phải
 * kéo lại đơn từ POS — nếu không sẽ báo oan (kiểm 21/10: 7/9 lượt HADTT có note trên POS).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const q = req.query as Record<string, string>
    const now = Date.now()
    const today = new Date(now + 7 * 3600_000).toISOString().slice(0, 10)
    const date = /^\d{4}-\d{2}-\d{2}$/.test(q.date ?? "") ? q.date : today
    const from = new Date(`${date}T00:00:00+07:00`)
    const to = new Date(`${date}T23:59:59+07:00`)
    const roster = q.seller ? SALE_ROSTER.filter((s) => s.pancakeId === q.seller) : SALE_ROSTER
    const pool = getPool()

    const { rows: calls } = await pool.query(
      `SELECT calldate, extension, COALESCE(NULLIF(billsec::text, ''), '0')::int AS billsec, recording_url,
              RIGHT(regexp_replace(customer_phone, '[^0-9]', '', 'g'), 9) AS k
         FROM ity_cdr_call
        WHERE deleted_at IS NULL AND direction = 'outgoing'
          AND extension = ANY($1) AND calldate BETWEEN $2 AND $3`,
      [roster.map((s) => s.extension), from, to]
    )
    const keys = [...new Set(calls.map((c: any) => c.k).filter(Boolean))]
    const loadOrders = async () => keys.length ? (await pool.query(
      `SELECT po.id, po.status, po.customer_name, po.customer_phone, po.notes, po.pancake_created_at
         FROM pancake_order po
        WHERE ${QUEUE_ORDER_SQL}
          AND po.pancake_created_at BETWEEN $1 AND $2
          AND RIGHT(regexp_replace(po.customer_phone, '[^0-9]', '', 'g'), 9) = ANY($3)`,
      [new Date(from.getTime() - 21 * 24 * 3600_000), to, keys]
    )).rows : []

    const evaluate = (orders: any[]) => {
      const byKey = new Map<string, any[]>()
      for (const o of orders) {
        const k = phoneKey(o.customer_phone)
        byKey.set(k, [...(byKey.get(k) ?? []), o])
      }
      // (extension, order) → calls
      const groups = new Map<string, { ext: string; order: any; calls: { at: number; billsec: number; recording: string | null }[] }>()
      for (const c of calls) {
        const at = new Date(c.calldate).getTime()
        const order = (byKey.get(c.k) ?? [])
          .filter((o) => new Date(o.pancake_created_at).getTime() <= at + 10 * MIN)
          .sort((a, b) => Date.parse(b.pancake_created_at) - Date.parse(a.pancake_created_at))[0]
        if (!order) continue // call to someone without an order (CSKH, supplier…) — not judged
        const gk = `${c.extension}|${order.id}`
        const g = groups.get(gk) ?? { ext: c.extension, order, calls: [] }
        g.calls.push({ at, billsec: Number(c.billsec) || 0, recording: c.recording_url })
        groups.set(gk, g)
      }
      const result: { ext: string; order: any; attempt: any; noted: boolean; settled: boolean; recording: string | null }[] = []
      for (const g of groups.values()) {
        const noteTimes = (Array.isArray(g.order.notes) ? g.order.notes : []).map((n: any) => Number(n.at_ms) || 0)
        for (const a of groupAttempts(g.calls)) {
          const rec = g.calls.filter((c) => c.at >= a.start && c.at <= a.end && c.recording).pop()?.recording ?? null
          result.push({ ext: g.ext, order: g.order, attempt: a, noted: attemptHasNote(a, noteTimes), settled: now - a.end >= 15 * MIN, recording: rec })
        }
      }
      return result
    }

    let orders = await loadOrders()
    let attempts = evaluate(orders)
    // Verify suspected violations on orders whose notes the regular sync no longer refreshes.
    const suspects = [...new Set(attempts
      .filter((a) => !a.noted && a.settled && a.order.status !== 0)
      .map((a) => String(a.order.id)))]
      .filter((id) => (refreshedAt.get(id) ?? 0) < now - 10 * MIN)
      .slice(0, 40)
    if (suspects.length) {
      const sync = req.scope.resolve("pancakeSyncModule") as any
      for (let i = 0; i < suspects.length; i += 4) {
        await Promise.all(suspects.slice(i, i + 4).map(async (id) => {
          try { await sync.refreshOrderFromPos(id); refreshedAt.set(id, now) } catch {}
        }))
      }
      orders = await loadOrders()
      attempts = evaluate(orders)
    }

    const sellers = roster.map((s) => {
      const mine = attempts.filter((a) => a.ext === s.extension && a.settled)
      const violations = mine.filter((a) => !a.noted)
      return {
        id: s.pancakeId,
        name: s.name,
        attempts: mine.length,
        noted: mine.length - violations.length,
        unnoted: violations.length,
        pct_noted: mine.length ? Math.round(((mine.length - violations.length) / mine.length) * 100) : null,
        violations: violations
          .sort((a, b) => b.attempt.start - a.attempt.start)
          .map((a) => ({
            order_id: a.order.id,
            customer_name: a.order.customer_name,
            status: a.order.status,
            at: new Date(a.attempt.start).toISOString(),
            talk_sec: a.attempt.talkSec,
            recording: a.recording,
          })),
      }
    })
    res.json({ date, sellers })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}
