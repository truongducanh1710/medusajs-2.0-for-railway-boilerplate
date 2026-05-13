import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { useEffect } from "react"

// Inject Microsoft Clarity vào Medusa Admin
// Widget này render không có UI — chỉ inject script 1 lần
const ClarityWidget = () => {
  useEffect(() => {
    if ((window as any)._clarityAdminInited) return
    ;(window as any)._clarityAdminInited = true

    const w = window as any
    w.clarity = w.clarity || function (...args: any[]) {
      (w.clarity.q = w.clarity.q || []).push(args)
    }

    const script = document.createElement("script")
    script.async = true
    script.src = "https://www.clarity.ms/tag/wfm2h22kzr"
    script.onload = () => {
      console.info("[Clarity Admin] Script loaded OK")
    }
    script.onerror = (e) => {
      console.error("[Clarity Admin] Script load failed", e)
    }
    document.head.appendChild(script)
  }, [])

  return null
}

export const config = defineWidgetConfig({
  zone: "product.list.before",
})

export default ClarityWidget
