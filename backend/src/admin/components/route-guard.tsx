import { useEffect } from "react"
import { useCurrentPermissions } from "../lib/use-permissions"
import { ROUTE_PERMS, NATIVE_PERMS } from "../lib/route-permissions"
import { ensureMktChatGlobalMentionAlerts } from "../lib/mkt-chat-global-alerts"

export const RouteGuard = () => {
  useEffect(() => {
    ensureMktChatGlobalMentionAlerts()
  }, [])

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
    // Ẩn custom route sidebar links
    for (const [prefix, p] of Object.entries(ROUTE_PERMS)) {
      if (!(perms as string[]).includes(p)) {
        hide.push(
          `nav a[href$="/app${prefix}"]`,
          `nav a[href*="/app${prefix}/"]`,
        )
      }
    }

    if (!hide.length) {
      const old = document.getElementById("rbac-hide-css")
      if (old) old.remove()
      return
    }
    let el = document.getElementById("rbac-hide-css") as HTMLStyleElement | null
    if (!el) {
      el = document.createElement("style")
      el.id = "rbac-hide-css"
      document.head.appendChild(el)
    }
    el.textContent = `${hide.join(", ")} { display: none !important; }`
  }, [perms])

  // Ẩn heading "Extensions" nếu tất cả item con bên trong đã bị ẩn hết (gọn sidebar)
  useEffect(() => {
    if (!perms) return
    const checkExtensionsHeading = () => {
      const headings = Array.from(document.querySelectorAll("nav [data-sidebar-heading], nav h3, nav div[role='heading']"))
      headings.forEach((h) => {
        const text = h.textContent?.trim().toLowerCase()
        if (text !== "extensions") return
        const section = h.closest("div")?.parentElement || h.parentElement
        if (!section) return
        const links = section.querySelectorAll("a")
        const visible = Array.from(links).some((a) => (a as HTMLElement).offsetParent !== null)
        ;(section as HTMLElement).style.display = links.length && !visible ? "none" : ""
      })
    }
    const raf = requestAnimationFrame(checkExtensionsHeading)
    const timer = setTimeout(checkExtensionsHeading, 300)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
    }
  }, [perms])

  // Redirect nếu vào route (custom hoặc native Medusa) không có quyền
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

    for (const [key, perm] of Object.entries(NATIVE_PERMS)) {
      if ((path === `/${key}` || path.startsWith(`/${key}/`)) && !has(perm)) {
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
