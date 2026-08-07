import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { getPool } from "../../../../../../lib/db";
import {
  apiError,
  cleanText,
  getProductTestActor,
  integerVnd,
  optionalNumber,
  parseVersion,
  PRODUCT_TEST_PERMS,
  rejectBodyFields,
  requireActorPermission,
} from "../../../_lib";
import { mapDaily } from "../../../_query";

function validDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null;
  return Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? null : value;
}

export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  const client = await getPool().connect();
  try {
    const actor = await getProductTestActor(req);
    if (!actor) return res.status(401).json({ error: "Unauthenticated" });
    requireActorPermission(actor, PRODUCT_TEST_PERMS.marketing);
    const body = req.body as any;
    rejectBodyFields(body, [
      "status",
      "image_urls",
      "representative_image_url",
      "landing_url",
      "combo_json",
      "usp",
      "landed_cost",
      "landed_price_per_unit",
      "evaluation",
      "leader_note",
    ]);
    const resultVersion = parseVersion(body.version);
    const testDate = validDate(body.test_date);
    if (!resultVersion)
      return res.status(400).json({ error: "Thiếu version kết quả hợp lệ" });
    if (!testDate)
      return res.status(400).json({ error: "Ngày test không hợp lệ" });

    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT d.*, c.status AS case_status, c.assignee_email
       FROM product_test_daily_result d
       JOIN product_test_case c ON c.id=d.case_id
       WHERE d.id=$1 AND d.case_id=$2 AND d.deleted_at IS NULL AND c.deleted_at IS NULL
       FOR UPDATE OF d`,
      [req.params.resultId, req.params.id],
    );
    const row = locked.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Không tìm thấy kết quả test" });
    }
    if (Number(row.version) !== resultVersion) {
      await client.query("ROLLBACK");
      return res
        .status(409)
        .json({ error: "Kết quả đã được người khác cập nhật" });
    }
    if (row.case_status !== "testing") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Kết quả đã bị khóa" });
    }
    if (row.assignee_email !== actor.email && !actor.is_super) {
      await client.query("ROLLBACK");
      return res
        .status(403)
        .json({ error: "Chỉ MKT phụ trách được sửa kết quả" });
    }

    const result = await client.query(
      `UPDATE product_test_daily_result SET
       test_date=$1::date,tester_name=$2,campaign_name=$3,ad_spend=$4,impressions=$5,clicks=$6,
       leads=$7,orders=$8,cancelled_orders=$9,revenue=$10,version=version+1,updated_at=now()
       WHERE id=$11 RETURNING *`,
      [
        testDate,
        cleanText(body.tester_name, 300) || actor.name,
        cleanText(body.campaign_name, 500),
        integerVnd(body.ad_spend),
        optionalNumber(body.impressions),
        optionalNumber(body.clicks),
        optionalNumber(body.leads),
        optionalNumber(body.orders),
        optionalNumber(body.cancelled_orders),
        integerVnd(body.revenue),
        req.params.resultId,
      ],
    );
    await client.query(
      `UPDATE product_test_case SET version=version+1,updated_at=now() WHERE id=$1`,
      [req.params.id],
    );
    await client.query("COMMIT");
    return res.json({ daily_result: mapDaily(result.rows[0]) });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return apiError(res, error);
  } finally {
    client.release();
  }
}
