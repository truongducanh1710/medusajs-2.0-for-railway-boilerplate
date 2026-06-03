import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { randomUUID } from "crypto"

/**
 * Convert link Google Drive (share) → direct download URL để Facebook tự tải.
 * Trả null nếu không nhận diện được FILE_ID.
 *   https://drive.google.com/file/d/FILE_ID/view  → uc?export=download&id=FILE_ID
 *   https://drive.google.com/open?id=FILE_ID       → uc?export=download&id=FILE_ID
 */
export function driveToDirectUrl(url: string): string | null {
  if (!url) return null
  let m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)
  if (!m) m = url.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  if (!m) return null
  return `https://drive.google.com/uc?export=download&id=${m[1]}&confirm=t`
}

/**
 * Tải video từ 1 URL về file tạm trong os.tmpdir(). Trả đường dẫn file tmp.
 * Caller PHẢI gọi cleanupTmp() sau khi dùng xong (kể cả khi lỗi).
 */
export async function downloadToTmp(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Tải file thất bại: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const tmpPath = path.join(os.tmpdir(), `fb-${randomUUID()}.mp4`)
  await fs.promises.writeFile(tmpPath, buf)
  return tmpPath
}

export async function cleanupTmp(tmpPath: string | null): Promise<void> {
  if (!tmpPath) return
  try { await fs.promises.unlink(tmpPath) } catch { /* ignore */ }
}
