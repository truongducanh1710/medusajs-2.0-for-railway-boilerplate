"use client"

import { useEffect, useRef } from "react"

/**
 * Muted looping clip used like a GIF (much lighter). Plays only while on screen so a page with
 * several clips doesn't decode them all at once; falls back to the poster when autoplay is blocked.
 */
export default function LoopVideo({ src, poster, alt, eager = false, className = "" }: {
  src: string
  poster?: string
  alt: string
  eager?: boolean
  className?: string
}) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = ref.current
    if (!video || typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) video.play().catch(() => {})
      else video.pause()
    }, { threshold: 0.25 })
    observer.observe(video)
    return () => observer.disconnect()
  }, [])

  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      aria-label={alt}
      muted
      loop
      playsInline
      autoPlay={eager}
      preload={eager ? "auto" : "metadata"}
      className={className}
    />
  )
}
