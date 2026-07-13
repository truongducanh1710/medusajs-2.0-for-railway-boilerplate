import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { notifyTelegramByEmail } from "../../../../../lib/notify"
import { resolveUserPerms } from "../../../../middlewares"

function actorId(req: MedusaRequest): string | null {
  const auth = (req as any).auth_context
  return auth?.actor_type === "user" ? auth.actor_id : null
}

async function isManager(req: MedusaRequest): Promise<boolean> {
  const uid = actorId(req)
  if (!uid) return false
  const superEmail = process.env.SUPER_ADMIN_EMAIL
  const userModule = req.scope.resolve(Modules.USER)
  const user = await userModule.retrieveUser(uid, { select: ["email", "metadata"] })
  if (user.email === superEmail) return true
  const perms = resolveUserPerms(user.metadata)
  return perms.includes("page.mkt-tasks.manage")
}

type CustomerInput = { customer_phone: string; customer_name: string; order_ids: string[] }

/**
 * POST /admin/mkt-tasks/cskh-call/bulk
 * Tạo hàng loạt task type=cskh_call từ danh sách khách hàng đã chọn (từ cskh-source).
 * Body: { customers, assignment_mode, assignee_ids?, assignee_map?, deadline?, priority?, notes?, channel_id?, merge_orders }
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const uid = actorId(req)
    if (!uid) return res.status(401).json({ error: "Unauthenticated" })
    if (!(await isManager(req))) return res.status(403).json({ error: "Chỉ manager mới được tạo việc hàng loạt" })

    const body = req.body as any
    const customers: CustomerInput[] = Array.isArray(body.customers) ? body.customers : []
    if (!customers.length) return res.status(400).json({ error: "Danh sách khách hàng trống" })

    const assignmentMode: "manual" | "round_robin" = body.assignment_mode === "manual" ? "manual" : "round_robin"
    const assigneeIds: string[] = Array.isArray(body.assignee_ids) ? body.assignee_ids.filter(Boolean) : []
    const assigneeMap: Record<string, string> = body.assignee_map && typeof body.assignee_map === "object" ? body.assignee_map : {}
    if (assignmentMode === "round_robin" && !assigneeIds.length) {
      return res.status(400).json({ error: "Cần chọn ít nhất 1 nhân viên cho chia đều" })
    }
    if (assignmentMode === "manual") {
      const missing = customers.filter(c => !assigneeMap[c.customer_phone])
      if (missing.length) return res.status(400).json({ error: `Thiếu người phụ trách cho ${missing.length} khách` })
    }

    const validPriority = ["high", "medium", "low"].includes(body.priority) ? body.priority : "medium"
    const deadline = body.deadline ? new Date(body.deadline) : null
    const notes: string | null = body.notes || null
    const channelId: string | null = body.channel_id || null
    const mergeOrders = body.merge_orders !== false // default true
    const productName: string | null = body.product_name || null

    const svc = req.scope.resolve("mktTaskModule") as any
    const userModule = req.scope.resolve(Modules.USER)
    const creator = await userModule.retrieveUser(uid, { select: ["first_name", "last_name", "email"] })
    const creatorName = [creator.first_name, creator.last_name].filter(Boolean).join(" ") || creator.email

    // Chống trùng: task cskh_call active (khác cancelled) đã trỏ order nào trong lô này
    const allOrderIds = customers.flatMap(c => c.order_ids)
    const existingTasks = await svc.listMktTasks(
      { type: "cskh_call" },
      { select: ["id", "pancake_order_id", "status"] }
    )
    const activeOrderIds = new Set(
      existingTasks.filter((t: any) => t.status !== "cancelled" && t.pancake_order_id).map((t: any) => t.pancake_order_id)
    )

    const created: any[] = []
    const skipped: { customer_phone: string; reason: string }[] = []
    let rrIndex = 0

    // Rows đơn vị tạo: mergeOrders → 1 dòng/khách, ngược lại → 1 dòng/đơn
    type Row = { customer_phone: string; customer_name: string; order_id: string; order_ids: string[] }
    const rows: Row[] = []
    for (const c of customers) {
      if (!c.order_ids?.length) continue
      if (mergeOrders) {
        rows.push({ customer_phone: c.customer_phone, customer_name: c.customer_name, order_id: c.order_ids[0], order_ids: c.order_ids })
      } else {
        for (const oid of c.order_ids) {
          rows.push({ customer_phone: c.customer_phone, customer_name: c.customer_name, order_id: oid, order_ids: [oid] })
        }
      }
    }

    // Gom noti theo assignee để gửi 1 email/Telegram tổng hợp thay vì spam từng task
    const notifyByAssignee = new Map<string, { title: string; phone: string }[]>()

    for (const row of rows) {
      if (row.order_ids.some(id => activeOrderIds.has(id))) {
        skipped.push({ customer_phone: row.customer_phone, reason: "already_exists" })
        continue
      }
      const assigneeId = assignmentMode === "manual"
        ? assigneeMap[row.customer_phone]
        : assigneeIds[rrIndex++ % assigneeIds.length]
      if (!assigneeId) {
        skipped.push({ customer_phone: row.customer_phone, reason: "no_assignee" })
        continue
      }

      const title = `Gọi CSKH - ${row.customer_name || "Khách hàng"} - ${row.customer_phone}`
      const task = await svc.createMktTasks({
        title,
        type: "cskh_call",
        assignee_id: assigneeId,
        created_by: uid,
        deadline,
        notes,
        channel_id: channelId,
        status: "todo",
        priority: validPriority,
        tags: ["chao-vang-cskh"],
        comments: [],
        customer_name: row.customer_name || null,
        customer_phone: row.customer_phone,
        pancake_order_id: row.order_id,
        call_stage: "chua_goi",
        product_name: productName,
      })
      created.push(task)
      // Đánh dấu order vừa dùng để tránh trùng trong chính lô này (nhiều dòng cùng order khi mergeOrders=false trên cùng order lặp lại — hiếm nhưng an toàn)
      for (const oid of row.order_ids) activeOrderIds.add(oid)

      if (!notifyByAssignee.has(assigneeId)) notifyByAssignee.set(assigneeId, [])
      notifyByAssignee.get(assigneeId)!.push({ title, phone: row.customer_phone })
    }

    // Noti tổng hợp — best-effort, không chặn response
    const BACKEND_URL = process.env.BACKEND_URL || "https://api.phanviet.vn"
    for (const [assigneeEmail, items] of notifyByAssignee) {
      if (assigneeEmail === creator.email) continue
      const listText = items.map(i => `• ${i.title}`).join("\n")
      try {
        const notifModule = req.scope.resolve(Modules.NOTIFICATION) as any
        await notifModule.createNotifications({
          to: assigneeEmail,
          channel: "email",
          template: "task-notification",
          data: {
            subject: `[CSKH] Bạn được giao ${items.length} khách hàng gọi tư vấn mới`,
            body: `${creatorName} vừa giao ${items.length} việc gọi CSKH cho bạn:\n\n${listText}\n\nXem tại: ${BACKEND_URL}/app/cskh-goi-khach`,
          },
        })
      } catch { /* optional */ }

      const tgText = [
        `📞 <b>Bạn có ${items.length} khách hàng cần gọi tư vấn!</b>`,
        ``,
        listText,
        ``,
        `👤 Giao bởi: ${creatorName}`,
        `🔗 <a href="${BACKEND_URL}/app/cskh-goi-khach">Xem danh sách</a>`,
      ].join("\n")
      notifyTelegramByEmail(userModule, assigneeEmail, tgText).catch(() => {})
    }

    res.json({ created, skipped })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
