export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, { credentials: "include", ...init })
  if (res.status === 403) {
    alert("Bạn không có quyền truy cập chức năng này")
    window.location.href = "/app"
  }
  return res
}
