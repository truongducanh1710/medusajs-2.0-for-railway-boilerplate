"use client"

import { useEffect } from "react"

export default function ProductChatContextInjector({ context }: { context: string }) {
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("chatbot-set-context", { detail: context }))
    return () => {
      // Reset context khi rời trang sản phẩm
      window.dispatchEvent(new CustomEvent("chatbot-set-context", { detail: "" }))
    }
  }, [context])

  return null
}
