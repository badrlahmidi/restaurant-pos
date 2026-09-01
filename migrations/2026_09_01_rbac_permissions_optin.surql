-- ---------------------------------------------------------------------------
-- RBAC step 2 of 2 — per-table PERMISSIONS (OPT-IN).
--
-- ⚠️  DO NOT add this file to latest.surql or the normal migration run.
--     Apply it by hand, and only after:
--       1. 2026_09_01_rbac_access_method.surql is applied
--       2. the gateway runs with GATEWAY_DB_AUTH_MODE=record
--       3. you have smoke-tested one terminal end to end
--
-- Safe to apply early anyway: in service auth mode the relay socket is a
-- system user and SurrealDB skips table PERMISSIONS entirely, so these rules
-- only take effect once a record-scoped token is in play.
--
-- Apply INCREMENTALLY. The sections below are ordered by blast radius —
-- comment out everything past the section you are testing, roll it to the
-- fleet, then uncomment the next. Re-test as a manager/admin (unchanged) and
-- as a low-privilege role (writes denied at the DB, not just hidden in the UI)
-- after each.
--
-- Rules key on `$auth.user_role.roles` — the same module-string array the
-- client RBAC (src/lib/access.rules.ts) already uses. `select` stays open to
-- any authenticated user because the POS needs this data to render; writes
-- require the relevant grant. Roles that carry only a leaf action grant and
-- not the section grant may need the CONTAINS list widened.
--
-- Rollback: re-run `DEFINE TABLE OVERWRITE <t> … PERMISSIONS NONE` (the
-- pre-RBAC state) for each table.
-- ---------------------------------------------------------------------------


-- =========================================================================
-- SECTION 1 — configuration & closing  (shipped first; smallest blast radius)
-- =========================================================================

DEFINE TABLE OVERWRITE tax TYPE ANY SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE
    FOR create, update, delete
      WHERE $auth.id != NONE AND $auth.user_role.roles CONTAINS 'admin.taxes';

DEFINE TABLE OVERWRITE discount TYPE ANY SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE
    FOR create, update, delete
      WHERE $auth.id != NONE AND $auth.user_role.roles CONTAINS 'admin.discounts';

DEFINE TABLE OVERWRITE coupon TYPE NORMAL SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE
    FOR create, update, delete
      WHERE $auth.id != NONE AND $auth.user_role.roles CONTAINS 'admin.coupons';

DEFINE TABLE OVERWRITE payment_type TYPE ANY SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE
    FOR create, update, delete
      WHERE $auth.id != NONE AND $auth.user_role.roles CONTAINS 'admin.payment_types';

DEFINE TABLE OVERWRITE day_closing TYPE NORMAL SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE
    FOR create, update
      WHERE $auth.id != NONE AND $auth.user_role.roles CONTAINS 'closing'
    FOR delete
      WHERE $auth.id != NONE AND $auth.user_role.roles CONTAINS 'closing.edit';

DEFINE TABLE OVERWRITE user_role TYPE ANY SCHEMALESS
  PERMISSIONS
    FOR select WHERE $auth.id != NONE
    FOR create, update, delete
      WHERE $auth.id != NONE AND $auth.user_role.roles CONTAINS 'admin.roles';


-- =========================================================================
-- SECTION 2 — menu & floor configuration
-- =========================================================================

DEFINE TABLE OVERWRITE category TYPE ANY SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE
    FOR create, update, delete
      WHERE $auth.id != NONE AND $auth.user_role.roles CONTAINS 'admin.categories';

DEFINE TABLE OVERWRITE modifier_group TYPE ANY SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE
    FOR create, update, delete
      WHERE $auth.id != NONE AND $auth.user_role.roles CONTAINS 'admin.modifier_groups';

DEFINE TABLE OVERWRITE modifier TYPE NORMAL SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE
    FOR create, update, delete
      WHERE $auth.id != NONE AND $auth.user_role.roles CONTAINS 'admin.modifier_groups';

DEFINE TABLE OVERWRITE menu TYPE NORMAL SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE
    FOR create, update, delete
      WHERE $auth.id != NONE
        AND ($auth.user_role.roles CONTAINS 'admin.menus'
             OR $auth.user_role.roles CONTAINS 'settings.menus');

DEFINE TABLE OVERWRITE floor TYPE ANY SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE
    FOR create, update, delete
      WHERE $auth.id != NONE AND $auth.user_role.roles CONTAINS 'admin.floors';

DEFINE TABLE OVERWRITE kitchen TYPE ANY SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE
    FOR create, update, delete
      WHERE $auth.id != NONE AND $auth.user_role.roles CONTAINS 'admin.kitchens';

DEFINE TABLE OVERWRITE order_type TYPE ANY SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE
    FOR create, update, delete
      WHERE $auth.id != NONE AND $auth.user_role.roles CONTAINS 'admin.order_types';


-- =========================================================================
-- SECTION 3 — order money & mutations
--   `select` stays open (the POS renders these on every order); writes are
--   gated on the corresponding orders.* action. Note the transactional
--   writers in src/lib (syncOrderPayments / persistOrderDiscounts /
--   syncOrderTaxes) do create + delete + upsert, so all three verbs matter.
-- =========================================================================

DEFINE TABLE OVERWRITE order_payment TYPE ANY SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE
    FOR create, update, delete
      WHERE $auth.id != NONE
        AND ($auth.user_role.roles CONTAINS 'orders.complete_payment'
             OR $auth.user_role.roles CONTAINS 'orders.update_payment'
             OR $auth.user_role.roles CONTAINS 'orders.complete');

DEFINE TABLE OVERWRITE order_tax TYPE NORMAL SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE
    FOR create, update, delete
      WHERE $auth.id != NONE AND $auth.user_role.roles CONTAINS 'orders.apply_tax';

DEFINE TABLE OVERWRITE order_discount TYPE NORMAL SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE
    FOR create, update, delete
      WHERE $auth.id != NONE AND $auth.user_role.roles CONTAINS 'orders.apply_discount';

DEFINE TABLE OVERWRITE order_coupon TYPE NORMAL SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE
    FOR create, update, delete
      WHERE $auth.id != NONE AND $auth.user_role.roles CONTAINS 'orders.apply_coupon';

DEFINE TABLE OVERWRITE order_void TYPE NORMAL SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE
    FOR create, update, delete
      WHERE $auth.id != NONE AND $auth.user_role.roles CONTAINS 'orders.cancel';

DEFINE TABLE OVERWRITE order_refund TYPE NORMAL SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE
    FOR create, update, delete
      WHERE $auth.id != NONE AND $auth.user_role.roles CONTAINS 'orders.refund';

DEFINE TABLE OVERWRITE order_split TYPE NORMAL SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE
    FOR create, update, delete
      WHERE $auth.id != NONE
        AND ($auth.user_role.roles CONTAINS 'orders.split_by_seats'
             OR $auth.user_role.roles CONTAINS 'orders.split_by_items'
             OR $auth.user_role.roles CONTAINS 'orders.split_by_amount');

DEFINE TABLE OVERWRITE order_merge TYPE NORMAL SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE
    FOR create, update, delete
      WHERE $auth.id != NONE AND $auth.user_role.roles CONTAINS 'orders.merge';


-- =========================================================================
-- SECTION 4 — pay & payroll  (money; keep this behind a manager/HR role)
-- =========================================================================

DEFINE TABLE OVERWRITE employee_pay_profile TYPE NORMAL SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE AND $auth.user_role.roles CONTAINS 'hr.pay_profiles'
    FOR create, update, delete
      WHERE $auth.id != NONE AND $auth.user_role.roles CONTAINS 'hr.pay_profiles';

DEFINE TABLE OVERWRITE labor_pay_rule TYPE NORMAL SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE AND $auth.user_role.roles CONTAINS 'hr.pay_rules'
    FOR create, update, delete
      WHERE $auth.id != NONE AND $auth.user_role.roles CONTAINS 'hr.pay_rules';

DEFINE TABLE OVERWRITE payroll_period TYPE NORMAL SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE AND $auth.user_role.roles CONTAINS 'hr.payroll_periods'
    FOR create, update, delete
      WHERE $auth.id != NONE AND $auth.user_role.roles CONTAINS 'hr.payroll_periods';

DEFINE TABLE OVERWRITE payroll_run TYPE NORMAL SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE AND $auth.user_role.roles CONTAINS 'hr.payroll_runs'
    FOR create, update, delete
      WHERE $auth.id != NONE AND $auth.user_role.roles CONTAINS 'hr.payroll_runs';
