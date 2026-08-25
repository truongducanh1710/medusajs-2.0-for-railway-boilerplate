import { model } from "@medusajs/framework/utils";

const ProductTestDailyResult = model.define("product_test_daily_result", {
  id: model.id().primaryKey(),
  case_id: model.text(),
  test_date: model.dateTime(),
  tester_name: model.text(),
  campaign_name: model.text().nullable(),
  ad_spend: model.number().nullable(),
  impressions: model.number().nullable(),
  clicks: model.number().nullable(),
  leads: model.number().nullable(),
  orders: model.number().nullable(),
  cancelled_orders: model.number().nullable(),
  revenue: model.number().nullable(),
  // Leader chốt: Đạt / Cần test thêm / Không đạt
  evaluation: model.text().nullable(),
  leader_note: model.text().nullable(),
  evaluated_by: model.text().nullable(),
  evaluated_at: model.dateTime().nullable(),
  // MKT tự nhận định trước: test_tiep / dung / de_xuat_nhap
  mkt_decision: model.text().nullable(),
  mkt_note: model.text().nullable(),
  mkt_decided_by: model.text().nullable(),
  mkt_decided_at: model.dateTime().nullable(),
  version: model.number().default(1),
});

export default ProductTestDailyResult;
