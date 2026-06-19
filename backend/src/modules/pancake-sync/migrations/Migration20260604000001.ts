import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Marketing Hub — Quản lý nguyên liệu video + Đăng Facebook + Đo video qua Ads.
 * 6 bảng: mkt_video, fb_page_token, fb_scheduled_post, fb_content_template,
 * fb_publish_job, mkt_ads_video.
 */
export class Migration20260604000001 extends Migration {
  async up(): Promise<void> {
    // ── Nguyên liệu video (thay Google Sheet) ──────────────────────────────
    this.addSql(`
      CREATE TABLE IF NOT EXISTS mkt_video (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vd_code      VARCHAR(16) UNIQUE NOT NULL,
        post_date    DATE,
        source       VARCHAR(16) DEFAULT 'team',
        maker        VARCHAR(64) NOT NULL,
        product      VARCHAR(128),
        product_code VARCHAR(64),
        video_type   VARCHAR(32),
        link         TEXT,
        status       VARCHAR(20) DEFAULT 'todo',
        note         TEXT,
        created_by   VARCHAR(255) NOT NULL,
        created_at   TIMESTAMPTZ DEFAULT now(),
        updated_at   TIMESTAMPTZ DEFAULT now()
      )
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS idx_mkt_video_maker  ON mkt_video (maker, post_date DESC)`)
    this.addSql(`CREATE INDEX IF NOT EXISTS idx_mkt_video_status ON mkt_video (status, post_date DESC)`)
    this.addSql(`CREATE INDEX IF NOT EXISTS idx_mkt_video_date   ON mkt_video (post_date DESC)`)
    this.addSql(`CREATE INDEX IF NOT EXISTS idx_mkt_video_vdcode ON mkt_video (vd_code)`)

    // Sequence cho vd_code tự tăng (VD + số). Bắt đầu từ 1001 cho dễ nhìn.
    this.addSql(`CREATE SEQUENCE IF NOT EXISTS mkt_video_vd_seq START 1001`)

    // ── Cache page access tokens ───────────────────────────────────────────
    this.addSql(`
      CREATE TABLE IF NOT EXISTS fb_page_token (
        page_id      VARCHAR(32) PRIMARY KEY,
        page_name    VARCHAR(255) NOT NULL,
        access_token TEXT NOT NULL,
        category     VARCHAR(128),
        fan_count    INT DEFAULT 0,
        fetched_at   TIMESTAMPTZ DEFAULT now()
      )
    `)

    // ── Bài đã đăng / lên lịch ─────────────────────────────────────────────
    this.addSql(`
      CREATE TABLE IF NOT EXISTS fb_scheduled_post (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        page_id       VARCHAR(32) NOT NULL,
        page_name     VARCHAR(255),
        post_id       VARCHAR(64),
        message       TEXT NOT NULL,
        drive_url     TEXT,
        media_type    VARCHAR(16) DEFAULT 'text',
        video_id      UUID,
        scheduled_for TIMESTAMPTZ,
        published_at  TIMESTAMPTZ,
        status        VARCHAR(20) DEFAULT 'pending',
        error_msg     TEXT,
        created_by    VARCHAR(255) NOT NULL,
        template_id   UUID,
        tags          TEXT[],
        created_at    TIMESTAMPTZ DEFAULT now()
      )
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS idx_fb_post_status ON fb_scheduled_post (status, scheduled_for)`)
    this.addSql(`CREATE INDEX IF NOT EXISTS idx_fb_post_page   ON fb_scheduled_post (page_id, created_at DESC)`)
    this.addSql(`CREATE INDEX IF NOT EXISTS idx_fb_post_user   ON fb_scheduled_post (created_by, created_at DESC)`)

    // ── Template nội dung ──────────────────────────────────────────────────
    this.addSql(`
      CREATE TABLE IF NOT EXISTS fb_content_template (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title       VARCHAR(255) NOT NULL,
        message     TEXT NOT NULL,
        tags        TEXT[],
        usage_count INT DEFAULT 0,
        created_by  VARCHAR(255) NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT now(),
        updated_at  TIMESTAMPTZ DEFAULT now(),
        deleted_at  TIMESTAMPTZ
      )
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS idx_fb_template_tags ON fb_content_template USING GIN (tags)`)

    // ── Job đăng nền (theo dõi tiến độ batch) ──────────────────────────────
    this.addSql(`
      CREATE TABLE IF NOT EXISTS fb_publish_job (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        total       INT NOT NULL,
        done        INT DEFAULT 0,
        status      VARCHAR(20) DEFAULT 'running',
        progress    JSONB,
        created_by  VARCHAR(255) NOT NULL,
        started_at  TIMESTAMPTZ DEFAULT now(),
        finished_at TIMESTAMPTZ
      )
    `)
    this.addSql(`ALTER TABLE fb_publish_job ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ DEFAULT now()`)
    this.addSql(`CREATE INDEX IF NOT EXISTS idx_fb_publish_job_user ON fb_publish_job (created_by, started_at DESC)`)

    // ── Ad-level insights theo video (đo hiệu quả video qua ads) ───────────
    this.addSql(`
      CREATE TABLE IF NOT EXISTS mkt_ads_video (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ad_id          VARCHAR(64) NOT NULL,
        ad_name        TEXT,
        vd_code        VARCHAR(16),
        account_id     VARCHAR(64),
        stat_date      DATE NOT NULL,
        spend          NUMERIC DEFAULT 0,
        impressions    BIGINT DEFAULT 0,
        clicks         BIGINT DEFAULT 0,
        ctr            NUMERIC DEFAULT 0,
        cpm            NUMERIC DEFAULT 0,
        video_3s       BIGINT DEFAULT 0,
        video_thruplay BIGINT DEFAULT 0,
        updated_at     TIMESTAMPTZ DEFAULT now(),
        UNIQUE (ad_id, stat_date)
      )
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS idx_mkt_ads_video_vd   ON mkt_ads_video (vd_code, stat_date DESC)`)
    this.addSql(`CREATE INDEX IF NOT EXISTS idx_mkt_ads_video_date ON mkt_ads_video (stat_date DESC)`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS mkt_ads_video`)
    this.addSql(`DROP TABLE IF EXISTS fb_publish_job`)
    this.addSql(`DROP TABLE IF EXISTS fb_content_template`)
    this.addSql(`DROP TABLE IF EXISTS fb_scheduled_post`)
    this.addSql(`DROP TABLE IF EXISTS fb_page_token`)
    this.addSql(`DROP SEQUENCE IF EXISTS mkt_video_vd_seq`)
    this.addSql(`DROP TABLE IF EXISTS mkt_video`)
  }
}
