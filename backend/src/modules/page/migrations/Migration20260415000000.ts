import { Migration } from "@mikro-orm/migrations"

export class Migration20260415000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `CREATE TABLE IF NOT EXISTS "page" (
        "id" text NOT NULL,
        "title" text NOT NULL,
        "slug" text NOT NULL,
        "content" text NOT NULL DEFAULT '{}',
        "status" text NOT NULL DEFAULT 'draft',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL,
        CONSTRAINT "page_pkey" PRIMARY KEY ("id")
      );`
    )
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "page_slug_unique" ON "page" ("slug");`)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "page";`)
  }
}
