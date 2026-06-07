import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createHmac, timingSafeEqual } from "crypto"
import { Pool } from "pg"
import { upsertIncomingMessage } from "../../chat/_lib"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

const FB_VERIFY_TOKEN = process.env.FB_WEBHOOK_VERIFY_TOKEN || "phv_fb_webhook_2026"
const FB_APP_SECRET = process.env.FB_APP_SECRET || ""

function verifySignature(rawBody: string, signature: string | null): boolean {
  if (!FB_APP_SECRET) return true
  if (!signature) return false
  try {
    const expected = "sha256=" + createHmac("sha256", FB_APP_SECRET).update(rawBody).digest("hex")
    const a = Buffer.from(expected)
    const b = Buffer.from(signature)
    return a.length === b.length && timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/** GET — Facebook verify handshake */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const mode = req.query["hub.mode"]
  const token = req.query["hub.verify_token"]
  const challenge = req.query["hub.challenge"]
  if (mode === "subscribe" && token === FB_VERIFY_TOKEN) {
    console.log("[FB Webhook] Verified successfully")
    return res.status(200).send(challenge)
  }
  return res.status(403).json({ error: "Verification failed" })
}

/** POST — Facebook push events */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  // Verify signature
  const sig = (req.headers["x-hub-signature-256"] as string) || null
  const rawBody = JSON.stringify(req.body)
  if (!verifySignature(rawBody, sig)) {
    console.warn("[FB Webhook] Invalid signature")
    return res.status(403).json({ error: "Invalid signature" })
  }

  // Respond 200 immediately — Facebook expects fast response
  res.status(200).json({ success: true })

  const body = req.body as any
  if (body?.object !== "page") return

  const pool = getPool()

  for (const entry of body.entry ?? []) {
    const pageId = String(entry.id)
    for (const event of entry.messaging ?? []) {
      const senderId = String(event?.sender?.id || "")
      const message = event?.message
      const postback = event?.postback
      const text = String(message?.text || postback?.title || postback?.payload || "").trim()
      if (!senderId || !text) continue
      if (message?.is_echo) continue

      try {
        await upsertIncomingMessage({
          pageId,
          psid: senderId,
          text,
          fbMessageId: message?.mid || postback?.mid || `${pageId}:${senderId}:${event.timestamp || Date.now()}`,
          attachments: message?.attachments || [],
          raw: event,
          createdAt: event.timestamp ? new Date(Number(event.timestamp)) : new Date(),
        })
        console.log(`[FB Chat Webhook] Saved message page=${pageId} psid=${senderId}`)
      } catch (e: any) {
        console.error("[FB Chat Webhook] DB error:", e.message)
      }
    }

    for (const change of entry.changes ?? []) {
      if (change.field !== "feed") continue
      const v = change.value
      // Chỉ xử lý bài đăng mới (status update = bài viết)
      if (v?.item !== "status" && v?.item !== "post") continue
      if (v?.verb !== "add") continue

      const postId = v.post_id || v.value?.post_id
      if (!postId) continue

      const message = v.message || v.value?.message || ""
      const createdTime = v.created_time ? new Date(v.created_time * 1000).toISOString() : new Date().toISOString()

      try {
        await pool.query(`
          INSERT INTO fb_scheduled_post (page_id, post_id, message, status, published_at, created_by, media_type)
          VALUES ($1, $2, $3, 'published', $4, 'facebook_webhook', 'text')
          ON CONFLICT (post_id) DO UPDATE SET
            message = EXCLUDED.message,
            published_at = EXCLUDED.published_at
        `, [pageId, postId, message, createdTime])
        console.log(`[FB Webhook] Saved post ${postId} from page ${pageId}`)
      } catch (e: any) {
        console.error("[FB Webhook] DB error:", e.message)
      }
    }
  }
}
