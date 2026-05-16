import { Module } from "@medusajs/framework/utils"
import CskhAnalysisService from "./service"

export const CSKH_ANALYSIS_MODULE = "cskhAnalysisModule"

export default Module(CSKH_ANALYSIS_MODULE, {
  service: CskhAnalysisService,
})
