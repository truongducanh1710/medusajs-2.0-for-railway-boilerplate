"use client"

import { useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { saveUtmToCookie } from "@lib/utm"

export default function UtmCapture() {
  const searchParams = useSearchParams()

  useEffect(() => {
    saveUtmToCookie(searchParams as unknown as URLSearchParams)
  }, [])

  return null
}
