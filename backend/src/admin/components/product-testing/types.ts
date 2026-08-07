export type ProductTestViewMode = "table" | "kanban";

export type ProductTestTab =
  | "overview"
  | "purchase"
  | "proposal"
  | "results"
  | "concluded";

export type ProductTestStatus =
  | "draft"
  | "awaiting_purchase_check"
  | "purchase_changes_requested"
  | "proposal_draft"
  | "awaiting_test_approval"
  | "proposal_changes_requested"
  | "testing"
  | "awaiting_final_decision"
  | "import_approved"
  | "import_rejected";

// Single source of truth for status wording, shared by the list page and drawer.
export const STATUS_LABELS: Record<ProductTestStatus, string> = {
  draft: "Nháp",
  awaiting_purchase_check: "Chờ check giá",
  purchase_changes_requested: "Cần bổ sung check giá",
  proposal_draft: "Soạn đề xuất",
  awaiting_test_approval: "Chờ duyệt test",
  proposal_changes_requested: "Cần sửa đề xuất",
  testing: "Đang test",
  awaiting_final_decision: "Chờ kết luận",
  import_approved: "Duyệt nhập",
  import_rejected: "Không nhập",
};

export type ProductTestDecision = "import_approved" | "import_rejected" | null;

export interface ProductTestPurchaseCheck {
  supplier_link: string;
  supplier_name: string;
  description: string;
  specification: string;
  moq: number | null;
  source_price: number | null;
  currency: string;
  exchange_rate: number | null;
  weight_kg: number | null;
  size: string;
  quantity_per_carton: number | null;
  shipping_fee: number | null;
  other_cost: number | null;
  landed_cost: number | null;
  landed_price_per_unit: number | null;
  conclusion: string;
  note: string;
  image_urls: string[];
  representative_image_url: string;
  checked_by: string;
  checked_at: string;
}

export interface ProductTestProposal {
  usp: string;
  combo_json: string;
  sale_price: number | null;
  gift_name: string;
  promo_title: string;
  ad_content: string;
  reference_link: string;
  landing_url: string;
  note: string;
  approved_by: string;
  approved_at: string;
}

export interface ProductTestDailyResult {
  id: string;
  case_id: string;
  test_date: string;
  tester_name: string;
  campaign_name: string;
  ad_spend: number | null;
  impressions: number | null;
  clicks: number | null;
  leads: number | null;
  orders: number | null;
  cancelled_orders: number | null;
  revenue: number | null;
  evaluation: string;
  leader_note: string;
  evaluated_by: string;
  evaluated_at: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ProductTestEvent {
  id: string;
  case_id: string;
  action: string;
  from_status: ProductTestStatus | null;
  to_status: ProductTestStatus | null;
  actor: string;
  comment: string;
  snapshot: Record<string, unknown>;
  created_at: string;
}

export interface ProductTestCaseRecord {
  id: string;
  code: string;
  product_name: string;
  product_handle: string;
  marketer_email: string;
  marketer_name: string;
  assignee_email: string;
  assignee_name: string;
  purchaser_email: string | null;
  purchaser_name: string | null;
  status: ProductTestStatus;
  version: number;
  final_decision: ProductTestDecision;
  final_note: string;
  decided_by: string;
  decided_at: string;
  source_case_id: string | null;
  created_at: string;
  updated_at: string;
  purchase_check: ProductTestPurchaseCheck | null;
  proposal: ProductTestProposal | null;
  daily_results: ProductTestDailyResult[];
  events: ProductTestEvent[];
}

export interface ProductTestTotals {
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  leads: number | null;
  orders: number | null;
  cancelled_orders: number | null;
  revenue: number | null;
  cpl: number | null;
  cpo: number | null;
  ctr: number | null;
  ad_ratio: number | null;
  cancellation_ratio: number | null;
}

export interface ProductTestSummary extends ProductTestTotals {
  id: string;
  code: string;
  product_name: string;
  product_handle: string;
  marketer_email: string;
  marketer_name: string;
  assignee_email: string;
  assignee_name: string;
  purchaser_name: string | null;
  status: ProductTestStatus;
  version: number;
  final_decision: ProductTestDecision;
  final_note: string;
  decided_by: string;
  decided_at: string;
  source_case_id: string | null;
  created_at: string;
  updated_at: string;
  card_image_url: string | null;
  landed_cost: number | null;
  sale_price: number | null;
  usp_preview: string;
  landing_url: string | null;
  combo_preview: string;
  test_days: number;
  latest_test_date: string | null;
  last_evaluation: string;
  next_action: string;
}

export interface ProductTestOverview {
  total_cases: number;
  testing_cases: number;
  awaiting_leader_review: number;
  concluded_cases: number;
  by_status: Record<ProductTestStatus, number>;
  spend: number;
  orders: number;
  revenue: number;
  leads: number;
}

export interface ProductTestFacets {
  total: number;
  by_status: Record<ProductTestStatus, number>;
  by_marketer: Array<{
    marketer_name: string;
    marketer_email: string;
    count: number;
  }>;
  by_assignee: Array<{
    assignee_name: string;
    assignee_email: string;
    count: number;
  }>;
}

export interface ProductTestFilters {
  q: string;
  marketer: string;
  assignee: string;
  status: string;
  from: string;
  to: string;
}

export interface ProductTestPermissions {
  can_view_all: boolean;
  can_edit_marketing: boolean;
  can_edit_purchase: boolean;
  can_approve: boolean;
  can_reassign: boolean;
}

export interface ProductTestRouteQuery {
  view?: ProductTestViewMode;
  tab?: ProductTestTab;
  case?: string;
}

export interface ProductTestListResponse {
  cases: ProductTestSummary[];
  overview: ProductTestOverview;
  facets: ProductTestFacets;
}
