"use client"

import { useEffect } from "react"
import { trackFunnel } from "@lib/funnel"

/** Mounted on the product page: page view, scroll depth, video play/end, time on page, leave. */
export default function FunnelTracker({ handle }: { handle: string }) {
  useEffect(() => {
    const start = Date.now()
    trackFunnel("view", undefined, { handle })

    const marks = [25, 50, 75, 100]
    const onScroll = () => {
      const h = document.documentElement
      const p = ((h.scrollTop + window.innerHeight) / Math.max(1, h.scrollHeight)) * 100
      for (const m of marks) if (p >= (m === 100 ? 97 : m)) trackFunnel(`scroll_${m}`, undefined, { handle })
    }
    window.addEventListener("scroll", onScroll, { passive: true })

    // Videos inside page content (and any other <video> on the page); capture phase since media events don't bubble
    const onPlay = (e: Event) => { if ((e.target as HTMLElement)?.tagName === "VIDEO") trackFunnel("video_play", undefined, { handle }) }
    const onEnd = (e: Event) => { if ((e.target as HTMLElement)?.tagName === "VIDEO") trackFunnel("video_end", undefined, { handle }) }
    document.addEventListener("play", onPlay, true)
    document.addEventListener("ended", onEnd, true)

    const t30 = setTimeout(() => trackFunnel("time_30s", undefined, { handle }), 30000)
    const t90 = setTimeout(() => trackFunnel("time_90s", undefined, { handle }), 90000)

    let left = false
    const leave = () => {
      if (left) return
      left = true
      trackFunnel("leave", Math.round((Date.now() - start) / 1000), { handle })
    }
    const onVis = () => { if (document.visibilityState === "hidden") leave() }
    document.addEventListener("visibilitychange", onVis)
    window.addEventListener("pagehide", leave)

    return () => {
      window.removeEventListener("scroll", onScroll)
      document.removeEventListener("play", onPlay, true)
      document.removeEventListener("ended", onEnd, true)
      document.removeEventListener("visibilitychange", onVis)
      window.removeEventListener("pagehide", leave)
      clearTimeout(t30); clearTimeout(t90)
      leave()
    }
  }, [handle])
  return null
}
