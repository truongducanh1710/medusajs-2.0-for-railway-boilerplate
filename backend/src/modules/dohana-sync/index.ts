import { Module } from "@medusajs/framework/utils"
import DohanaSyncService from "./service"

export const DOHANA_SYNC_MODULE = "dohanaSyncModule"

export default Module(DOHANA_SYNC_MODULE, {
  service: DohanaSyncService,
})
