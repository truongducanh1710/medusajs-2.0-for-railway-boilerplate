"use client"

import { useEffect } from "react"

type Props = { context: string; productName: string }

export default function ProductChatContextInjector({ context, productName }: Props) {
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("chatbot-set-context", { detail: context }))
    window.dispatchEvent(new CustomEvent("socialproof-set-product", { detail: productName }))
    return () => {
      window.dispatchEvent(new CustomEvent("chatbot-set-context", { detail: "" }))
      window.dispatchEvent(new CustomEvent("socialproof-set-product", { detail: "" }))
    }
  }, [context, productName])

  return null
}
