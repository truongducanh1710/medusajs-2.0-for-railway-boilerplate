import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260717040000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS leave_request (
        id TEXT NOT NULL,
        requester_email TEXT NOT NULL,
        leave_type TEXT NOT NULL,
        start_at TIMESTAMPTZ NOT NULL,
        end_at TIMESTAMPTZ NOT NULL,
        reason TEXT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        reviewer_email TEXT NULL,
        reviewed_at TIMESTAMPTZ NULL,
        review_note TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ NULL,
        CONSTRAINT leave_request_pkey PRIMARY KEY (id)
      )
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS leave_request_status_idx ON leave_request (status, requester_email)`)
    this.addSql(`CREATE INDEX IF NOT EXISTS leave_request_requester_idx ON leave_request (requester_email, created_at)`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS leave_request`)
  }
}
