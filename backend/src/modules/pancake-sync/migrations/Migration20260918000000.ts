import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Lớp VIDEO cho agent care camp.
 *
 * Hạ tầng agent đã có đủ ở mức CAMP (agent_camp_recommendation, agent_skill,
 * agent_insight, agent_prediction, camp_action_log...). Thiếu đúng một tầng: agent
 * chưa "nhìn" được từng video, trong khi đó mới là đơn vị quyết định thật — một camp
 * chạy 4 video thì ROAS camp không nói được video nào kéo, video nào ăn hại.
 *
 * Dữ liệu đã đủ để dựng tầng này mà KHÔNG cần đổi gì bên ngoài:
 *   - chi phí theo video : mkt_ads_cost_ad.vd_code (extract sẵn từ ad_name)
 *   - đơn theo video     : pancake_order.raw->>'p_utm_content' dạng "VD133 - <post_id>"
 *
 * Ba bảng ở đây trả lời ba câu khác nhau:
 *   v_video_roas        — "video nào đang lãi" (view, tính trực tiếp, luôn tươi)
 *   video_budget_state  — "agent đang cho video này bao nhiêu tiền, vì sao"
 *   video_decision_log  — "agent đã làm gì, dựa trên số nào, kết quả ra sao"
 *
 * Vì sao tách state khỏi log: state là hiện tại (1 dòng/video, agent đọc mỗi vòng),
 * log là lịch sử (append-only, không bao giờ sửa). Gộp lại sẽ phải quét cả lịch sử
 * chỉ để biết trạng thái hiện tại.
 */
export class Migration20260918000000 extends Migration {
  async up(): Promise<void> {
    // ---------------------------------------------------------------
    // 1. Trạng thái ngân sách mỗi video — agent đọc/ghi mỗi vòng chạy
    // ---------------------------------------------------------------
    this.addSql(`
      create table if not exists "video_budget_state" (
        "vd_code" varchar(32) not null,
        "campaign_id" varchar(64) null,
        "mkt_name" varchar(32) not null default '',

        -- Vòng đời: testing (đang tiêu ngân sách thử) → scaling (đã qua cửa, đang tăng)
        --           holding (giữ nguyên, theo dõi) → killed (tắt vĩnh viễn)
        "phase" varchar(16) not null default 'testing',

        "daily_budget" bigint not null default 0,
        "spend_total" bigint not null default 0,
        "spend_today" bigint not null default 0,

        -- Số agent dựa vào ở lần quyết định gần nhất, chốt lại để log đối chiếu được.
        "roas_est" numeric(6,2) null,
        "roas_real" numeric(6,2) null,
        "cancel_rate" numeric(5,2) null,
        "orders_total" integer not null default 0,

        "last_action" varchar(32) null,
        "last_action_at" timestamptz null,
        "killed_reason" text null,

        -- Khoá tay: người đặt true thì agent không đụng vào video này nữa.
        "locked_by_human" boolean not null default false,

        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "video_budget_state_pkey" primary key ("vd_code")
      );
    `)
    this.addSql(`create index if not exists "idx_vbs_phase" on "video_budget_state" ("phase");`)
    this.addSql(`create index if not exists "idx_vbs_mkt" on "video_budget_state" ("mkt_name");`)

    // ---------------------------------------------------------------
    // 2. Nhật ký quyết định — append-only, không bao giờ UPDATE
    // ---------------------------------------------------------------
    this.addSql(`
      create table if not exists "video_decision_log" (
        "id" uuid not null default gen_random_uuid(),
        "run_id" varchar(64) null,
        "vd_code" varchar(32) not null,
        "campaign_id" varchar(64) null,
        "ad_ids" jsonb not null default '[]',

        "action" varchar(32) not null,          -- kill | scale_up | scale_down | hold | start_test | resume
        "reason" text not null default '',       -- câu giải thích của agent, người đọc được
        "rule_hit" varchar(64) null,             -- luật nào kích hoạt, để sau truy ngược luật sai

        "budget_before" bigint null,
        "budget_after" bigint null,

        -- Ảnh chụp số liệu ĐÚNG LÚC quyết định. Bắt buộc phải lưu: 3 ngày sau số sẽ khác,
        -- không có cái này thì không bao giờ biết agent quyết định đúng hay sai trên dữ liệu nào.
        "metrics" jsonb not null default '{}',

        "executed" boolean not null default false,
        "fb_response" jsonb null,
        "error" text null,

        -- Chấm điểm NGƯỢC sau 7 ngày: quyết định đó hoá ra đúng hay sai.
        "outcome_roas_7d" numeric(6,2) null,
        "outcome_verdict" varchar(16) null,      -- correct | wrong | neutral
        "evaluated_at" timestamptz null,

        "created_at" timestamptz not null default now(),
        constraint "video_decision_log_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "idx_vdl_vd" on "video_decision_log" ("vd_code", "created_at" desc);`)
    this.addSql(`create index if not exists "idx_vdl_run" on "video_decision_log" ("run_id");`)
    this.addSql(`create index if not exists "idx_vdl_eval" on "video_decision_log" ("evaluated_at") where "evaluated_at" is null;`)

    // ---------------------------------------------------------------
    // 3. Hạn mức ngân sách — người duyệt, agent chỉ được đọc
    // ---------------------------------------------------------------
    this.addSql(`
      create table if not exists "agent_budget_grant" (
        "id" uuid not null default gen_random_uuid(),
        "mkt_name" varchar(32) not null default '',
        "effective_date" date not null,

        "daily_cap" bigint not null,             -- trần tổng mỗi ngày
        "per_video_cap" bigint not null default 3000000,
        "test_budget" bigint not null default 300000,

        -- Ngưỡng quyết định. Để trong DB chứ không hardcode: chỉnh được mà không cần deploy.
        "roas_kill" numeric(4,2) not null default 1.50,
        "roas_scale" numeric(4,2) not null default 2.00,
        "cancel_rate_kill" numeric(5,2) not null default 45.00,

        "granted_by" varchar(128) not null default '',
        "note" text not null default '',
        "active" boolean not null default true,
        "created_at" timestamptz not null default now(),
        constraint "agent_budget_grant_pkey" primary key ("id")
      );
    `)
    this.addSql(`create unique index if not exists "uq_abg_mkt_date" on "agent_budget_grant" ("mkt_name", "effective_date") where "active" = true;`)

    // ---------------------------------------------------------------
    // 4. View ROAS theo video — mắt của agent
    // ---------------------------------------------------------------
    // Quy ước cột:
    //   roas_gop  = doanh thu mọi đơn / chi phí     — số nhìn thấy trên Ads Manager
    //   roas_that = doanh thu đơn ĐÃ NHẬN / chi phí — số thật, dùng để quyết định
    //   roas_est  = ước tính cho đơn chưa chốt, dùng tỷ lệ nhận CỦA CHÍNH video đó
    //
    // Vì sao phải có roas_est: đơn tạo hôm nay 3–5 ngày nữa mới biết nhận hay huỷ.
    // Nếu agent chỉ nhìn roas_that thì luôn quyết định trên dữ liệu cũ 5 ngày.
    // Tỷ lệ huỷ chênh nhau rất lớn giữa các video (0% đến 59%) nên KHÔNG dùng
    // một hệ số chung — phải lấy tỷ lệ của chính video đó.
    this.addSql(`
      create or replace view "v_video_roas" as
      with chi_phi as (
        select
          vd_code,
          sum(spend)::bigint                as spend,
          sum(impressions)::bigint          as impressions,
          sum(clicks)::bigint               as clicks,
          count(distinct ad_id)             as so_ad,
          max(date)                         as last_spend_date,
          min(date)                         as first_spend_date
        from mkt_ads_cost_ad
        where date > current_date - 31 and coalesce(vd_code,'') <> ''
        group by 1
      ), don as (
        select
          split_part(raw->>'p_utm_content', ' ', 1) as vd_code,
          count(*)                                          as don_tong,
          sum(total)::bigint                                as dt_tong,
          count(*) filter (where status = 3)                as don_nhan,
          coalesce(sum(total) filter (where status = 3), 0)::bigint as dt_nhan,
          count(*) filter (where status in (6,7))           as don_huy,
          count(*) filter (where status in (4,5))           as don_hoan,
          -- Đơn đã chốt = đã nhận hoặc đã huỷ/hoàn. Đơn đang đi đường chưa tính vào
          -- mẫu số tỷ lệ nhận, nếu không tỷ lệ sẽ bị kéo xuống một cách giả tạo.
          count(*) filter (where status in (3,4,5,6,7))     as don_chot
        from pancake_order
        where pancake_created_at > now() - interval '30 days'
          and market = 'VN'
          and raw->>'p_utm_content' ~ '^VD[0-9]+'
        group by 1
      )
      select
        coalesce(c.vd_code, d.vd_code)                      as vd_code,
        coalesce(c.spend, 0)                                as spend,
        coalesce(c.impressions, 0)                          as impressions,
        coalesce(c.clicks, 0)                               as clicks,
        coalesce(c.so_ad, 0)                                as so_ad,
        c.first_spend_date,
        c.last_spend_date,
        round(coalesce(c.clicks, 0)::numeric * 100
              / nullif(c.impressions, 0), 2)                as ctr,
        coalesce(d.don_tong, 0)                             as don_tong,
        coalesce(d.dt_tong, 0)                              as dt_tong,
        coalesce(d.don_nhan, 0)                             as don_nhan,
        coalesce(d.dt_nhan, 0)                              as dt_nhan,
        coalesce(d.don_huy, 0)                              as don_huy,
        coalesce(d.don_hoan, 0)                             as don_hoan,
        round(coalesce(d.dt_tong, 0)::numeric
              / nullif(c.spend, 0), 2)                      as roas_gop,
        round(coalesce(d.dt_nhan, 0)::numeric
              / nullif(c.spend, 0), 2)                      as roas_that,
        round(coalesce(d.don_nhan, 0)::numeric * 100
              / nullif(d.don_chot, 0), 1)                   as ty_le_nhan,
        round(coalesce(d.don_huy, 0)::numeric * 100
              / nullif(d.don_tong, 0), 1)                   as ty_le_huy,
        -- Ước tính: doanh thu gộp × tỷ lệ nhận của chính video này.
        -- Chưa đủ 5 đơn chốt thì chưa tin được tỷ lệ riêng → trả null, agent phải
        -- giữ video ở phase testing thay vì quyết định vội.
        case when coalesce(d.don_chot, 0) >= 5
          then round(coalesce(d.dt_tong, 0)::numeric
               * (d.don_nhan::numeric / nullif(d.don_chot, 0))
               / nullif(c.spend, 0), 2)
          else null end                                     as roas_est
      from chi_phi c
      full outer join don d on d.vd_code = c.vd_code
      where coalesce(c.spend, 0) > 0 or coalesce(d.don_tong, 0) > 0;
    `)

    // ---------------------------------------------------------------
    // 5. View theo dõi agent — người đọc, không phải agent
    // ---------------------------------------------------------------
    this.addSql(`
      create or replace view "v_agent_video_activity" as
      select
        l.created_at,
        l.vd_code,
        l.action,
        l.reason,
        l.rule_hit,
        l.budget_before,
        l.budget_after,
        l.executed,
        l.outcome_verdict,
        l.outcome_roas_7d,
        s.phase,
        s.daily_budget                                       as budget_hien_tai,
        s.roas_real                                          as roas_hien_tai,
        s.locked_by_human,
        (l.metrics->>'roas_est')::numeric                    as roas_luc_quyet_dinh,
        (l.metrics->>'spend_total')::bigint                  as spend_luc_quyet_dinh
      from video_decision_log l
      left join video_budget_state s on s.vd_code = l.vd_code
      order by l.created_at desc;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`drop view if exists "v_agent_video_activity";`)
    this.addSql(`drop view if exists "v_video_roas";`)
    this.addSql(`drop table if exists "video_decision_log" cascade;`)
    this.addSql(`drop table if exists "video_budget_state" cascade;`)
    this.addSql(`drop table if exists "agent_budget_grant" cascade;`)
  }
}
