// node test-torn-client.js
// Covers the single deep Torn client (#1, slice 2). Exercises the shipped
// userscript through __RwthPure with the transport stubbed via __RWTH_GM
// (ADR-0002): the {error:…} envelope unwrap, the comment= tag, the
// hasRealApiKey gate, the unwrapped success body, and that only spec-allowed
// params (per USED) are sent.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function makeMockStorage() {
  const data = {};
  return {
    get length() { return Object.keys(data).length; },
    key: i => Object.keys(data)[i] || null,
    getItem: k => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: k => { delete data[k]; },
    clear: () => { for (const k of Object.keys(data)) delete data[k]; },
  };
}

globalThis.__RWTH_TEST__ = true;
globalThis.localStorage = makeMockStorage();
globalThis.document = {};
localStorage.setItem('rwth_settings', JSON.stringify({ apiKey: 'SETTINGSKEY12345' }));

require('../TORN-RW-trading-hub.user.js');

const { Torn } = globalThis.__RwthPure;
const GOOD_KEY = 'ABCDEF1234567890';

// Drive __RWTH_GM with a single onload payload, capturing the request opts.
function stubGM(payload) {
  const seen = { calls: 0, opts: null };
  globalThis.__RWTH_GM = (opts) => {
    seen.calls++;
    seen.opts = opts;
    setTimeout(() => opts.onload({ status: 200, responseText: JSON.stringify(payload) }), 1);
  };
  return seen;
}

// Pull the query params off the captured request URL.
function queryParams(url) {
  return new URLSearchParams(url.slice(url.indexOf('?') + 1));
}

test('an {error:{code,error}} body becomes one tagged Error', async () => {
  const seen = stubGM({ error: { code: 2, error: 'Incorrect key' } });
  await assert.rejects(Torn.user(GOOD_KEY), (err) => {
    assert.match(err.message, /Incorrect key \(code 2\)/);
    assert.equal(err.tornCode, 2);
    return true;
  });
  assert.equal(seen.calls, 1);
});

test('user() attaches comment=rwth-test and the key', async () => {
  const seen = stubGM({ name: 'Trader', player_id: 7 });
  await Torn.user(GOOD_KEY);
  const qp = queryParams(seen.opts.url);
  assert.equal(qp.get('comment'), 'rwth-test');
  assert.equal(qp.get('key'), GOOD_KEY);
  assert.ok(seen.opts.url.includes('/v2/user?'), seen.opts.url);
});

test('no call fires when hasRealApiKey is false', async () => {
  const seen = stubGM({ name: 'Trader' });
  await assert.rejects(Torn.user(''), /No API key/);
  await assert.rejects(Torn.user('   '), /No API key/);
  await assert.rejects(Torn.user('###PDA-APIKEY###'), /No API key/);
  assert.equal(seen.calls, 0);
});

test('a successful body is returned unwrapped', async () => {
  const body = { name: 'Trader', player_id: 42, level: 50 };
  stubGM(body);
  assert.deepEqual(await Torn.user(GOOD_KEY), body);
});

test('user() falls back to MEM.settings.apiKey when no key is passed', async () => {
  const seen = stubGM({ name: 'Trader' });
  await Torn.user();
  assert.equal(queryParams(seen.opts.url).get('key'), 'SETTINGSKEY12345');
});

test('user() sends only params /user allows per the USED registry', async () => {
  const gen = await import('../tools/gen-api-registry.mjs');
  const allowed = new Set(gen.USED['/user'].used); // ['key','comment']
  const seen = stubGM({ name: 'Trader' });
  await Torn.user(GOOD_KEY);
  for (const name of queryParams(seen.opts.url).keys()) {
    assert.ok(allowed.has(name), `unexpected param "${name}" not in USED['/user']`);
  }
});

test('userBasic(id) hits /user/{id}/basic with comment=rwth-buyer and the key', async () => {
  const seen = stubGM({ name: 'Buyer', player_id: 99 });
  await Torn.userBasic(99, GOOD_KEY);
  assert.ok(seen.opts.url.includes('/v2/user/99/basic?'), seen.opts.url);
  const qp = queryParams(seen.opts.url);
  assert.equal(qp.get('comment'), 'rwth-buyer');
  assert.equal(qp.get('key'), GOOD_KEY);
});

test('userBasic() sends only params /user/{id}/basic allows per the USED registry', async () => {
  const gen = await import('../tools/gen-api-registry.mjs');
  const allowed = new Set(gen.USED['/user/{id}/basic'].used); // ['key','comment']
  const seen = stubGM({ name: 'Buyer' });
  await Torn.userBasic(99, GOOD_KEY);
  for (const name of queryParams(seen.opts.url).keys()) {
    assert.ok(allowed.has(name), `unexpected param "${name}" not in USED['/user/{id}/basic']`);
  }
});

test('userBasic falls back to MEM.settings.apiKey and unwraps the error envelope', async () => {
  const seen = stubGM({ name: 'Buyer' });
  await Torn.userBasic(99);
  assert.equal(queryParams(seen.opts.url).get('key'), 'SETTINGSKEY12345');

  stubGM({ error: { code: 6, error: 'Incorrect ID' } });
  await assert.rejects(Torn.userBasic(99, GOOD_KEY), (err) => {
    assert.match(err.message, /Incorrect ID \(code 6\)/);
    assert.equal(err.tornCode, 6);
    return true;
  });
});

// Sanity: the live userscript declares @connect api.torn.com (the one item the
// PRD calls out to verify on auto-update).
test('@connect api.torn.com is granted in the UserScript header', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'TORN-RW-trading-hub.user.js'), 'utf8');
  assert.match(src, /^\/\/ @connect\s+api\.torn\.com\s*$/m);
});
