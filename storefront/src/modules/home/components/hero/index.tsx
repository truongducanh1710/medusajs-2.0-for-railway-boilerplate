import LocalizedClientLink from "@modules/common/components/localized-client-link"

const Hero = () => {
  return (
    <div className="w-full">
      {/* Hero Banner */}
      <div className="relative bg-gradient-to-r from-brand-secondary to-blue-700 text-white">
        <div className="content-container py-16 small:py-24 flex flex-col small:flex-row items-center gap-8">
          <div className="flex-1 text-center small:text-left">
            <p className="text-sm font-semibold uppercase tracking-widest text-blue-200 mb-3">
              Thương hiệu gia dụng tin cậy
            </p>
            <h1 className="text-3xl small:text-5xl font-extrabold leading-tight mb-4">
              Sản phẩm gia dụng<br />
              <span className="text-brand-primary">chất lượng cao</span>
            </h1>
            <p className="text-blue-100 text-base small:text-lg mb-8 max-w-md">
              Hàng nghìn sản phẩm gia dụng chính hãng, giao hàng nhanh toàn quốc, đổi trả dễ dàng.
            </p>
            <div className="flex flex-col xsmall:flex-row gap-3 justify-center small:justify-start">
              <LocalizedClientLink
                href="/store"
                className="bg-brand-primary hover:bg-brand-primary-hover text-white font-bold px-8 py-3 rounded-lg transition-colors text-center"
              >
                Mua ngay
              </LocalizedClientLink>
              <LocalizedClientLink
                href="/store"
                className="bg-white/10 hover:bg-white/20 text-white font-semibold px-8 py-3 rounded-lg border border-white/30 transition-colors text-center"
              >
                Xem sản phẩm
              </LocalizedClientLink>
            </div>
          </div>
          <div className="flex-1 flex justify-center">
            <div className="w-64 h-64 small:w-80 small:h-80 bg-white/10 rounded-2xl flex items-center justify-center border border-white/20">
              <span className="text-8xl">🍳</span>
            </div>
          </div>
        </div>
      </div>

      {/* Trust Bar */}
      <div className="bg-gray-50 border-b border-gray-200">
        <div className="content-container py-3">
          <div className="grid grid-cols-2 small:grid-cols-4 gap-4 text-center">
            <div className="flex items-center justify-center gap-2 text-sm text-gray-600 font-medium">
              <span className="text-xl">🚚</span>
              <span>Miễn phí ship từ 500K</span>
            </div>
            <div className="flex items-center justify-center gap-2 text-sm text-gray-600 font-medium">
              <span className="text-xl">🔄</span>
              <span>Đổi trả trong 7 ngày</span>
            </div>
            <div className="flex items-center justify-center gap-2 text-sm text-gray-600 font-medium">
              <span className="text-xl">✅</span>
              <span>Hàng chính hãng 100%</span>
            </div>
            <div className="flex items-center justify-center gap-2 text-sm text-gray-600 font-medium">
              <span className="text-xl">📞</span>
              <span>Hỗ trợ 24/7</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Hero
