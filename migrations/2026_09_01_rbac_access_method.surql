-- ---------------------------------------------------------------------------
-- RBAC step 1 of 2 — record-based access method for POS users.
--
-- Adds a `posr_user` RECORD access method so SurrealDB can mint tokens whose
-- `$auth` is the signing-in `user` record. Nothing uses it until the gateway
-- is switched to GATEWAY_DB_AUTH_MODE=record; applying this migration on its
-- own changes no behaviour (the gateway still hands out a root token).
--
-- The SIGNIN clause mirrors gateway/src/auth.service.js:
--   * PIN  — 4-digit `login`, `$password` is that same value, login_method
--            'pin' or NONE.
--   * form — `login` + `$password`, login_method 'form'.
-- Both bcrypt-compare against user.password.
--
-- Step 2 (per-table PERMISSIONS) is 2026_09_01_rbac_permissions_optin.surql,
-- which is intentionally NOT part of the normal migration set.
-- ---------------------------------------------------------------------------

DEFINE ACCESS OVERWRITE posr_user ON DATABASE TYPE RECORD
  SIGNIN (
    SELECT * FROM user
    WHERE login = $login
      AND deleted_at = NONE
      AND password != NONE
      AND (
        ($method = 'pin'
          AND (login_method = 'pin' OR login_method = NONE)
          AND crypto::bcrypt::compare(password, $password))
        OR
        ($method = 'form'
          AND login_method = 'form'
          AND crypto::bcrypt::compare(password, $password))
      )
    LIMIT 1
  )
  AUTHENTICATE {
    -- Runs on every request carrying a posr_user token.
    IF !$auth.id {
      THROW "invalid session";
    };
    IF $auth.deleted_at != NONE {
      THROW "user account is disabled";
    };
    RETURN $auth;
  }
  -- Token lifetime matches the gateway session (GATEWAY_JWT_TTL, default 12h)
  -- because /auth/db-token cannot re-mint a record token without the password.
  DURATION FOR TOKEN 12h, FOR SESSION 12h;
