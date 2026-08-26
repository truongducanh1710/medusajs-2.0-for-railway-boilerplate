// The workflow deliberately has no approval gates. A case moves draft →
// testing on its own once the proposal carries a sale price and a combo, so
// nobody can leave a case stranded by forgetting to press a button. The only
// manual actions left are the leader's two terminal decisions.
export const PRODUCT_TEST_STATUSES = [
  "draft",
  "testing",
  "import_approved",
  "import_rejected",
  // MKT tự dừng khi chưa test: giá vốn về quá cao, không ra được giá bán cạnh
  // tranh. Khác import_rejected — cái đó là leader kết luận SAU khi đã chạy ads.
  "not_viable",
  // Retired statuses. The Migration20260813000000 rewrite maps every stored
  // row onto the four live values, but historical product_test_event rows keep
  // their original from_status/to_status strings, so the type must still
  // accept them for the audit trail to deserialize.
  "awaiting_purchase_check",
  "purchase_changes_requested",
  "proposal_draft",
  "awaiting_test_approval",
  "proposal_changes_requested",
  "awaiting_final_decision",
] as const;

export type ProductTestStatus = (typeof PRODUCT_TEST_STATUSES)[number];

/** The four statuses a live case can actually hold. */
export const ACTIVE_PRODUCT_TEST_STATUSES = [
  "draft",
  "testing",
  "not_viable",
  "import_approved",
  "import_rejected",
] as const;

export const RETIRED_STATUS_MAP: Record<string, ProductTestStatus> = {
  awaiting_purchase_check: "draft",
  purchase_changes_requested: "draft",
  proposal_draft: "draft",
  awaiting_test_approval: "draft",
  proposal_changes_requested: "draft",
  awaiting_final_decision: "testing",
};

export type ProductTestRole = "marketing" | "purchasing" | "approve";
export type ProductTestAction =
  | "request_more_testing"
  | "approve_import"
  | "reject_import"
  | "mark_not_viable";

type Transition = {
  from: ProductTestStatus[];
  to: ProductTestStatus | null;
  role: ProductTestRole;
  comment_required?: boolean;
};

export const PRODUCT_TEST_TRANSITIONS: Record<ProductTestAction, Transition> = {
  // Same-status action: it records that the leader asked for another round
  // rather than moving the case anywhere.
  request_more_testing: {
    from: ["testing"],
    to: "testing",
    role: "approve",
    comment_required: true,
  },
  approve_import: {
    from: ["testing"],
    to: "import_approved",
    role: "approve",
    comment_required: true,
  },
  reject_import: {
    from: ["testing"],
    to: "import_rejected",
    role: "approve",
    comment_required: true,
  },
  // Chỉ từ "draft": đã sang testing nghĩa là đã tiêu tiền ads, lúc đó phải để
  // leader kết luận bằng approve_import/reject_import.
  mark_not_viable: {
    from: ["draft"],
    to: "not_viable",
    role: "marketing",
    comment_required: true,
  },
};

export const CONCLUDED_STATUSES: ProductTestStatus[] = [
  "import_approved",
  "import_rejected",
  "not_viable",
];

export function isConcluded(status: string): boolean {
  return CONCLUDED_STATUSES.includes(status as ProductTestStatus);
}

/**
 * A case is ready to test once the proposal names a price and a combo — the
 * two things a campaign cannot run without. This is the whole gate; it is
 * evaluated from data rather than asserted by an action.
 */
export function isReadyForTesting(proposal: {
  sale_price?: unknown;
  combo_json?: unknown;
} | null | undefined): boolean {
  if (!proposal) return false;
  const price = Number(proposal.sale_price);
  const combo =
    typeof proposal.combo_json === "string" ? proposal.combo_json.trim() : "";
  return Number.isFinite(price) && price > 0 && combo.length > 0;
}

/**
 * Derives the status a non-concluded case should hold given its proposal.
 *
 * draft → testing is one-way: once a case has started running, clearing the
 * combo text must not demote it and strip the daily-results section out from
 * under numbers that were already entered.
 */
export function deriveStatus(
  current: string,
  proposal: { sale_price?: unknown; combo_json?: unknown } | null | undefined,
): ProductTestStatus {
  if (isConcluded(current) || current === "testing")
    return current as ProductTestStatus;
  return isReadyForTesting(proposal) ? "testing" : "draft";
}

export function getTransition(action: string, status: string): Transition {
  const transition = PRODUCT_TEST_TRANSITIONS[action as ProductTestAction];
  if (!transition || !transition.from.includes(status as ProductTestStatus)) {
    const error: any = new Error("Chuyển trạng thái không hợp lệ");
    error.status = 400;
    throw error;
  }
  return transition;
}

export function assertTransitionComment(
  action: string,
  comment: unknown,
): void {
  const transition = PRODUCT_TEST_TRANSITIONS[action as ProductTestAction];
  if (
    transition?.comment_required &&
    (typeof comment !== "string" || !comment.trim())
  ) {
    const error: any = new Error("Vui lòng nhập lý do hoặc nhận xét");
    error.status = 400;
    throw error;
  }
}
