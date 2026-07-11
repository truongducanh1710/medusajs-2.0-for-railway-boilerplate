import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { useEffect } from "react"
import logo from "../assets/phanviet-logo.png"

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

    // Medusa's login mark is a fixed SVG path (see @medusajs/dashboard logo-box.tsx);
    // matching on that path is more stable across versions than guessing Tailwind class names.
    const MEDUSA_LOGO_PATH_PREFIX = "M30.85 6.16832L22.2453 1.21782"
    const hideMedusaLogo = () => {
      document.querySelectorAll("path").forEach((path) => {
        const d = path.getAttribute("d")
        if (!d || !d.startsWith(MEDUSA_LOGO_PATH_PREFIX)) return
        const box = path.closest("svg")?.parentElement
        if (box) (box as HTMLElement).style.display = "none"
      })
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

    const run = () => {
      hideMedusaLogo()
      applyText()
    }

    const raf = requestAnimationFrame(run)
    const timer = setTimeout(run, 300)
    const observer = new MutationObserver(run)
    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [])

  return (
    <div
      id="phanviet-login-logo"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        marginBottom: 20,
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          background: "var(--pv-accent, #c24a2e)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 12px 32px -12px rgba(31,36,34,0.35)",
        }}
      >
        <img src={logo} alt="Phan Việt" style={{ height: 32, objectFit: "contain" }} />
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "0.01em" }}>
          Phan Việt
        </div>
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            opacity: 0.6,
          }}
        >
          Trang quản trị
        </div>
      </div>
    </div>
  )
}

export const config = defineWidgetConfig({ zone: "login.before" })
export default LoginBranding
