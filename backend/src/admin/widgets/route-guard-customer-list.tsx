import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { RouteGuard } from "../components/route-guard"
export const config = defineWidgetConfig({ zone: "customer.list.before" })
export default RouteGuard
