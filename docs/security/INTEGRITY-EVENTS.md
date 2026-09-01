# Server-side integrity guards

Today every invariant on money and stock movements is maintained only by client
TypeScript (`src/lib/**`). A patched client, a crafted WebSocket frame, or a
bug in a rarely-hit path can write a negative payment, a zero-movement ledger
row, a negative tax total — and nothing on the database side stops it.

`migrations/2026_09_02_integrity_events_optin.surql` adds a small set of
**`DEFINE EVENT` validators** that read the row being written and `THROW` (which
aborts the write) when a value is obviously wrong.

## What it guards

| Table | Rejects |
|---|---|
| `order_payment` | `amount < 0`, `payable < 0` |
| `order_void` | `quantity < 0` |
| `order` | `tax_amount < 0`, `discount_amount < 0` (when set) |
| `inventory_ledger` | `unit_cost < 0`, `total_cost < 0` (when set); `quantity_change = 0` |
| `day_closing` | `cash_added < 0`, `expenses < 0`, `cash_withdrawn < 0` (when set) |

Each event is a pure validator — it never writes, so there is no event
recursion. `quantity_change` may be positive or negative (receipt vs
consumption), so it has no sign check.

## Why it is opt-in

Unlike the RBAC `PERMISSIONS` migration (which is inert until record auth mode
is on), **these events fire for every writer** — the POS session, the
service-account relay, the migration scripts, every backfill. If any existing
path legitimately writes one of these values, applying this migration breaks
that path the moment it runs.

## Rollout

1. On a copy of production, confirm nothing already violates the guards:

   ```surql
   SELECT count() FROM order_payment WHERE amount < 0 OR payable < 0;
   SELECT count() FROM order_void WHERE quantity < 0;
   SELECT count() FROM order WHERE tax_amount < 0 OR discount_amount < 0;
   SELECT count() FROM inventory_ledger
     WHERE unit_cost < 0 OR total_cost < 0 OR quantity_change = 0;
   SELECT count() FROM day_closing
     WHERE cash_added < 0 OR expenses < 0 OR cash_withdrawn < 0;
   ```

   Every count must be `0`. A non-zero count means either real corruption to
   clean up first, or a legitimate case the guard is too strict for (loosen it).

2. Apply on a canary:

   ```
   node migrations/scripts/apply-migration.cjs 2026_09_02_integrity_events_optin.surql
   ```

3. Run a full shift on the canary — sale, discount, void, refund, split,
   day closing, a kitchen stock reconciliation. A `THROW` surfaces to the
   client as a query error (and, with the app's error boundaries, a recoverable
   screen rather than a crash).

4. Roll to the fleet.

## Rollback

```surql
REMOVE EVENT order_payment_amount_guard ON TABLE order_payment;
REMOVE EVENT order_void_quantity_guard ON TABLE order_void;
REMOVE EVENT order_amount_guard ON TABLE order;
REMOVE EVENT inventory_ledger_guard ON TABLE inventory_ledger;
REMOVE EVENT day_closing_amount_guard ON TABLE day_closing;
```

## Next

Higher-value but more involved guards, once these are stable:

- Recompute-and-check the order grand total on `order_payment` / `order_item`
  writes (needs the discount/tax/service-charge maths ported to SurrealQL — do
  it as a `DEFINE FUNCTION` shared with a read path first, to keep one source
  of truth).
- Balanced-movement check on `inventory_ledger` per `reference_id`
  (sum of `quantity_change` for a document equals the document's line total).
- Append-only enforcement on `inventory_ledger` and
  `kitchen_reconciliation_revisions` (block `DELETE`; block `UPDATE` except a
  whitelist of link fields).
