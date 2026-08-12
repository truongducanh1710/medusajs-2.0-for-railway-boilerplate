import { ensureMktChatGlobalMentionAlerts } from "./mkt-chat-global-alerts"
import { DEFAULT_ADMIN_APP_ROUTE } from "./default-route"
import { recordApiCall } from "../components/debug-boundary"

ensureMktChatGlobalMentionAlerts()

// Keep a copy of what each call returned so a later render crash can show the
// responses that led to it. Cloning avoids consuming the body the caller reads.
async function logResponse(url: string, res: Response) {
  let bodyPreview = ""
  try {
    bodyPreview = (await res.clone().text()).slice(0, 200)
  } catch {
    bodyPreview = "<unreadable body>"
  }
  recordApiCall({
    at: new Date().toISOString(),
    url,
    status: res.status,
    ok: res.ok,
    bodyPreview,
  })
  if (!res.ok) {
    console.warn(`[admin-api] ${res.status} ${url} → ${bodyPreview}`)
  }
}

// An expired session answers every call with 401 and a body that has none of
// the keys the caller expects. Left alone that surfaces as a blank page, so
// send the user to login instead of letting each page invent its own failure.
function handleExpiredSession() {
  alert("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại")
  window.location.href = "/app/login"
}

export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, { credentials: "include", ...init })
  await logResponse(url, res)
  if (res.status === 401) {
    handleExpiredSession()
  } else if (res.status === 403) {
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
  if (res.status === 401) {
    handleExpiredSession()
    return null
  }
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
