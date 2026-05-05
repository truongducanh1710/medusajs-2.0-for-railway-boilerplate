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
  delaySec?: number
  enabled?: boolean
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
  intervalSec = 30,
  displaySec = 5,
  delaySec = 12,
  enabled: enabledProp = true,
}: Props) {
  const [current, setCurrent] = useState<Notification | null>(null)
  const [visible, setVisible] = useState(false)
  const [enabled, setEnabled] = useState(enabledProp)
  const activeProducts = products
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => { setEnabled(enabledProp) }, [enabledProp])

  useEffect(() => {
    if (!enabled) return

    const show = () => {
      const notif = generateNotification(activeProducts)
      setCurrent(notif)
      setVisible(true)
      timerRef.current = setTimeout(() => setVisible(false), displaySec * 1000)
    }

    const first = setTimeout(show, delaySec * 1000)
    const interval = setInterval(show, intervalSec * 1000)

    return () => {
      clearTimeout(first)
      clearInterval(interval)
      clearTimeout(timerRef.current)
    }
  }, [enabled, activeProducts, intervalSec, displaySec, delaySec])

  if (!enabled || !current) return null

  return (
    <div
      style={{
        position: "fixed",
        bottom: 90,
        left: 0,
        right: 0,
        zIndex: 9997,
        transform: visible ? "translateY(0)" : "translateY(20px)",
        opacity: visible ? 1 : 0,
        transition: "all 0.35s cubic-bezier(.34,1.2,.64,1)",
        pointerEvents: visible ? "auto" : "none",
        display: "flex",
        justifyContent: "flex-start",
        paddingLeft: 12,
        paddingRight: 140,
      }}
    >
      <div
        style={{
          background: "rgba(255,255,255,0.97)",
          borderRadius: 40,
          boxShadow: "0 2px 12px rgba(0,0,0,0.12)",
          border: "1px solid #f1f5f9",
          padding: "6px 12px 6px 8px",
          display: "flex",
          alignItems: "center",
          gap: 7,
          maxWidth: 320,
        }}
      >
        {/* Avatar nhỏ */}
        <div style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: "linear-gradient(135deg,#fff7ed,#ffedd5)",
          border: "1.5px solid #fed7aa",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 15,
          flexShrink: 0,
        }}>
          {current.avatar}
        </div>

        {/* Text 1 dòng */}
        <span style={{ fontSize: 12, color: "#374151", lineHeight: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          <span style={{ fontWeight: 700 }}>{current.name}</span>
          {" "}vừa đặt{" "}
          <span style={{ fontWeight: 700, color: "#E8420A" }}>{current.product}</span>
          {" · "}
          <span style={{ color: "#94a3b8" }}>{timeLabel(current.minsAgo)}</span>
        </span>

        {/* Dot xanh */}
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", flexShrink: 0 }} />

        {/* Close */}
        <button
          onClick={() => setVisible(false)}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#cbd5e1", padding: 0, lineHeight: 1, flexShrink: 0 }}
        >
          ✕
        </button>
      </div>
    </div>
  )
}
