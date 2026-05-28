import { Module } from "@medusajs/framework/utils"
import WebTrackingService from "./service"

export const WEB_TRACKING_MODULE = "webTrackingModule"

export default Module(WEB_TRACKING_MODULE, {
  service: WebTrackingService,
})
