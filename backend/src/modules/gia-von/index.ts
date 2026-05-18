import { Module } from "@medusajs/framework/utils"
import GiaVonModuleService from "./service"

export const GIA_VON_MODULE = "giaVonModule"

export default Module(GIA_VON_MODULE, {
  service: GiaVonModuleService,
})
