import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Loại đơn nháp / đơn trùng / khách không đặt khỏi v_video_roas.
 *
 * Rà 30 ngày cho thấy phần lớn "đơn huỷ" không phải khách huỷ thật:
 *   379 đơn nháp · 124 đơn trùng · 118 khách không đặt
 * so với chỉ 91 đơn huỷ vì lý do thật (đổi ý, không phù hợp, giá cao, mua bên khác).
 *
 * Chúng làm mọi chỉ số xấu đi một cách giả tạo. Loại ra thì tỷ lệ huỷ của các
 * video chính giảm từ 24,2% xuống 9,3% (VD133), 30,3% xuống 11,5% (VD130) —
 * tức gần 2/3 số "huỷ" trước đây là rác dữ liệu, không phải vấn đề bán hàng.
 *
 * Điều đó cũng có nghĩa: ROAS thật mọi camp đang bị báo THẤP hơn thực tế, và
 * agent có thể đã cắt nhầm video tốt nếu dùng số cũ.
 *
 * QUAN TRỌNG — không loại toàn bộ đơn mang tag "Đơn nháp":
 * 184 đơn nháp đã GIAO THÀNH CÔNG (status 3), 25 đơn đang giao, 25 đã hoàn.
 * Nháp ở đây là trạng thái KHỞI ĐẦU (khách điền form, chưa xác nhận), không phải
 * đơn rác. Chỉ loại đơn nháp KẾT THÚC ở huỷ/xoá — tức chưa bao giờ thành đơn thật.
 *
 * Đơn trùng và "khách không đặt" thì loại hết: cả hai đều 100% nằm ở status 6.
 */
export class Migration20260919000000 extends Migration {
  async up(): Promise<void> {
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
          count(*) filter (where status in (3,4,5,6,7))     as don_chot
        from pancake_order
        where pancake_created_at > now() - interval '30 days'
          and market = 'VN'
          and raw->>'p_utm_content' ~ '^VD[0-9]+'
          -- Đơn trùng và khách không đặt: loại hết, không bao giờ là đơn thật.
          and tags::text not ilike '%Đơn trùng%'
          and tags::text not ilike '%Khách không đặt%'
          -- Đơn nháp: chỉ loại khi KẾT THÚC ở huỷ/xoá. Nháp đã giao thành công
          -- hoặc đang đi đường vẫn là đơn thật, phải giữ.
          and not (tags::text ilike '%Đơn nháp%' and status in (6,7))
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
        case when coalesce(d.don_chot, 0) >= 5
          then round(coalesce(d.dt_tong, 0)::numeric
               * (d.don_nhan::numeric / nullif(d.don_chot, 0))
               / nullif(c.spend, 0), 2)
          else null end                                     as roas_est
      from chi_phi c
      full outer join don d on d.vd_code = c.vd_code
      where coalesce(c.spend, 0) > 0 or coalesce(d.don_tong, 0) > 0;
    `)
  }

  async down(): Promise<void> {
    // Quay lại bản không lọc đơn nháp — xem Migration20260918000000.
    this.addSql(`drop view if exists "v_video_roas";`)
  }
}
