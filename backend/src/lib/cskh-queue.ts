// CSKH work after the sale confirmed an order: rule-based tasks (replacing the AI analysis
// that stopped in 06/2026) and the per-day call list ("đầu ngày biết gọi đơn nào, cuối ngày
// biết đã gọi hết chưa"). Hà (HADTT) is the default CSKH for every order (decision 21/10/2026).

import { getPool } from "./db"
import { QUEUE_ORDER_SQL, parseCallbackAt, clampWorkHours, cachedReputation, warmReputations } from "./sale-queue"
import { HOAN_TAGS } from "../modules/cskh-analysis/service"

const MIN = 60_000
const HOUR = 3600_000
const VN_OFFSET = 7 * HOUR

// CSKH shift 08:30–17:00. New tasks after 16:30 belong to tomorrow's list.
export const CSKH_START_MIN = 8 * 60 + 30
export const CSKH_END_MIN = 17 * 60
const LIST_CUTOFF_MIN = 16 * 60 + 30
// Fixed CSKH blocks for Hà, who also sells (decision 21/10/2026): failed deliveries saved
// within 2h keep 78% of orders vs 57% after 24h, so CSKH cannot wait for the next morning.
export const CSKH_BLOCKS = [
  { start: 8 * 60 + 30, end: 9 * 60 + 30, label: "8:30–9:30 · dọn đơn giao thất bại qua đêm" },
  { start: 11 * 60, end: 11 * 60 + 30, label: "11:00–11:30 · đơn VTP báo buổi sáng" },
  { start: 15 * 60, end: 16 * 60, label: "15:00–16:00 · đơn VTP báo trong ngày" },
]

const cskhClamp = (ms: number) => clampWorkHours(ms, CSKH_START_MIN, CSKH_END_MIN)
export const vnMinuteOfDay = (ms: number) => { const d = new Date(ms + VN_OFFSET); return d.getUTCHours() * 60 + d.getUTCMinutes() }
export const vnDay = (ms: number) => new Date(ms + VN_OFFSET).toISOString().slice(0, 10)

export function currentBlock(now: number) {
  const m = vnMinuteOfDay(now)
  const active = CSKH_BLOCKS.find((b) => m >= b.start && m < b.end) ?? null
  const next = CSKH_BLOCKS.find((b) => b.start > m) ?? null
  return { active, next }
}

// Pancake partner timestamps come without a zone and are UTC.
const utc = (s: string | null | undefined) => (s ? Date.parse(/Z|[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z") : NaN)

type Task = { code: string; label: string; base: number; triggerAt: number; dueAt: number }

/** One task per order situation; null while the order is moving normally. */
function taskFor(o: any, now: number): Task | null {
  const p = o.raw_partner ?? {}
  const ps = p.partner_status ?? null
  const lastUpd = (Array.isArray(p.extend_update) ? p.extend_update[0] : null) ?? null
  const lastUpdAt = utc(lastUpd?.updated_at)
  const lastText = String(lastUpd?.status ?? "")
  const created = new Date(o.pancake_created_at).getTime()
  const statusSince = o.status_since ? new Date(o.status_since).getTime() : created
  const tags: string[] = o.tag_names

  if (o.status === 2 || o.status === 9) {
    if (ps === "cancelled") {
      const t = lastUpdAt || statusSince
      return { code: "vtp_huy", label: "VTP đã hủy vận đơn — kiểm tra, đẩy lại", base: 60, triggerAt: t, dueAt: cskhClamp(t) }
    }
    if (ps === "undeliverable" || tags.includes("Giao không thành")) {
      const t = lastUpdAt || statusSince
      if (/chuyển hoàn/i.test(lastText)) {
        return { code: "gkt_sap_hoan", label: "Sắp chuyển hoàn — gọi khách ngay", base: 70, triggerAt: t, dueAt: cskhClamp(t) }
      }
      // Rescue within 2 working hours: 78% kept vs 57% when called after 24h (21/10 audit).
      return { code: "gkt", label: "Giao không thành — gọi cứu trong 2h", base: 50, triggerAt: t, dueAt: cskhClamp(cskhClamp(t) + 2 * HOUR) }
    }
  }
  if (o.status === 9 || (o.status === 2 && ps === "request_received")) {
    if (now - statusSince > 24 * HOUR) {
      return { code: "vtp_chua_lay", label: "VTP chưa lấy hàng >24h — giục VTP", base: 25, triggerAt: statusSince + 24 * HOUR, dueAt: cskhClamp(statusSince + 24 * HOUR) }
    }
    return null
  }
  if (o.status === 2) {
    const picked = utc(p.picked_up_at)
    const from = Number.isFinite(picked) ? picked : statusSince
    if (now - from > 5 * 24 * HOUR) {
      return { code: "tre_giao", label: "Trễ giao >5 ngày — hỏi VTP / khách", base: 30, triggerAt: from + 5 * 24 * HOUR, dueAt: cskhClamp(from + 5 * 24 * HOUR) }
    }
    if (ps === "out_for_delivery") {
      const value = Number(o.cod) || 0
      const rep = cachedReputation(o.customer_phone)
      const risky = rep?.available && (rep.flagged || ((rep.success ?? 0) + (rep.fail ?? 0) >= 3 && (rep.return_rate ?? 0) >= 30))
      if (value >= 1_000_000 || risky) {
        const t = lastUpdAt || now
        return { code: "nhac_nhan", label: risky ? "Đang đi giao — khách hay hoàn, gọi nhắc nhận" : "Đang đi giao đơn to — gọi nhắc nhận", base: 20, triggerAt: t, dueAt: cskhClamp(t) }
      }
    }
    return null
  }
  if (o.status === 1) {
    if (now - statusSince > 24 * HOUR) {
      return { code: "kho_lau", label: "Chờ kho >24h — báo kho", base: 25, triggerAt: statusSince + 24 * HOUR, dueAt: cskhClamp(statusSince + 24 * HOUR) }
    }
    return null
  }
  if (o.status === 4 && !HOAN_TAGS.some((h) => tags.includes(h))) {
    return { code: "hoan_ly_do", label: "Đang hoàn — gắn lý do hoàn", base: 10, triggerAt: statusSince, dueAt: cskhClamp(statusSince + 4 * HOUR) }
  }
  return null
}

/**
 * Every order after confirmation (chờ kho, chờ VTP, đang giao, đang hoàn; 45 days) with its
 * CSKH task. A task counts as handled when a note lands after it started (one note per call);
 * if the situation is still there after 24h (4h for "sắp chuyển hoàn") it comes back.
 */
export async function computeCskhTasks(now: number) {
  const { rows } = await getPool().query(
    `SELECT po.id, po.status, po.status_name, po.customer_name, po.customer_phone, po.total, po.items,
            po.notes, po.tags, po.pancake_created_at, po.synced_at, po.province,
            TRIM(po.raw->'assigning_seller'->>'name') AS seller_name,
            (po.raw->>'cod')::numeric AS cod,
            po.raw->'partner' AS raw_partner,
            po.raw->>'tracking_link' AS tracking_link,
            po.tracking_code,
            (SELECT MAX((h->>'changed_at')::timestamptz) FROM jsonb_array_elements(COALESCE(po.status_history, '[]'::jsonb)) h
              WHERE (h->>'status')::int = po.status) AS status_since
       FROM pancake_order po
      WHERE ${QUEUE_ORDER_SQL}
        AND po.status IN (1, 9, 2, 4)
        AND po.pancake_created_at > now() - interval '45 days'`
  )

  // Reputation only matters for "nhắc nhận" (out for delivery) — warm just those phones.
  await warmReputations(rows
    .filter((r: any) => r.status === 2 && r.raw_partner?.partner_status === "out_for_delivery")
    .map((r: any) => r.customer_phone), 5000)

  const tasks: any[] = []
  const counts: Record<string, number> = { cho_kho: 0, cho_vtp: 0, dang_giao: 0, dang_hoan: 0 }
  for (const r of rows) {
    counts[r.status === 1 ? "cho_kho" : r.status === 9 ? "cho_vtp" : r.status === 2 ? "dang_giao" : "dang_hoan"]++
    const tagNames: string[] = (Array.isArray(r.tags) ? r.tags : []).map((t: any) => String(t?.name ?? "").trim())
    const task = taskFor({ ...r, tag_names: tagNames }, now)
    if (!task) continue

    const notes = (Array.isArray(r.notes) ? r.notes : [])
      .map((n: any) => ({ message: String(n.message ?? ""), by: String(n.by ?? "").trim(), at: Number(n.at_ms) || 0 }))
      .sort((a: any, b: any) => a.at - b.at)
    const lastNote = notes[notes.length - 1]
    const callbackAt = lastNote ? parseCallbackAt(lastNote.message, lastNote.at) : null
    let dueAt = task.dueAt
    let handled = false
    if (lastNote && lastNote.at >= task.triggerAt) {
      handled = true
      const recheck = task.code === "gkt_sap_hoan" ? 4 * HOUR : 24 * HOUR
      dueAt = callbackAt && callbackAt >= lastNote.at - MIN ? callbackAt : cskhClamp(lastNote.at + recheck)
    }
    const bucket = dueAt < now - 30 * MIN ? "overdue" : dueAt <= now ? "now" : "later"
    const value = r.cod != null ? Number(r.cod) : Number(r.total) || 0
    const overdueH = Math.max(0, (now - dueAt) / HOUR)
    const score = task.base + Math.min(30, Math.round(value / 50_000)) + Math.min(20, Math.round(overdueH * 2))

    const p = r.raw_partner ?? {}
    const updates = (Array.isArray(p.extend_update) ? p.extend_update : []).slice(0, 5)
      .map((u: any) => ({ at: Number.isFinite(utc(u.updated_at)) ? new Date(utc(u.updated_at)).toISOString() : null, text: u.status ?? "" }))
    tasks.push({
      id: String(r.id),
      status: r.status,
      status_name: r.status_name,
      customer_name: r.customer_name,
      customer_phone: r.customer_phone,
      province: r.province,
      seller_name: r.seller_name,
      cod: value,
      product_summary: (Array.isArray(r.items) ? r.items : []).map((i: any) => `${i.name} x${i.qty}`).join(", "),
      created_at: r.pancake_created_at,
      synced_at: r.synced_at,
      tags: tagNames,
      task: { code: task.code, label: task.label, due_at: new Date(dueAt).toISOString(), trigger_at: new Date(task.triggerAt).toISOString(), handled },
      bucket,
      score,
      notes: notes.slice(-5),
      carrier: {
        partner_status: p.partner_status ?? null,
        delivery_name: p.delivery_name ?? null,
        delivery_tel: p.delivery_tel ?? null,
        count_of_delivery: p.count_of_delivery ?? null,
        picked_up_at: Number.isFinite(utc(p.picked_up_at)) ? new Date(utc(p.picked_up_at)).toISOString() : null,
        tracking_code: r.tracking_code || p.extend_code || null,
        tracking_link: r.tracking_link || null,
        updates,
      },
    })
  }

  const rank = { overdue: 0, now: 1, later: 2 } as Record<string, number>
  tasks.sort((a, b) => rank[a.bucket] - rank[b.bucket]
    || (a.bucket === "later" ? Date.parse(a.task.due_at) - Date.parse(b.task.due_at) : b.score - a.score))
  return { tasks, counts }
}

// ---- Daily call list ----

let tableReady = false
async function ensureTable() {
  if (tableReady) return
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS cskh_daily_task (
      day DATE NOT NULL,
      order_id TEXT NOT NULL,
      task_code TEXT NOT NULL,
      task_label TEXT NOT NULL,
      customer_name TEXT,
      customer_phone TEXT,
      cod NUMERIC,
      trigger_at TIMESTAMPTZ,
      added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      carried_from DATE,
      status TEXT NOT NULL DEFAULT 'pending',
      done_at TIMESTAMPTZ,
      done_note TEXT,
      reopened INT NOT NULL DEFAULT 0,
      PRIMARY KEY (day, order_id)
    )`)
  tableReady = true
}

/**
 * Keep today's list in step with the live tasks:
 *  - 08:30–16:30: every due task joins today's list (yesterday's leftovers come in naturally
 *    because they are still due; they are labelled with the day they were first listed).
 *  - pending → done when the order gets a note after it joined the list (web or POS).
 *  - pending → resolved when the order no longer has any task (VTP delivered, etc.).
 *  - done → pending again when the carrier reports a new problem after it was done
 *    (e.g. "đã báo VTP" and VTP fails again).
 */
export async function syncDailyList(tasks: any[], now: number) {
  await ensureTable()
  const day = vnDay(now)
  const m = vnMinuteOfDay(now)
  if (m < CSKH_START_MIN) return
  const pool = getPool()

  if (m < LIST_CUTOFF_MIN) {
    const due = tasks.filter((t) => t.bucket !== "later")
    for (const t of due) {
      await pool.query(
        `INSERT INTO cskh_daily_task (day, order_id, task_code, task_label, customer_name, customer_phone, cod, trigger_at, carried_from)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
           (SELECT MIN(day) FROM cskh_daily_task p WHERE p.order_id = $2 AND p.day < $1 AND p.status = 'pending'
              AND p.day >= ($1::date - 7)))
         ON CONFLICT (day, order_id) DO UPDATE SET
           task_code = EXCLUDED.task_code, task_label = EXCLUDED.task_label, cod = EXCLUDED.cod,
           trigger_at = EXCLUDED.trigger_at,
           status = CASE WHEN cskh_daily_task.status <> 'pending' AND EXCLUDED.trigger_at > cskh_daily_task.done_at
                         THEN 'pending' ELSE cskh_daily_task.status END,
           reopened = cskh_daily_task.reopened + CASE WHEN cskh_daily_task.status <> 'pending' AND EXCLUDED.trigger_at > cskh_daily_task.done_at THEN 1 ELSE 0 END,
           done_at = CASE WHEN cskh_daily_task.status <> 'pending' AND EXCLUDED.trigger_at > cskh_daily_task.done_at
                          THEN NULL ELSE cskh_daily_task.done_at END`,
        [day, t.id, t.task.code, t.task.label, t.customer_name, t.customer_phone, t.cod, t.task.trigger_at]
      )
    }
  }

  // Close today's pending rows: a note after joining → done; no task any more → resolved.
  const live = new Set(tasks.map((t) => t.id))
  const { rows } = await pool.query(
    `SELECT d.order_id, d.added_at, d.trigger_at, po.notes
       FROM cskh_daily_task d LEFT JOIN pancake_order po ON po.id = d.order_id
      WHERE d.day = $1 AND d.status = 'pending'`,
    [day]
  )
  for (const r of rows) {
    const since = Math.min(new Date(r.added_at).getTime(), r.trigger_at ? new Date(r.trigger_at).getTime() : Infinity)
    const note = (Array.isArray(r.notes) ? r.notes : [])
      .map((n: any) => ({ at: Number(n.at_ms) || 0, message: String(n.message ?? "") }))
      .filter((n: any) => n.at >= since && vnDay(n.at) === day)
      .sort((a: any, b: any) => a.at - b.at)[0]
    if (note) {
      await pool.query(
        `UPDATE cskh_daily_task SET status = 'done', done_at = $3, done_note = $4 WHERE day = $1 AND order_id = $2`,
        [day, r.order_id, new Date(note.at), note.message.slice(0, 300)]
      )
    } else if (!live.has(String(r.order_id))) {
      await pool.query(
        `UPDATE cskh_daily_task SET status = 'resolved', done_at = now(), done_note = 'Hết việc (VTP đã cập nhật / đơn đã đổi trạng thái)' WHERE day = $1 AND order_id = $2`,
        [day, r.order_id]
      )
    }
  }
}

export async function getDailyList(day: string) {
  await ensureTable()
  const { rows } = await getPool().query(
    `SELECT order_id, task_code, task_label, customer_name, customer_phone, cod, trigger_at, added_at,
            carried_from, status, done_at, done_note, reopened
       FROM cskh_daily_task WHERE day = $1
      ORDER BY (status = 'pending') DESC, added_at`,
    [day]
  )
  const summary = {
    total: rows.length,
    done: rows.filter((r: any) => r.status === "done").length,
    resolved: rows.filter((r: any) => r.status === "resolved").length,
    pending: rows.filter((r: any) => r.status === "pending").length,
    carried: rows.filter((r: any) => r.carried_from).length,
  }
  return { day, summary, rows }
}
