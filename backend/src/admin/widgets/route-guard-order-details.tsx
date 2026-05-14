import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { RouteGuard } from "../components/route-guard"
export const config = defineWidgetConfig({ zone: "order.details.before" })
export default RouteGuard
