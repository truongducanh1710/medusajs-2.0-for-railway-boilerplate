"use client"

import { useEffect, useRef, useState } from "react"

type Props = {
  open: boolean
  productTitle: string
  initialContent?: string   // draft (page_content_draft) nếu có, else live
  hasLiveContent?: boolean  // page_content live đã xuất bản chưa
  onClose: () => void
  onSaveDraft: (content: string) => Promise<void>    // lưu nháp, KHÔNG revalidate
  onPublish: (content: string) => Promise<void>      // xuất bản, revalidate storefront
}

type BuilderBlock = {
  id: string
  label: string
  category: string
  content: string
}

const blocks: BuilderBlock[] = [
  // ─── SECTIONS ───────────────────────────────────────────────────────────────
  {
    id: "video-demo",
    label: "🎬 Video Demo",
    category: "Sections",
    content: `
      <style>
        .pvb-video{padding:40px 16px;background:#fff}
        .pvb-video .inner{max-width:860px;margin:0 auto}
        .pvb-video h2{font-size:clamp(22px,5vw,32px);font-weight:900;margin:0 0 14px;text-align:center}
        .pvb-video .frame{aspect-ratio:16/9;background:#111827;border-radius:16px;overflow:hidden}
        .pvb-video iframe{width:100%;height:100%;border:0}
        @media(min-width:768px){.pvb-video{padding:56px 24px}.pvb-video .frame{border-radius:20px}}
      </style>
      <section class="pvb-video">
        <div class="inner">
          <h2>🎬 Video Demo sản phẩm</h2>
          <div class="frame">
            <iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" allowfullscreen></iframe>
          </div>
        </div>
      </section>
    `,
  },
  {
    id: "pain-solution",
    label: "😤 Pain / Solution",
    category: "Sections",
    content: `
      <style>
        .pvb-ps{padding:40px 16px;background:#f9fafb}
        .pvb-ps .inner{max-width:1100px;margin:0 auto;display:grid;gap:16px}
        .pvb-ps .box{border-radius:18px;padding:20px}
        .pvb-ps .pain{background:#fff1f2;border:1px solid #fecdd3}
        .pvb-ps .solution{background:#ecfdf5;border:1px solid #bbf7d0}
        .pvb-ps h3{margin:0 0 12px;font-size:20px;font-weight:900}
        .pvb-ps .pain h3{color:#be123c}
        .pvb-ps .solution h3{color:#047857}
        .pvb-ps ul{margin:0;padding-left:18px;line-height:1.9;color:#4b5563;font-size:15px}
        @media(min-width:640px){.pvb-ps{padding:56px 24px}.pvb-ps .inner{grid-template-columns:1fr 1fr;gap:24px}.pvb-ps h3{font-size:24px}}
      </style>
      <section class="pvb-ps">
        <div class="inner">
          <div class="box pain">
            <h3>😤 Vấn đề khách hàng gặp</h3>
            <ul>
              <li>Chảo dễ dính, khó vệ sinh</li>
              <li>Tốn thời gian khi nấu nướng</li>
              <li>Dụng cụ nhanh hư, tốn tiền thay</li>
            </ul>
          </div>
          <div class="box solution">
            <h3>✅ Giải pháp của chúng tôi</h3>
            <ul>
              <li>Chống dính vượt trội, dễ lau chùi</li>
              <li>Tiết kiệm thời gian nấu nướng</li>
              <li>Bền hơn 3 lần, tiết kiệm dài hạn</li>
            </ul>
          </div>
        </div>
      </section>
    `,
  },
  {
    id: "benefits-grid",
    label: "⭐ Benefits Grid",
    category: "Sections",
    content: `
      <style>
        .pvb-ben{padding:40px 16px;background:#fff}
        .pvb-ben .inner{max-width:1100px;margin:0 auto}
        .pvb-ben h2{font-size:clamp(22px,5vw,32px);font-weight:900;margin:0 0 20px;text-align:center}
        .pvb-ben .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
        .pvb-ben .card{background:#f9fafb;border:1px solid #e5e7eb;border-radius:16px;padding:16px;text-align:center}
        .pvb-ben .icon{font-size:26px;margin-bottom:8px}
        .pvb-ben h4{margin:0 0 4px;font-weight:800;font-size:14px;color:#111827}
        .pvb-ben p{margin:0;color:#6b7280;font-size:13px}
        @media(min-width:640px){.pvb-ben{padding:56px 24px}.pvb-ben .grid{grid-template-columns:repeat(4,1fr);gap:18px}.pvb-ben .card{padding:20px}.pvb-ben .icon{font-size:32px}.pvb-ben h4{font-size:16px}}
      </style>
      <section class="pvb-ben">
        <div class="inner">
          <h2>Điểm nổi bật</h2>
          <div class="grid">
            <div class="card"><div class="icon">🔥</div><h4>Chống dính</h4><p>Bề mặt dễ vệ sinh</p></div>
            <div class="card"><div class="icon">💧</div><h4>Tiết kiệm nước</h4><p>Rửa nhanh, gọn</p></div>
            <div class="card"><div class="icon">⚡</div><h4>Dùng bền</h4><p>Vật liệu chất lượng</p></div>
            <div class="card"><div class="icon">🛡️</div><h4>Bảo hành</h4><p>An tâm sử dụng</p></div>
          </div>
        </div>
      </section>
    `,
  },
  {
    id: "hero-banner",
    label: "🖼️ Hero Banner",
    category: "Sections",
    content: `
      <style>
        .pvb-hero{padding:40px 16px;background:linear-gradient(135deg,#f97316 0%,#ea580c 45%,#dc2626 100%);color:#fff}
        .pvb-hero .inner{max-width:1100px;margin:0 auto}
        .pvb-hero .badge{display:inline-block;background:rgba(255,255,255,0.18);padding:6px 14px;border-radius:999px;font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:14px}
        .pvb-hero h2{font-size:clamp(28px,7vw,52px);line-height:1.05;margin:0 0 14px;font-weight:900}
        .pvb-hero p{font-size:16px;line-height:1.7;margin:0 0 20px;color:rgba(255,255,255,0.9)}
        .pvb-hero .btns{display:flex;flex-wrap:wrap;gap:10px}
        .pvb-hero .btn-white{background:#fff;color:#ea580c;padding:13px 22px;border-radius:999px;font-weight:800;text-decoration:none;font-size:15px}
        .pvb-hero .btn-outline{border:1px solid rgba(255,255,255,0.5);color:#fff;padding:13px 22px;border-radius:999px;font-weight:800;text-decoration:none;font-size:15px}
        .pvb-hero img.img{width:100%;height:100%;min-height:200px;border-radius:20px;object-fit:cover;display:block;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2)}
        @media(min-width:768px){.pvb-hero{padding:64px 24px}.pvb-hero .inner{display:grid;grid-template-columns:1.1fr 0.9fr;gap:32px;align-items:center}.pvb-hero img.img{min-height:320px}}
      </style>
      <section class="pvb-hero">
        <div class="inner">
          <div>
            <span class="badge">Bán chạy hôm nay</span>
            <h2>Tiêu đề nổi bật cho sản phẩm</h2>
            <p>Mô tả ngắn, mạnh mẽ để dẫn khách hàng tới hành động mua ngay.</p>
            <div class="btns">
              <a href="#" class="btn-white">Mua ngay</a>
              <a href="#" class="btn-outline">Xem chi tiết</a>
            </div>
          </div>
          <img class="img" src="https://placehold.co/900x720/fef3c7/7c2d12?text=Hero+Image" alt="Hero Image" />
        </div>
      </section>
    `,
  },
  {
    id: "image-text-left",
    label: "📸 Ảnh trái + Text",
    category: "Sections",
    content: `
      <style>
        .pvb-itl{padding:40px 16px;background:#fff}
        .pvb-itl .inner{max-width:1100px;margin:0 auto}
        .pvb-itl img.img{width:100%;aspect-ratio:5/4;border-radius:20px;object-fit:cover;display:block;margin-bottom:24px;background:linear-gradient(135deg,#e5e7eb,#cbd5e1)}
        .pvb-itl h2{font-size:clamp(22px,5vw,32px);line-height:1.1;margin:0 0 14px;font-weight:900;color:#111827}
        .pvb-itl p{font-size:16px;line-height:1.8;color:#4b5563;margin:0 0 18px}
        .pvb-itl ul{margin:0 0 22px;padding:0;list-style:none;display:grid;gap:10px}
        .pvb-itl li{display:flex;gap:10px;align-items:flex-start;color:#374151;font-size:15px}
        .pvb-itl .btn{display:inline-flex;align-items:center;background:#f97316;color:#fff;padding:13px 22px;border-radius:14px;font-weight:800;text-decoration:none;font-size:15px}
        @media(min-width:640px){.pvb-itl{padding:56px 24px}.pvb-itl .inner{display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:center}.pvb-itl img.img{margin-bottom:0}}
      </style>
      <section class="pvb-itl">
        <div class="inner">
          <img class="img" src="https://placehold.co/900x720/e5e7eb/475569?text=Click+de+doi+anh" alt="Ảnh sản phẩm" />
          <div>
            <h2>Tiêu đề nội dung nổi bật</h2>
            <p>Trình bày lợi ích, giải pháp hoặc câu chuyện thương hiệu theo cấu trúc dễ đọc.</p>
            <ul>
              <li><span>✅</span><span>Điểm nhấn 1 của sản phẩm</span></li>
              <li><span>✅</span><span>Điểm nhấn 2 của sản phẩm</span></li>
              <li><span>✅</span><span>Điểm nhấn 3 của sản phẩm</span></li>
            </ul>
            <a href="#" class="btn">Xem chi tiết</a>
          </div>
        </div>
      </section>
    `,
  },
  {
    id: "image-text-right",
    label: "📸 Text trái + Ảnh",
    category: "Sections",
    content: `
      <style>
        .pvb-itr{padding:40px 16px;background:#f9fafb}
        .pvb-itr .inner{max-width:1100px;margin:0 auto}
        .pvb-itr img.img{width:100%;aspect-ratio:5/4;border-radius:20px;object-fit:cover;display:block;margin-top:24px;background:linear-gradient(135deg,#dbeafe,#bfdbfe)}
        .pvb-itr h2{font-size:clamp(22px,5vw,32px);line-height:1.1;margin:0 0 14px;font-weight:900;color:#111827}
        .pvb-itr p{font-size:16px;line-height:1.8;color:#4b5563;margin:0 0 18px}
        .pvb-itr ul{margin:0 0 22px;padding:0;list-style:none;display:grid;gap:10px}
        .pvb-itr li{display:flex;gap:10px;align-items:flex-start;color:#374151;font-size:15px}
        .pvb-itr .btn{display:inline-flex;align-items:center;background:#111827;color:#fff;padding:13px 22px;border-radius:14px;font-weight:800;text-decoration:none;font-size:15px}
        @media(min-width:640px){.pvb-itr{padding:56px 24px}.pvb-itr .inner{display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:center}.pvb-itr img.img{margin-top:0}}
      </style>
      <section class="pvb-itr">
        <div class="inner">
          <div>
            <h2>Tiêu đề giải thích rõ ràng</h2>
            <p>Kể lợi ích trước, rồi đưa hình ảnh minh hoạ ở bên phải — tạo flow đọc tự nhiên.</p>
            <ul>
              <li><span>🔥</span><span>Mở đầu bằng pain point</span></li>
              <li><span>⚡</span><span>Đẩy mạnh giá trị khác biệt</span></li>
              <li><span>🛡️</span><span>Tạo niềm tin trước khi mua</span></li>
            </ul>
            <a href="#" class="btn">Đặt hàng ngay</a>
          </div>
          <img class="img" src="https://placehold.co/900x720/bfdbfe/1d4ed8?text=Click+de+doi+anh" alt="Ảnh minh hoạ" />
        </div>
      </section>
    `,
  },
  {
    id: "how-to-use",
    label: "📋 Bước sử dụng",
    category: "Sections",
    content: `
      <style>
        .pvb-how{padding:40px 16px;background:#fff}
        .pvb-how .inner{max-width:1100px;margin:0 auto}
        .pvb-how{padding:40px 16px;background:#fff}
        .pvb-how .inner{max-width:1100px;margin:0 auto}
        .pvb-how h2{font-size:26px;font-weight:900;margin:0 0 8px;text-align:center;color:#111827}
        .pvb-how .sub{text-align:center;color:#6b7280;margin:0 0 20px;font-size:14px}
        .pvb-how .steps{display:flex;flex-direction:column;gap:12px}
        .pvb-how .step{background:#fff7ed;border:1px solid #fed7aa;border-radius:16px;padding:16px 20px;display:flex;align-items:center;gap:16px;text-align:left}
        .pvb-how .num{width:44px;height:44px;min-width:44px;border-radius:50%;background:#f97316;color:#fff;font-weight:900;font-size:18px;display:flex;align-items:center;justify-content:center}
        .pvb-how h3{margin:0 0 2px;font-size:15px;font-weight:900;color:#111827}
        .pvb-how p{margin:0;color:#6b7280;font-size:13px;line-height:1.5}
      </style>
      <section class="pvb-how">
        <div class="inner">
          <h2>4 bước sử dụng đơn giản</h2>
          <p class="sub">Dẫn khách hàng từ mua hàng tới sử dụng sản phẩm.</p>
          <div class="steps">
            <div class="step"><div class="num">1</div><div><h3>Mở hộp</h3><p>Kiểm tra phụ kiện và hướng dẫn đi kèm trong hộp.</p></div></div>
            <div class="step"><div class="num">2</div><div><h3>Lắp đặt</h3><p>Lắp theo đúng hướng dẫn, hoàn thành trong vài phút.</p></div></div>
            <div class="step"><div class="num">3</div><div><h3>Sử dụng</h3><p>Vận hành hằng ngày để tối ưu trải nghiệm.</p></div></div>
            <div class="step"><div class="num">4</div><div><h3>Bảo quản</h3><p>Vệ sinh và bảo quản để dùng bền lâu.</p></div></div>
          </div>
        </div>
      </section>
    `,
  },
  {
    id: "specs-table",
    label: "📋 Thông số kỹ thuật",
    category: "Sections",
    content: `
      <style>
        .pvb-spec{padding:40px 16px;background:#f9fafb}
        .pvb-spec .inner{max-width:860px;margin:0 auto}
        .pvb-spec h2{font-size:clamp(20px,5vw,32px);font-weight:900;margin:0 0 18px;text-align:center}
        .pvb-spec table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;font-size:14px}
        .pvb-spec td{padding:13px 16px;border-bottom:1px solid #f3f4f6}
        .pvb-spec td:first-child{font-weight:700;color:#374151;width:38%;background:#f9fafb}
        .pvb-spec td:last-child{color:#111827}
        @media(min-width:640px){.pvb-spec{padding:56px 24px}.pvb-spec table{font-size:15px}.pvb-spec td{padding:14px 18px}.pvb-spec td:first-child{width:34%}}
      </style>
      <section class="pvb-spec">
        <div class="inner">
          <h2>📋 Thông số kỹ thuật</h2>
          <table>
            <tbody>
              <tr><td>Chất liệu</td><td>Inox 304</td></tr>
              <tr><td>Kích thước</td><td>28cm x 8cm</td></tr>
              <tr><td>Xuất xứ</td><td>Việt Nam</td></tr>
              <tr><td>Bảo hành</td><td>12 tháng</td></tr>
              <tr><td>Màu sắc</td><td>Bạc / Đen</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    `,
  },
  {
    id: "reviews-cards",
    label: "💬 Reviews",
    category: "Sections",
    content: `
      <style>
        .pvb-rev{padding:40px 16px;background:#fff}
        .pvb-rev .inner{max-width:1100px;margin:0 auto}
        .pvb-rev h2{font-size:clamp(22px,5vw,32px);font-weight:900;margin:0 0 20px;text-align:center}
        .pvb-rev .grid{display:grid;gap:14px}
        .pvb-rev .card{background:#f9fafb;border:1px solid #e5e7eb;border-radius:16px;padding:18px}
        .pvb-rev .stars{color:#f97316;font-size:15px;margin-bottom:8px}
        .pvb-rev p{color:#374151;font-size:14px;line-height:1.7;margin:0 0 10px;font-style:italic}
        .pvb-rev strong{font-size:14px;color:#111827}
        @media(min-width:640px){.pvb-rev{padding:56px 24px}.pvb-rev .grid{grid-template-columns:repeat(3,1fr);gap:18px}}
      </style>
      <section class="pvb-rev">
        <div class="inner">
          <h2>💬 Khách hàng nói gì?</h2>
          <div class="grid">
            <div class="card"><div class="stars">★★★★★</div><p>"Sản phẩm rất tốt, giao hàng nhanh, đóng gói cẩn thận!"</p><strong>Nguyễn Thị A — Hà Nội</strong></div>
            <div class="card"><div class="stars">★★★★★</div><p>"Chất lượng vượt mong đợi, sẽ mua lại lần sau!"</p><strong>Trần Văn B — TP.HCM</strong></div>
            <div class="card"><div class="stars">★★★★★</div><p>"Tư vấn nhiệt tình, sản phẩm đúng như mô tả!"</p><strong>Lê Thị C — Đà Nẵng</strong></div>
          </div>
        </div>
      </section>
    `,
  },
  {
    id: "faq-list",
    label: "❓ FAQ",
    category: "Sections",
    content: `
      <style>
        .pvb-faq{padding:40px 16px;background:#f9fafb}
        .pvb-faq .inner{max-width:860px;margin:0 auto}
        .pvb-faq h2{font-size:clamp(22px,5vw,32px);font-weight:900;margin:0 0 20px;text-align:center}
        .pvb-faq .item{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:16px;margin-bottom:10px}
        .pvb-faq strong{font-size:15px;color:#111827;display:block;margin-bottom:6px}
        .pvb-faq p{margin:0;color:#4b5563;font-size:14px;line-height:1.7}
        @media(min-width:640px){.pvb-faq{padding:56px 24px}.pvb-faq .item{padding:18px}}
      </style>
      <section class="pvb-faq">
        <div class="inner">
          <h2>❓ Câu hỏi thường gặp</h2>
          <div class="item"><strong>Sản phẩm có bảo hành không?</strong><p>Có, bảo hành 12 tháng kể từ ngày mua.</p></div>
          <div class="item"><strong>Giao hàng mất bao lâu?</strong><p>1-2 ngày nội thành, 2-4 ngày các tỉnh.</p></div>
          <div class="item"><strong>Có COD không?</strong><p>Có, hỗ trợ COD và chuyển khoản qua SePay.</p></div>
          <div class="item"><strong>Đổi trả như thế nào?</strong><p>Đổi trả miễn phí trong 7 ngày nếu lỗi sản xuất.</p></div>
        </div>
      </section>
    `,
  },
  {
    id: "comparison-table",
    label: "⚖️ So sánh sản phẩm",
    category: "Sections",
    content: `
      <style>
        .pvb-cmp{padding:40px 16px;background:#f9fafb}
        .pvb-cmp .inner{max-width:1100px;margin:0 auto}
        .pvb-cmp h2{font-size:clamp(22px,5vw,32px);font-weight:900;margin:0 0 8px;text-align:center;color:#111827}
        .pvb-cmp .sub{text-align:center;color:#6b7280;margin:0 0 22px;font-size:14px}
        .pvb-cmp .wrap{overflow-x:auto;border:1px solid #e5e7eb;border-radius:16px;background:#fff}
        .pvb-cmp table{width:100%;border-collapse:collapse;min-width:480px}
        .pvb-cmp th{padding:13px 14px;font-size:13px;font-weight:900;border-bottom:1px solid #e5e7eb}
        .pvb-cmp th:first-child{text-align:left;background:#f3f4f6;color:#374151}
        .pvb-cmp th.ours{background:#f97316;color:#fff}
        .pvb-cmp th.other{background:#fff7ed;color:#c2410c}
        .pvb-cmp td{padding:13px 14px;border-bottom:1px solid #f3f4f6;text-align:center;font-size:14px}
        .pvb-cmp td:first-child{text-align:left;font-weight:700;color:#111827}
        .pvb-cmp td.ours{background:#fff7ed;font-weight:900;color:#c2410c}
        .pvb-cmp .no{color:#ef4444}.pvb-cmp .yes{color:#22c55e}
        @media(min-width:640px){.pvb-cmp{padding:56px 24px}.pvb-cmp th,.pvb-cmp td{padding:14px 18px;font-size:14px}}
      </style>
      <section class="pvb-cmp">
        <div class="inner">
          <h2>⚖️ So sánh trước khi mua</h2>
          <p class="sub">Giúp khách nhìn thấy ngay giá trị vượt trội.</p>
          <div class="wrap">
            <table>
              <thead><tr>
                <th>Tính năng</th>
                <th class="other">Thường</th>
                <th class="ours">Sản phẩm này</th>
                <th class="other">Cao cấp</th>
              </tr></thead>
              <tbody>
                <tr><td>Chống dính</td><td class="no">✗</td><td class="ours">✓</td><td class="yes">✓</td></tr>
                <tr><td>Dễ vệ sinh</td><td class="no">✗</td><td class="ours">✓</td><td class="yes">✓</td></tr>
                <tr><td>Bảo hành</td><td>3 tháng</td><td class="ours">12 tháng</td><td>24 tháng</td></tr>
                <tr><td>Giá trị</td><td>Cơ bản</td><td class="ours">Tối ưu nhất</td><td>Cao cấp</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    `,
  },
  {
    id: "promo-banner",
    label: "🎯 Banner Khuyến mãi",
    category: "Sections",
    content: `
      <style>
        .pvb-promo{padding:32px 16px;background:#fff}
        .pvb-promo .inner{max-width:1100px;margin:0 auto}
        .pvb-promo .box{background:linear-gradient(135deg,#ea580c,#dc2626);border-radius:20px;padding:24px 20px;color:#fff}
        .pvb-promo .badge{display:inline-block;background:rgba(255,255,255,0.18);padding:6px 12px;border-radius:999px;font-size:11px;font-weight:900;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:10px}
        .pvb-promo h2{margin:0 0 8px;font-size:clamp(20px,5vw,28px);font-weight:900}
        .pvb-promo p{margin:0 0 16px;color:rgba(255,255,255,0.9);font-size:14px;line-height:1.6}
        .pvb-promo .code{background:#fff;color:#ea580c;display:inline-block;padding:10px 16px;border-radius:12px;font-size:20px;font-weight:900;letter-spacing:0.08em;margin-bottom:12px}
        .pvb-promo .btn{display:inline-flex;align-items:center;background:#fff;color:#dc2626;padding:12px 22px;border-radius:999px;font-weight:900;text-decoration:none;font-size:14px}
        @media(min-width:640px){.pvb-promo{padding:40px 24px}.pvb-promo .box{padding:32px;display:flex;align-items:center;justify-content:space-between;gap:24px}.pvb-promo .right{display:flex;flex-direction:column;align-items:flex-end;gap:10px;flex-shrink:0}.pvb-promo p{margin-bottom:0}}
      </style>
      <section class="pvb-promo">
        <div class="inner">
          <div class="box">
            <div>
              <span class="badge">Ưu đãi giới hạn</span>
              <h2>Mã giảm giá cho đơn hôm nay</h2>
              <p>Dùng mã để nhận ưu đãi ngay hôm nay — chỉ áp dụng trong 24h.</p>
              <div class="code">SALE10</div><br>
              <a href="#" class="btn">Nhận ưu đãi ngay</a>
            </div>
          </div>
        </div>
      </section>
    `,
  },
  {
    id: "countdown-sale",
    label: "⏱️ Đếm ngược Sale",
    category: "Sections",
    content: `
      <style>
        .pvb-cd{padding:32px 16px;background:#fff}
        .pvb-cd .inner{max-width:1100px;margin:0 auto}
        .pvb-cd .box{background:#0f172a;border-radius:20px;padding:28px 16px;color:#fff;text-align:center}
        .pvb-cd .label{font-size:12px;font-weight:900;letter-spacing:0.14em;text-transform:uppercase;color:#fbbf24;margin-bottom:14px}
        .pvb-cd .timer{display:flex;justify-content:center;gap:8px;margin-bottom:14px}
        .pvb-cd .unit{background:rgba(255,255,255,0.1);border-radius:12px;padding:12px 14px;min-width:60px}
        .pvb-cd .num{display:block;font-size:clamp(28px,8vw,48px);font-weight:900;line-height:1}
        .pvb-cd .sep{font-size:24px;font-weight:900;line-height:1;align-self:center;opacity:0.5}
        .pvb-cd .uname{display:block;font-size:11px;color:#94a3b8;margin-top:4px}
        .pvb-cd p{margin:0;color:#cbd5e1;font-size:14px}
        @media(min-width:640px){.pvb-cd{padding:40px 24px}.pvb-cd .unit{padding:16px 22px;min-width:80px}}
      </style>
      <section class="pvb-cd">
        <div class="inner">
          <div class="box">
            <div class="label">⚡ Sale sắp kết thúc</div>
            <div class="timer">
              <div class="unit"><span class="num">17</span><span class="uname">Giờ</span></div>
              <span class="sep">:</span>
              <div class="unit"><span class="num">59</span><span class="uname">Phút</span></div>
              <span class="sep">:</span>
              <div class="unit"><span class="num">59</span><span class="uname">Giây</span></div>
            </div>
            <p>Ưu đãi giới hạn — đặt hàng ngay để không bỏ lỡ.</p>
          </div>
        </div>
      </section>
    `,
  },
  {
    id: "trust-badges",
    label: "🛡️ Trust Badges",
    category: "Sections",
    content: `
      <style>
        .pvb-trust{padding:32px 16px;background:#f9fafb}
        .pvb-trust .inner{max-width:1100px;margin:0 auto}
        .pvb-trust .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
        .pvb-trust .badge{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:14px 10px;text-align:center}
        .pvb-trust .icon{font-size:24px;margin-bottom:6px}
        .pvb-trust span{font-weight:800;color:#111827;font-size:12px}
        @media(min-width:480px){.pvb-trust .grid{grid-template-columns:repeat(5,1fr)}}
        @media(min-width:640px){.pvb-trust{padding:40px 24px}.pvb-trust .badge{padding:20px}.pvb-trust .icon{font-size:28px}.pvb-trust span{font-size:14px}}
      </style>
      <section class="pvb-trust">
        <div class="inner">
          <div class="grid">
            <div class="badge"><div class="icon">🛡️</div><span>Chính hãng</span></div>
            <div class="badge"><div class="icon">🔁</div><span>Đổi trả 7 ngày</span></div>
            <div class="badge"><div class="icon">🚚</div><span>Giao hàng nhanh</span></div>
            <div class="badge"><div class="icon">💵</div><span>Thanh toán COD</span></div>
            <div class="badge"><div class="icon">✅</div><span>Cam kết chất lượng</span></div>
          </div>
        </div>
      </section>
    `,
  },
  // ─── ELEMENTS ───────────────────────────────────────────────────────────────
  {
    id: "cta-button",
    label: "🔘 Nút CTA",
    category: "Elements",
    content: `
      <style>
        .pvb-cta{padding:28px 16px;background:#fff;text-align:center}
        .pvb-cta a{display:inline-flex;align-items:center;justify-content:center;background:#f97316;color:#fff;padding:15px 32px;border-radius:999px;font-size:17px;font-weight:900;text-decoration:none;box-shadow:0 8px 24px rgba(249,115,22,0.3);width:100%;max-width:340px}
        @media(min-width:480px){.pvb-cta a{width:auto}}
      </style>
      <section class="pvb-cta">
        <a href="#">🛒 Đặt hàng ngay</a>
      </section>
    `,
  },
  {
    id: "divider",
    label: "─ Đường ngăn",
    category: "Elements",
    content: `
      <style>
        .pvb-div{padding:20px 16px;background:#fff}
        .pvb-div .line{display:flex;align-items:center;gap:12px;max-width:1100px;margin:0 auto}
        .pvb-div .hr{height:1px;flex:1;background:#e5e7eb}
        .pvb-div span{font-size:11px;font-weight:900;letter-spacing:0.18em;text-transform:uppercase;color:#9ca3af;white-space:nowrap}
      </style>
      <section class="pvb-div">
        <div class="line"><div class="hr"></div><span>Phần tiếp theo</span><div class="hr"></div></div>
      </section>
    `,
  },
  {
    id: "highlight-quote",
    label: "💬 Trích dẫn",
    category: "Elements",
    content: `
      <style>
        .pvb-quote{padding:32px 16px;background:#fff}
        .pvb-quote .box{max-width:860px;margin:0 auto;background:#fffbeb;border:1px solid #fde68a;border-radius:18px;padding:22px 20px}
        .pvb-quote p{margin:0;font-size:clamp(16px,4vw,20px);line-height:1.8;color:#92400e;font-style:italic;font-weight:700;text-align:center}
        @media(min-width:640px){.pvb-quote{padding:48px 24px}.pvb-quote .box{padding:28px 32px}}
      </style>
      <section class="pvb-quote">
        <div class="box">
          <p>"Một câu trích dẫn ấn tượng có thể làm nổi bật giá trị sản phẩm và tăng độ tin cậy cho khách hàng."</p>
        </div>
      </section>
    `,
  },
  // ─── MEDIA ──────────────────────────────────────────────────────────────────
  {
    id: "image-gallery",
    label: "🖼️ Gallery ảnh",
    category: "Media",
    content: `
      <style>
        .pvb-gal{padding:40px 16px;background:#f9fafb}
        .pvb-gal .inner{max-width:1100px;margin:0 auto}
        .pvb-gal h2{font-size:clamp(22px,5vw,32px);font-weight:900;margin:0 0 18px;text-align:center;color:#111827}
        .pvb-gal .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
        .pvb-gal img.img{width:100%;aspect-ratio:1/1;border-radius:14px;object-fit:cover;display:block;background:linear-gradient(135deg,#e5e7eb,#cbd5e1)}
        @media(min-width:480px){.pvb-gal .grid{grid-template-columns:repeat(3,1fr)}}
        @media(min-width:640px){.pvb-gal{padding:56px 24px}.pvb-gal .grid{gap:14px}}
      </style>
      <section class="pvb-gal">
        <div class="inner">
          <h2>Gallery ảnh sản phẩm</h2>
          <div class="grid">
            <img class="img" src="https://placehold.co/600x600/e5e7eb/475569?text=1" alt="Ảnh 1" />
            <img class="img" src="https://placehold.co/600x600/e5e7eb/475569?text=2" alt="Ảnh 2" />
            <img class="img" src="https://placehold.co/600x600/e5e7eb/475569?text=3" alt="Ảnh 3" />
            <img class="img" src="https://placehold.co/600x600/e5e7eb/475569?text=4" alt="Ảnh 4" />
            <img class="img" src="https://placehold.co/600x600/e5e7eb/475569?text=5" alt="Ảnh 5" />
            <img class="img" src="https://placehold.co/600x600/e5e7eb/475569?text=6" alt="Ảnh 6" />
          </div>
        </div>
      </section>
    `,
  },
  // ─── SOCIAL PROOF ────────────────────────────────────────────────────────────
  {
    id: "customer-reviews",
    label: "⭐ Đánh giá khách hàng",
    category: "Social Proof",
    content: `
      <style>
        .pvb-rev2{padding:40px 16px;background:#fafafa}
        .pvb-rev2 .inner{max-width:860px;margin:0 auto}
        .pvb-rev2 h2{font-size:clamp(18px,4vw,24px);font-weight:900;color:#111827;margin:0 0 20px}
        .pvb-rev2 .summary{display:flex;gap:20px;align-items:flex-start;background:#fff;border-radius:16px;padding:18px;border:1px solid #f1f5f9;box-shadow:0 1px 6px rgba(0,0,0,0.05);margin-bottom:20px;flex-wrap:wrap}
        .pvb-rev2 .score-box{text-align:center;min-width:80px}
        .pvb-rev2 .score-num{font-size:44px;font-weight:900;color:#111827;line-height:1}
        .pvb-rev2 .score-stars{color:#f59e0b;font-size:16px;margin:4px 0}
        .pvb-rev2 .score-count{font-size:11px;color:#9ca3af}
        .pvb-rev2 .bars{flex:1;min-width:160px;display:flex;flex-direction:column;gap:5px}
        .pvb-rev2 .bar-row{display:flex;align-items:center;gap:7px;font-size:12px}
        .pvb-rev2 .bar-label{width:22px;text-align:right;color:#6b7280;font-weight:600}
        .pvb-rev2 .bar-track{flex:1;height:7px;background:#f1f5f9;border-radius:4px;overflow:hidden}
        .pvb-rev2 .bar-fill{height:100%;background:#f59e0b;border-radius:4px}
        .pvb-rev2 .bar-pct{width:28px;color:#9ca3af;font-size:11px}
        .pvb-rev2 .grid{columns:2 260px;gap:12px}
        .pvb-rev2 .card{break-inside:avoid;margin-bottom:12px;background:#fff;border-radius:12px;border:1px solid #f1f5f9;box-shadow:0 1px 5px rgba(0,0,0,0.05);overflow:hidden}
        .pvb-rev2 .card-img{width:100%;aspect-ratio:4/3;object-fit:contain;background:#f8f8f6;display:block}
        .pvb-rev2 .card-body{padding:12px 14px}
        .pvb-rev2 .avatar-row{display:flex;align-items:center;gap:9px;margin-bottom:7px}
        .pvb-rev2 .avatar{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff;flex-shrink:0}
        .pvb-rev2 .reviewer-name{font-weight:700;font-size:13px;color:#111827}
        .pvb-rev2 .reviewer-meta{font-size:11px;color:#9ca3af}
        .pvb-rev2 .badge{font-size:10px;font-weight:700;color:#059669;background:#d1fae5;border-radius:4px;padding:1px 5px;margin-left:4px}
        .pvb-rev2 .stars{color:#f59e0b;font-size:13px;margin-bottom:5px}
        .pvb-rev2 .text{font-size:13px;color:#374151;line-height:1.6;margin:0}
        @media(max-width:480px){.pvb-rev2 .grid{columns:1}}
        @media(min-width:640px){.pvb-rev2{padding:56px 24px}}
      </style>
      <style>
        .pvb-rev2 .filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
        .pvb-rev2 .filter-btn{padding:5px 14px;border-radius:20px;font-size:13px;font-weight:600;border:1.5px solid #e5e7eb;background:#fff;color:#6b7280;cursor:pointer;transition:all 0.15s}
        .pvb-rev2 .filter-btn.active{border-color:#f59e0b;background:#fef3c7;color:#92400e}
        .pvb-rev2 .card[hidden]{display:none!important}
      </style>
      <section class="pvb-rev2">
        <div class="inner">
          <h2>⭐ Đánh giá từ khách hàng thực tế</h2>
          <div class="summary">
            <div class="score-box">
              <div class="score-num">4.8</div>
              <div class="score-stars">★★★★★</div>
              <div class="score-count">1,247 đánh giá</div>
            </div>
            <div class="bars">
              <div class="bar-row"><span class="bar-label">5★</span><div class="bar-track"><div class="bar-fill" style="width:89%"></div></div><span class="bar-pct">89%</span></div>
              <div class="bar-row"><span class="bar-label">4★</span><div class="bar-track"><div class="bar-fill" style="width:8%"></div></div><span class="bar-pct">8%</span></div>
              <div class="bar-row"><span class="bar-label">3★</span><div class="bar-track"><div class="bar-fill" style="width:2%"></div></div><span class="bar-pct">2%</span></div>
              <div class="bar-row"><span class="bar-label">2★</span><div class="bar-track"><div class="bar-fill" style="width:1%"></div></div><span class="bar-pct">1%</span></div>
              <div class="bar-row"><span class="bar-label">1★</span><div class="bar-track"><div class="bar-fill" style="width:0%"></div></div><span class="bar-pct">0%</span></div>
            </div>
          </div>
          <div class="filters">
            <button class="filter-btn active" data-filter="0">Tất cả</button>
            <button class="filter-btn" data-filter="5">5★</button>
            <button class="filter-btn" data-filter="4">4★</button>
            <button class="filter-btn" data-filter="3">3★</button>
          </div>
          <div class="grid">
            <div class="card" data-stars="5">
              <img class="card-img" src="https://placehold.co/600x300/fef3c7/92400e?text=Ảnh+khách+chụp" alt="Ảnh review" />
              <div class="card-body">
                <div class="avatar-row">
                  <div class="avatar" style="background:linear-gradient(135deg,#FF6B6B,#FF8E53)">NL</div>
                  <div><div class="reviewer-name">Nguyễn Thị Lan <span class="badge">✅ Đã mua</span></div><div class="reviewer-meta">Hà Nội · 2 ngày trước</div></div>
                </div>
                <div class="stars">★★★★★</div>
                <p class="text">"Sản phẩm rất tốt, chất lượng vượt mong đợi! Giao hàng nhanh, đóng gói cẩn thận."</p>
              </div>
            </div>
            <div class="card" data-stars="5">
              <div class="card-body">
                <div class="avatar-row">
                  <div class="avatar" style="background:linear-gradient(135deg,#4ECDC4,#44A08D)">TN</div>
                  <div><div class="reviewer-name">Trần Văn Nam <span class="badge">✅ Đã mua</span></div><div class="reviewer-meta">TP.HCM · 1 tuần trước</div></div>
                </div>
                <div class="stars">★★★★★</div>
                <p class="text">"Dùng được 1 tháng vẫn tốt, giá hợp lý. Chất lượng tương xứng với giá tiền, rất hài lòng."</p>
              </div>
            </div>
            <div class="card" data-stars="5">
              <div class="card-body">
                <div class="avatar-row">
                  <div class="avatar" style="background:linear-gradient(135deg,#667eea,#764ba2)">LH</div>
                  <div><div class="reviewer-name">Lê Thị Hoa <span class="badge">✅ Đã mua</span></div><div class="reviewer-meta">Đà Nẵng · 2 tuần trước</div></div>
                </div>
                <div class="stars">★★★★★</div>
                <p class="text">"Mua về tặng mẹ, mẹ thích lắm! Sản phẩm đúng như mô tả, shop tư vấn nhiệt tình."</p>
              </div>
            </div>
            <div class="card" data-stars="4">
              <img class="card-img" src="https://placehold.co/600x280/fef3c7/92400e?text=Ảnh+khách+chụp+2" alt="Ảnh review" />
              <div class="card-body">
                <div class="avatar-row">
                  <div class="avatar" style="background:linear-gradient(135deg,#f7971e,#ffd200)">PL</div>
                  <div><div class="reviewer-name">Phạm Thị Linh <span class="badge">✅ Đã mua</span></div><div class="reviewer-meta">Hải Phòng · 3 tuần trước</div></div>
                </div>
                <div class="stars">★★★★☆</div>
                <p class="text">"Sản phẩm khá ổn, giao hàng đúng hẹn. Chỉ tiếc bao bì hơi đơn giản nhưng bên trong rất tốt."</p>
              </div>
            </div>
          </div>
        </div>
      </section>
      <script>
        (function(){
          function initRevFilter(section){
            var btns = section.querySelectorAll('.filter-btn');
            var grid = section.querySelector('.grid');
            function getStars(card){
              var s = card.getAttribute('data-stars');
              if(s) return parseInt(s);
              var st = card.querySelector('.stars');
              if(!st) return 5;
              return (st.textContent.match(/★/g)||[]).length;
            }
            function applyFilter(f){
              var cards = grid.querySelectorAll('.card');
              cards.forEach(function(c){
                c.hidden = f !== 0 && getStars(c) !== f;
              });
              btns.forEach(function(b){
                b.classList.toggle('active', parseInt(b.getAttribute('data-filter')) === f);
              });
            }
            btns.forEach(function(btn){
              btn.addEventListener('click', function(){
                applyFilter(parseInt(btn.getAttribute('data-filter')));
              });
            });
          }
          function tryInit(){
            document.querySelectorAll('.pvb-rev2').forEach(function(s){
              if(!s.dataset.revInit){ s.dataset.revInit='1'; initRevFilter(s); }
            });
          }
          if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',tryInit);
          else tryInit();
        })();
      </script>
    `,
  },
]

// ─── Webcake-style sidebar ───────────────────────────────────────────────────
const CATEGORIES = [
  { id: "Sections",     icon: "⊞", label: "Sections" },
  { id: "Elements",     icon: "✦", label: "Elements" },
  { id: "Media",        icon: "🖼", label: "Media" },
  { id: "Social Proof", icon: "⭐", label: "Social" },
]

export default function ProductPageBuilder({
  open,
  productTitle,
  initialContent,
  hasLiveContent,
  onClose,
  onSaveDraft,
  onPublish,
}: Props) {
  const editorRef = useRef<any>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [draftSaved, setDraftSaved] = useState(false)
  const [published, setPublished] = useState(false)
  const [error, setError] = useState("")
  const [ready, setReady] = useState(false)
  const [hasDraftChanges, setHasDraftChanges] = useState(false)
  const [activePanel, setActivePanel] = useState<string | null>("Sections")

  useEffect(() => {
    if (!open || !containerRef.current || editorRef.current) return

    const script = document.createElement("script")
    script.src = "https://unpkg.com/grapesjs@0.21.7/dist/grapes.min.js"
    script.async = true
    let injectedBlockStyle: HTMLStyleElement | null = null

    const initEditor = () => {
      const grapesjs = (window as any).grapesjs
      if (!grapesjs || !containerRef.current) return

      const editor = grapesjs.init({
        container: containerRef.current,
        height: "100%",
        storageManager: false,
        fromElement: false,
        noticeOnUnload: false,
        blockManager: {
          appendTo: "#product-page-builder-blocks",
          blocks,
        },
        assetManager: {
          upload: "/admin/uploads",
          uploadName: "files",
          credentials: "include",
          multiUpload: true,
          autoAdd: true,
          uploadFile: async (e: any) => {
            const files: File[] = e.dataTransfer ? [...e.dataTransfer.files] : [...e.target.files]
            const formData = new FormData()
            files.forEach((f: File) => formData.append("files", f))
            const res = await fetch("/admin/uploads", {
              method: "POST",
              credentials: "include",
              body: formData,
            })
            const data = await res.json()
            const uploaded = (data.files || []).map((f: any) => ({ src: f.url, name: f.url.split("/").pop() }))
            editor.AssetManager.add(uploaded)
          },
        },
      })
      injectedBlockStyle = document.createElement("style")
      injectedBlockStyle.setAttribute("data-product-page-builder-blocks", "true")
      injectedBlockStyle.textContent = `
        #product-page-builder-blocks,
        #product-page-builder-blocks .gjs-blocks-c,
        #product-page-builder-blocks .gjs-blocks {
          overflow: visible !important;
        }
        #product-page-builder-blocks .gjs-block {
          margin-bottom: 8px;
        }
      `
      document.head.appendChild(injectedBlockStyle)

      if (initialContent && initialContent !== "{}") {
        try {
          const saved = JSON.parse(initialContent)
          // New format: {html, css, projectData}
          if (saved.projectData) {
            editor.loadProjectData(saved.projectData)
          } else {
            // Old format: raw projectData JSON
            editor.loadProjectData(saved)
          }
        } catch {
          editor.setComponents(initialContent)
        }
      }

      editorRef.current = editor
      // GrapesJS wraps blocks panel in overflow:hidden — override it
      setTimeout(() => {
        const el = document.querySelector('#product-page-builder-blocks')
        if (el?.parentElement) {
          const p = el.parentElement as HTMLElement
          p.style.overflow = 'visible'
          p.style.height = 'auto'
          p.style.maxHeight = 'none'
        }
      }, 300)
      // Detect any change to show "unsaved" indicator
      editor.on("component:update component:add component:remove", (component: any) => {
        setHasDraftChanges(true)
        setDraftSaved(false)
        setPublished(false)

        // Nếu component có class "stars" → tự đếm ★ và cập nhật data-stars trên .card cha
        try {
          const el = component?.getEl?.()
          if (el?.classList?.contains("stars")) {
            const count = (el.textContent?.match(/★/g) || []).length
            if (count > 0) {
              // Cập nhật DOM trực tiếp
              const cardEl = el.closest(".card")
              if (cardEl) cardEl.setAttribute("data-stars", String(count))
              // Leo lên model GrapesJS tìm .card (có thể nhiều cấp)
              let comp: any = component
              for (let i = 0; i < 5; i++) {
                comp = comp.parent?.()
                if (!comp) break
                if (comp.getEl?.()?.classList?.contains("card")) {
                  const attrs = comp.getAttributes()
                  comp.setAttributes({ ...attrs, "data-stars": String(count) })
                  break
                }
              }
            }
          }
        } catch {}
      })

      // Inject filter JS vào canvas iframe (chạy mỗi khi canvas load hoặc component thêm mới)
      const REV_FILTER_JS = `
        (function(){
          function initRevFilter(section){
            var btns=section.querySelectorAll('.filter-btn');
            var grid=section.querySelector('.grid');
            if(!grid||!btns.length) return;
            function getStars(card){
              var s=card.getAttribute('data-stars');
              if(s) return parseInt(s);
              var st=card.querySelector('.stars');
              return st?(st.textContent.match(/★/g)||[]).length:5;
            }
            function applyFilter(f){
              grid.querySelectorAll('.card').forEach(function(c){
                c.style.display=(f===0||getStars(c)===f)?'':'none';
              });
              btns.forEach(function(b){
                var active=parseInt(b.getAttribute('data-filter'))===f;
                b.style.borderColor=active?'#f59e0b':'#e5e7eb';
                b.style.background=active?'#fef3c7':'#fff';
                b.style.color=active?'#92400e':'#6b7280';
              });
            }
            btns.forEach(function(btn){
              if(btn.dataset.revBound) return;
              btn.dataset.revBound='1';
              btn.addEventListener('click',function(){
                applyFilter(parseInt(btn.getAttribute('data-filter')));
              });
            });
          }
          function tryInit(){
            document.querySelectorAll('.pvb-rev2').forEach(function(s){
              initRevFilter(s);
            });
          }
          tryInit();
          // Re-init khi DOM thay đổi (thêm review mới)
          if(window._revObserver) window._revObserver.disconnect();
          window._revObserver=new MutationObserver(tryInit);
          document.querySelectorAll('.pvb-rev2 .grid').forEach(function(g){
            window._revObserver.observe(g,{childList:true});
          });
        })();
      `

      const injectFilterScript = () => {
        try {
          const doc = editor.Canvas.getDocument()
          if (!doc) return
          doc.querySelectorAll('.pvb-rev2').forEach((s: any) => {
            if (!s.querySelector('.filter-btn')) return
            const sc = doc.createElement('script')
            sc.textContent = REV_FILTER_JS
            doc.body.appendChild(sc)
          })
        } catch {}
      }

      editor.on("canvas:frame:load", injectFilterScript)
      editor.on("component:add", () => setTimeout(injectFilterScript, 100))

      // ── "Thêm 5 đánh giá" command cho block customer-reviews ──────────────
      const REVIEW_POOL = [
        { initials:"PL", grad:"#f7971e,#ffd200", name:"Phạm Thị Linh",  loc:"Hải Phòng",   stars:5, text:"Sản phẩm dùng rất bền, đã mua lần 2. Giao hàng nhanh, shop chăm sóc khách hàng tốt.", date:"3 tuần trước", hasImg:false },
        { initials:"HD", grad:"#11998e,#38ef7d", name:"Hoàng Văn Dũng",  loc:"Cần Thơ",     stars:5, text:"Đây là lần thứ 3 tôi mua. Không bao giờ thất vọng, chắc chắn sẽ tiếp tục ủng hộ shop!", date:"1 tháng trước", hasImg:true },
        { initials:"MT", grad:"#ee0979,#ff6a00", name:"Mai Thị Thu",      loc:"Huế",         stars:5, text:"Hàng y như hình, chất lượng tốt. Đóng gói kỹ, không bị móp. Sẽ giới thiệu cho bạn bè.", date:"2 tuần trước", hasImg:false },
        { initials:"NM", grad:"#667eea,#764ba2", name:"Ngô Văn Minh",    loc:"Đồng Nai",    stars:4, text:"Sản phẩm ổn, giá hợp lý. Giao hơi chậm 1 ngày nhưng chất lượng thì không chê vào đâu.", date:"5 ngày trước", hasImg:false },
        { initials:"BH", grad:"#4ECDC4,#44A08D", name:"Bùi Thị Hằng",   loc:"Bình Dương",  stars:5, text:"Mua về dùng thử, thích quá nên mua thêm 2 cái nữa. Chất liệu tốt, không bị phai màu.", date:"1 tuần trước", hasImg:true },
        { initials:"VT", grad:"#FF6B6B,#FF8E53", name:"Vũ Thị Thanh",   loc:"Hà Nội",      stars:5, text:"Shop nhiệt tình, hàng đẹp đúng như quảng cáo. Giao hàng nhanh trong ngày. 5 sao!", date:"4 ngày trước", hasImg:false },
        { initials:"ĐQ", grad:"#f7971e,#ffd200", name:"Đặng Văn Quân",  loc:"Vũng Tàu",   stars:5, text:"Mua tặng vợ, vợ thích lắm. Sản phẩm chắc chắn, dùng hàng ngày vẫn không bị hỏng.", date:"2 tháng trước", hasImg:false },
        { initials:"TL", grad:"#11998e,#38ef7d", name:"Trịnh Thị Lan",  loc:"Nam Định",    stars:5, text:"Lần đầu mua online mà nhận được hàng đúng như mô tả, rất hài lòng. Sẽ ủng hộ shop dài dài.", date:"3 ngày trước", hasImg:true },
        { initials:"PH", grad:"#667eea,#764ba2", name:"Phan Văn Hùng",  loc:"Nghệ An",     stars:4, text:"Chất lượng tốt, giá cạnh tranh. Đóng gói đẹp, phù hợp làm quà tặng. Khá hài lòng.", date:"6 ngày trước", hasImg:false },
        { initials:"LN", grad:"#ee0979,#ff6a00", name:"Lý Thị Nga",     loc:"Cà Mau",      stars:5, text:"Mua 3 lần rồi, lần nào cũng hài lòng. Hàng bền, đẹp, xứng đáng với giá tiền.", date:"2 tuần trước", hasImg:false },
        { initials:"ĐL", grad:"#4ECDC4,#44A08D", name:"Đinh Thị Liên",  loc:"Thái Bình",   stars:5, text:"Giao hàng siêu nhanh, chỉ 1 ngày đã nhận được. Sản phẩm y chang hình, rất chất lượng!", date:"8 ngày trước", hasImg:true },
        { initials:"TT", grad:"#FF6B6B,#FF8E53", name:"Tống Văn Tài",   loc:"Kiên Giang",  stars:5, text:"Shop tư vấn nhiệt tình, giao hàng đúng hẹn. Sản phẩm dùng rất tốt, đáng tiền.", date:"5 tuần trước", hasImg:false },
        { initials:"HM", grad:"#f7971e,#ffd200", name:"Huỳnh Thị Mai",  loc:"Tiền Giang",  stars:5, text:"Đặt hàng tối, sáng hôm sau đã giao. Sản phẩm đẹp, đúng size, không bị lỗi. Rất hài lòng!", date:"1 tuần trước", hasImg:false },
        { initials:"CV", grad:"#11998e,#38ef7d", name:"Cao Văn Vinh",   loc:"Lâm Đồng",    stars:4, text:"Chất lượng khá tốt so với giá. Chỉ mong shop có thêm màu sắc đa dạng hơn. Sẽ mua lại.", date:"2 ngày trước", hasImg:true },
        { initials:"NQ", grad:"#667eea,#764ba2", name:"Nguyễn Thị Quỳnh", loc:"Hải Dương", stars:5, text:"Mua tặng sinh nhật mẹ, mẹ thích lắm. Đóng gói quà rất đẹp, shop còn kèm thiệp chúc mừng.", date:"4 tuần trước", hasImg:false },
      ]

      const makeReviewCard = (r: typeof REVIEW_POOL[0]) =>
        `<div class="card" data-stars="${r.stars}">${r.hasImg ? `<img class="card-img" src="https://placehold.co/600x280/fef3c7/92400e?text=Ảnh+khách+chụp" alt="" />` : ""}<div class="card-body"><div class="avatar-row"><div class="avatar" style="background:linear-gradient(135deg,${r.grad})">${r.initials}</div><div><div class="reviewer-name">${r.name} <span class="badge">✅ Đã mua</span></div><div class="reviewer-meta">${r.loc} · ${r.date}</div></div></div><div class="stars">${"★".repeat(r.stars)}${"☆".repeat(5 - r.stars)}</div><p class="text">"${r.text}"</p></div></div>`

      let reviewPoolIdx = 4 // block mặc định đã dùng 4 review đầu

      editor.Commands.add("pvb-add-5-reviews", {
        run(ed: any) {
          const wrapper = ed.getWrapper()
          const sections = wrapper.find(".pvb-rev2")
          if (!sections.length) return
          // Tìm section được select hoặc lấy cái đầu tiên
          const selected = ed.getSelected()
          const section = (selected && selected.getEl()?.closest(".pvb-rev2"))
            ? selected.closest(".pvb-rev2") || sections[0]
            : sections[0]
          const grids = section.find ? section.find(".grid") : wrapper.find(".pvb-rev2 .grid")
          const grid = grids[0] || wrapper.find(".pvb-rev2 .grid")[0]
          if (!grid) return
          for (let i = 0; i < 5; i++) {
            const r = REVIEW_POOL[reviewPoolIdx % REVIEW_POOL.length]
            reviewPoolIdx++
            grid.append(makeReviewCard(r), { at: grid.components().length })
          }
        },
      })

      // Command: thêm ảnh vào card review đang chọn
      editor.Commands.add("pvb-add-review-img", {
        run(ed: any) {
          const selected = ed.getSelected()
          if (!selected) return
          const el = selected.getEl()
          const card = el?.classList.contains("card") ? selected
            : selected.closest?.(".card") || null
          if (!card) return
          // Kiểm tra đã có ảnh chưa
          const existing = card.find(".card-img")
          if (existing?.length) {
            // Đã có ảnh → mở asset manager để đổi
            ed.AssetManager.open({
              select(asset: any) {
                existing[0].set("attributes", { ...existing[0].getAttributes(), src: asset.get("src") })
                ed.AssetManager.close()
              }
            })
            return
          }
          // Chưa có ảnh → chèn img vào đầu card
          card.components().unshift({
            tagName: "img",
            attributes: {
              class: "card-img",
              src: "https://placehold.co/600x280/fef3c7/92400e?text=Ảnh+khách+chụp",
              alt: "Ảnh review",
            },
          })
          // Mở asset manager để chọn ảnh ngay
          setTimeout(() => {
            ed.AssetManager.open({
              select(asset: any) {
                const imgs = card.find(".card-img")
                if (imgs?.length) imgs[0].set("attributes", { class: "card-img", src: asset.get("src"), alt: "Ảnh review" })
                ed.AssetManager.close()
              }
            })
          }, 100)
        },
      })

      // Thêm toolbar button khi chọn component trong pvb-rev2
      editor.on("component:selected", (component: any) => {
        const el = component.getEl()
        if (!el) return
        const inRevSection = el.classList.contains("pvb-rev2") || !!el.closest?.(".pvb-rev2")
        if (!inRevSection) return

        const toolbar: any[] = component.get("toolbar") || []

        // Nút +5 đánh giá — chỉ trên section hoặc grid
        const isSection = el.classList.contains("pvb-rev2") || el.classList.contains("grid")
        if (isSection && !toolbar.find((t: any) => t.command === "pvb-add-5-reviews")) {
          toolbar.unshift({
            attributes: { title: "Thêm 5 đánh giá", style: "font-size:11px;padding:0 6px;font-weight:700" },
            label: "+5 ⭐",
            command: "pvb-add-5-reviews",
          })
        }

        // Nút 📷 Thêm/đổi ảnh — chỉ trên card review
        const isCard = el.classList.contains("card") || !!el.closest?.(".card")
        if (isCard && !toolbar.find((t: any) => t.command === "pvb-add-review-img")) {
          const hasImg = !!el.querySelector?.(".card-img") || !!el.closest?.(".card")?.querySelector(".card-img")
          toolbar.unshift({
            attributes: { title: hasImg ? "Đổi ảnh" : "Thêm ảnh", style: "font-size:12px;padding:0 6px" },
            label: hasImg ? "🔄" : "📷",
            command: "pvb-add-review-img",
          })
        }

        component.set("toolbar", toolbar)
      })
      // ─────────────────────────────────────────────────────────────────────

      // ── Move up / Move down commands ──────────────────────────────────────
      editor.Commands.add("pvb-move-up", {
        run(ed: any) {
          const sel = ed.getSelected()
          if (!sel) return
          const parent = sel.parent()
          if (!parent) return
          const idx = parent.components().indexOf(sel)
          if (idx <= 0) return
          parent.components().remove(sel, { temporary: true })
          parent.components().add(sel, { at: idx - 1 })
          ed.select(sel)
        },
      })
      editor.Commands.add("pvb-move-down", {
        run(ed: any) {
          const sel = ed.getSelected()
          if (!sel) return
          const parent = sel.parent()
          if (!parent) return
          const comps = parent.components()
          const idx = comps.indexOf(sel)
          if (idx >= comps.length - 1) return
          comps.remove(sel, { temporary: true })
          comps.add(sel, { at: idx + 1 })
          ed.select(sel)
        },
      })

      // Add move buttons to toolbar of every direct child of wrapper (top-level sections)
      editor.on("component:selected", (component: any) => {
        const parent = component.parent()
        if (!parent) return
        // Only add to top-level sections (direct children of wrapper)
        if (parent !== editor.getWrapper()) return

        const toolbar: any[] = component.get("toolbar") || []
        if (!toolbar.find((t: any) => t.command === "pvb-move-up")) {
          toolbar.push({
            attributes: { title: "Di chuyển lên", style: "font-size:14px;padding:0 6px" },
            label: "↑",
            command: "pvb-move-up",
          })
          toolbar.push({
            attributes: { title: "Di chuyển xuống", style: "font-size:14px;padding:0 6px" },
            label: "↓",
            command: "pvb-move-down",
          })
          component.set("toolbar", toolbar)
        }
      })

      // Keyboard arrow keys to move selected section
      editor.on("canvas:frame:load", () => {
        try {
          const doc = editor.Canvas.getDocument()
          if (!doc) return
          doc.addEventListener("keydown", (e: KeyboardEvent) => {
            const sel = editor.getSelected()
            if (!sel) return
            if (e.key === "ArrowUp" && (e.altKey || e.metaKey)) {
              e.preventDefault()
              editor.runCommand("pvb-move-up")
            } else if (e.key === "ArrowDown" && (e.altKey || e.metaKey)) {
              e.preventDefault()
              editor.runCommand("pvb-move-down")
            }
          })
        } catch {}
      })
      // ─────────────────────────────────────────────────────────────────────

      setReady(true)
      setLoading(false)
    }

    script.onload = () => {
      const link = document.createElement("link")
      link.rel = "stylesheet"
      link.href = "https://unpkg.com/grapesjs@0.21.7/dist/css/grapes.min.css"
      document.head.appendChild(link)
      initEditor()
    }

    script.onerror = () => {
      setError("Khong tai duoc GrapesJS")
      setLoading(false)
    }

    setLoading(true)
    document.head.appendChild(script)

    return () => {
      injectedBlockStyle?.remove()
      editorRef.current?.destroy()
      editorRef.current = null
      setReady(false)
    }
  }, [open, initialContent])

  const getPayload = () => {
    const editor = editorRef.current
    return JSON.stringify({
      html: editor.getHtml(),
      css: editor.getCss(),
      projectData: editor.getProjectData(),
    })
  }

  const handleSaveDraft = async () => {
    if (!editorRef.current) return
    setSavingDraft(true)
    setError("")
    try {
      await onSaveDraft(getPayload())
      setDraftSaved(true)
      setHasDraftChanges(false)
      setTimeout(() => setDraftSaved(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lưu nháp thất bại")
    } finally {
      setSavingDraft(false)
    }
  }

  const handlePublish = async () => {
    if (!editorRef.current) return
    setPublishing(true)
    setError("")
    try {
      await onPublish(getPayload())
      setPublished(true)
      setHasDraftChanges(false)
      setDraftSaved(false)
      setTimeout(() => setPublished(false), 4000)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Xuất bản thất bại")
    } finally {
      setPublishing(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[9999] bg-black/70">
      <div className="flex h-full w-full flex-col bg-white">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 gap-4">
          {/* Left: title + status */}
          <div className="flex items-center gap-3 min-w-0">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-500">Page Builder</p>
              <h2 className="text-base font-black text-gray-900 truncate max-w-[280px]">{productTitle}</h2>
            </div>
            {/* Change indicator */}
            {hasDraftChanges && !draftSaved && !published && (
              <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5 font-semibold whitespace-nowrap">
                ● Chưa lưu
              </span>
            )}
            {draftSaved && (
              <span className="text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-0.5 font-semibold whitespace-nowrap">
                ✓ Đã lưu nháp
              </span>
            )}
            {published && (
              <span className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-0.5 font-semibold whitespace-nowrap">
                🚀 Đã xuất bản!
              </span>
            )}
            {hasLiveContent && !published && (
              <span className="text-xs text-gray-500 bg-gray-100 rounded-full px-2.5 py-0.5 whitespace-nowrap">
                Live: đã xuất bản
              </span>
            )}
          </div>

          {/* Right: actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {error && <span className="text-xs text-red-600 max-w-[200px] text-right">{error}</span>}

            <button onClick={onClose}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50">
              ✕ Đóng
            </button>

            {/* Save draft */}
            <button onClick={handleSaveDraft} disabled={savingDraft || publishing || !ready}
              className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-1.5 text-sm font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50 whitespace-nowrap">
              {savingDraft ? "Đang lưu..." : "💾 Lưu nháp"}
            </button>

            {/* Publish */}
            <button onClick={handlePublish} disabled={savingDraft || publishing || !ready}
              className="rounded-lg bg-orange-500 px-5 py-1.5 text-sm font-black text-white hover:bg-orange-600 disabled:opacity-50 whitespace-nowrap shadow-sm">
              {publishing ? "Đang xuất bản..." : "🚀 Xuất bản"}
            </button>
          </div>
        </div>

        {/* ── Webcake layout: icon strip | sliding panel | canvas ── */}
        <div className="flex min-h-0 flex-1">
          {/* Icon strip — always visible, fixed width */}
          <div className="flex flex-col items-center gap-1 border-r border-gray-200 bg-gray-900 py-3 w-[52px] flex-shrink-0">
            {CATEGORIES.map(cat => (
              <button
                key={cat.id}
                onClick={() => setActivePanel(p => p === cat.id ? null : cat.id)}
                title={cat.label}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 3,
                  width: 44,
                  padding: "8px 4px",
                  borderRadius: 8,
                  border: "none",
                  cursor: "pointer",
                  background: activePanel === cat.id ? "#f97316" : "transparent",
                  color: activePanel === cat.id ? "#fff" : "#9ca3af",
                  fontSize: 18,
                  transition: "background 0.15s",
                }}
              >
                <span>{cat.icon}</span>
                <span style={{ fontSize: 9, fontWeight: 700, lineHeight: 1, letterSpacing: "0.04em" }}>
                  {cat.label.split(" ")[0].substring(0, 6).toUpperCase()}
                </span>
              </button>
            ))}
          </div>

          {/* Sliding block panel */}
          {activePanel && (
            <div className="flex flex-col border-r border-gray-200 bg-gray-50 w-[240px] flex-shrink-0 h-full">
              {/* Panel header */}
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-200 bg-white">
                <span className="text-xs font-black uppercase tracking-widest text-gray-700">
                  {CATEGORIES.find(c => c.id === activePanel)?.label}
                </span>
                <button
                  onClick={() => setActivePanel(null)}
                  className="text-gray-400 hover:text-gray-600 text-xs font-bold leading-none"
                >✕</button>
              </div>
              {/* Tip */}
              <div className="px-3 pt-2.5 pb-1">
                <p className="text-[10px] text-gray-400 leading-relaxed">Kéo block vào canvas hoặc click để thêm.</p>
              </div>
              {/* Block list — scrollable */}
              <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-1.5">
                {blocks
                  .filter(b => b.category === activePanel)
                  .map(b => (
                    <button
                      key={b.id}
                      onClick={() => {
                        const editor = editorRef.current
                        if (!editor) {
                          console.warn("[PVB] editor not ready")
                          return
                        }
                        try {
                          const wrapper = editor.getWrapper()
                          const selected = editor.getSelected()
                          // Find insertion index: after the selected top-level section, or at end
                          let insertAt = wrapper.components().length
                          if (selected) {
                            // Walk up to find direct child of wrapper
                            let comp: any = selected
                            while (comp && comp.parent() !== wrapper) comp = comp.parent()
                            if (comp) insertAt = wrapper.components().indexOf(comp) + 1
                          }
                          const added = editor.addComponents(b.content.trim(), { at: insertAt })
                          // Select + scroll canvas to the newly added component
                          if (added && added.length) {
                            const lastComp = added[added.length - 1]
                            editor.select(lastComp)
                            setTimeout(() => {
                              const frameDoc = editor.Canvas.getFrameEl()?.contentDocument
                              if (!frameDoc) return
                              const el = lastComp.getEl ? lastComp.getEl() : null
                              if (el) {
                                el.scrollIntoView({ behavior: "smooth", block: "nearest" })
                              } else {
                                // fallback: scroll iframe body to bottom
                                frameDoc.documentElement.scrollTop = frameDoc.documentElement.scrollHeight
                              }
                            }, 150)
                          }
                        } catch(e) {
                          console.error("[PVB] addComponents error", e)
                        }
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        width: "100%",
                        padding: "9px 10px",
                        borderRadius: 8,
                        border: "1px solid #e5e7eb",
                        background: "#fff",
                        cursor: "pointer",
                        textAlign: "left",
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#374151",
                        transition: "box-shadow 0.12s, border-color 0.12s",
                      }}
                      onMouseEnter={e => {
                        ;(e.currentTarget as HTMLElement).style.borderColor = "#f97316"
                        ;(e.currentTarget as HTMLElement).style.boxShadow = "0 0 0 2px #fed7aa"
                      }}
                      onMouseLeave={e => {
                        ;(e.currentTarget as HTMLElement).style.borderColor = "#e5e7eb"
                        ;(e.currentTarget as HTMLElement).style.boxShadow = "none"
                      }}
                    >
                      <span style={{ fontSize: 18, lineHeight: 1 }}>
                        {b.label.match(/^(\p{Emoji})/u)?.[0] ?? "◻"}
                      </span>
                      <span style={{ flex: 1, lineHeight: 1.3 }}>
                        {b.label.replace(/^(\p{Emoji}\s*)/u, "")}
                      </span>
                    </button>
                  ))}
              </div>
            </div>
          )}

          {/* GrapesJS block manager renders here — kept off-screen to support drag */}
          <div id="product-page-builder-blocks" style={{ position: "absolute", left: -9999, top: 0, width: 220, pointerEvents: "none", visibility: "hidden" }} />

          {/* Canvas */}
          <div className="flex-1 h-full overflow-y-auto bg-white min-w-0">
            {loading && (
              <div className="flex h-full items-center justify-center text-sm text-gray-500">
                Đang tải GrapesJS...
              </div>
            )}
            <div ref={containerRef} className="h-full min-h-0" />
          </div>
        </div>
      </div>
    </div>
  )
}
