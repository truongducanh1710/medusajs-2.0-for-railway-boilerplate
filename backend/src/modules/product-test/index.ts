import { Module } from "@medusajs/framework/utils";
import ProductTestModuleService from "./service";

export const PRODUCT_TEST_MODULE = "productTestModule";

export default Module(PRODUCT_TEST_MODULE, {
  service: ProductTestModuleService,
});
