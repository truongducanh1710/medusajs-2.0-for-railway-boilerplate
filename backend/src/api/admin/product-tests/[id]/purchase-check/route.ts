import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ulid } from "ulid";
import { getPool } from "../../../../../lib/db";
import {
  actorHas,
  apiError,
  cleanText,
  getProductTestActor,
  integerVnd,
  optionalNumber,
  parseVersion,
  PRODUCT_TEST_PERMS,
  rejectBodyFields,
} from "../../_lib";
import { mapPurchase } from "../../_query";
import { isConcluded } from "../../../../../modules/product-test/state-machine";
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
    // Marketing fills sourcing info while drafting; Purchasing takes over once
    // the case is submitted. The per-status check below enforces the handover.
    if (
      !actorHas(actor, PRODUCT_TEST_PERMS.purchasing) &&
      !actorHas(actor, PRODUCT_TEST_PERMS.marketing)
    ) {
      return res
        .status(403)
        .json({ error: "Không có quyền thực hiện thao tác này" });
    }
    const body = req.body as any;
    rejectBodyFields(body, [
      "status",
      "usp",
      "combo_json",
      "sale_price",
      "landing_url",
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
    // Anyone holding either role may edit Check giá at any open stage; only
    // the two terminal decisions lock it for good, preserving what the leader
    // actually saw when they decided.
    if (isConcluded(productCase.status)) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "Hồ sơ đã kết luận, không thể sửa Check giá" });
    }
    // Attribute "checked" to whichever role actually made this edit, not the
    // case's current stage — either side can edit at any open stage now.
    const actsAsPurchaser = actorHas(actor, PRODUCT_TEST_PERMS.purchasing);
    // Captured before the upsert so the cost milestone fires only the first
    // time a landed price appears, not on every subsequent save.
    const previous = await client.query(
      `SELECT landed_price_per_unit FROM product_purchase_check
       WHERE case_id=$1 AND deleted_at IS NULL LIMIT 1`,
      [req.params.id],
    );
    const hadCost = Number(previous.rows[0]?.landed_price_per_unit) > 0;

    const images = Array.isArray(body.image_urls)
      ? body.image_urls
          .filter((url: any) => typeof url === "string" && url.trim())
          .slice(0, 12)
      : [];
    const values = [
      req.params.id,
      cleanText(body.supplier_link, 2000),
      cleanText(body.supplier_name, 500),
      cleanText(body.description),
      cleanText(body.specification),
      cleanText(body.unit, 100),
      optionalNumber(body.moq),
      optionalNumber(body.source_price),
      cleanText(body.currency, 10) || "CNY",
      optionalNumber(body.exchange_rate),
      optionalNumber(body.weight_kg),
      cleanText(body.size, 200),
      optionalNumber(body.quantity_per_carton),
      integerVnd(body.shipping_fee),
      integerVnd(body.other_cost),
      integerVnd(body.landed_cost),
      integerVnd(body.landed_price_per_unit),
      cleanText(body.conclusion, 1000),
      cleanText(body.note),
      JSON.stringify(images),
      body.representative_image_url || images[0] || null,
      // Only a real Purchasing pass counts as "checked"; an MKT edit does not.
      actsAsPurchaser ? actor.email : null,
    ];
    const result = await client.query(
      `INSERT INTO product_purchase_check
       (id,case_id,supplier_link,supplier_name,description,specification,unit,moq,source_price,currency,exchange_rate,weight_kg,size,
        quantity_per_carton,shipping_fee,other_cost,landed_cost,landed_price_per_unit,conclusion,note,image_urls,representative_image_url,checked_by,checked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22,$23,CASE WHEN $23::text IS NULL THEN NULL ELSE now() END)
       ON CONFLICT (case_id) DO UPDATE SET supplier_link=EXCLUDED.supplier_link,supplier_name=EXCLUDED.supplier_name,
       description=EXCLUDED.description,specification=EXCLUDED.specification,unit=EXCLUDED.unit,moq=EXCLUDED.moq,source_price=EXCLUDED.source_price,
       currency=EXCLUDED.currency,exchange_rate=EXCLUDED.exchange_rate,weight_kg=EXCLUDED.weight_kg,size=EXCLUDED.size,
       quantity_per_carton=EXCLUDED.quantity_per_carton,shipping_fee=EXCLUDED.shipping_fee,other_cost=EXCLUDED.other_cost,
       landed_cost=EXCLUDED.landed_cost,landed_price_per_unit=EXCLUDED.landed_price_per_unit,conclusion=EXCLUDED.conclusion,note=EXCLUDED.note,
       image_urls=EXCLUDED.image_urls,representative_image_url=EXCLUDED.representative_image_url,
       checked_by=COALESCE(EXCLUDED.checked_by,product_purchase_check.checked_by),
       checked_at=CASE WHEN EXCLUDED.checked_by IS NULL THEN product_purchase_check.checked_at ELSE now() END,
       updated_at=now()
       RETURNING *`,
      [`ptpc_${ulid().toLowerCase()}`, ...values],
    );
    await client.query(
      `UPDATE product_test_case SET purchaser_email=COALESCE($1,purchaser_email),
       purchaser_name=COALESCE($2,purchaser_name),version=version+1,updated_at=now() WHERE id=$3`,
      [
        actsAsPurchaser ? actor.email : null,
        actsAsPurchaser ? actor.name : null,
        req.params.id,
      ],
    );
    await client.query("COMMIT");

    const saved = result.rows[0];
    if (!hadCost && Number(saved.landed_price_per_unit) > 0) {
      const facts: { label: string; value: string }[] = [];
      const cost = vnd(saved.landed_price_per_unit);
      if (cost) facts.push({ label: "Giá vốn / sp", value: cost });
      const total = vnd(saved.landed_cost);
      if (total) facts.push({ label: "Tổng giá vốn", value: total });
      if (saved.supplier_name)
        facts.push({ label: "Nhà cung cấp", value: String(saved.supplier_name) });
      if (saved.moq) facts.push({ label: "MOQ", value: String(saved.moq) });
      await postMilestone(req, {
        case_id: productCase.id,
        code: productCase.code,
        product_name: productCase.product_name,
        milestone: PRODUCT_TEST_MILESTONES.cost_ready,
        actor,
        comment: saved.conclusion || null,
        image_url:
          saved.representative_image_url ||
          (Array.isArray(saved.image_urls) ? saved.image_urls[0] : null),
        facts,
      });
    }
    res.json({
      purchase_check: mapPurchase(saved),
      version: version + 1,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return apiError(res, error);
  } finally {
    client.release();
  }
}
