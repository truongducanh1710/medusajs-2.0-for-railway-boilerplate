// Hướng dẫn quy trình lên camp — nội dung khớp hành vi thật đã verify trực tiếp
// trên Graph API (Ads341, 15/8/2026) đối chiếu với camp mẫu
// "24/05_XUANLT_CHẢO VÀNG HẤP_ADS341_VD111112113V_30ALL" (adset 120246449308750614).
export function QuyTrinhCampTab() {
  const sec = "mb-5 rounded-xl border border-ui-border-base bg-ui-bg-base p-5"
  const h2 = "mb-3 flex items-center gap-2 text-[15px] font-bold text-ui-fg-base"
  const p = "text-[13px] leading-relaxed text-ui-fg-subtle"
  const li = "flex items-start gap-2 text-[13px] text-ui-fg-subtle"

  return (
    <div className="mx-auto max-w-[860px] py-2">

      {/* 1. 3 cấp là gì */}
      <div className={sec}>
        <div className={h2}>📋 3 cấp của 1 camp Facebook Ads</div>
        <p className={p}>Mỗi camp có 3 lớp lồng nhau — mỗi lớp quyết định một việc khác nhau.</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            ["① Chiến dịch", "Bao nhiêu tiền/ngày, mục tiêu gì (Doanh số)"],
            ["② Nhóm quảng cáo", "Nhắm ai, đo lường thế nào"],
            ["③ Quảng cáo", "Khách hàng thấy nội dung gì"],
          ].map(([t, d]) => (
            <div key={t} className="rounded-lg bg-ui-bg-subtle px-3 py-2.5">
              <div className="mb-1 font-bold text-ui-fg-base text-[13px]">{t}</div>
              <div className="text-[11px] text-ui-fg-muted">{d}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 2. Luồng 4 bước */}
      <div className={sec}>
        <div className={h2}>🚀 Luồng lên camp (1 đường duy nhất)</div>
        <ol className="flex flex-col gap-3">
          {[
            ["Up video", "Up video lên Marketing Hub tab Nguyên liệu Video (chỉ cần link Google Drive, không cần đăng Page trước)."],
            ["Chọn video", "Sang tab 🚀 Lên Camp, lọc theo MKT / sản phẩm, tick chọn 1 hoặc nhiều video."],
            ["Điền form", "Ngân sách, pixel, tuổi, page, caption, CTA, link đích — dòng 🔒 cho biết cái gì cố định."],
            ["Tạo & review", "Bấm Tạo Camp → hệ thống upload video lên Facebook, tạo camp/nhóm QC/quảng cáo đều ở trạng thái PAUSED → mở AdsManager kiểm tra rồi bật tay."],
          ].map(([step, desc], i) => (
            <li key={i} className={li}>
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[11px] font-bold text-white">{i + 1}</span>
              <div><span className="font-semibold text-ui-fg-base">{step}: </span><span>{desc}</span></div>
            </li>
          ))}
        </ol>
        <div className="mt-3 rounded-lg bg-ui-bg-subtle px-3 py-2 text-[12px] text-ui-fg-muted">
          💡 Chọn nhiều video cùng sản phẩm → tạo <b>1 camp, 1 nhóm quảng cáo, nhiều quảng cáo</b> (mỗi video 1 ad).
          Facebook tự dồn ngân sách cho video chạy tốt hơn — đúng cấu trúc camp mẫu tham khảo.
        </div>
      </div>

      {/* 3. Bảng đổi được gì */}
      <div className={sec}>
        <div className={h2}>⭐ Đổi được gì ở mỗi cấp?</div>
        <p className={p}>✅ chỉnh trong app · 🔒 cố định theo chuẩn (không đổi được, đã kiểm chứng phù hợp camp chạy tốt) · ⚠️ phải sửa nơi khác.</p>
        {[
          { title: "① Chiến dịch", rows: [
            ["✅", "Ngân sách/ngày", ""],
            ["✅", "Mã SP / audience trong tên camp", ""],
            ["🔒", "Mục tiêu Doanh số (OUTCOME_SALES)", ""],
            ["🔒", "Ngân sách đặt ở cấp camp (CBO)", "không chia theo nhóm QC"],
            ["🔒", "Giá thầu thấp nhất, không giới hạn", ""],
            ["🔒", "Trạng thái PAUSED lúc tạo", "tự bật ở AdsManager"],
          ]},
          { title: "② Nhóm quảng cáo", rows: [
            ["✅", "Pixel đo chuyển đổi", ""],
            ["✅", "Tuổi tối thiểu (gợi ý)", "Advantage+ vẫn phân phối ngoài khoảng"],
            ["✅", "Loại trừ tệp đối tượng", ""],
            ["🔒", "Việt Nam, Advantage+ Audience, vị trí tự động", ""],
            ["🔒", "Đo lường 7 ngày click + 1 ngày xem + 1 ngày xem video", "khớp camp mẫu"],
            ["⚠️", "Giới tính, sở thích, vị trí thủ công, lịch chạy", "sửa ở AdsManager"],
          ]},
          { title: "③ Quảng cáo", rows: [
            ["✅", "Page đăng, caption, CTA, link đích", "chung cho cả nhóm, sửa riêng từng video nếu cần"],
            ["✅", "Video (1 hoặc nhiều, mỗi video 1 quảng cáo)", ""],
            ["🔒", "UTM tự gắn đủ 8 tham số", ""],
            ["🔒", "Tên quảng cáo = mã VD", ""],
            ["🔒", "Trạng thái PAUSED lúc tạo", ""],
          ]},
        ].map(g => (
          <div key={g.title} className="mt-3">
            <div className="mb-1.5 text-[12px] font-bold text-ui-fg-base">{g.title}</div>
            <div className="overflow-hidden rounded-lg border border-ui-border-base">
              {g.rows.map(([mark, name, note], i) => (
                <div key={i} className={`flex items-start gap-2 px-3 py-1.5 text-[12px] ${i % 2 ? "bg-ui-bg-subtle" : "bg-ui-bg-base"}`}>
                  <span className="w-4 shrink-0">{mark}</span>
                  <span className="flex-1 text-ui-fg-base">{name}</span>
                  {note && <span className="text-ui-fg-muted italic">{note}</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 4. Quy ước tên camp */}
      <div className={sec}>
        <div className={h2}>🏷️ Quy ước tên camp</div>
        <div className="rounded-lg bg-ui-bg-subtle px-3 py-2 font-mono text-[12px] text-ui-fg-base">
          {"{SKU}_{ngày/tháng}_{MKT}_{SẢN PHẨM}_{ADS}_{AUDIENCE}_{VD}"}
        </div>
        <div className="mt-2 flex flex-col gap-1">
          {[
            ["SKU", "Mã sản phẩm trên POS, bỏ dấu gạch dưới — PHVVN026CV"],
            ["ngày/tháng", "Ngày tạo camp, không thêm số 0 — 15/8"],
            ["MKT", "Mã người phụ trách — XUANLT"],
            ["SẢN PHẨM", "Tên sản phẩm viết hoa"],
            ["ADS", "Số tài khoản quảng cáo — ADS341"],
            ["AUDIENCE", "Tầng phễu — 30ALL, BROAD, RETARGET, UPSELL"],
            ["VD", "Mã video, nhiều video thì nối liền — VD111112113V"],
          ].map(([k, d]) => (
            <div key={k} className={li}><span className="font-mono font-semibold text-ui-fg-base">{k}</span><span>— {d}</span></div>
          ))}
        </div>
      </div>

      {/* 5. Tầng phễu */}
      <div className={sec}>
        <div className={h2}>🎯 Tầng phễu</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            ["❄️ Lạnh", "Khách mới — nhắm rộng (Advantage+), tự loại trừ người đã mua để khỏi đốt tiền lại."],
            ["🔥 Ấm", "Retarget người quan tâm chưa mua — vẫn loại trừ người đã mua để chốt đơn mới."],
            ["💎 Nóng", "Upsell người đã mua sản phẩm khác — KHÔNG loại trừ."],
          ].map(([t, d]) => (
            <div key={t} className="rounded-lg bg-ui-bg-subtle px-3 py-2.5">
              <div className="mb-1 font-bold text-ui-fg-base text-[13px]">{t}</div>
              <div className="text-[11px] text-ui-fg-muted">{d}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 6. Lỗi thường gặp */}
      <div className={sec}>
        <div className={h2}>🛠️ Lỗi thường gặp</div>
        <div className="flex flex-col gap-2">
          {[
            ["Tuổi tối thiểu > 25 bị từ chối", "Advantage+ chỉ nhận age_min ≤ 25. App tự xử lý — số bạn nhập được dùng làm tuổi gợi ý, không đổi được ô này thành lỗi nữa."],
            ["Thiếu pixel_id", "Chọn account chưa gán pixel mặc định. Chọn thủ công ở ô Pixel."],
            ["Video thiếu hình thu nhỏ", "Facebook đang xử lý video xong nhưng chưa có thumbnail — hệ thống tự chờ và lấy lại, nếu vẫn lỗi thử tạo lại camp."],
            ["Ngân sách dưới 50.000đ", "Sàn tối thiểu Facebook yêu cầu theo tài khoản VND."],
            ["Video lỗi khi tạo nhiều quảng cáo", "1 video lỗi (link Drive không public, Facebook xử lý lỗi) không làm hỏng cả camp — các quảng cáo còn lại vẫn tạo, video lỗi hiện rõ để thử lại."],
          ].map(([t, d]) => (
            <div key={t} className="rounded-lg bg-ui-bg-subtle px-3 py-2">
              <div className="text-[12px] font-bold text-ui-fg-base">{t}</div>
              <div className="text-[11px] text-ui-fg-muted mt-0.5">{d}</div>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}
