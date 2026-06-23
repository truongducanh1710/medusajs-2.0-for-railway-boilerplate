import * as fs from "fs"
import { FB_USER_TOKEN, FB_GRAPH_BASE, FB_GRAPH_VERSION } from "./constants"
import { driveToDirectUrl, downloadToTmp, cleanupTmp, isLarkFileUrl } from "./fb-drive"

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

export async function deletePost(postId: string, pageToken: string, pageId?: string): Promise<void> {
  // Scheduled video posts store a bare video ID (no "_"). Deleting it via the
  // composite {pageId}_{id} form is treated as a singular page status, which FB
  // deprecated (error #12). So try the bare ID first, and only fall back to the
  // composite feed-story form for IDs that aren't already composite.
  const candidates = !postId.includes("_") && pageId ? [postId, pageId + "_" + postId] : [postId]
  let lastError: any = null
  for (const candidate of candidates) {
    const url = new URL(FB_GRAPH_BASE + "/" + candidate)
    url.searchParams.set("access_token", pageToken)
    const res = await fetch(url, { method: "DELETE" })
    const data = await res.json()
    if (!data?.error && (data === true || data?.success === true)) return
    if (data?.error) {
      const alreadyGone = data.error.code === 100 && /unsupported get request|does not exist|cannot be loaded/i.test(data.error.message || "")
      if (alreadyGone) return
      // #12 = deprecated singular-status endpoint hit by the composite feed form;
      // not fatal — let the loop try the other candidate before giving up.
      lastError = new FbError(data.error.message, data.error.code)
      continue
    }
    lastError = new FbError("Facebook did not confirm deletion for " + candidate, 0)
  }
  throw lastError || new FbError("Facebook deletion failed", 0)
}


/**
 * Sửa nội dung 1 bài đã lên lịch (chưa publish). Dùng để fix message bị mojibake
 * mà không cần xóa + upload lại video.
 * - Video scheduled: POST /{video_id} với field `description`.
 * - Feed/photo post: POST /{post_id} với field `message`.
 * mediaType quyết định field nào FB chấp nhận.
 */
export async function editPost(
  postId: string,
  pageToken: string,
  message: string,
  mediaType: "text" | "video" | "photo" = "text",
  pageId?: string
): Promise<void> {
  let res: Response
  if (mediaType === "video") {
    // Scheduled video posts: FB requires multipart/form-data to graph-video endpoint.
    // JSON POST to graph.facebook.com/{video_id} returns #12 "singular statuses deprecated".
    const form = new FormData()
    form.append("description", message)
    form.append("access_token", pageToken)
    res = await fetch(`${VIDEO_BASE}/${postId}`, { method: "POST", body: form })
    const videoData = await res.clone().json()
    if (videoData?.error?.code === 12 && pageId) {
      const scheduled = await graphGet(`/${pageId}/scheduled_posts`, {
        fields: "id,attachments{target{id},media_type}",
        limit: "100",
        access_token: pageToken,
      })
      const storyId = pageId + "_" + postId
      const scheduledPost = (scheduled.data || []).find((item: any) => item.id === storyId || item.id === postId || String(item.id || "").endsWith("_" + postId))
      const videoId = scheduledPost?.attachments?.data?.map((attachment: any) => attachment?.target?.id).find(Boolean)
      if (!videoId) throw new FbError("Cannot resolve scheduled Facebook video ID for " + storyId, 0)

      const retryForm = new FormData()
      retryForm.append("description", message)
      retryForm.append("access_token", pageToken)
      res = await fetch(`${VIDEO_BASE}/${videoId}`, { method: "POST", body: retryForm })
    }
  } else {
    res = await fetch(`${FB_GRAPH_BASE}/${postId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, access_token: pageToken }),
    })
  }
  const data = await res.json()
  if (data?.error) throw new FbError(data.error.message, data.error.code)
  if (data?.success !== true && data?.id == null) {
    throw new FbError("Facebook did not confirm the edit", 0)
  }
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

function pathBasename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || "upload.bin"
}

async function publishPhotoBinary(pageId: string, pageToken: string, message: string, mediaUrl: string, scheduledTime?: number): Promise<string> {
  let tmpPath: string | null = null
  try {
    tmpPath = await downloadToTmp(mediaUrl)
    const buf = await fs.promises.readFile(tmpPath)
    const form = new FormData()
    form.append("access_token", pageToken)
    form.append("message", message)
    form.append("source", new Blob([buf]), pathBasename(tmpPath))
    if (scheduledTime) {
      form.append("published", "false")
      form.append("scheduled_publish_time", String(scheduledTime))
    }
    const res = await fetch(`${FB_GRAPH_BASE}/${pageId}/photos`, { method: "POST", body: form })
    const rawText = await res.text()
    let data: any
    try { data = JSON.parse(rawText) } catch { throw new Error(`FB photo parse error: ${rawText.slice(0, 300)}`) }
    if (data?.error) throw new FbError(data.error.message, data.error.code)
    return data.post_id || data.id
  } finally {
    await cleanupTmp(tmpPath)
  }
}

/** Đăng video qua file_url (FB tự tải từ Drive direct URL). */
async function publishVideoByUrl(pageId: string, pageToken: string, message: string, fileUrl: string, scheduledTime?: number, title?: string): Promise<string> {
  const body: Record<string, any> = { description: message, file_url: fileUrl, access_token: pageToken }
  if (title) body.title = title
  if (scheduledTime) { body.published = false; body.scheduled_publish_time = scheduledTime }
  const res = await fetch(`${VIDEO_BASE}/${pageId}/videos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const rawText = await res.text()
  let data: any
  try { data = JSON.parse(rawText) } catch { throw new Error(`FB parse error: ${rawText.slice(0, 300)}`) }
  if (data?.error) throw new FbError(data.error.message, data.error.code)
  return data.id
}

/** Upload video dùng FB Resumable Upload (chunked) — đúng cách cho file >10MB. */
async function publishVideoResumable(pageId: string, pageToken: string, message: string, driveDirectUrl: string, scheduledTime?: number, title?: string): Promise<string> {
  let tmpPath: string | null = null
  try {
    tmpPath = await downloadToTmp(driveDirectUrl)
    const stat = await fs.promises.stat(tmpPath)
    const fileSize = stat.size

    // Bước 1: khởi tạo upload session
    const initForm = new FormData()
    initForm.append("upload_phase", "start")
    initForm.append("access_token", pageToken)
    initForm.append("file_size", String(fileSize))
    const initRes = await fetch(`${VIDEO_BASE}/${pageId}/videos`, { method: "POST", body: initForm })
    const initText = await initRes.text()
    let initData: any
    try { initData = JSON.parse(initText) } catch { throw new Error(`FB init parse: ${initText.slice(0, 300)}`) }
    if (initData?.error) throw new FbError(initData.error.message, initData.error.code)
    const uploadSessionId = initData.upload_session_id
    const uploadedVideoId = initData.video_id || initData.id

    // Bước 2: upload từng chunk theo end_offset FB trả về
    const buf = await fs.promises.readFile(tmpPath)
    let startOffset = Number(initData.start_offset ?? 0)
    let endOffset = Number(initData.end_offset ?? fileSize)
    while (startOffset < fileSize) {
      const chunk = buf.slice(startOffset, endOffset)
      const chunkForm = new FormData()
      chunkForm.append("upload_phase", "transfer")
      chunkForm.append("access_token", pageToken)
      chunkForm.append("upload_session_id", uploadSessionId)
      chunkForm.append("start_offset", String(startOffset))
      chunkForm.append("video_file_chunk", new Blob([chunk]), "chunk.mp4")
      const chunkRes = await fetch(`${VIDEO_BASE}/${pageId}/videos`, { method: "POST", body: chunkForm })
      const chunkText = await chunkRes.text()
      let chunkData: any
      try { chunkData = JSON.parse(chunkText) } catch { throw new Error(`FB chunk parse: ${chunkText.slice(0, 300)}`) }
      if (chunkData?.error) throw new FbError(chunkData.error.message, chunkData.error.code)
      startOffset = Number(chunkData.start_offset)
      endOffset   = Number(chunkData.end_offset)
    }

    // Bước 3: finish — commit video
    const finishForm = new FormData()
    finishForm.append("upload_phase", "finish")
    finishForm.append("access_token", pageToken)
    finishForm.append("upload_session_id", uploadSessionId)
    finishForm.append("description", message)
    if (title) finishForm.append("title", title)
    if (scheduledTime) { finishForm.append("published", "false"); finishForm.append("scheduled_publish_time", String(scheduledTime)) }
    const finishRes = await fetch(`${VIDEO_BASE}/${pageId}/videos`, { method: "POST", body: finishForm })
    const finishText = await finishRes.text()
    let finishData: any
    try { finishData = JSON.parse(finishText) } catch { throw new Error(`FB finish parse: ${finishText.slice(0, 300)}`) }
    if (finishData?.error) throw new FbError(finishData.error.message, finishData.error.code)
    const resolvedId = finishData.video_id || finishData.id
    if (!resolvedId && uploadedVideoId) {
      console.warn(`[fb-graph] finish phase missing video_id, falling back to init-phase id: ${uploadedVideoId}`)
    }
    return resolvedId || uploadedVideoId
  } finally {
    await cleanupTmp(tmpPath)
  }
}

/**
 * Lấy post_id (story id) thật từ video_id. Video reel trả video_id,
 * nhưng object_story_id để boost ad + link share cần post_id của feed story.
 * Thử video_reels trước (cho reel), fallback /{video_id}?fields=post_id.
 */
async function getPostIdFromVideo(pageId: string, pageToken: string, videoId: string): Promise<string | null> {
  // Cách 1: /{video_id}?fields=post_id
  try {
    const res = await fetch(`${FB_GRAPH_BASE}/${videoId}?fields=post_id&access_token=${pageToken}`)
    const d: any = await res.json()
    if (d?.post_id) return d.post_id
  } catch { /* ignore */ }
  // Cách 2: tìm trong video_reels của page
  try {
    const res = await fetch(`${FB_GRAPH_BASE}/${pageId}/video_reels?fields=id,post_id&limit=10&access_token=${pageToken}`)
    const d: any = await res.json()
    const match = (d?.data || []).find((r: any) => r.id === videoId)
    if (match?.post_id) return match.post_id
  } catch { /* ignore */ }
  return null
}

/**
 * Đăng 1 bài lên 1 page. Video: thử file_url → fail thì tải về upload binary → xóa.
 * Trả { post_id, video_id } — post_id là story id để share/boost, video_id để tham chiếu.
 */
export async function publishPost(opts: {
  pageId: string
  pageToken: string
  message: string
  driveUrl?: string
  mediaType: "text" | "video" | "photo"
  scheduledTime?: number
  title?: string
}): Promise<{ post_id: string; video_id?: string }> {
  const { pageId, pageToken, message, driveUrl, mediaType, scheduledTime, title } = opts

  if (mediaType === "video") {
    if (driveUrl && isLarkFileUrl(driveUrl)) {
      const videoId = await publishVideoResumable(pageId, pageToken, message, driveUrl, scheduledTime, title)
      const realPostId = await getPostIdFromVideo(pageId, pageToken, videoId)
      return { post_id: realPostId || videoId, video_id: videoId }
    }

    const direct = driveToDirectUrl(driveUrl || "")
    if (!direct) throw new FbError("Link Google Drive không hợp lệ", 0)
    let videoId: string
    try {
      videoId = await publishVideoByUrl(pageId, pageToken, message, direct, scheduledTime, title)
    } catch {
      // fallback: resumable upload (chunked) — đúng cho file lớn
      videoId = await publishVideoResumable(pageId, pageToken, message, direct, scheduledTime, title)
    }
    // Lấy post_id thật của reel/video (cho share link + boost ad)
    const realPostId = await getPostIdFromVideo(pageId, pageToken, videoId)
    return { post_id: realPostId || videoId, video_id: videoId }
  }

  if (mediaType === "photo") {
    if (driveUrl && isLarkFileUrl(driveUrl)) {
      const id = await publishPhotoBinary(pageId, pageToken, message, driveUrl, scheduledTime)
      return { post_id: id }
    }

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
