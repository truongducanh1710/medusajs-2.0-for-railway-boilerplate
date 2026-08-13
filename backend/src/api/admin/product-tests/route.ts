import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ulid } from "ulid";
import { getPool } from "../../../lib/db";
import { aggregateMetrics } from "../../../modules/product-test/kpi";
import {
  apiError,
  getProductTestActor,
  PRODUCT_TEST_PERMS,
  requireActorPermission,
} from "./_lib";
import {
  buildSummary,
  emptyStatusCounts,
  mapProposal,
  mapPurchase,
} from "./_query";
import { createPurchasingTask, syncMarketingTask } from "./_tasks";
import { postMilestone, PRODUCT_TEST_MILESTONES } from "./_milestones";

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const actor = await getProductTestActor(req);
    if (!actor) return res.status(401).json({ error: "Unauthenticated" });
    requireActorPermission(actor, PRODUCT_TEST_PERMS.view);

    const q = req.query as Record<string, string>;
    const params: any[] = [];
    const where = ["c.deleted_at IS NULL"];
    const add = (value: any) => {
      params.push(value);
      return `$${params.length}`;
    };
    if (q.status) where.push(`c.status = ${add(q.status)}`);
    if (q.marketer)
      where.push(`c.marketer_email = ${add(q.marketer.toLowerCase())}`);
    if (q.owner) where.push(`c.assignee_email = ${add(q.owner.toLowerCase())}`);
    if (q.from) where.push(`c.created_at >= ${add(q.from)}::date`);
    if (q.to)
      where.push(`c.created_at < (${add(q.to)}::date + interval '1 day')`);
    if (q.q) {
      const term = add(`%${q.q}%`);
      where.push(
        `(c.code ILIKE ${term} OR c.product_name ILIKE ${term} OR c.marketer_name ILIKE ${term})`,
      );
    }
    const limit = Math.min(Math.max(Number(q.limit) || 200, 1), 500);
    const offset = Math.max(Number(q.offset) || 0, 0);
    params.push(limit, offset);

    const casesResult = await getPool().query(
      `SELECT c.* FROM product_test_case c WHERE ${where.join(" AND ")}
       ORDER BY c.updated_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const ids = casesResult.rows.map((row: any) => row.id);
    if (!ids.length) {
      return res.json({
        cases: [],
        overview: {
          total_cases: 0,
          testing_cases: 0,
          awaiting_leader_review: 0,
          concluded_cases: 0,
          by_status: emptyStatusCounts(),
          spend: 0,
          orders: 0,
          revenue: 0,
          leads: 0,
        },
        facets: {
          total: 0,
          by_status: emptyStatusCounts(),
          by_marketer: [],
          by_assignee: [],
        },
      });
    }

    const [purchaseResult, proposalResult, dailyResult] = await Promise.all([
      getPool().query(
        `SELECT * FROM product_purchase_check WHERE case_id = ANY($1::text[]) AND deleted_at IS NULL`,
        [ids],
      ),
      getPool().query(
        `SELECT * FROM product_test_proposal WHERE case_id = ANY($1::text[]) AND deleted_at IS NULL`,
        [ids],
      ),
      getPool().query(
        `SELECT * FROM product_test_daily_result WHERE case_id = ANY($1::text[]) AND deleted_at IS NULL`,
        [ids],
      ),
    ]);
    const purchaseMap = Object.fromEntries(
      purchaseResult.rows.map((row: any) => [row.case_id, mapPurchase(row)]),
    );
    const proposalMap = Object.fromEntries(
      proposalResult.rows.map((row: any) => [row.case_id, mapProposal(row)]),
    );
    const dailyMap: Record<string, any[]> = {};
    for (const row of dailyResult.rows)
      (dailyMap[row.case_id] ||= []).push(row);
    const cases = casesResult.rows.map((row: any) =>
      buildSummary(
        row,
        purchaseMap[row.id],
        proposalMap[row.id],
        dailyMap[row.id] || [],
      ),
    );

    const byStatus = emptyStatusCounts();
    const marketerMap = new Map<string, any>();
    const assigneeMap = new Map<string, any>();
    // "Chờ kết luận" no longer maps to a status (Leader now decides
    // straight from "testing") — it means: currently testing, with at
    // least one daily row still unevaluated, i.e. something for the
    // Leader to actually look at right now.
    let awaitingLeaderReview = 0;
    for (const row of cases) {
      byStatus[row.status] = (byStatus[row.status] || 0) + 1;
      if (row.status === "testing") {
        const rows = dailyMap[row.id] || [];
        if (rows.some((r: any) => !r.evaluation)) awaitingLeaderReview++;
      }
      const marketer = marketerMap.get(row.marketer_email) || {
        marketer_name: row.marketer_name,
        marketer_email: row.marketer_email,
        count: 0,
      };
      marketer.count++;
      marketerMap.set(row.marketer_email, marketer);
      const assignee = assigneeMap.get(row.assignee_email) || {
        assignee_name: row.assignee_name,
        assignee_email: row.assignee_email,
        count: 0,
      };
      assignee.count++;
      assigneeMap.set(row.assignee_email, assignee);
    }
    const totals = aggregateMetrics(
      cases.map((row: any) => ({
        ad_spend: row.spend,
        leads: row.leads,
        orders: row.orders,
        revenue: row.revenue,
      })),
    );
    res.json({
      cases,
      overview: {
        total_cases: cases.length,
        testing_cases: byStatus.testing || 0,
        awaiting_leader_review: awaitingLeaderReview,
        concluded_cases:
          (byStatus.import_approved || 0) + (byStatus.import_rejected || 0),
        by_status: byStatus,
        spend: totals.ad_spend,
        orders: totals.orders,
        revenue: totals.revenue,
        leads: totals.leads,
      },
      facets: {
        total: cases.length,
        by_status: byStatus,
        by_marketer: [...marketerMap.values()],
        by_assignee: [...assigneeMap.values()],
      },
    });
  } catch (error) {
    return apiError(res, error);
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const actor = await getProductTestActor(req);
    if (!actor) return res.status(401).json({ error: "Unauthenticated" });
    requireActorPermission(actor, PRODUCT_TEST_PERMS.marketing);
    const body = req.body as any;
    const productName = String(body?.product_name || "").trim();
    if (!productName)
      return res.status(400).json({ error: "Thiếu tên sản phẩm" });
    const id = `pt_${ulid().toLowerCase()}`;
    const code = `TSP-${new Date().toISOString().slice(2, 7).replace("-", "")}-${ulid().slice(-5)}`;
    const marketerEmail =
      actor.is_super && body.marketer_email
        ? String(body.marketer_email).toLowerCase()
        : actor.email;
    const marketerName =
      actor.is_super && body.marketer_name
        ? String(body.marketer_name)
        : actor.name;
    // Optional at creation — MKT can also pick the purchaser later from the
    // drawer; leaving it empty falls back to the sole eligible user.
    const purchaserEmail = body.purchaser_email
      ? String(body.purchaser_email).toLowerCase()
      : null;
    const { rows } = await getPool().query(
      `INSERT INTO product_test_case
       (id, code, product_name, product_handle, marketer_email, marketer_name, assignee_email, assignee_name,
        purchaser_email, purchaser_name, status, version)
       VALUES ($1,$2,$3,$4,$5,$6,$5,$6,$7,$8,'draft',1) RETURNING *`,
      [
        id,
        code,
        productName,
        body.product_handle || null,
        marketerEmail,
        marketerName,
        purchaserEmail,
        purchaserEmail ? String(body.purchaser_name || purchaserEmail) : null,
      ],
    );
    await getPool().query(
      `INSERT INTO product_test_event (id, case_id, action, from_status, to_status, actor, comment, snapshot)
       VALUES ($1,$2,'create_case',NULL,'draft',$3,NULL,$4)`,
      [
        `pte_${ulid().toLowerCase()}`,
        id,
        actor.email,
        JSON.stringify({ product_name: productName }),
      ],
    );
    const created = rows[0];
    await postMilestone(req, {
      case_id: created.id,
      code: created.code,
      product_name: created.product_name,
      milestone: PRODUCT_TEST_MILESTONES.created,
      actor,
      facts: [{ label: "MKT phụ trách", value: marketerName || marketerEmail }],
    });
    await syncMarketingTask(req, {
      caseId: created.id,
      code: created.code,
      productName: created.product_name,
      status: created.status,
      assigneeEmail: created.assignee_email,
      assigneeName: created.assignee_name,
      actor,
    });
    // Purchasing is told at creation now that no submit step exists.
    await createPurchasingTask(req, {
      caseId: created.id,
      code: created.code,
      productName: created.product_name,
      actor,
      purchaserEmail: created.purchaser_email,
      purchaserName: created.purchaser_name,
    });
    res.status(201).json({ case: created });
  } catch (error) {
    return apiError(res, error);
  }
}
