import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { useEffect } from "react"

// Native Medusa login page has no i18n/theming override API and hardcodes its logo,
// copy, and Medusa-blue accent. We overlay Phan Việt branding via this widget zone
// (login.before) instead of patching @medusajs/dashboard.
// Match by substring (not exact-equal) since production build can merge/whitespace
// text nodes differently than dev (e.g. "Forgot password? - " is one text node with "Reset" as a sibling link).
const TEXT_REPLACEMENTS: Array<[string, string]> = [
  ["Welcome to Medusa", "Chào mừng đến với Phan Việt"],
  ["Sign in to access the account area", "Đăng nhập để truy cập trang quản trị"],
  ["Continue with Email", "Đăng nhập bằng Email"],
  ["Forgot password?", "Quên mật khẩu?"],
  ["Reset", "Đặt lại"],
]

const THEME_CSS = `
  :root {
    --pv-accent: #c24a2e;
    --pv-accent-hover: #a63d24;
    --pv-accent-soft: #f3e2dc;
    --pv-bg-pattern: #f1ede4;
  }
  [data-theme="dark"] {
    --pv-accent: #e0693f;
    --pv-accent-hover: #ec7c53;
    --pv-accent-soft: #33241f;
    --pv-bg-pattern: #1c1f24;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --pv-accent: #e0693f;
      --pv-accent-hover: #ec7c53;
      --pv-accent-soft: #33241f;
      --pv-bg-pattern: #1c1f24;
    }
  }

  /* Login screen background: warm dotted texture instead of flat Medusa grey. */
  #phanviet-login-logo {
    position: relative;
  }
  body:has(#phanviet-login-logo) {
    background-image: radial-gradient(circle at 1px 1px, var(--pv-bg-pattern) 1.5px, transparent 1.5px) !important;
    background-size: 28px 28px !important;
  }

  /* Primary submit button in terracotta instead of Medusa blue. */
  #phanviet-login-logo ~ * button[type="submit"],
  #phanviet-login-logo ~ form button[type="submit"] {
    background-color: var(--pv-accent) !important;
    border-color: var(--pv-accent) !important;
  }
  #phanviet-login-logo ~ * button[type="submit"]:hover,
  #phanviet-login-logo ~ form button[type="submit"]:hover {
    background-color: var(--pv-accent-hover) !important;
    border-color: var(--pv-accent-hover) !important;
  }

  /* Focus ring + link accents. */
  #phanviet-login-logo ~ * input:focus {
    border-color: var(--pv-accent) !important;
    box-shadow: 0 0 0 3px var(--pv-accent-soft) !important;
  }
  #phanviet-login-logo ~ * a {
    color: var(--pv-accent) !important;
  }
`

const LoginBranding = () => {
  useEffect(() => {
    const styleId = "phanviet-login-style"
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style")
      style.id = styleId
      style.textContent = THEME_CSS
      document.head.appendChild(style)
    }

    const applyText = () => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      const nodes: Text[] = []
      let n: Node | null
      while ((n = walker.nextNode())) nodes.push(n as Text)
      nodes.forEach((node) => {
        const text = node.textContent
        if (!text || !text.trim()) return
        for (const [en, vi] of TEXT_REPLACEMENTS) {
          if (text.includes(en)) {
            node.textContent = text.split(en).join(vi)
          }
        }
      })
    }

    const raf = requestAnimationFrame(applyText)
    const timer = setTimeout(applyText, 300)
    const observer = new MutationObserver(applyText)
    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [])

  // Zero-size anchor node — keeps the CSS theme selectors (which target
  // "#phanviet-login-logo ~ ...") working without rendering any visible logo/title.
  return <div id="phanviet-login-logo" style={{ display: "none" }} />
}

export const config = defineWidgetConfig({ zone: "login.before" })
export default LoginBranding
