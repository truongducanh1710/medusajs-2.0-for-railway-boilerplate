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

let _tablesReady = false

/** Tạo bảng + sequence nếu chưa có. Idempotent — gọi trước mỗi write operation. */
export async function ensureTables(pool: Pool): Promise<void> {
  if (_tablesReady) return
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mkt_video (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      vd_code      VARCHAR(16) UNIQUE NOT NULL DEFAULT 'VD0',
      post_date    DATE,
      source       VARCHAR(16) DEFAULT 'team',
      maker        VARCHAR(64) NOT NULL,
      product      VARCHAR(128),
      product_code VARCHAR(64),
      video_type   VARCHAR(32),
      link         TEXT,
      status       VARCHAR(20) DEFAULT 'todo',
      note         TEXT,
      ad_name      VARCHAR(128),
      script       TEXT,
      created_by   VARCHAR(255) NOT NULL,
      created_at   TIMESTAMPTZ DEFAULT now(),
      updated_at   TIMESTAMPTZ DEFAULT now()
    )
  `)
  await pool.query(`CREATE SEQUENCE IF NOT EXISTS mkt_video_vd_seq START 1001`)
  // Backfill cột ad_name nếu bảng đã tồn tại trước khi có cột này
  await pool.query(`ALTER TABLE mkt_video ADD COLUMN IF NOT EXISTS ad_name VARCHAR(128)`)
  await pool.query(`ALTER TABLE mkt_video ADD COLUMN IF NOT EXISTS script TEXT`)
  await pool.query(`ALTER TABLE mkt_video ADD COLUMN IF NOT EXISTS ai_score NUMERIC(4,1)`)
  await pool.query(`ALTER TABLE mkt_video ADD COLUMN IF NOT EXISTS ai_review JSONB`)
  await pool.query(`ALTER TABLE mkt_video ADD COLUMN IF NOT EXISTS fb_post_links JSONB DEFAULT '[]'`)
  await pool.query(`ALTER TABLE mkt_video ADD COLUMN IF NOT EXISTS deadline DATE`)
  _tablesReady = true
}

/** Sinh vd_code kế tiếp dạng "VD<n>". */
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
