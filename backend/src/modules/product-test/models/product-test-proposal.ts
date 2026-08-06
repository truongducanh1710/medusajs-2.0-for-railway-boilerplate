import { model } from "@medusajs/framework/utils";

const ProductTestProposal = model.define("product_test_proposal", {
  id: model.id().primaryKey(),
  case_id: model.text(),
  usp: model.text().nullable(),
  combo_json: model.text().nullable(),
  sale_price: model.number().nullable(),
  gift_name: model.text().nullable(),
  promo_title: model.text().nullable(),
  ad_content: model.text().nullable(),
  reference_link: model.text().nullable(),
  landing_url: model.text().nullable(),
  note: model.text().nullable(),
  approved_by: model.text().nullable(),
  approved_at: model.dateTime().nullable(),
});

export default ProductTestProposal;
