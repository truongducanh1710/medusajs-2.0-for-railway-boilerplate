import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Sổ đăng ký camp do agent quản lý.
 *
 * Thay cho hướng ban đầu là nhận biết qua hậu tố "_AGENT" trong tên camp. Tên camp
 * do người gõ nên gõ nhầm hoặc quên là agent mất quyền với chính camp của mình —
 * hoặc tệ hơn, nhận nhầm camp của người khác. Ghi vào DB thì không nhầm được.
 *
 * Camp vào bảng này theo hai đường:
 *   - agent tự tạo camp  → tự ghi, source='agent_created'
 *   - người giao camp có sẵn cho agent → source='human_assigned'
 *
 * Bỏ khỏi bảng (hoặc active=false) là agent thôi đụng vào camp đó ngay vòng sau.
 */
export class Migration20260918100000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "agent_managed_campaign" (
        "campaign_id" varchar(64) not null,
        "campaign_name" text not null default '',
        "ad_account_id" varchar(64) not null default '',
        "mkt_name" varchar(32) not null default '',

        -- agent_created: agent tự lên camp này
        -- human_assigned: người giao camp có sẵn cho agent quản lý
        "source" varchar(24) not null default 'human_assigned',

        -- Ngày camp bắt đầu chạy trên tài khoản. Dùng cho luật bảo vệ tài khoản
        -- mới: Facebook đắt hơn 30-50% trong 1-2 tuần đầu, chấm ROAS ngay sẽ
        -- cắt nhầm video tốt.
        "started_at" timestamptz not null default now(),

        "active" boolean not null default true,
        "assigned_by" varchar(128) not null default '',
        "note" text not null default '',
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "agent_managed_campaign_pkey" primary key ("campaign_id")
      );
    `)
    this.addSql(`create index if not exists "idx_amc_active" on "agent_managed_campaign" ("active") where "active" = true;`)
    this.addSql(`create index if not exists "idx_amc_mkt" on "agent_managed_campaign" ("mkt_name");`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "agent_managed_campaign" cascade;`)
  }
}
