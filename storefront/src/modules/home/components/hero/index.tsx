import LocalizedClientLink from "@modules/common/components/localized-client-link"

const Hero = () => {
  return (
    <>
      {/* Hero Section */}
      <section className="relative h-[870px] w-full flex items-center overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img
            className="w-full h-full object-cover"
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuDCBtxbp_yIraPEtcOEiBoOm-LSUuFSWM6kLUwN1tsjho6s76Gg3jg0YmKH8YPsC558A7kJVL8qsWn9zwg-M-O1Hk8-lwu0i7GfaaFneLbj7WLIPf5muuAPmpjA4sHZnEwxPp5qqH9evHhbxytilDfvpuAwM4rqs71Q9DGvT1xr9La2c33DeTAjraoS7r02rIy5wifx3DexpOF2tv9mOODsKvy832LybwlCRxjUpcSZfvpeCel_IRdWC0eIME3t0Ed2jVmCDKfeB_Ns"
            alt="Bếp hiện đại Phan Viet"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/60 to-transparent"></div>
        </div>
        <div className="relative z-10 max-w-[1920px] mx-auto px-12 w-full">
          <div className="max-w-2xl">
            <span className="inline-block px-4 py-1.5 mb-6 rounded-full bg-white/10 text-white border border-white/20 font-semibold text-xs tracking-widest uppercase">
              Thương hiệu gia dụng tin cậy
            </span>
            <h1 className="font-extrabold text-6xl lg:text-8xl text-white leading-tight mb-8 tracking-tighter">
              Thiết bị{" "}
              <span className="block">
                <span className="text-[6rem] tracking-tighter">thông minh </span>
                <span className="text-orange-400 text-[6rem] tracking-tighter">cho mọi gia đình</span>
              </span>
            </h1>
            <p className="text-white/80 text-xl mb-12 max-w-lg leading-relaxed font-light">
              Nâng tầm không gian sống với những sản phẩm công nghệ đỉnh cao, kết hợp giữa kỹ thuật chính xác và nghệ thuật thủ công.
            </p>
            <div className="flex gap-4 flex-wrap">
              <LocalizedClientLink
                href="/store"
                className="bg-orange-500 text-white px-12 py-5 rounded font-black text-xl hover:bg-orange-600 transition-all duration-300"
              >
                Mua ngay
              </LocalizedClientLink>
              <LocalizedClientLink
                href="/store"
                className="bg-white/10 backdrop-blur-md text-white border border-white/20 px-12 py-5 rounded font-black text-xl hover:bg-white/20 transition-all duration-300"
              >
                Khám phá
              </LocalizedClientLink>
            </div>
          </div>
        </div>
      </section>

      {/* Advantages Bar */}
      <section className="max-w-[1920px] mx-auto px-12 -mt-16 relative z-20">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-0.5 bg-gray-200/20 rounded-xl overflow-hidden backdrop-blur-xl shadow-2xl">
          {[
            { icon: "✅", title: "Hàng chính hãng", desc: "Cam kết chất lượng 100%" },
            { icon: "🛡️", title: "Bảo hành uy tín", desc: "Hỗ trợ kỹ thuật 24/7" },
            { icon: "🚚", title: "Giao hàng nhanh", desc: "Miễn phí lắp đặt nội thành" },
            { icon: "💰", title: "Giá tốt nhất", desc: "Luôn có ưu đãi hấp dẫn" },
          ].map((item) => (
            <div
              key={item.title}
              className="bg-white p-8 flex items-center gap-5 transition-all hover:bg-gray-50 group"
            >
              <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                {item.icon}
              </div>
              <div>
                <h3 className="font-bold text-lg text-gray-800">{item.title}</h3>
                <p className="text-sm text-gray-500">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Categories Section */}
      <section className="max-w-[1920px] mx-auto px-12 py-24">
        <div className="flex justify-between items-end mb-12">
          <div>
            <h2 className="font-extrabold text-4xl tracking-tight mb-2 text-gray-900">Danh mục nổi bật</h2>
            <p className="text-gray-500">Giải pháp tối ưu cho không gian sống hiện đại</p>
          </div>
          <LocalizedClientLink href="/store" className="text-orange-500 font-bold flex items-center gap-2 hover:underline">
            Xem tất cả →
          </LocalizedClientLink>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            {
              title: "Chảo chống dính",
              desc: "Công nghệ ceramic chịu nhiệt, an toàn cho sức khỏe.",
              img: "https://lh3.googleusercontent.com/aida-public/AB6AXuA_ICm3rmyk-KoWQsPnM2Cq0jJ6JlUoY5VmsZUBU6BwYyT--cczR9ZDCHoY2XC5a0Luys9EHlznNhuo9OOX5y2AqWJIIzfDLXwYG3esQOvwXyhRLvvaOMktjC2lTMBWbXWdKHKI4JpLDW10vyflE-8LuoQBbzvZaa7p4OtbpUu-h-mlkAMiBHQv-JMHyolvT8iHSm2wnG_bSfOYa7EJ1Cebd3PptxjuXC44dUvV73vyXtEbqkICsC4NCcQ2N5jrqMbqPPsxit6XMIjA",
            },
            {
              title: "Giặt & Sấy",
              desc: "Tiết kiệm điện năng, bảo vệ sợi vải tối ưu.",
              img: "https://lh3.googleusercontent.com/aida-public/AB6AXuBOdJN5rncv5CwBcGNg5U_LIVj7hTh86cynHdxgGAMdcwo39nq16bSrxtL4yDmscYDn86gVaVc4rAa2C08vFMxb5I3w04NNrc1cHMvXVinowuiq4DUSWrEHt62QpuXMn9ICj1Hm5LHHCjx9wWjBCR7dJqrt0ridvQbPAJSajcopOOBZFADCBuh--pgZJInYAOqqc9yZpXqt3XJUR70zRe1r5BgIBCiz34QqlDjYLuNG8Kr5nr_oNnc3vFKxC0xheWjCvrWsJxzPym-I",
            },
            {
              title: "Thiết bị gia dụng",
              desc: "Thông minh hơn, tiện nghi hơn cho ngôi nhà bạn.",
              img: "https://lh3.googleusercontent.com/aida-public/AB6AXuB1cWp9D_97tx4R_ap7V8UFnnlmvlz8GmX8f4800Y0epPzKlhdE5znp8tfopRptO1n-uYtC0yIoGoniSuz1izH3prtGntAeGRoE4tiOJ8nTKT9DZc_2TDiFq1GtLw1tdhqWNy5ngxXynXjJ2P-0M6Ws1bjr9fIhd6eVj7vk0ThVQ-BUK_GTpQHk7uyG2NZlRKiy6L8wczAV23dL0e-aGUrCaKbviMbxsTsLDw_ld2LAIFbetZZew7MafqSKqaPTTgUkVm5APFC0SU6m",
            },
          ].map((cat) => (
            <div key={cat.title} className="group relative h-[500px] rounded-xl overflow-hidden cursor-pointer">
              <img
                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                src={cat.img}
                alt={cat.title}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent"></div>
              <div className="absolute bottom-0 left-0 p-12 w-full">
                <h3 className="text-white text-3xl font-bold mb-4">{cat.title}</h3>
                <p className="text-white/70 mb-8 max-w-xs">{cat.desc}</p>
                <span className="bg-white/10 backdrop-blur-md text-white px-6 py-2 rounded-full text-sm font-bold border border-white/20 group-hover:bg-orange-500 group-hover:border-orange-500 transition-all">
                  Khám phá ngay
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Promotion Banner */}
      <section className="max-w-[1920px] mx-auto px-12 py-12">
        <div className="relative rounded-2xl overflow-hidden bg-orange-500 h-80 flex items-center px-20">
          <div className="absolute right-0 top-0 h-full w-1/2 opacity-20 pointer-events-none">
            <img
              className="w-full h-full object-cover"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuBqTeAiZH0J1xHDHssSqi2PqfjQIMQjO5FRh0wHLQNy-sAdDNNjg6HsK8kHTp8SiiwmK3Hs-5V7jAzu3L857w9qArPWN5trwy9474SvowUtbpRtgzLXZMmOkitCe3FE6VAIZz0El5ycDhZ0B4MzA2h5MxM43c5Qb8KGoSFLOyPOmPHBoxTjYYjtJPz8faINP5mWp06WXfXbMr_iV7cfzOJFqVonqIsDOMn4dSvGgCzhImQLtRR7gMfyow5CurXt15yeiBA_YFa5AgC9"
              alt="Banner"
            />
          </div>
          <div className="relative z-10">
            <h2 className="font-black text-5xl text-white mb-4 tracking-tighter uppercase">
              Siêu Ưu Đãi Mùa Hè
            </h2>
            <p className="text-white/90 text-xl mb-8 max-w-lg">
              Nhập mã{" "}
              <span className="bg-white/30 px-3 py-1 rounded font-bold">PHANVIET20</span>{" "}
              để được giảm ngay 20% cho đơn hàng thiết bị gia dụng đầu tiên.
            </p>
            <div className="flex items-center gap-4">
              <LocalizedClientLink
                href="/store"
                className="bg-white text-orange-500 px-8 py-3 rounded-full font-bold hover:scale-105 transition-transform"
              >
                Nhận ưu đãi ngay
              </LocalizedClientLink>
              <span className="text-white font-medium">Thời gian có hạn đến hết 30/06</span>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}

export default Hero
