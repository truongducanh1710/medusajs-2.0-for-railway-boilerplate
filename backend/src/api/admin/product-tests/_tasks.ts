import type { MedusaRequest } from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";
import {
  normalizeEmail,
  PRODUCT_TEST_PERMS,
  type ProductTestActor,
} from "./_lib";
import { resolveUserPerms } from "../../middlewares";

// Vietnamese label for the MKT tracking task's title — kept here rather
// than importing the admin-side STATUS_LABELS (that file lives under
// src/admin and is Vite-bundled, not meant to be required by API routes).
const STATUS_LABELS: Record<string, string> = {
  draft: "Đang chuẩn bị",
  testing: "Đang test",
  import_approved: "Duyệt nhập",
  import_rejected: "Không nhập",
};

const CONCLUDED_STATUSES = new Set(["import_approved", "import_rejected"]);

async function findMktTaskModule(req: MedusaRequest) {
  return req.scope.resolve("mktTaskModule") as any;
}

export type PurchaserRef = { email: string; name: string };

function toRef(user: any): PurchaserRef {
  return {
    email: normalizeEmail(user.email),
    name:
      [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email,
  };
}

/** Everyone who effectively holds the purchasing permission. */
export async function listPurchasers(
  req: MedusaRequest,
): Promise<PurchaserRef[]> {
  const userModule = req.scope.resolve(Modules.USER) as any;
  const users = await userModule.listUsers(
    {},
    { select: ["id", "email", "first_name", "last_name", "metadata"] },
  );
  return users
    .filter((u: any) =>
      resolveUserPerms(u.metadata).includes(PRODUCT_TEST_PERMS.purchasing),
    )
    .map(toRef)
    .filter((u: PurchaserRef) => u.email);
}

/**
 * Resolves who a purchasing task belongs to.
 *
 * The case's own purchaser_email wins. Otherwise this falls back to the sole
 * eligible user, and deliberately does NOT guess when several exist — an
 * unassigned task is recoverable, a task silently sitting in the wrong
 * person's list is not.
 *
 * The previous implementation matched on metadata.role === "mua-hang" only,
 * which missed anyone whose access comes from an explicit
 * metadata.permissions list with no role set. Since the caller just returns
 * when this yields nothing, purchasing tasks were never created for those
 * users and the failure was completely silent.
 */
async function resolvePurchaser(
  req: MedusaRequest,
  assigned?: { email?: string | null; name?: string | null } | null,
): Promise<PurchaserRef | null> {
  const email = normalizeEmail(assigned?.email);
  if (email) return { email, name: assigned?.name || email };
  const eligible = await listPurchasers(req);
  return eligible.length === 1 ? eligible[0] : null;
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

// Fired once, when the case is created — there is no longer a "submit to Mua
// hàng" step, so creation is the earliest point Purchasing can act. They own
// closing it themselves (per team decision — checking the price is their own
// confirmation, not something to infer from a later action), so this never
// auto-updates or auto-closes afterward.
export async function createPurchasingTask(
  req: MedusaRequest,
  input: {
    caseId: string;
    code: string;
    productName: string;
    actor: ProductTestActor;
    purchaserEmail?: string | null;
    purchaserName?: string | null;
  },
): Promise<void> {
  try {
    const taskSvc = await findMktTaskModule(req);
    const existing = await taskSvc.listMktTasks({
      product_test_case_id: input.caseId,
      type: "product_test_purchasing",
    });
    if (existing.length) return; // already created for this case once

    const purchaser = await resolvePurchaser(req, {
      email: input.purchaserEmail,
      name: input.purchaserName,
    });
    // Nobody named and more than one candidate — leave it unassigned rather
    // than guessing; picking the purchaser on the case creates it later.
    if (!purchaser) return;

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
    // Best-effort — must never block case creation.
  }
}

// Fired once, when the leader approves import. This is the real purchasing
// workflow (type "purchasing", same as any manually created "Lô nhập hàng"
// task) — deliberately a different type from product_test_purchasing
// above, which only ever covered checking the sourcing price before a
// product was approved to test at all.
export async function createImportTask(
  req: MedusaRequest,
  input: {
    caseId: string;
    code: string;
    productName: string;
    actor: ProductTestActor;
    purchaserEmail?: string | null;
    purchaserName?: string | null;
  },
): Promise<void> {
  try {
    const taskSvc = await findMktTaskModule(req);
    const existing = await taskSvc.listMktTasks({
      product_test_case_id: input.caseId,
      type: "purchasing",
    });
    if (existing.length) return;

    const purchaser = await resolvePurchaser(req, {
      email: input.purchaserEmail,
      name: input.purchaserName,
    });
    if (!purchaser) return;

    await taskSvc.createMktTasks({
      title: `${input.productName} (${input.code}) — đã duyệt nhập từ test`,
      type: "purchasing",
      assignee_id: purchaser.email,
      created_by: input.actor.email,
      status: "todo",
      priority: "high",
      tags: ["product_test"],
      comments: [],
      product_test_case_id: input.caseId,
    });
  } catch {
    // Best-effort — must never block the approve_import transition.
  }
}
