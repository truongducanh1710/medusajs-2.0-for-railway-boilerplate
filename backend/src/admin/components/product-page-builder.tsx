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
          editor.loadProjectData(saved)
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
      const content = JSON.stringify(editorRef.current.getProjectData())
      await onSave(content)
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
