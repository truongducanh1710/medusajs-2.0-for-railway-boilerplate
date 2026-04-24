import LocalizedClientLink from "@modules/common/components/localized-client-link"

export default async function Footer({
  countryCode,
}: {
  countryCode?: string
}) {
  return (
    <footer className="bg-red-700 text-white">
      <div className="max-w-6xl mx-auto px-4 py-10 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-10">

        {/* Cột 1: Thông tin công ty */}
        <div className="space-y-2">
          <img
            src="/logo-vietmate.png.png"
            alt="Vietmate Home Appliances"
            className="h-20 object-contain mb-3 bg-white rounded-xl px-3 py-2"
          />
          <p className="font-bold text-sm">CÔNG TY TNHH PHAN VIỆT INVEST</p>
          <p className="text-sm text-red-200">MST: 0109890417</p>
          <p className="text-sm text-red-200">Ngày Cấp Phép: 18.01.2022</p>
          <p className="text-sm text-red-200">Nơi Cấp Phép: Sở Kế hoạch và đầu tư TP Hà Nội</p>
          <div className="pt-2 space-y-1">
            <p className="text-sm">Email: <a href="mailto:hoanpd@phanviet.vn" className="hover:text-orange-300 transition-colors">hoanpd@phanviet.vn</a></p>
            <p className="text-sm flex items-center gap-1">
              <span>📍</span>
              <a href="tel:0967993609" className="hover:text-orange-300 transition-colors">0967 993 609</a>
            </p>
          </div>
        </div>

        {/* Cột 2: Chính sách */}
        <div className="space-y-3">
          <h3 className="font-black text-base tracking-wide">CHÍNH SÁCH</h3>
          <ul className="space-y-2 text-sm text-red-100">
            <li><LocalizedClientLink href="/gioi-thieu" className="hover:text-white transition-colors">Giới thiệu về chúng tôi</LocalizedClientLink></li>
            <li><LocalizedClientLink href="/chinh-sach-doi-tra" className="hover:text-white transition-colors">Chính sách đổi trả</LocalizedClientLink></li>
            <li><LocalizedClientLink href="/chinh-sach-bao-mat" className="hover:text-white transition-colors">Chính sách bảo mật</LocalizedClientLink></li>
            <li><LocalizedClientLink href="/chinh-sach-giao-hang" className="hover:text-white transition-colors">Chính sách giao hàng</LocalizedClientLink></li>
            <li><LocalizedClientLink href="/chinh-sach-thanh-toan" className="hover:text-white transition-colors">Chính sách bảo mật thanh toán</LocalizedClientLink></li>
            <li><LocalizedClientLink href="/chinh-sach-kiem-hang" className="hover:text-white transition-colors">Chính sách kiểm hàng</LocalizedClientLink></li>
          </ul>
        </div>

        {/* Cột 3: Hỗ trợ */}
        <div className="space-y-3">
          <h3 className="font-black text-base tracking-wide">HỖ TRỢ</h3>
          <ul className="space-y-2 text-sm text-red-100">
            <li><LocalizedClientLink href="/store" className="hover:text-white transition-colors">Tất cả sản phẩm</LocalizedClientLink></li>
            <li><LocalizedClientLink href="/account/orders" className="hover:text-white transition-colors">Tra cứu đơn hàng</LocalizedClientLink></li>
            <li><a href="tel:0967993609" className="hover:text-white transition-colors">Hotline: 0967 993 609</a></li>
            <li><a href="mailto:hoanpd@phanviet.vn" className="hover:text-white transition-colors">Email hỗ trợ</a></li>
          </ul>

          <div className="pt-2 flex gap-3">
            <a href="https://facebook.com" target="_blank" rel="noreferrer"
              className="w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors text-lg">
              f
            </a>
            <a href="https://zalo.me" target="_blank" rel="noreferrer"
              className="w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors text-xs font-black">
              Z
            </a>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-red-600 py-4 px-4 text-center text-xs text-red-300">
        © {new Date().getFullYear()} CÔNG TY TNHH PHAN VIỆT INVEST — Bảo lưu mọi quyền
      </div>
    </footer>
  )
}
