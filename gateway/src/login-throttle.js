'use strict';

/**
 * In-memory brute-force throttle for POS login.
 *
 * The POS uses 4-digit PINs (a 10,000-value space), so an unthrottled
 * `/auth/login` is trivially brute-forceable. This adds three rolling
 * counters, any of which can trip a temporary lock:
 *
 *   u:<ip>:<login>  — the common case: one client hammering one login
 *   u:<login>       — one login guessed from many IPs (distributed PIN spray)
 *   ip:<ip>         — one host spraying many logins
 *
 * Single-process only. The compose stack runs a single gateway; if it is ever
 * scaled horizontally, move these counters to a shared store (Redis / a DB
 * table keyed the same way).
 */

const positiveInt = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

const MIN = 60 * 1000;

const CONFIG = {
  // Failures (per counter) before that counter locks.
  perClientMax: positiveInt(process.env.GATEWAY_LOGIN_MAX_FAILURES, 5),
  perLoginMax: positiveInt(process.env.GATEWAY_LOGIN_LOGIN_MAX_FAILURES, 10),
  perIpMax: positiveInt(process.env.GATEWAY_LOGIN_IP_MAX_FAILURES, 30),
  // How long a tripped counter stays locked.
  lockMs: positiveInt(process.env.GATEWAY_LOGIN_LOCK_MS, 15 * MIN),
  // Failures older than this are forgotten (rolling window).
  windowMs: positiveInt(process.env.GATEWAY_LOGIN_WINDOW_MS, 15 * MIN),
};

/** key -> { count, firstAt, lockedUntil } */
const counters = new Map();

let lastSweep = 0;
function sweep(now) {
  if (now - lastSweep < MIN) return;
  lastSweep = now;
  for (const [key, entry] of counters) {
    const dead = entry.lockedUntil
      ? entry.lockedUntil <= now
      : now - entry.firstAt > CONFIG.windowMs;
    if (dead) counters.delete(key);
  }
}

function getEntry(key, now) {
  let entry = counters.get(key);
  if (!entry || (!entry.lockedUntil && now - entry.firstAt > CONFIG.windowMs)) {
    entry = { count: 0, firstAt: now, lockedUntil: 0 };
    counters.set(key, entry);
  }
  return entry;
}

function keysFor(ip, login) {
  const safeLogin = String(login || '').trim().toLowerCase();
  return {
    client: `u:${ip}:${safeLogin}`,
    login: `u:${safeLogin}`,
    ip: `ip:${ip}`,
  };
}

/**
 * Should this attempt be rejected before checking the password?
 * @returns {{ limited: boolean, retryAfter: number }} retryAfter is seconds.
 */
function checkLogin(ip, login) {
  const now = Date.now();
  sweep(now);

  let retryAfter = 0;
  for (const key of Object.values(keysFor(ip, login))) {
    const entry = counters.get(key);
    if (entry && entry.lockedUntil > now) {
      retryAfter = Math.max(retryAfter, Math.ceil((entry.lockedUntil - now) / 1000));
    }
  }
  return { limited: retryAfter > 0, retryAfter };
}

/** Record a failed password check and lock any counter that crossed its limit. */
function recordFailure(ip, login) {
  const now = Date.now();
  const keys = keysFor(ip, login);
  const limits = {
    [keys.client]: CONFIG.perClientMax,
    [keys.login]: CONFIG.perLoginMax,
    [keys.ip]: CONFIG.perIpMax,
  };
  for (const [key, limit] of Object.entries(limits)) {
    const entry = getEntry(key, now);
    entry.count += 1;
    if (entry.count >= limit && !entry.lockedUntil) {
      entry.lockedUntil = now + CONFIG.lockMs;
    }
  }
}

/** Clear the login-scoped counters after a successful authentication. */
function recordSuccess(ip, login) {
  const keys = keysFor(ip, login);
  counters.delete(keys.client);
  counters.delete(keys.login);
  // The ip counter is intentionally left to decay on its own — one good login
  // from a host that was spraying should not immediately clear the spray.
}

/** Test / ops helper. */
function _reset() {
  counters.clear();
  lastSweep = 0;
}

module.exports = { checkLogin, recordFailure, recordSuccess, CONFIG, _reset };
