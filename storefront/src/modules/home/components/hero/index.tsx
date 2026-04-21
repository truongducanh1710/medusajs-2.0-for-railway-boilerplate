import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { getStoreMetadata } from "@lib/data/store"

const DEFAULT_IMAGES = {
  hero: "https://lh3.googleusercontent.com/aida-public/AB6AXuDCBtxbp_yIraPEtcOEiBoOm-LSUuFSWM6kLUwN1tsjho6s76Gg3jg0YmKH8YPsC558A7kJVL8qsWn9zwg-M-O1Hk8-lwu0i7GfaaFneLbj7WLIPf5muuAPmpjA4sHZnEwxPp5qqH9evHhbxytilDfvpuAwM4rqs71Q9DGvT1xr9La2c33DeTAjraoS7r02rIy5wifx3DexpOF2tv9mOODsKvy832LybwlCRxjUpcSZfvpeCel_IRdWC0eIME3t0Ed2jVmCDKfeB_Ns",
  cat1: "https://lh3.googleusercontent.com/aida-public/AB6AXuA_ICm3rmyk-KoWQsPnM2Cq0jJ6JlUoY5VmsZUBU6BwYyT--cczR9ZDCHoY2XC5a0Luys9EHlznNhuo9OOX5y2AqWJIIzfDLXwYG3esQOvwXyhRLvvaOMktjC2lTMBWbXWdKHKI4JpLDW10vyflE-8LuoQBbzvZaa7p4OtbpUu-h-mlkAMiBHQv-JMHyolvT8iHSm2wnG_bSfOYa7EJ1Cebd3PptxjuXC44dUvV73vyXtEbqkICsC4NCcQ2N5jrqMbqPPsxit6XMIjA",
  cat2: "https://lh3.googleusercontent.com/aida-public/AB6AXuBOdJN5rncv5CwBcGNg5U_LIVj7hTh86cynHdxgGAMdcwo39nq16bSrxtL4yDmscYDn86gVaVc4rAa2C08vFMxb5I3w04NNrc1cHMvXVinowuiq4DUSWrEHt62QpuXMn9ICj1Hm5LHHCjx9wWjBCR7dJqrt0ridvQbPAJSajcopOOBZFADCBuh--pgZJInYAOqqc9yZpXqt3XJUR70zRe1r5BgIBCiz34QqlDjYLuNG8Kr5nr_oNnc3vFKxC0xheWjCvrWsJxzPym-I",
  cat3: "https://lh3.googleusercontent.com/aida-public/AB6AXuB1cWp9D_97tx4R_ap7V8UFnnlmvlz8GmX8f4800Y0epPzKlhdE5znp8tfopRptO1n-uYtC0yIoGoniSuz1izH3prtGntAeGRoE4tiOJ8nTKT9DZc_2TDiFq1GtLw1tdhqWNy5ngxXynXjJ2P-0M6Ws1bjr9fIhd6eVj7vk0ThVQ-BUK_GTpQHk7uyG2NZlRKiy6L8wczAV23dL0e-aGUrCaKbviMbxsTsLDw_ld2LAIFbetZZew7MafqSKqaPTTgUkVm5APFC0SU6m",
  promo: "https://lh3.googleusercontent.com/aida-public/AB6AXuBqTeAiZH0J1xHDHssSqi2PqfjQIMQjO5FRh0wHLQNy-sAdDNNjg6HsK8kHTp8SiiwmK3Hs-5V7jAzu3L857w9qArPWN5trwy9474SvowUtbpRtgzLXZMmOkitCe3FE6VAIZz0El5ycDhZ0B4MzA2h5MxM43c5Qb8KGoSFLOyPOmPHBoxTjYYjtJPz8faINP5mWp06WXfXbMr_iV7cfzOJFqVonqIsDOMn4dSvGgCzhImQLtRR7gMfyow5CurXt15yeiBA_YFa5AgC9",
}

const HERO_COPY = {
  badge: "✨ THƯƠNG HIỆU GIA DỤNG VIỆT",
  titleTop: "Nâng tầm",
  titleMiddle: "không gian",
  titleBottom: "sống của bạn",
  description: "Sản phẩm gia dụng cao cấp, thiết kế hiện đại — bền bỉ, tiện lợi cho mọi gia đình Việt.",
  primaryCta: "Mua ngay →",
  secondaryCta: "Xem tất cả",
  featuredTitle: "Danh mục nổi bật",
  featuredDesc: "Khám phá các sản phẩm gia dụng chất lượng cao",
  viewAll: "Xem tất cả →",
  categories: [
    { title: "Nhà bếp", desc: "Dụng cụ nấu nướng hiện đại" },
    { title: "Phòng khách", desc: "Tiện nghi sang trọng" },
    { title: "Phòng ngủ", desc: "Giấc ngủ hoàn hảo" },
  ],
  promoTitle: "Ưu đãi đặc biệt",
  promoDesc: "Giảm giá lên đến 50% cho các sản phẩm chọn lọc. Số lượng có hạn!",
  promoCta: "Mua ngay",
  promoExpiry: "⏰ Kết thúc cuối tháng",
  advantages: [
    { title: "Chính hãng 100%", desc: "Cam kết sản phẩm thật" },
    { title: "Bảo hành 12 tháng", desc: "Đổi mới nếu lỗi" },
    { title: "Giao toàn quốc", desc: "1–3 ngày làm việc" },
    { title: "Hoàn tiền 7 ngày", desc: "Không cần lý do" },
  ],
}

const Hero = async () => {
  const meta = await getStoreMetadata()

  const img = {
    hero: meta.hero_image || DEFAULT_IMAGES.hero,
    cat1: meta.cat1_image || DEFAULT_IMAGES.cat1,
    cat2: meta.cat2_image || DEFAULT_IMAGES.cat2,
    cat3: meta.cat3_image || DEFAULT_IMAGES.cat3,
    promo: meta.promo_image || DEFAULT_IMAGES.promo,
  }

  const copy = {
    ...HERO_COPY,
    badge: meta.hero_badge || HERO_COPY.badge,
    titleTop: meta.hero_title_top || HERO_COPY.titleTop,
    titleMiddle: meta.hero_title_middle || HERO_COPY.titleMiddle,
    titleBottom: meta.hero_title_bottom || HERO_COPY.titleBottom,
    description: meta.hero_description || HERO_COPY.description,
    promoTitle: meta.promo_title || HERO_COPY.promoTitle,
    promoDesc: meta.promo_desc || HERO_COPY.promoDesc,
  }

  const catImages = [img.cat1, img.cat2, img.cat3]

  return (
    <>
      <section className="relative h-[600px] md:h-[700px] lg:h-[870px] w-full flex items-center overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img
            className="w-full h-full object-cover"
            src={img.hero}
            alt="Phan Việt"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/60 to-transparent" />
        </div>
        <div className="relative z-10 max-w-[1920px] mx-auto px-4 sm:px-6 md:px-12 w-full">
          <div className="max-w-2xl">
            <span className="inline-block px-3 py-1 mb-4 sm:mb-6 rounded-full bg-white/10 text-white border border-white/20 font-semibold text-xs tracking-widest uppercase">
              {copy.badge}
            </span>
            <h1 className="font-extrabold text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl 2xl:text-8xl text-white leading-tight mb-6 sm:mb-8 tracking-tighter">
              {copy.titleTop}{" "}
              <span className="block">
                <span className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl xl:text-8xl 2xl:text-9xl tracking-tighter">
                  {copy.titleMiddle}{" "}
                </span>
                <span className="text-orange-400 text-4xl sm:text-5xl md:text-6xl lg:text-7xl xl:text-8xl 2xl:text-9xl tracking-tighter">
                  {copy.titleBottom}
                </span>
              </span>
            </h1>
            <p className="text-white/80 text-base sm:text-lg md:text-xl mb-8 sm:mb-12 max-w-lg leading-relaxed font-light">
              {copy.description}
            </p>
            <div className="flex gap-3 sm:gap-4 flex-wrap">
              <LocalizedClientLink
                href="/store"
                className="bg-orange-500 text-white px-6 sm:px-8 md:px-12 py-3 sm:py-4 md:py-5 rounded font-black text-base sm:text-lg md:text-xl hover:bg-orange-600 transition-all duration-300"
              >
                {copy.primaryCta}
              </LocalizedClientLink>
              <LocalizedClientLink
                href="/store"
                className="bg-white/10 backdrop-blur-md text-white border border-white/20 px-6 sm:px-8 md:px-12 py-3 sm:py-4 md:py-5 rounded font-black text-base sm:text-lg md:text-xl hover:bg-white/20 transition-all duration-300"
              >
                {copy.secondaryCta}
              </LocalizedClientLink>
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-[1920px] mx-auto px-4 sm:px-6 md:px-12 -mt-12 md:-mt-16 relative z-20">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-0.5 bg-gray-200/20 rounded-xl overflow-hidden backdrop-blur-xl shadow-2xl">
          {copy.advantages.map((item, index) => (
            <div
              key={item.title}
              className="bg-white p-4 sm:p-6 md:p-8 flex items-center gap-3 sm:gap-4 md:gap-5 transition-all hover:bg-gray-50 group"
            >
              <div className="w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 rounded-full bg-blue-100 flex items-center justify-center text-lg sm:text-xl md:text-2xl group-hover:scale-110 transition-transform">
                {["✅", "🛡️", "🚚", "💰"][index]}
              </div>
              <div>
                <h3 className="font-bold text-base sm:text-lg text-gray-800">{item.title}</h3>
                <p className="text-xs sm:text-sm text-gray-500">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-[1920px] mx-auto px-4 sm:px-6 md:px-12 py-12 sm:py-16 md:py-24">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-8 sm:mb-12">
          <div className="mb-4 sm:mb-0">
            <h2 className="font-extrabold text-2xl sm:text-3xl md:text-4xl tracking-tight mb-2 text-gray-900">
              {copy.featuredTitle}
            </h2>
            <p className="text-gray-500 text-sm sm:text-base">{copy.featuredDesc}</p>
          </div>
          <LocalizedClientLink
            href="/store"
            className="text-orange-500 font-bold flex items-center gap-2 hover:underline text-sm sm:text-base"
          >
            {copy.viewAll}
          </LocalizedClientLink>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 md:gap-8">
          {copy.categories.map((cat, index) => (
            <div
              key={cat.title}
              className="group relative h-[300px] sm:h-[400px] md:h-[500px] rounded-xl overflow-hidden cursor-pointer"
            >
              <img
                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                src={catImages[index]}
                alt={cat.title}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
              <div className="absolute bottom-0 left-0 p-4 sm:p-6 md:p-8 lg:p-12 w-full">
                <h3 className="text-white text-xl sm:text-2xl md:text-3xl font-bold mb-2 sm:mb-4">{cat.title}</h3>
                <p className="text-white/70 mb-4 sm:mb-6 md:mb-8 max-w-xs text-sm sm:text-base">{cat.desc}</p>
                <span className="bg-white/10 backdrop-blur-md text-white px-4 sm:px-6 py-2 rounded-full text-xs sm:text-sm font-bold border border-white/20 group-hover:bg-orange-500 group-hover:border-orange-500 transition-all">
                  Khám phá ngay
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-[1920px] mx-auto px-4 sm:px-6 md:px-12 py-8 sm:py-12">
        <div className="relative rounded-2xl overflow-hidden bg-orange-500 h-64 sm:h-72 md:h-80 flex items-center px-6 sm:px-8 md:px-12 lg:px-20">
          <div className="absolute right-0 top-0 h-full w-1/2 opacity-20 pointer-events-none">
            <img className="w-full h-full object-cover" src={img.promo} alt="Banner" />
          </div>
          <div className="relative z-10">
            <h2 className="font-black text-2xl sm:text-3xl md:text-4xl lg:text-5xl text-white mb-2 sm:mb-4 tracking-tighter uppercase">
              {copy.promoTitle}
            </h2>
            <p className="text-white/90 text-sm sm:text-base md:text-lg lg:text-xl mb-4 sm:mb-6 md:mb-8 max-w-lg">
              {copy.promoDesc}
            </p>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
              <LocalizedClientLink
                href="/store"
                className="bg-white text-orange-500 px-6 sm:px-8 py-2 sm:py-3 rounded-full font-bold text-sm sm:text-base hover:scale-105 transition-transform"
              >
                {copy.promoCta}
              </LocalizedClientLink>
              <span className="text-white font-medium text-sm">{copy.promoExpiry}</span>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}

export default Hero
