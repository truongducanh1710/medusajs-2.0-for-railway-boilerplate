// ============================================================================
// Fetch JSON từ Facebook Graph API — dùng chung cho mọi nhánh cost-sync / report.
//
// Trước đây 9 file tự khai báo `fetchJson` giống hệt nhau, tất cả đều là
// `fetch(url)` trần: không timeout, không retry, không check res.ok. Node fetch
// không có timeout mặc định nên một request FB treo là job treo vĩnh viễn —
// đúng lỗi đã làm fb-inbox-sync giữ slot worker và chặn toàn bộ cron queue.
// ============================================================================

const DEFAULT_TIMEOUT_MS = 25_000
const DEFAULT_RETRIES = 3

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * GET một URL Graph API, trả JSON đã parse.
 *
 * Quan trọng — hợp đồng với caller: lỗi *nghiệp vụ* của FB (`{ error: {...} }`)
 * được TRẢ VỀ nguyên dạng chứ không throw, vì mọi caller hiện tại đều kiểm tra
 * `if (data.error)` rồi tự quyết định log/break. Chỉ lỗi *tầng vận chuyển*
 * (timeout, mạng, HTTP không phải 2xx sau khi đã retry) mới throw.
 *
 * Retry: 429 và 5xx theo backoff mũ có jitter; tôn trọng `Retry-After` nếu có.
 * Lỗi 4xx khác không retry — thử lại cũng vô ích.
 */
export async function fbFetchJson(
  url: string,
  opts?: { timeoutMs?: number; retries?: number; label?: string }
): Promise<any> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const retries = opts?.retries ?? DEFAULT_RETRIES
  const label = opts?.label ? `[${opts.label}]` : "[fbFetch]"
  let lastErr: Error | undefined

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })

      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get("Retry-After") ?? 0)
        if (attempt < retries) {
          const wait = retryAfter > 0
            ? retryAfter * 1000
            : Math.min(1000 * 2 ** attempt + Math.random() * 500, 15_000)
          console.warn(`${label} HTTP ${res.status}, thử lại sau ${Math.round(wait)}ms (lần ${attempt + 1}/${retries + 1})`)
          await delay(wait)
          continue
        }
        throw new Error(`HTTP ${res.status} sau ${retries + 1} lần thử`)
      }

      // Body không phải JSON (FB thỉnh thoảng trả HTML khi lỗi hạ tầng) —
      // đọc text để thông báo còn đọc được, thay vì SyntaxError khó hiểu.
      const text = await res.text()
      try {
        return JSON.parse(text)
      } catch {
        throw new Error(`Body không phải JSON (HTTP ${res.status}): ${text.slice(0, 200)}`)
      }
    } catch (err: any) {
      lastErr = err
      const isTimeout = err?.name === "TimeoutError" || err?.name === "AbortError"
      if (attempt < retries && (isTimeout || err?.name === "TypeError")) {
        const wait = Math.min(1000 * 2 ** attempt + Math.random() * 500, 15_000)
        console.warn(`${label} ${isTimeout ? "timeout" : "lỗi mạng"}, thử lại sau ${Math.round(wait)}ms (lần ${attempt + 1}/${retries + 1})`)
        await delay(wait)
        continue
      }
      throw err
    }
  }

  throw lastErr ?? new Error(`${label} fetch thất bại`)
}
