// Static content blocks shared by /icegel and the ICEgel product pages.
// Wording stays inside the announced intended use (TBYT loại A, PCBA-HCM 31/03/2026).

export function IcegelTrust() {
  const points = [
    { icon: "📋", title: "Thiết bị y tế loại A", text: "Cả 10 dòng đã công bố tiêu chuẩn áp dụng tại Sở Y tế TP.HCM (31/03/2026)." },
    { icon: "🏭", title: "Nhà máy Biours", text: "Foshan Biours, thành lập 2006, gia công miếng dán cho thương hiệu ở Nhật, EU, Mỹ, Thái Lan." },
    { icon: "📦", title: "Nhận hàng mới trả tiền", text: "Giao toàn quốc, kiểm tra hàng trước khi thanh toán." },
  ]
  return (
    <section className="mt-8" aria-labelledby="icegel-trust">
      <h2 id="icegel-trust" className="text-lg font-black text-gray-900">Vì sao chọn ICEgel</h2>
      <ul className="mt-3 grid sm:grid-cols-3 gap-3">
        {points.map((point) => (
          <li key={point.title} className="rounded-2xl bg-white border border-gray-100 p-3.5">
            <p className="text-2xl" aria-hidden="true">{point.icon}</p>
            <p className="mt-1 font-black text-[14px] text-gray-900">{point.title}</p>
            <p className="mt-0.5 text-[13px] text-gray-600 leading-snug">{point.text}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function IcegelHowItWorks() {
  return (
    <section className="mt-8 rounded-2xl bg-white border border-gray-100 p-4" aria-labelledby="icegel-hydrogel">
      <h2 id="icegel-hydrogel" className="text-lg font-black text-gray-900">Miếng dán hydrogel là gì?</h2>
      <p className="mt-2 text-[14px] text-gray-700 leading-relaxed">
        Hydrogel là lớp gel chứa nhiều nước, mềm và bám nhẹ trên da. Khi dán, nước trong gel bay hơi từ từ và mang theo nhiệt,
        tạo cảm giác mát dịu kéo dài. Mỗi dòng ICEgel phối tinh dầu riêng: khuynh diệp chanh và bạc hà cho mũi họng, bạc hà và
        oải hương cho dòng hạ sốt, long não và nghệ cho dòng giảm đau, gừng cho dòng làm ấm. Riêng miếng hạ sốt cho trẻ 0–3 tuổi
        chỉ có nước và hydrogel, không màu, không tinh dầu.
      </p>
    </section>
  )
}

const FAQ: [string, string][] = [
  ["Mua nhiều loại khác nhau có được tính combo không?", "Có. Ưu đãi tính theo tổng số hộp trong đơn, trộn loại nào cũng được: 2 hộp tặng 2 miếng, 3 hộp tặng 4 miếng và miễn phí giao hàng, từ 4 hộp tặng 6 miếng và miễn phí giao hàng."],
  ["Quà tặng là gì?", "Quà là miếng dán lẻ của các dòng ICEgel (giảm đau, làm ấm, thái dương, thông mũi, hạ sốt hoặc mặt nạ mắt). Bạn chọn loại khi đặt hàng, mỗi lựa chọn 2 miếng."],
  ["Trẻ nhỏ dùng được không?", "Miếng hạ sốt 0–3 tuổi dành cho trẻ sơ sinh. Thông mũi và giảm ho dùng cho trẻ từ 3 tuổi, cần người lớn giám sát khi dán. Trẻ sốt cao hoặc kéo dài cần đưa đi khám."],
  ["Miếng dán dùng được bao lâu?", "Tuỳ dòng: thông mũi 4–6 giờ, giảm ho 8–12 giờ, hạ sốt khoảng 8 giờ, thái dương 20–30 phút mỗi lần. Xem cách dùng ở trang từng sản phẩm."],
  ["Ai nên thận trọng?", "Không dán lên vết thương hở, vùng da đang kích ứng. Người dị ứng với thành phần tinh dầu nên thử trên một vùng da nhỏ trước. Sản phẩm không thay thế thuốc hoặc chỉ định của bác sĩ."],
  ["Phí giao hàng thế nào?", "Khách đặt lần đầu được miễn phí giao hàng. Từ 3 hộp miễn phí giao hàng toàn quốc. Đơn 1–2 hộp của khách cũ: 16.000đ trong Hà Nội, 20.000đ các tỉnh khác — phí hiện ngay khi bạn nhập địa chỉ. Bạn kiểm tra hàng rồi mới thanh toán."],
]

export function IcegelFaq({ extra = [] }: { extra?: [string, string][] }) {
  const items = [...extra, ...FAQ]
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map(([question, answer]) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })),
  }
  return (
    <section className="mt-8 mb-6" aria-labelledby="icegel-faq">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <h2 id="icegel-faq" className="text-lg font-black text-gray-900">Câu hỏi thường gặp</h2>
      <div className="mt-3 space-y-2">
        {items.map(([question, answer]) => (
          <details key={question} className="group rounded-xl bg-white border border-gray-100 px-4 py-3">
            <summary className="cursor-pointer list-none font-bold text-[14px] text-gray-900 flex justify-between gap-3">
              {question}
              <span className="text-sky-700 group-open:rotate-45 transition-transform" aria-hidden="true">+</span>
            </summary>
            <p className="mt-2 text-[14px] text-gray-700 leading-relaxed">{answer}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
