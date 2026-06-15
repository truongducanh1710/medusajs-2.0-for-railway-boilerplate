"use client"

import { useEffect } from "react"

export default function PromoOverride({ messages }: { messages: string[] }) {
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("promo-override", { detail: messages }))
    return () => {
      window.dispatchEvent(new CustomEvent("promo-override", { detail: null }))
    }
  }, [])

  return null
}
