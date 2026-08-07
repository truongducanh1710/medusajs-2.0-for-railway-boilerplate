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
    // Marketing drafts the sourcing info; Purchasing owns it after submission.
    const MARKETING_EDIT_STATUSES = ["draft", "purchase_changes_requested"];
    const isMarketingStage = MARKETING_EDIT_STATUSES.includes(
      productCase.status,
    );
    const isPurchasingStage = productCase.status === "awaiting_purchase_check";
    if (!isMarketingStage && !isPurchasingStage) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "Không thể sửa Check giá ở trạng thái hiện tại" });
    }
    if (isMarketingStage) {
      if (!actorHas(actor, PRODUCT_TEST_PERMS.marketing)) {
        await client.query("ROLLBACK");
        return res
          .status(403)
          .json({ error: "Chỉ MKT được sửa Check giá ở bước này" });
      }
      if (productCase.assignee_email !== actor.email && !actor.is_super) {
        await client.query("ROLLBACK");
        return res
          .status(403)
          .json({ error: "Chỉ MKT phụ trách được sửa hồ sơ này" });
      }
    } else if (!actorHas(actor, PRODUCT_TEST_PERMS.purchasing)) {
      await client.query("ROLLBACK");
      return res
        .status(403)
        .json({ error: "Chỉ Mua hàng được sửa Check giá ở bước này" });
    }

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
      // Only a real Purchasing pass counts as "checked"; an MKT draft does not.
      isPurchasingStage ? actor.email : null,
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
        isPurchasingStage ? actor.email : null,
        isPurchasingStage ? actor.name : null,
        req.params.id,
      ],
    );
    await client.query("COMMIT");
    res.json({
      purchase_check: mapPurchase(result.rows[0]),
      version: version + 1,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return apiError(res, error);
  } finally {
    client.release();
  }
}
