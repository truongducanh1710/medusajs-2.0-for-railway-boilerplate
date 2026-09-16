import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool } from "../../../../../lib/db"
import { ensureBang, layNguoiDung, layFolderChoPhep, duocSua } from "../../_lib"

/**
 * PATCH  /admin/tai-lieu/items/:id — sửa tiêu đề/mô tả/tag, hoặc chuyển thư mục
 * DELETE /admin/tai-lieu/items/:id — xoá tài liệu
 */

async function layVaKiemTra(req: MedusaRequest) {
  const u = await layNguoiDung(req)
  if (!u) return { loi: [401, "Chưa đăng nhập"] as const }

  await ensureBang()
  const { id } = req.params
  const { rows } = await getPool().query(`SELECT * FROM tai_lieu_item WHERE id = $1`, [id])
  if (rows.length === 0) return { loi: [404, "Không tìm thấy tài liệu"] as const }

  const item = rows[0]
  const choPhep = await layFolderChoPhep(u)
  const folder = choPhep.find(f => f.id === item.folder_id)
  if (!folder) return { loi: [403, "Không có quyền xem thư mục này"] as const }
  if (!duocSua(folder, u)) return { loi: [403, "Không có quyền sửa tài liệu trong thư mục này"] as const }

  return { u, item, choPhep }
}

export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const kq = await layVaKiemTra(req)
    if ("loi" in kq && kq.loi) return res.status(kq.loi[0]).json({ error: kq.loi[1] })
    const { u, choPhep } = kq as any

    const b = req.body as any
    const set: string[] = []
    const val: any[] = []
    const them = (cot: string, v: any) => { set.push(`${cot} = $${set.length + 2}`); val.push(v) }

    if (typeof b?.tieu_de === "string" && b.tieu_de.trim()) them("tieu_de", b.tieu_de.trim())
    if (typeof b?.mo_ta === "string") them("mo_ta", b.mo_ta)
    if (Array.isArray(b?.tags)) them("tags", JSON.stringify(b.tags))

    // Chuyển thư mục: phải có quyền sửa ở CẢ thư mục đích, không chỉ thư mục nguồn —
    // nếu không sẽ thành đường vòng đẩy tài liệu vào thư mục mình không được động tới.
    if (typeof b?.folder_id === "string" && b.folder_id) {
      const dich = choPhep.find((f: any) => f.id === b.folder_id)
      if (!dich) return res.status(403).json({ error: "Không có quyền xem thư mục đích" })
      if (!duocSua(dich, u)) return res.status(403).json({ error: "Không có quyền thêm vào thư mục đích" })
      them("folder_id", b.folder_id)
    }

    if (set.length === 0) return res.status(400).json({ error: "Không có gì để sửa" })

    const { rows } = await getPool().query(
      `UPDATE tai_lieu_item SET ${set.join(", ")}, updated_at = now() WHERE id = $1 RETURNING *`,
      [req.params.id, ...val]
    )
    return res.json({ item: rows[0] })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const kq = await layVaKiemTra(req)
    if ("loi" in kq && kq.loi) return res.status(kq.loi[0]).json({ error: kq.loi[1] })

    // Chỉ xoá bản ghi, KHÔNG xoá file trên MinIO. Cùng một key có thể được tham chiếu
    // ở nơi khác (tin nhắn chat, trang sản phẩm); dọn file mồ côi đã có script riêng
    // scripts/clean-orphan-media.ts làm việc đó một cách an toàn hơn.
    await getPool().query(`DELETE FROM tai_lieu_item WHERE id = $1`, [req.params.id])
    return res.json({ ok: true })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
