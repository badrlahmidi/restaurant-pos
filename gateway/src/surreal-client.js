'use strict';

try {
  require('dotenv').config();
} catch {
  // Optional: server.js / compose already inject env.
}

const DB_URL = process.env.SURREAL_URL || 'ws://127.0.0.1:8000/rpc';
const DB_NS = process.env.SURREAL_NS || 'posr';
const DB_NAME = process.env.SURREAL_DB || 'posr';
const DB_USER = process.env.SURREAL_USER;
const DB_PASS = process.env.SURREAL_PASS;

// 'service' (default) — the browser's relay socket authenticates as the shared
//                       SURREAL_USER; table PERMISSIONS are bypassed (system user).
// 'record'            — each browser session gets a token scoped to its own
//                       `user` record via the `posr_user` access method, so
//                       $auth-based table PERMISSIONS apply. Requires the
//                       2026_09_01_rbac_access_method migration.
const DB_AUTH_MODE = (process.env.GATEWAY_DB_AUTH_MODE || 'service').toLowerCase() === 'record'
  ? 'record'
  : 'service';
const DB_ACCESS = process.env.GATEWAY_DB_ACCESS || 'posr_user';
if (!DB_USER || !DB_PASS) {
  throw new Error('SURREAL_USER and SURREAL_PASS are required and have no default — set them in gateway/.env');
}
if (DB_USER === 'root' && DB_PASS === 'root') {
  console.warn(
    'SURREAL_USER/SURREAL_PASS are root/root — allowed for an existing datastore; change them for new installs'
  );
}

const WS = require('ws');
const { Surreal } = require('surrealdb');

if (typeof global.WebSocket === 'undefined') {
  global.WebSocket = WS;
}
const CONNECT_TIMEOUT_MS = Number(process.env.SURREAL_CONNECT_TIMEOUT_MS || 10000);

let clientPromise = null;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

async function createClient() {
  const client = new Surreal();
  await withTimeout(
    client.connect(DB_URL, {
      namespace: DB_NS,
      database: DB_NAME,
      authentication: {
        username: DB_USER,
        password: DB_PASS,
      },
    }),
    CONNECT_TIMEOUT_MS,
    `SurrealDB connect (${DB_URL})`
  );
  return client;
}

async function getClient() {
  if (clientPromise) return clientPromise;

  clientPromise = createClient().catch((err) => {
    clientPromise = null;
    throw err;
  });

  return clientPromise;
}

function extractAccessToken(client, result) {
  const token =
    typeof result === 'string'
      ? result
      : result?.access || result?.accessToken || result?.token;
  if (token) return token;
  if (client.accessToken) return client.accessToken;
  throw new Error('SurrealDB did not return an access token');
}

/**
 * Service-mode token: signs in with the shared SURREAL_USER. The relay socket
 * that carries it is a system user, so table PERMISSIONS do not apply.
 */
async function issueServiceToken() {
  const client = new Surreal();
  try {
    await withTimeout(
      client.connect(DB_URL, {
        namespace: DB_NS,
        database: DB_NAME,
        authentication: { username: DB_USER, password: DB_PASS },
      }),
      CONNECT_TIMEOUT_MS,
      `SurrealDB connect for token (${DB_URL})`
    );
    if (client.accessToken) return client.accessToken;
    const result = await client.signin({ username: DB_USER, password: DB_PASS });
    return extractAccessToken(client, result);
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * Record-mode token: signs in through the `posr_user` access method as the
 * end user, so the relay socket's $auth is that user record and $auth-based
 * table PERMISSIONS apply. Credentials were already verified by
 * authenticatePosUser; this is a second, DB-side check via the access method.
 */
async function issueUserToken({ method, login, password }) {
  const client = new Surreal();
  try {
    await withTimeout(
      client.connect(DB_URL, { namespace: DB_NS, database: DB_NAME }),
      CONNECT_TIMEOUT_MS,
      `SurrealDB connect for user token (${DB_URL})`
    );
    const result = await client.signin({
      namespace: DB_NS,
      database: DB_NAME,
      access: DB_ACCESS,
      variables: {
        method: method === 'form' ? 'form' : 'pin',
        login: String(login || ''),
        password: String(password || ''),
      },
    });
    return extractAccessToken(client, result);
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * Fresh sign-in to obtain a Surreal access token for the browser session.
 * Root credentials never leave this process. `credentials` (method/login/
 * password) are only used in record mode.
 */
async function issueSurrealAccessToken(credentials) {
  if (DB_AUTH_MODE === 'record') {
    if (!credentials || !credentials.login) {
      throw new Error('record auth mode requires login credentials');
    }
    return issueUserToken(credentials);
  }
  return issueServiceToken();
}

async function initSurrealClient() {
  await getClient();
}

module.exports = {
  getClient,
  initSurrealClient,
  issueSurrealAccessToken,
  DB_AUTH_MODE,
  DB_ACCESS,
  DB_NS,
  DB_NAME,
};
