import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool } from "../../../../../lib/db"
import { ensureBang, layNguoiDung } from "../../_lib"

/**
 * PATCH  /admin/tai-lieu/folders/:id — đổi tên / mô tả / phân quyền (chỉ quản trị)
 * DELETE /admin/tai-lieu/folders/:id — xoá thư mục (chỉ quản trị, phải rỗng)
 */

export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const u = await layNguoiDung(req)
    if (!u) return res.status(401).json({ error: "Chưa đăng nhập" })
    if (!u.quanTri) return res.status(403).json({ error: "Chỉ quản trị tài liệu được sửa thư mục" })

    await ensureBang()
    const { id } = req.params
    const b = req.body as any

    const set: string[] = []
    const val: any[] = []
    const them = (cot: string, v: any) => { set.push(`${cot} = $${set.length + 2}`); val.push(v) }

    if (typeof b?.ten === "string" && b.ten.trim()) them("ten", b.ten.trim())
    if (typeof b?.mo_ta === "string") them("mo_ta", b.mo_ta)
    if (Array.isArray(b?.view_roles)) them("view_roles", JSON.stringify(b.view_roles))
    if (Array.isArray(b?.edit_roles)) them("edit_roles", JSON.stringify(b.edit_roles))
    if (set.length === 0) return res.status(400).json({ error: "Không có gì để sửa" })

    const { rows } = await getPool().query(
      `UPDATE tai_lieu_folder SET ${set.join(", ")}, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, ...val]
    )
    if (rows.length === 0) return res.status(404).json({ error: "Không tìm thấy thư mục" })
    return res.json({ folder: rows[0] })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const u = await layNguoiDung(req)
    if (!u) return res.status(401).json({ error: "Chưa đăng nhập" })
    if (!u.quanTri) return res.status(403).json({ error: "Chỉ quản trị tài liệu được xoá thư mục" })

    await ensureBang()
    const { id } = req.params
    const pool = getPool()

    // Chặn xoá khi còn nội dung. CASCADE ở DB sẽ xoá sạch cả cây con lẫn tài liệu —
    // quá dễ mất dữ liệu chỉ vì một cú bấm nhầm, nên bắt người dùng dọn trước.
    const { rows: conFile } = await pool.query(
      `SELECT COUNT(*)::int n FROM tai_lieu_item WHERE folder_id = $1`, [id])
    if (conFile[0].n > 0) {
      return res.status(400).json({ error: `Thư mục còn ${conFile[0].n} tài liệu. Xoá hoặc chuyển chúng đi trước.` })
    }
    const { rows: conCon } = await pool.query(
      `SELECT COUNT(*)::int n FROM tai_lieu_folder WHERE parent_id = $1`, [id])
    if (conCon[0].n > 0) {
      return res.status(400).json({ error: `Thư mục còn ${conCon[0].n} thư mục con. Xoá chúng trước.` })
    }

    await pool.query(`DELETE FROM tai_lieu_folder WHERE id = $1`, [id])
    return res.json({ ok: true })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
