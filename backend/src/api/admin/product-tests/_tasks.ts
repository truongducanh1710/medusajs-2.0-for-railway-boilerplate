import type { MedusaRequest } from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";
import { normalizeEmail, type ProductTestActor } from "./_lib";

// Vietnamese label for the MKT tracking task's title — kept here rather
// than importing the admin-side STATUS_LABELS (that file lives under
// src/admin and is Vite-bundled, not meant to be required by API routes).
const STATUS_LABELS: Record<string, string> = {
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

const CONCLUDED_STATUSES = new Set(["import_approved", "import_rejected"]);

async function findMktTaskModule(req: MedusaRequest) {
  return req.scope.resolve("mktTaskModule") as any;
}

async function findUserByRole(req: MedusaRequest, role: string) {
  const userModule = req.scope.resolve(Modules.USER) as any;
  const users = await userModule.listUsers(
    {},
    { select: ["id", "email", "first_name", "last_name", "metadata"] },
  );
  const match = users.find((u: any) => u.metadata?.role === role);
  if (!match) return null;
  return {
    email: normalizeEmail(match.email),
    name:
      [match.first_name, match.last_name].filter(Boolean).join(" ") ||
      match.email,
  };
}

// One task per case tracks the whole MKT-side journey: created the moment
// the case leaves draft, its title/status just get updated in place at
// every later transition, and it's marked done only once the leader makes
// the final call. MKT never has to hunt for a new task each stage.
export async function syncMarketingTask(
  req: MedusaRequest,
  input: {
    caseId: string;
    code: string;
    productName: string;
    status: string;
    assigneeEmail: string;
    assigneeName: string;
    actor: ProductTestActor;
  },
): Promise<void> {
  try {
    const taskSvc = await findMktTaskModule(req);
    const existing = await taskSvc.listMktTasks({
      product_test_case_id: input.caseId,
      type: "product_test",
    });
    const openTask = existing.find((t: any) => t.status !== "done" && t.status !== "cancelled");

    const title = `[Test SP] ${input.code} · ${input.productName} — ${STATUS_LABELS[input.status] || input.status}`;
    const isConcluded = CONCLUDED_STATUSES.has(input.status);

    if (openTask) {
      await taskSvc.updateMktTasks({
        id: openTask.id,
        title,
        status: isConcluded ? "done" : openTask.status,
        assignee_id: normalizeEmail(input.assigneeEmail),
      });
      return;
    }
    if (isConcluded) return; // nothing to track anymore
    await taskSvc.createMktTasks({
      title,
      type: "product_test",
      assignee_id: normalizeEmail(input.assigneeEmail),
      created_by: input.actor.email,
      status: "todo",
      priority: "medium",
      tags: ["product_test"],
      comments: [],
      product_test_case_id: input.caseId,
    });
  } catch {
    // Task sync is a best-effort side-effect and must never block the
    // workflow transition it's reacting to.
  }
}

// Fired once, when the case is first submitted to Mua hàng. Purchasing
// owns closing it themselves (per team decision — checking the price is
// their own confirmation, not something to infer from a later action), so
// this never auto-updates or auto-closes afterward.
export async function createPurchasingTask(
  req: MedusaRequest,
  input: {
    caseId: string;
    code: string;
    productName: string;
    actor: ProductTestActor;
  },
): Promise<void> {
  try {
    const taskSvc = await findMktTaskModule(req);
    const existing = await taskSvc.listMktTasks({
      product_test_case_id: input.caseId,
      type: "product_test_purchasing",
    });
    if (existing.length) return; // already created for this case once

    const purchaser = await findUserByRole(req, "mua-hang");
    if (!purchaser) return; // no one holds the role yet — nothing to assign

    await taskSvc.createMktTasks({
      title: `[Check giá] ${input.code} · ${input.productName}`,
      type: "product_test_purchasing",
      assignee_id: purchaser.email,
      created_by: input.actor.email,
      status: "todo",
      priority: "high",
      tags: ["product_test"],
      comments: [],
      product_test_case_id: input.caseId,
    });
  } catch {
    // Best-effort — must never block the submit_purchase_check transition.
  }
}
