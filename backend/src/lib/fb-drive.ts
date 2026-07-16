import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { randomUUID } from "crypto"

let larkTenantTokenCache: { token: string; expiresAt: number } | null = null

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

export function extractLarkFileToken(url: string): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    const isLarkHost = /(^|\.)larksuite\.com$/i.test(u.hostname) || /(^|\.)larkoffice\.com$/i.test(u.hostname)
    if (!isLarkHost) return null
    const match = u.pathname.match(/\/file\/([^/?#]+)/)
    return match ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}

export function isLarkFileUrl(url: string): boolean {
  return !!extractLarkFileToken(url)
}

async function getLarkTenantToken(): Promise<string> {
  const now = Date.now()
  if (larkTenantTokenCache && larkTenantTokenCache.expiresAt > now + 5 * 60 * 1000) {
    return larkTenantTokenCache.token
  }

  const appId = process.env.LARK_APP_ID
  const appSecret = process.env.LARK_APP_SECRET
  if (!appId || !appSecret) throw new Error("LARK_APP_ID/LARK_APP_SECRET is not configured")

  const res = await fetch("https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  })
  const data: any = await res.json().catch(() => null)
  if (!res.ok || data?.code !== 0 || !data?.tenant_access_token) {
    throw new Error(`Lark token failed: ${data?.msg || `HTTP ${res.status}`}`)
  }

  larkTenantTokenCache = {
    token: data.tenant_access_token,
    expiresAt: now + Math.max(0, Number(data.expire || 7200) - 300) * 1000,
  }
  return larkTenantTokenCache.token
}

async function downloadLarkToTmp(url: string): Promise<string> {
  const token = extractLarkFileToken(url)
  if (!token) throw new Error("Could not extract Lark file token")

  const tenantToken = await getLarkTenantToken()
  const res = await fetch(`https://open.larksuite.com/open-apis/drive/v1/files/${encodeURIComponent(token)}/download`, {
    headers: { Authorization: `Bearer ${tenantToken}` },
    redirect: "follow",
  })
  const contentType = res.headers.get("content-type") || ""
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Lark file download failed: HTTP ${res.status}${text ? ` - ${text.slice(0, 200)}` : ""}`)
  }
  if (contentType.includes("text/html")) throw new Error("Lark returned HTML instead of file bytes")

  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 1000) throw new Error("Downloaded Lark file is too small")

  const disposition = res.headers.get("content-disposition") || ""
  const extMatch = disposition.match(/filename\*?=(?:UTF-8''|")?[^";]*\.([a-zA-Z0-9]+)[";]?/i)
  const ext = extMatch?.[1]
    ? `.${extMatch[1].toLowerCase()}`
    : contentType.includes("image/")
      ? `.${contentType.split("/")[1].split(";")[0]}`
      : ".mp4"
  const tmpPath = path.join(os.tmpdir(), `fb-${randomUUID()}${ext}`)
  await fs.promises.writeFile(tmpPath, buf)
  return tmpPath
}

/**
 * Tải video từ Google Drive về file tạm.
 * Drive redirect qua trang confirm với cookie "download_warning" cho file lớn.
 * Ta follow redirect + extract confirm token từ cookie nếu cần.
 */
export async function downloadToTmp(url: string): Promise<string> {
  if (isLarkFileUrl(url)) return downloadLarkToTmp(url)

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

/**
 * Lấy createdTime (ngày file được tải lên Drive) qua Drive API v3.
 * Cần GOOGLE_DRIVE_API_KEY + file share "Anyone with the link" (API key không đọc được file nội bộ/private).
 * Trả null nếu thiếu key, không phải link Drive, hoặc file không public — không throw để không chặn luồng tạo video.
 */
export async function getDriveFileCreatedTime(url: string): Promise<string | null> {
  const apiKey = process.env.GOOGLE_DRIVE_API_KEY
  if (!apiKey) return null
  const fileId = extractDriveFileId(url)
  if (!fileId) return null

  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=createdTime&key=${apiKey}`
    )
    if (!res.ok) return null
    const data: any = await res.json().catch(() => null)
    return data?.createdTime || null
  } catch {
    return null
  }
}
