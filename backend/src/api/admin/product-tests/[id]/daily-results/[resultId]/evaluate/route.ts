import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { getPool } from "../../../../../../../lib/db";
import {
  apiError,
  cleanText,
  getProductTestActor,
  parseVersion,
  PRODUCT_TEST_PERMS,
  requireActorPermission,
} from "../../../../_lib";
import { mapDaily } from "../../../../_query";

const EVALUATIONS = ["Đạt", "Cần test thêm", "Không đạt"];

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const actor = await getProductTestActor(req);
    if (!actor) return res.status(401).json({ error: "Unauthenticated" });
    requireActorPermission(actor, PRODUCT_TEST_PERMS.approve);
    const body = req.body as any;
    const version = parseVersion(body.version);
    const evaluation = cleanText(body.evaluation, 100);
    if (!version)
      return res.status(400).json({ error: "Thiếu version kết quả hợp lệ" });
    if (!evaluation || !EVALUATIONS.includes(evaluation))
      return res.status(400).json({ error: "Đánh giá không hợp lệ" });
    const result = await getPool().query(
      `UPDATE product_test_daily_result d SET
       evaluation=$1,leader_note=$2,evaluated_by=$3,evaluated_at=now(),version=d.version+1,updated_at=now()
       FROM product_test_case c
       WHERE d.id=$4 AND d.case_id=$5 AND d.case_id=c.id AND d.version=$6
       AND d.deleted_at IS NULL AND c.deleted_at IS NULL AND c.status IN ('testing','awaiting_final_decision')
       RETURNING d.*`,
      [
        evaluation,
        cleanText(body.leader_note),
        actor.email,
        req.params.resultId,
        req.params.id,
        version,
      ],
    );
    if (!result.rows[0])
      return res
        .status(409)
        .json({
          error: "Kết quả không tồn tại, đã thay đổi hoặc đang bị khóa",
        });
    return res.json({ daily_result: mapDaily(result.rows[0]) });
  } catch (error) {
    return apiError(res, error);
  }
}
