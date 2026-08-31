'use strict';

/**
 * RPC allow-list for the Surreal WebSocket relay.
 *
 * Before this, the relay was a transparent byte pipe: once a session JWT was
 * verified on the upgrade, a client could send any SurrealDB RPC — including
 * `INFO FOR DB`, `DEFINE`/`REMOVE` via `query`, direct `signin`, etc. — against
 * the gateway's full-privilege DB connection.
 *
 * This inspects each client -> upstream frame and drops anything outside a
 * known-safe set, replying to the client with a JSON-RPC-style error instead of
 * forwarding it. It understands the two wire formats the SurrealDB JS SDK uses
 * (CBOR by default, JSON as the documented alternative); any other negotiated
 * subprotocol is refused at the handshake so nothing slips through unparsed.
 *
 * Modes (GATEWAY_RELAY_FILTER):
 *   enforce  (default) — block disallowed frames
 *   log                — allow everything, but log what would have been blocked
 *   off                — no inspection (transparent relay, pre-filter behaviour)
 *
 * Fail-open on parse errors: a frame we cannot decode is forwarded (and logged),
 * so a codec edge case can never brick the POS. We only block frames we
 * positively understand to be disallowed.
 */

const { CborCodec } = require('surrealdb');

const cbor = CborCodec.DEFAULT;

const MODE = (() => {
  const v = String(process.env.GATEWAY_RELAY_FILTER || 'enforce').toLowerCase();
  return v === 'log' || v === 'off' ? v : 'enforce';
})();

/** Wire formats we can inspect. The relay negotiates only these with clients. */
const SUPPORTED_CLIENT_PROTOCOLS = ['cbor', 'json'];

/**
 * RPC methods the POS client legitimately needs: reads, writes, session setup,
 * and live-query lifecycle. Everything else (info, signin/signup, let/unset,
 * run, graphql, …) is refused.
 */
const ALLOWED_METHODS = new Set([
  'ping',
  'use',
  'authenticate',
  'invalidate',
  'version',
  'query',
  'select',
  'create',
  'insert',
  'insert_relation',
  'update',
  'upsert',
  'merge',
  'patch',
  'delete',
  'relate',
  'live',
  'kill',
]);

/**
 * First token of any statement inside a `query` call that must never appear:
 * schema definition/removal, schema disclosure, and namespace/scope switching.
 * DDL for this app is applied out-of-band (migrations connect to SurrealDB
 * directly, not through the relay).
 */
const DENIED_QUERY_LEADERS = new Set([
  'DEFINE',
  'REMOVE',
  'REBUILD',
  'INFO',
  'USE',
  'ACCESS',
]);

const stripComments = (sql) =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n\r]*/g, ' ')
    .replace(/(^|\s)#[^\n\r]*/g, ' ');

/** @returns {string|null} the offending leading keyword, or null if the query is fine. */
function screenQueryText(sql) {
  if (typeof sql !== 'string') return null;
  const cleaned = stripComments(sql);
  for (const stmt of cleaned.split(';')) {
    const trimmed = stmt.trim();
    if (!trimmed) continue;
    const leader = trimmed.split(/\s+/, 1)[0].toUpperCase();
    if (DENIED_QUERY_LEADERS.has(leader)) return leader;
  }
  return null;
}

function decodeFrame(data, isBinary) {
  if (isBinary) {
    const buf = Buffer.isBuffer(data)
      ? data
      : Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.from(data);
    return cbor.decode(buf);
  }
  return JSON.parse(typeof data === 'string' ? data : data.toString('utf8'));
}

function encodeError(isBinary, id, message) {
  const frame = { id: id ?? null, error: { code: -32000, message } };
  if (isBinary) {
    const bytes = cbor.encode(frame);
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  return JSON.stringify(frame);
}

/**
 * Inspect one client frame.
 * @returns {{action:'forward'|'block', reason?:string, id?:unknown, isBinary:boolean}}
 */
function inspectClientFrame(data, isBinary) {
  if (MODE === 'off') return { action: 'forward', isBinary };

  let msg;
  try {
    msg = decodeFrame(data, isBinary);
  } catch (err) {
    // Fail open: forward what we cannot parse, but make the noise visible.
    console.warn('[relay-filter] undecodable frame forwarded:', err.message);
    return { action: 'forward', isBinary };
  }

  const id = msg && typeof msg === 'object' ? msg.id : undefined;
  const method = msg && typeof msg === 'object' ? msg.method : undefined;

  if (typeof method !== 'string' || !ALLOWED_METHODS.has(method)) {
    return {
      action: MODE === 'log' ? 'forward' : 'block',
      reason: `RPC method not allowed: ${typeof method === 'string' ? method : '<none>'}`,
      id,
      isBinary,
    };
  }

  if (method === 'query') {
    const params = Array.isArray(msg.params) ? msg.params : [];
    for (const part of params) {
      const bad = screenQueryText(typeof part === 'string' ? part : null);
      if (bad) {
        return {
          action: MODE === 'log' ? 'forward' : 'block',
          reason: `query statement not allowed: ${bad}`,
          id,
          isBinary,
        };
      }
    }
  }

  return { action: 'forward', isBinary };
}

module.exports = {
  MODE,
  SUPPORTED_CLIENT_PROTOCOLS,
  ALLOWED_METHODS,
  DENIED_QUERY_LEADERS,
  inspectClientFrame,
  encodeError,
  screenQueryText,
};
