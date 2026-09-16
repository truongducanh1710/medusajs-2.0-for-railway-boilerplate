import { getPool } from "../../../lib/db"
import { Modules } from "@medusajs/framework/utils"
import { resolveUserPerms } from "../../middlewares"

/**
 * Thư viện tài liệu nội bộ — "ổ đĩa" của công ty.
 *
 * Chứa hai loại mục trong CÙNG một thư mục:
 *   - kind='file'     : file thật upload lên MinIO (hợp đồng, báo giá, biểu mẫu…)
 *   - kind='artifact' : link tới trang artifact Claude tạo (bản duyệt thiết kế, báo cáo…)
 *
 * Gộp chung là CỐ Ý: người dùng đi tìm "tài liệu về phí vận chuyển" chứ không đi tìm
 * "file hay link". Phân biệt bằng nhãn khi hiển thị, không tách trang.
 *
 * PHÂN QUYỀN theo thư mục, không theo từng file: mỗi thư mục khai danh sách role
 * được xem (view_roles) và role được sửa (edit_roles). Mảng rỗng = mọi người đăng
 * nhập đều được. Người có `page.tai-lieu.manage` luôn đi qua được mọi thư mục —
 * nếu không sẽ có nguy cơ tạo ra thư mục không ai vào sửa được nữa.
 */

export const QUYEN_QUAN_TRI = "page.tai-lieu.manage"

// Loại file cho phép upload. Cố tình KHÔNG nhận .exe/.bat/.sh và các định dạng thực thi.
export const LOAI_CHO_PHEP = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain", "text/csv", "text/markdown",
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "application/zip", "application/x-zip-compressed",
])

export const KICH_THUOC_TOI_DA = 50 * 1024 * 1024 // 50MB

let _daTaoBang = false

/** Tạo bảng lần đầu chạm tới. Cùng pattern với mkt_exchange_rate ở lib/db.ts. */
export async function ensureBang() {
  if (_daTaoBang) return
  const pool = getPool()
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tai_lieu_folder (
      id          TEXT PRIMARY KEY,
      ten         TEXT NOT NULL,
      parent_id   TEXT NULL REFERENCES tai_lieu_folder(id) ON DELETE CASCADE,
      mo_ta       TEXT NOT NULL DEFAULT '',
      view_roles  JSONB NOT NULL DEFAULT '[]',
      edit_roles  JSONB NOT NULL DEFAULT '[]',
      created_by  TEXT NOT NULL DEFAULT '',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tai_lieu_item (
      id          TEXT PRIMARY KEY,
      folder_id   TEXT NULL REFERENCES tai_lieu_folder(id) ON DELETE CASCADE,
      kind        TEXT NOT NULL,
      tieu_de     TEXT NOT NULL,
      mo_ta       TEXT NOT NULL DEFAULT '',
      url         TEXT NOT NULL DEFAULT '',
      file_key    TEXT NOT NULL DEFAULT '',
      file_name   TEXT NOT NULL DEFAULT '',
      file_type   TEXT NOT NULL DEFAULT '',
      file_size   BIGINT NOT NULL DEFAULT 0,
      tags        JSONB NOT NULL DEFAULT '[]',
      created_by  TEXT NOT NULL DEFAULT '',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tai_lieu_item_folder ON tai_lieu_item(folder_id)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tai_lieu_folder_parent ON tai_lieu_folder(parent_id)`)
  _daTaoBang = true
}

export type NguoiDung = {
  email: string
  role: string
  perms: string[]
  quanTri: boolean
}

/** Lấy danh tính + role + quyền của người đang gọi. */
export async function layNguoiDung(req: any): Promise<NguoiDung | null> {
  const actorId = req?.auth_context?.actor_id
  if (!actorId) return null
  try {
    const userModule = req.scope.resolve(Modules.USER) as any
    const user = await userModule.retrieveUser(actorId, { select: ["email", "metadata"] })
    const perms = resolveUserPerms(user?.metadata)
    return {
      email: user?.email ?? "",
      role: String(user?.metadata?.role ?? ""),
      perms,
      quanTri: perms.includes(QUYEN_QUAN_TRI),
    }
  } catch {
    return null
  }
}

function mang(v: any): string[] {
  return Array.isArray(v) ? v.map(String) : []
}

/**
 * Quyền xem thư mục. Mảng view_roles rỗng = công khai trong nội bộ.
 * Quản trị luôn xem được — tránh thư mục bị khoá vĩnh viễn khi role bị xoá.
 */
export function duocXem(folder: any, u: NguoiDung): boolean {
  if (u.quanTri) return true
  const roles = mang(folder?.view_roles)
  if (roles.length === 0) return true
  return roles.includes(u.role)
}

/**
 * Quyền sửa (thêm/xoá tài liệu trong thư mục). Mặc định KHÁC quyền xem: mảng rỗng
 * nghĩa là CHỈ quản trị được sửa, vì tài liệu công ty mà ai cũng xoá được thì nguy hiểm.
 */
export function duocSua(folder: any, u: NguoiDung): boolean {
  if (u.quanTri) return true
  if (!folder) return false
  const roles = mang(folder.edit_roles)
  if (roles.length === 0) return false
  return roles.includes(u.role) && duocXem(folder, u)
}

/** Danh sách thư mục người này được xem, đã lọc sẵn. */
export async function layFolderChoPhep(u: NguoiDung): Promise<any[]> {
  await ensureBang()
  const { rows } = await getPool().query(
    `SELECT * FROM tai_lieu_folder ORDER BY ten ASC`
  )
  return rows.filter(f => duocXem(f, u))
}
