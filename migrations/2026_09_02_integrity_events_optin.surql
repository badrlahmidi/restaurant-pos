-- ---------------------------------------------------------------------------
-- Server-side integrity guards (OPT-IN).
--
-- ⚠️  DO NOT add this file to latest.surql or the normal migration run.
--
-- ⚠️  Unlike the RBAC PERMISSIONS migration, DEFINE EVENT fires for EVERY
--     writer — the record-scoped POS session, the service-account relay, the
--     migration scripts, and every backfill. If any existing code path
--     legitimately writes one of the values these guards reject, applying this
--     breaks that path immediately.
--
--     Before applying, on a copy of production:
--       SELECT count() FROM order_payment WHERE amount < 0 OR payable < 0;
--       SELECT count() FROM order_void WHERE quantity < 0;
--       SELECT count() FROM order WHERE tax_amount < 0 OR discount_amount < 0;
--       SELECT count() FROM inventory_ledger
--         WHERE unit_cost < 0 OR total_cost < 0 OR quantity_change = 0;
--       SELECT count() FROM day_closing
--         WHERE cash_added < 0 OR expenses < 0 OR cash_withdrawn < 0;
--     Every count must be 0. Then apply on a canary and run a full shift
--     (sale, discount, void, refund, split, closing, a stock reconciliation)
--     before rolling to the fleet.
--
-- Each event is a pure validator: it reads $after and conditionally THROWs to
-- abort the write. None of them write anything, so there is no event
-- recursion. A THROW surfaces to the client as a query error.
--
-- Rollback: REMOVE EVENT <name> ON TABLE <table>; for each below.
-- ---------------------------------------------------------------------------


-- order_payment — a tender amount is never negative (money back to the
-- customer is an order_refund, not a negative payment).
DEFINE EVENT OVERWRITE order_payment_amount_guard ON TABLE order_payment
  WHEN $event = "CREATE" OR $event = "UPDATE"
  THEN {
    IF $after.amount < 0 {
      THROW "order_payment.amount must not be negative";
    };
    IF $after.payable < 0 {
      THROW "order_payment.payable must not be negative";
    };
  };


-- order_void — cannot void a negative quantity.
DEFINE EVENT OVERWRITE order_void_quantity_guard ON TABLE order_void
  WHEN $event = "CREATE" OR $event = "UPDATE"
  THEN {
    IF $after.quantity < 0 {
      THROW "order_void.quantity must not be negative";
    };
  };


-- order — denormalised tax / discount totals are never negative.
DEFINE EVENT OVERWRITE order_amount_guard ON TABLE order
  WHEN $event = "CREATE" OR $event = "UPDATE"
  THEN {
    IF $after.tax_amount != NONE AND $after.tax_amount < 0 {
      THROW "order.tax_amount must not be negative";
    };
    IF $after.discount_amount != NONE AND $after.discount_amount < 0 {
      THROW "order.discount_amount must not be negative";
    };
  };


-- inventory_ledger — costs are non-negative; a ledger row with no movement is
-- meaningless. (quantity_change may be positive or negative — no sign check.)
DEFINE EVENT OVERWRITE inventory_ledger_guard ON TABLE inventory_ledger
  WHEN $event = "CREATE" OR $event = "UPDATE"
  THEN {
    IF $after.unit_cost != NONE AND $after.unit_cost < 0 {
      THROW "inventory_ledger.unit_cost must not be negative";
    };
    IF $after.total_cost != NONE AND $after.total_cost < 0 {
      THROW "inventory_ledger.total_cost must not be negative";
    };
    IF $after.quantity_change = 0 {
      THROW "inventory_ledger.quantity_change must not be zero";
    };
  };


-- day_closing — additive cash figures are never negative (drawer variance is
-- carried on the balance fields, which are intentionally not guarded).
DEFINE EVENT OVERWRITE day_closing_amount_guard ON TABLE day_closing
  WHEN $event = "CREATE" OR $event = "UPDATE"
  THEN {
    IF $after.cash_added < 0 {
      THROW "day_closing.cash_added must not be negative";
    };
    IF $after.expenses < 0 {
      THROW "day_closing.expenses must not be negative";
    };
    IF $after.cash_withdrawn != NONE AND $after.cash_withdrawn < 0 {
      THROW "day_closing.cash_withdrawn must not be negative";
    };
  };
