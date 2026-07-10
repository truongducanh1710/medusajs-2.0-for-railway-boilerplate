import { useEffect, type ComponentType } from "react"
import { useCurrentPermissions } from "../lib/use-permissions"
import { ROUTE_PERMS, NATIVE_PERMS } from "../lib/route-permissions"
import { ensureMktChatGlobalMentionAlerts } from "../lib/mkt-chat-global-alerts"
import { DEFAULT_ADMIN_APP_ROUTE } from "../lib/default-route"

const FORBIDDEN_MESSAGE = "B\u1ea1n kh\u00f4ng c\u00f3 quy\u1ec1n truy c\u1eadp trang n\u00e0y"

// Wrap a custom route page so RouteGuard mounts even on direct load/refresh,
// where none of the native widget zones (login/order/product/customer) render.
export function withRouteGuard<P extends object>(Component: ComponentType<P>) {
  const Guarded = (props: P) => (
    <>
      <RouteGuard />
      <Component {...props} />
    </>
  )
  Guarded.displayName = `withRouteGuard(${Component.displayName || Component.name || "Page"})`
  return Guarded
}

export const RouteGuard = () => {
  useEffect(() => {
    ensureMktChatGlobalMentionAlerts()
  }, [])

  const { perms, loading, has, isSuper, role } = useCurrentPermissions()
  const isAdmin = isSuper || role === "admin"

  // Native Medusa core routes are admin-only. Custom Extensions still follow ROUTE_PERMS.
  useEffect(() => {
    if (!perms) return
    const hide: string[] = []

    if (!isAdmin) {
      for (const key of Object.keys(NATIVE_PERMS)) {
        hide.push(`nav a[href$="/${key}"]`, `nav a[href*="/${key}/"]`)
      }
      hide.push("aside nav > div.px-3:has(button)")
    }

    for (const [prefix, p] of Object.entries(ROUTE_PERMS)) {
      if (!has(p)) {
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
  }, [perms, has, isAdmin])

  // Hide the native Search button as soon as the sidebar DOM is available.
  useEffect(() => {
    if (!perms) return
    const updateNativeSearch = () => {
      const buttons = Array.from(document.querySelectorAll("aside nav button"))
      buttons.forEach((btn) => {
        const text = btn.textContent?.replace(/\s+/g, " ").trim().toLowerCase() ?? ""
        if (!text.includes("search") || !text.includes("k")) return
        const wrapper = btn.closest("div.px-3") as HTMLElement | null
        const target = wrapper ?? (btn as HTMLElement)
        target.style.display = isAdmin ? "" : "none"
      })
    }
    const raf = requestAnimationFrame(updateNativeSearch)
    const timer = setTimeout(updateNativeSearch, 300)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
    }
  }, [perms, isAdmin])

  // Hide heading "Extensions" when all child items are hidden.
  // Medusa render: <div>{divider}<div><Collapsible><button>Extensions</button><div data-state><nav>{links}</nav></div></Collapsible></div></div>
  useEffect(() => {
    if (!perms) return
    const checkExtensionsHeading = () => {
      const buttons = Array.from(document.querySelectorAll("aside button"))
      buttons.forEach((btn) => {
        const text = btn.textContent?.trim().toLowerCase()
        if (text !== "extensions") return
        let outer: HTMLElement | null = btn.parentElement
        for (let i = 0; i < 6 && outer; i++) {
          if (outer.querySelector("nav")) break
          outer = outer.parentElement
        }
        if (!outer) return
        const section = (outer.parentElement as HTMLElement) ?? outer
        const links = outer.querySelectorAll("nav a")
        const visible = Array.from(links).some((a) => (a as HTMLElement).offsetParent !== null)
        section.style.display = links.length && !visible ? "none" : ""
      })
    }
    const raf = requestAnimationFrame(checkExtensionsHeading)
    const timer = setTimeout(checkExtensionsHeading, 300)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
    }
  }, [perms])

  // Redirect if user enters a forbidden custom route or any native Medusa core route as non-admin.
  useEffect(() => {
    if (loading || !perms) return
    if (window.location.pathname.replace(/\/+$/, "") === "/app") {
      window.location.href = DEFAULT_ADMIN_APP_ROUTE
      return
    }

    const path = window.location.pathname.replace(/^\/app/, "")

    for (const [prefix, perm] of Object.entries(ROUTE_PERMS)) {
      if (path.startsWith(prefix) && !has(perm)) {
        alert(FORBIDDEN_MESSAGE)
        window.location.href = DEFAULT_ADMIN_APP_ROUTE
        return
      }
    }

    for (const key of Object.keys(NATIVE_PERMS)) {
      if ((path === `/${key}` || path.startsWith(`/${key}/`)) && !isAdmin) {
        alert(FORBIDDEN_MESSAGE)
        window.location.href = DEFAULT_ADMIN_APP_ROUTE
        return
      }
    }
  }, [perms, loading, has, isAdmin])

  return null
}
