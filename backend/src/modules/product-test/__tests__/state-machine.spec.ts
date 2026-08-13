import {
  assertTransitionComment,
  deriveStatus,
  getTransition,
  isConcluded,
  isReadyForTesting,
  PRODUCT_TEST_TRANSITIONS,
} from "../state-machine";

describe("product test state machine", () => {
  it("routes the leader's terminal decisions from testing", () => {
    expect(getTransition("approve_import", "testing").to).toBe(
      "import_approved",
    );
    expect(getTransition("reject_import", "testing").to).toBe(
      "import_rejected",
    );
  });

  it("lets the leader ask for another round of testing without leaving testing", () => {
    expect(getTransition("request_more_testing", "testing").to).toBe("testing");
  });

  it("rejects actions from an invalid status", () => {
    expect(() => getTransition("approve_import", "draft")).toThrow(
      "Chuyển trạng thái không hợp lệ",
    );
  });

  it("rejects the retired approval actions outright", () => {
    for (const action of [
      "submit_purchase_check",
      "approve_purchase_check",
      "submit_test_proposal",
      "approve_testing",
    ]) {
      expect(() => getTransition(action, "draft")).toThrow(
        "Chuyển trạng thái không hợp lệ",
      );
    }
  });

  it("requires a comment on every remaining action", () => {
    const required = Object.entries(PRODUCT_TEST_TRANSITIONS)
      .filter(([, value]) => value.comment_required)
      .map(([key]) => key);
    expect(required).toHaveLength(3);
    for (const action of required)
      expect(() => assertTransitionComment(action, " ")).toThrow(
        "Vui lòng nhập lý do",
      );
  });
});

describe("readiness for testing", () => {
  it("needs both a positive sale price and a combo", () => {
    expect(isReadyForTesting({ sale_price: 599000, combo_json: "Mua 1 tặng 1" })).toBe(true);
    expect(isReadyForTesting({ sale_price: 599000, combo_json: "  " })).toBe(false);
    expect(isReadyForTesting({ sale_price: 0, combo_json: "Combo" })).toBe(false);
    expect(isReadyForTesting({ combo_json: "Combo" })).toBe(false);
    expect(isReadyForTesting(null)).toBe(false);
  });

  it("promotes a draft to testing once the proposal is complete", () => {
    expect(deriveStatus("draft", { sale_price: 100, combo_json: "x" })).toBe(
      "testing",
    );
  });

  it("never demotes a case that has already started testing", () => {
    // Clearing the combo must not strip the results section away from numbers
    // that were already entered.
    expect(deriveStatus("testing", { sale_price: null, combo_json: "" })).toBe(
      "testing",
    );
  });

  it("never moves a concluded case", () => {
    expect(deriveStatus("import_approved", { sale_price: 1, combo_json: "x" })).toBe(
      "import_approved",
    );
    expect(deriveStatus("import_rejected", null)).toBe("import_rejected");
    expect(isConcluded("import_rejected")).toBe(true);
    expect(isConcluded("testing")).toBe(false);
  });
});
