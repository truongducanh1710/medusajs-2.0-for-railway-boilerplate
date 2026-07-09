import { model } from "@medusajs/framework/utils"

const MktTask = model.define("mkt_task", {
  id: model.id().primaryKey(),
  title: model.text(),
  type: model.text(), // ads_camp | content_post | purchasing
  assignee_id: model.text(),
  created_by: model.text(),
  deadline: model.dateTime().nullable(),
  planned_for: model.dateTime().nullable(),
  personal_order: model.number().nullable(),
  status: model.text().default("todo"), // todo | in_progress | done | cancelled | missed
  priority: model.text().default("medium"), // high | medium | low
  tags: model.json(),
  notes: model.text().nullable(),
  comments: model.json(),
  rating: model.number().nullable(),
  channel_id: model.text().nullable(),
  // Recurring task support
  output: model.text().nullable(),          // Tiêu chí done định lượng ("Output cần có")
  result: model.text().nullable(),          // Kết quả thực tế nhân sự điền khi done
  frequency: model.text().default("once"),  // once | daily | weekly | monthly
  is_template: model.boolean().default(false), // true = task mẫu lặp
  template_id: model.text().nullable(),     // instance → trỏ về template sinh ra nó
  period_key: model.text().nullable(),      // "2026-06-12" | "2026-W24" | "2026-06" — chống sinh trùng
  checklist: model.json().nullable(),       // [{ id, text, done }] — assignee tự quản sub-steps
  // Mua hàng (type=purchasing): liên kết tới lô nhập trong bảng giá vốn (import_lot.id)
  import_lot_id: model.text().nullable(),
  // Mua hàng: giai đoạn quy trình riêng (độc lập với status gốc). Xem PURCHASE_STAGES.
  purchase_stage: model.text().nullable(),
  // CSKH gọi tư vấn (type=cskh_call): liên kết đơn hàng Pancake làm nguồn khách gọi
  pancake_order_id: model.text().nullable(),
  customer_name: model.text().nullable(),
  customer_phone: model.text().nullable(),
  // CSKH: giai đoạn cuộc gọi, độc lập với status gốc. Xem CALL_STAGES ở UI.
  call_stage: model.text().nullable(),
  // CSKH: tên sản phẩm khách đã mua (chọn ở bước tìm khách hàng khi bulk-create)
  product_name: model.text().nullable(),
})

export default MktTask
