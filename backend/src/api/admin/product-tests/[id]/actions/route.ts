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
  normalizeEmail,
  parseVersion,
  PRODUCT_TEST_PERMS,
  type ProductTestActor,
} from "../../_lib";
import { notifyProductTestTransition } from "../../_lib";

const ACTION_LABELS: Record<string, string> = {
  submit_purchase_check: "ÄÃ£ gá»­i Mua hÃ ng check giÃ¡",
  approve_purchase_check: "Mua hÃ ng Ä‘Ã£ duyá»‡t thÃ´ng tin giÃ¡",
  request_purchase_changes: "Mua hÃ ng yÃªu cáº§u bá»• sung",
  submit_test_proposal: "ÄÃ£ gá»­i Ä‘á» xuáº¥t test",
  approve_testing: "Leader Ä‘Ã£ duyá»‡t cháº¡y test",
  request_proposal_changes: "Leader yÃªu cáº§u sá»­a Ä‘á» xuáº¥t",
  submit_test_results: "ÄÃ£ gá»­i káº¿t quáº£ Ä‘á»ƒ káº¿t luáº­n",
  request_more_testing: "Leader yÃªu cáº§u test thÃªm",
  approve_import: "Leader káº¿t luáº­n nháº­p sáº£n pháº©m",
  reject_import: "Leader káº¿t luáº­n khÃ´ng nháº­p",
  reassign_marketer: "Leader Ä‘Ã£ chuyá»ƒn ngÆ°á»i phá»¥ trÃ¡ch",
};

function assertRole(actor: ProductTestActor, role: string, productCase: any) {
  if (role === "marketing") {
    if (!actorHas(actor, PRODUCT_TEST_PERMS.marketing))
      throw Object.assign(new Error("KhÃ´ng cÃ³ quyá»n MKT"), { status: 403 });
    if (!actor.is_super && productCase.assignee_email !== actor.email)
      throw Object.assign(
        new Error("Chá»‰ MKT phá»¥ trÃ¡ch Ä‘Æ°á»£c thá»±c hiá»‡n"),
        { status: 403 },
      );
    return;
  }
  const permission =
    role === "purchasing"
      ? PRODUCT_TEST_PERMS.purchasing
      : PRODUCT_TEST_PERMS.approve;
  if (!actorHas(actor, permission))
    throw Object.assign(
      new Error("KhÃ´ng cÃ³ quyá»n thá»±c hiá»‡n thao tÃ¡c nÃ y"),
      { status: 403 },
    );
}

async function assertPrerequisites(
  client: any,
  caseId: string,
  action: ProductTestAction,
) {
  if (action === "approve_purchase_check") {
    const check = await client.query(
      `SELECT conclusion,landed_price_per_unit,landed_cost FROM product_purchase_check WHERE case_id=$1 AND deleted_at IS NULL`,
      [caseId],
    );
    const row = check.rows[0];
    if (
      !row?.conclusion ||
      (row.landed_price_per_unit === null && row.landed_cost === null)
    ) {
      throw Object.assign(
        new Error("Cáº§n cÃ³ káº¿t luáº­n vÃ  giÃ¡ vá»‘n trÆ°á»›c khi duyá»‡t"),
        { status: 400 },
      );
    }
  }
  if (action === "submit_test_proposal") {
    const proposal = await client.query(
      `SELECT usp,combo_json,landing_url FROM product_test_proposal WHERE case_id=$1 AND deleted_at IS NULL`,
      [caseId],
    );
    const row = proposal.rows[0];
    if (!row?.usp || !row?.combo_json || !row?.landing_url) {
      throw Object.assign(
        new Error("Äá» xuáº¥t cáº§n Ä‘á»§ USP, Combo vÃ  Landing"),
        { status: 400 },
      );
    }
  }
  if (action === "approve_testing") {
    const proposal = await client.query(
      `SELECT usp,combo_json,landing_url FROM product_test_proposal WHERE case_id=$1 AND deleted_at IS NULL`,
      [caseId],
    );
    const row = proposal.rows[0];
    if (!row?.usp || !row?.combo_json || !row?.landing_url) {
      throw Object.assign(
        new Error("Cần hoàn thiện đề xuất trước khi duyệt test"),
        { status: 400 },
      );
    }
  }
  if (action === "submit_test_results") {
    const count = await client.query(
      `SELECT count(*)::int AS total FROM product_test_daily_result WHERE case_id=$1 AND deleted_at IS NULL`,
      [caseId],
    );
    if (!count.rows[0]?.total)
      throw Object.assign(
        new Error("Cáº§n Ã­t nháº¥t má»™t dÃ²ng káº¿t quáº£ test"),
        { status: 400 },
      );
  }
  if (action === "approve_import" || action === "reject_import") {
    const count = await client.query(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE evaluation IS NULL OR evaluation='')::int AS pending
       FROM product_test_daily_result WHERE case_id=$1 AND deleted_at IS NULL`,
      [caseId],
    );
    if (!count.rows[0]?.total || count.rows[0]?.pending) {
      throw Object.assign(
        new Error(
          "Leader cáº§n Ä‘Ã¡nh giÃ¡ táº¥t cáº£ dÃ²ng test trÆ°á»›c khi káº¿t luáº­n",
        ),
        { status: 400 },
      );
    }
  }
}

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
      return res.status(400).json({ error: "Thiáº¿u version há»£p lá»‡" });

    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT * FROM product_test_case WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,
      [req.params.id],
    );
    const productCase = locked.rows[0];
    if (!productCase) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "KhÃ´ng tÃ¬m tháº¥y há»“ sÆ¡" });
    }
    if (Number(productCase.version) !== version) {
      await client.query("ROLLBACK");
      return res
        .status(409)
        .json({ error: "Há»“ sÆ¡ Ä‘Ã£ Ä‘Æ°á»£c ngÆ°á»i khÃ¡c cáº­p nháº­t" });
    }

    const transition = getTransition(action, productCase.status);
    assertTransitionComment(action, comment);
    assertRole(actor, transition.role, productCase);
    await assertPrerequisites(client, productCase.id, action);

    let nextStatus = transition.to || productCase.status;
    let assigneeEmail = productCase.assignee_email;
    let assigneeName = productCase.assignee_name;
    if (action === "reassign_marketer") {
      assigneeEmail = normalizeEmail(body.assignee_email);
      assigneeName = cleanText(body.assignee_name, 300) || assigneeEmail;
      if (!assigneeEmail)
        throw Object.assign(
          new Error("Thiáº¿u email ngÆ°á»i phá»¥ trÃ¡ch má»›i"),
          { status: 400 },
        );
    }

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
      `UPDATE product_test_case SET status=$1,assignee_email=$2,assignee_name=$3,
       marketer_email=CASE WHEN $4='reassign_marketer' THEN $2 ELSE marketer_email END,
       marketer_name=CASE WHEN $4='reassign_marketer' THEN $3 ELSE marketer_name END,
       final_decision=$5,final_note=CASE WHEN $5 IS NOT NULL THEN $6 ELSE final_note END,
       decided_by=$7,decided_at=CASE WHEN $7 IS NOT NULL THEN now() ELSE decided_at END,
       version=version+1,updated_at=now() WHERE id=$8 RETURNING *`,
      [
        nextStatus,
        assigneeEmail,
        assigneeName,
        action,
        finalDecision,
        comment,
        decidedBy,
        productCase.id,
      ],
    );
    if (action === "approve_testing") {
      await client.query(
        `UPDATE product_test_proposal SET approved_by=$1,approved_at=now(),updated_at=now() WHERE case_id=$2`,
        [actor.email, productCase.id],
      );
    }
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
        JSON.stringify({
          version: version + 1,
          assignee_email: assigneeEmail,
          final_decision: finalDecision,
        }),
      ],
    );
    await client.query("COMMIT");
    const notification = {
      case_id: productCase.id,
      code: productCase.code,
      product_name: productCase.product_name,
      action: ACTION_LABELS[action] || action,
      actor,
      comment,
    };
    await notifyProductTestTransition(req, notification);
    return res.json({ case: result.rows[0], action, version: version + 1 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return apiError(res, error);
  } finally {
    client.release();
  }
}
