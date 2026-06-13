import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260613000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS cost_sheet_column (
        id         VARCHAR PRIMARY KEY,
        position   INT NOT NULL,
        name       VARCHAR NOT NULL,
        col_type   VARCHAR DEFAULT 'text',
        width      INT DEFAULT 120,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS cost_sheet_row (
        id         VARCHAR PRIMARY KEY,
        position   INT NOT NULL,
        data       JSONB NOT NULL DEFAULT '{}',
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `)

    this.addSql(`CREATE INDEX IF NOT EXISTS cost_sheet_row_position_idx ON cost_sheet_row (position);`)

    // Seed 10 cột mặc định theo bảng nhân sự
    const cols = [
      { name: "STT",                      type: "text",   width: 55  },
      { name: "Sản phẩm",                 type: "text",   width: 240 },
      { name: "Tính chất",                type: "text",   width: 130 },
      { name: "Số lượng",                 type: "number", width: 90  },
      { name: "Giá EXW/sp",               type: "number", width: 110 },
      { name: "Tiền vận chuyển",          type: "number", width: 140 },
      { name: "Thuế VAT",                 type: "number", width: 110 },
      { name: "Chi phí phụ phát sinh",    type: "number", width: 160 },
      { name: "Tổng tiền",                type: "number", width: 120 },
      { name: "Giá về kho/sp",            type: "number", width: 130 },
    ]

    for (let i = 0; i < cols.length; i++) {
      const c = cols[i]
      this.addSql(
        `INSERT INTO cost_sheet_column (id, position, name, col_type, width) VALUES (gen_random_uuid(), ${i}, '${c.name}', '${c.type}', ${c.width}) ON CONFLICT DO NOTHING;`
      )
    }
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS cost_sheet_row;`)
    this.addSql(`DROP TABLE IF EXISTS cost_sheet_column;`)
  }
}
