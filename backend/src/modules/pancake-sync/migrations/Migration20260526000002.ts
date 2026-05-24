import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260526000002 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      -- Thêm comment giải thích status mới: 'superseded' và 'expired'
      -- pending → đang chờ duyệt (rec mới nhất per camp)
      -- approved/rejected → marketer đã quyết
      -- auto_executed → agent tự thực thi xong
      -- superseded → bị rec mới hơn cùng camp ghi đè
      -- expired → quá 6h chưa duyệt, agent cũ sẽ ignore

      -- Index hỗ trợ query dedup (campaign_id + status + created_at)
      CREATE INDEX IF NOT EXISTS idx_agent_rec_camp_status
        ON agent_camp_recommendation (campaign_id, status, created_at DESC);

      -- Auto-supersede trigger: khi insert rec mới với status='pending' hoặc 'auto_executed',
      -- update các rec 'pending' cũ hơn cùng campaign_id → 'superseded'
      CREATE OR REPLACE FUNCTION supersede_old_recs() RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.status IN ('pending', 'auto_executed') THEN
          UPDATE agent_camp_recommendation
          SET status = 'superseded'
          WHERE campaign_id = NEW.campaign_id
            AND status = 'pending'
            AND id <> NEW.id
            AND created_at < NEW.created_at;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_supersede_recs ON agent_camp_recommendation;
      CREATE TRIGGER trg_supersede_recs
        AFTER INSERT ON agent_camp_recommendation
        FOR EACH ROW
        EXECUTE FUNCTION supersede_old_recs();

      -- Backfill: supersede tất cả pending recs cũ, chỉ giữ 1 pending mới nhất per camp
      WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY campaign_id ORDER BY created_at DESC) AS rn
        FROM agent_camp_recommendation
        WHERE status = 'pending'
      )
      UPDATE agent_camp_recommendation
      SET status = 'superseded'
      WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      DROP TRIGGER IF EXISTS trg_supersede_recs ON agent_camp_recommendation;
      DROP FUNCTION IF EXISTS supersede_old_recs();
      DROP INDEX IF EXISTS idx_agent_rec_camp_status;
    `)
  }
}
