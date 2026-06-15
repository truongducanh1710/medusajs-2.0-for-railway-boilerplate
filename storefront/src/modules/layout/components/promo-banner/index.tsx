"use client"

import { useState, useEffect, useRef } from "react"

const DEFAULT_MESSAGES = [
  "🚚 Miễn phí vận chuyển toàn quốc cho mọi đơn hàng",
  "🔄 Đổi trả 7 ngày không cần lý do — hoàn tiền 100%",
  "⭐ 50.000+ khách hàng tin dùng sản phẩm Phan Việt",
  "🛡️ Bảo hành chính hãng 12 tháng — hỗ trợ 24/7",
  "💳 Giảm thêm 20.000đ khi thanh toán QR chuyển khoản",
]

export default function PromoBanner() {
  const [messages, setMessages] = useState(DEFAULT_MESSAGES)
  const [index, setIndex] = useState(0)
  const [visible, setVisible] = useState(true)
  const intervalRef = useRef<ReturnType<typeof setInterval>>()

  // Lắng nghe override từ product page
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      setMessages(detail ?? DEFAULT_MESSAGES)
      setIndex(0)
    }
    window.addEventListener("promo-override", handler)
    return () => window.removeEventListener("promo-override", handler)
  }, [])

  useEffect(() => {
    clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => {
      setVisible(false)
      setTimeout(() => {
        setIndex(i => (i + 1) % messages.length)
        setVisible(true)
      }, 400)
    }, 3500)
    return () => clearInterval(intervalRef.current)
  }, [messages])

  return (
    <div className="bg-orange-500 text-white text-xs sm:text-sm font-bold text-center py-2 px-4 tracking-wide overflow-hidden h-8 sm:h-9 flex items-center justify-center">
      <span
        style={{
          display: "inline-block",
          transition: "opacity 0.4s, transform 0.4s",
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(-8px)",
        }}
      >
        {PROMO_MESSAGES[index]}
      </span>
    </div>
  )
}
