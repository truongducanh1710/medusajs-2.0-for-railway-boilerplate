# Product test module

This module owns the product testing workflow exposed at `/app/test-san-pham`.

## Data ownership

- `product_purchase_check` owns sourcing data and product images.
- `product_test_proposal` owns USP, combo, sale price, and landing page. It intentionally has no budget field.
- `product_test_daily_result` owns raw daily test metrics and the leader evaluation.
- Result views join Image from Purchase Check and Combo/Landing from Proposal; they never copy those fields into daily rows.
- A case may have multiple daily rows, including multiple rows on the same date.

## Workflow

Three live statuses, no approval gates:

```
draft ──(proposal has sale_price + combo_json)──> testing ──> import_approved
         automatic, nobody presses a button                └─> import_rejected
```

`draft → testing` is derived from the data by `deriveStatus()` on every proposal write, and is one-way — clearing the combo later does not demote a case that has already run. Only the leader's two terminal decisions (plus the same-status `request_more_testing`) remain as explicit actions, and each requires a comment.

Case ownership does not gate anything: holding the permission is the whole check, so filling in for a colleague can never leave a case stuck. Two data guards remain — a concluded case is read-only, and concluding requires at least one daily result row.

## Permissions

- `page.product-test.view`: read every case.
- `page.product-test.marketing`: create cases, edit proposals, enter daily results.
- `page.product-test.purchasing`: edit Purchase Check.
- `page.product-test.approve`: evaluate rows, reassign ownership, and make the final decision.

## Chat milestones

`_milestones.ts` posts a rich card into the "Test sản phẩm" MKT Chat channel (auto-created if absent) at seven points: `created`, `cost_ready`, `testing_started`, `first_result`, `more_testing`, `stalled`, `concluded`. Each carries its numbers in `metadata.facts`, which the chat page renders as a card without re-fetching the case; `content` holds a plain-text fallback for older clients and the channel-list preview. Delivery is best-effort and never rolls back the write that triggered it. Milestones that could repeat (`cost_ready`, `testing_started`, `first_result`) compare before/after state inside the same request so they fire only once.

`jobs/product-test-stalled.ts` runs daily at 09:00 and posts `stalled` for cases testing more than 7 days without new data, re-warning at most once per 7 days.

## Verification

Run `pnpm test:product` for state-machine and KPI tests. Run `pnpm build` to validate the backend and Admin bundles. Database migrations are applied by the existing `predeploy` script.
