import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

/** Hôm nay theo giờ VN, dạng YYYY-MM-DD. */
function todayVN(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)
}

/**
 * Ghi mốc bàn giao khi extension đổi người.
 *
 * Báo cáo gom theo (extension × người tại thời điểm gọi), nên mỗi lần đổi người
 * phải có mốc thì cuộc gọi cũ mới còn thuộc về người cũ. Làm tự động ngay ở đây
 * để không ai phải nhớ ghi tay — đổi dropdown là xong.
 *
 * Ngày bàn giao mặc định là HÔM NAY: đó là thời điểm thao tác đổi thực sự xảy ra.
 * Muốn mốc khác (bàn giao từ đầu tháng, nhập bù cho quá khứ) thì sửa lại qua
 * /admin/ity-cdr-sync/extension-history.
 */
async function recordHandover(
  extension: string,
  oldName: string,
  newName: string,
): Promise<void> {
  const from = todayVN()
  const pool = getPool()
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ity_extension_history (
      id             VARCHAR PRIMARY KEY,
      extension      VARCHAR NOT NULL,
      display_name   VARCHAR NOT NULL DEFAULT '',
      user_id        VARCHAR NULL,
      effective_from DATE NOT NULL,
      effective_to   DATE NULL,
      note           VARCHAR NOT NULL DEFAULT '',
      created_at     TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ity_ext_history_idx
      ON ity_extension_history (extension, effective_from);
  `)

  // Đóng giai đoạn của người cũ tại HÔM QUA. Nếu chưa từng có mốc nào cho người
  // này thì tạo mới với effective_from để trống ở quá khứ xa (2000-01-01) —
  // nghĩa là "mọi cuộc gọi trước đây đều của họ".
  if (oldName) {
    const yesterday = new Date(Date.now() + 7 * 3600 * 1000 - 86400_000)
      .toISOString().slice(0, 10)
    const { rowCount } = await pool.query(
      `UPDATE ity_extension_history
       SET effective_to = $1::date
       WHERE extension = $2 AND display_name = $3 AND effective_to IS NULL`,
      [yesterday, extension, oldName],
    )
    if (!rowCount) {
      await pool.query(
        `INSERT INTO ity_extension_history
           (id, extension, display_name, effective_from, effective_to, note)
         VALUES (gen_random_uuid(), $1, $2, '2000-01-01'::date, $3::date, $4)`,
        [extension, oldName, yesterday, "Tự ghi khi bàn giao máy nhánh"],
      )
    }
  }

  // Mở giai đoạn của người mới từ hôm nay (bỏ gán thì không mở giai đoạn nào).
  if (newName) {
    await pool.query(
      `INSERT INTO ity_extension_history
         (id, extension, display_name, effective_from, note)
       VALUES (gen_random_uuid(), $1, $2, $3::date, $4)`,
      [extension, newName, from, "Tự ghi khi bàn giao máy nhánh"],
    )
  }
}

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

    // display_name là thứ BÁO CÁO đọc để hiện tên nhân viên (report/route.ts gom
    // theo extension rồi tra display_name). Trước đây UI chỉ gửi user_id nên đổi
    // người xong tên cũ vẫn nằm nguyên — báo cáo tiếp tục ghi cho người cũ hàng
    // tháng trời. Vì vậy suy tên từ user_id ngay tại đây thay vì tin vào client.
    let resolvedName = display_name
    if (resolvedName === undefined) {
      if (user_id) {
        const userService = req.scope.resolve(Modules.USER) as any
        const [u] = await userService.listUsers(
          { id: user_id },
          { select: ["id", "email", "first_name", "last_name"], take: 1 },
        )
        resolvedName = u
          ? [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email
          : ""
      } else if (user_id === null) {
        // Bỏ gán thì xoá luôn tên, không để tên người cũ treo lại.
        resolvedName = ""
      }
    }

    // Đổi sang người khác thì tự ghi mốc bàn giao TRƯỚC khi cập nhật, để còn biết
    // tên người cũ. So theo tên vì đó là thứ báo cáo dùng để gom.
    const oldName: string = existing[0]?.display_name || ""
    if (
      existing.length > 0 &&
      resolvedName !== undefined &&
      resolvedName !== oldName
    ) {
      // Hỏng ở đây không được chặn việc gán — mốc bàn giao có thể bổ sung sau,
      // còn người dùng đang chờ dropdown lưu xong.
      await recordHandover(extension, oldName, resolvedName).catch((e) =>
        console.error("[ItyExtensionMap] recordHandover error:", e?.message),
      )
    }

    let saved
    if (existing.length > 0) {
      saved = await syncService.updateItyExtensionMaps({
        id: existing[0].id,
        ...(user_id !== undefined ? { user_id } : {}),
        ...(resolvedName !== undefined ? { display_name: resolvedName } : {}),
        ...(note !== undefined ? { note } : {}),
      })
    } else {
      saved = await syncService.createItyExtensionMaps({
        extension,
        user_id: user_id ?? null,
        display_name: resolvedName ?? "",
        note: note ?? null,
      })
    }

    return res.json({ extension: saved })
  } catch (err: any) {
    console.error("[ItyExtensionMap API] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
