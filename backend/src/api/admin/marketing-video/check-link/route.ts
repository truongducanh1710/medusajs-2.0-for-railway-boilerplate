import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getAuthInfo } from "../_lib"
import * as https from "https"
import * as http from "http"

function extractDriveFileId(link: string): string | null {
  const m = link.match(/\/d\/([a-zA-Z0-9_-]+)/)
  if (m) return m[1]
  const m2 = link.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  if (m2) return m2[1]
  return null
}

function headRequest(url: string, redirects = 6): Promise<{ status: number; contentType: string }> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http
    const req = mod.request(url, { method: "HEAD", headers: { "User-Agent": "Mozilla/5.0" }, timeout: 8000 }, (res) => {
      res.resume()
      if (res.statusCode && res.statusCode >= 300 && res.headers.location && redirects > 0) {
        resolve(headRequest(res.headers.location, redirects - 1))
      } else {
        resolve({ status: res.statusCode || 0, contentType: res.headers["content-type"] || "" })
      }
    })
    req.on("error", reject)
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")) })
    req.end()
  })
}

/**
 * GET /admin/marketing-video/check-link?url=...
 * Kiểm tra link Drive/Lark có public không (proxy qua backend để tránh CORS).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthenticated" })

  const url = (req.query as any).url as string
  if (!url) return res.status(400).json({ ok: false, error: "Thiếu url" })

  // Lark: chỉ validate URL format, không check được access
  if (url.includes("larksuite.com") || url.includes("feishu.cn") || url.includes("lark.")) {
    return res.json({ ok: true, type: "lark", message: "Link Lark — sẽ kiểm tra khi phân tích" })
  }

  const fileId = extractDriveFileId(url)
  if (!fileId) return res.json({ ok: false, error: "Không nhận ra định dạng link Google Drive" })

  const driveUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`

  try {
    const { status, contentType } = await headRequest(driveUrl)

    if (contentType.includes("text/html")) {
      return res.json({ ok: false, error: "File chưa được share public — vào Drive chọn 'Anyone with the link'" })
    }
    if (status === 404) {
      return res.json({ ok: false, error: "Không tìm thấy file — kiểm tra lại link" })
    }
    if (status === 403) {
      return res.json({ ok: false, error: "Không có quyền truy cập — cần share 'Anyone with the link can view'" })
    }
    if (status >= 200 && status < 400) {
      return res.json({ ok: true, type: "drive", message: "Link hợp lệ" })
    }
    return res.json({ ok: false, error: `Drive trả HTTP ${status} — kiểm tra lại link` })
  } catch (e: any) {
    return res.json({ ok: false, error: "Không kết nối được Drive: " + e.message })
  }
}
