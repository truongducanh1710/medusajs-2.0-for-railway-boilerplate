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
    id: "tiktok-video",
    label: "🎵 Video TikTok",
    category: "Sections",
    content: `
      <style>
        .pvb-tiktok{padding:40px 16px;background:#fff}
        .pvb-tiktok .inner{max-width:420px;margin:0 auto;text-align:center}
        .pvb-tiktok h2{font-size:clamp(20px,4vw,28px);font-weight:900;margin:0 0 14px}
        .pvb-tiktok .frame{border-radius:16px;overflow:hidden;background:#000;position:relative}
        .pvb-tiktok iframe{width:100%;height:740px;border:0;display:block}
        .pvb-tiktok .tt-input-row{display:flex;gap:8px;margin-top:14px;align-items:center}
        .pvb-tiktok .tt-input{flex:1;padding:8px 12px;border:1.5px solid #d1d5db;border-radius:8px;font-size:13px;outline:none}
        .pvb-tiktok .tt-btn{padding:8px 14px;background:#111827;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap}
        .pvb-tiktok .tt-hint{font-size:11px;color:#9ca3af;margin-top:6px;text-align:left}
        @media(min-width:768px){.pvb-tiktok{padding:56px 24px}}
      </style>
      <section class="pvb-tiktok">
        <div class="inner">
          <h2>🎵 Video thực tế từ khách hàng</h2>
          <div class="frame">
            <iframe id="tt-frame" src="https://www.tiktok.com/embed/v2/7000000000000000000" allowfullscreen allow="autoplay"></iframe>
          </div>
          <div class="tt-input-row">
            <input class="tt-input" id="tt-url-input" type="text" placeholder="Dán link TikTok vào đây... (vd: tiktok.com/@user/video/123456)" />
            <button class="tt-btn" onclick="(function(){var inp=document.getElementById('tt-url-input');var url=inp?inp.value.trim():'';var m=url.match(/\/video\/(\d+)/);if(m){var fr=document.getElementById('tt-frame');if(fr)fr.src='https://www.tiktok.com/embed/v2/'+m[1];inp.style.borderColor='#22c55e';}else{inp.style.borderColor='#ef4444';alert('Không tìm thấy ID video. Hãy dán link dạng: tiktok.com/@user/video/12345678');}})()">Áp dụng</button>
          </div>
          <p class="tt-hint">Lấy link từ TikTok → Copy link → Dán vào ô trên → Bấm Áp dụng</p>
        </div>
      </section>
    `,
  },
  {
    id: "tiktok-gallery",
    label: "🎵 Video Gallery (3 video)",
    category: "Sections",
    content: `
      <style>
        .pvb-tkg{padding:32px 16px;background:#fff}
        .pvb-tkg h2{font-size:clamp(18px,4vw,26px);font-weight:900;text-align:center;margin:0 0 16px}
        .pvb-tkg .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;max-width:700px;margin:0 auto}
        .pvb-tkg .card{position:relative;aspect-ratio:9/16;border-radius:12px;overflow:hidden;background:linear-gradient(160deg,#010101 0%,#1a1a2e 50%,#010101 100%);cursor:pointer}
        .pvb-tkg .card video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
        .pvb-tkg .card .overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.25);transition:background .2s}
        .pvb-tkg .card:hover .overlay{background:rgba(0,0,0,0.1)}
        .pvb-tkg .card .tt-logo{width:40px;height:40px;background:#fff;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:22px}
        .pvb-tkg .play{width:52px;height:52px;background:rgba(255,255,255,0.95);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px;padding-left:4px;box-shadow:0 4px 16px rgba(0,0,0,0.4)}
        .pvb-tkg-pop{display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.9);align-items:center;justify-content:center}
        .pvb-tkg-pop.open{display:flex}
        .pvb-tkg-pop .pop-inner{position:relative;width:100%;max-width:360px;height:80vh}
        .pvb-tkg-pop video{width:100%;height:100%;object-fit:contain;border-radius:12px;background:#000}
        .pvb-tkg-pop .tkg-close{position:absolute;top:-44px;right:0;background:none;border:none;color:#fff;font-size:36px;cursor:pointer;line-height:1;padding:0}
        .pvb-tkg .admin-panel{margin-top:20px;padding:14px;background:#f9fafb;border-radius:10px;border:1px dashed #d1d5db}
        .pvb-tkg .admin-panel p{font-size:11px;color:#6b7280;margin:0 0 10px;font-weight:600}
        .pvb-tkg .tt-row{display:flex;gap:6px;margin-bottom:8px;align-items:center}
        .pvb-tkg .tt-lbl{font-size:11px;color:#374151;white-space:nowrap;width:52px}
        .pvb-tkg .tt-status{font-size:11px;color:#6b7280;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .pvb-tkg .tt-btn{padding:6px 10px;background:#111827;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;flex-shrink:0}
        .pvb-tkg .tt-btn:disabled{opacity:.5;cursor:not-allowed}
        @media(min-width:768px){.pvb-tkg{padding:48px 24px}.pvb-tkg .grid{gap:12px}}
      </style>
      <section class="pvb-tkg">
        <h2>&#127925; Video thực tế từ khách hàng</h2>
        <div class="grid">
          <div class="card" data-src="" data-idx="0">
            <div class="overlay"><div class="tt-logo">&#127925;</div></div>
          </div>
          <div class="card" data-src="" data-idx="1">
            <div class="overlay"><div class="tt-logo">&#127925;</div></div>
          </div>
          <div class="card" data-src="" data-idx="2">
            <div class="overlay"><div class="tt-logo">&#127925;</div></div>
          </div>
        </div>
        <div class="admin-panel">
          <p>&#128247; Tải video TikTok (mp4) lên cho từng ô</p>
          <div class="tt-row"><span class="tt-lbl">Video 1</span><span class="tt-status" id="tkg-s0">Chưa có video</span><button class="tt-btn" onclick="window.parent.pvbTkgUpload(0)">&#8679; Tải lên</button></div>
          <div class="tt-row"><span class="tt-lbl">Video 2</span><span class="tt-status" id="tkg-s1">Chưa có video</span><button class="tt-btn" onclick="window.parent.pvbTkgUpload(1)">&#8679; Tải lên</button></div>
          <div class="tt-row"><span class="tt-lbl">Video 3</span><span class="tt-status" id="tkg-s2">Chưa có video</span><button class="tt-btn" onclick="window.parent.pvbTkgUpload(2)">&#8679; Tải lên</button></div>
        </div>
      </section>
      <div class="pvb-tkg-pop" id="pvb-tkg-pop">
        <div class="pop-inner">
          <button class="tkg-close" onclick="pvbTkgClose()">&#10005;</button>
          <video id="pvb-tkg-video" src="" controls autoplay playsinline></video>
        </div>
      </div>
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
        .pvb-spec .spec-table{width:100%;background:#fff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;font-size:14px}
        .pvb-spec .spec-row{display:flex;border-bottom:1px solid #f3f4f6}
        .pvb-spec .spec-row:last-child{border-bottom:none}
        .pvb-spec .spec-key{font-weight:700;color:#374151;width:38%;background:#f9fafb;padding:13px 16px;flex-shrink:0}
        .pvb-spec .spec-val{color:#111827;padding:13px 16px;flex:1}
        @media(min-width:640px){.pvb-spec{padding:56px 24px}.pvb-spec .spec-table{font-size:15px}.pvb-spec .spec-key,.pvb-spec .spec-val{padding:14px 18px}.pvb-spec .spec-key{width:34%}}
      </style>
      <section class="pvb-spec">
        <div class="inner">
          <h2>📋 Thông số kỹ thuật</h2>
          <div class="spec-table">
            <div class="spec-row"><div class="spec-key">Chất liệu</div><div class="spec-val">Inox 304</div></div>
            <div class="spec-row"><div class="spec-key">Kích thước</div><div class="spec-val">28cm x 8cm</div></div>
            <div class="spec-row"><div class="spec-key">Xuất xứ</div><div class="spec-val">Việt Nam</div></div>
            <div class="spec-row"><div class="spec-key">Bảo hành</div><div class="spec-val">12 tháng</div></div>
            <div class="spec-row"><div class="spec-key">Màu sắc</div><div class="spec-val">Bạc / Đen</div></div>
          </div>
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
    label: "🎯 Promo — Đỏ cam",
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
    id: "promo-flash",
    label: "⚡ Promo — Flash Sale",
    category: "Sections",
    content: `
      <style>
        .pvb-promo-flash{padding:32px 16px;background:#fff}
        .pvb-promo-flash .inner{max-width:1100px;margin:0 auto}
        .pvb-promo-flash .box{background:#0f172a;border-radius:20px;padding:24px 20px;color:#fff;position:relative;overflow:hidden}
        .pvb-promo-flash .box::before{content:'';position:absolute;top:-40px;right:-40px;width:200px;height:200px;background:radial-gradient(circle,rgba(251,191,36,0.15),transparent 70%);pointer-events:none}
        .pvb-promo-flash .badge{display:inline-flex;align-items:center;gap:6px;background:#fbbf24;color:#0f172a;padding:5px 12px;border-radius:999px;font-size:11px;font-weight:900;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:14px}
        .pvb-promo-flash .left h2{font-size:clamp(24px,6vw,40px);font-weight:900;color:#fbbf24;margin:0 0 6px;line-height:1.1}
        .pvb-promo-flash .left p{margin:0 0 10px;color:#94a3b8;font-size:14px}
        .pvb-promo-flash .stock{display:inline-flex;align-items:center;gap:6px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#fca5a5;padding:5px 12px;border-radius:999px;font-size:12px;font-weight:700}
        .pvb-promo-flash .right{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:14px;padding:18px 20px;margin-top:16px}
        .pvb-promo-flash .price-orig{font-size:14px;color:#64748b;text-decoration:line-through;margin:0 0 4px}
        .pvb-promo-flash .price-now{font-size:clamp(28px,7vw,40px);font-weight:900;color:#fbbf24;margin:0 0 14px;line-height:1}
        .pvb-promo-flash .btn{display:inline-flex;align-items:center;gap:8px;background:#fbbf24;color:#0f172a;padding:12px 22px;border-radius:999px;font-weight:900;font-size:15px;text-decoration:none;border:none;cursor:pointer}
        @media(min-width:640px){
          .pvb-promo-flash{padding:40px 24px}
          .pvb-promo-flash .box{padding:32px 36px;display:flex;align-items:center;gap:32px}
          .pvb-promo-flash .left{flex:1}
          .pvb-promo-flash .right{margin-top:0;min-width:220px;flex-shrink:0}
        }
      </style>
      <section class="pvb-promo-flash">
        <div class="inner">
          <div class="box">
            <div class="left">
              <div class="badge">⚡ Flash Sale</div>
              <h2>GIẢM 30%</h2>
              <p>Toàn bộ sản phẩm — Chỉ trong hôm nay!</p>
              <div class="stock">🔥 Chỉ còn 47 sản phẩm</div>
            </div>
            <div class="right">
              <div class="price-orig">Giá gốc: 599.000đ</div>
              <div class="price-now">399.000đ</div>
              <a href="#" class="btn">Mua ngay →</a>
            </div>
          </div>
        </div>
      </section>
    `,
  },
  {
    id: "promo-gift",
    label: "🎁 Promo — Quà tặng kèm",
    category: "Sections",
    content: `
      <style>
        .pvb-promo-gift{padding:32px 16px;background:#fff}
        .pvb-promo-gift .inner{max-width:1100px;margin:0 auto}
        .pvb-promo-gift .box{background:#fff7ed;border:2px solid #fed7aa;border-radius:20px;padding:28px 20px;text-align:center}
        .pvb-promo-gift h2{font-size:clamp(18px,5vw,28px);font-weight:900;color:#9a3412;margin:0 0 6px}
        .pvb-promo-gift .sub{color:#c2410c;font-size:14px;margin:0 0 20px}
        .pvb-promo-gift .gifts{display:flex;justify-content:center;gap:12px;flex-wrap:wrap;margin-bottom:20px}
        .pvb-promo-gift .gift-item{background:#fff;border:1px solid #fed7aa;border-radius:14px;padding:12px 14px;min-width:90px;text-align:center}
        .pvb-promo-gift .gift-icon{font-size:28px;display:block;margin-bottom:4px}
        .pvb-promo-gift .gift-name{font-size:12px;font-weight:700;color:#9a3412}
        .pvb-promo-gift .gift-val{font-size:11px;color:#c2410c;text-decoration:line-through}
        .pvb-promo-gift .mystery{background:#f97316;color:#fff;border-radius:14px;padding:12px 14px;min-width:90px;text-align:center}
        .pvb-promo-gift .mystery .gift-icon{font-size:28px}
        .pvb-promo-gift .mystery .gift-name{color:#fff}
        .pvb-promo-gift .total{font-size:14px;color:#78350f;margin:0 0 16px}
        .pvb-promo-gift .total strong{color:#9a3412;font-size:16px}
        .pvb-promo-gift .btn{display:inline-flex;align-items:center;gap:8px;background:#ea580c;color:#fff;padding:13px 28px;border-radius:999px;font-weight:900;font-size:15px;text-decoration:none}
        @media(min-width:640px){.pvb-promo-gift{padding:40px 24px}.pvb-promo-gift .box{padding:36px}}
      </style>
      <section class="pvb-promo-gift">
        <div class="inner">
          <div class="box">
            <h2>🎁 Mua ngay — Nhận quà liền tay</h2>
            <p class="sub">Đặt hàng hôm nay, quà tặng kèm MIỄN PHÍ</p>
            <div class="gifts">
              <div class="gift-item">
                <span class="gift-icon">👜</span>
                <div class="gift-name">Túi vải</div>
                <div class="gift-val">89.000đ</div>
              </div>
              <div class="gift-item">
                <span class="gift-icon">📗</span>
                <div class="gift-name">Sách nấu ăn</div>
                <div class="gift-val">120.000đ</div>
              </div>
              <div class="gift-item">
                <span class="gift-icon">🧴</span>
                <div class="gift-name">Nước rửa chén</div>
                <div class="gift-val">49.000đ</div>
              </div>
              <div class="gift-item mystery">
                <span class="gift-icon">🎁</span>
                <div class="gift-name">Quà bí ẩn</div>
                <div class="gift-val" style="color:rgba(255,255,255,0.7)">???</div>
              </div>
            </div>
            <p class="total">Tổng giá trị quà tặng: <strong>258.000đ — MIỄN PHÍ</strong></p>
            <a href="#" class="btn">Đặt hàng ngay 🎁</a>
          </div>
        </div>
      </section>
    `,
  },
  {
    id: "promo-deal",
    label: "💰 Promo — Deal + Social Proof",
    category: "Sections",
    content: `
      <style>
        .pvb-promo-deal{padding:32px 16px;background:#fff}
        .pvb-promo-deal .inner{max-width:1100px;margin:0 auto}
        .pvb-promo-deal .box{border:2px solid #e5e7eb;border-radius:20px;overflow:hidden;background:#fff;box-shadow:0 4px 24px rgba(0,0,0,0.06)}
        .pvb-promo-deal .img-side{background:linear-gradient(135deg,#fff7ed,#fef3c7);display:flex;align-items:center;justify-content:center;padding:28px;min-height:200px}
        .pvb-promo-deal .img-side img{width:100%;max-width:240px;height:180px;object-fit:contain;border-radius:12px}
        .pvb-promo-deal .info-side{padding:24px 22px}
        .pvb-promo-deal .stars{color:#f97316;font-size:16px;margin-bottom:4px}
        .pvb-promo-deal .review-count{font-size:12px;color:#6b7280;margin:0 0 14px}
        .pvb-promo-deal .price-orig{font-size:14px;color:#9ca3af;text-decoration:line-through;margin:0 0 2px}
        .pvb-promo-deal .price-now{font-size:clamp(28px,7vw,38px);font-weight:900;color:#dc2626;margin:0 0 4px;line-height:1}
        .pvb-promo-deal .saving{display:inline-block;background:#dcfce7;color:#15803d;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700;margin-bottom:14px}
        .pvb-promo-deal .perks{display:flex;flex-direction:column;gap:6px;margin-bottom:18px}
        .pvb-promo-deal .perk{font-size:13px;color:#374151;display:flex;align-items:center;gap:6px}
        .pvb-promo-deal .perk::before{content:'✓';color:#16a34a;font-weight:900;flex-shrink:0}
        .pvb-promo-deal .btn{display:flex;align-items:center;justify-content:center;background:#dc2626;color:#fff;padding:13px;border-radius:12px;font-weight:900;font-size:15px;text-decoration:none;text-align:center}
        @media(min-width:640px){
          .pvb-promo-deal{padding:40px 24px}
          .pvb-promo-deal .box{display:flex}
          .pvb-promo-deal .img-side{width:40%;flex-shrink:0;min-height:280px}
          .pvb-promo-deal .info-side{flex:1;padding:32px 28px}
          .pvb-promo-deal .btn{width:auto;display:inline-flex;padding:13px 28px}
        }
      </style>
      <section class="pvb-promo-deal">
        <div class="inner">
          <div class="box">
            <div class="img-side">
              <img src="https://placehold.co/400x300/fff7ed/ea580c?text=Ảnh+Sản+phẩm" alt="Sản phẩm" />
            </div>
            <div class="info-side">
              <div class="stars">★★★★★</div>
              <p class="review-count">1.247 đánh giá 5 sao</p>
              <div class="price-orig">Giá gốc: 899.000đ</div>
              <div class="price-now">599.000đ</div>
              <span class="saving">Tiết kiệm 300.000đ 🏷️</span>
              <div class="perks">
                <div class="perk">Giao hàng trong 2 giờ (nội thành)</div>
                <div class="perk">Đổi trả miễn phí trong 30 ngày</div>
                <div class="perk">Bảo hành chính hãng 12 tháng</div>
              </div>
              <a href="#" class="btn">ĐẶT HÀNG NGAY</a>
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

// ─── Section tips ────────────────────────────────────────────────────────────
const SECTION_TIPS: Record<string, string[]> = {
  "pvb-rev2":  ["Bấm +5⭐ trên toolbar để thêm đánh giá", "Click vào card → 📷 để thêm/đổi ảnh review", "Double-click chữ để sửa nội dung"],
  "pvb-video": ["Double-click vào iframe để sửa src=", "YouTube: dùng dạng youtube.com/embed/VIDEO_ID", "Lấy VIDEO_ID từ link youtu.be/VIDEO_ID hoặc ?v=VIDEO_ID"],
  "pvb-tiktok": ["Dán link TikTok vào ô input → bấm 'Áp dụng' để load video", "Link dạng: tiktok.com/@user/video/1234567890", "Sau khi áp dụng nhớ bấm 'Lưu nội dung' để lưu lại"],
  "pvb-tkg":    ["Dán link TikTok vào ô Video 1/2/3 → bấm Áp dụng để cập nhật preview", "Trên storefront khách click vào card → popup fullscreen tự mở", "Chỉ nên dùng 1 block Gallery per trang"],
  "pvb-ps":    ["Double-click từng dòng để sửa Pain / Solution", "Thêm dòng mới bằng cách nhân đôi item"],
  "pvb-ben":   ["Double-click icon/tiêu đề/mô tả để sửa", "Đổi emoji icon trực tiếp trong ô chữ"],
  "pvb-spec":  ["Double-click ô tên / giá trị để sửa trực tiếp", "Bấm '＋ Thêm dòng mới' trong panel phải để thêm", "Click vào 1 dòng → bấm '－ Xóa dòng đang chọn' để xóa"],
  "pvb-faq":   ["Double-click câu hỏi/trả lời để sửa", "Nhân đôi 1 item để thêm câu hỏi mới"],
  "pvb-hero":  ["Double-click tiêu đề/mô tả để sửa text", "Double-click ảnh để đổi URL hình"],
  "pvb-itl":   ["Double-click ảnh trái để đổi URL hình", "Double-click text phải để sửa nội dung"],
  "pvb-itr":   ["Double-click text trái để sửa nội dung", "Double-click ảnh phải để đổi URL hình"],
  "pvb-how":   ["Double-click số/tiêu đề/mô tả để sửa", "Nhân đôi 1 bước để thêm bước mới"],
  "pvb-cmp":   ["Double-click ô trong bảng để sửa nội dung", "✓ và ✗ có thể đổi thành bất kỳ ký tự"],
  "pvb-promo": ["Double-click mã giảm giá để đổi mã", "Double-click tiêu đề/mô tả để sửa text"],
  "pvb-promo-flash": ["Double-click % giảm, giá gốc, giá mới để sửa", "Double-click số lượng còn lại để tạo urgency"],
  "pvb-promo-gift":  ["Double-click icon/tên/giá quà để sửa", "Nhân đôi gift-item để thêm quà mới"],
  "pvb-promo-deal":  ["Double-click ảnh sản phẩm để đổi URL hình", "Double-click giá, số đánh giá, perks để sửa"],
  "pvb-cd":    ["Double-click số giờ/phút/giây để đổi thời gian đếm ngược"],
  "pvb-trust": ["Double-click icon hoặc text để sửa từng badge", "Nhân đôi badge để thêm badge mới"],
  "pvb-gal":   ["Double-click từng ảnh để đổi URL hình", "Nhân đôi ô ảnh để thêm ảnh mới vào gallery"],
  "pvb-cta":   ["Double-click text nút để đổi nội dung", "Đổi màu nút trong Style panel bên phải GrapesJS"],
  "pvb-quote": ["Double-click để sửa nội dung trích dẫn"],
  "pvb-div":   ["Dùng để tạo khoảng cách giữa các section"],
}

// ─── Webcake-style sidebar ────────────────────────────────────────────────────
const CATEGORIES = [
  { id: "Sections",     icon: "⊞", label: "Sections" },
  { id: "Elements",     icon: "✦", label: "Elements" },
  { id: "Media",        icon: "🖼", label: "Media" },
  { id: "Social Proof", icon: "⭐", label: "Social" },
]

// Strip <script> tags from HTML string
function stripScripts(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
}

// Strip script components from GrapesJS projectData recursively
function stripScriptsFromProjectData(pd: any): any {
  if (!pd) return pd
  const walk = (comps: any[]): any[] => {
    if (!Array.isArray(comps)) return comps
    return comps
      .filter((c: any) => (c.tagName || "").toLowerCase() !== "script")
      .map((c: any) => ({ ...c, components: walk(c.components || []) }))
  }
  try {
    const clone = JSON.parse(JSON.stringify(pd))
    if (clone.pages) {
      clone.pages = clone.pages.map((page: any) => ({
        ...page,
        frames: (page.frames || []).map((frame: any) => ({
          ...frame,
          component: frame.component
            ? { ...frame.component, components: walk(frame.component.components || []) }
            : frame.component,
        })),
      }))
    }
    return clone
  } catch { return pd }
}

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
  const [selectedSection, setSelectedSection] = useState<{ label: string; isTopLevel: boolean; pvbClass: string } | null>(null)
  const [videoSlots, setVideoSlots] = useState<(string | null)[]>([null, null, null])
  const [videoUploading, setVideoUploading] = useState<boolean[]>([false, false, false])
  const [showVideoPanel, setShowVideoPanel] = useState(false)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const uploadingSlotRef = useRef<number>(-1)

  // Lắng nghe canvas gọi pvbTkgUpload → trigger file input thật trong React DOM
  useEffect(() => {
    const handler = (e: Event) => {
      const idx = (e as CustomEvent).detail?.idx ?? 0
      uploadingSlotRef.current = idx
      videoInputRef.current?.click()
    }
    window.addEventListener('pvb-tkg-upload-request', handler)
    return () => window.removeEventListener('pvb-tkg-upload-request', handler)
  }, [])

  const handleVideoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const idx = uploadingSlotRef.current
    e.target.value = '' // reset để có thể chọn lại file cũ

    setVideoUploading(prev => { const n = [...prev]; n[idx] = true; return n })
    try {
      const formData = new FormData()
      formData.append('files', file, file.name)
      const res = await fetch('/admin/uploads', { method: 'POST', credentials: 'include', body: formData })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const url: string = data.files?.[0]?.url || ''
      if (!url) throw new Error('No URL')
      setVideoSlots(prev => { const n = [...prev]; n[idx] = url; return n })
      // Cập nhật GrapesJS model + canvas preview
      ;(window as any).pvbTkgSetVideoUrl?.(idx, url, file.name)
    } catch (err: any) {
      alert('Upload lỗi: ' + err.message)
    } finally {
      setVideoUploading(prev => { const n = [...prev]; n[idx] = false; return n })
    }
  }

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
        allowScripts: 1,
        panels: { defaults: [] },
        styleManager: { appendTo: "#pvb-styles-panel" },
        traitManager: { appendTo: "#pvb-styles-panel" },
        selectorManager: { appendTo: "#pvb-styles-panel" },
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
            editor.loadProjectData(stripScriptsFromProjectData(saved.projectData))
          } else {
            // Old format: raw projectData JSON
            editor.loadProjectData(stripScriptsFromProjectData(saved))
          }
        } catch {
          editor.setComponents(stripScripts(initialContent))
        }
      }

      editorRef.current = editor

      // Theo dõi block pvb-tkg để hiện/ẩn video panel
      const checkTkg = () => {
        try {
          const hasTkg = !!editor.Canvas.getDocument()?.querySelector('.pvb-tkg')
          setShowVideoPanel(hasTkg)
        } catch {}
      }
      editor.on('component:add component:remove canvas:frame:load', checkTkg)
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

      // ── Video Gallery: upload mp4 lên Minio qua Medusa /admin/uploads ──────
      // Chạy trên parent frame để có auth token Medusa
      const findTkgCards = (comps: any): any[] => {
        let found: any[] = []
        comps.each((c: any) => {
          if (c.getClasses().includes('card') && c.parent()?.getClasses().includes('grid')) found.push(c)
          found = found.concat(findTkgCards(c.components()))
        })
        return found
      }

      // pvbTkgUpload: canvas iframe gọi → dispatch event lên React component
      // React component có <input type="file"> thật → không bị browser block
      ;(window as any).pvbTkgUpload = (idx: number) => {
        window.dispatchEvent(new CustomEvent('pvb-tkg-upload-request', { detail: { idx } }))
      }

      // Hàm cập nhật GrapesJS model sau khi upload xong (gọi từ React handler)
      ;(window as any).pvbTkgSetVideoUrl = (idx: number, url: string, filename: string) => {
        const cards = findTkgCards(editor.getComponents())
        if (cards[idx]) {
          cards[idx].addAttributes({ 'data-src': url })
          try {
            const doc = editor.Canvas.getDocument()
            const cardEl = cards[idx].getEl()
            if (cardEl && doc) {
              let vid = cardEl.querySelector('video') as HTMLVideoElement | null
              if (!vid) {
                vid = doc.createElement('video') as HTMLVideoElement
                vid.setAttribute('muted', '')
                vid.setAttribute('loop', '')
                vid.setAttribute('playsinline', '')
                vid.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover'
                cardEl.insertBefore(vid, cardEl.firstChild)
              }
              vid.src = url
              vid.load()
              const overlay = cardEl.querySelector('.overlay') as HTMLElement | null
              if (overlay) overlay.style.display = 'none'
            }
            // Cập nhật status text trong canvas
            const statusEl = doc?.getElementById(`tkg-s${idx}`)
            if (statusEl) statusEl.textContent = '✅ ' + filename
          } catch {}
        }
      }

      // Canvas inline functions — chỉ cần close popup, open từ event delegation
      const TIKTOK_GALLERY_JS = `
        (function(){
          if(window._pvbTkgInited) return;
          window._pvbTkgInited = true;
          window.pvbTkgClose = function(){
            var pop = document.getElementById('pvb-tkg-pop');
            var v = document.getElementById('pvb-tkg-video');
            if(v){ v.pause(); v.src = ''; }
            if(pop) pop.classList.remove('open');
          };
          // Event delegation: click card → mở popup
          document.addEventListener('click', function(e){
            var t = e.target;
            while(t && t !== document){
              if(t.classList && t.classList.contains('card') && t.closest && t.closest('.pvb-tkg')){
                var src = t.getAttribute('data-src');
                if(src){
                  var pop = document.getElementById('pvb-tkg-pop');
                  var v = document.getElementById('pvb-tkg-video');
                  if(v){ v.src = src; v.play(); }
                  if(pop) pop.classList.add('open');
                }
                return;
              }
              if(t.id === 'pvb-tkg-pop'){ window.pvbTkgClose(); return; }
              t = t.parentElement;
            }
          });
        })();
      `

      const injectTkgScript = () => {
        try {
          const doc = editor.Canvas.getDocument()
          if (!doc) return
          if (doc.querySelector('[data-tkg-init]')) return
          const sc = doc.createElement('script')
          sc.setAttribute('data-tkg-init', '1')
          sc.textContent = TIKTOK_GALLERY_JS
          doc.body.appendChild(sc)
        } catch {}
      }

      editor.on("canvas:frame:load", injectTkgScript)
      editor.on("component:add", () => setTimeout(injectTkgScript, 150))

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
        const inSpec = el.classList.contains("pvb-spec") || !!el.closest?.(".pvb-spec")
        if (!inRevSection && !inSpec) return

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

      // ── Spec row commands ─────────────────────────────────────────────────
      editor.Commands.add("pvb-spec-add-row", {
        run(ed: any) {
          // Find spec-table directly from wrapper — no reliance on current selection
          const tables = ed.getWrapper().find(".spec-table")
          if (!tables.length) return
          let target = tables[0]
          // If multiple spec sections, find the one closest to current selection
          if (tables.length > 1) {
            const sel = ed.getSelected()
            if (sel) {
              let c: any = sel
              for (let i = 0; i < 12; i++) {
                const el = c.getEl?.()
                if (el?.classList?.contains("spec-table")) { target = c; break }
                c = c.parent?.(); if (!c) break
              }
            }
          }
          target.append('<div class="spec-row"><div class="spec-key">Tên thông số</div><div class="spec-val">Giá trị</div></div>')
        },
      })
      editor.Commands.add("pvb-spec-del-row", {
        run(ed: any) {
          const sel = ed.getSelected()
          if (!sel) return
          const el = sel.getEl?.()
          // Must be a spec-row or inside one
          const isRow = el?.classList?.contains("spec-row")
          const inRow = el?.closest?.(".spec-row")
          if (!isRow && !inRow) return
          let rowComp: any = sel
          if (!isRow) {
            // walk up to spec-row
            let c: any = sel
            for (let i = 0; i < 4; i++) {
              if (c.getEl?.()?.classList?.contains("spec-row")) { rowComp = c; break }
              c = c.parent?.()
              if (!c) return
            }
          }
          rowComp.remove()
        },
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

      // ── Right panel: track selected section ──────────────────────────────
      editor.on("component:selected", (comp: any) => {
        const el = comp.getEl()
        if (!el) { setSelectedSection(null); return }
        // Walk up to find top-level section (direct child of wrapper)
        let topComp: any = comp
        while (topComp && topComp.parent() !== editor.getWrapper()) topComp = topComp.parent()
        const isTopLevel = !!topComp && topComp === comp
        // Guess label from pvb class
        const cls = (el.className || "") as string
        const pvbMatch = cls.match(/pvb-(\w+)/)
        const blockDef = blocks.find(b => {
          const bcls = b.content.match(/class="([^"]*pvb-\w+[^"]*)"/)
          if (!bcls) return false
          return pvbMatch && bcls[1].includes(pvbMatch[0])
        })
        const label = blockDef?.label ?? (pvbMatch ? pvbMatch[1] : "Section")
        // Find pvb-* class on element or closest ancestor
        const pvbClass = [...(el.classList || [])].find((c: string) => c.startsWith("pvb-"))
          ?? [...((el.closest?.("[class*='pvb-']") as HTMLElement | null)?.classList || [])].find((c: string) => c.startsWith("pvb-"))
          ?? ""
        setSelectedSection({ label, isTopLevel: !!topComp, pvbClass })
      })
      editor.on("component:deselected", () => setSelectedSection(null))
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
    const html = stripScripts(editor.getHtml())
    return JSON.stringify({
      html,
      css: editor.getCss(),
      projectData: stripScriptsFromProjectData(editor.getProjectData()),
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
      {/* Hidden file input cho video upload — React DOM, không qua iframe */}
      <input
        ref={videoInputRef}
        type="file"
        accept="video/mp4,video/mov,video/quicktime,video/*"
        style={{ display: "none" }}
        onChange={handleVideoFileChange}
      />


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

          {/* Right panel — always rendered so GrapesJS can mount style manager */}
          <div style={{
            width: 240, flexShrink: 0, height: "100%",
            borderLeft: "1px solid #e5e7eb", background: "#f9fafb",
            display: "flex", flexDirection: "column",
          }}>
          {selectedSection && (<div style={{ display: "contents" }}>
              {/* Header */}
              <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid #e5e7eb", background: "#fff" }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: "#f97316", textTransform: "uppercase", letterSpacing: "0.1em", margin: 0 }}>Section đang chọn</p>
                <p style={{ fontSize: 13, fontWeight: 800, color: "#111827", margin: "2px 0 0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {selectedSection.label}
                </p>
              </div>

              {/* Actions */}
              <div style={{ padding: "10px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 4px 2px" }}>Thao tác nhanh</p>

                {[
                  { icon: "↑", label: "Di chuyển lên", cmd: "pvb-move-up" },
                  { icon: "↓", label: "Di chuyển xuống", cmd: "pvb-move-down" },
                  { icon: "⧉", label: "Nhân đôi section", cmd: "core:copy" },
                  { icon: "✂", label: "Cắt section", cmd: "core:cut" },
                  { icon: "🗑", label: "Xóa section", cmd: "core:component-delete", danger: true },
                ].map(action => (
                  <button key={action.cmd}
                    onClick={() => editorRef.current?.runCommand(action.cmd)}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      width: "100%", padding: "8px 10px",
                      borderRadius: 8, border: `1px solid ${(action as any).danger ? "#fca5a5" : "#e5e7eb"}`,
                      background: (action as any).danger ? "#fff1f2" : "#fff",
                      color: (action as any).danger ? "#dc2626" : "#374151",
                      fontSize: 13, fontWeight: 600, cursor: "pointer", textAlign: "left",
                    }}
                  >
                    <span style={{ fontSize: 16, width: 20, textAlign: "center" }}>{action.icon}</span>
                    {action.label}
                  </button>
                ))}
              </div>

              {/* Video Gallery upload — right panel, React onClick trực tiếp (không qua iframe) */}
              {selectedSection.pvbClass === "pvb-tkg" && (
                <div style={{ padding: "0 10px 6px", display: "flex", flexDirection: "column", gap: 6 }}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 2px 2px" }}>📹 Upload video</p>
                  {[0, 1, 2].map(idx => (
                    <button
                      key={idx}
                      disabled={videoUploading[idx]}
                      onClick={() => { uploadingSlotRef.current = idx; videoInputRef.current?.click() }}
                      style={{
                        display: "flex", alignItems: "center", gap: 8, width: "100%",
                        padding: "9px 10px", borderRadius: 8,
                        border: videoSlots[idx] ? "1px solid #86efac" : "1px solid #e5e7eb",
                        background: videoSlots[idx] ? "#dcfce7" : "#fff",
                        color: videoUploading[idx] ? "#9ca3af" : videoSlots[idx] ? "#15803d" : "#374151",
                        fontSize: 12, fontWeight: 700, cursor: videoUploading[idx] ? "not-allowed" : "pointer",
                        opacity: videoUploading[idx] ? 0.7 : 1,
                      }}
                    >
                      <span style={{ fontSize: 14, width: 20, textAlign: "center" }}>
                        {videoUploading[idx] ? "⏳" : videoSlots[idx] ? "✅" : "↑"}
                      </span>
                      {videoUploading[idx] ? "Đang tải..." : videoSlots[idx] ? `Video ${idx + 1} đã up` : `Tải video ${idx + 1}`}
                    </button>
                  ))}
                </div>
              )}

              {/* Spec-specific row actions — always reliable via right panel */}
              {selectedSection.pvbClass === "pvb-spec" && (
                <div style={{ padding: "0 10px 6px", display: "flex", flexDirection: "column", gap: 6 }}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 2px 2px" }}>Thêm / Xóa dòng</p>
                  <button
                    onClick={() => editorRef.current?.runCommand("pvb-spec-add-row")}
                    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "9px 10px", borderRadius: 8, border: "1px solid #86efac", background: "#dcfce7", color: "#15803d", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                  >
                    <span style={{ fontSize: 16, width: 20, textAlign: "center" }}>＋</span>
                    Thêm dòng mới
                  </button>
                  <button
                    onClick={() => editorRef.current?.runCommand("pvb-spec-del-row")}
                    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "9px 10px", borderRadius: 8, border: "1px solid #fca5a5", background: "#fff1f2", color: "#dc2626", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                  >
                    <span style={{ fontSize: 16, width: 20, textAlign: "center" }}>－</span>
                    Xóa dòng đang chọn
                  </button>
                </div>
              )}

              {/* Keyboard shortcuts */}
              <div style={{ margin: "4px 10px 0", padding: "10px", background: "#fff", borderRadius: 8, border: "1px solid #e5e7eb" }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", margin: "0 0 6px" }}>Phím tắt</p>
                {[
                  ["Alt + ↑↓", "Di chuyển section"],
                  ["Del / Backspace", "Xóa section"],
                  ["Ctrl+Z", "Hoàn tác"],
                ].map(([key, desc]) => (
                  <div key={key} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, gap: 6 }}>
                    <code style={{ fontSize: 10, background: "#f3f4f6", padding: "2px 5px", borderRadius: 4, color: "#374151", whiteSpace: "nowrap" }}>{key}</code>
                    <span style={{ fontSize: 10, color: "#6b7280", textAlign: "right" }}>{desc}</span>
                  </div>
                ))}
              </div>

              {/* Section-specific tips */}
              {(() => {
                const tips = SECTION_TIPS[selectedSection.pvbClass] ?? []
                if (!tips.length) return null
                return (
                  <div style={{ margin: "8px 10px 10px", padding: 10, background: "#fffbeb", borderRadius: 8, border: "1px solid #fde68a" }}>
                    <p style={{ fontSize: 10, fontWeight: 700, color: "#92400e", textTransform: "uppercase", margin: "0 0 8px" }}>💡 Có thể làm gì?</p>
                    {tips.map((tip, i) => (
                      <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                        <span style={{ color: "#f59e0b", fontWeight: 900, flexShrink: 0, fontSize: 12 }}>•</span>
                        <span style={{ fontSize: 11, color: "#78350f", lineHeight: 1.5 }}>{tip}</span>
                      </div>
                    ))}
                  </div>
                )
              })()}

              {/* GrapesJS styles header */}
              <div style={{ borderTop: "1px solid #e5e7eb", marginTop: 4 }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", margin: "10px 14px 6px", letterSpacing: "0.08em" }}>Style</p>
              </div>
            </div>)}

            {/* GrapesJS Style/Selector/Trait managers — always in DOM */}
            <div id="pvb-styles-panel" style={{ flex: 1, overflowY: "auto", minHeight: 0 }} />
          </div>
        </div>
      </div>
    </div>
  )
}
