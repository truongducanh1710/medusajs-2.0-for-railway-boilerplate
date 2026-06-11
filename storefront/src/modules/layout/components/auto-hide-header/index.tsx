"use client"

import { useEffect, useRef, useState } from "react"

// Bọc header fixed: ẩn khi cuộn xuống, hiện lại khi cuộn lên
// để giải phóng không gian content trên mobile
export default function AutoHideHeader({
  children,
}: {
  children: React.ReactNode
}) {
  const [hidden, setHidden] = useState(false)
  const lastY = useRef(0)
  const ticking = useRef(false)

  useEffect(() => {
    const onScroll = () => {
      if (ticking.current) return
      ticking.current = true
      requestAnimationFrame(() => {
        const y = window.scrollY
        const delta = y - lastY.current

        if (y < 80) {
          // Gần đỉnh trang — luôn hiện
          setHidden(false)
        } else if (delta > 8) {
          setHidden(true)
        } else if (delta < -8) {
          setHidden(false)
        }

        lastY.current = y
        ticking.current = false
      })
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <div
      className={`fixed top-0 inset-x-0 z-50 transition-transform duration-300 ${
        hidden ? "-translate-y-full" : "translate-y-0"
      }`}
    >
      {children}
    </div>
  )
}
