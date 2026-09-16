import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ulid } from "ulid"
import { getPool } from "../../../../lib/db"
import { ensureBang, layNguoiDung, layFolderChoPhep } from "../_lib"

/**
 * GET  /admin/tai-lieu/folders  — cây thư mục người gọi được xem (kèm số tài liệu)
 * POST /admin/tai-lieu/folders  — tạo thư mục (chỉ quản trị)
 */

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const u = await layNguoiDung(req)
    if (!u) return res.status(401).json({ error: "Chưa đăng nhập" })

    const folders = await layFolderChoPhep(u)
    const ids = folders.map(f => f.id)

    // Đếm tài liệu từng thư mục trong 1 query thay vì N query.
    let dem: Record<string, number> = {}
    if (ids.length > 0) {
      const { rows } = await getPool().query(
        `SELECT folder_id, COUNT(*)::int AS n FROM tai_lieu_item
         WHERE folder_id = ANY($1) GROUP BY folder_id`,
        [ids]
      )
      dem = Object.fromEntries(rows.map(r => [r.folder_id, r.n]))
    }

    return res.json({
      folders: folders.map(f => ({
        ...f,
        so_tai_lieu: dem[f.id] ?? 0,
        duoc_sua: u.quanTri || (Array.isArray(f.edit_roles) && f.edit_roles.includes(u.role)),
      })),
      me: { email: u.email, role: u.role, quan_tri: u.quanTri },
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const u = await layNguoiDung(req)
    if (!u) return res.status(401).json({ error: "Chưa đăng nhập" })
    // Chỉ quản trị được tạo thư mục — vì tạo thư mục đồng nghĩa với đặt phân quyền.
    if (!u.quanTri) return res.status(403).json({ error: "Chỉ quản trị tài liệu được tạo thư mục" })

    await ensureBang()
    const b = req.body as any
    const ten = String(b?.ten ?? "").trim()
    if (!ten) return res.status(400).json({ error: "Thiếu tên thư mục" })

    const parentId = b?.parent_id ? String(b.parent_id) : null
    if (parentId) {
      const { rows } = await getPool().query(`SELECT id FROM tai_lieu_folder WHERE id = $1`, [parentId])
      if (rows.length === 0) return res.status(400).json({ error: "Thư mục cha không tồn tại" })
    }

    const id = ulid()
    await getPool().query(
      `INSERT INTO tai_lieu_folder (id, ten, parent_id, mo_ta, view_roles, edit_roles, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        id, ten, parentId, String(b?.mo_ta ?? ""),
        JSON.stringify(Array.isArray(b?.view_roles) ? b.view_roles : []),
        JSON.stringify(Array.isArray(b?.edit_roles) ? b.edit_roles : []),
        u.email,
      ]
    )
    const { rows } = await getPool().query(`SELECT * FROM tai_lieu_folder WHERE id = $1`, [id])
    return res.json({ folder: rows[0] })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
