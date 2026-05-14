import { useEffect } from "react"
import { useCurrentPermissions } from "../lib/use-permissions"
import { ROUTE_PERMS, NATIVE_PERMS } from "../lib/route-permissions"

export const RouteGuard = () => {
  const { perms, loading, has } = useCurrentPermissions()

  // Ẩn sidebar native tabs mà user không có quyền
  useEffect(() => {
    if (!perms || perms === "*") return
    const hide: string[] = []
    for (const [key, p] of Object.entries(NATIVE_PERMS)) {
      if (!(perms as string[]).includes(p)) {
        hide.push(`nav a[href$="/${key}"]`, `nav a[href*="/${key}/"]`)
      }
    }
    if (!hide.length) return
    let el = document.getElementById("rbac-hide-css") as HTMLStyleElement | null
    if (!el) {
      el = document.createElement("style")
      el.id = "rbac-hide-css"
      document.head.appendChild(el)
    }
    el.textContent = `${hide.join(", ")} { display: none !important; }`
  }, [perms])

  // Redirect nếu vào custom route không có quyền
  useEffect(() => {
    if (loading || !perms) return
    const path = window.location.pathname.replace(/^\/app/, "")
    for (const [prefix, perm] of Object.entries(ROUTE_PERMS)) {
      if (path.startsWith(prefix) && !has(perm)) {
        alert("Bạn không có quyền truy cập trang này")
        setTimeout(() => {
          window.location.href = "/app"
        }, 600)
        return
      }
    }
  }, [perms, loading])

  return null
}
