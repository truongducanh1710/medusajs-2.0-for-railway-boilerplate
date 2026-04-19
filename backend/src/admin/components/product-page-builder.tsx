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
  {
    id: "video-demo",
    label: "Video Demo",
    category: "Sections",
    content: `
      <section style="padding:56px 24px;background:#fff">
        <div style="max-width:960px;margin:0 auto">
          <h2 style="font-size:32px;font-weight:900;margin:0 0 16px;text-align:center">Video Demo</h2>
          <div style="aspect-ratio:16/9;background:#111827;border-radius:20px;overflow:hidden">
            <iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" style="width:100%;height:100%;border:0" allowfullscreen></iframe>
          </div>
        </div>
      </section>
    `,
  },
  {
    id: "pain-solution",
    label: "Pain/Solution",
    category: "Sections",
    content: `
      <section style="padding:56px 24px;background:#f9fafb">
        <div style="max-width:1100px;margin:0 auto;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px">
          <div style="background:#fff1f2;border:1px solid #fecdd3;border-radius:20px;padding:24px">
            <h3 style="margin:0 0 16px;font-size:24px;font-weight:900;color:#be123c">Vấn đề khách hàng gặp</h3>
            <ul style="margin:0;padding-left:18px;line-height:1.8;color:#4b5563">
              <li>Chảo dễ dính, khó vệ sinh</li>
              <li>Tốn thời gian khi nấu nướng</li>
              <li>Dụng cụ nhanh hư</li>
            </ul>
          </div>
          <div style="background:#ecfdf5;border:1px solid #bbf7d0;border-radius:20px;padding:24px">
            <h3 style="margin:0 0 16px;font-size:24px;font-weight:900;color:#047857">Giải pháp của bạn</h3>
            <ul style="margin:0;padding-left:18px;line-height:1.8;color:#4b5563">
              <li>Chống dính tốt hơn</li>
              <li>Dễ lau chùi sau khi dùng</li>
              <li>Bền hơn, tiết kiệm hơn</li>
            </ul>
          </div>
        </div>
      </section>
    `,
  },
  {
    id: "benefits-grid",
    label: "Benefits Grid",
    category: "Sections",
    content: `
      <section style="padding:56px 24px;background:#fff">
        <div style="max-width:1100px;margin:0 auto">
          <h2 style="font-size:32px;font-weight:900;margin:0 0 24px;text-align:center">Điểm nổi bật</h2>
          <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px">
            <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:18px;padding:18px;text-align:center"><div style="font-size:28px">🔥</div><h4 style="margin:10px 0 6px;font-weight:800">Chống dính</h4><p style="margin:0;color:#6b7280;font-size:14px">Bề mặt dễ vệ sinh</p></div>
            <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:18px;padding:18px;text-align:center"><div style="font-size:28px">💧</div><h4 style="margin:10px 0 6px;font-weight:800">Tiết kiệm nước</h4><p style="margin:0;color:#6b7280;font-size:14px">Rửa nhanh, gọn</p></div>
            <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:18px;padding:18px;text-align:center"><div style="font-size:28px">⚡</div><h4 style="margin:10px 0 6px;font-weight:800">Dùng bền</h4><p style="margin:0;color:#6b7280;font-size:14px">Vật liệu chất lượng</p></div>
            <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:18px;padding:18px;text-align:center"><div style="font-size:28px">🛡️</div><h4 style="margin:10px 0 6px;font-weight:800">Bảo hành</h4><p style="margin:0;color:#6b7280;font-size:14px">An tâm sử dụng</p></div>
          </div>
        </div>
      </section>
    `,
  },
  {
    id: "specs-table",
    label: "Specs Table",
    category: "Sections",
    content: `
      <section style="padding:56px 24px;background:#f9fafb">
        <div style="max-width:860px;margin:0 auto">
          <h2 style="font-size:32px;font-weight:900;margin:0 0 24px;text-align:center">Thông số kỹ thuật</h2>
          <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden">
            <tbody>
              <tr><td style="padding:14px 18px;font-weight:700;border-bottom:1px solid #e5e7eb;width:34%">Chất liệu</td><td style="padding:14px 18px;border-bottom:1px solid #e5e7eb">Inox 304</td></tr>
              <tr><td style="padding:14px 18px;font-weight:700;border-bottom:1px solid #e5e7eb">Kích thước</td><td style="padding:14px 18px;border-bottom:1px solid #e5e7eb">28cm x 8cm</td></tr>
              <tr><td style="padding:14px 18px;font-weight:700;border-bottom:1px solid #e5e7eb">Xuất xứ</td><td style="padding:14px 18px;border-bottom:1px solid #e5e7eb">Việt Nam</td></tr>
              <tr><td style="padding:14px 18px;font-weight:700">Bảo hành</td><td style="padding:14px 18px">12 tháng</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    `,
  },
  {
    id: "reviews-cards",
    label: "Reviews",
    category: "Sections",
    content: `
      <section style="padding:56px 24px;background:#fff">
        <div style="max-width:1100px;margin:0 auto">
          <h2 style="font-size:32px;font-weight:900;margin:0 0 24px;text-align:center">Khách hàng nói gì?</h2>
          <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px">
            <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:18px;padding:18px">★★★★★<p style="color:#374151">Sản phẩm rất tốt, giao hàng nhanh.</p><strong>Nguyễn Thị A</strong></div>
            <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:18px;padding:18px">★★★★★<p style="color:#374151">Chất lượng vượt mong đợi.</p><strong>Trần Văn B</strong></div>
            <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:18px;padding:18px">★★★★★<p style="color:#374151">Tư vấn nhiệt tình, rất hài lòng.</p><strong>Lê Thị C</strong></div>
          </div>
        </div>
      </section>
    `,
  },
  {
    id: "faq-list",
    label: "FAQ",
    category: "Sections",
    content: `
      <section style="padding:56px 24px;background:#f9fafb">
        <div style="max-width:860px;margin:0 auto">
          <h2 style="font-size:32px;font-weight:900;margin:0 0 24px;text-align:center">Câu hỏi thường gặp</h2>
          <div style="display:grid;gap:12px">
            <div style="background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:18px"><strong>Sản phẩm có bảo hành không?</strong><p style="margin:8px 0 0;color:#4b5563">Có, bảo hành 12 tháng.</p></div>
            <div style="background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:18px"><strong>Giao hàng mất bao lâu?</strong><p style="margin:8px 0 0;color:#4b5563">1-3 ngày tuỳ khu vực.</p></div>
            <div style="background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:18px"><strong>Có COD không?</strong><p style="margin:8px 0 0;color:#4b5563">Có, hỗ trợ COD và SePay.</p></div>
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
      <section style="padding:56px 24px;background:linear-gradient(135deg,#f97316 0%,#ea580c 45%,#dc2626 100%);color:#fff">
        <div style="max-width:1100px;margin:0 auto;display:grid;grid-template-columns:1.1fr 0.9fr;gap:32px;align-items:center">
          <div>
            <span style="display:inline-block;background:rgba(255,255,255,0.18);padding:8px 14px;border-radius:999px;font-size:13px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:18px">Bán chạy hôm nay</span>
            <h2 style="font-size:clamp(32px,5vw,56px);line-height:1.05;margin:0 0 16px;font-weight:900">Tiêu đề nổi bật cho sản phẩm</h2>
            <p style="font-size:18px;line-height:1.7;max-width:560px;margin:0 0 24px;color:rgba(255,255,255,0.9)">Mô tả ngắn, mạnh mẽ để dẫn khách hàng đi tới hành động mua ngay.</p>
            <div style="display:flex;gap:12px;flex-wrap:wrap">
              <a href="#" style="display:inline-flex;align-items:center;justify-content:center;background:#fff;color:#ea580c;padding:14px 22px;border-radius:999px;font-weight:800;text-decoration:none">Mua ngay</a>
              <a href="#" style="display:inline-flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,0.45);color:#fff;padding:14px 22px;border-radius:999px;font-weight:800;text-decoration:none">Xem chi tiết</a>
            </div>
          </div>
          <div style="min-height:320px;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);border-radius:24px;padding:20px;display:flex;align-items:center;justify-content:center">
            <div style="text-align:center">
              <div style="font-size:64px;margin-bottom:12px">🖼️</div>
              <div style="font-size:18px;font-weight:800">Hero Image</div>
            </div>
          </div>
        </div>
      </section>
    `,
  },
  {
    id: "image-text-left",
    label: "📸 Ảnh trái + Text",
    category: "Sections",
    content: `
      <section style="padding:56px 24px;background:#fff">
        <div style="max-width:1100px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:center">
          <div style="min-height:360px;border-radius:24px;background:linear-gradient(135deg,#e5e7eb,#cbd5e1);display:flex;align-items:center;justify-content:center;color:#475569;font-weight:900;font-size:22px">Ảnh sản phẩm</div>
          <div>
            <h2 style="font-size:32px;line-height:1.1;margin:0 0 16px;font-weight:900;color:#111827">Tiêu đề nội dung nổi bật</h2>
            <p style="font-size:17px;line-height:1.8;color:#4b5563;margin:0 0 20px">Dùng block này để trình bày lợi ích, mô tả giải pháp hoặc câu chuyện thương hiệu theo cấu trúc dễ đọc.</p>
            <ul style="margin:0 0 24px;padding:0;list-style:none;display:grid;gap:10px;color:#374151">
              <li style="display:flex;gap:10px;align-items:flex-start"><span>✅</span><span>Điểm nhấn 1 của sản phẩm</span></li>
              <li style="display:flex;gap:10px;align-items:flex-start"><span>✅</span><span>Điểm nhấn 2 của sản phẩm</span></li>
              <li style="display:flex;gap:10px;align-items:flex-start"><span>✅</span><span>Điểm nhấn 3 của sản phẩm</span></li>
            </ul>
            <a href="#" style="display:inline-flex;align-items:center;justify-content:center;background:#f97316;color:#fff;padding:13px 22px;border-radius:14px;font-weight:800;text-decoration:none">Xem chi tiết</a>
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
      <section style="padding:56px 24px;background:#f9fafb">
        <div style="max-width:1100px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:center">
          <div>
            <h2 style="font-size:32px;line-height:1.1;margin:0 0 16px;font-weight:900;color:#111827">Tiêu đề giải thích rõ ràng</h2>
            <p style="font-size:17px;line-height:1.8;color:#4b5563;margin:0 0 20px">Block này phù hợp để kể lợi ích trước, rồi mới đưa hình ảnh minh hoạ ở bên phải.</p>
            <ul style="margin:0 0 24px;padding:0;list-style:none;display:grid;gap:10px;color:#374151">
              <li style="display:flex;gap:10px;align-items:flex-start"><span>🔥</span><span>Mở đầu bằng pain point</span></li>
              <li style="display:flex;gap:10px;align-items:flex-start"><span>⚡</span><span>Đẩy mạnh giá trị khác biệt</span></li>
              <li style="display:flex;gap:10px;align-items:flex-start"><span>🛡️</span><span>Tạo niềm tin trước khi mua</span></li>
            </ul>
            <a href="#" style="display:inline-flex;align-items:center;justify-content:center;background:#111827;color:#fff;padding:13px 22px;border-radius:14px;font-weight:800;text-decoration:none">Đặt hàng ngay</a>
          </div>
          <div style="min-height:360px;border-radius:24px;background:linear-gradient(135deg,#dbeafe,#bfdbfe);display:flex;align-items:center;justify-content:center;color:#1d4ed8;font-weight:900;font-size:22px">Ảnh minh hoạ</div>
        </div>
      </section>
    `,
  },
  {
    id: "how-to-use",
    label: "📋 Bước sử dụng",
    category: "Sections",
    content: `
      <section style="padding:56px 24px;background:#fff">
        <div style="max-width:1100px;margin:0 auto">
          <h2 style="font-size:32px;font-weight:900;margin:0 0 12px;text-align:center;color:#111827">4 bước sử dụng đơn giản</h2>
          <p style="text-align:center;color:#6b7280;margin:0 0 32px">Dẫn khách hàng từ mua hàng tới sử dụng sản phẩm chỉ trong vài bước.</p>
          <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px">
            <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:20px;padding:22px;text-align:center">
              <div style="width:54px;height:54px;border-radius:50%;background:#f97316;color:#fff;font-weight:900;font-size:22px;display:flex;align-items:center;justify-content:center;margin:0 auto 14px">1</div>
              <h3 style="margin:0 0 8px;font-size:18px;font-weight:900;color:#111827">Mở hộp</h3>
              <p style="margin:0;color:#6b7280;font-size:14px;line-height:1.7">Kiểm tra phụ kiện và hướng dẫn đi kèm.</p>
            </div>
            <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:20px;padding:22px;text-align:center">
              <div style="width:54px;height:54px;border-radius:50%;background:#f97316;color:#fff;font-weight:900;font-size:22px;display:flex;align-items:center;justify-content:center;margin:0 auto 14px">2</div>
              <h3 style="margin:0 0 8px;font-size:18px;font-weight:900;color:#111827">Lắp đặt</h3>
              <p style="margin:0;color:#6b7280;font-size:14px;line-height:1.7">Lắp theo đúng hướng dẫn trong vài phút.</p>
            </div>
            <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:20px;padding:22px;text-align:center">
              <div style="width:54px;height:54px;border-radius:50%;background:#f97316;color:#fff;font-weight:900;font-size:22px;display:flex;align-items:center;justify-content:center;margin:0 auto 14px">3</div>
              <h3 style="margin:0 0 8px;font-size:18px;font-weight:900;color:#111827">Sử dụng</h3>
              <p style="margin:0;color:#6b7280;font-size:14px;line-height:1.7">Vận hành hằng ngày để tối ưu trải nghiệm.</p>
            </div>
            <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:20px;padding:22px;text-align:center">
              <div style="width:54px;height:54px;border-radius:50%;background:#f97316;color:#fff;font-weight:900;font-size:22px;display:flex;align-items:center;justify-content:center;margin:0 auto 14px">4</div>
              <h3 style="margin:0 0 8px;font-size:18px;font-weight:900;color:#111827">Bảo quản</h3>
              <p style="margin:0;color:#6b7280;font-size:14px;line-height:1.7">Vệ sinh và bảo quản để dùng bền lâu.</p>
            </div>
          </div>
        </div>
      </section>
    `,
  },
  {
    id: "comparison-table",
    label: "⚖️ So sánh sản phẩm",
    category: "Sections",
    content: `
      <section style="padding:56px 24px;background:#f9fafb">
        <div style="max-width:1100px;margin:0 auto">
          <h2 style="font-size:32px;font-weight:900;margin:0 0 12px;text-align:center;color:#111827">So sánh trước khi mua</h2>
          <p style="text-align:center;color:#6b7280;margin:0 0 30px">Giúp khách nhìn thấy ngay giá trị vượt trội của sản phẩm.</p>
          <div style="overflow-x:auto;border:1px solid #e5e7eb;border-radius:18px;background:#fff">
            <table style="width:100%;border-collapse:collapse;min-width:760px">
              <thead>
                <tr>
                  <th style="text-align:left;padding:16px 18px;background:#f3f4f6;border-bottom:1px solid #e5e7eb;font-size:14px;font-weight:800;color:#374151">Tính năng</th>
                  <th style="text-align:center;padding:16px 18px;background:#fff7ed;border-bottom:1px solid #fdba74;font-size:14px;font-weight:900;color:#c2410c">Thường</th>
                  <th style="text-align:center;padding:16px 18px;background:#f97316;border-bottom:1px solid #ea580c;font-size:14px;font-weight:900;color:#fff">Sản phẩm này</th>
                  <th style="text-align:center;padding:16px 18px;background:#fff7ed;border-bottom:1px solid #fdba74;font-size:14px;font-weight:900;color:#c2410c">Cao cấp</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style="padding:14px 18px;border-bottom:1px solid #f3f4f6;font-weight:700;color:#111827">Chống dính</td>
                  <td style="padding:14px 18px;border-bottom:1px solid #f3f4f6;text-align:center;color:#ef4444">✗</td>
                  <td style="padding:14px 18px;border-bottom:1px solid #f3f4f6;text-align:center;background:#fff7ed;font-weight:900;color:#c2410c">✓</td>
                  <td style="padding:14px 18px;border-bottom:1px solid #f3f4f6;text-align:center;color:#22c55e">✓</td>
                </tr>
                <tr>
                  <td style="padding:14px 18px;border-bottom:1px solid #f3f4f6;font-weight:700;color:#111827">Dễ vệ sinh</td>
                  <td style="padding:14px 18px;border-bottom:1px solid #f3f4f6;text-align:center;color:#ef4444">✗</td>
                  <td style="padding:14px 18px;border-bottom:1px solid #f3f4f6;text-align:center;background:#fff7ed;font-weight:900;color:#c2410c">✓</td>
                  <td style="padding:14px 18px;border-bottom:1px solid #f3f4f6;text-align:center;color:#22c55e">✓</td>
                </tr>
                <tr>
                  <td style="padding:14px 18px;border-bottom:1px solid #f3f4f6;font-weight:700;color:#111827">Bảo hành</td>
                  <td style="padding:14px 18px;border-bottom:1px solid #f3f4f6;text-align:center;color:#6b7280">3 tháng</td>
                  <td style="padding:14px 18px;border-bottom:1px solid #f3f4f6;text-align:center;background:#fff7ed;font-weight:900;color:#c2410c">12 tháng</td>
                  <td style="padding:14px 18px;border-bottom:1px solid #f3f4f6;text-align:center;color:#6b7280">24 tháng</td>
                </tr>
                <tr>
                  <td style="padding:14px 18px;font-weight:700;color:#111827">Giá trị tổng thể</td>
                  <td style="padding:14px 18px;text-align:center;color:#6b7280">Cơ bản</td>
                  <td style="padding:14px 18px;text-align:center;background:#fff7ed;font-weight:900;color:#c2410c">Tối ưu nhất</td>
                  <td style="padding:14px 18px;text-align:center;color:#6b7280">Cao cấp</td>
                </tr>
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
      <section style="padding:56px 24px;background:#fff">
        <div style="max-width:1100px;margin:0 auto">
          <div style="background:linear-gradient(135deg,#ea580c 0%,#dc2626 100%);border-radius:24px;padding:32px;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap">
            <div>
              <span style="display:inline-block;background:rgba(255,255,255,0.18);padding:8px 12px;border-radius:999px;font-size:12px;font-weight:900;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:12px">Ưu đãi giới hạn</span>
              <h2 style="margin:0 0 10px;font-size:30px;font-weight:900">Mã giảm giá cho đơn hôm nay</h2>
              <p style="margin:0;color:rgba(255,255,255,0.9);font-size:16px;line-height:1.7;max-width:620px">Dùng block này để đẩy khuyến mãi, mã coupon hoặc offer flash sale cho khách hàng.</p>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:12px">
              <div style="background:#fff;color:#ea580c;padding:12px 18px;border-radius:14px;font-size:22px;font-weight:900;letter-spacing:0.08em">SALE10</div>
              <a href="#" style="display:inline-flex;align-items:center;justify-content:center;background:#fff;color:#dc2626;padding:13px 22px;border-radius:999px;font-weight:900;text-decoration:none">Nhận ưu đãi</a>
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
      <section style="padding:56px 24px;background:#fff">
        <div style="max-width:1100px;margin:0 auto">
          <div style="background:#0f172a;border-radius:24px;padding:30px;color:#fff;text-align:center">
            <div style="font-size:14px;font-weight:900;letter-spacing:0.14em;text-transform:uppercase;color:#fbbf24;margin-bottom:12px">Sale sắp kết thúc</div>
            <div style="font-size:clamp(34px,5vw,58px);font-weight:900;line-height:1.05;margin:0 0 14px">17:59:59</div>
            <p style="margin:0;color:#cbd5e1;font-size:16px">Sản phẩm đang được bán với ưu đãi giới hạn, tạo cảm giác urgency cho khách hàng.</p>
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
      <section style="padding:56px 24px;background:#f9fafb">
        <div style="max-width:1100px;margin:0 auto">
          <div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:14px">
            <div style="background:#fff;border:1px solid #e5e7eb;border-radius:18px;padding:20px;text-align:center">
              <div style="font-size:28px;margin-bottom:8px">🛡️</div>
              <div style="font-weight:900;color:#111827">Chính hãng</div>
            </div>
            <div style="background:#fff;border:1px solid #e5e7eb;border-radius:18px;padding:20px;text-align:center">
              <div style="font-size:28px;margin-bottom:8px">🔁</div>
              <div style="font-weight:900;color:#111827">Đổi trả</div>
            </div>
            <div style="background:#fff;border:1px solid #e5e7eb;border-radius:18px;padding:20px;text-align:center">
              <div style="font-size:28px;margin-bottom:8px">🚚</div>
              <div style="font-weight:900;color:#111827">Giao hàng</div>
            </div>
            <div style="background:#fff;border:1px solid #e5e7eb;border-radius:18px;padding:20px;text-align:center">
              <div style="font-size:28px;margin-bottom:8px">💵</div>
              <div style="font-weight:900;color:#111827">COD</div>
            </div>
            <div style="background:#fff;border:1px solid #e5e7eb;border-radius:18px;padding:20px;text-align:center">
              <div style="font-size:28px;margin-bottom:8px">✅</div>
              <div style="font-weight:900;color:#111827">Cam kết</div>
            </div>
          </div>
        </div>
      </section>
    `,
  },
  {
    id: "cta-button",
    label: "🔘 Nút CTA",
    category: "Elements",
    content: `
      <section style="padding:36px 24px;background:#fff">
        <div style="max-width:1100px;margin:0 auto;text-align:center">
          <a href="#" style="display:inline-flex;align-items:center;justify-content:center;background:#f97316;color:#fff;padding:16px 30px;border-radius:999px;font-size:18px;font-weight:900;text-decoration:none;box-shadow:0 12px 30px rgba(249,115,22,0.25)">Đặt hàng ngay</a>
        </div>
      </section>
    `,
  },
  {
    id: "divider",
    label: "─ Đường ngăn",
    category: "Elements",
    content: `
      <section style="padding:28px 24px;background:#fff">
        <div style="max-width:1100px;margin:0 auto;display:flex;align-items:center;gap:14px">
          <div style="height:1px;flex:1;background:#e5e7eb"></div>
          <span style="font-size:12px;font-weight:900;letter-spacing:0.18em;text-transform:uppercase;color:#9ca3af">Phần tiếp theo</span>
          <div style="height:1px;flex:1;background:#e5e7eb"></div>
        </div>
      </section>
    `,
  },
  {
    id: "highlight-quote",
    label: "💬 Trích dẫn",
    category: "Elements",
    content: `
      <section style="padding:56px 24px;background:#fff">
        <div style="max-width:900px;margin:0 auto">
          <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:22px;padding:28px 30px">
            <p style="margin:0;font-size:22px;line-height:1.8;color:#92400e;font-style:italic;font-weight:700;text-align:center">“Một câu trích dẫn ấn tượng có thể làm nổi bật giá trị sản phẩm và tăng độ tin cậy cho khách hàng.”</p>
          </div>
        </div>
      </section>
    `,
  },
  {
    id: "image-gallery",
    label: "🖼️ Gallery ảnh",
    category: "Media",
    content: `
      <section style="padding:56px 24px;background:#f9fafb">
        <div style="max-width:1100px;margin:0 auto">
          <h2 style="font-size:32px;font-weight:900;margin:0 0 24px;text-align:center;color:#111827">Gallery ảnh sản phẩm</h2>
          <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px">
            <div style="aspect-ratio:1/1;border-radius:18px;background:linear-gradient(135deg,#e5e7eb,#cbd5e1);display:flex;align-items:center;justify-content:center;color:#475569;font-weight:900">Ảnh 1</div>
            <div style="aspect-ratio:1/1;border-radius:18px;background:linear-gradient(135deg,#e5e7eb,#cbd5e1);display:flex;align-items:center;justify-content:center;color:#475569;font-weight:900">Ảnh 2</div>
            <div style="aspect-ratio:1/1;border-radius:18px;background:linear-gradient(135deg,#e5e7eb,#cbd5e1);display:flex;align-items:center;justify-content:center;color:#475569;font-weight:900">Ảnh 3</div>
            <div style="aspect-ratio:1/1;border-radius:18px;background:linear-gradient(135deg,#e5e7eb,#cbd5e1);display:flex;align-items:center;justify-content:center;color:#475569;font-weight:900">Ảnh 4</div>
            <div style="aspect-ratio:1/1;border-radius:18px;background:linear-gradient(135deg,#e5e7eb,#cbd5e1);display:flex;align-items:center;justify-content:center;color:#475569;font-weight:900">Ảnh 5</div>
            <div style="aspect-ratio:1/1;border-radius:18px;background:linear-gradient(135deg,#e5e7eb,#cbd5e1);display:flex;align-items:center;justify-content:center;color:#475569;font-weight:900">Ảnh 6</div>
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

        <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr]">
          <aside className="border-r border-gray-200 bg-gray-50 p-3">
            <div className="mb-3 rounded-xl bg-white p-3 text-sm text-gray-600 border border-gray-200">
              Kéo block sang canvas. Nếu đã có `page_content`, editor sẽ nạp nội dung cũ.
            </div>
            <div id="product-page-builder-blocks" className="space-y-2" />
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
