import { useEffect, useRef, useState } from "react"

// Helper to get route param without react-router-dom import
const usePageId = () => {
  const parts = window.location.pathname.split("/")
  // path: /app/pages/:id/edit  → parts[-2] = id
  const editIdx = parts.indexOf("edit")
  return editIdx > 0 ? parts[editIdx - 1] : ""
}

const PageEditorPage = () => {
  const id = usePageId()
  const editorRef = useRef<any>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [page, setPage] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [editorReady, setEditorReady] = useState(false)

  // Load page data
  useEffect(() => {
    fetch(`/admin/pages/${id}`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setPage(data.page))
  }, [id])

  // Init GrapesJS after page loads
  useEffect(() => {
    if (!page || !containerRef.current || editorRef.current) return

    const script = document.createElement("script")
    script.src = "https://unpkg.com/grapesjs@0.21.7/dist/grapes.min.js"
    script.onload = () => {
      const link = document.createElement("link")
      link.rel = "stylesheet"
      link.href = "https://unpkg.com/grapesjs@0.21.7/dist/css/grapes.min.css"
      document.head.appendChild(link)

      const grapesjs = (window as any).grapesjs
      const editor = grapesjs.init({
        container: containerRef.current,
        height: "calc(100vh - 120px)",
        storageManager: false,
        plugins: [],
        blockManager: {
          appendTo: "#blocks-panel",
          blocks: [
            {
              id: "hero-banner",
              label: "🖼️ Hero Banner",
              category: "Sections",
              content: `<section style="background:linear-gradient(135deg,#1A1AE8,#003399);color:white;padding:80px 40px;text-align:center">
                <h1 style="font-size:3rem;font-weight:900;margin-bottom:16px">Tiêu đề chính</h1>
                <p style="font-size:1.2rem;margin-bottom:32px;opacity:0.9">Mô tả ngắn gọn về sản phẩm hoặc chương trình</p>
                <a href="/store" style="background:#E8420A;color:white;padding:16px 40px;border-radius:8px;font-weight:700;text-decoration:none;font-size:1.1rem">Mua ngay</a>
              </section>`,
            },
            {
              id: "product-highlight",
              label: "⭐ Điểm nổi bật",
              category: "Sections",
              content: `<section style="padding:60px 40px;background:#f8f9fa">
                <h2 style="text-align:center;font-size:2rem;font-weight:800;margin-bottom:40px">Tại sao chọn chúng tôi?</h2>
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;max-width:1000px;margin:0 auto">
                  <div style="background:white;padding:32px;border-radius:12px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
                    <div style="font-size:2.5rem;margin-bottom:12px">✅</div>
                    <h3 style="font-weight:700;margin-bottom:8px">Chính hãng 100%</h3>
                    <p style="color:#666;font-size:0.9rem">Cam kết nguồn gốc rõ ràng</p>
                  </div>
                  <div style="background:white;padding:32px;border-radius:12px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
                    <div style="font-size:2.5rem;margin-bottom:12px">🚚</div>
                    <h3 style="font-weight:700;margin-bottom:8px">Giao hàng nhanh</h3>
                    <p style="color:#666;font-size:0.9rem">Miễn phí từ 500.000đ</p>
                  </div>
                  <div style="background:white;padding:32px;border-radius:12px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
                    <div style="font-size:2.5rem;margin-bottom:12px">🔄</div>
                    <h3 style="font-weight:700;margin-bottom:8px">Đổi trả dễ dàng</h3>
                    <p style="color:#666;font-size:0.9rem">7 ngày không cần lý do</p>
                  </div>
                </div>
              </section>`,
            },
            {
              id: "promo-banner",
              label: "🎯 Banner Khuyến mãi",
              category: "Sections",
              content: `<section style="background:#E8420A;color:white;padding:60px 40px;text-align:center">
                <h2 style="font-size:2.5rem;font-weight:900;text-transform:uppercase;margin-bottom:12px">SIÊU ƯU ĐÃI</h2>
                <p style="font-size:1.2rem;margin-bottom:8px">Giảm ngay <strong>20%</strong> khi nhập mã</p>
                <div style="background:rgba(255,255,255,0.2);display:inline-block;padding:8px 24px;border-radius:8px;font-size:1.5rem;font-weight:900;letter-spacing:4px;margin-bottom:24px">PHANVIET20</div>
                <br/>
                <a href="/store" style="background:white;color:#E8420A;padding:14px 36px;border-radius:8px;font-weight:700;text-decoration:none">Mua ngay</a>
              </section>`,
            },
            {
              id: "image-text",
              label: "📝 Ảnh + Nội dung",
              category: "Sections",
              content: `<section style="padding:60px 40px;display:flex;gap:40px;align-items:center;max-width:1200px;margin:0 auto">
                <img src="https://placehold.co/500x400" style="width:50%;border-radius:12px" alt="Product"/>
                <div style="flex:1">
                  <h2 style="font-size:2rem;font-weight:800;margin-bottom:16px">Tiêu đề sản phẩm</h2>
                  <p style="color:#555;line-height:1.8;margin-bottom:24px">Mô tả chi tiết về sản phẩm, tính năng, lợi ích mang lại cho người dùng...</p>
                  <ul style="list-style:none;padding:0;margin-bottom:32px">
                    <li style="padding:8px 0;border-bottom:1px solid #eee">✅ Tính năng 1</li>
                    <li style="padding:8px 0;border-bottom:1px solid #eee">✅ Tính năng 2</li>
                    <li style="padding:8px 0">✅ Tính năng 3</li>
                  </ul>
                  <a href="/store" style="background:#E8420A;color:white;padding:14px 32px;border-radius:8px;font-weight:700;text-decoration:none">Xem sản phẩm</a>
                </div>
              </section>`,
            },
            {
              id: "testimonials",
              label: "💬 Đánh giá khách hàng",
              category: "Sections",
              content: `<section style="padding:60px 40px;background:#f8f9fa">
                <h2 style="text-align:center;font-size:2rem;font-weight:800;margin-bottom:40px">Khách hàng nói gì?</h2>
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;max-width:1000px;margin:0 auto">
                  <div style="background:white;padding:24px;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
                    <div style="color:#f59e0b;margin-bottom:8px">★★★★★</div>
                    <p style="color:#555;font-style:italic;margin-bottom:16px">"Sản phẩm rất tốt, giao hàng nhanh, đóng gói cẩn thận!"</p>
                    <strong>Nguyễn Thị A</strong>
                  </div>
                  <div style="background:white;padding:24px;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
                    <div style="color:#f59e0b;margin-bottom:8px">★★★★★</div>
                    <p style="color:#555;font-style:italic;margin-bottom:16px">"Chất lượng vượt mong đợi, sẽ mua lại lần sau!"</p>
                    <strong>Trần Văn B</strong>
                  </div>
                  <div style="background:white;padding:24px;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
                    <div style="color:#f59e0b;margin-bottom:8px">★★★★★</div>
                    <p style="color:#555;font-style:italic;margin-bottom:16px">"Dịch vụ hỗ trợ nhiệt tình, sản phẩm đúng mô tả!"</p>
                    <strong>Lê Thị C</strong>
                  </div>
                </div>
              </section>`,
            },
            {
              id: "cta-button",
              label: "🔘 Nút CTA",
              category: "Elements",
              content: `<div style="text-align:center;padding:24px">
                <a href="/store" style="background:#E8420A;color:white;padding:16px 48px;border-radius:8px;font-weight:700;text-decoration:none;font-size:1.1rem;display:inline-block">Mua ngay</a>
              </div>`,
            },
            {
              id: "countdown",
              label: "⏱️ Đếm ngược",
              category: "Elements",
              content: `<div style="background:#1A1AE8;color:white;padding:32px;text-align:center;border-radius:12px">
                <p style="font-size:1.1rem;margin-bottom:16px;font-weight:600">⚡ Ưu đãi kết thúc sau</p>
                <div style="display:flex;justify-content:center;gap:16px">
                  <div style="background:rgba(255,255,255,0.2);padding:16px 24px;border-radius:8px">
                    <div style="font-size:2.5rem;font-weight:900">02</div>
                    <div style="font-size:0.8rem">Giờ</div>
                  </div>
                  <div style="background:rgba(255,255,255,0.2);padding:16px 24px;border-radius:8px">
                    <div style="font-size:2.5rem;font-weight:900">45</div>
                    <div style="font-size:0.8rem">Phút</div>
                  </div>
                  <div style="background:rgba(255,255,255,0.2);padding:16px 24px;border-radius:8px">
                    <div style="font-size:2.5rem;font-weight:900">30</div>
                    <div style="font-size:0.8rem">Giây</div>
                  </div>
                </div>
              </div>`,
            },
          ],
        },
      })

      // Load saved content
      if (page.content && page.content !== "{}") {
        try {
          const saved = JSON.parse(page.content)
          editor.loadProjectData(saved)
        } catch (e) {
          editor.setComponents(page.content)
        }
      }

      editorRef.current = editor
      setEditorReady(true)
    }
    document.head.appendChild(script)

    return () => {
      editorRef.current?.destroy()
      editorRef.current = null
    }
  }, [page])

  const savePage = async (publish = false) => {
    if (!editorRef.current) return
    setSaving(true)

    const content = JSON.stringify(editorRef.current.getProjectData())
    const status = publish ? "published" : "draft"

    await fetch(`/admin/pages/${id}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, status }),
    })

    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  // Auto-save every 30 seconds
  useEffect(() => {
    if (!editorReady) return
    const interval = setInterval(() => savePage(false), 30000)
    return () => clearInterval(interval)
  }, [editorReady])

  return (
    <div className="flex flex-col h-screen">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 shadow-sm">
        <div className="flex items-center gap-3">
          <a href="/app/pages" className="text-gray-500 hover:text-gray-700 text-sm">
            ← Quay lại
          </a>
          <span className="text-gray-300">|</span>
          <span className="font-semibold text-gray-800">{page?.title}</span>
          <code className="text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-500">
            /p/{page?.slug}
          </code>
        </div>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="text-green-600 text-sm font-medium">✓ Đã lưu</span>
          )}
          <button
            onClick={() => savePage(false)}
            disabled={saving}
            className="border border-gray-300 px-4 py-1.5 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            {saving ? "Đang lưu..." : "Lưu nháp"}
          </button>
          <button
            onClick={() => savePage(true)}
            disabled={saving}
            className="bg-orange-500 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-orange-600 disabled:opacity-50"
          >
            Xuất bản
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex flex-1 overflow-hidden">
        {/* Blocks panel */}
        <div
          id="blocks-panel"
          className="w-56 bg-gray-50 border-r border-gray-200 overflow-y-auto"
          style={{ minWidth: "220px" }}
        />
        {/* Canvas */}
        <div ref={containerRef} className="flex-1" />
      </div>
    </div>
  )
}

export default PageEditorPage
