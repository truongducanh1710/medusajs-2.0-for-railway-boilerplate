import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ulid } from "ulid";
import { getPool } from "../../../../../lib/db";
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
} from "../../_lib";
import { mapDaily } from "../../_query";

function validDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null;
  return Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? null : value;
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const actor = await getProductTestActor(req);
    if (!actor) return res.status(401).json({ error: "Unauthenticated" });
    requireActorPermission(actor, PRODUCT_TEST_PERMS.view);
    const result = await getPool().query(
      `SELECT * FROM product_test_daily_result
       WHERE case_id=$1 AND deleted_at IS NULL
       ORDER BY test_date DESC, created_at DESC`,
      [req.params.id],
    );
    const linked = await getPool().query(
      `SELECT pc.image_urls,pc.representative_image_url,p.landing_url,p.combo_json
       FROM product_test_case c
       LEFT JOIN product_purchase_check pc ON pc.case_id=c.id AND pc.deleted_at IS NULL
       LEFT JOIN product_test_proposal p ON p.case_id=c.id AND p.deleted_at IS NULL
       WHERE c.id=$1 AND c.deleted_at IS NULL`,
      [req.params.id],
    );
    return res.json({
      daily_results: result.rows.map(mapDaily),
      linked: linked.rows[0] || null,
    });
  } catch (error) {
    return apiError(res, error);
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
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
    const caseVersion = parseVersion(body.version);
    const testDate = validDate(body.test_date);
    if (!caseVersion)
      return res.status(400).json({ error: "Thiếu version hợp lệ" });
    if (!testDate)
      return res.status(400).json({ error: "Ngày test không hợp lệ" });

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
    if (Number(productCase.version) !== caseVersion) {
      await client.query("ROLLBACK");
      return res
        .status(409)
        .json({ error: "Hồ sơ đã được người khác cập nhật" });
    }
    if (productCase.status !== "testing") {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "Chỉ được nhập kết quả khi đang test" });
    }
    if (productCase.assignee_email !== actor.email && !actor.is_super) {
      await client.query("ROLLBACK");
      return res
        .status(403)
        .json({ error: "Chỉ MKT phụ trách được nhập kết quả" });
    }

    const result = await client.query(
      `INSERT INTO product_test_daily_result
       (id,case_id,test_date,tester_name,campaign_name,ad_spend,impressions,clicks,leads,orders,cancelled_orders,revenue,version)
       VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12,1) RETURNING *`,
      [
        `ptdr_${ulid().toLowerCase()}`,
        req.params.id,
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
      ],
    );
    await client.query(
      `UPDATE product_test_case SET version=version+1,updated_at=now() WHERE id=$1`,
      [req.params.id],
    );
    await client.query("COMMIT");
    return res
      .status(201)
      .json({
        daily_result: mapDaily(result.rows[0]),
        version: caseVersion + 1,
      });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return apiError(res, error);
  } finally {
    client.release();
  }
}
