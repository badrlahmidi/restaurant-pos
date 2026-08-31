'use strict';

/**
 * node --test — no framework (matches jwt.test.js / login-throttle.test.js).
 * The default mode is `enforce`; the `log` / `off` variants are checked in a
 * child process because MODE is read once at module load.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { CborCodec } = require('surrealdb');

const cbor = CborCodec.DEFAULT;
const {
  inspectClientFrame,
  encodeError,
  screenQueryText,
} = require('./rpc-filter');

const cborFrame = (obj) => Buffer.from(cbor.encode(obj));
const jsonFrame = (obj) => Buffer.from(JSON.stringify(obj), 'utf8');

test('allows a plain SELECT query (cbor)', () => {
  const v = inspectClientFrame(cborFrame({ id: '1', method: 'query', params: ['SELECT * FROM order'] }), true);
  assert.equal(v.action, 'forward');
});

test('allows a plain SELECT query (json)', () => {
  const v = inspectClientFrame(jsonFrame({ id: '1', method: 'query', params: ['SELECT * FROM order'] }), false);
  assert.equal(v.action, 'forward');
});

test('allows the session/live methods the SDK needs', () => {
  for (const method of ['ping', 'use', 'authenticate', 'select', 'create', 'update', 'delete', 'live', 'kill']) {
    const v = inspectClientFrame(cborFrame({ id: 'x', method, params: [] }), true);
    assert.equal(v.action, 'forward', `expected ${method} to be allowed`);
  }
});

test('blocks disallowed RPC methods and echoes the id', () => {
  for (const method of ['info', 'signin', 'signup', 'let', 'unset', 'run', 'graphql']) {
    const v = inspectClientFrame(cborFrame({ id: 'req-7', method, params: [] }), true);
    assert.equal(v.action, 'block', `expected ${method} to be blocked`);
    assert.equal(v.id, 'req-7');
  }
});

test('blocks DDL / disclosure statements inside query()', () => {
  for (const sql of [
    'DEFINE TABLE evil SCHEMALESS',
    'REMOVE TABLE order',
    'INFO FOR DB',
    'USE NS other DB other',
    'REBUILD INDEX foo ON bar',
    'SELECT 1; DEFINE FIELD x ON y TYPE string',
  ]) {
    const v = inspectClientFrame(cborFrame({ id: '9', method: 'query', params: [sql] }), true);
    assert.equal(v.action, 'block', `expected "${sql}" to be blocked`);
  }
});

test('comment-hidden keywords do not falsely trip the screen', () => {
  assert.equal(screenQueryText('-- DEFINE TABLE x\nSELECT 1'), null);
  assert.equal(screenQueryText('SELECT * FROM t /* REMOVE TABLE t */'), null);
  assert.equal(screenQueryText('SELECT "DEFINE not a keyword here"'), null);
});

test('comment-hidden DDL that is actually executed is still blocked', () => {
  assert.equal(screenQueryText('/* hi */ DEFINE TABLE x'), 'DEFINE');
});

test('fails open on an undecodable frame', () => {
  const v = inspectClientFrame(Buffer.from([0xff, 0x00, 0x13, 0x37]), true);
  assert.equal(v.action, 'forward');
});

test('encodeError round-trips (cbor + json)', () => {
  const bin = encodeError(true, 'abc', 'nope');
  const decoded = cbor.decode(Buffer.from(bin));
  assert.equal(decoded.id, 'abc');
  assert.equal(decoded.error.message, 'nope');

  const txt = JSON.parse(encodeError(false, 'abc', 'nope'));
  assert.equal(txt.id, 'abc');
  assert.equal(txt.error.message, 'nope');
});

function inspectInChild(mode, frameJson, isBinary) {
  const script = `
    const { inspectClientFrame } = require(${JSON.stringify(path.join(__dirname, 'rpc-filter.js'))});
    const { CborCodec } = require('surrealdb');
    const obj = ${JSON.stringify(frameJson)};
    const data = ${isBinary}
      ? Buffer.from(CborCodec.DEFAULT.encode(obj))
      : Buffer.from(JSON.stringify(obj), 'utf8');
    process.stdout.write(inspectClientFrame(data, ${isBinary}).action);
  `;
  return execFileSync(process.execPath, ['-e', script], {
    env: { ...process.env, GATEWAY_RELAY_FILTER: mode },
    encoding: 'utf8',
  });
}

test('mode=log forwards what enforce would block', () => {
  assert.equal(inspectInChild('log', { id: '1', method: 'info', params: [] }, true), 'forward');
});

test('mode=off forwards without inspection', () => {
  assert.equal(inspectInChild('off', { id: '1', method: 'info', params: [] }, true), 'forward');
});
