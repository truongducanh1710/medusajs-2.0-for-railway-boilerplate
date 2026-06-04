import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { randomUUID } from "crypto"

/**
 * Trích FILE_ID từ Google Drive share link.
 */
export function extractDriveFileId(url: string): string | null {
  if (!url) return null
  let m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)
  if (!m) m = url.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  return m ? m[1] : null
}

/**
 * Convert link Google Drive (share) → direct download URL để Facebook tự tải.
 * Dùng export=download&confirm=t — với file nhỏ (<100MB) thường không cần confirm page.
 */
export function driveToDirectUrl(url: string): string | null {
  const id = extractDriveFileId(url)
  if (!id) return null
  return `https://drive.google.com/uc?export=download&id=${id}&confirm=t`
}

/**
 * Tải video từ Google Drive về file tạm.
 * Drive redirect qua trang confirm với cookie "download_warning" cho file lớn.
 * Ta follow redirect + extract confirm token từ cookie nếu cần.
 */
export async function downloadToTmp(url: string): Promise<string> {
  const fileId = extractDriveFileId(url)
  if (!fileId) throw new Error("Không nhận diện được Google Drive file ID")

  // Bước 1: request download, check nếu Drive trả về confirm page
  const initUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`
  const initRes = await fetch(initUrl, { redirect: "follow" })

  let finalBuf: Buffer

  const contentType = initRes.headers.get("content-type") || ""
  if (contentType.includes("text/html")) {
    // Drive trả confirm page → lấy confirm token từ cookie + form
    const html = await initRes.text()
    const tokenMatch = html.match(/confirm=([0-9A-Za-z_\-]+)/)
    const uuidMatch = html.match(/uuid=([0-9A-Za-z_\-]+)/)
    if (tokenMatch) {
      const confirmUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=${tokenMatch[1]}${uuidMatch ? `&uuid=${uuidMatch[1]}` : ""}`
      const confirmRes = await fetch(confirmUrl, { redirect: "follow" })
      if (!confirmRes.ok) throw new Error(`Tải file thất bại sau confirm: HTTP ${confirmRes.status}`)
      finalBuf = Buffer.from(await confirmRes.arrayBuffer())
    } else {
      // Thử drive.usercontent.google.com trực tiếp
      const altUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`
      const altRes = await fetch(altUrl, { redirect: "follow" })
      if (!altRes.ok) throw new Error(`Tải file thất bại: HTTP ${altRes.status}`)
      finalBuf = Buffer.from(await altRes.arrayBuffer())
    }
  } else {
    if (!initRes.ok) throw new Error(`Tải file thất bại: HTTP ${initRes.status}`)
    finalBuf = Buffer.from(await initRes.arrayBuffer())
  }

  if (finalBuf.length < 1000) throw new Error("File tải về quá nhỏ — có thể Drive chặn download hoặc file không tồn tại")

  const tmpPath = path.join(os.tmpdir(), `fb-${randomUUID()}.mp4`)
  await fs.promises.writeFile(tmpPath, finalBuf)
  return tmpPath
}

export async function cleanupTmp(tmpPath: string | null): Promise<void> {
  if (!tmpPath) return
  try { await fs.promises.unlink(tmpPath) } catch { /* ignore */ }
}
