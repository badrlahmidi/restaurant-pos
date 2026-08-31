'use strict';

/**
 * Uses Node's built-in test runner (node --test) — this service has no test
 * framework. Config is read from env at module load, so we set small limits
 * before requiring the module under test.
 */

process.env.GATEWAY_LOGIN_MAX_FAILURES = '3';
process.env.GATEWAY_LOGIN_LOGIN_MAX_FAILURES = '5';
process.env.GATEWAY_LOGIN_IP_MAX_FAILURES = '8';
process.env.GATEWAY_LOGIN_LOCK_MS = '10000';
process.env.GATEWAY_LOGIN_WINDOW_MS = '10000';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const throttle = require('./login-throttle');

beforeEach(() => throttle._reset());

test('a client+login pair locks after GATEWAY_LOGIN_MAX_FAILURES failures', () => {
  const ip = '10.0.0.1';
  for (let i = 0; i < 3; i += 1) {
    assert.equal(throttle.checkLogin(ip, '1234').limited, false);
    throttle.recordFailure(ip, '1234');
  }
  const gate = throttle.checkLogin(ip, '1234');
  assert.equal(gate.limited, true);
  assert.ok(gate.retryAfter > 0 && gate.retryAfter <= 10);
});

test('a successful login clears the client+login counter', () => {
  const ip = '10.0.0.2';
  throttle.recordFailure(ip, '1234');
  throttle.recordFailure(ip, '1234');
  throttle.recordSuccess(ip, '1234');
  throttle.recordFailure(ip, '1234');
  assert.equal(throttle.checkLogin(ip, '1234').limited, false);
});

test('one login sprayed from many IPs still locks (per-login counter)', () => {
  for (let i = 0; i < 5; i += 1) {
    throttle.recordFailure(`192.168.1.${i}`, '9999');
  }
  // A brand-new IP is now blocked for that login.
  assert.equal(throttle.checkLogin('203.0.113.7', '9999').limited, true);
  // A different login from that fresh IP is unaffected.
  assert.equal(throttle.checkLogin('203.0.113.7', '0000').limited, false);
});

test('one IP spraying many logins locks on the per-IP counter', () => {
  const ip = '198.51.100.4';
  for (let i = 0; i < 8; i += 1) {
    throttle.recordFailure(ip, `pin-${i}`);
  }
  assert.equal(throttle.checkLogin(ip, 'never-tried').limited, true);
});

test('login is treated case- and whitespace-insensitively', () => {
  throttle.recordFailure('10.0.0.9', ' Alice ');
  throttle.recordFailure('10.0.0.9', 'alice');
  throttle.recordFailure('10.0.0.9', 'ALICE');
  assert.equal(throttle.checkLogin('10.0.0.9', 'alice').limited, true);
});
