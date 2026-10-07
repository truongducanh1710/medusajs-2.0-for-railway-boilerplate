import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { getPool } from "../../../../lib/db";
import { getOwnScope } from "../../../../lib/freelance-scope";
import {
  apiError,
  getProductTestActor,
  PRODUCT_TEST_PERMS,
  requireActorPermission,
} from "../_lib";
import { emptyStatusCounts } from "../_query";

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const actor = await getProductTestActor(req);
    if (!actor) return res.status(401).json({ error: "Unauthenticated" });
    requireActorPermission(actor, PRODUCT_TEST_PERMS.view);
    // Freelancer: đếm trên đúng tập hồ sơ họ thấy ở danh sách.
    const scope = getOwnScope(req);
    const own = scope
      ? ` AND (lower(marketer_email) = $1 OR lower(assignee_email) = $1)`
      : "";
    const params = scope ? [scope.email] : [];
    const [statusResult, marketerResult, assigneeResult] = await Promise.all([
      getPool().query(
        `SELECT status,count(*)::int AS count FROM product_test_case WHERE deleted_at IS NULL${own} GROUP BY status`,
        params,
      ),
      getPool().query(
        `SELECT marketer_email,marketer_name,count(*)::int AS count FROM product_test_case WHERE deleted_at IS NULL${own} GROUP BY marketer_email,marketer_name ORDER BY marketer_name`,
        params,
      ),
      getPool().query(
        `SELECT assignee_email,assignee_name,count(*)::int AS count FROM product_test_case WHERE deleted_at IS NULL${own} GROUP BY assignee_email,assignee_name ORDER BY assignee_name`,
        params,
      ),
    ]);
    const byStatus = emptyStatusCounts();
    for (const row of statusResult.rows) byStatus[row.status] = row.count;
    const total = statusResult.rows.reduce(
      (sum: number, row: any) => sum + Number(row.count),
      0,
    );
    return res.json({
      total,
      by_status: byStatus,
      by_marketer: marketerResult.rows,
      by_assignee: assigneeResult.rows,
    });
  } catch (error) {
    return apiError(res, error);
  }
}
