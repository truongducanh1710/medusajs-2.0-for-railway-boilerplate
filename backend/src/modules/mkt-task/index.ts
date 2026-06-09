import { Module } from "@medusajs/framework/utils"
import MktTaskModuleService from "./service"

export const MKT_TASK_MODULE = "mktTaskModule"

export default Module(MKT_TASK_MODULE, {
  service: MktTaskModuleService,
})
