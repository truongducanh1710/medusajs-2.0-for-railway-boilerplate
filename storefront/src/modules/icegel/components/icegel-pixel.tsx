"use client"

import { useEffect } from "react"

// Inits the ICEgel ad pixel on pages without a single product (the /icegel hub),
// so InitiateCheckout / CompleteRegistration later in the session reach it too.
export default function IcegelPixel({ pixelIds }: { pixelIds: string[] }) {
  useEffect(() => {
    if (typeof window === "undefined" || !pixelIds.length) return
    const fire = () => {
      for (const id of pixelIds) {
        window.fbq?.("init", id)
        window.fbq?.("trackSingle", id, "PageView")
      }
    }
    if ((window as any).__fbqReady) fire()
    else window.addEventListener("fbq:ready", fire, { once: true })
    return () => window.removeEventListener("fbq:ready", fire)
  }, [pixelIds.join(",")])
  return null
}
