-- ---------------------------------------------------------------------------
-- RBAC step 2 of 2 — per-table PERMISSIONS on a starter set (OPT-IN).
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
-- Rules key on `$auth.user_role.roles` — the same module-string array the
-- client RBAC (src/lib/access.rules.ts) already uses. `select` stays open to
-- any authenticated user because the POS needs this reference data to run;
-- writes require the section grant. Roles that only carry a leaf action grant
-- (e.g. `admin.taxes.create` without `admin.taxes`) are not covered here —
-- widen the CONTAINS check if your role setup needs it.
--
-- Rollback: re-run with `PERMISSIONS NONE` (the pre-RBAC state) for each table.
-- ---------------------------------------------------------------------------

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
