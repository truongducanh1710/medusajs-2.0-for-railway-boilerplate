import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { Pool } from "pg"
import { notifyTelegramByEmail } from "../../../../lib/notify"
import { resolveUserPerms } from "../../../middlewares"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

function actorId(req: MedusaRequest): string | null {
  const auth = (req as any).auth_context
  return auth?.actor_type === "user" ? auth.actor_id : null
}

async function actorEmail(req: MedusaRequest): Promise<string | null> {
  const uid = actorId(req)
  if (!uid) return null
  const userModule = req.scope.resolve(Modules.USER)
  const user = await userModule.retrieveUser(uid, { select: ["email"] })
  return user?.email ?? null
}

function normalizeEmail(value: any): string {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

function isPersonalTask(task: any, email: string): boolean {
  const assignee = normalizeEmail(task.assignee_id)
  return !!assignee && assignee === normalizeEmail(task.created_by) && assignee === normalizeEmail(email)
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

async function getManagerEmails(req: MedusaRequest): Promise<string[]> {
  const superEmail = process.env.SUPER_ADMIN_EMAIL
  const userModule = req.scope.resolve(Modules.USER)
  const allUsers = await userModule.listUsers({}, { select: ["email", "metadata"] })
  const managers = allUsers.filter((u: any) => {
    if (u.email === superEmail) return true
    const perms = resolveUserPerms(u.metadata)
    return perms.includes("page.mkt-tasks.manage")
  })
  return managers.map((u: any) => u.email).filter(Boolean)
}

async function sendTaskEmail(req: MedusaRequest, opts: {
  to: string | string[]
  subject: string
  body: string
}) {
  try {
    const notifModule = req.scope.resolve(Modules.NOTIFICATION) as any
    const toList = Array.isArray(opts.to) ? opts.to : [opts.to]
    await Promise.all(toList.map((email: string) =>
      notifModule.createNotifications({
        to: email,
        channel: "email",
        template: "task-notification",
        data: { subject: opts.subject, body: opts.body },
      })
    ))
  } catch {
    // Notification module optional — don't break if not configured
  }
}

const STATUS_LABEL: Record<string, string> = {
  todo: "Chờ làm",
  in_progress: "Đang làm",
  pending_review: "Chờ duyệt",
  done: "Hoàn thành",
  cancelled: "Đã hủy",
  missed: "Bỏ lỡ",
}
const PRIORITY_LABEL: Record<string, string> = { high: "Cao", medium: "Vừa", low: "Thấp" }
const PURCHASE_STAGE_LABEL: Record<string, string> = {
  cho_sep_duyet: "Chờ sếp duyệt",
  sep_da_duyet: "Sếp đã duyệt",
  dat_coc: "Đặt cọc",
  ncc_chuan_bi: "NCC chuẩn bị hàng",
  cho_thanh_toan_70: "Đang chờ thanh toán 70%",
  da_thanh_toan: "Đã thanh toán",
  cho_giao_kho_trung: "Chờ giao hàng tới kho Trung",
  luu_kho_trung: "Lưu kho Trung",
  xu_ly_hai_quan: "Xử lý thủ tục hải quan",
  van_chuyen_quoc_te: "Vận chuyển Quốc Tế",
  cho_giao_kho_hn: "Chờ giao tới kho HN",
  luu_kho_ha_noi: "Lưu kho Hà Nội",
  da_nhan_hang: "Đã nhận hàng",
}
const CALL_STAGE_LABEL: Record<string, string> = {
  chua_goi: "Chưa gọi",
  da_goi_hai_long: "Đã gọi - Hài lòng",
  da_goi_co_gop_y: "Đã gọi - Có góp ý",
  khong_nghe_may: "Không nghe máy",
  hen_goi_lai: "Hẹn gọi lại",
  tu_choi: "Từ chối nghe tư vấn",
}
// Giai đoạn gọi coi như đã có kết quả cuộc gọi → auto set status=done
const CALL_STAGE_AUTO_DONE = new Set(["da_goi_hai_long", "da_goi_co_gop_y"])

// GET /admin/mkt-tasks/:id
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await actorEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const { id } = req.params

    const [task] = await svc.listMktTasks({ id })
    if (!task) return res.status(404).json({ error: "Không tìm thấy task" })

    const manager = await isManager(req)
    if (!manager && normalizeEmail(task.assignee_id) !== normalizeEmail(email)) {
      return res.status(403).json({ error: "Không có quyền" })
    }

    // CSKH gọi tư vấn: đính kèm đơn Pancake gốc (những field đã có sẵn trong DB,
    // KHÔNG có địa chỉ chi tiết — Pancake chỉ lưu tỉnh/thành trong pancake_order)
    let source_order: any = null
    if (task.pancake_order_id) {
      const { rows } = await getPool().query(
        `SELECT id, status_name, customer_name, customer_phone, total, cod_amount,
                tracking_code, province, items, sale_name, pancake_created_at
         FROM pancake_order WHERE id = $1`,
        [task.pancake_order_id]
      ).catch(() => ({ rows: [] }))
      source_order = rows[0] || null
    }

    res.json({ task, source_order })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

// PATCH /admin/mkt-tasks/:id
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await actorEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const { id } = req.params

    const [task] = await svc.listMktTasks({ id })
    if (!task) return res.status(404).json({ error: "Không tìm thấy task" })

    const manager = await isManager(req)
    if (!manager && normalizeEmail(task.assignee_id) !== normalizeEmail(email)) {
      return res.status(403).json({ error: "Không có quyền" })
    }
    const personal = isPersonalTask(task, email)

    const body = req.body as any
    const update: Record<string, any> = {}

    if (manager || personal) {
      if (body.title !== undefined) update.title = body.title
      if (body.notes !== undefined) update.notes = body.notes
      if (body.deadline !== undefined) update.deadline = body.deadline ? new Date(body.deadline) : null
      if (body.priority !== undefined) {
        if (!["high", "medium", "low"].includes(body.priority)) return res.status(400).json({ error: "Priority không hợp lệ" })
        update.priority = body.priority
      }
      if (body.tags !== undefined) {
        if (!Array.isArray(body.tags)) return res.status(400).json({ error: "Tags phải là mảng" })
        update.tags = body.tags.filter((t: any) => typeof t === "string" && t.trim()).slice(0, 10)
      }
    }
    if (manager) {
      if (body.assignee_id !== undefined) update.assignee_id = normalizeEmail(body.assignee_id)
      if (body.channel_id !== undefined) update.channel_id = body.channel_id
      if (body.output !== undefined) update.output = body.output || null
      if (body.frequency !== undefined) {
        if (!["once", "daily", "weekly", "monthly"].includes(body.frequency)) return res.status(400).json({ error: "Frequency không hợp lệ" })
        update.frequency = body.frequency
      }
    }
    if (body.planned_for !== undefined) update.planned_for = body.planned_for ? new Date(body.planned_for) : null
    if (body.personal_order !== undefined) {
      const nextOrder = body.personal_order === null ? null : Number(body.personal_order)
      if (nextOrder !== null && !Number.isFinite(nextOrder)) return res.status(400).json({ error: "personal_order không hợp lệ" })
      update.personal_order = nextOrder
    }

    if (body.status !== undefined) {
      const validAll = ["todo", "in_progress", "pending_review", "done", "cancelled", "missed"]
      if (!validAll.includes(body.status)) return res.status(400).json({ error: "Status không hợp lệ" })
      // pending_review chỉ cho task once; chỉ assignee mới được submit; manager duyệt/từ chối
      if (body.status === "pending_review") {
        if (personal) return res.status(400).json({ error: "Task cá nhân không cần gửi duyệt" })
        if (task.frequency !== "once") return res.status(400).json({ error: "Chỉ task 1 lần mới cần duyệt" })
        if (manager) return res.status(400).json({ error: "Manager không cần submit duyệt" })
      }
      if ((body.status === "done" || body.status === "cancelled") && task.status === "pending_review" && !manager && !personal) {
        return res.status(403).json({ error: "Chỉ manager mới có thể duyệt hoặc từ chối" })
      }
      update.status = body.status
    }

    if (body.result !== undefined) update.result = body.result || null

    // Mua hàng: liên kết lô nhập giá vốn — assignee (NV mua) tự gắn sau khi tạo lô
    if (body.import_lot_id !== undefined) update.import_lot_id = body.import_lot_id || null

    // Mua hàng: giai đoạn quy trình riêng. Giai đoạn cuối "da_nhan_hang" → auto set status=done.
    if (body.purchase_stage !== undefined) {
      update.purchase_stage = body.purchase_stage || null
      if (body.purchase_stage === "da_nhan_hang" && body.status === undefined && task.status !== "done") {
        update.status = "done"
      }
    }

    // CSKH gọi tư vấn: giai đoạn cuộc gọi. Có kết quả (hài lòng/góp ý) → auto set status=done.
    if (body.call_stage !== undefined) {
      update.call_stage = body.call_stage || null
      const isProcessed = body.call_stage && body.call_stage !== "chua_goi"
      update.called_at = isProcessed ? new Date().toISOString() : null
      if (isProcessed && !task.first_called_at) update.first_called_at = update.called_at
      if (CALL_STAGE_AUTO_DONE.has(body.call_stage) && body.status === undefined && task.status !== "done") {
        update.status = "done"
      }
    }
    if (body.customer_name !== undefined) update.customer_name = body.customer_name || null
    if (body.customer_phone !== undefined) update.customer_phone = body.customer_phone || null

    if (body.checklist !== undefined) {
      if (body.checklist !== null && !Array.isArray(body.checklist)) {
        return res.status(400).json({ error: "Checklist phải là mảng" })
      }
      if (Array.isArray(body.checklist) && body.checklist.length > 30) {
        return res.status(400).json({ error: "Checklist tối đa 30 mục" })
      }
      update.checklist = body.checklist === null ? null : body.checklist
        .filter((i: any) => i && typeof i.text === "string" && i.text.trim())
        .slice(0, 30)
        .map((i: any) => ({
          id: typeof i.id === "string" && i.id ? i.id : Math.random().toString(36).slice(2, 10),
          text: i.text.trim().slice(0, 500),
          done: !!i.done,
        }))
    }

    if (Object.keys(update).length === 0) return res.status(400).json({ error: "Không có field nào để cập nhật" })

    // Activity log
    const activityLogs: any[] = []
    const now = new Date().toISOString()
    if (body.status !== undefined && body.status !== task.status)
      activityLogs.push({ author_id: email, text: `Chuyển trạng thái: ${STATUS_LABEL[task.status] ?? task.status} → ${STATUS_LABEL[body.status] ?? body.status}`, created_at: now, type: "system" })
    if (body.priority !== undefined && body.priority !== task.priority)
      activityLogs.push({ author_id: email, text: `Đổi độ ưu tiên: ${PRIORITY_LABEL[task.priority] ?? task.priority} → ${PRIORITY_LABEL[body.priority] ?? body.priority}`, created_at: now, type: "system" })
    if (body.assignee_id !== undefined && body.assignee_id !== task.assignee_id)
      activityLogs.push({ author_id: email, text: `Chuyển giao cho: ${body.assignee_id}`, created_at: now, type: "system" })
    if (body.deadline !== undefined && body.deadline !== task.deadline?.slice(0, 10))
      activityLogs.push({ author_id: email, text: body.deadline ? `Đặt deadline: ${body.deadline}` : "Xóa deadline", created_at: now, type: "system" })
    if (body.planned_for !== undefined && body.planned_for !== task.planned_for?.slice(0, 10))
      activityLogs.push({ author_id: email, text: body.planned_for ? `Dự định làm: ${body.planned_for}` : "Xóa ngày dự định làm", created_at: now, type: "system" })
    if (body.purchase_stage !== undefined && body.purchase_stage !== task.purchase_stage)
      activityLogs.push({ author_id: email, text: `Giai đoạn mua hàng: ${PURCHASE_STAGE_LABEL[body.purchase_stage] ?? body.purchase_stage}`, created_at: now, type: "system" })
    if (body.call_stage !== undefined && body.call_stage !== task.call_stage)
      activityLogs.push({ author_id: email, text: `Giai đoạn gọi CSKH: ${CALL_STAGE_LABEL[body.call_stage] ?? body.call_stage}`, created_at: now, type: "system" })
    if (activityLogs.length > 0) {
      update.comments = [...(task.comments || []), ...activityLogs]
    }

    const updated = await svc.updateMktTasks({ id: task.id, ...update })

    // Email notifications for review flow
    if (body.status !== undefined && body.status !== task.status && !personal) {
      const taskUrl = `${process.env.BACKEND_URL || "https://api.phanviet.vn"}/app/mkt-tasks?task=${task.id}`

      if (body.status === "pending_review") {
        // Nhân sự submit → thông báo tất cả manager
        const managerEmails = await getManagerEmails(req)
        await sendTaskEmail(req, {
          to: managerEmails,
          subject: `[Chờ duyệt] ${task.title}`,
          body: `${email} đã hoàn thành task "${task.title}" và gửi yêu cầu duyệt.\n\nXem task: ${taskUrl}`,
        })
      } else if ((body.status === "done" || body.status === "cancelled") && task.status === "pending_review") {
        // Manager duyệt/từ chối → thông báo assignee
        const verdict = body.status === "done" ? "✅ Đã duyệt" : "❌ Không duyệt"
        await sendTaskEmail(req, {
          to: task.assignee_id,
          subject: `[${verdict}] ${task.title}`,
          body: `${email} đã ${body.status === "done" ? "duyệt" : "từ chối"} task "${task.title}" của bạn.\n\nXem task: ${taskUrl}`,
        })
      }

      // Telegram notifications
      const userModule = req.scope.resolve(Modules.USER)

      if (body.status === "pending_review") {
        // Assignee gửi duyệt → notify tất cả manager
        const managerEmails = await getManagerEmails(req)
        const tgText = [
          `🔍 <b>Chờ duyệt!</b>`,
          ``,
          `<b>${task.title}</b>`,
          `👤 Gửi bởi: ${email}`,
          ``,
          `🔗 <a href="${taskUrl}">Xem & duyệt</a>`,
        ].join("\n")
        notifyTelegramByEmail(userModule, managerEmails, tgText).catch(() => {})
      } else if (body.status === "done" && task.status === "pending_review") {
        // Manager duyệt → notify assignee
        const tgText = [
          `✅ <b>Task đã được duyệt!</b>`,
          ``,
          `<b>${task.title}</b>`,
          `👤 Duyệt bởi: ${email}`,
          ``,
          `🔗 <a href="${taskUrl}">Xem task</a>`,
        ].join("\n")
        notifyTelegramByEmail(userModule, task.assignee_id, tgText).catch(() => {})
      } else if (body.status === "cancelled" && task.status === "pending_review") {
        // Manager từ chối → notify assignee
        const tgText = [
          `❌ <b>Task bị từ chối</b>`,
          ``,
          `<b>${task.title}</b>`,
          `👤 Từ chối bởi: ${email}`,
          ``,
          `🔗 <a href="${taskUrl}">Xem task</a>`,
        ].join("\n")
        notifyTelegramByEmail(userModule, task.assignee_id, tgText).catch(() => {})
      } else if (body.status === "in_progress" && task.status === "todo") {
        // Bắt đầu làm — không cần notify
      }

      // Post system message vào channel
      if (task.channel_id) {
        const statusIcon: Record<string, string> = {
          in_progress: "🚀 Đang làm", pending_review: "🔍 Chờ duyệt",
          done: "✅ Hoàn thành", cancelled: "❌ Đã huỷ", todo: "⏳ Để làm",
        }
        await svc.createMktMessages({
          channel_id: task.channel_id,
          author_id: email,
          content: `${statusIcon[body.status] ?? body.status}: "${task.title}"`,
          task_id: id,
          msg_type: `task_${body.status}`,
          reactions: {},
          mentions: [],
        }).catch(console.error)
      }
    }

    res.json({ task: updated })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

// DELETE /admin/mkt-tasks/:id
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await actorEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const { id } = req.params
    const [task] = await svc.listMktTasks({ id })
    if (!task) return res.status(404).json({ error: "Không tìm thấy task" })

    const manager = await isManager(req)
    if (!manager && !isPersonalTask(task, email)) {
      return res.status(403).json({ error: "Không có quyền" })
    }

    await svc.deleteMktTasks(id)
    res.json({ success: true })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
