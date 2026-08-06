import { model } from "@medusajs/framework/utils";

const ProductTestCase = model.define("product_test_case", {
  id: model.id().primaryKey(),
  code: model.text(),
  product_name: model.text(),
  product_handle: model.text().nullable(),
  marketer_email: model.text(),
  marketer_name: model.text(),
  assignee_email: model.text(),
  assignee_name: model.text(),
  purchaser_email: model.text().nullable(),
  purchaser_name: model.text().nullable(),
  status: model.text().default("draft"),
  version: model.number().default(1),
  final_decision: model.text().nullable(),
  final_note: model.text().nullable(),
  decided_by: model.text().nullable(),
  decided_at: model.dateTime().nullable(),
  source_case_id: model.text().nullable(),
});

export default ProductTestCase;
