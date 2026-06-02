import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260603000001 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      -- Rule chăm sóc camp tự động theo marketer
      CREATE TABLE IF NOT EXISTS mkt_care_rule (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(120) NOT NULL,
        mkt_name VARCHAR(32) NOT NULL,
        rule_mode VARCHAR(16) NOT NULL DEFAULT 'manual',
        scope_type VARCHAR(20) NOT NULL DEFAULT 'all',
        scope_value TEXT,
        conditions JSONB,
        condition_logic VARCHAR(4) NOT NULL DEFAULT 'AND',
        product_key VARCHAR(64),
        time_window VARCHAR(16) NOT NULL DEFAULT 'today',
        action VARCHAR(20) NOT NULL,
        action_payload JSONB,
        check_schedule VARCHAR(16) NOT NULL DEFAULT 'hourly',
        min_spend BIGINT NOT NULL DEFAULT 200000,
        cooldown_hours SMALLINT NOT NULL DEFAULT 12,
        enabled BOOLEAN NOT NULL DEFAULT true,
        created_by_email VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now(),
        deleted_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_mkt_care_rule_active
        ON mkt_care_rule (mkt_name, enabled, check_schedule)
        WHERE deleted_at IS NULL AND enabled = true;

      -- Bảng ngưỡng SP dùng chung cho Dạng B (smart_product)
      CREATE TABLE IF NOT EXISTS product_care_threshold (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_key VARCHAR(64) NOT NULL UNIQUE,
        product_label VARCHAR(120) NOT NULL,
        target_cpr BIGINT NOT NULL,
        new_camp_multiplier NUMERIC(4,2) NOT NULL DEFAULT 2.0,
        old_camp_warn_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.5,
        old_camp_kill_multiplier NUMERIC(4,2) NOT NULL DEFAULT 2.0,
        updated_by_email VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      -- Seed ngưỡng SP mặc định từ data thực tế
      INSERT INTO product_care_threshold
        (product_key, product_label, target_cpr, new_camp_multiplier, old_camp_warn_multiplier, old_camp_kill_multiplier)
      VALUES
        ('CHAO_VANG_HAP',      'Chảo vàng hấp',        150000, 2.0, 1.5, 2.0),
        ('CHAO_VANG_TITAN',    'Chảo vàng titan',       150000, 2.0, 1.5, 2.0),
        ('CHAO_TIM',           'Chảo tím',              130000, 2.0, 1.5, 2.0),
        ('NOI_AP_SUAT',        'Nồi áp suất',           150000, 2.0, 1.5, 2.0),
        ('NOI_CHIEN',          'Nồi chiên',             150000, 2.0, 1.5, 2.0),
        ('NOI_TRANG_MEN',      'Nồi tráng men',         150000, 2.0, 1.5, 2.0),
        ('KE_BEP',             'Kệ bếp đa năng',        120000, 2.0, 1.5, 2.0),
        ('HOP_NHIEU_NGAN',     'Hộp nhựa nhiều ngăn',  100000, 2.0, 1.5, 2.0),
        ('CHOI_XOP_VAT',       'Chổi xốp vắt',          80000, 2.0, 1.5, 2.0),
        ('BO_LAU_NHA',         'Bộ lau nhà 3 giẻ',      80000, 2.0, 1.5, 2.0),
        ('GAY_CHONG',          'Gậy chống người già',   120000, 2.0, 1.5, 2.0)
      ON CONFLICT (product_key) DO NOTHING;

      -- Log lịch sử rule trigger (audit + cooldown)
      CREATE TABLE IF NOT EXISTS mkt_care_rule_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        rule_id UUID NOT NULL,
        campaign_id VARCHAR(64) NOT NULL,
        campaign_name TEXT NOT NULL,
        matched BOOLEAN NOT NULL DEFAULT false,
        metrics_snapshot JSONB,
        action_taken VARCHAR(32) NOT NULL,
        schedule_id UUID,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_mkt_care_rule_log
        ON mkt_care_rule_log (rule_id, campaign_id, created_at DESC);

      -- Thêm cột fb_campaign_id vào pancake_order (backfill từ raw.utm_id)
      ALTER TABLE pancake_order
        ADD COLUMN IF NOT EXISTS fb_campaign_id VARCHAR(64);
      CREATE INDEX IF NOT EXISTS idx_pancake_order_fb_campaign
        ON pancake_order (fb_campaign_id, pancake_created_at)
        WHERE fb_campaign_id IS NOT NULL;

      -- Backfill fb_campaign_id từ utm_id trong raw
      UPDATE pancake_order
      SET fb_campaign_id = substring(raw::text from 'utm_id=([0-9]+)')
      WHERE fb_campaign_id IS NULL
        AND raw IS NOT NULL
        AND raw::text ILIKE '%utm_id=%';

      -- Thêm cột learning_stage vào mkt_ads_cost
      ALTER TABLE mkt_ads_cost
        ADD COLUMN IF NOT EXISTS learning_stage VARCHAR(20);
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      DROP TABLE IF EXISTS mkt_care_rule_log;
      DROP TABLE IF EXISTS product_care_threshold;
      DROP TABLE IF EXISTS mkt_care_rule;
      ALTER TABLE pancake_order DROP COLUMN IF EXISTS fb_campaign_id;
      ALTER TABLE mkt_ads_cost DROP COLUMN IF EXISTS learning_stage;
    `)
  }
}
