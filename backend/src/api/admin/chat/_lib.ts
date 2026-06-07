import type { MedusaRequest } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { createHash } from "crypto"
import { Pool } from "pg"

let _pool: Pool | null = null

export function getChatPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

export type ChatAuthInfo = {
  email: string
  isSuper: boolean
  isAdmin: boolean
  fbPageIds: string[] | null
}

export async function getChatAuthInfo(req: MedusaRequest): Promise<ChatAuthInfo | null> {
  const auth = (req as any).auth_context
  if (auth?.actor_type !== "user" || !auth?.actor_id) return null
  const userModule = req.scope.resolve(Modules.USER)
  const user = await userModule.retrieveUser(auth.actor_id, { select: ["id", "email", "metadata"] })
  const isSuper = !!(user.email && user.email === process.env.SUPER_ADMIN_EMAIL)
  const perms: string[] = Array.isArray((user.metadata as any)?.permissions) ? (user.metadata as any).permissions : []
  const isAdmin = isSuper || perms.includes("users.manage")
  const raw = (user.metadata as any)?.fb_page_ids
  return {
    email: user.email || "",
    isSuper,
    isAdmin,
    fbPageIds: isAdmin ? null : (Array.isArray(raw) ? raw.map(String) : []),
  }
}

export async function ensureChatTables(pool = getChatPool()): Promise<void> {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fb_conversation (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      page_id VARCHAR(32) NOT NULL,
      page_name VARCHAR(255),
      customer_psid VARCHAR(64) NOT NULL,
      customer_name VARCHAR(255),
      avatar_url TEXT,
      assigned_to VARCHAR(255),
      status VARCHAR(32) DEFAULT 'new',
      tags TEXT[] DEFAULT '{}',
      last_message TEXT,
      last_message_at TIMESTAMPTZ,
      unread_count INT DEFAULT 0,
      bot_paused BOOLEAN DEFAULT false,
      bot_paused_reason TEXT,
      active_product_interest TEXT,
      message_window_expires_at TIMESTAMPTZ,
      handoff_reason TEXT,
      handoff_note TEXT,
      handoff_at TIMESTAMPTZ,
      handoff_by VARCHAR(32),
      priority VARCHAR(16) DEFAULT 'medium',
      assigned_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(page_id, customer_psid)
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fb_conv_status ON fb_conversation (status, priority, handoff_at)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fb_conv_page ON fb_conversation (page_id, last_message_at DESC)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fb_conv_assigned ON fb_conversation (assigned_to, last_message_at DESC)`)
  await pool.query(`ALTER TABLE fb_conversation ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fb_message (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES fb_conversation(id) ON DELETE CASCADE,
      fb_message_id VARCHAR(128),
      direction VARCHAR(16) NOT NULL,
      sender_type VARCHAR(32) NOT NULL,
      text TEXT,
      attachments JSONB DEFAULT '[]',
      raw_payload JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(fb_message_id)
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fb_msg_conv_time ON fb_message (conversation_id, created_at ASC)`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fb_conversation_context (
      conversation_id UUID PRIMARY KEY REFERENCES fb_conversation(id) ON DELETE CASCADE,
      active_window_started_at TIMESTAMPTZ,
      active_window_summary TEXT,
      active_product_interest TEXT,
      active_phone TEXT,
      active_address TEXT,
      active_order_state VARCHAR(32) DEFAULT 'new',
      active_price_reply_count INT DEFAULT 0,
      active_last_bot_reply_hash TEXT,
      historical_summary TEXT,
      historical_phone TEXT,
      historical_address TEXT,
      historical_products TEXT[] DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fb_bot_agent (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      page_id VARCHAR(32) UNIQUE NOT NULL,
      page_name VARCHAR(255),
      product_names TEXT[] DEFAULT '{}',
      product_codes TEXT[] DEFAULT '{}',
      mode VARCHAR(24) DEFAULT 'suggest',
      generated_instruction TEXT,
      generated_faq TEXT,
      generated_tone_summary TEXT,
      generated_from_sources JSONB DEFAULT '{}',
      manual_override_instruction TEXT,
      manual_override_faq TEXT,
      manual_notes TEXT,
      last_generated_at TIMESTAMPTZ,
      last_error_at TIMESTAMPTZ,
      error_count INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fb_bot_reply_example (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      page_id VARCHAR(32),
      page_name VARCHAR(255),
      product_name TEXT,
      product_code TEXT,
      customer_text TEXT NOT NULL,
      customer_intent VARCHAR(64),
      active_window_summary TEXT,
      bot_handoff_reason TEXT,
      sale_reply TEXT NOT NULL,
      sale_id VARCHAR(255),
      outcome VARCHAR(64),
      review_status VARCHAR(24) DEFAULT 'pending',
      approved_by VARCHAR(255),
      approved_at TIMESTAMPTZ,
      usage_count INT DEFAULT 0,
      success_count INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fb_reply_review ON fb_bot_reply_example (review_status, created_at DESC)`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fb_bot_event_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID REFERENCES fb_conversation(id) ON DELETE CASCADE,
      message_id UUID REFERENCES fb_message(id) ON DELETE SET NULL,
      intent VARCHAR(64),
      reply_text TEXT,
      confidence NUMERIC,
      auto_sent BOOLEAN DEFAULT false,
      skipped_reason TEXT,
      payload JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fb_conversation_event (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID REFERENCES fb_conversation(id) ON DELETE CASCADE,
      event_type VARCHAR(64) NOT NULL,
      actor_type VARCHAR(32) NOT NULL,
      actor_id VARCHAR(255),
      payload JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fb_chat_order_link (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID REFERENCES fb_conversation(id) ON DELETE CASCADE,
      medusa_order_id VARCHAR(64),
      pancake_order_id VARCHAR(64),
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `)
}

export function normalizeText(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim()
}

export function replyHash(value: string): string {
  return createHash("sha256").update(normalizeText(value)).digest("hex")
}

export function extractPhone(text: string): string | null {
  const compact = text.replace(/[^\d]/g, "")
  const match = compact.match(/(?:84|0)(?:3|5|7|8|9)\d{8}/)
  if (!match) return null
  return match[0].startsWith("84") ? "0" + match[0].slice(2) : match[0]
}

export function looksLikeAddress(text: string): string | null {
  const t = normalizeText(text)
  const hasAddressWord = /(dia chi|dc|thon|xa|phuong|quan|huyen|tp|tinh|duong|so nha|ngo|ngach|ap|khu)/.test(t)
  if (!hasAddressWord || text.length < 12) return null
  return text.trim()
}

export function detectHandoff(text: string): { reason: string; priority: string } | null {
  const t = normalizeText(text)
  if (/(gap nhan vien|nguoi that|tu van vien|sale goi|shop goi|nhan vien goi)/.test(t)) {
    return { reason: "customer_requests_human", priority: "medium" }
  }
  if (/(khieu nai|hang loi|hoan tien|doi tra|lua dao|khong giong quang cao|kem chat luong|bao hanh|tra hang)/.test(t)) {
    return { reason: "complaint", priority: "high" }
  }
  return null
}

export function detectIntent(text: string): string {
  const t = normalizeText(text)
  if (/(gia|bao nhieu|bn|price)/.test(t)) return "ask_price"
  if (/(voucher30k|voucher|ma giam|giam gia)/.test(t)) return "voucher"
  if (/(chao|titan|xung hap)/.test(t)) return "product_pan"
  if (/(noi chien|chien ngap dau|inox|nhiet ke)/.test(t)) return "product_fryer"
  if (detectHandoff(text)) return "handoff"
  if (extractPhone(text) || looksLikeAddress(text)) return "order_info"
  return "general"
}

async function getPageName(pool: Pool, pageId: string): Promise<string> {
  const { rows } = await pool.query(`SELECT page_name FROM fb_page_token WHERE page_id = $1`, [pageId]).catch(() => ({ rows: [] as any[] }))
  return rows[0]?.page_name || pageId
}

async function getMktPageByPage(pool: Pool, pageId: string, pageName: string): Promise<any | null> {
  const byName = await pool.query(
    `SELECT * FROM mkt_page WHERE lower(trim(page_name)) = lower(trim($1)) LIMIT 1`,
    [pageName]
  ).catch(() => ({ rows: [] as any[] }))
  if (byName.rows[0]) return byName.rows[0]
  const byLink = await pool.query(
    `SELECT * FROM mkt_page WHERE page_link ILIKE $1 LIMIT 1`,
    [`%${pageId}%`]
  ).catch(() => ({ rows: [] as any[] }))
  return byLink.rows[0] || null
}

function splitProducts(value: string | null | undefined): string[] {
  return String(value || "").split(",").map(s => s.trim()).filter(Boolean)
}

export async function ensureAgentForPage(pool: Pool, pageId: string, pageName?: string): Promise<any> {
  const name = pageName || await getPageName(pool, pageId)
  const existing = await pool.query(`SELECT * FROM fb_bot_agent WHERE page_id = $1`, [pageId])
  if (existing.rows[0]) return existing.rows[0]

  const mktPage = await getMktPageByPage(pool, pageId, name)
  const products = splitProducts(mktPage?.sp_chay)
  const instruction = [
    `Ban la tro ly ban hang cho Facebook Page "${name}".`,
    products.length ? `Page nay dang chay san pham: ${products.join(", ")}.` : "Chua co san pham dang chay trong Marketing Hub, chi goi y va chuyen sale khi khong chac.",
    "Luon uu tien context 24h gan nhat. Lich su cu chi de tham khao tone.",
    "Khong lap lai cau da gui trong 24h. Khong hoi lai SĐT/dia chi neu khach da gui.",
    "Gap khieu nai, hoan tien, doi tra phuc tap thi handoff cho sale/CSKH.",
  ].join("\n")

  const inserted = await pool.query(
    `INSERT INTO fb_bot_agent (page_id, page_name, product_names, mode, generated_instruction, generated_from_sources, last_generated_at)
     VALUES ($1,$2,$3,'suggest',$4,$5,now())
     ON CONFLICT (page_id) DO UPDATE SET
       page_name = EXCLUDED.page_name,
       product_names = EXCLUDED.product_names,
       generated_instruction = EXCLUDED.generated_instruction,
       generated_from_sources = EXCLUDED.generated_from_sources,
       last_generated_at = now(),
       updated_at = now()
     RETURNING *`,
    [pageId, name, products, instruction, { mkt_page_id: mktPage?.id ?? null, source: "auto" }]
  )
  return inserted.rows[0]
}

export async function upsertIncomingMessage(opts: {
  pageId: string
  psid: string
  text: string
  fbMessageId?: string
  attachments?: any[]
  raw?: any
  createdAt?: Date
}): Promise<{ conversation: any; message: any; agent: any; handoff: ReturnType<typeof detectHandoff> }> {
  const pool = getChatPool()
  await ensureChatTables(pool)
  const pageName = await getPageName(pool, opts.pageId)
  const agent = await ensureAgentForPage(pool, opts.pageId, pageName)
  const messageAt = opts.createdAt || new Date()
  const windowExpires = new Date(messageAt.getTime() + 24 * 3600 * 1000)
  const handoff = detectHandoff(opts.text)

  const conv = await pool.query(
    `INSERT INTO fb_conversation
      (page_id, page_name, customer_psid, status, last_message, last_message_at, unread_count, message_window_expires_at, handoff_reason, handoff_at, handoff_by, priority, bot_paused)
     VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (page_id, customer_psid) DO UPDATE SET
       page_name = EXCLUDED.page_name,
       last_message = EXCLUDED.last_message,
       last_message_at = EXCLUDED.last_message_at,
       unread_count = fb_conversation.unread_count + 1,
       message_window_expires_at = EXCLUDED.message_window_expires_at,
       status = CASE WHEN EXCLUDED.handoff_reason IS NOT NULL THEN EXCLUDED.status ELSE fb_conversation.status END,
       handoff_reason = COALESCE(EXCLUDED.handoff_reason, fb_conversation.handoff_reason),
       handoff_at = COALESCE(EXCLUDED.handoff_at, fb_conversation.handoff_at),
       handoff_by = COALESCE(EXCLUDED.handoff_by, fb_conversation.handoff_by),
       priority = CASE WHEN EXCLUDED.handoff_reason IS NOT NULL THEN EXCLUDED.priority ELSE fb_conversation.priority END,
       bot_paused = CASE WHEN EXCLUDED.handoff_reason IS NOT NULL THEN true ELSE fb_conversation.bot_paused END,
       updated_at = now()
     RETURNING *`,
    [
      opts.pageId,
      pageName,
      opts.psid,
      handoff?.reason === "complaint" ? "complaint" : handoff ? "handoff" : "new",
      opts.text,
      messageAt,
      windowExpires,
      handoff?.reason ?? null,
      handoff ? messageAt : null,
      handoff ? "bot" : null,
      handoff?.priority ?? "medium",
      !!handoff,
    ]
  )
  const conversation = conv.rows[0]

  const msg = await pool.query(
    `INSERT INTO fb_message (conversation_id, fb_message_id, direction, sender_type, text, attachments, raw_payload, created_at)
     VALUES ($1,$2,'inbound','customer',$3,$4,$5,$6)
     ON CONFLICT (fb_message_id) DO UPDATE SET raw_payload = fb_message.raw_payload
     RETURNING *`,
    [conversation.id, opts.fbMessageId || null, opts.text, JSON.stringify(opts.attachments || []), JSON.stringify(opts.raw || {}), messageAt]
  )
  await refreshConversationContext(pool, conversation.id)
  if (handoff) {
    await logConversationEvent(pool, conversation.id, "bot_handoff_created", "bot", null, handoff)
  }
  await processBotDecision(pool, conversation.id, msg.rows[0].id, opts.text, agent, !!handoff)
  return { conversation, message: msg.rows[0], agent, handoff }
}

async function processBotDecision(pool: Pool, conversationId: string, messageId: string, text: string, agent: any, hasHandoff: boolean) {
  const conv = await pool.query(`SELECT * FROM fb_conversation WHERE id = $1`, [conversationId])
  const c = conv.rows[0]
  if (!c || c.bot_paused || hasHandoff || agent?.mode === "off" || agent?.mode === "paused_by_error") {
    await logBotEvent(pool, conversationId, messageId, detectIntent(text), null, false, hasHandoff ? "handoff_required" : "bot_disabled_or_paused")
    return
  }

  const ctx = await refreshConversationContext(pool, conversationId)
  const reply = buildRuleReply(text, agent, ctx)
  if (!reply) {
    await logBotEvent(pool, conversationId, messageId, detectIntent(text), null, false, "no_safe_rule")
    return
  }

  const hash = replyHash(reply)
  if (ctx.active_last_bot_reply_hash && ctx.active_last_bot_reply_hash === hash) {
    await logBotEvent(pool, conversationId, messageId, detectIntent(text), reply, false, "repeat_risk")
    return
  }
  if (ctx.active_price_reply_count >= 2 && detectIntent(text) === "ask_price") {
    await logBotEvent(pool, conversationId, messageId, detectIntent(text), reply, false, "price_reply_limit")
    return
  }

  const canAuto = agent?.mode === "auto_24h" && c.message_window_expires_at && new Date(c.message_window_expires_at).getTime() > Date.now()
  if (!canAuto) {
    await logBotEvent(pool, conversationId, messageId, detectIntent(text), reply, false, agent?.mode === "suggest" ? "suggest_only" : "outside_24h")
    return
  }

  try {
    const fb = await sendFacebookMessage(c.page_id, c.customer_psid, reply)
    const saved = await pool.query(
      `INSERT INTO fb_message (conversation_id, fb_message_id, direction, sender_type, text, raw_payload)
       VALUES ($1,$2,'outbound','bot',$3,$4) RETURNING *`,
      [conversationId, fb?.message_id || null, reply, JSON.stringify({ fb })]
    )
    await pool.query(`UPDATE fb_conversation SET last_message = $2, last_message_at = now(), status = 'bot_handling', updated_at = now() WHERE id = $1`, [conversationId, reply])
    await logBotEvent(pool, conversationId, saved.rows[0]?.id || messageId, detectIntent(text), reply, true, null)
    await refreshConversationContext(pool, conversationId)
  } catch (e: any) {
    await pool.query(`UPDATE fb_bot_agent SET error_count = error_count + 1, last_error_at = now(), mode = CASE WHEN error_count + 1 >= 3 THEN 'paused_by_error' ELSE mode END WHERE page_id = $1`, [c.page_id])
    await logBotEvent(pool, conversationId, messageId, detectIntent(text), reply, false, `send_failed: ${e.message}`)
  }
}

function buildRuleReply(text: string, agent: any, ctx: any): string | null {
  const intent = detectIntent(text)
  const products: string[] = Array.isArray(agent?.product_names) ? agent.product_names : []
  const productLabel = ctx.active_product_interest || products[0] || "san pham"

  if (intent === "voucher") {
    return "Da em da luu ma giam gia 30K cho anh/chị roi a. Anh/chị cho em xin so dien thoai va dia chi nhan hang de em len don ap dung uu dai cho minh nha."
  }
  if (intent === "order_info") {
    const missing = []
    if (!ctx.active_phone) missing.push("so dien thoai")
    if (!ctx.active_address) missing.push("dia chi nhan hang")
    if (!missing.length) return "Em da nhan du thong tin. Anh/chị de y dien thoai, nhan vien ben em se goi xac nhan don hang cho minh a."
    return `Em nhan duoc thong tin roi a. Anh/chị cho em xin them ${missing.join(" va ")} de em len don cho minh nha.`
  }
  if (products.length > 1 && !ctx.active_product_interest && !/(chao|titan|noi chien|inox)/i.test(normalizeText(text))) {
    return `Chao anh/chị, hien page dang co ${products.join(" va ")}. Anh/chị muon em tu van san pham nao de em ho tro nhanh nhat a?`
  }
  if (intent === "ask_price" || intent === "product_pan" || intent === "product_fryer" || intent === "general") {
    return `Da hien ben em dang tu van ${productLabel}. Anh/chị cho em xin nhu cau hoac so dien thoai va dia chi nhan hang de em ho tro chot don nhanh nhat a.`
  }
  return null
}

async function logBotEvent(pool: Pool, conversationId: string, messageId: string | null, intent: string, replyText: string | null, autoSent: boolean, skippedReason: string | null) {
  await pool.query(
    `INSERT INTO fb_bot_event_log (conversation_id, message_id, intent, reply_text, confidence, auto_sent, skipped_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [conversationId, messageId, intent, replyText, replyText ? 0.72 : 0, autoSent, skippedReason]
  )
}

export async function refreshConversationContext(pool: Pool, conversationId: string): Promise<any> {
  const activeStart = new Date(Date.now() - 24 * 3600 * 1000)
  const active = await pool.query(
    `SELECT * FROM fb_message WHERE conversation_id = $1 AND created_at >= $2 ORDER BY created_at ASC`,
    [conversationId, activeStart]
  )
  const historical = await pool.query(
    `SELECT * FROM fb_message WHERE conversation_id = $1 AND created_at < $2 ORDER BY created_at DESC LIMIT 50`,
    [conversationId, activeStart]
  )
  const activeText = active.rows.map((m: any) => `${m.sender_type}: ${m.text || ""}`).join("\n").slice(-4000)
  const historyText = historical.rows.reverse().map((m: any) => `${m.sender_type}: ${m.text || ""}`).join("\n").slice(-2500)
  const combined = active.rows.map((m: any) => m.text || "").join("\n")
  const phone = extractPhone(combined)
  const address = active.rows.map((m: any) => looksLikeAddress(m.text || "")).find(Boolean) || null
  const intentTexts = active.rows.filter((m: any) => m.direction === "inbound").map((m: any) => m.text || "").join(" ")
  const intent = detectIntent(intentTexts)
  const priceCount = active.rows.filter((m: any) => m.sender_type !== "customer" && /(giá|gia|799|499|1\.499|1499)/i.test(m.text || "")).length
  const lastBot = [...active.rows].reverse().find((m: any) => m.sender_type === "bot" && m.text)

  const upsert = await pool.query(
    `INSERT INTO fb_conversation_context
      (conversation_id, active_window_started_at, active_window_summary, active_phone, active_address, active_order_state, active_price_reply_count, active_last_bot_reply_hash, historical_summary, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
     ON CONFLICT (conversation_id) DO UPDATE SET
       active_window_started_at = EXCLUDED.active_window_started_at,
       active_window_summary = EXCLUDED.active_window_summary,
       active_phone = EXCLUDED.active_phone,
       active_address = EXCLUDED.active_address,
       active_order_state = EXCLUDED.active_order_state,
       active_price_reply_count = EXCLUDED.active_price_reply_count,
       active_last_bot_reply_hash = EXCLUDED.active_last_bot_reply_hash,
       historical_summary = EXCLUDED.historical_summary,
       updated_at = now()
     RETURNING *`,
    [
      conversationId,
      activeStart,
      activeText,
      phone,
      address,
      phone && address ? "ready_to_order" : intent === "order_info" ? "collecting_info" : "consulting",
      priceCount,
      lastBot?.text ? replyHash(lastBot.text) : null,
      historyText,
    ]
  )
  return upsert.rows[0]
}

export async function logConversationEvent(pool: Pool, conversationId: string, eventType: string, actorType: string, actorId: string | null, payload: any = {}) {
  await pool.query(
    `INSERT INTO fb_conversation_event (conversation_id, event_type, actor_type, actor_id, payload)
     VALUES ($1,$2,$3,$4,$5)`,
    [conversationId, eventType, actorType, actorId, JSON.stringify(payload)]
  )
}

export async function sendFacebookMessage(pageId: string, psid: string, text: string): Promise<any> {
  const pool = getChatPool()
  const { rows } = await pool.query(`SELECT access_token FROM fb_page_token WHERE page_id = $1`, [pageId])
  const pageToken = rows[0]?.access_token
  if (!pageToken) throw new Error("Khong tim thay Page access token")
  const res = await fetch(`https://graph.facebook.com/v20.0/me/messages?access_token=${pageToken}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: psid },
      messaging_type: "RESPONSE",
      message: { text },
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.error) throw new Error(data?.error?.message || `Facebook send failed ${res.status}`)
  return data
}
