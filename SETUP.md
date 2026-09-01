# ritaj-posr — setup & working guide

Private working mirror of **restaurant-pos** (a React + SurrealDB restaurant
POS). Base upstream: `github.com/ahmedali5530/restaurant-pos`, licensed under
the POSR Source Available License (see `LICENSE`). This mirror carries the
security / correctness hardening branch on top of that base.

> This is a private repo. The upstream code is *source-available*, not open
> source — check the PSAL in `LICENSE` before sharing or redeploying it.

---

## 1. Branches

| Branch | What it is |
|---|---|
| `master` | Upstream base, unchanged (`ahmedali5530/restaurant-pos` @ the fork point). |
| `aronium-theme` | Styling-only reskin (sober corporate-blue "Aronium" theme). One commit. |
| `chore/hardening` | **The working branch.** 19 commits of audit fixes (P0/P1/P2) on top of `master`. Start here. |

`chore/hardening` does **not** include the theme — the two are independent.

---

## 2. Clone

```bash
git clone https://github.com/badrlahmidi/ritaj-posr.git
cd ritaj-posr
git checkout chore/hardening
```

### Install

```bash
# Frontend. `npm ci` does NOT work yet — package-lock.json is out of sync with
# package.json upstream and the dep tree needs legacy peer resolution
# (eslint 8 + @typescript-eslint 6). Regenerate the lockfile to switch to npm ci.
npm install --legacy-peer-deps

# Gateway has its own (in-sync) lockfile.
cd gateway && npm ci && cd ..
```

Node 20+ (CI pins 20). Windows/macOS/Linux all fine.

---

## 3. Run

### Everything, via Docker Compose

```bash
cp .env.example .env         # then set SURREAL_USER / SURREAL_PASS / GATEWAY_JWT_SECRET
docker compose up
```

Brings up: SurrealDB (v3), the auth gateway (:3142), the app (Vite :5173), and
the print / payment / sync / tracking / api sidecars. See `docker-compose.yml`
for the full topology and per-service `.env` layering.

### Frontend only (against an already-running gateway + DB)

```bash
npm run dev
```

### The sidecars, standalone

```bash
npm run api-server        # AI / OpenAI proxy (:3140)
npm run payment-server    # Stripe / PayPal / … (:3134)
npm run print-server      # ESC/POS (:3132)
npm run tracking-server   # delivery tracking (:3138)
```

---

## 4. Verify

```bash
npx tsc --noEmit                       # 0 errors
DISCOUNT_PERF_BUDGET_MS=600 npm test   # 325 pass (the perf test is machine-sensitive)
npm run lint                           # 0 errors (~290 warnings = documented backlog)
npx vite build                         # succeeds
cd gateway && npm test && cd ..        # 31 pass
```

CI runs all of the above on push / PR (`.github/workflows/ci.yml`).

---

## 5. What the hardening branch changes

Full detail in PR #2 on the fork and in the commit messages. Summary:

**P0**
- Error boundaries (top-level + per-route, auto-reset on navigation).
- CI pipeline (`.github/workflows/ci.yml`).
- Gateway login brute-force throttle (`gateway/src/login-throttle.js`).

**P1**
- Surreal RPC allow-list on the WS relay (`gateway/src/rpc-filter.js`,
  `GATEWAY_RELAY_FILTER=enforce|log|off`).
- `runWriteTransaction` (`src/lib/db-transaction.ts`) — order tax / discount /
  payment sync and every kitchen-reconciliation write are now atomic.
- DB-enforced RBAC groundwork: `GATEWAY_DB_AUTH_MODE=service|record` +
  `migrations/2026_09_01_rbac_access_method.surql` +
  `migrations/2026_09_01_rbac_permissions_optin.surql` (24 tables, 4 sections).
- Opt-in server-side integrity guards
  (`migrations/2026_09_02_integrity_events_optin.surql`).

**P2**
- ESLint repaired (eslint 8) + CI lint gate is blocking on errors.
- Removed 8 dead deps, 106 dead imports (+ `no-unused-imports` CI rule), dead
  functions; `useDB()` memoised; `no-unused-vars` 319 → ~290.

### Opt-in migrations — apply deliberately, not in the normal run

| File | Guide |
|---|---|
| `migrations/2026_09_01_rbac_access_method.surql` | `docs/security/RBAC-DB-PERMISSIONS.md` |
| `migrations/2026_09_01_rbac_permissions_optin.surql` | same doc — section-by-section canary rollout |
| `migrations/2026_09_02_integrity_events_optin.surql` | `docs/security/INTEGRITY-EVENTS.md` — pre-flight `SELECT count()` checks first |

Each has a header explaining apply order and rollback. In `service` auth mode
the RBAC `PERMISSIONS` are inert (system user bypasses); the integrity EVENTs
are **not** inert (they fire for every writer).

---

## 6. Still open (needs a running stack)

- `eslint --fix` pass for the 250 `react-hooks/exhaustive-deps` warnings —
  `db` and `t` are now safe to add; watch for render loops from the ~25
  in-component `load*` / `fetch*` deps and wrap those in `useCallback`.
- Smoke-test the RBAC record mode and each `PERMISSIONS` section on a canal
  gateway; watch the gateway log for `[relay-filter] blocked:` lines.
- Stale-client-after-reconnect check for the `useDB()` memoisation.
- `button.tsx` — `disabled` is destructured but never applied to `<AriaButton>`
  (renders enabled); needs `isDisabled={disabled}` + a UI check.
- Split the 11 files > 1000 lines; a real TanStack Query cache strategy
  (`gcTime: 0` everywhere today).

---

## 7. CI on this account

GitHub Actions is currently **blocked by an account-level billing lock** on
`badrlahmidi` — runs fail before a runner is allocated. Clear it at
`github.com/settings/billing`, then re-trigger with:

```bash
gh run rerun <run-id> --repo badrlahmidi/ritaj-posr
```
