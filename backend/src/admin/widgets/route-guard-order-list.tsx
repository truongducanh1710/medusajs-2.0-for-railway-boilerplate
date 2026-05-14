import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { RouteGuard } from "../components/route-guard"
export const config = defineWidgetConfig({ zone: "order.list.before" })
export default RouteGuard
