import { Metadata } from "next"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

export const metadata: Metadata = { title: "Giới thiệu về Phan Việt | Phan Việt" }

export default function Page() {
  return (
    <>
      {/* Hero */}
      <div className="bg-red-700 py-12 text-center">
        <div className="max-w-3xl mx-auto px-4">
          <p className="text-red-300 text-sm mb-2">
            <LocalizedClientLink href="/" className="hover:text-white transition-colors">Trang chủ</LocalizedClientLink>
            {" › "}
            <span className="text-white">Về chúng tôi</span>
          </p>
          <h1 className="text-white font-black text-3xl sm:text-4xl mb-3">VỀ CHÚNG TÔI</h1>
          <p className="text-red-200 text-sm sm:text-base">Gia dụng tiện ích · Phụ kiện bếp núc · Nội ngoại nhập</p>
        </div>
      </div>

      {/* Stats bar */}
      <div className="bg-orange-500 py-6">
        <div className="max-w-5xl mx-auto px-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-center text-white">
          {[
            { num: "500.000+", label: "Khách hàng" },
            { num: "10.000+", label: "Đơn hàng/tháng" },
            { num: "2", label: "Thị trường (VN + MY)" },
            { num: "3", label: "Sàn TMĐT lớn" },
          ].map(item => (
            <div key={item.label}>
              <p className="font-black text-2xl sm:text-3xl">{item.num}</p>
              <p className="text-orange-100 text-xs sm:text-sm mt-1">{item.label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-12 space-y-10">

        {/* Giới thiệu */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6 sm:p-8">
          <p className="text-gray-700 leading-relaxed text-base sm:text-lg mb-4">
            <strong className="text-gray-900">Phan Việt</strong> là đơn vị chuyên cung cấp các sản phẩm gia dụng tiện ích và phụ kiện bếp núc —
            nội ngoại nhập, mang đến những giải pháp thông minh giúp việc nấu nướng và sinh hoạt trở nên
            <strong> đơn giản – nhanh chóng – hiệu quả</strong> hơn mỗi ngày.
          </p>
          <p className="text-gray-700 leading-relaxed text-base sm:text-lg mb-4">
            Hiện chúng tôi đang phục vụ hàng trăm nghìn khách hàng trên toàn quốc và thị trường Malaysia,
            thông qua các nền tảng thương mại điện tử hàng đầu: <strong>TikTok Shop, Shopee và Facebook</strong>.
          </p>
          <div className="bg-orange-50 border-l-4 border-orange-500 rounded-r-xl px-5 py-4 mt-4">
            <p className="text-orange-700 font-black text-base sm:text-lg italic">
              "Sản phẩm tốt – Giá hợp lý – Phục vụ tận tâm"
            </p>
          </div>
        </div>

        {/* Khác biệt */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6 sm:p-8">
          <h2 className="font-black text-xl sm:text-2xl text-gray-900 mb-6 flex items-center gap-2">
            <span className="w-1 h-7 bg-orange-500 rounded-full inline-block"></span>
            Chúng tôi khác biệt ở đâu?
          </h2>
          <p className="text-gray-600 mb-5">Tại Phan Việt, mỗi sản phẩm đều được:</p>
          <ul className="space-y-3">
            {[
              "Tuyển chọn kỹ lưỡng theo tiêu chí hữu ích – bền – an toàn – dễ sử dụng",
              "Phù hợp với thói quen và không gian bếp của người Việt",
              "Ưu tiên các giải pháp tiết kiệm thời gian và công sức",
            ].map(item => (
              <li key={item} className="flex items-start gap-3">
                <span className="text-orange-500 font-black text-lg mt-0.5">✔️</span>
                <span className="text-gray-700 leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>

          <div className="mt-6 pt-6 border-t border-gray-100">
            <p className="text-gray-600 mb-3">Hiện nay Phan Việt có mặt trên:</p>
            <div className="flex flex-wrap gap-3">
              {["TikTok Shop", "Shopee", "Facebook"].map(platform => (
                <span key={platform} className="px-4 py-2 bg-gray-100 rounded-full text-sm font-bold text-gray-700">
                  👉 {platform}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Cam kết */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6 sm:p-8">
          <h2 className="font-black text-xl sm:text-2xl text-gray-900 mb-6 flex items-center gap-2">
            <span className="w-1 h-7 bg-orange-500 rounded-full inline-block"></span>
            Cam kết của chúng tôi
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              {
                icon: "🔒",
                title: "Chất lượng minh bạch",
                desc: "Sản phẩm rõ nguồn gốc, được kiểm tra trước khi đến tay khách hàng",
              },
              {
                icon: "⚡",
                title: "Dịch vụ nhanh – tận tâm",
                desc: "Tư vấn kịp thời, giao hàng toàn quốc, hỗ trợ trước – trong – sau bán",
              },
              {
                icon: "💯",
                title: "Chính sách rõ ràng",
                desc: "Đổi trả minh bạch, lấy sự hài lòng của khách hàng làm trung tâm",
              },
            ].map(item => (
              <div key={item.title} className="bg-orange-50 rounded-xl p-5 text-center">
                <div className="text-3xl mb-3">{item.icon}</div>
                <h3 className="font-black text-gray-900 mb-2 text-sm sm:text-base">{item.title}</h3>
                <p className="text-gray-600 text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Sứ mệnh */}
        <div className="bg-red-700 rounded-2xl p-6 sm:p-10 text-center text-white">
          <p className="text-red-300 text-sm font-bold uppercase tracking-widest mb-3">Sứ mệnh</p>
          <p className="font-black text-xl sm:text-2xl md:text-3xl leading-snug max-w-2xl mx-auto">
            Giúp mọi gia đình Việt tối ưu căn bếp – nâng tầm trải nghiệm sống bằng những sản phẩm
            <span className="text-orange-300"> đơn giản nhưng thực sự hữu ích</span>.
          </p>
        </div>

        {/* CTA */}
        <div className="text-center pb-4">
          <LocalizedClientLink
            href="/store"
            className="inline-block bg-orange-500 hover:bg-orange-600 text-white font-black text-lg px-10 py-4 rounded-xl transition-colors"
          >
            Khám phá sản phẩm ngay →
          </LocalizedClientLink>
        </div>

      </div>
    </>
  )
}
