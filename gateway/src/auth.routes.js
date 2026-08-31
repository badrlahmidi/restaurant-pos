'use strict';

const express = require('express');
const { authenticatePosUser } = require('./auth.service');
const { signSession, verifySession, revokeSession, extractBearer } = require('./jwt');
const { issueSurrealAccessToken } = require('./surreal-client');
const { checkLogin, recordFailure, recordSuccess } = require('./login-throttle');

const router = express.Router();

/**
 * Best-effort client IP. `x-forwarded-for` is only trustworthy when the gateway
 * runs behind a proxy that sets it; without one it is client-controlled, so the
 * per-login counter (which ignores IP) is what actually stops PIN spray.
 */
function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket?.remoteAddress || 'unknown';
}

router.post('/login', async (req, res) => {
  try {
    const method = req.body?.method === 'form' ? 'form' : 'pin';
    const login = req.body?.login;
    const password = req.body?.password;
    const ip = clientIp(req);

    const gate = checkLogin(ip, login);
    if (gate.limited) {
      return res
        .status(429)
        .set('Retry-After', String(gate.retryAfter))
        .json({
          ok: false,
          error: `Too many failed attempts. Try again in ${Math.ceil(gate.retryAfter / 60)} minute(s).`,
        });
    }

    const user = await authenticatePosUser({ method, login, password });
    if (!user) {
      recordFailure(ip, login);
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }

    recordSuccess(ip, login);

    const session = await signSession({
      userId: user.id,
      login: user.login,
    });

    let surrealToken = null;
    try {
      surrealToken = await issueSurrealAccessToken();
    } catch (err) {
      console.error('Failed to issue Surreal access token', err);
      return res.status(503).json({
        ok: false,
        error: 'Database session unavailable',
      });
    }

    return res.json({
      ok: true,
      token: session.token,
      expiresIn: session.expiresIn,
      surrealToken,
      user,
    });
  } catch (err) {
    console.error('login error', err);
    if (err?.kind === 'NotAllowed' || /authentication/i.test(String(err?.message || ''))) {
      return res.status(503).json({
        ok: false,
        error:
          'Database authentication failed — SURREAL_USER/SURREAL_PASS must match the existing SurrealDB root user (the --user/--pass flags only apply on an empty data directory).',
      });
    }
    return res.status(500).json({ ok: false, error: 'Login failed' });
  }
});

router.get('/session', async (req, res) => {
  try {
    const payload = await verifySession(extractBearer(req));
    return res.json({ ok: true, session: payload });
  } catch (err) {
    return res.status(err.status || 401).json({ ok: false, error: err.message });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const payload = await verifySession(extractBearer(req));
    revokeSession(payload.jti);
    return res.json({ ok: true });
  } catch {
    // Idempotent logout
    return res.json({ ok: true });
  }
});

/**
 * Refresh Surreal access token for an existing gateway session.
 * Used when the Surreal token expires but the POS session is still valid.
 */
router.post('/db-token', async (req, res) => {
  try {
    await verifySession(extractBearer(req));
    const surrealToken = await issueSurrealAccessToken();
    return res.json({ ok: true, surrealToken });
  } catch (err) {
    return res.status(err.status || 500).json({
      ok: false,
      error: err.message || 'Failed to refresh database token',
    });
  }
});

module.exports = router;
