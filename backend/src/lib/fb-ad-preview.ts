/**
 * Đọc nội dung khách thấy từ HTML bản xem trước quảng cáo của Facebook (/{ad}/previews → preview_iframe.php).
 * Ad dùng bài đăng có sẵn không trả tiêu đề qua creative hay post, chỉ có ở đây (props.attachmentsData[].footer).
 * Đây là cấu trúc nội bộ của Facebook, có thể đổi: không đọc được thì trả null để nơi gọi dùng dữ liệu creative.
 */

export type PreviewCard = {
  type: "video" | "image"
  video_url: string | null
  poster: string | null
  aspect_ratio: number | null
  duration_ms: number | null
  display: string | null
  headline: string | null
  description: string | null
  cta: string | null
  link: string | null
}

export type AdPreview = {
  page_name: string | null
  page_avatar: string | null
  message: string | null
  cards: PreviewCard[]
  reactions: string | null
  comments: string | null
  shares: string | null
}

const BACKSLASH = "\\"

/** Trả đoạn JSON object bắt đầu từ `start` (vị trí dấu mở ngoặc), bỏ qua ngoặc nằm trong chuỗi. */
function sliceObject(html: string, start: number): string | null {
  let depth = 0
  let inString = false
  for (let i = start; i < html.length; i++) {
    const c = html[i]
    if (inString) {
      if (c === BACKSLASH) i++
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === "{") depth++
    else if (c === "}" && --depth === 0) return html.slice(start, i + 1)
  }
  return null
}

/** Link đi qua l.facebook.com → link thật, bỏ fbclid. */
function realLink(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    const target = new URL(u.hostname === "l.facebook.com" ? u.searchParams.get("u") || url : url)
    target.searchParams.delete("fbclid")
    return target.toString()
  } catch {
    return url
  }
}

const firstUrl = (o: any): string | null =>
  (o && Object.values(o).find((v) => typeof v === "string" && v.startsWith("http"))) as string | null || null

export function parseAdPreviewHtml(html: string): AdPreview | null {
  const header = html.indexOf('"headerData":')
  if (header < 0) return null
  const props = html.lastIndexOf('"props":', header)
  if (props < 0) return null
  const raw = sliceObject(html, props + '"props":'.length)
  if (!raw) return null
  let p: any
  try {
    p = JSON.parse(raw)
  } catch {
    return null
  }
  const cards: PreviewCard[] = []
  for (const group of p.attachmentsData || []) {
    for (const a of group.attachmentDataList || []) {
      const video = a.media?.videoMediaData
      const image = a.media?.imageMediaData
      const f = a.footer || {}
      cards.push({
        type: video ? "video" : "image",
        video_url: video?.videoURISD || video?.videoURIHD || null,
        poster: video?.thumbnailURI || firstUrl(image),
        aspect_ratio: video?.aspectRatio ?? null,
        duration_ms: video?.playbackDuration ?? null,
        display: f.linkDisplay?.text || null,
        headline: f.linkTitleWithMaxLine?.text || null,
        description: f.linkDescription?.text ?? (typeof f.linkDescription === "string" ? f.linkDescription : null),
        cta: f.callToAction?.title || null,
        link: realLink(a.navigation?.link_url),
      })
    }
  }
  const fb = p.ufiData?.feedbackData || {}
  return {
    page_name: p.headerData?.actorName || p.headerData?.title || null,
    page_avatar: p.headerData?.imageURI || null,
    message: p.messageData?.shouldHideMessage ? null : p.messageData?.message || null,
    cards,
    reactions: fb.reactionCount || null,
    comments: fb.commentCount || null,
    shares: fb.shareCount || null,
  }
}
