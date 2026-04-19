"use client"

import { useEffect, useRef, useState } from "react"

type Props = {
  open: boolean
  productTitle: string
  initialContent?: string
  onClose: () => void
  onSave: (content: string) => Promise<void>
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
]

export default function ProductPageBuilder({
  open,
  productTitle,
  initialContent,
  onClose,
  onSave,
}: Props) {
  const editorRef = useRef<any>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [ready, setReady] = useState(false)

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

  const handleSave = async () => {
    if (!editorRef.current) return
    setSaving(true)
    setError("")

    try {
      const editor = editorRef.current
      // Save as {html, css, projectData} so storefront can render with styles
      const payload = JSON.stringify({
        html: editor.getHtml(),
        css: editor.getCss(),
        projectData: editor.getProjectData(),
      })
      await onSave(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Luu that bai")
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[9999] bg-black/70">
      <div className="flex h-full w-full flex-col bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-500">
              Page Builder
            </p>
            <h2 className="text-lg font-black text-gray-900">{productTitle}</h2>
          </div>
          <div className="flex items-center gap-2">
            {error && <span className="text-sm text-red-600">{error}</span>}
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Đóng
            </button>
            <button
              onClick={handleSave}
              disabled={saving || loading || !ready}
              className="rounded-lg bg-orange-500 px-4 py-1.5 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-50"
            >
              {saving ? "Đang lưu..." : "Lưu Page Builder"}
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[220px_1fr]">
          <aside className="border-r border-gray-200 bg-gray-50 p-3 overflow-y-auto">
            <div className="mb-3 rounded-xl bg-white p-3 text-sm text-gray-600 border border-gray-200">
              Kéo block sang canvas. Nếu đã có `page_content`, editor sẽ nạp nội dung cũ.
            </div>
            <div id="product-page-builder-blocks" className="overflow-visible space-y-2" />
          </aside>

          <div className="min-h-0 bg-white">
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
