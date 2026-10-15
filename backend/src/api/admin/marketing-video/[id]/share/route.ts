import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { getPool, ensureTables } from "../../_lib"
import { resolveUserPerms } from "../../../../middlewares"
import { FREELANCE_ROLE } from "../../../../../lib/freelance-scope"

/**
 * Chia sẻ 1 video nguyên liệu cho freelancer (chỉ xem + lấy link).
 *
 *   GET  /admin/marketing-video/:id/share  → { sharedWith, candidates }
 *   POST /admin/marketing-video/:id/share  { emails: string[] } → ghi đè danh sách
 *
 * Chỉ super admin / quản lý (users.manage) được chia sẻ. Freelancer bị freelanceGuard
 * chặn từ trước (path /share không nằm trong allowlist). Chỉ nhận email của user đang
 * mang role freelance — role khác vốn đã thấy toàn bộ video.
 */

async function loadCaller(req: MedusaRequest) {
  const auth = (req as any).auth_context
  if (auth?.actor_type !== "user" || !auth?.actor_id) return null
  const userModule = req.scope.resolve(Modules.USER)
  return userModule.retrieveUser(auth.actor_id, { select: ["id", "email", "metadata"] })
}

function canShare(user: any): boolean {
  if (user?.email && user.email === process.env.SUPER_ADMIN_EMAIL) return true
  return resolveUserPerms(user?.metadata).includes("users.manage")
}

async function listFreelancers(req: MedusaRequest) {
  const userModule = req.scope.resolve(Modules.USER)
  const users = await userModule.listUsers({}, { select: ["id", "email", "first_name", "last_name", "metadata"] })
  return users
    .filter(u => (u.metadata as any)?.role === FREELANCE_ROLE && u.email)
    .map(u => ({
      email: u.email.toLowerCase(),
      name: [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email,
      mkt_code: (u.metadata as any)?.mkt_code ?? null,
    }))
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const caller = await loadCaller(req)
    if (!caller) return res.status(401).json({ error: "Unauthenticated" })
    if (!canShare(caller)) return res.status(403).json({ error: "Chỉ quản lý được chia sẻ video" })

    const pool = getPool()
    await ensureTables(pool)
    const { rows } = await pool.query(`SELECT shared_with FROM mkt_video WHERE id = $1`, [(req.params as any).id])
    if (!rows.length) return res.status(404).json({ error: "Không tìm thấy video" })
    return res.json({
      sharedWith: Array.isArray(rows[0].shared_with) ? rows[0].shared_with : [],
      candidates: await listFreelancers(req),
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const caller = await loadCaller(req)
    if (!caller) return res.status(401).json({ error: "Unauthenticated" })
    if (!canShare(caller)) return res.status(403).json({ error: "Chỉ quản lý được chia sẻ video" })

    const b: any = req.body && typeof req.body === "object" ? req.body : {}
    if (!Array.isArray(b.emails)) return res.status(400).json({ error: "Thiếu emails" })
    const requested = [...new Set(b.emails.map((e: any) => String(e || "").trim().toLowerCase()).filter(Boolean))] as string[]

    const allowed = new Set((await listFreelancers(req)).map(u => u.email))
    const invalid = requested.filter(e => !allowed.has(e))
    if (invalid.length) return res.status(400).json({ error: `Không phải tài khoản freelance: ${invalid.join(", ")}` })

    const pool = getPool()
    await ensureTables(pool)
    const { rows } = await pool.query(
      `UPDATE mkt_video SET shared_with = $1::jsonb, updated_at = now() WHERE id = $2 RETURNING shared_with`,
      [JSON.stringify(requested), (req.params as any).id]
    )
    if (!rows.length) return res.status(404).json({ error: "Không tìm thấy video" })
    return res.json({ ok: true, sharedWith: rows[0].shared_with })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
