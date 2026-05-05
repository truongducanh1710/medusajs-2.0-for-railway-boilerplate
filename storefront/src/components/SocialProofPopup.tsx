"use client"

import { useState, useEffect, useRef } from "react"

type Notification = {
  avatar: string
  name: string
  city: string
  product: string
  qty?: number
  minsAgo: number
}

const AVATARS = ["👩", "👨", "👩‍🦱", "👨‍🦰", "👩‍🦳", "👨‍🦲", "🧑", "👩‍🦰"]
const FIRST_NAMES = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Vũ", "Đặng", "Bùi", "Đỗ", "Ngô"]
const MIDDLE_NAMES = ["Thị", "Văn", "Thị", "Thị", "Văn", "Thị", "Văn", "Thị"]
const LAST_NAMES = ["Lan", "Nam", "Hoa", "Linh", "Dũng", "Mai", "Hằng", "Tuấn", "Nga", "Hùng", "Thu", "Minh"]
const CITIES = ["Hà Nội", "TP.HCM", "Đà Nẵng", "Hải Phòng", "Cần Thơ", "Huế", "Nha Trang", "Vũng Tàu", "Bình Dương", "Đồng Nai", "Long An", "Hà Nam"]

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function generateNotification(products: string[]): Notification {
  const first = randomFrom(FIRST_NAMES)
  const mid = randomFrom(MIDDLE_NAMES)
  const last = randomFrom(LAST_NAMES)
  const abbr = `${first} ${mid.charAt(0)}. ${last}`
  return {
    avatar: randomFrom(AVATARS),
    name: abbr,
    city: randomFrom(CITIES),
    product: randomFrom(products),
    qty: Math.random() > 0.5 ? Math.floor(Math.random() * 2) + 1 : undefined,
    minsAgo: Math.floor(Math.random() * 28) + 1,
  }
}

function timeLabel(mins: number) {
  if (mins <= 1) return "vừa xong"
  if (mins < 60) return `${mins} phút trước`
  return `${Math.floor(mins / 60)} giờ trước`
}

type Props = {
  products?: string[]
  intervalSec?: number
  displaySec?: number
}

const DEFAULT_PRODUCTS = [
  "Hộp Nhựa Nhiều Ngăn",
  "Chảo Vàng Cao Cấp",
  "Nồi Chiên Không Dầu",
  "Bộ Dao Nhà Bếp",
  "Máy Xay Sinh Tố",
]

export default function SocialProofPopup({
  products = DEFAULT_PRODUCTS,
  intervalSec = 18,
  displaySec = 5,
}: Props) {
  const [current, setCurrent] = useState<Notification | null>(null)
  const [visible, setVisible] = useState(false)
  const [enabled, setEnabled] = useState(true)
  const [activeProducts, setActiveProducts] = useState<string[]>(products)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  // Lắng nghe product page inject tên SP đang xem
  useEffect(() => {
    const handler = (e: Event) => {
      const name = (e as CustomEvent<string>).detail
      setActiveProducts(name ? [name] : products)
    }
    window.addEventListener("socialproof-set-product", handler)
    return () => window.removeEventListener("socialproof-set-product", handler)
  }, [products])

  // Check store metadata để biết marketer đã tắt chưa
  useEffect(() => {
    fetch("/api/chat", { method: "HEAD" }).catch(() => {}) // warm up
    fetch("/store/info", { headers: { "x-publishable-api-key": process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY || "" } })
      .then(r => r.json())
      .then(d => {
        if (d?.store?.metadata?.social_proof_enabled === "false") setEnabled(false)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!enabled) return

    const show = () => {
      const notif = generateNotification(activeProducts)
      setCurrent(notif)
      setVisible(true)
      timerRef.current = setTimeout(() => setVisible(false), displaySec * 1000)
    }

    // Delay lần đầu 4s
    const first = setTimeout(show, 4000)
    const interval = setInterval(show, intervalSec * 1000)

    return () => {
      clearTimeout(first)
      clearInterval(interval)
      clearTimeout(timerRef.current)
    }
  }, [enabled, activeProducts, intervalSec, displaySec])

  if (!enabled || !current) return null

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        left: 16,
        zIndex: 9997,
        transform: visible ? "translateY(0) scale(1)" : "translateY(80px) scale(0.95)",
        opacity: visible ? 1 : 0,
        transition: "all 0.4s cubic-bezier(.34,1.4,.64,1)",
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 16,
          boxShadow: "0 4px 24px rgba(0,0,0,0.13)",
          border: "1px solid #f1f5f9",
          padding: "10px 14px 10px 12px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          maxWidth: 280,
          minWidth: 220,
          position: "relative",
        }}
      >
        {/* Close */}
        <button
          onClick={() => setVisible(false)}
          style={{
            position: "absolute",
            top: 6,
            right: 8,
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 13,
            color: "#94a3b8",
            lineHeight: 1,
            padding: 0,
          }}
        >
          ✕
        </button>

        {/* Avatar */}
        <div style={{
          width: 42,
          height: 42,
          borderRadius: "50%",
          background: "linear-gradient(135deg,#fff7ed,#ffedd5)",
          border: "2px solid #fed7aa",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 22,
          flexShrink: 0,
        }}>
          {current.avatar}
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, color: "#1e293b", lineHeight: 1.4 }}>
            <span style={{ fontWeight: 700 }}>{current.name}</span>
            <span style={{ color: "#64748b" }}> ({current.city})</span>
          </div>
          <div style={{ fontSize: 12, color: "#374151", marginTop: 2, lineHeight: 1.35 }}>
            vừa đặt{current.qty ? ` ${current.qty}x` : ""}{" "}
            <span style={{ fontWeight: 700, color: "#E8420A" }}>
              {current.product}
            </span>
          </div>
          <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", display: "inline-block", flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "#94a3b8" }}>{timeLabel(current.minsAgo)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
