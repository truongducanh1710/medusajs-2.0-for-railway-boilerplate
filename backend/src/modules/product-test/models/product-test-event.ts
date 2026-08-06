import { model } from "@medusajs/framework/utils";

const ProductTestEvent = model.define("product_test_event", {
  id: model.id().primaryKey(),
  case_id: model.text(),
  action: model.text(),
  from_status: model.text().nullable(),
  to_status: model.text().nullable(),
  actor: model.text(),
  comment: model.text().nullable(),
  snapshot: model.json().nullable(),
});

export default ProductTestEvent;
