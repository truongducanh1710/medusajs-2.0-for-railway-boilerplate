export const PERMISSIONS = {
  "page.don-hang.view": "Xem đơn hàng (custom)",
  "page.don-hang.edit": "Cập nhật trạng thái đơn",
  "page.san-pham.view": "Xem trang sản phẩm (Marketing)",
  "page.san-pham.edit": "Sửa nội dung trang sản phẩm (GrapesJS)",
  "page.bao-cao.view": "Xem báo cáo",
  "page.pancake-sync.view": "Xem trang Sync",
  "page.pancake-sync.run": "Trigger sync Pancake",
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
} as const

export type PermissionKey = keyof typeof PERMISSIONS

export const ROLE_PRESETS: Record<string, string[]> = {
  admin: Object.keys(PERMISSIONS),
  marketing: ["page.san-pham.view", "page.san-pham.edit", "medusa.products.view"],
  sale: ["page.don-hang.view", "page.don-hang.edit", "medusa.orders.view"],
  cskh: ["page.cskh.view", "page.cskh.analyze", "page.don-hang.view"],
}
