import { useEffect, useState } from "react"

const PagesListPage = () => {
  const [pages, setPages] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newTitle, setNewTitle] = useState("")
  const [newSlug, setNewSlug] = useState("")

  const fetchPages = async () => {
    try {
      const res = await fetch("/admin/pages", { credentials: "include" })
      const data = await res.json()
      setPages(data.pages || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchPages() }, [])

  const createPage = async () => {
    if (!newTitle || !newSlug) return
    await fetch("/admin/pages", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle, slug: newSlug }),
    })
    setNewTitle("")
    setNewSlug("")
    setShowCreate(false)
    fetchPages()
  }

  const deletePage = async (id: string) => {
    if (!confirm("Xóa trang này?")) return
    await fetch(`/admin/pages/${id}`, { method: "DELETE", credentials: "include" })
    fetchPages()
  }

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold">Quản lý trang</h1>
          <p className="text-gray-500 text-sm mt-1">Tạo và chỉnh sửa landing pages với Page Builder</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-orange-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-orange-600 transition-colors"
        >
          + Tạo trang mới
        </button>
      </div>

      {showCreate && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6 shadow-sm">
          <h3 className="font-semibold mb-4">Tạo trang mới</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Tiêu đề trang</label>
              <input
                className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:ring-2 focus:ring-orange-400 outline-none"
                placeholder="VD: Khuyến mãi mùa hè"
                value={newTitle}
                onChange={(e) => {
                  setNewTitle(e.target.value)
                  setNewSlug(e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""))
                }}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Slug (URL)</label>
              <input
                className="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:ring-2 focus:ring-orange-400 outline-none"
                placeholder="khuyen-mai-mua-he"
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={createPage}
              className="bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-orange-600"
            >
              Tạo trang
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="border border-gray-300 px-4 py-2 rounded-lg text-sm hover:bg-gray-50"
            >
              Hủy
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-400">Đang tải...</div>
      ) : pages.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg mb-2">Chưa có trang nào</p>
          <p className="text-sm">Tạo trang mới để bắt đầu thiết kế với Page Builder</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-600">Tiêu đề</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-600">Slug</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-600">Trạng thái</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-600">Cập nhật</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pages.map((page) => (
                <tr key={page.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">{page.title}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    <code className="bg-gray-100 px-2 py-0.5 rounded">/p/{page.slug}</code>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-xs font-bold px-2 py-1 rounded-full ${
                      page.status === "published"
                        ? "bg-green-100 text-green-700"
                        : "bg-yellow-100 text-yellow-700"
                    }`}>
                      {page.status === "published" ? "Đã xuất bản" : "Nháp"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-400">
                    {new Date(page.updated_at).toLocaleDateString("vi-VN")}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex gap-2 justify-end">
                      <a
                        href={`/app/pages/${page.id}/edit`}
                        className="text-sm text-orange-500 hover:underline font-medium"
                      >
                        Chỉnh sửa
                      </a>
                      <button
                        onClick={() => deletePage(page.id)}
                        className="text-sm text-red-400 hover:underline"
                      >
                        Xóa
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export const config = {
  label: "Trang & Landing Page",
}

export default PagesListPage
