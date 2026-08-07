export const PRODUCT_TEST_STATUSES = [
  "draft",
  "awaiting_purchase_check",
  "purchase_changes_requested",
  "proposal_draft",
  "awaiting_test_approval",
  "proposal_changes_requested",
  "testing",
  // Retired from the live transition graph — kept in the type so historical
  // cases/events created before this change still deserialize and display.
  "awaiting_final_decision",
  "import_approved",
  "import_rejected",
] as const;

export type ProductTestStatus = (typeof PRODUCT_TEST_STATUSES)[number];
export type ProductTestRole = "marketing" | "purchasing" | "approve";
export type ProductTestAction =
  | "submit_purchase_check"
  | "approve_purchase_check"
  | "request_purchase_changes"
  | "submit_test_proposal"
  | "approve_testing"
  | "request_proposal_changes"
  | "request_more_testing"
  | "approve_import"
  | "reject_import"
  | "reassign_marketer";

type Transition = {
  from: ProductTestStatus[];
  to: ProductTestStatus | null;
  role: ProductTestRole;
  comment_required?: boolean;
};

export const PRODUCT_TEST_TRANSITIONS: Record<ProductTestAction, Transition> = {
  submit_purchase_check: {
    from: ["draft", "purchase_changes_requested"],
    to: "awaiting_purchase_check",
    role: "marketing",
  },
  approve_purchase_check: {
    from: ["awaiting_purchase_check"],
    to: "proposal_draft",
    role: "purchasing",
  },
  request_purchase_changes: {
    from: ["awaiting_purchase_check"],
    to: "purchase_changes_requested",
    role: "purchasing",
    comment_required: true,
  },
  submit_test_proposal: {
    from: ["proposal_draft", "proposal_changes_requested"],
    to: "awaiting_test_approval",
    role: "marketing",
  },
  approve_testing: {
    from: ["awaiting_test_approval"],
    to: "testing",
    role: "approve",
  },
  request_proposal_changes: {
    from: ["awaiting_test_approval"],
    to: "proposal_changes_requested",
    role: "approve",
    comment_required: true,
  },
  // Leader decides directly from "testing" — MKT only enters daily results,
  // there is no separate "submit for conclusion" handoff. request_more_testing
  // is a same-status action (stays "testing") that just records the leader
  // asked for another round; approve/reject end the case.
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
  reassign_marketer: {
    from: PRODUCT_TEST_STATUSES.filter(
      (s) => !["import_approved", "import_rejected"].includes(s),
    ) as ProductTestStatus[],
    to: null,
    role: "approve",
    comment_required: true,
  },
};

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
