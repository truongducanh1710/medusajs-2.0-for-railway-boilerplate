import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260607000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`)
    this.addSql(`
      CREATE TABLE IF NOT EXISTS fb_conversation (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        page_id VARCHAR(32) NOT NULL,
        page_name VARCHAR(255),
        customer_psid VARCHAR(64) NOT NULL,
        customer_name VARCHAR(255),
        avatar_url TEXT,
        assigned_to VARCHAR(255),
        assigned_at TIMESTAMPTZ,
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
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE(page_id, customer_psid)
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS idx_fb_conv_status ON fb_conversation (status, priority, handoff_at);`)
    this.addSql(`CREATE INDEX IF NOT EXISTS idx_fb_conv_page ON fb_conversation (page_id, last_message_at DESC);`)
    this.addSql(`CREATE INDEX IF NOT EXISTS idx_fb_conv_assigned ON fb_conversation (assigned_to, last_message_at DESC);`)
    this.addSql(`
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
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS idx_fb_msg_conv_time ON fb_message (conversation_id, created_at ASC);`)
    this.addSql(`
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
      );
    `)
    this.addSql(`
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
      );
    `)
    this.addSql(`
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
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS idx_fb_reply_review ON fb_bot_reply_example (review_status, created_at DESC);`)
    this.addSql(`
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
      );
    `)
    this.addSql(`
      CREATE TABLE IF NOT EXISTS fb_conversation_event (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID REFERENCES fb_conversation(id) ON DELETE CASCADE,
        event_type VARCHAR(64) NOT NULL,
        actor_type VARCHAR(32) NOT NULL,
        actor_id VARCHAR(255),
        payload JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `)
    this.addSql(`
      CREATE TABLE IF NOT EXISTS fb_chat_order_link (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID REFERENCES fb_conversation(id) ON DELETE CASCADE,
        medusa_order_id VARCHAR(64),
        pancake_order_id VARCHAR(64),
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS fb_chat_order_link CASCADE;`)
    this.addSql(`DROP TABLE IF EXISTS fb_conversation_event CASCADE;`)
    this.addSql(`DROP TABLE IF EXISTS fb_bot_event_log CASCADE;`)
    this.addSql(`DROP TABLE IF EXISTS fb_bot_reply_example CASCADE;`)
    this.addSql(`DROP TABLE IF EXISTS fb_bot_agent CASCADE;`)
    this.addSql(`DROP TABLE IF EXISTS fb_conversation_context CASCADE;`)
    this.addSql(`DROP TABLE IF EXISTS fb_message CASCADE;`)
    this.addSql(`DROP TABLE IF EXISTS fb_conversation CASCADE;`)
  }
}
