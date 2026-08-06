import { MedusaService } from "@medusajs/framework/utils";
import ProductTestCase from "./models/product-test-case";
import ProductPurchaseCheck from "./models/product-purchase-check";
import ProductTestProposal from "./models/product-test-proposal";
import ProductTestDailyResult from "./models/product-test-daily-result";
import ProductTestEvent from "./models/product-test-event";

class ProductTestModuleService extends MedusaService({
  ProductTestCase,
  ProductPurchaseCheck,
  ProductTestProposal,
  ProductTestDailyResult,
  ProductTestEvent,
}) {}

export default ProductTestModuleService;
