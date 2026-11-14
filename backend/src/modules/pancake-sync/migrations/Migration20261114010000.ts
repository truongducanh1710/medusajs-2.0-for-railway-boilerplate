import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * order_funnel — mỗi đơn Pancake 1 dòng, dựng lại từ pancake_order + ity_cdr_call + ad_video_map +
 * mkt_ads_cost(_ad) bởi lib/order-funnel.ts (job order-funnel-sync). KHÔNG sửa pancake_order.
 * Mục đích: agent/báo cáo đọc phễu đơn (gán camp/ad/video, có tính DS MKT, xác nhận, cuộc gọi đầu,
 * giao/huỷ/hoàn) bằng SELECT thay vì mỗi nơi tự bóc raw ~8KB/đơn.
 * Bảng dẫn xuất: xoá đi dựng lại được, không phải nguồn sự thật.
 */
export class Migration20261114010000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS order_funnel (
        order_id           TEXT PRIMARY KEY,        -- = pancake_order.id
        order_created_at   TIMESTAMPTZ,             -- pancake_created_at
        created_date       DATE,                    -- ngày tạo giờ VN
        source             TEXT,
        mkt                TEXT,                    -- MKT_OF_ORDER_SQL, đã áp mkt_handover theo ngày
        -- gán quảng cáo (utm của đơn + bảng ads)
        attr_source        TEXT,                    -- utm | none
        utm_source         TEXT,
        utm_campaign       TEXT,
        utm_term           TEXT,
        utm_content        TEXT,
        campaign_id        TEXT,
        campaign_name      TEXT,
        adset_id           TEXT,
        ad_id              TEXT,
        post_id            TEXT,
        vd_code            TEXT,
        product_code       TEXT,                    -- mkt_product.code khớp mã SP đầu tên camp
        -- doanh số theo định nghĩa lib/mkt-today.ts
        in_ds_mkt          BOOLEAN NOT NULL DEFAULT false,
        revenue            BIGINT,
        is_draft           BOOLEAN NOT NULL DEFAULT false,
        -- sale
        confirmed_at       TIMESTAMPTZ,             -- lần đầu status = 1
        first_call_at      TIMESTAMPTZ,             -- cuộc gọi đi đầu tiên (ITY CDR) sau khi tạo đơn
        calls_n            INTEGER NOT NULL DEFAULT 0,
        calls_answered_n   INTEGER NOT NULL DEFAULT 0,
        notes_n            INTEGER NOT NULL DEFAULT 0,
        -- giao hàng
        status             INTEGER,
        status_name        TEXT,
        delivered_at       TIMESTAMPTZ,             -- lần đầu status = 3
        canceled_at        TIMESTAMPTZ,             -- lần đầu status = 6
        returned_at        TIMESTAMPTZ,             -- lần đầu status 4 / 5
        final_status       INTEGER,                 -- 3 giao | 6 huỷ | 4,5 hoàn | NULL chưa chốt
        final_seen_at      TIMESTAMPTZ,             -- lúc thấy final_status hiện tại lần đầu (mốc lịch sử nếu có)
        source_updated_at  TIMESTAMPTZ,             -- GREATEST(pancake_order.updated_at, synced_at)
        synced_at          TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS idx_order_funnel_date_product ON order_funnel (created_date, product_code)`)
    this.addSql(`CREATE INDEX IF NOT EXISTS idx_order_funnel_camp_date ON order_funnel (campaign_id, created_date)`)
    this.addSql(`CREATE INDEX IF NOT EXISTS idx_order_funnel_vd ON order_funnel (vd_code, created_date)`)
    this.addSql(`CREATE INDEX IF NOT EXISTS idx_order_funnel_mkt_date ON order_funnel (mkt, created_date)`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS order_funnel`)
  }
}
