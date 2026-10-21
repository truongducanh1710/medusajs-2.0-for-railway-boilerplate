import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool } from "../../../../lib/db"
import { QUEUE_ORDER_SQL, parseCallbackAt, clampWorkHours, cachedReputation, warmReputations } from "../../../../lib/sale-queue"
import { HOAN_TAGS } from "../../../../modules/cskh-analysis/service"

const MIN = 60_000
const HOUR = 3600_000

// Pancake partner timestamps come without a zone and are UTC.
const utc = (s: string | null | undefined) => (s ? Date.parse(/Z|[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z") : NaN)

type Task = { code: string; label: string; base: number; triggerAt: number; dueAt: number }

/**
 * Việc CSKH cho 1 đơn sau khi sale chốt. Luật cố định (thay AI phân tích đã dừng từ 06/2026):
 * mỗi tình huống vận đơn → 1 việc + hạn. Trả null khi đơn đang đi bình thường.
 */
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
      return { code: "vtp_huy", label: "VTP đã hủy vận đơn — kiểm tra, đẩy lại", base: 60, triggerAt: lastUpdAt || statusSince, dueAt: lastUpdAt || statusSince }
    }
    if (ps === "undeliverable" || tags.includes("Giao không thành")) {
      const t = lastUpdAt || statusSince
      if (/chuyển hoàn/i.test(lastText)) {
        return { code: "gkt_sap_hoan", label: "Sắp chuyển hoàn — gọi khách ngay", base: 70, triggerAt: t, dueAt: t }
      }
      return { code: "gkt", label: "Giao không thành — gọi khách", base: 50, triggerAt: t, dueAt: clampWorkHours(t + 2 * HOUR) }
    }
  }
  if (o.status === 9 || (o.status === 2 && ps === "request_received")) {
    if (now - statusSince > 24 * HOUR) {
      return { code: "vtp_chua_lay", label: "VTP chưa lấy hàng >24h — giục VTP", base: 25, triggerAt: statusSince + 24 * HOUR, dueAt: clampWorkHours(statusSince + 24 * HOUR) }
    }
    return null
  }
  if (o.status === 2) {
    const picked = utc(p.picked_up_at)
    const from = Number.isFinite(picked) ? picked : statusSince
    if (now - from > 5 * 24 * HOUR) {
      return { code: "tre_giao", label: "Trễ giao >5 ngày — hỏi VTP / khách", base: 30, triggerAt: from + 5 * 24 * HOUR, dueAt: clampWorkHours(from + 5 * 24 * HOUR) }
    }
    if (ps === "out_for_delivery") {
      const value = Number(o.cod) || 0
      const rep = cachedReputation(o.customer_phone)
      const risky = rep?.available && (rep.flagged || ((rep.success ?? 0) + (rep.fail ?? 0) >= 3 && (rep.return_rate ?? 0) >= 30))
      if (value >= 1_000_000 || risky) {
        const t = lastUpdAt || now
        return { code: "nhac_nhan", label: risky ? "Đang đi giao — khách hay hoàn, gọi nhắc nhận" : "Đang đi giao đơn to — gọi nhắc nhận", base: 20, triggerAt: t, dueAt: t }
      }
    }
    return null
  }
  if (o.status === 1) {
    if (now - statusSince > 24 * HOUR) {
      return { code: "kho_lau", label: "Chờ kho >24h — báo kho", base: 25, triggerAt: statusSince + 24 * HOUR, dueAt: clampWorkHours(statusSince + 24 * HOUR) }
    }
    return null
  }
  if (o.status === 4 && !HOAN_TAGS.some((h) => tags.includes(h))) {
    return { code: "hoan_ly_do", label: "Đang hoàn — gắn lý do hoàn", base: 10, triggerAt: statusSince, dueAt: clampWorkHours(statusSince + 4 * HOUR) }
  }
  return null
}

/**
 * GET /admin/cskh/queue
 * Hàng đợi việc CSKH: đơn đã chốt (chờ kho, chờ VTP, đang giao, đang hoàn) trong 45 ngày,
 * mỗi đơn có việc cần làm + hạn. Mặc định Hà (HADTT) là CSKH cho mọi đơn (chốt 21/10/2026).
 *
 * Một việc coi là "đã xử lý" khi có note sau thời điểm phát sinh (luật mỗi cuộc gọi 1 note);
 * nếu tình huống vẫn còn sau 24h (4h với đơn sắp hoàn) thì việc quay lại hàng đợi.
 */
export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  try {
    const now = Date.now()
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
        dueAt = callbackAt && callbackAt >= lastNote.at - MIN ? callbackAt : clampWorkHours(lastNote.at + recheck)
      }
      const bucket = dueAt < now - 30 * MIN ? "overdue" : dueAt <= now ? "now" : "later"
      const value = r.cod != null ? Number(r.cod) : Number(r.total) || 0
      const overdueH = Math.max(0, (now - dueAt) / HOUR)
      const score = task.base + Math.min(30, Math.round(value / 50_000)) + Math.min(20, Math.round(overdueH * 2))

      const p = r.raw_partner ?? {}
      const updates = (Array.isArray(p.extend_update) ? p.extend_update : []).slice(0, 5)
        .map((u: any) => ({ at: Number.isFinite(utc(u.updated_at)) ? new Date(utc(u.updated_at)).toISOString() : null, text: u.status ?? "" }))
      tasks.push({
        id: r.id,
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
        task: { code: task.code, label: task.label, due_at: new Date(dueAt).toISOString(), handled },
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

    const byCode: Record<string, number> = {}
    for (const t of tasks) if (t.bucket !== "later") byCode[t.task.code] = (byCode[t.task.code] ?? 0) + 1
    res.json({
      summary: {
        due: tasks.filter((t) => t.bucket !== "later").length,
        overdue: tasks.filter((t) => t.bucket === "overdue").length,
        waiting_carrier: tasks.filter((t) => t.bucket === "later").length,
        by_code: byCode,
        ...counts,
      },
      tasks,
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}
