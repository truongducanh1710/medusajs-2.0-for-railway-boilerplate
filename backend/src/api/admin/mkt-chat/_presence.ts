import { ulid } from "ulid"
import { getPool } from "../../../lib/db"

// Ngưỡng: không heartbeat quá 2 phút → coi như tab đã chết (mất mạng/sleep máy).
export const PRESENCE_STALE_MS = 120_000
// Không thao tác chuột/phím quá 5 phút → idle (tab mở nhưng người không dùng).
export const PRESENCE_IDLE_MS = 300_000

/** day_key theo giờ VN (UTC+7) — báo cáo chấm công phải cắt ngày theo giờ địa phương. */
export function vnDayKey(d: Date = new Date()): string {
  return new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10)
}

/** Chỉ phân loại desktop/mobile — không suy ra máy vật lý cụ thể, UA có thể giả mạo. */
export function parseDeviceFromUA(userAgent?: string | null): "mobile" | "desktop" {
  if (!userAgent) return "desktop"
  return /Mobi|Android|iPhone|iPad|iPod/i.test(userAgent) ? "mobile" : "desktop"
}

export async function startPresenceSession(email: string, userAgent?: string): Promise<string> {
  const id = ulid()
  const now = new Date().toISOString()
  await getPool().query(
    `INSERT INTO mkt_presence_session
       (id, user_email, status, started_at, last_seen_at, last_active_at, day_key, user_agent, created_at, updated_at)
     VALUES ($1, $2, 'online', $3, $3, $3, $4, $5, $3, $3)`,
    [id, email, now, vnDayKey(), userAgent?.slice(0, 250) || null]
  )
  return id
}

/**
 * Heartbeat: cộng dồn thời gian trôi qua kể từ last_seen_at vào active hoặc idle.
 * Cộng dồn ở backend (không tin số client gửi lên) và chặn trần PRESENCE_STALE_MS mỗi nhịp
 * để máy sleep 3 tiếng rồi tỉnh dậy không nhảy vọt 3 tiếng "online".
 */
export async function touchPresenceSession(sessionId: string, isActive: boolean): Promise<void> {
  const now = new Date()
  // Khoảng thời gian từ last_seen_at tới giờ đã trôi qua ở trạng thái CŨ (status hiện đang lưu),
  // không phải trạng thái mới client vừa báo → phải cộng theo `status`, nếu không nhịp
  // chuyển online→idle sẽ tính nhầm 45s vừa làm việc thành idle (và ngược lại).
  await getPool().query(
    `UPDATE mkt_presence_session
     SET active_seconds = active_seconds + CASE WHEN status = 'online'
           THEN FLOOR(LEAST(EXTRACT(EPOCH FROM ($3::timestamptz - last_seen_at)), $4))::int ELSE 0 END,
         idle_seconds = idle_seconds + CASE WHEN status <> 'online'
           THEN FLOOR(LEAST(EXTRACT(EPOCH FROM ($3::timestamptz - last_seen_at)), $4))::int ELSE 0 END,
         status = CASE WHEN $2 THEN 'online' ELSE 'idle' END,
         last_seen_at = $3,
         last_active_at = CASE WHEN $2 THEN $3 ELSE last_active_at END,
         updated_at = $3
     WHERE id = $1 AND ended_at IS NULL`,
    [sessionId, isActive, now.toISOString(), Math.floor(PRESENCE_STALE_MS / 1000)]
  )
}

export async function endPresenceSession(sessionId: string): Promise<void> {
  const now = new Date().toISOString()
  await getPool().query(
    `UPDATE mkt_presence_session
     SET ended_at = $2, status = 'offline',
         active_seconds = active_seconds + CASE WHEN status = 'online'
           THEN FLOOR(LEAST(EXTRACT(EPOCH FROM ($2::timestamptz - last_seen_at)), $3))::int ELSE 0 END,
         idle_seconds = idle_seconds + CASE WHEN status <> 'online'
           THEN FLOOR(LEAST(EXTRACT(EPOCH FROM ($2::timestamptz - last_seen_at)), $3))::int ELSE 0 END,
         updated_at = $2
     WHERE id = $1 AND ended_at IS NULL`,
    [sessionId, now, Math.floor(PRESENCE_STALE_MS / 1000)]
  )
}

/**
 * Đóng session mồ côi: server restart hoặc mất mạng đột ngột thì req.on("close") không chạy,
 * session sẽ treo ended_at = NULL vĩnh viễn và bơm giờ ảo. Chốt ended_at tại last_seen_at
 * (thời điểm cuối cùng thực sự có tín hiệu), không phải now.
 */
export async function reapStalePresenceSessions(): Promise<number> {
  // Không cộng thêm gì: ended_at = last_seen_at nên khoảng "chết" (từ last_seen_at tới now)
  // không được tính công — đúng ý đồ, vì không có bằng chứng người đó còn ngồi máy.
  // Riêng nhịp heartbeat cuối đã được touchPresenceSession cộng rồi.
  const { rowCount } = await getPool().query(
    `UPDATE mkt_presence_session
     SET ended_at = last_seen_at, status = 'offline', updated_at = now()
     WHERE ended_at IS NULL AND last_seen_at < now() - ($1 || ' milliseconds')::interval`,
    [PRESENCE_STALE_MS]
  )
  return rowCount || 0
}

/** Trạng thái live của mọi người — cho chấm xanh trong chat. `devices` liệt kê MỌI thiết bị
 * đang mở tab cùng lúc (vd laptop + mobile), không chỉ thiết bị hoạt động gần nhất. */
export async function getLivePresence(): Promise<Record<string, { status: string; since: string; devices: string[] }>> {
  await reapStalePresenceSessions()
  const { rows } = await getPool().query(
    `SELECT user_email,
            CASE WHEN bool_or(last_active_at > now() - ($1 || ' milliseconds')::interval)
                 THEN 'online' ELSE 'idle' END AS status,
            MIN(started_at) AS since,
            array_agg(DISTINCT user_agent) AS user_agents
     FROM mkt_presence_session
     WHERE ended_at IS NULL
     GROUP BY user_email`,
    [PRESENCE_IDLE_MS]
  )
  const out: Record<string, { status: string; since: string; devices: string[] }> = {}
  for (const r of rows) {
    const rawAgents: (string | null)[] = r.user_agents || []
    const devices: string[] = [...new Set(rawAgents.map(ua => parseDeviceFromUA(ua)))] as string[]
    out[r.user_email] = { status: r.status, since: r.since, devices }
  }
  return out
}
