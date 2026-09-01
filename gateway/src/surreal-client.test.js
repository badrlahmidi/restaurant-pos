'use strict';

/**
 * Regression test for the fail-open DB-credential defect: this module used
 * to fall back to a hardcoded 'root'/'root' SurrealDB credential when
 * SURREAL_USER/SURREAL_PASS were unset. It must now refuse to start without
 * real values. Each case runs in its own child process since the check runs
 * at module-load time (Node's module cache would hide it on a second import
 * in-process).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const MODULE_PATH = path.join(__dirname, 'surreal-client.js');

const BASE_ENV = { SURREAL_USER: 'realuser', SURREAL_PASS: 'realpass' };

function runInChildProcess(env) {
  return execFileSync(
    process.execPath,
    ['-e', `require(${JSON.stringify(MODULE_PATH)}); console.log('loaded-ok');`],
    { env: { ...process.env, ...env }, encoding: 'utf8' }
  );
}

function evalInChild(script, env) {
  return execFileSync(process.execPath, ['-e', script], {
    env: { ...process.env, ...BASE_ENV, ...env },
    encoding: 'utf8',
  }).trim();
}

test('throws at load time when SURREAL_USER/SURREAL_PASS are unset — no root/root fallback', () => {
  assert.throws(
    () => runInChildProcess({ SURREAL_USER: '', SURREAL_PASS: '' }),
    /SURREAL_USER and SURREAL_PASS are required/
  );
});

test('throws when only SURREAL_USER is set', () => {
  assert.throws(
    () => runInChildProcess({ SURREAL_USER: 'someuser', SURREAL_PASS: '' }),
    /SURREAL_USER and SURREAL_PASS are required/
  );
});

test('throws when only SURREAL_PASS is set', () => {
  assert.throws(
    () => runInChildProcess({ SURREAL_USER: '', SURREAL_PASS: 'somepass' }),
    /SURREAL_USER and SURREAL_PASS are required/
  );
});

test('loads with root/root — existing datastores keep the original root user', () => {
  const out = runInChildProcess({ SURREAL_USER: 'root', SURREAL_PASS: 'root' });
  assert.match(out, /loaded-ok/);
});

test('loads successfully once both are configured with real values', () => {
  const out = runInChildProcess({ SURREAL_USER: 'realuser', SURREAL_PASS: 'realpass' });
  assert.match(out, /loaded-ok/);
});

// --- DB auth mode (service vs record) ---

const PRINT_MODE = `process.stdout.write(require(${JSON.stringify(MODULE_PATH)}).DB_AUTH_MODE)`;

test('DB_AUTH_MODE defaults to service', () => {
  assert.equal(evalInChild(PRINT_MODE, {}), 'service');
});

test('GATEWAY_DB_AUTH_MODE=record selects record mode (case-insensitive)', () => {
  assert.equal(evalInChild(PRINT_MODE, { GATEWAY_DB_AUTH_MODE: 'record' }), 'record');
  assert.equal(evalInChild(PRINT_MODE, { GATEWAY_DB_AUTH_MODE: 'RECORD' }), 'record');
});

test('an unrecognised GATEWAY_DB_AUTH_MODE falls back to service', () => {
  assert.equal(evalInChild(PRINT_MODE, { GATEWAY_DB_AUTH_MODE: 'nonsense' }), 'service');
});

test('issueSurrealAccessToken rejects a credential-less call in record mode (before any DB hit)', () => {
  const script = `
    const { issueSurrealAccessToken } = require(${JSON.stringify(MODULE_PATH)});
    issueSurrealAccessToken().then(
      () => process.stdout.write('resolved'),
      (e) => process.stdout.write('rejected:' + e.message)
    );
  `;
  const out = evalInChild(script, { GATEWAY_DB_AUTH_MODE: 'record' });
  assert.match(out, /^rejected:record auth mode requires login credentials/);
});
