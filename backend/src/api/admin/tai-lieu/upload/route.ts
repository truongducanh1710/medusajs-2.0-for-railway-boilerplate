import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { ulid } from "ulid"
import { getPool } from "../../../../lib/db"
import {
  ensureBang, layNguoiDung, layFolderChoPhep, duocSua,
  LOAI_CHO_PHEP, KICH_THUOC_TOI_DA,
} from "../_lib"

/**
 * POST /admin/tai-lieu/upload — multipart/form-data
 * Trường: file, folder_id, tieu_de (tuỳ chọn), mo_ta (tuỳ chọn)
 *
 * Multer nạp file vào req.file, khai ở api/middlewares.ts (cùng cách mkt-chat làm).
 */

function tenFile(file: any): string {
  return String(file?.originalname || file?.name || file?.filename || "tai-lieu")
}

function noiDung(file: any): Buffer {
  if (Buffer.isBuffer(file?.buffer)) return file.buffer
  if (file?.path) return require("fs").readFileSync(file.path)
  throw new Error("Không đọc được nội dung file upload")
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const u = await layNguoiDung(req)
    if (!u) return res.status(401).json({ error: "Chưa đăng nhập" })

    await ensureBang()
    const b = (req.body ?? {}) as any
    const folderId = String(b?.folder_id ?? "")
    if (!folderId) return res.status(400).json({ error: "Thiếu thư mục" })

    const choPhep = await layFolderChoPhep(u)
    const folder = choPhep.find(f => f.id === folderId)
    if (!folder) return res.status(403).json({ error: "Không có quyền xem thư mục này" })
    if (!duocSua(folder, u)) return res.status(403).json({ error: "Không có quyền thêm tài liệu vào thư mục này" })

    const file = (req as any).file
    if (!file) return res.status(400).json({ error: "Không tìm thấy file. Thử lại với file nhỏ hơn 50MB." })

    const mime: string = file.mimetype || file.type || "application/octet-stream"
    if (!LOAI_CHO_PHEP.has(mime)) {
      return res.status(400).json({ error: `Không hỗ trợ loại file này: ${mime}` })
    }

    const content = noiDung(file)
    const size = Number(file.size || content.length || 0)
    if (size > KICH_THUOC_TOI_DA) return res.status(400).json({ error: "File vượt quá 50MB" })

    const ten = tenFile(file)
    const fileModule = req.scope.resolve(Modules.FILE) as any
    const daUp = await fileModule.createFiles({
      filename: `tai-lieu/${folderId}/${ulid()}_${ten}`,
      mimeType: mime,
      content: content.toString("base64"),
      access: "public",
    })

    const url: string = daUp?.url
    if (!url) throw new Error("Upload xong nhưng không nhận được URL file")

    const id = ulid()
    await getPool().query(
      `INSERT INTO tai_lieu_item
       (id, folder_id, kind, tieu_de, mo_ta, url, file_key, file_name, file_type, file_size, created_by)
       VALUES ($1,$2,'file',$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        id, folderId,
        String(b?.tieu_de ?? "").trim() || ten,
        String(b?.mo_ta ?? ""),
        url, String(daUp?.id ?? url), ten, mime, size, u.email,
      ]
    )
    const { rows } = await getPool().query(`SELECT * FROM tai_lieu_item WHERE id = $1`, [id])
    return res.json({ item: rows[0] })
  } catch (err: any) {
    console.error("[tai-lieu/upload]", err)
    return res.status(500).json({ error: err.message })
  }
}
