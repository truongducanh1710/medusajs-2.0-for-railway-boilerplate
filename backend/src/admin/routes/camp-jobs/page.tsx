import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useEffect } from "react"

export default function CampJobsRedirect() {
  useEffect(() => {
    window.location.replace("/app/bao-cao-mkt")
  }, [])
  return null
}

export const config = defineRouteConfig({
  label: "Camp Jobs",
  icon: () => null,
})
