import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { RouteGuard } from "../components/route-guard"
export const config = defineWidgetConfig({ zone: "product.details.before" })
export default RouteGuard
