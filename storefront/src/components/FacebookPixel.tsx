"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"
import { generateEventId } from "@lib/pixel"

declare global {
  interface Window {
    fbq?: (...args: any[]) => void
    _fbq?: any
  }
}

// Queue commands before fbq script loads — standard FB pattern
function fbq(...args: any[]) {
  if (typeof window === "undefined") return
  if (window.fbq) {
    window.fbq(...args)
  }
}

let scriptLoaded = false

function loadFbScript(pixelId: string, onReady: () => void) {
  if (typeof window === "undefined") return

  // Build the fbq stub (standard FB snippet)
  if (!window.fbq) {
    const fn = function (...args: any[]) {
      ;(fn as any).callMethod
        ? (fn as any).callMethod.apply(fn, args)
        : (fn as any).queue.push(args)
    } as any
    fn.push = fn
    fn.loaded = true
    fn.version = "2.0"
    fn.queue = []
    window.fbq = fn
    window._fbq = fn
  }

  window.fbq("init", pixelId)

  if (scriptLoaded) {
    onReady()
    return
  }

  const script = document.createElement("script")
  script.async = true
  script.src = "https://connect.facebook.net/en_US/fbevents.js"
  script.onload = () => {
    scriptLoaded = true
    onReady()
  }
  document.head.appendChild(script)
}

export default function FacebookPixel({ pixelIds }: { pixelIds: string[] }) {
  const pathname = usePathname()
  const initialized = useRef(false)

  useEffect(() => {
    if (!pixelIds.length) return

    loadFbScript(pixelIds[0], () => {
      // Init additional pixel IDs
      for (const id of pixelIds.slice(1)) {
        window.fbq?.("init", id)
      }

      if (!initialized.current) {
        initialized.current = true
        // Fire initial PageView after script ready
        window.fbq?.("track", "PageView", {}, { eventID: generateEventId() })
      }
    })
  }, [])

  // Subsequent navigation PageViews
  useEffect(() => {
    if (!initialized.current) return
    window.fbq?.("track", "PageView", {}, { eventID: generateEventId() })
  }, [pathname])

  return null
}
