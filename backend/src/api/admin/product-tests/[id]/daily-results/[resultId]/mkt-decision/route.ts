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

/**
 * Nhận định của MKT cho một ngày test — tách hẳn khỏi đánh giá của leader.
 *
 * MKT là người chạy camp nên thấy tín hiệu trước; leader nhìn đề xuất này rồi
 * mới chốt nhập/không nhập. Vì vậy quyền ở đây là `marketing` (không phải
 * `approve`) và chỉ MKT phụ trách hồ sơ mới ghi được.
 */
const DECISIONS = ["test_tiep", "dung", "de_xuat_nhap"];

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const actor = await getProductTestActor(req);
    if (!actor) return res.status(401).json({ error: "Unauthenticated" });
    requireActorPermission(actor, PRODUCT_TEST_PERMS.marketing);
    const body = req.body as any;
    const version = parseVersion(body.version);
    const decision = cleanText(body.mkt_decision, 40);
    if (!version)
      return res.status(400).json({ error: "Thiếu version kết quả hợp lệ" });
    if (!decision || !DECISIONS.includes(decision))
      return res.status(400).json({ error: "Đề xuất không hợp lệ" });

    const result = await getPool().query(
      `UPDATE product_test_daily_result d SET
       mkt_decision=$1,mkt_note=$2,mkt_decided_by=$3,mkt_decided_at=now(),
       version=d.version+1,updated_at=now()
       FROM product_test_case c
       WHERE d.id=$4 AND d.case_id=$5 AND d.case_id=c.id AND d.version=$6
       AND d.deleted_at IS NULL AND c.deleted_at IS NULL
       AND c.status NOT IN ('import_approved','import_rejected')
       AND ($7 OR c.assignee_email=$8)
       RETURNING d.*`,
      [
        decision,
        cleanText(body.mkt_note),
        actor.email,
        req.params.resultId,
        req.params.id,
        version,
        actor.is_super,
        actor.email,
      ],
    );
    if (!result.rows[0])
      return res.status(409).json({
        error:
          "Kết quả không tồn tại, đã thay đổi, đang bị khóa hoặc bạn không phụ trách hồ sơ này",
      });
    return res.json({ daily_result: mapDaily(result.rows[0]) });
  } catch (error) {
    return apiError(res, error);
  }
}
