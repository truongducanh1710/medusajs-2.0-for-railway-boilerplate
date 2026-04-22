import { Metadata } from "next"

export const metadata: Metadata = { title: "Liên hệ | Phan Việt" }

export default function Page() {
  return (
    <>
      {/* Hero */}
      <div className="bg-red-700 py-12 text-center">
        <div className="max-w-3xl mx-auto px-4">
          <h1 className="text-white font-black text-3xl sm:text-4xl mb-3">LIÊN HỆ</h1>
          <p className="text-red-200 text-sm sm:text-base">Chúng tôi luôn sẵn sàng hỗ trợ bạn</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-12 space-y-6">

        {/* Contact cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <a
            href="https://zalo.me/4385628039049498170"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-white rounded-2xl border border-gray-100 p-6 flex items-center gap-4 hover:border-orange-300 transition-colors"
          >
            <div className="w-14 h-14 bg-blue-50 rounded-xl flex items-center justify-center text-2xl flex-shrink-0">
              💬
            </div>
            <div>
              <p className="font-black text-gray-900 text-base">Zalo OA</p>
              <p className="text-gray-500 text-sm mt-0.5">Nhắn tin nhanh qua Zalo</p>
              <p className="text-orange-500 font-bold text-sm mt-1">Gia Dụng Phan Việt</p>
            </div>
          </a>

          <a
            href="tel:0967993609"
            className="bg-white rounded-2xl border border-gray-100 p-6 flex items-center gap-4 hover:border-orange-300 transition-colors"
          >
            <div className="w-14 h-14 bg-green-50 rounded-xl flex items-center justify-center text-2xl flex-shrink-0">
              📞
            </div>
            <div>
              <p className="font-black text-gray-900 text-base">Điện thoại</p>
              <p className="text-gray-500 text-sm mt-0.5">Gọi trực tiếp cho chúng tôi</p>
              <p className="text-orange-500 font-bold text-sm mt-1">0967 993 609</p>
            </div>
          </a>

          <a
            href="https://www.facebook.com/profile.php?id=61577385524644"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-white rounded-2xl border border-gray-100 p-6 flex items-center gap-4 hover:border-orange-300 transition-colors"
          >
            <div className="w-14 h-14 bg-blue-50 rounded-xl flex items-center justify-center text-2xl flex-shrink-0">
              📘
            </div>
            <div>
              <p className="font-black text-gray-900 text-base">Facebook</p>
              <p className="text-gray-500 text-sm mt-0.5">Nhắn tin qua Facebook</p>
              <p className="text-orange-500 font-bold text-sm mt-1">Gia Dụng Phan Việt</p>
            </div>
          </a>

          <a
            href="tel:0967993609"
            className="bg-white rounded-2xl border border-gray-100 p-6 flex items-center gap-4 hover:border-orange-300 transition-colors"
          >
            <div className="w-14 h-14 bg-orange-50 rounded-xl flex items-center justify-center text-2xl flex-shrink-0">
              📱
            </div>
            <div>
              <p className="font-black text-gray-900 text-base">Hotline</p>
              <p className="text-gray-500 text-sm mt-0.5">Hỗ trợ đơn hàng, tư vấn sản phẩm</p>
              <p className="text-orange-500 font-bold text-sm mt-1">0967 993 609</p>
            </div>
          </a>
        </div>

        {/* Hours */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6 sm:p-8">
          <h2 className="font-black text-xl text-gray-900 mb-4 flex items-center gap-2">
            <span className="w-1 h-6 bg-orange-500 rounded-full inline-block"></span>
            Giờ hỗ trợ
          </h2>
          <div className="space-y-2 text-sm text-gray-600">
            <div className="flex justify-between py-2 border-b border-gray-50">
              <span>Thứ 2 – Thứ 6</span>
              <span className="font-bold text-gray-900">8:00 – 21:00</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-50">
              <span>Thứ 7</span>
              <span className="font-bold text-gray-900">8:00 – 18:00</span>
            </div>
            <div className="flex justify-between py-2">
              <span>Chủ nhật</span>
              <span className="font-bold text-gray-900">9:00 – 17:00</span>
            </div>
          </div>
        </div>

        {/* Note */}
        <div className="bg-orange-50 border-l-4 border-orange-500 rounded-r-xl px-5 py-4">
          <p className="text-orange-700 text-sm leading-relaxed">
            Để được hỗ trợ nhanh nhất, vui lòng nhắn tin qua <strong>Zalo</strong> hoặc <strong>Facebook</strong>. Chúng tôi phản hồi trong vòng 15 phút trong giờ làm việc.
          </p>
        </div>

      </div>
    </>
  )
}
