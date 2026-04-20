"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"
import { generateEventId, sendCAPIEvent } from "@lib/pixel"

declare global {
  interface Window {
    fbq?: (...args: any[]) => void
    _fbq?: any
  }
}

function initPixel(pixelId: string) {
  if (typeof window === "undefined") return
  if (window.fbq) {
    window.fbq("init", pixelId)
    return
  }

  const fbq = function (...args: any[]) {
    ;(fbq as any).callMethod
      ? (fbq as any).callMethod.apply(fbq, args)
      : (fbq as any).queue.push(args)
  } as any
  fbq.push = fbq
  fbq.loaded = true
  fbq.version = "2.0"
  fbq.queue = []
  window.fbq = fbq
  window._fbq = fbq

  const script = document.createElement("script")
  script.async = true
  script.src = "https://connect.facebook.net/en_US/fbevents.js"
  document.head.appendChild(script)

  window.fbq("init", pixelId)
}

export default function FacebookPixel({
  pixelIds,
}: {
  pixelIds: string[]
}) {
  const pathname = usePathname()

  useEffect(() => {
    if (!pixelIds.length) return

    for (const id of pixelIds) {
      initPixel(id)
    }
  }, [pixelIds.join(",")])

  useEffect(() => {
    if (!pixelIds.length || !window.fbq) return

    const eventId = generateEventId()
    window.fbq("track", "PageView", {}, { eventID: eventId })
  }, [pathname])

  return null
}
