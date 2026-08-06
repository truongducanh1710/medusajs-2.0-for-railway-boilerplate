import { model } from "@medusajs/framework/utils";

const ProductPurchaseCheck = model.define("product_purchase_check", {
  id: model.id().primaryKey(),
  case_id: model.text(),
  supplier_link: model.text().nullable(),
  supplier_name: model.text().nullable(),
  description: model.text().nullable(),
  specification: model.text().nullable(),
  unit: model.text().nullable(),
  moq: model.number().nullable(),
  source_price: model.number().nullable(),
  currency: model.text().default("CNY"),
  exchange_rate: model.number().nullable(),
  weight_kg: model.number().nullable(),
  size: model.text().nullable(),
  quantity_per_carton: model.number().nullable(),
  shipping_fee: model.number().nullable(),
  other_cost: model.number().nullable(),
  landed_cost: model.number().nullable(),
  landed_price_per_unit: model.number().nullable(),
  conclusion: model.text().nullable(),
  note: model.text().nullable(),
  image_urls: model.json().default([] as any),
  representative_image_url: model.text().nullable(),
  checked_by: model.text().nullable(),
  checked_at: model.dateTime().nullable(),
});

export default ProductPurchaseCheck;
