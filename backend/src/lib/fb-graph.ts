import * as fs from "fs"
import { FB_USER_TOKEN, FB_GRAPH_BASE, FB_GRAPH_VERSION } from "./constants"
import { driveToDirectUrl, downloadToTmp, cleanupTmp } from "./fb-drive"

const VIDEO_BASE = `https://graph-video.facebook.com/${FB_GRAPH_VERSION}`

export type PageToken = {
  page_id: string
  page_name: string
  access_token: string
  category: string | null
  fan_count: number
}

export type FbPost = {
  id: string
  message: string
  created_time: string
  reactions: number
  comments: number
  shares: number
  full_picture?: string
}

class FbError extends Error {
  code?: number
  constructor(message: string, code?: number) { super(message); this.code = code }
}

async function graphGet(path: string, params: Record<string, string>): Promise<any> {
  const url = new URL(`${FB_GRAPH_BASE}${path}`)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const res = await fetch(url)
  const data = await res.json()
  if (data?.error) throw new FbError(data.error.message, data.error.code)
  return data
}

async function graphPost(path: string, body: Record<string, any>): Promise<any> {
  const res = await fetch(`${FB_GRAPH_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (data?.error) throw new FbError(data.error.message, data.error.code)
  return data
}

/** Lấy toàn bộ page (kèm page token) từ long-lived user token, gồm phân trang. */
export async function fetchAllPageTokens(): Promise<PageToken[]> {
  if (!FB_USER_TOKEN) throw new FbError("FB_USER_TOKEN chưa được cấu hình", 0)
  const out: PageToken[] = []
  let after: string | undefined
  for (let guard = 0; guard < 20; guard++) {
    const params: Record<string, string> = {
      fields: "id,name,access_token,category,fan_count",
      limit: "100",
      access_token: FB_USER_TOKEN,
    }
    if (after) params.after = after
    const data = await graphGet("/me/accounts", params)
    for (const p of data.data || []) {
      out.push({ page_id: p.id, page_name: p.name, access_token: p.access_token, category: p.category ?? null, fan_count: p.fan_count ?? 0 })
    }
    after = data.paging?.cursors?.after
    if (!after || !data.paging?.next) break
  }
  return out
}

/** Đăng text/photo lên 1 page. */
async function publishFeed(pageId: string, pageToken: string, message: string, opts: { imageUrl?: string; scheduledTime?: number }): Promise<string> {
  const body: Record<string, any> = { message, access_token: pageToken }
  if (opts.imageUrl) body.link = opts.imageUrl
  if (opts.scheduledTime) { body.published = false; body.scheduled_publish_time = opts.scheduledTime }
  const data = await graphPost(`/${pageId}/feed`, body)
  return data.id
}

/** Đăng video qua file_url (FB tự tải từ Drive direct URL). */
async function publishVideoByUrl(pageId: string, pageToken: string, message: string, fileUrl: string, scheduledTime?: number): Promise<string> {
  const body: Record<string, any> = { description: message, file_url: fileUrl, access_token: pageToken }
  if (scheduledTime) { body.published = false; body.scheduled_publish_time = scheduledTime }
  const res = await fetch(`${VIDEO_BASE}/${pageId}/videos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (data?.error) throw new FbError(data.error.message, data.error.code)
  return data.id
}

/** Upload video binary (fallback khi file_url fail). Tự xóa tmp ở finally. */
async function publishVideoBinary(pageId: string, pageToken: string, message: string, driveDirectUrl: string, scheduledTime?: number): Promise<string> {
  let tmpPath: string | null = null
  try {
    tmpPath = await downloadToTmp(driveDirectUrl)
    const buf = await fs.promises.readFile(tmpPath)
    const form = new FormData()
    form.append("description", message)
    form.append("access_token", pageToken)
    if (scheduledTime) { form.append("published", "false"); form.append("scheduled_publish_time", String(scheduledTime)) }
    form.append("source", new Blob([buf]), "video.mp4")
    const res = await fetch(`${VIDEO_BASE}/${pageId}/videos`, { method: "POST", body: form })
    const data = await res.json()
    if (data?.error) throw new FbError(data.error.message, data.error.code)
    return data.id
  } finally {
    await cleanupTmp(tmpPath)
  }
}

/**
 * Đăng 1 bài lên 1 page. Video: thử file_url → fail thì tải về upload binary → xóa.
 * Trả { post_id } hoặc throw.
 */
export async function publishPost(opts: {
  pageId: string
  pageToken: string
  message: string
  driveUrl?: string
  mediaType: "text" | "video" | "photo"
  scheduledTime?: number
}): Promise<{ post_id: string }> {
  const { pageId, pageToken, message, driveUrl, mediaType, scheduledTime } = opts

  if (mediaType === "video") {
    const direct = driveToDirectUrl(driveUrl || "")
    if (!direct) throw new FbError("Link Google Drive không hợp lệ", 0)
    try {
      const id = await publishVideoByUrl(pageId, pageToken, message, direct, scheduledTime)
      return { post_id: id }
    } catch {
      // fallback: tải về upload binary
      const id = await publishVideoBinary(pageId, pageToken, message, direct, scheduledTime)
      return { post_id: id }
    }
  }

  if (mediaType === "photo") {
    const direct = driveToDirectUrl(driveUrl || "") || driveUrl
    const id = await publishFeed(pageId, pageToken, message, { imageUrl: direct, scheduledTime })
    return { post_id: id }
  }

  const id = await publishFeed(pageId, pageToken, message, { scheduledTime })
  return { post_id: id }
}

/** Lấy posts + engagement của 1 page trong khoảng [since, until] (unix). */
export async function getPagePosts(opts: { pageId: string; pageToken: string; since: number; until: number; limit?: number }): Promise<FbPost[]> {
  const data = await graphGet(`/${opts.pageId}/posts`, {
    fields: "id,message,created_time,full_picture,reactions.summary(true),comments.summary(true),shares",
    since: String(opts.since),
    until: String(opts.until),
    limit: String(opts.limit ?? 25),
    access_token: opts.pageToken,
  })
  return (data.data || []).map((p: any) => ({
    id: p.id,
    message: p.message || "",
    created_time: p.created_time,
    reactions: p.reactions?.summary?.total_count ?? 0,
    comments: p.comments?.summary?.total_count ?? 0,
    shares: p.shares?.count ?? 0,
    full_picture: p.full_picture,
  }))
}

export function isTokenError(err: any): boolean {
  return err instanceof FbError && (err.code === 190 || err.code === 102 || err.code === 463)
}
