import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

/**
 * GET /admin/ity-cdr-sync/extensions
 * Danh sách mapping extension tổng đài ↔ nhân viên, kèm tên/email user thật (join Medusa user).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const syncService = req.scope.resolve("ityCdrSyncModule") as any
    const maps = await syncService.listItyExtensionMaps({}, { order: { extension: "ASC" } })

    const userService = req.scope.resolve(Modules.USER) as any
    const allUsers = await userService.listUsers({}, { select: ["id", "email", "first_name", "last_name"] })
    const usersById: Record<string, any> = Object.fromEntries(allUsers.map((u: any) => [u.id, u]))

    const result = maps.map((m: any) => ({
      extension: m.extension,
      user_id: m.user_id,
      display_name: m.display_name,
      note: m.note,
      user: m.user_id && usersById[m.user_id]
        ? { email: usersById[m.user_id].email, first_name: usersById[m.user_id].first_name, last_name: usersById[m.user_id].last_name }
        : null,
    }))

    // Kèm danh sách toàn bộ user để render dropdown gán extension trên UI
    const allUsersSimple = allUsers.map((u: any) => ({
      id: u.id,
      email: u.email,
      name: (u.first_name || u.last_name) ? [u.first_name, u.last_name].filter(Boolean).join(" ") : u.email,
    }))

    return res.json({ extensions: result, users: allUsersSimple })
  } catch (err: any) {
    console.error("[ItyExtensionMap API] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}

/**
 * POST /admin/ity-cdr-sync/extensions
 * Gán/đổi nhân viên cho 1 extension. Tạo mới nếu extension chưa tồn tại.
 * Body: { extension: string, user_id?: string, display_name?: string, note?: string }
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { extension, user_id, display_name, note } = req.body as {
      extension?: string
      user_id?: string | null
      display_name?: string
      note?: string
    }

    if (!extension) {
      return res.status(400).json({ error: "Missing required field: extension" })
    }

    const syncService = req.scope.resolve("ityCdrSyncModule") as any
    const existing = await syncService.listItyExtensionMaps({ extension }, { take: 1 })

    let saved
    if (existing.length > 0) {
      saved = await syncService.updateItyExtensionMaps({
        id: existing[0].id,
        ...(user_id !== undefined ? { user_id } : {}),
        ...(display_name !== undefined ? { display_name } : {}),
        ...(note !== undefined ? { note } : {}),
      })
    } else {
      saved = await syncService.createItyExtensionMaps({
        extension,
        user_id: user_id ?? null,
        display_name: display_name ?? "",
        note: note ?? null,
      })
    }

    return res.json({ extension: saved })
  } catch (err: any) {
    console.error("[ItyExtensionMap API] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
