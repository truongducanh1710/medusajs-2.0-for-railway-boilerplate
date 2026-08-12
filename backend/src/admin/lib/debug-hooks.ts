import { getApiLog } from "../components/debug-boundary"

// Blank admin pages are hard to report: the person who hits one usually can't
// read a stack trace, and Medusa's boundary hides it anyway. These hooks keep
// every failure retrievable after the fact — from the console, or by asking
// the user to run phanvietDebug() and send back what it prints.

type CapturedError = {
  at: string
  kind: "error" | "unhandledrejection"
  message: string
  source?: string
  stack?: string
  url: string
}

const ERRORS: CapturedError[] = []
const ERRORS_MAX = 25

function capture(entry: CapturedError) {
  ERRORS.push(entry)
  if (ERRORS.length > ERRORS_MAX) ERRORS.shift()
}

let installed = false

export function installAdminDebugHooks() {
  if (installed || typeof window === "undefined") return
  installed = true

  window.addEventListener("error", (event) => {
    capture({
      at: new Date().toISOString(),
      kind: "error",
      message: event.message || String(event.error || "unknown error"),
      source: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined,
      stack: event.error?.stack,
      url: window.location.href,
    })
  })

  window.addEventListener("unhandledrejection", (event) => {
    const reason: any = event.reason
    capture({
      at: new Date().toISOString(),
      kind: "unhandledrejection",
      message: reason?.message || String(reason),
      stack: reason?.stack,
      url: window.location.href,
    })
  })

  // One command to hand to whoever is looking at the broken screen.
  ;(window as any).phanvietDebug = () => {
    const report = {
      url: window.location.href,
      at: new Date().toISOString(),
      userAgent: navigator.userAgent,
      lastRenderError: (window as any).__lastAdminError ?? null,
      errors: ERRORS,
      apiLog: getApiLog(),
    }
    console.log("=== PHAN VIET DEBUG REPORT ===")
    console.log(JSON.stringify(report, null, 2))
    navigator.clipboard
      ?.writeText(JSON.stringify(report, null, 2))
      .then(() => console.log("→ Đã copy vào clipboard, gửi cho kỹ thuật."))
      .catch(() => console.log("→ Copy thủ công đoạn JSON ở trên."))
    return report
  }
}

export function getCapturedErrors(): CapturedError[] {
  return [...ERRORS]
}
