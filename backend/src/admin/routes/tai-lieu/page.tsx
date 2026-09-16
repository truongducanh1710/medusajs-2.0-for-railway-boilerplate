import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useEffect, useMemo, useState } from "react"
import { apiFetch } from "../../lib/api-client"
import { withRouteGuard } from "../../components/route-guard"
import { ROLE_PRESETS } from "../../lib/permissions"

/**
 * Tài liệu — "ổ đĩa" nội bộ của công ty.
 *
 * Chứa chung hai loại: file upload (hợp đồng, báo giá, biểu mẫu) và link artifact
 * (bản duyệt thiết kế, báo cáo Claude tạo). Gộp chung vì người dùng đi tìm "tài liệu
 * về phí vận chuyển" chứ không đi tìm "file hay link".
 *
 * Trang mở cho mọi người đăng nhập; phân quyền nằm ở TỪNG THƯ MỤC (view_roles /
 * edit_roles) và được backend kiểm tra — UI chỉ ẩn nút cho đỡ rối, không phải hàng rào.
 */

type Folder = {
  id: string
  ten: string
  parent_id: string | null
  mo_ta: string
  view_roles: string[]
  edit_roles: string[]
  so_tai_lieu: number
  duoc_sua: boolean
}

type Item = {
  id: string
  folder_id: string
  kind: "file" | "artifact"
  tieu_de: string
  mo_ta: string
  url: string
  file_name: string
  file_type: string
  file_size: number
  tags: string[]
  created_by: string
  created_at: string
  folder_ten: string
  duoc_sua: boolean
}

const DANH_SACH_ROLE = Object.keys(ROLE_PRESETS).filter(r => r !== "ai-agent")

const TEN_ROLE: Record<string, string> = {
  admin: "Quản trị",
  manager: "Quản lý",
  marketing: "Marketing",
  "mua-hang": "Mua hàng",
  sale: "Sale",
  cskh: "CSKH",
  ketoan: "Kế toán",
  "kho-van": "Kho vận",
}

function kichThuoc(n: number) {
  if (!n) return ""
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function ngay(iso: string) {
  if (!iso) return ""
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`
}

// Biểu tượng theo đuôi file — chỉ để quét mắt cho nhanh, không mang thông tin nào khác.
function bieuTuong(it: Item) {
  if (it.kind === "artifact") return "🔗"
  const t = (it.file_type || "").toLowerCase()
  const n = (it.file_name || "").toLowerCase()
  if (t.includes("pdf")) return "📕"
  if (t.includes("sheet") || n.endsWith(".xlsx") || n.endsWith(".csv")) return "📗"
  if (t.includes("word") || n.endsWith(".docx")) return "📘"
  if (t.includes("presentation") || n.endsWith(".pptx")) return "📙"
  if (t.startsWith("image/")) return "🖼️"
  if (t.includes("zip")) return "🗜️"
  return "📄"
}

const TaiLieuPage = () => {
  const [folders, setFolders] = useState<Folder[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [me, setMe] = useState<{ email: string; role: string; quan_tri: boolean } | null>(null)
  const [folderDangChon, setFolderDangChon] = useState<string | null>(null)
  const [tuKhoa, setTuKhoa] = useState("")
  const [loading, setLoading] = useState(true)
  const [loi, setLoi] = useState("")

  // modal
  const [moThuMuc, setMoThuMuc] = useState(false)
  const [moLink, setMoLink] = useState(false)
  const [dangUpload, setDangUpload] = useState(false)
  const [suaThuMuc, setSuaThuMuc] = useState<Folder | null>(null)

  async function taiFolders() {
    const r = await apiFetch("/admin/tai-lieu/folders")
    const d = await r.json()
    if (d.error) { setLoi(d.error); return }
    setFolders(d.folders ?? [])
    setMe(d.me ?? null)
  }

  async function taiItems() {
    const p = new URLSearchParams()
    if (folderDangChon) p.set("folder_id", folderDangChon)
    if (tuKhoa.trim()) p.set("q", tuKhoa.trim())
    const r = await apiFetch(`/admin/tai-lieu/items?${p.toString()}`)
    const d = await r.json()
    if (d.error) { setLoi(d.error); return }
    setItems(d.items ?? [])
  }

  useEffect(() => {
    setLoading(true)
    taiFolders().finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    taiItems()
  }, [folderDangChon, tuKhoa])

  const folderHienTai = useMemo(
    () => folders.find(f => f.id === folderDangChon) ?? null,
    [folders, folderDangChon]
  )

  // Chỉ cho thêm tài liệu khi ĐANG ĐỨNG trong một thư mục — tránh tình huống người dùng
  // upload xong mà không biết file rơi vào đâu.
  const themDuoc = !!folderHienTai && folderHienTai.duoc_sua

  async function taoThuMuc(ten: string, moTa: string, viewRoles: string[], editRoles: string[]) {
    const r = await apiFetch("/admin/tai-lieu/folders", {
      method: "POST",
      body: JSON.stringify({ ten, mo_ta: moTa, view_roles: viewRoles, edit_roles: editRoles }),
    })
    const d = await r.json()
    if (d.error) { alert(d.error); return }
    setMoThuMuc(false)
    await taiFolders()
  }

  async function luuThuMuc(f: Folder, ten: string, moTa: string, viewRoles: string[], editRoles: string[]) {
    const r = await apiFetch(`/admin/tai-lieu/folders/${f.id}`, {
      method: "PATCH",
      body: JSON.stringify({ ten, mo_ta: moTa, view_roles: viewRoles, edit_roles: editRoles }),
    })
    const d = await r.json()
    if (d.error) { alert(d.error); return }
    setSuaThuMuc(null)
    await taiFolders()
  }

  async function xoaThuMuc(f: Folder) {
    if (!confirm(`Xoá thư mục "${f.ten}"?`)) return
    const r = await apiFetch(`/admin/tai-lieu/folders/${f.id}`, { method: "DELETE" })
    const d = await r.json()
    if (d.error) { alert(d.error); return }
    if (folderDangChon === f.id) setFolderDangChon(null)
    await taiFolders()
  }

  async function themLink(tieuDe: string, url: string, moTa: string) {
    const r = await apiFetch("/admin/tai-lieu/items", {
      method: "POST",
      body: JSON.stringify({ folder_id: folderDangChon, tieu_de: tieuDe, url, mo_ta: moTa }),
    })
    const d = await r.json()
    if (d.error) { alert(d.error); return }
    setMoLink(false)
    await Promise.all([taiItems(), taiFolders()])
  }

  async function uploadFile(file: File) {
    if (!folderDangChon) return
    setDangUpload(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("folder_id", folderDangChon)
      // Không set Content-Type — trình duyệt tự thêm boundary cho multipart.
      const r = await fetch("/admin/tai-lieu/upload", {
        method: "POST", body: fd, credentials: "include",
      })
      const d = await r.json()
      if (d.error) { alert(d.error); return }
      await Promise.all([taiItems(), taiFolders()])
    } catch (e: any) {
      alert(`Upload thất bại: ${e.message}`)
    } finally {
      setDangUpload(false)
    }
  }

  async function xoaItem(it: Item) {
    if (!confirm(`Xoá "${it.tieu_de}"?`)) return
    const r = await apiFetch(`/admin/tai-lieu/items/${it.id}`, { method: "DELETE" })
    const d = await r.json()
    if (d.error) { alert(d.error); return }
    await Promise.all([taiItems(), taiFolders()])
  }

  if (loading) return <div className="p-6 text-center text-gray-400">Đang tải…</div>

  return (
    <div className="p-3 sm:p-6 max-w-7xl">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Tài liệu</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Kho tài liệu nội bộ — file công ty và báo cáo. Quyền xem đặt theo từng thư mục.
        </p>
      </div>

      {loi && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          {loi}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-5">
        {/* Cột thư mục */}
        <div className="bg-white border rounded-xl shadow-sm overflow-hidden h-fit">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <span className="font-semibold text-gray-700 text-sm">Thư mục</span>
            {me?.quan_tri && (
              <button onClick={() => setMoThuMuc(true)}
                className="text-xs text-violet-600 hover:text-violet-700 font-medium">
                + Thêm
              </button>
            )}
          </div>
          <div className="divide-y">
            <button onClick={() => setFolderDangChon(null)}
              className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 ${
                folderDangChon === null ? "bg-violet-50 text-violet-700 font-medium" : "text-gray-700"
              }`}>
              Tất cả tài liệu
            </button>
            {folders.map(f => (
              <div key={f.id} className="group relative">
                <button onClick={() => setFolderDangChon(f.id)}
                  className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 ${
                    folderDangChon === f.id ? "bg-violet-50 text-violet-700 font-medium" : "text-gray-700"
                  }`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">📁 {f.ten}</span>
                    <span className="text-xs text-gray-400 flex-shrink-0">{f.so_tai_lieu}</span>
                  </div>
                  {f.view_roles?.length > 0 && (
                    <div className="text-[11px] text-gray-400 mt-0.5 truncate">
                      {f.view_roles.map(r => TEN_ROLE[r] ?? r).join(", ")}
                    </div>
                  )}
                </button>
                {me?.quan_tri && (
                  <div className="absolute right-2 top-2 hidden group-hover:flex gap-1">
                    <button onClick={() => setSuaThuMuc(f)} title="Sửa"
                      className="text-xs px-1.5 py-0.5 bg-white border rounded hover:bg-gray-50">✏️</button>
                    <button onClick={() => xoaThuMuc(f)} title="Xoá"
                      className="text-xs px-1.5 py-0.5 bg-white border rounded hover:bg-red-50">🗑️</button>
                  </div>
                )}
              </div>
            ))}
            {folders.length === 0 && (
              <div className="px-4 py-6 text-sm text-gray-400 text-center">
                {me?.quan_tri ? "Chưa có thư mục nào. Bấm “+ Thêm” để tạo." : "Chưa có thư mục nào bạn được xem."}
              </div>
            )}
          </div>
        </div>

        {/* Cột nội dung */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <input value={tuKhoa} onChange={e => setTuKhoa(e.target.value)}
              placeholder="Tìm theo tên tài liệu…"
              className="flex-1 min-w-[200px] border rounded-lg px-3 py-2 text-sm" />
            {themDuoc && (
              <>
                <label className={`px-3 py-2 rounded-lg text-sm font-medium cursor-pointer ${
                  dangUpload ? "bg-gray-100 text-gray-400" : "bg-violet-600 text-white hover:bg-violet-700"
                }`}>
                  {dangUpload ? "Đang tải lên…" : "↑ Tải file lên"}
                  <input type="file" className="hidden" disabled={dangUpload}
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = "" }} />
                </label>
                <button onClick={() => setMoLink(true)}
                  className="px-3 py-2 border rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
                  + Thêm link
                </button>
              </>
            )}
          </div>

          {folderHienTai && !folderHienTai.duoc_sua && (
            <div className="bg-gray-50 border text-gray-500 text-xs rounded-lg px-3 py-2">
              Bạn xem được thư mục này nhưng không thêm/xoá được tài liệu.
            </div>
          )}
          {!folderHienTai && folders.length > 0 && (
            <div className="bg-gray-50 border text-gray-500 text-xs rounded-lg px-3 py-2">
              Chọn một thư mục ở cột bên trái để thêm tài liệu.
            </div>
          )}

          {/* Danh sách */}
          <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
            {items.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-gray-400">
                {tuKhoa ? "Không tìm thấy tài liệu nào." : "Thư mục này chưa có tài liệu."}
              </div>
            ) : (
              <div className="divide-y">
                {items.map(it => (
                  <div key={it.id} className="px-4 py-3 flex items-start gap-3 hover:bg-gray-50">
                    <span className="text-xl flex-shrink-0 mt-0.5">{bieuTuong(it)}</span>
                    <div className="flex-1 min-w-0">
                      <a href={it.url} target="_blank" rel="noreferrer"
                        className="font-medium text-gray-900 hover:text-violet-600 break-words">
                        {it.tieu_de}
                      </a>
                      {it.mo_ta && <div className="text-sm text-gray-500 mt-0.5">{it.mo_ta}</div>}
                      <div className="text-xs text-gray-400 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                        {!folderDangChon && it.folder_ten && <span>📁 {it.folder_ten}</span>}
                        <span>{it.kind === "artifact" ? "Link" : kichThuoc(it.file_size)}</span>
                        <span>{it.created_by}</span>
                        <span>{ngay(it.created_at)}</span>
                      </div>
                    </div>
                    {it.duoc_sua && (
                      <button onClick={() => xoaItem(it)} title="Xoá"
                        className="text-gray-300 hover:text-red-500 flex-shrink-0 px-1">🗑️</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {(moThuMuc || suaThuMuc) && (
        <FormThuMuc
          folder={suaThuMuc}
          onClose={() => { setMoThuMuc(false); setSuaThuMuc(null) }}
          onSave={(ten, moTa, v, e) =>
            suaThuMuc ? luuThuMuc(suaThuMuc, ten, moTa, v, e) : taoThuMuc(ten, moTa, v, e)}
        />
      )}
      {moLink && <FormLink onClose={() => setMoLink(false)} onSave={themLink} />}
    </div>
  )
}

// ---- Form thư mục (tạo + sửa) ----
function FormThuMuc({ folder, onClose, onSave }: {
  folder: Folder | null
  onClose: () => void
  onSave: (ten: string, moTa: string, viewRoles: string[], editRoles: string[]) => void
}) {
  const [ten, setTen] = useState(folder?.ten ?? "")
  const [moTa, setMoTa] = useState(folder?.mo_ta ?? "")
  const [viewRoles, setViewRoles] = useState<string[]>(folder?.view_roles ?? [])
  const [editRoles, setEditRoles] = useState<string[]>(folder?.edit_roles ?? [])

  const bat = (ds: string[], set: (v: string[]) => void, r: string) =>
    set(ds.includes(r) ? ds.filter(x => x !== r) : [...ds, r])

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b font-semibold text-gray-800">
          {folder ? "Sửa thư mục" : "Thư mục mới"}
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tên thư mục</label>
            <input value={ten} onChange={e => setTen(e.target.value)} autoFocus
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="VD: Hợp đồng nhà cung cấp" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mô tả</label>
            <input value={moTa} onChange={e => setMoTa(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="Không bắt buộc" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Ai được xem</label>
            <p className="text-xs text-gray-400 mb-2">Không chọn gì = mọi người đăng nhập đều xem được.</p>
            <div className="flex flex-wrap gap-1.5">
              {DANH_SACH_ROLE.map(r => (
                <button key={r} onClick={() => bat(viewRoles, setViewRoles, r)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
                    viewRoles.includes(r)
                      ? "bg-violet-100 border-violet-300 text-violet-700"
                      : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"
                  }`}>
                  {TEN_ROLE[r] ?? r}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Ai được thêm / xoá tài liệu</label>
            <p className="text-xs text-gray-400 mb-2">Không chọn gì = chỉ quản trị tài liệu.</p>
            <div className="flex flex-wrap gap-1.5">
              {DANH_SACH_ROLE.map(r => (
                <button key={r} onClick={() => bat(editRoles, setEditRoles, r)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
                    editRoles.includes(r)
                      ? "bg-amber-100 border-amber-300 text-amber-700"
                      : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"
                  }`}>
                  {TEN_ROLE[r] ?? r}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="px-5 py-4 border-t flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg">
            Huỷ
          </button>
          <button onClick={() => ten.trim() && onSave(ten.trim(), moTa, viewRoles, editRoles)}
            disabled={!ten.trim()}
            className="px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:bg-gray-200 disabled:text-gray-400">
            Lưu
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- Form thêm link ----
function FormLink({ onClose, onSave }: {
  onClose: () => void
  onSave: (tieuDe: string, url: string, moTa: string) => void
}) {
  const [tieuDe, setTieuDe] = useState("")
  const [url, setUrl] = useState("")
  const [moTa, setMoTa] = useState("")
  const hopLe = tieuDe.trim() && /^https?:\/\//i.test(url.trim())

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b font-semibold text-gray-800">Thêm link tài liệu</div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tiêu đề</label>
            <input value={tieuDe} onChange={e => setTieuDe(e.target.value)} autoFocus
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="VD: Báo cáo phí vận chuyển T9/2026" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Link</label>
            <input value={url} onChange={e => setUrl(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono text-xs"
              placeholder="https://…" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mô tả</label>
            <input value={moTa} onChange={e => setMoTa(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="Không bắt buộc" />
          </div>
        </div>
        <div className="px-5 py-4 border-t flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg">
            Huỷ
          </button>
          <button onClick={() => hopLe && onSave(tieuDe.trim(), url.trim(), moTa)}
            disabled={!hopLe}
            className="px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:bg-gray-200 disabled:text-gray-400">
            Thêm
          </button>
        </div>
      </div>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Tài liệu", rank: 7,
})

export default withRouteGuard(TaiLieuPage)
