# DB-enforced RBAC (record auth mode)

Today the browser's relay socket authenticates to SurrealDB as the shared
`SURREAL_USER`. That account is a **system user**, so SurrealDB skips every
table `PERMISSIONS` clause — all access control lives in the client
(`src/lib/access.rules.ts`, `protectAction`). A crafted WebSocket frame, or a
patched client, bypasses it.

**Record auth mode** gives each POS session a token scoped to its own `user`
record, so `$auth`-based table `PERMISSIONS` actually apply.

## Pieces

| Piece | File | Effect when applied alone |
|---|---|---|
| Access method | `migrations/2026_09_01_rbac_access_method.surql` | none — defines `posr_user`, nobody signs in with it yet |
| Gateway switch | `GATEWAY_DB_AUTH_MODE=record` | new logins get a user-scoped token instead of a service token |
| Table rules | `migrations/2026_09_01_rbac_permissions_optin.surql` | none in service mode (system user bypasses); enforced once a user token is in play |

The order is deliberate: each step is inert or reversible until the next one
lands.

## Rollout

1. **Apply the access method** (safe, part of the normal migration set):

   ```
   node migrations/scripts/apply-migration.cjs 2026_09_01_rbac_access_method.surql
   ```

2. **Deploy the gateway** with this change but still `GATEWAY_DB_AUTH_MODE=service`
   (the default). No behaviour change — verify the fleet is healthy.

3. **Flip one terminal** to `GATEWAY_DB_AUTH_MODE=record` (a dedicated gateway
   instance, or a canary). Log in and exercise every screen. The relay socket's
   `$auth` is now the user record; table rules are not applied yet, so
   everything should still work exactly as in service mode. If a screen breaks
   here, the access method or a query is the problem — fix before step 4.

   > `/auth/db-token` returns `409 RELOGIN_REQUIRED` in record mode — the
   > token is bound to the password, which the browser does not keep. Token
   > lifetime is set to 12h to match the gateway session, so this is rare.

4. **Apply the table rules** on the canary's database:

   ```
   node migrations/scripts/apply-migration.cjs 2026_09_01_rbac_permissions_optin.surql
   ```

   Re-test as a manager/admin (should be unchanged) and as a low-privilege
   role (writes to `tax`/`discount`/`coupon`/`payment_type`/`day_closing`/
   `user_role` should now be denied at the DB, not just hidden in the UI).

5. **Widen**: roll `GATEWAY_DB_AUTH_MODE=record` to the fleet, then extend
   `rbac_permissions_optin.surql` one table family at a time
   (`order_payment`, `order_void`, `order_refund`, inventory adjustments, …),
   re-testing after each.

## Rollback

- Set `GATEWAY_DB_AUTH_MODE=service` (or unset it) and redeploy the gateway —
  new logins immediately go back to service tokens. Existing record tokens keep
  working until they expire (≤12h) but are harmless.
- To drop the table rules, re-`DEFINE TABLE OVERWRITE <t> … PERMISSIONS NONE`
  (the pre-RBAC state) for each table in the opt-in migration.
- The `posr_user` access method can be left defined; it does nothing unless a
  client signs in through it.

## Notes

- The `SIGNIN` clause mirrors `gateway/src/auth.service.js` (bcrypt, pin/form).
  Keep them in sync if the login rules change.
- Rules key on `$auth.user_role.roles` — the same module-string array the
  client uses. A role that only carries a leaf grant (`admin.taxes.create`
  without `admin.taxes`) is not covered by the starter rules; widen the
  `CONTAINS` check if needed.
- Migrations run against SurrealDB directly (not through the relay), so the
  relay RPC allow-list does not block `DEFINE`.
