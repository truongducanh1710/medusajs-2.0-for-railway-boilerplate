import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ulid } from "ulid";
import { getPool } from "../../../../../lib/db";
import {
  assertTransitionComment,
  getTransition,
  type ProductTestAction,
} from "../../../../../modules/product-test/state-machine";
import {
  actorHas,
  apiError,
  cleanText,
  getProductTestActor,
  parseVersion,
  PRODUCT_TEST_PERMS,
} from "../../_lib";
import { mapDaily } from "../../_query";
import {
  metricsFacts,
  postMilestone,
  PRODUCT_TEST_MILESTONES,
} from "../../_milestones";
import { createImportTask, syncMarketingTask } from "../../_tasks";

const ACTION_LABELS: Record<string, string> = {
  request_more_testing: "Leader yêu cầu test thêm",
  approve_import: "Leader kết luận nhập sản phẩm",
  reject_import: "Leader kết luận không nhập",
};

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const client = await getPool().connect();
  try {
    const actor = await getProductTestActor(req);
    if (!actor) return res.status(401).json({ error: "Unauthenticated" });
    const body = req.body as any;
    const version = parseVersion(body.version);
    const action = String(body.action || "") as ProductTestAction;
    const comment = cleanText(body.comment);
    if (!version)
      return res.status(400).json({ error: "Thiếu version hợp lệ" });

    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT * FROM product_test_case WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,
      [req.params.id],
    );
    const productCase = locked.rows[0];
    if (!productCase) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Không tìm thấy hồ sơ" });
    }
    if (Number(productCase.version) !== version) {
      await client.query("ROLLBACK");
      return res
        .status(409)
        .json({ error: "Hồ sơ đã được người khác cập nhật" });
    }

    const transition = getTransition(action, productCase.status);
    assertTransitionComment(action, comment);
    // Every remaining action is the leader's; a single permission check covers
    // all three.
    if (!actorHas(actor, PRODUCT_TEST_PERMS.approve)) {
      await client.query("ROLLBACK");
      return res
        .status(403)
        .json({ error: "Không có quyền thực hiện thao tác này" });
    }

    // The only prerequisite left: concluding a case that has no test data at
    // all is meaningless. Rows no longer need to be individually evaluated.
    const dailyRows = await client.query(
      `SELECT * FROM product_test_daily_result WHERE case_id=$1 AND deleted_at IS NULL
       ORDER BY test_date DESC, created_at DESC`,
      [productCase.id],
    );
    if (
      ["approve_import", "reject_import"].includes(action) &&
      !dailyRows.rows.length
    ) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "Cần ít nhất một dòng kết quả test trước khi kết luận" });
    }

    const nextStatus = transition.to || productCase.status;
    const finalDecision =
      action === "approve_import"
        ? "import_approved"
        : action === "reject_import"
          ? "import_rejected"
          : productCase.final_decision;
    const decidedBy = ["approve_import", "reject_import"].includes(action)
      ? actor.email
      : productCase.decided_by;
    const result = await client.query(
      `UPDATE product_test_case SET status=$1,
       final_decision=$2::text,final_note=CASE WHEN $2::text IS NOT NULL THEN $3::text ELSE final_note END,
       decided_by=$4::text,decided_at=CASE WHEN $4::text IS NOT NULL THEN now() ELSE decided_at END,
       version=version+1,updated_at=now() WHERE id=$5 RETURNING *`,
      [nextStatus, finalDecision, comment, decidedBy, productCase.id],
    );
    await client.query(
      `INSERT INTO product_test_event (id,case_id,action,from_status,to_status,actor,comment,snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [
        `pte_${ulid().toLowerCase()}`,
        productCase.id,
        action,
        productCase.status,
        nextStatus,
        actor.email,
        comment,
        JSON.stringify({ version: version + 1, final_decision: finalDecision }),
      ],
    );
    await client.query("COMMIT");

    const updatedCase = result.rows[0];
    const image = await getPool().query(
      `SELECT representative_image_url, image_urls FROM product_purchase_check
       WHERE case_id=$1 AND deleted_at IS NULL LIMIT 1`,
      [productCase.id],
    );
    const imageRow = image.rows[0];
    const imageUrl =
      imageRow?.representative_image_url ||
      (Array.isArray(imageRow?.image_urls) ? imageRow.image_urls[0] : null);

    const isConclusion = ["approve_import", "reject_import"].includes(action);
    await postMilestone(req, {
      case_id: updatedCase.id,
      code: updatedCase.code,
      product_name: updatedCase.product_name,
      milestone: isConclusion
        ? PRODUCT_TEST_MILESTONES.concluded
        : PRODUCT_TEST_MILESTONES.more_testing,
      actor,
      comment: [ACTION_LABELS[action], comment].filter(Boolean).join(" · "),
      image_url: imageUrl,
      facts: metricsFacts(dailyRows.rows.map(mapDaily)),
    });

    await syncMarketingTask(req, {
      caseId: updatedCase.id,
      code: updatedCase.code,
      productName: updatedCase.product_name,
      status: updatedCase.status,
      assigneeEmail: updatedCase.assignee_email,
      assigneeName: updatedCase.assignee_name,
      actor,
    });
    if (action === "approve_import") {
      await createImportTask(req, {
        caseId: updatedCase.id,
        code: updatedCase.code,
        productName: updatedCase.product_name,
        actor,
      });
    }
    return res.json({ case: updatedCase, action, version: version + 1 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return apiError(res, error);
  } finally {
    client.release();
  }
}
