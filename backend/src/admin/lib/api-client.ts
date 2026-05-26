export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, { credentials: "include", ...init })
  if (res.status === 403) {
    alert("Bạn không có quyền truy cập chức năng này")
    window.location.href = "/app"
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
    window.location.href = "/app"
    return null
  }
  const data = await res.json()
  if (!res.ok) {
    const msg = data?.error || data?.message || `HTTP ${res.status}`
    throw new Error(msg)
  }
  return data
}
