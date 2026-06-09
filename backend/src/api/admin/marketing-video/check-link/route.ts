import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getAuthInfo } from "../_lib"
import { extractLarkFileToken, isLarkFileUrl } from "../../../../lib/fb-drive"
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

let larkTokenCache: { token: string; expiresAt: number } | null = null

async function getLarkToken(): Promise<string | null> {
  const appId = process.env.LARK_APP_ID
  const appSecret = process.env.LARK_APP_SECRET
  if (!appId || !appSecret) return null

  const now = Date.now()
  if (larkTokenCache && larkTokenCache.expiresAt > now + 5 * 60 * 1000) return larkTokenCache.token

  const res = await fetch("https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  })
  const data: any = await res.json().catch(() => null)
  if (!res.ok || data?.code !== 0 || !data?.tenant_access_token) return null

  larkTokenCache = { token: data.tenant_access_token, expiresAt: now + (Number(data.expire || 7200) - 300) * 1000 }
  return larkTokenCache.token
}

async function checkLarkFile(url: string): Promise<{ ok: boolean; error?: string }> {
  const fileToken = extractLarkFileToken(url)
  if (!fileToken) return { ok: false, error: "Không nhận ra định dạng link Lark — cần dạng .../file/XXXXX" }

  const token = await getLarkToken()
  if (!token) return { ok: true }

  // Thử drive/v2/files trước (file upload thường), fallback sang drive/v1/files (docs/sheets)
  let r = await fetch(`https://open.larksuite.com/open-apis/drive/v2/files/${encodeURIComponent(fileToken)}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null)

  // Nếu v2 không hỗ trợ loại file này, thử v1
  let data: any = r ? await r.json().catch(() => null) : null
  if (data?.code === 1061045 || data?.code === 1061001) {
    r = await fetch(`https://open.larksuite.com/open-apis/drive/v1/files/${encodeURIComponent(fileToken)}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => null)
    data = r ? await r.json().catch(() => null) : null
  }

  if (!r) return { ok: false, error: "Không kết nối được Lark API" }

  if (data?.code === 0) return { ok: true }
  // Log để debug — xóa sau khi xác định được lỗi
  console.log("[lark-check] http=" + r.status + " code=" + data?.code + " msg=" + data?.msg)
  if (data?.code === 99991663 || data?.code === 99991661) {
    return { ok: false, error: "Không tìm thấy file Lark — kiểm tra lại link" }
  }
  // HTTP 404 hoặc permission error hoặc lỗi khác → cho qua
  return { ok: true }
}

/**
 * GET /admin/marketing-video/check-link?url=...
 * Kiểm tra link Drive/Lark có accessible không (proxy qua backend để tránh CORS).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const auth = await getAuthInfo(req)
  if (!auth) return res.status(401).json({ error: "Unauthenticated" })

  const url = (req.query as any).url as string
  if (!url) return res.status(400).json({ ok: false, error: "Thiếu url" })

  // Lark
  if (isLarkFileUrl(url)) {
    const result = await checkLarkFile(url).catch(() => ({ ok: true }))
    return res.json({ ...result, type: "lark" })
  }

  // Google Drive
  const fileId = extractDriveFileId(url)
  if (!fileId) return res.json({ ok: false, error: "Không nhận ra định dạng link — cần link Google Drive hoặc Lark" })

  const driveUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`

  try {
    const { status, contentType } = await headRequest(driveUrl)

    if (contentType.includes("text/html")) {
      return res.json({ ok: false, type: "drive", error: "File chưa share public — vào Drive → chuột phải → Share → 'Anyone with the link'" })
    }
    if (status === 404) {
      return res.json({ ok: false, type: "drive", error: "Không tìm thấy file — kiểm tra lại link Drive" })
    }
    if (status === 403) {
      return res.json({ ok: false, type: "drive", error: "Không có quyền truy cập — cần share 'Anyone with the link can view'" })
    }
    if (status >= 200 && status < 400) {
      return res.json({ ok: true, type: "drive" })
    }
    return res.json({ ok: false, type: "drive", error: `Drive trả HTTP ${status} — kiểm tra lại link` })
  } catch (e: any) {
    return res.json({ ok: false, error: "Không kết nối được: " + e.message })
  }
}
