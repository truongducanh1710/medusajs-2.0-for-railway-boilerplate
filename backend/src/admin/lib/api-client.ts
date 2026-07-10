import { ensureMktChatGlobalMentionAlerts } from "./mkt-chat-global-alerts"
import { DEFAULT_ADMIN_APP_ROUTE } from "./default-route"

ensureMktChatGlobalMentionAlerts()

export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, { credentials: "include", ...init })
  if (res.status === 403) {
    alert("Bạn không có quyền truy cập chức năng này")
    window.location.href = DEFAULT_ADMIN_APP_ROUTE
  }
  return res
}

// Helper cho các route mới: tự parse JSON, support (url, method, body)
export async function apiJson(url: string, method = "GET", body?: unknown): Promise<any> {
  const init: RequestInit = { method, credentials: "include" }
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" }
    init.body = JSON.stringify(body)
  }
  const res = await fetch(url, init)
  if (res.status === 403) {
    alert("Bạn không có quyền truy cập chức năng này")
    window.location.href = DEFAULT_ADMIN_APP_ROUTE
    return null
  }
  const text = await res.text()
  let data: any = null
  try { data = JSON.parse(text) } catch { /* non-JSON response */ }
  if (!res.ok) {
    const msg = data?.error || data?.message || text?.slice(0, 120) || `HTTP ${res.status}`
    throw new Error(msg)
  }
  return data
}
