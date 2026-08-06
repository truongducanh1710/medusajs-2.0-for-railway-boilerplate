# Product test module

This module owns the product testing workflow exposed at `/app/test-san-pham`.

## Data ownership

- `product_purchase_check` owns sourcing data and product images.
- `product_test_proposal` owns USP, combo, sale price, and landing page. It intentionally has no budget field.
- `product_test_daily_result` owns raw daily test metrics and the leader evaluation.
- Result views join Image from Purchase Check and Combo/Landing from Proposal; they never copy those fields into daily rows.
- A case may have multiple daily rows, including multiple rows on the same date.

## Permissions

- `page.product-test.view`: read every case.
- `page.product-test.marketing`: create cases and edit assigned proposals/results.
- `page.product-test.purchasing`: edit Purchase Check.
- `page.product-test.approve`: evaluate rows, approve stages, reassign ownership, and make the final decision.

Status changes are only accepted by the action endpoint. Every transition uses optimistic version checking and appends an audit event. Admin and MKT Chat notifications run after commit and are best-effort.

## Verification

Run `pnpm test:product` for state-machine and KPI tests. Run `pnpm build` to validate the backend and Admin bundles. Database migrations are applied by the existing `predeploy` script.
