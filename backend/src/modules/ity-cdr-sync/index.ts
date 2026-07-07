import { Module } from "@medusajs/framework/utils"
import ItyCdrSyncService from "./service"

export const ITY_CDR_SYNC_MODULE = "ityCdrSyncModule"

export default Module(ITY_CDR_SYNC_MODULE, {
  service: ItyCdrSyncService,
})
