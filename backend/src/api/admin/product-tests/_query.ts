import type { Pool, PoolClient } from "pg";
import { aggregateMetrics } from "../../../modules/product-test/kpi";
import {
  PRODUCT_TEST_STATUSES,
  PRODUCT_TEST_TRANSITIONS,
} from "../../../modules/product-test/state-machine";
import { actorHas, PRODUCT_TEST_PERMS, type ProductTestActor } from "./_lib";

type Db = Pool | PoolClient;

export function numberOrNull(value: any): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function mapPurchase(row: any) {
  if (!row) return null;
  return {
    ...row,
    moq: numberOrNull(row.moq),
    source_price: numberOrNull(row.source_price),
    exchange_rate: numberOrNull(row.exchange_rate),
    weight_kg: numberOrNull(row.weight_kg),
    quantity_per_carton: numberOrNull(row.quantity_per_carton),
    shipping_fee: numberOrNull(row.shipping_fee),
    other_cost: numberOrNull(row.other_cost),
    landed_cost: numberOrNull(row.landed_cost),
    landed_price_per_unit: numberOrNull(row.landed_price_per_unit),
    image_urls: Array.isArray(row.image_urls) ? row.image_urls : [],
  };
}

export function mapProposal(row: any) {
  if (!row) return null;
  return { ...row, sale_price: numberOrNull(row.sale_price) };
}

export function mapDaily(row: any) {
  return {
    ...row,
    test_date: row.test_date
      ? new Date(row.test_date).toISOString().slice(0, 10)
      : "",
    ad_spend: numberOrNull(row.ad_spend),
    impressions: numberOrNull(row.impressions),
    clicks: numberOrNull(row.clicks),
    leads: numberOrNull(row.leads),
    orders: numberOrNull(row.orders),
    cancelled_orders: numberOrNull(row.cancelled_orders),
    revenue: numberOrNull(row.revenue),
    version: Number(row.version) || 1,
  };
}

export async function getCaseBundle(db: Db, id: string) {
  const caseResult = await db.query(
    `SELECT * FROM product_test_case WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  const productCase = caseResult.rows[0];
  if (!productCase) return null;
  const [purchaseResult, proposalResult, dailyResult, eventResult] =
    await Promise.all([
      db.query(
        `SELECT * FROM product_purchase_check WHERE case_id = $1 AND deleted_at IS NULL LIMIT 1`,
        [id],
      ),
      db.query(
        `SELECT * FROM product_test_proposal WHERE case_id = $1 AND deleted_at IS NULL LIMIT 1`,
        [id],
      ),
      db.query(
        `SELECT * FROM product_test_daily_result WHERE case_id = $1 AND deleted_at IS NULL ORDER BY test_date DESC, created_at DESC`,
        [id],
      ),
      db.query(
        `SELECT * FROM product_test_event WHERE case_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200`,
        [id],
      ),
    ]);
  return {
    case: { ...productCase, version: Number(productCase.version) || 1 },
    purchase_check: mapPurchase(purchaseResult.rows[0]),
    proposal: mapProposal(proposalResult.rows[0]),
    daily_results: dailyResult.rows.map(mapDaily),
    events: eventResult.rows,
  };
}

export function permissionsFor(actor: ProductTestActor) {
  return {
    can_view_all: actorHas(actor, PRODUCT_TEST_PERMS.view),
    can_edit_marketing: actorHas(actor, PRODUCT_TEST_PERMS.marketing),
    can_edit_purchase: actorHas(actor, PRODUCT_TEST_PERMS.purchasing),
    can_approve: actorHas(actor, PRODUCT_TEST_PERMS.approve),
    can_reassign: actorHas(actor, PRODUCT_TEST_PERMS.approve),
  };
}

/**
 * Hành động khả dụng, lọc theo quyền ứng với `role` của từng transition:
 * mark_not_viable là của MKT (dừng trước khi test), ba cái còn lại là kết luận
 * của leader. Quyền sở hữu hồ sơ không còn hạn chế gì — có quyền là làm được.
 */
export function availableActions(actor: ProductTestActor, productCase: any) {
  return Object.entries(PRODUCT_TEST_TRANSITIONS)
    .filter(([, transition]) => {
      if (!transition.from.includes(productCase.status)) return false;
      const perm =
        transition.role === "marketing"
          ? PRODUCT_TEST_PERMS.marketing
          : PRODUCT_TEST_PERMS.approve;
      return actorHas(actor, perm);
    })
    .map(([id, transition]) => ({ id, next_status: transition.to }));
}

export function buildSummary(
  productCase: any,
  purchase: any,
  proposal: any,
  dailyRows: any[],
) {
  const daily = dailyRows.map(mapDaily);
  const metrics = aggregateMetrics(daily);
  const imageUrls = Array.isArray(purchase?.image_urls)
    ? purchase.image_urls
    : [];
  const latestDate = daily.reduce<string | null>(
    (latest, row) =>
      !latest || row.test_date > latest ? row.test_date : latest,
    null,
  );
  return {
    id: productCase.id,
    code: productCase.code,
    product_name: productCase.product_name,
    product_handle: productCase.product_handle || "",
    marketer_email: productCase.marketer_email,
    marketer_name: productCase.marketer_name,
    assignee_email: productCase.assignee_email,
    assignee_name: productCase.assignee_name,
    purchaser_name: productCase.purchaser_name || null,
    status: productCase.status,
    version: Number(productCase.version) || 1,
    final_decision: productCase.final_decision || null,
    final_note: productCase.final_note || "",
    decided_by: productCase.decided_by || "",
    decided_at: productCase.decided_at || "",
    source_case_id: productCase.source_case_id || null,
    created_at: productCase.created_at,
    updated_at: productCase.updated_at,
    card_image_url: purchase?.representative_image_url || imageUrls[0] || null,
    landed_cost: numberOrNull(
      purchase?.landed_price_per_unit ?? purchase?.landed_cost,
    ),
    sale_price: numberOrNull(proposal?.sale_price),
    usp_preview: String(proposal?.usp || "").slice(0, 160),
    landing_url: proposal?.landing_url || null,
    combo_preview: String(proposal?.combo_json || "").slice(0, 160),
    test_days: new Set(daily.map((row) => row.test_date)).size,
    latest_test_date: latestDate,
    last_evaluation: daily.find((row) => row.evaluation)?.evaluation || "",
    next_action: nextAction(productCase.status),
    spend: metrics.ad_spend,
    impressions: metrics.impressions,
    clicks: metrics.clicks,
    leads: metrics.leads,
    orders: metrics.orders,
    cancelled_orders: metrics.cancelled_orders,
    revenue: metrics.revenue,
    cpl: metrics.cpl,
    cpo: metrics.cpo,
    ctr: metrics.ctr,
    ad_ratio: metrics.ad_ratio,
    cancellation_ratio: metrics.cancellation_ratio,
  };
}

function nextAction(status: string): string {
  const labels: Record<string, string> = {
    draft: "Điền giá bán + combo",
    testing: "Nhập kết quả ngày",
    import_approved: "Đã duyệt nhập",
    import_rejected: "Không nhập",
  };
  return labels[status] || status;
}

export function emptyStatusCounts() {
  return Object.fromEntries(PRODUCT_TEST_STATUSES.map((status) => [status, 0]));
}
