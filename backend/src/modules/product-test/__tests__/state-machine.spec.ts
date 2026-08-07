import {
  assertTransitionComment,
  getTransition,
  PRODUCT_TEST_TRANSITIONS,
} from "../state-machine";

describe("product test state machine", () => {
  it("routes the complete happy path in order", () => {
    const path = [
      ["draft", "submit_purchase_check", "awaiting_purchase_check"],
      ["awaiting_purchase_check", "approve_purchase_check", "proposal_draft"],
      ["proposal_draft", "submit_test_proposal", "awaiting_test_approval"],
      ["awaiting_test_approval", "approve_testing", "testing"],
      ["testing", "approve_import", "import_approved"],
    ] as const;
    for (const [status, action, expected] of path)
      expect(getTransition(action, status).to).toBe(expected);
  });

  it("lets the leader ask for another round of testing without leaving testing", () => {
    expect(getTransition("request_more_testing", "testing").to).toBe(
      "testing",
    );
  });

  it("rejects actions from an invalid status", () => {
    expect(() => getTransition("approve_import", "draft")).toThrow(
      "Chuyển trạng thái không hợp lệ",
    );
  });

  it("requires comments for return, final and reassignment actions", () => {
    const required = Object.entries(PRODUCT_TEST_TRANSITIONS)
      .filter(([, value]) => value.comment_required)
      .map(([key]) => key);
    for (const action of required)
      expect(() => assertTransitionComment(action, " ")).toThrow(
        "Vui lòng nhập lý do",
      );
  });

  it("keeps reassignment in the same workflow status", () => {
    expect(getTransition("reassign_marketer", "testing").to).toBeNull();
    expect(() =>
      getTransition("reassign_marketer", "import_approved"),
    ).toThrow();
  });
});
