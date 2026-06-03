import type { MedusaRequest } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { Pool } from "pg"

let _pool: Pool | null = null
export function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

export type AuthInfo = {
  email: string
  isSuper: boolean
  /** Danh sách page_id marketer được phép thao tác (null = tất cả). */
  fbPageIds: string[] | null
}

export async function getAuthInfo(req: MedusaRequest): Promise<AuthInfo | null> {
  const auth = (req as any).auth_context
  if (auth?.actor_type !== "user" || !auth?.actor_id) return null
  const userModule = req.scope.resolve(Modules.USER)
  const user = await userModule.retrieveUser(auth.actor_id, { select: ["id", "email", "metadata"] })
  const isSuper = !!(user.email && user.email === process.env.SUPER_ADMIN_EMAIL)
  const raw = (user.metadata as any)?.fb_page_ids
  const fbPageIds = isSuper ? null : (Array.isArray(raw) ? raw.map(String) : [])
  return { email: user.email || "", isSuper, fbPageIds }
}

/** Sinh vd_code kế tiếp dạng "VD<seq>" qua sequence DB (atomic, không trùng). */
export async function nextVdCode(pool: Pool): Promise<string> {
  const { rows } = await pool.query(`SELECT nextval('mkt_video_vd_seq') AS n`)
  return `VD${rows[0].n}`
}

/** Map trạng thái tiếng Việt (UI) ↔ key DB. UI design dùng tiếng Việt trực tiếp. */
export const STATUS_VI_TO_KEY: Record<string, string> = {
  "Cần làm": "todo",
  "Đang làm": "doing",
  "Chờ duyệt": "review",
  "Xong": "done",
  "Đã đăng": "posted",
  "Lỗi": "error",
}
export const STATUS_KEY_TO_VI: Record<string, string> = Object.fromEntries(
  Object.entries(STATUS_VI_TO_KEY).map(([vi, key]) => [key, vi])
)
