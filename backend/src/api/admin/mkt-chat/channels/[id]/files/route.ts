import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPool } from "../../../../../../lib/db"
import { getMktChatAuthInfo, getMktUserNameMap, canAccessMktChannel } from "../../../_lib"

// GET /admin/mkt-chat/channels/:id/files?type=image|file&author=&from=&to=
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getMktChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const svc = req.scope.resolve("mktTaskModule") as any
    const { id } = req.params
    const { type, author, from, to } = req.query as any

    const [channel] = await svc.listMktChannels({ id, deleted_at: null })
    if (!channel) return res.status(404).json({ error: "Khong tim thay channel" })
    if (!canAccessMktChannel(channel, auth)) {
      return res.status(403).json({ error: "Ban khong phai thanh vien cua channel nay" })
    }

    const params: any[] = [id]
    const where = [
      `channel_id = $1`,
      `deleted_at IS NULL`,
      `file_url IS NOT NULL`,
    ]
    if (type === "image") where.push(`file_type LIKE 'image/%'`)
    if (type === "file") where.push(`(file_type IS NULL OR file_type NOT LIKE 'image/%')`)
    if (author) {
      params.push(author)
      where.push(`author_id = $${params.length}`)
    }
    if (from) {
      params.push(from)
      where.push(`created_at >= $${params.length}`)
    }
    if (to) {
      params.push(to)
      where.push(`created_at <= $${params.length}`)
    }

    const result = await getPool().query(
      `SELECT id, file_url, file_type, file_name, file_expires_at, author_id, created_at
       FROM mkt_message
       WHERE ${where.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT 100`,
      params
    )

    const nameByEmail = await getMktUserNameMap(req)
    res.json({
      files: result.rows.map((file: any) => ({
        ...file,
        author_name: nameByEmail[file.author_id] || file.author_id,
      })),
    })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}