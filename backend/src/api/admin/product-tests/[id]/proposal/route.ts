import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ulid } from "ulid";
import { getPool } from "../../../../../lib/db";
import {
  actorHas,
  apiError,
  cleanText,
  getProductTestActor,
  integerVnd,
  parseVersion,
  PRODUCT_TEST_PERMS,
  rejectBodyFields,
} from "../../_lib";
import { mapProposal } from "../../_query";

export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  const client = await getPool().connect();
  try {
    const actor = await getProductTestActor(req);
    if (!actor) return res.status(401).json({ error: "Unauthenticated" });
    if (
      !actorHas(actor, PRODUCT_TEST_PERMS.marketing) &&
      !actorHas(actor, PRODUCT_TEST_PERMS.purchasing)
    ) {
      return res
        .status(403)
        .json({ error: "Không có quyền thực hiện thao tác này" });
    }
    const body = req.body as any;
    rejectBodyFields(body, [
      "status",
      "image_urls",
      "representative_image_url",
      "landed_cost",
      "landed_price_per_unit",
      "daily_results",
    ]);
    const version = parseVersion(body.version);
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
    const isMarketer =
      actorHas(actor, PRODUCT_TEST_PERMS.marketing) &&
      (actor.is_super || productCase.assignee_email === actor.email);
    const isPurchaser = actorHas(actor, PRODUCT_TEST_PERMS.purchasing);
    if (!isMarketer && !isPurchaser) {
      await client.query("ROLLBACK");
      return res
        .status(403)
        .json({ error: "Chỉ MKT phụ trách hoặc Mua hàng được sửa đề xuất" });
    }
    // Either role may edit the proposal at any open stage; only the two
    // terminal decisions lock it, preserving what the leader saw when they
    // decided.
    if (["import_approved", "import_rejected"].includes(productCase.status)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Hồ sơ đã kết luận, đề xuất đã bị khóa" });
    }
    const values = [
      req.params.id,
      cleanText(body.usp),
      cleanText(body.combo_json),
      integerVnd(body.sale_price),
      cleanText(body.gift_name, 500),
      cleanText(body.promo_title, 1000),
      cleanText(body.ad_content),
      cleanText(body.reference_link, 2000),
      cleanText(body.landing_url, 2000),
      cleanText(body.note),
    ];
    const result = await client.query(
      `INSERT INTO product_test_proposal (id,case_id,usp,combo_json,sale_price,gift_name,promo_title,ad_content,reference_link,landing_url,note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (case_id) DO UPDATE SET usp=EXCLUDED.usp,combo_json=EXCLUDED.combo_json,sale_price=EXCLUDED.sale_price,
       gift_name=EXCLUDED.gift_name,promo_title=EXCLUDED.promo_title,ad_content=EXCLUDED.ad_content,reference_link=EXCLUDED.reference_link,
       landing_url=EXCLUDED.landing_url,note=EXCLUDED.note,updated_at=now() RETURNING *`,
      [`ptpr_${ulid().toLowerCase()}`, ...values],
    );
    await client.query(
      `UPDATE product_test_case SET version=version+1,updated_at=now() WHERE id=$1`,
      [req.params.id],
    );
    await client.query("COMMIT");
    res.json({ proposal: mapProposal(result.rows[0]), version: version + 1 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return apiError(res, error);
  } finally {
    client.release();
  }
}
