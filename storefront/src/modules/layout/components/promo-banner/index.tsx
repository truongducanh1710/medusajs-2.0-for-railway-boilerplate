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

  const isOverride = messages !== DEFAULT_MESSAGES

  return (
    <div
      className="text-white text-xs sm:text-sm font-bold text-center py-2 px-4 tracking-wide overflow-hidden h-8 sm:h-9 flex items-center justify-center relative"
      style={{
        background: isOverride
          ? "linear-gradient(90deg, #ea580c, #f97316, #ea580c)"
          : "#f97316",
        backgroundSize: isOverride ? "200% 100%" : "100% 100%",
        animation: isOverride ? "promoBgSlide 2s linear infinite" : undefined,
      }}
    >
      {/* Shimmer sweep */}
      {isOverride && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.25) 50%, transparent 60%)",
            animation: "promoShimmer 2.2s ease-in-out infinite",
            pointerEvents: "none",
          }}
        />
      )}

      <style>{`
        @keyframes promoBgSlide {
          0%   { background-position: 0% 0%; }
          50%  { background-position: 100% 0%; }
          100% { background-position: 0% 0%; }
        }
        @keyframes promoShimmer {
          0%   { transform: translateX(-100%); }
          60%  { transform: translateX(200%); }
          100% { transform: translateX(200%); }
        }
      `}</style>

      <span
        style={{
          display: "inline-block",
          position: "relative",
          transition: "opacity 0.4s, transform 0.4s",
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(-8px)",
        }}
      >
        {messages[index]}
      </span>
    </div>
  )
}
