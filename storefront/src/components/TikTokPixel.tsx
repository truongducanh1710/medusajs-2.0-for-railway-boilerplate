"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"
import { loadTikTokPixel, ttqPage } from "@lib/tiktok"

// Loads TikTok pixel once and fires page() on every client-side route change
export default function TikTokPixel() {
  const pathname = usePathname()

  useEffect(() => {
    loadTikTokPixel()
  }, [])

  useEffect(() => {
    ttqPage()
  }, [pathname])

  return null
}
