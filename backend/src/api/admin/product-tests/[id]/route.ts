import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ulid } from "ulid";
import { getPool } from "../../../../lib/db";
import {
  apiError,
  getProductTestActor,
  parseVersion,
  PRODUCT_TEST_PERMS,
  rejectBodyFields,
  requireActorPermission,
} from "../_lib";
import {
  availableActions,
  buildSummary,
  getCaseBundle,
  permissionsFor,
} from "../_query";
import { isConcluded } from "../../../../modules/product-test/state-machine";
import { createPurchasingTask } from "../_tasks";

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const actor = await getProductTestActor(req);
    if (!actor) return res.status(401).json({ error: "Unauthenticated" });
    requireActorPermission(actor, PRODUCT_TEST_PERMS.view);
    const bundle = await getCaseBundle(getPool(), req.params.id);
    if (!bundle) return res.status(404).json({ error: "Không tìm thấy hồ sơ" });
    res.json({
      case: {
        ...bundle.case,
        purchase_check: bundle.purchase_check,
        proposal: bundle.proposal,
        daily_results: bundle.daily_results,
        events: bundle.events,
      },
      summary: buildSummary(
        bundle.case,
        bundle.purchase_check,
        bundle.proposal,
        bundle.daily_results,
      ),
      available_actions: availableActions(actor, bundle.case),
      permissions: permissionsFor(actor),
    });
  } catch (error) {
    return apiError(res, error);
  }
}

export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const actor = await getProductTestActor(req);
    if (!actor) return res.status(401).json({ error: "Unauthenticated" });
    requireActorPermission(actor, PRODUCT_TEST_PERMS.marketing);
    const bundle = await getCaseBundle(getPool(), req.params.id);
    if (!bundle) return res.status(404).json({ error: "Không tìm thấy hồ sơ" });
    // The name stays editable for the whole run — testing is now reached
    // automatically, so locking on it would freeze names the moment a price
    // is entered. Only a concluded case is frozen.
    if (isConcluded(bundle.case.status)) {
      return res
        .status(400)
        .json({ error: "Hồ sơ đã kết luận, không sửa được thông tin chung" });
    }
    const body = req.body as any;
    rejectBodyFields(body, [
      "status",
      "final_decision",
      "final_note",
      "decided_by",
      "decided_at",
      "purchase_check",
      "proposal",
      "daily_results",
    ]);
    const version = parseVersion(body.version);
    if (!version)
      return res.status(400).json({ error: "Thiếu version hợp lệ" });
    const productName =
      body.product_name === undefined
        ? bundle.case.product_name
        : String(body.product_name || "").trim();
    if (!productName)
      return res.status(400).json({ error: "Tên sản phẩm không được trống" });
    // Assigning the purchaser is what actually creates their task, so an
    // explicit null clears the field rather than being treated as "unchanged".
    const purchaserEmail =
      body.purchaser_email === undefined
        ? bundle.case.purchaser_email
        : body.purchaser_email
          ? String(body.purchaser_email).toLowerCase()
          : null;
    const purchaserName =
      body.purchaser_email === undefined
        ? bundle.case.purchaser_name
        : purchaserEmail
          ? String(body.purchaser_name || purchaserEmail)
          : null;
    const { rows } = await getPool().query(
      `UPDATE product_test_case SET product_name=$1, product_handle=$2,
       purchaser_email=$5, purchaser_name=$6, version=version+1, updated_at=now()
       WHERE id=$3 AND version=$4 AND deleted_at IS NULL RETURNING *`,
      [
        productName,
        body.product_handle ?? bundle.case.product_handle,
        req.params.id,
        version,
        purchaserEmail,
        purchaserName,
      ],
    );
    if (!rows.length)
      return res
        .status(409)
        .json({ error: "Hồ sơ đã được người khác cập nhật" });
    // Picking a purchaser after creation is the other path into their task —
    // createPurchasingTask is idempotent per case, so this is safe to retry.
    if (purchaserEmail && purchaserEmail !== bundle.case.purchaser_email) {
      await createPurchasingTask(req, {
        caseId: rows[0].id,
        code: rows[0].code,
        productName: rows[0].product_name,
        actor,
        purchaserEmail,
        purchaserName,
      });
    }
    res.json({ case: rows[0] });
  } catch (error) {
    return apiError(res, error);
  }
}

// Soft delete only — leader-only, any stage. Keeps the row (and its
// purchase_check/proposal/daily_results/events) for audit, just hidden from
// every query via the existing deleted_at IS NULL filters.
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const actor = await getProductTestActor(req);
    if (!actor) return res.status(401).json({ error: "Unauthenticated" });
    requireActorPermission(actor, PRODUCT_TEST_PERMS.approve);
    const bundle = await getCaseBundle(getPool(), req.params.id);
    if (!bundle) return res.status(404).json({ error: "Không tìm thấy hồ sơ" });

    const { rows } = await getPool().query(
      `UPDATE product_test_case SET deleted_at=now(), updated_at=now()
       WHERE id=$1 AND deleted_at IS NULL RETURNING id`,
      [req.params.id],
    );
    if (!rows.length)
      return res.status(404).json({ error: "Không tìm thấy hồ sơ" });

    await getPool().query(
      `INSERT INTO product_test_event (id,case_id,action,from_status,to_status,actor,comment,snapshot)
       VALUES ($1,$2,'delete_case',$3,$3,$4,$5,$6::jsonb)`,
      [
        `pte_${ulid().toLowerCase()}`,
        req.params.id,
        bundle.case.status,
        actor.email,
        null,
        JSON.stringify({ product_name: bundle.case.product_name }),
      ],
    );
    res.json({ deleted: true });
  } catch (error) {
    return apiError(res, error);
  }
}
