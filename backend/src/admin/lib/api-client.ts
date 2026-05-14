import { toast } from "@medusajs/ui"

export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, { credentials: "include", ...init })
  if (res.status === 403) {
    toast.error("Bạn không có quyền truy cập chức năng này")
    setTimeout(() => {
      window.location.href = "/app"
    }, 800)
  }
  return res
}
