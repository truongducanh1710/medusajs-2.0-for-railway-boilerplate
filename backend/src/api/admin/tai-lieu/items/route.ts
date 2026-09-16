import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ulid } from "ulid"
import { getPool } from "../../../../lib/db"
import { ensureBang, layNguoiDung, layFolderChoPhep, duocSua } from "../_lib"

/**
 * GET  /admin/tai-lieu/items?folder_id=&q=&kind=  — danh sách tài liệu
 * POST /admin/tai-lieu/items                      — thêm link artifact
 *
 * File upload đi qua route riêng /admin/tai-lieu/upload (cần multipart middleware).
 */

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const u = await layNguoiDung(req)
    if (!u) return res.status(401).json({ error: "Chưa đăng nhập" })

    await ensureBang()
    const { folder_id, q, kind } = req.query as Record<string, string>

    // Luôn giới hạn trong các thư mục người này được xem — kể cả khi tìm kiếm toàn hệ thống.
    const choPhep = await layFolderChoPhep(u)
    const idChoPhep = choPhep.map(f => f.id)
    if (idChoPhep.length === 0) return res.json({ items: [], folders: [] })

    const dk: string[] = [`folder_id = ANY($1)`]
    const val: any[] = [idChoPhep]

    if (folder_id) {
      if (!idChoPhep.includes(folder_id)) {
        return res.status(403).json({ error: "Không có quyền xem thư mục này" })
      }
      dk[0] = `folder_id = $1`
      val[0] = folder_id
    }
    if (q && q.trim()) {
      val.push(`%${q.trim()}%`)
      dk.push(`(tieu_de ILIKE $${val.length} OR mo_ta ILIKE $${val.length} OR file_name ILIKE $${val.length})`)
    }
    if (kind === "file" || kind === "artifact") {
      val.push(kind)
      dk.push(`kind = $${val.length}`)
    }

    const { rows } = await getPool().query(
      `SELECT * FROM tai_lieu_item WHERE ${dk.join(" AND ")}
       ORDER BY created_at DESC LIMIT 500`,
      val
    )

    const tenFolder = Object.fromEntries(choPhep.map(f => [f.id, f.ten]))
    const suaDuoc = Object.fromEntries(choPhep.map(f => [f.id, duocSua(f, u)]))

    return res.json({
      items: rows.map(r => ({
        ...r,
        folder_ten: tenFolder[r.folder_id] ?? "",
        duoc_sua: suaDuoc[r.folder_id] ?? false,
      })),
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const u = await layNguoiDung(req)
    if (!u) return res.status(401).json({ error: "Chưa đăng nhập" })

    await ensureBang()
    const b = req.body as any
    const folderId = String(b?.folder_id ?? "")
    const tieuDe = String(b?.tieu_de ?? "").trim()
    const url = String(b?.url ?? "").trim()

    if (!folderId) return res.status(400).json({ error: "Thiếu thư mục" })
    if (!tieuDe) return res.status(400).json({ error: "Thiếu tiêu đề" })
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: "Link phải bắt đầu bằng http:// hoặc https://" })

    const choPhep = await layFolderChoPhep(u)
    const folder = choPhep.find(f => f.id === folderId)
    if (!folder) return res.status(403).json({ error: "Không có quyền xem thư mục này" })
    if (!duocSua(folder, u)) return res.status(403).json({ error: "Không có quyền thêm tài liệu vào thư mục này" })

    const id = ulid()
    await getPool().query(
      `INSERT INTO tai_lieu_item (id, folder_id, kind, tieu_de, mo_ta, url, tags, created_by)
       VALUES ($1,$2,'artifact',$3,$4,$5,$6,$7)`,
      [id, folderId, tieuDe, String(b?.mo_ta ?? ""), url,
       JSON.stringify(Array.isArray(b?.tags) ? b.tags : []), u.email]
    )
    const { rows } = await getPool().query(`SELECT * FROM tai_lieu_item WHERE id = $1`, [id])
    return res.json({ item: rows[0] })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
