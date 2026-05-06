"use client"

import { useEffect, useState } from "react"

export default function ViewerCount() {
  const [count, setCount] = useState(0)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Start with a realistic number based on time of day
    const hour = new Date().getHours()
    const base = hour >= 8 && hour <= 22 ? 18 : 6
    const initial = base + Math.floor(Math.random() * 20)
    setCount(initial)
    setVisible(true)

    // Fluctuate ±1-2 every 8-15 seconds
    const tick = () => {
      setCount(c => {
        const delta = Math.random() > 0.5 ? 1 : -1
        return Math.max(base - 4, Math.min(base + 30, c + delta))
      })
    }

    const interval = setInterval(tick, 8000 + Math.random() * 7000)
    return () => clearInterval(interval)
  }, [])

  if (!visible) return null

  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        style={{
          display: "inline-block",
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "#22c55e",
          boxShadow: "0 0 0 3px rgba(34,197,94,0.25)",
          animation: "pulse 2s infinite",
          flexShrink: 0,
        }}
      />
      <span className="text-gray-600">
        <span className="font-bold text-gray-800">{count}</span> người đang xem sản phẩm này
      </span>
    </div>
  )
}
