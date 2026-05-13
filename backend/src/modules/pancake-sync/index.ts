import { Module } from "@medusajs/framework/utils"
import PancakeSyncService from "./service"

export const PANCAKE_SYNC_MODULE = "pancakeSyncModule"

export default Module(PANCAKE_SYNC_MODULE, {
  service: PancakeSyncService,
})
