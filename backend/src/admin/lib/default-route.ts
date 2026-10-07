export const DEFAULT_ADMIN_APP_ROUTE = "/app/mkt-chat"

// Freelancer không có quyền MKT Chat — đưa về trang mặc định cũ sẽ bị route-guard đá
// ngược lại liên tục. use-permissions gọi setHomeRole() khi đọc xong /permissions/me.
const FREELANCE_HOME_ROUTE = "/app/test-san-pham"

let currentRole: string | null = null

export function setHomeRole(role: string | null) {
  currentRole = role
}

export function homeRoute(): string {
  return currentRole === "freelance" ? FREELANCE_HOME_ROUTE : DEFAULT_ADMIN_APP_ROUTE
}
