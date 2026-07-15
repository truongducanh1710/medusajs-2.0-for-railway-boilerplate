export const PERMISSIONS = {
  "page.don-hang.view": "Xem đơn hàng (custom)",
  "page.don-hang.edit": "Cập nhật trạng thái đơn",
  "page.san-pham.view": "Xem trang sản phẩm (Marketing)",
  "page.san-pham.edit": "Sửa nội dung trang sản phẩm (GrapesJS)",
  "page.bao-cao.view": "Xem báo cáo",
  "page.pancake-sync.view": "Xem trang Sync",
  "page.pancake-sync.run": "Trigger sync Pancake",
  "page.ity-cdr.view": "Xem báo cáo cuộc gọi tổng đài (CDR)",
  "page.ity-cdr.run": "Trigger sync CDR thủ công",
  "page.pages.view": "Xem Pages CMS",
  "page.pages.edit": "Sửa Pages CMS",
  "medusa.orders.view": "Tab Orders native",
  "medusa.products.view": "Tab Products native",
  "medusa.customers.view": "Tab Customers native",
  "medusa.inventory.view": "Tab Inventory native",
  "medusa.promotions.view": "Tab Promotions/Pricing native",
  "medusa.settings.view": "Tab Settings native",
  "users.manage": "Quản lý user + phân quyền",
  "page.cskh.view": "Xem trang CSKH vận đơn",
  "page.cskh.analyze": "Trigger phân tích AI vận đơn",
  "page.cskh.manage": "Quản lý hiệu suất đội CSKH (xem KPI per nhân viên)",
  "page.gia-von.view": "Xem trang giá vốn",
  "page.gia-von.manage": "Nhập/sửa lô hàng giá vốn",
  "page.bao-cao.camp-control": "Bật/tắt camp + chỉnh ngân sách FB Ads",
  "page.bao-cao.fb-accounts": "Xem và quản lý tài khoản FB Ads (manager only)",
  "page.bao-cao.care-rules": "Cài rule chăm sóc camp tự động (tắt/budget/notify)",
  "page.marketing-video.view": "Xem bảng nguyên liệu video (Marketing Hub)",
  "page.marketing-video.edit": "Tạo/sửa dòng nguyên liệu video",
  "page.fb-content.view": "Xem Facebook Content Manager (đăng bài/lịch/viral)",
  "page.fb-content.post": "Đăng bài / lên lịch Facebook",
  "page.fb-content.boost": "Lên camp Facebook Ads từ video nguyên liệu",
  "page.fb-content.stats": "Xem tổng hợp bài viết + insights Facebook",
  "page.chat.view": "Xem inbox Facebook trong Medusa",
  "page.chat.reply": "Tra loi khach trong inbox Facebook",
  "page.chat.manage": "Gan sale, tag, handoff va quan ly hoi thoai",
  "page.chat.bot.manage": "Quan ly bot agent chat",
  "page.chat.order.create": "Tao don tu hoi thoai chat",
  "page.mkt-tasks.view": "Xem task giao việc MKT",
  "page.mkt-tasks.manage": "Giao việc, đánh giá task MKT (manager)",
  "page.cskh-goi-khach.call": "Bấm gọi khách qua tổng đài (click-to-call)",
  "page.mkt-chat.view": "Xem chat group MKT",
  "page.mkt-chat.manage": "Tạo/quản lý channel chat MKT (manager)",
  "page.live-view.view": "Xem Live View (visitor tracking storefront)",
  "page.cham-cong.view": "Xem chấm công: giờ online + việc đã làm của nhân sự (lead/manager)",
  "page.ai-settings.manage": "Cấu hình AI Settings (model, exchange rate)",
  "page.dohana-sync.view": "Xem theo dõi video đóng gói (Dohana)",
  "page.dohana-sync.run": "Trigger sync Dohana thủ công",
} as const

export type PermissionKey = keyof typeof PERMISSIONS

export const ROLE_PRESETS: Record<string, string[]> = {
  admin: Object.keys(PERMISSIONS),
  manager: ["page.bao-cao.view", "page.bao-cao.camp-control", "page.bao-cao.fb-accounts", "page.don-hang.view", "page.don-hang.edit", "medusa.orders.view", "medusa.customers.view", "page.gia-von.view", "users.manage", "page.mkt-tasks.view", "page.mkt-tasks.manage", "page.mkt-chat.view", "page.mkt-chat.manage", "page.ity-cdr.view", "page.ity-cdr.run", "page.cskh-goi-khach.call", "page.cham-cong.view"],
  marketing: ["page.bao-cao.view", "page.bao-cao.camp-control", "page.bao-cao.care-rules", "page.san-pham.view", "page.san-pham.edit", "medusa.products.view", "page.marketing-video.view", "page.marketing-video.edit", "page.fb-content.view", "page.fb-content.post", "page.fb-content.boost", "page.fb-content.stats", "page.chat.view", "page.chat.bot.manage", "page.mkt-tasks.view", "page.mkt-chat.view"],
  sale: ["page.don-hang.view", "page.don-hang.edit", "medusa.orders.view", "medusa.customers.view", "page.gia-von.view", "page.chat.view", "page.chat.reply", "page.chat.manage", "page.chat.order.create", "page.mkt-chat.view"],
  cskh: ["page.cskh.view", "page.cskh.analyze", "page.don-hang.view", "medusa.orders.view", "page.chat.view", "page.chat.reply", "page.chat.manage", "page.mkt-tasks.view", "page.ity-cdr.view", "page.cskh-goi-khach.call", "page.mkt-chat.view"],
  ketoan: ["page.gia-von.view", "page.gia-von.manage", "page.mkt-chat.view"],
  "kho-van": ["page.dohana-sync.view", "medusa.orders.view"],
  // Tài khoản AI Agent. Mặc định chỉ đọc. Các quyền .post/.edit/.manage chỉ được thêm
  // vào đây SAU KHI đã có write tool tương ứng đi qua approval flow (agent/approval-flow.mjs
  // trong phanviet-agent-mcp) — permission ở đây không thay thế approval, cả hai đều
  // phải pass: policy.mjs's assertToolAllowed chặn write tool tuyệt đối nếu thiếu
  // approvalId, dù actor có đủ quyền hay không.
  // page.fb-content.post: cho phép schedule_fb_post SAU KHI đã được người có quyền
  // duyệt qua Chat MKT (B8) — không cấp thêm quyền write nào khác cho tới khi tool đó
  // cũng có approval flow.
  // page.cskh.manage, page.mkt-tasks.manage, page.ity-cdr.view: quyền ĐỌC KPI/báo cáo
  // đội (team-stats, suspicious, mkt-tasks/stats, ity-cdr report/compare) — các route
  // này dùng chung permission "manage"/"view" cho cả xem lẫn sửa vì lịch sử thiết kế,
  // nhưng tool tương ứng trong tools-registry.mjs CHỈ gọi GET, không có tool ghi nào
  // dùng các quyền này. Không tự suy ra "ai-agent được sửa CSKH/task" — quyền ghi thật
  // (assign/rate task, sửa care) không có tool nào expose cho model gọi.
  "ai-agent": ["page.bao-cao.view", "page.don-hang.view", "page.mkt-chat.view", "page.mkt-tasks.view", "page.marketing-video.view", "page.fb-content.view", "page.fb-content.post", "page.cskh.manage", "page.mkt-tasks.manage", "page.ity-cdr.view"],
}
