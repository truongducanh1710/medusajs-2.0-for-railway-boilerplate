import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { RouteGuard } from "../components/route-guard"
export const config = defineWidgetConfig({ zone: "login.before" })
export default RouteGuard
