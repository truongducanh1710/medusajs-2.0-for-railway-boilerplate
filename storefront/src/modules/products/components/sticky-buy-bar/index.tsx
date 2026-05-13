"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { HttpTypes } from "@medusajs/types"
import { addToCart } from "@lib/data/cart"
import { useParams } from "next/navigation"

type Props = {
  product: HttpTypes.StoreProduct
  region: HttpTypes.StoreRegion
  anchorId: string
  // Social proof config từ product metadata
  socialEnabled?: boolean
  socialDelaySec?: number
  socialIntervalSec?: number
  socialDisplaySec?: number
}

function formatVND(amount: number) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(amount)) + "đ"
}

const FIRST_NAMES = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Vũ", "Đặng", "Bùi", "Đỗ", "Ngô"]
const MIDDLE_NAMES = ["Thị", "Văn", "Thị", "Thị", "Văn", "Thị", "Văn", "Thị"]
const LAST_NAMES = ["Lan", "Nam", "Hoa", "Linh", "Dũng", "Mai", "Hằng", "Tuấn", "Nga", "Hùng", "Thu", "Minh"]
const CITIES = ["Hà Nội", "TP.HCM", "Đà Nẵng", "Hải Phòng", "Cần Thơ", "Huế", "Nha Trang", "Vũng Tàu", "Bình Dương", "Đồng Nai"]
const AVATARS = ["👩", "👨", "👩‍🦱", "👨‍🦰", "👩‍🦳", "🧑", "👩‍🦰", "👨‍🦲"]

function rand<T>(arr: T[]) { return arr[Math.floor(Math.random() * arr.length)] }
function genName() {
  return `${rand(FIRST_NAMES)} ${rand(MIDDLE_NAMES).charAt(0)}. ${rand(LAST_NAMES)}`
}
function timeLabel(mins: number) {
  if (mins <= 1) return "vừa xong"
  if (mins < 60) return `${mins} phút trước`
  return `${Math.floor(mins / 60)} giờ trước`
}

export default function StickyBuyBar({
  product, region, anchorId,
  socialEnabled = true,
  socialDelaySec = 12,
  socialIntervalSec = 30,
  socialDisplaySec = 5,
}: Props) {
  const [visible, setVisible] = useState(false)
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState(false)
  const params = useParams()
  const countryCode = params.countryCode as string

  // Social proof state
  const [proof, setProof] = useState<{ name: string; city: string; avatar: string; mins: number } | null>(null)
  const [proofVisible, setProofVisible] = useState(false)
  const proofTimer = useRef<ReturnType<typeof setTimeout>>()

  const variant = product.variants?.[0]
  const medusaPrice =
    variant?.calculated_price?.calculated_amount ??
    variant?.prices?.[0]?.amount ?? 0

  // Đọc bundle price từ metadata — ưu tiên bundle_options_v2, fallback v1
  function getBundleStartPrice(): number | null {
    try {
      const v2 = product.metadata?.bundle_options_v2 as string
      if (v2) {
        const parsed = JSON.parse(v2)
        const prices: number[] = []
        for (const vv of (parsed.variants || [])) {
          const qty1 = (vv.options || []).find((o: any) => o.qty === 1) || vv.options?.[0]
          if (qty1?.price) prices.push(qty1.price)
        }
        if (prices.length > 0) return Math.min(...prices)
      }
    } catch {}
    try {
      const v1 = product.metadata?.bundle_options as string
      if (v1) {
        const parsed = JSON.parse(v1)
        const qty1 = parsed.find((o: any) => o.qty === 1) || parsed[0]
        if (qty1?.price) return qty1.price
      }
    } catch {}
    return null
  }

  const basePrice = getBundleStartPrice() ?? medusaPrice

  // StickyBar visibility
  useEffect(() => {
    const anchor = document.getElementById(anchorId)
    if (!anchor) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        const isVisible = !entry.isIntersecting
        setVisible(isVisible)
        const barEl = document.querySelector("[data-sticky-bar]") as HTMLElement
        const barHeight = barEl ? barEl.offsetHeight : 64
        window.dispatchEvent(new CustomEvent("sticky-bar-visible", { detail: isVisible ? barHeight : 0 }))
      },
      { threshold: 0, rootMargin: "0px" }
    )
    observer.observe(anchor)
    return () => observer.disconnect()
  }, [anchorId])

  // Social proof timing
  const showProof = useCallback(() => {
    setProof({
      name: genName(),
      city: rand(CITIES),
      avatar: rand(AVATARS),
      mins: Math.floor(Math.random() * 28) + 1,
    })
    setProofVisible(true)
    clearTimeout(proofTimer.current)
    proofTimer.current = setTimeout(() => setProofVisible(false), socialDisplaySec * 1000)
  }, [socialDisplaySec])

  useEffect(() => {
    if (!socialEnabled) return
    const first = setTimeout(showProof, socialDelaySec * 1000)
    const interval = setInterval(showProof, socialIntervalSec * 1000)
    return () => { clearTimeout(first); clearInterval(interval); clearTimeout(proofTimer.current) }
  }, [socialEnabled, socialDelaySec, socialIntervalSec, showProof])

  const handleBuy = async () => {
    if (!variant?.id) {
      document.getElementById(anchorId)?.scrollIntoView({ behavior: "smooth" })
      return
    }
    setAdding(true)
    try {
      await addToCart({ variantId: variant.id, quantity: 1, countryCode } as any)
      setAdded(true)
      setTimeout(() => setAdded(false), 2500)
    } catch {}
    finally { setAdding(false) }
  }

  const scrollToBuy = () => {
    document.getElementById(anchorId)?.scrollIntoView({ behavior: "smooth" })
  }

  if (!basePrice) return null

  return (
    <div
      data-sticky-bar
      className={`lg:hidden fixed bottom-0 inset-x-0 z-40 transition-transform duration-300 ${
        visible ? "translate-y-0" : "translate-y-full"
      }`}
    >
      {/* Social Proof row — absolute above StickyBar, không chiếm height */}
      {socialEnabled && proof && (
        <div
          style={{
            position: "absolute",
            bottom: "100%",
            left: 0,
            right: 0,
            transform: proofVisible ? "translateY(0)" : "translateY(100%)",
            opacity: proofVisible ? 1 : 0,
            transition: "transform 0.35s cubic-bezier(.34,1.2,.64,1), opacity 0.3s",
            background: "rgba(255,255,255,0.96)",
            borderTop: "1px solid #f1f5f9",
            padding: "6px 12px",
            display: "flex",
            alignItems: "center",
            gap: 7,
          }}
        >
          <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>{proof.avatar}</span>
          <span style={{ fontSize: 12, color: "#374151", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <span style={{ fontWeight: 700 }}>{proof.name}</span>
            {" "}vừa đặt{" "}
            <span style={{ fontWeight: 700, color: "#E8420A" }}>{product.title}</span>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
            <span style={{ fontSize: 11, color: "#94a3b8" }}>{timeLabel(proof.mins)}</span>
          </span>
          <button
            onClick={() => setProofVisible(false)}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#cbd5e1", padding: "0 0 0 4px", lineHeight: 1, flexShrink: 0 }}
          >✕</button>
        </div>
      )}

      {/* Main buy bar */}
      <div className="bg-white border-t border-gray-200 shadow-[0_-4px_16px_rgba(0,0,0,0.10)]">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-gray-400 font-medium leading-none mb-0.5 truncate">
              {product.title}
            </p>
            <p className="text-lg font-black text-gray-900 leading-none">
              {formatVND(basePrice)}
            </p>
          </div>

          <button
            onClick={scrollToBuy}
            className="flex-shrink-0 h-12 px-4 rounded-xl border-2 border-blue-600 text-blue-600 font-bold text-sm whitespace-nowrap"
          >
            Chọn gói
          </button>

          <button
            onClick={handleBuy}
            disabled={adding || added}
            className={`flex-shrink-0 h-12 px-5 rounded-xl font-black text-sm text-white whitespace-nowrap transition-colors ${
              added ? "bg-green-500" : "bg-blue-600 active:bg-blue-700"
            } disabled:opacity-70`}
          >
            {added ? "✅ Đã thêm!" : adding ? "..." : "🛒 Mua ngay"}
          </button>
        </div>
        <div className="bg-white" style={{ height: "env(safe-area-inset-bottom, 0px)" }} />
      </div>
    </div>
  )
}
