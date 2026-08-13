import { MedusaContainer } from "@medusajs/framework";
import { getPool } from "../lib/db";
import {
  postMilestone,
  PRODUCT_TEST_MILESTONES,
} from "../api/admin/product-tests/_milestones";

const STALL_DAYS = 7;

// Chạy 09:00 hằng ngày — nhắc các hồ sơ đang test mà lâu không có số liệu mới.
// Chỉ nhắc lại mỗi 7 ngày cho cùng một hồ sơ, tránh spam group chat.
export default async function productTestStalled(container: MedusaContainer) {
  const logger = container.resolve("logger") as any;
  try {
    const { rows } = await getPool().query(
      `SELECT c.id, c.code, c.product_name, c.assignee_name, c.assignee_email,
              pc.representative_image_url, pc.image_urls,
              GREATEST(
                COALESCE(MAX(d.created_at), c.updated_at),
                c.updated_at
              ) AS last_touch,
              COUNT(d.id)::int AS rows_count
       FROM product_test_case c
       LEFT JOIN product_test_daily_result d
         ON d.case_id = c.id AND d.deleted_at IS NULL
       LEFT JOIN product_purchase_check pc
         ON pc.case_id = c.id AND pc.deleted_at IS NULL
       WHERE c.deleted_at IS NULL AND c.status = 'testing'
       GROUP BY c.id, pc.representative_image_url, pc.image_urls
       HAVING GREATEST(COALESCE(MAX(d.created_at), c.updated_at), c.updated_at)
              < now() - ($1 || ' days')::interval`,
      [STALL_DAYS],
    );

    if (!rows.length) {
      logger?.info?.("[ProductTestStalled] No stalled cases");
      return;
    }

    for (const row of rows) {
      // The last stall warning is itself an event, so a case that was already
      // warned inside the window is skipped until it goes quiet again.
      const warned = await getPool().query(
        `SELECT 1 FROM product_test_event
         WHERE case_id=$1 AND action='stall_warning'
           AND created_at > now() - ($2 || ' days')::interval
         LIMIT 1`,
        [row.id, STALL_DAYS],
      );
      if (warned.rows.length) continue;

      const days = Math.floor(
        (Date.now() - new Date(row.last_touch).getTime()) / 86_400_000,
      );
      await postMilestone(container as any, {
        case_id: row.id,
        code: row.code,
        product_name: row.product_name,
        milestone: PRODUCT_TEST_MILESTONES.stalled,
        actor: row.assignee_email
          ? { email: row.assignee_email, name: row.assignee_name || row.assignee_email }
          : null,
        comment: `Đã ${days} ngày không có số liệu mới — cần nhập kết quả hoặc kết luận.`,
        image_url:
          row.representative_image_url ||
          (Array.isArray(row.image_urls) ? row.image_urls[0] : null),
        facts: [
          { label: "Số ngày im ắng", value: String(days) },
          { label: "Dòng kết quả đã có", value: String(row.rows_count) },
          { label: "MKT phụ trách", value: row.assignee_name || "—" },
        ],
      });
      await getPool().query(
        `INSERT INTO product_test_event (id,case_id,action,from_status,to_status,actor,comment,snapshot)
         VALUES ('pte_' || lower(replace(gen_random_uuid()::text,'-','')),$1,'stall_warning','testing','testing','system',$2,'{}'::jsonb)`,
        [row.id, `Nhắc test ỳ ${days} ngày`],
      );
    }
    logger?.info?.(`[ProductTestStalled] Checked ${rows.length} stalled cases`);
  } catch (e: any) {
    logger?.error?.(`[ProductTestStalled] Error: ${e.message}`);
  }
}

export const config = {
  name: "product-test-stalled",
  schedule: "0 9 * * *", // 09:00 hằng ngày
};
