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
import {
  deriveStatus,
  isConcluded,
} from "../../../../../modules/product-test/state-machine";
import {
  postMilestone,
  PRODUCT_TEST_MILESTONES,
  vnd,
} from "../../_milestones";

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
    // Anyone holding either role may edit the proposal — case ownership no
    // longer restricts it, so filling in for a colleague can never leave a
    // case stuck. Only the two terminal decisions lock it, preserving what the
    // leader saw when they decided.
    if (isConcluded(productCase.status)) {
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
    const saved = result.rows[0];
    // Status follows the data: a proposal carrying a price and a combo means
    // the case is ready to run, with no approval step in between.
    const nextStatus = deriveStatus(productCase.status, saved);
    const startedTesting =
      nextStatus === "testing" && productCase.status !== "testing";
    await client.query(
      `UPDATE product_test_case SET status=$2,version=version+1,updated_at=now() WHERE id=$1`,
      [req.params.id, nextStatus],
    );
    if (startedTesting) {
      await client.query(
        `INSERT INTO product_test_event (id,case_id,action,from_status,to_status,actor,comment,snapshot)
         VALUES ($1,$2,'start_testing',$3,$4,$5,NULL,$6::jsonb)`,
        [
          `pte_${ulid().toLowerCase()}`,
          req.params.id,
          productCase.status,
          nextStatus,
          actor.email,
          JSON.stringify({ version: version + 1 }),
        ],
      );
    }
    await client.query("COMMIT");

    if (startedTesting) {
      const image = await getPool().query(
        `SELECT representative_image_url, image_urls, landed_price_per_unit
         FROM product_purchase_check WHERE case_id=$1 AND deleted_at IS NULL LIMIT 1`,
        [req.params.id],
      );
      const imageRow = image.rows[0];
      const facts: { label: string; value: string }[] = [];
      const cost = vnd(imageRow?.landed_price_per_unit);
      if (cost) facts.push({ label: "Giá vốn", value: cost });
      const price = vnd(saved.sale_price);
      if (price) facts.push({ label: "Giá bán", value: price });
      const margin =
        Number(saved.sale_price) - Number(imageRow?.landed_price_per_unit);
      const marginText = vnd(margin);
      if (marginText && Number.isFinite(margin))
        facts.push({ label: "Biên", value: marginText });
      if (saved.combo_json)
        facts.push({ label: "Combo", value: String(saved.combo_json) });
      if (saved.landing_url)
        facts.push({ label: "Landing", value: String(saved.landing_url) });
      await postMilestone(req, {
        case_id: productCase.id,
        code: productCase.code,
        product_name: productCase.product_name,
        milestone: PRODUCT_TEST_MILESTONES.testing_started,
        actor,
        image_url:
          imageRow?.representative_image_url ||
          (Array.isArray(imageRow?.image_urls) ? imageRow.image_urls[0] : null),
        facts,
      });
    }
    res.json({
      proposal: mapProposal(saved),
      version: version + 1,
      status: nextStatus,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return apiError(res, error);
  } finally {
    client.release();
  }
}
