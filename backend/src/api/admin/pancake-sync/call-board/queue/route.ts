import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { getPool } from "../../../../../lib/db"
import {
  SALE_ROSTER, QUEUE_ORDER_SQL, parseLandingPackage, phoneKey, groupAttempts,
  attemptHasNote, parseCallbackAt, computeNextAction,
} from "../../../../../lib/sale-queue"

const MIN = 60_000

/**
 * GET /admin/pancake-sync/call-board/queue?seller=<pancakeSellerId|all|none|me>
 *
 * Hàng đợi việc của sale: mọi đơn chưa xử lý xong trong 14 ngày (không lọc theo ngày tạo),
 * sắp theo hạn của "việc tiếp theo". Số lần gọi = max(số note, số lượt gọi tổng đài ITY)
 * vì luật mỗi cuộc gọi phải có 1 note — lệch nhau là dấu hiệu gọi mà không note.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const now = Date.now()
    let seller = String((req.query as any).seller ?? "me")
    let me: (typeof SALE_ROSTER)[number] | undefined
    const actorId = (req as any).auth_context?.actor_id
    if (actorId) {
      const user = await req.scope.resolve(Modules.USER).retrieveUser(actorId, { select: ["email"] }).catch(() => null)
      me = SALE_ROSTER.find((s) => s.adminEmail === user?.email)
    }
    if (seller === "me") seller = me?.pancakeId ?? "all"

    const pool = getPool()
    const { rows } = await pool.query(
      `SELECT po.id, po.status, po.customer_name, po.customer_phone, po.total, po.items, po.notes, po.tags,
              po.pancake_created_at, po.shop_name, po.source, po.marketer_name,
              po.raw->'assigning_seller'->>'id' AS seller_id,
              TRIM(po.raw->'assigning_seller'->>'name') AS seller_name,
              (po.raw->>'cod')::numeric AS cod,
              po.raw->>'note' AS pos_note,
              po.raw->>'duplicated_phone' AS dup_phone,
              COALESCE(po.raw->'shipping_address'->>'commune_id', po.raw->'shipping_address'->>'new_commune_id') AS commune_id,
              po.raw->'shipping_address'->>'full_address' AS full_address
         FROM pancake_order po
        WHERE ${QUEUE_ORDER_SQL}
          AND po.status IN (0, 1, 11)
          AND po.pancake_created_at > now() - interval '14 days'
        ORDER BY po.pancake_created_at`
    )

    // Outgoing calls from sale extensions to these phones since the oldest open order.
    const keys = [...new Set(rows.map((r: any) => phoneKey(r.customer_phone)).filter(Boolean))]
    const oldest = rows.length ? new Date(rows[0].pancake_created_at).getTime() - 10 * MIN : now
    const callsByKey = new Map<string, { at: number; billsec: number; ext: string; recording: string | null }[]>()
    if (keys.length) {
      const { rows: calls } = await pool.query(
        `SELECT calldate, extension, COALESCE(NULLIF(billsec::text, ''), '0')::int AS billsec, recording_url,
                RIGHT(regexp_replace(customer_phone, '[^0-9]', '', 'g'), 9) AS k
           FROM ity_cdr_call
          WHERE deleted_at IS NULL AND direction = 'outgoing'
            AND extension = ANY($1) AND calldate >= $2
            AND RIGHT(regexp_replace(customer_phone, '[^0-9]', '', 'g'), 9) = ANY($3)`,
        [SALE_ROSTER.map((s) => s.extension), new Date(oldest), keys]
      )
      for (const c of calls) {
        const list = callsByKey.get(c.k) ?? []
        list.push({ at: new Date(c.calldate).getTime(), billsec: Number(c.billsec) || 0, ext: c.extension, recording: c.recording_url })
        callsByKey.set(c.k, list)
      }
    }

    const queue: any[] = []
    const waiting: any[] = []
    for (const r of rows) {
      const createdAt = new Date(r.pancake_created_at).getTime()
      const tags: string[] = (Array.isArray(r.tags) ? r.tags : []).map((t: any) => String(t?.name ?? "").trim())
      const items = Array.isArray(r.items) ? r.items : []
      const base = {
        id: r.id,
        status: r.status,
        customer_name: r.customer_name,
        customer_phone: r.customer_phone,
        total: Number(r.total) || 0,
        cod: r.cod == null ? null : Number(r.cod),
        product_summary: items.map((i: any) => `${i.name} x${i.qty}`).join(", "),
        created_at: r.pancake_created_at,
        seller_id: r.seller_id ?? null,
        seller_name: r.seller_name || null,
        shop_name: r.shop_name,
        marketer_name: r.marketer_name,
        tags,
      }
      if (seller === "none" ? r.seller_id : seller !== "all" && r.seller_id !== seller) continue
      if (r.status !== 0) {
        waiting.push({ ...base, hours_open: Math.floor((now - createdAt) / 3_600_000) })
        continue
      }

      const notes = (Array.isArray(r.notes) ? r.notes : [])
        .map((n: any) => ({ message: String(n.message ?? ""), by: String(n.by ?? "").trim(), at: Number(n.at_ms) || 0 }))
        .sort((a: any, b: any) => a.at - b.at)
      const noteTimes = notes.map((n: any) => n.at)
      const calls = (callsByKey.get(phoneKey(r.customer_phone)) ?? []).filter((c) => c.at >= createdAt - 10 * MIN)
      const attempts = groupAttempts(calls)
      let unnoted = 0
      let awaiting = false
      for (const a of attempts) {
        if (attemptHasNote(a, noteTimes)) continue
        if (now - a.end < 15 * MIN) awaiting = true
        else unnoted++
      }
      const lastNote = notes[notes.length - 1]
      const lastCall = attempts[attempts.length - 1]
      const lastTouchAt = Math.max(lastNote?.at ?? 0, lastCall?.end ?? 0) || null
      const attemptCount = Math.max(notes.length, attempts.length)
      const next = computeNextAction({
        createdAt,
        attempts: attemptCount,
        lastTouchAt,
        callbackAt: lastNote ? parseCallbackAt(lastNote.message, lastNote.at) : null,
        customerDeclined: tags.some((t) => /khách không đặt/i.test(t)),
        now,
      })
      const bucket = next.code === "cancel" ? "cancel"
        : next.dueAt < now - 30 * MIN ? "overdue"
        : next.dueAt <= now ? "now"
        : "later"

      const pkg = parseLandingPackage(r.pos_note)
      queue.push({
        ...base,
        notes: notes.slice(-6),
        note_count: notes.length,
        call_attempts: attempts.length,
        attempts: attemptCount,
        last_touch_at: lastTouchAt ? new Date(lastTouchAt).toISOString() : null,
        calls: attempts.slice(-6).map((a) => ({
          at: new Date(a.start).toISOString(),
          talk_sec: a.talkSec,
          noted: attemptHasNote(a, noteTimes),
        })),
        next: { ...next, dueAt: new Date(next.dueAt).toISOString() },
        bucket,
        unnoted,
        awaiting,
        pkg,
        flags: {
          pkg_mismatch: !!(pkg?.price && r.cod != null && Number(r.cod) !== pkg.price),
          no_commune: !r.commune_id,
          dup_phone: r.dup_phone === "true",
        },
      })
    }

    // Overdue: newest orders first — a week-old KNM backlog must not bury today's fresh orders,
    // which convert far better. Everything else: earliest due first.
    const order = { overdue: 0, now: 1, later: 2, cancel: 3 } as Record<string, number>
    queue.sort((a, b) => order[a.bucket] - order[b.bucket]
      || (a.bucket === "overdue"
        ? Date.parse(b.created_at) - Date.parse(a.created_at)
        : Date.parse(a.next.dueAt) - Date.parse(b.next.dueAt)))

    res.json({
      seller,
      me: me ? { id: me.pancakeId, name: me.name } : null,
      sellers: SALE_ROSTER.map((s) => ({ id: s.pancakeId, name: s.name })),
      summary: {
        total: queue.length,
        now: queue.filter((o) => o.bucket === "now").length,
        overdue: queue.filter((o) => o.bucket === "overdue").length,
        callback: queue.filter((o) => o.next.code === "callback").length,
        cancel: queue.filter((o) => o.bucket === "cancel").length,
        unnoted: queue.reduce((s, o) => s + o.unnoted, 0),
        waiting: waiting.length,
      },
      queue,
      waiting,
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}
