import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260813000000 extends Migration {
  async up(): Promise<void> {
    // Collapse the nine-status approval workflow onto four. Every waiting
    // status existed only to gate a form section, so they all fold back into
    // draft; a case that had already been approved for testing keeps testing.
    //
    // Cases sitting in a pre-testing status may already carry a complete
    // proposal, so they are promoted straight to testing here — that is the
    // same rule the API now applies on every proposal write.
    this.addSql(`
      UPDATE product_test_case c SET status = 'testing', updated_at = now()
      WHERE c.status IN (
        'awaiting_purchase_check','purchase_changes_requested','proposal_draft',
        'awaiting_test_approval','proposal_changes_requested','awaiting_final_decision'
      )
      AND EXISTS (
        SELECT 1 FROM product_test_proposal p
        WHERE p.case_id = c.id AND p.deleted_at IS NULL
          AND p.sale_price IS NOT NULL AND p.sale_price > 0
          AND p.combo_json IS NOT NULL AND trim(p.combo_json) <> ''
      )
    `);

    this.addSql(`
      UPDATE product_test_case SET status = 'draft', updated_at = now()
      WHERE status IN (
        'awaiting_purchase_check','purchase_changes_requested','proposal_draft',
        'awaiting_test_approval','proposal_changes_requested'
      )
    `);

    // awaiting_final_decision was already retired from the transition graph;
    // anything still holding it was mid-test.
    this.addSql(`
      UPDATE product_test_case SET status = 'testing', updated_at = now()
      WHERE status = 'awaiting_final_decision'
    `);
  }

  async down(): Promise<void> {
    // The pre-testing statuses carried no data of their own, so the specific
    // waiting state they encoded cannot be recovered. Landing everything on
    // proposal_draft is the closest reversible approximation.
    this.addSql(`
      UPDATE product_test_case SET status = 'proposal_draft', updated_at = now()
      WHERE status = 'draft'
    `);
  }
}
