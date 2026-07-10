// node test-pda-key.js
// #2 — purge dead TornPDA-key handling. The hub always uses the RWTH custom key;
// a stored `###PDA-APIKEY###` placeholder must be treated as "no key". Verifies
// the `hasRealApiKey` predicate and the one-time hydrate() migration that nulls a
// stored PDA token. Exercises the shipped .user.js directly (ADR-0002).

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SCRIPT_PATH = path.join(__dirname, '..', 'TORN-RW-trading-hub.src.user.js');
const SCRIPT_SOURCE = fs.readFileSync(SCRIPT_PATH, 'utf8');

function makeMockStorage(seed) {
  const data = { ...(seed || {}) };
  return {
    getItem:    k => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem:    (k, v) => { data[k] = String(v); },
    removeItem: k => { delete data[k]; },
    clear:      () => { for (const k of Object.keys(data)) delete data[k]; },
  };
}

// Seed a stored PDA placeholder BEFORE require, so the require-time hydrate()
// (run under __RWTH_TEST__) exercises the migration on load.
globalThis.__RWTH_TEST__ = true;
globalThis.localStorage = makeMockStorage({
  rwth_settings: JSON.stringify({ apiKey: '###PDA-APIKEY###' }),
});
globalThis.document = {};

require('../TORN-RW-trading-hub.src.user.js');

const { hasRealApiKey, hydrate } = globalThis.__RwthPure;

test('hasRealApiKey rejects PDA placeholders and empties', () => {
  assert.strictEqual(hasRealApiKey('###PDA-APIKEY###'), false);
  assert.strictEqual(hasRealApiKey('#PDA-APIKEY#'), false);
  assert.strictEqual(hasRealApiKey('  ###PDA-APIKEY###  '), false); // trimmed
  assert.strictEqual(hasRealApiKey(''), false);
  assert.strictEqual(hasRealApiKey('   '), false);
  assert.strictEqual(hasRealApiKey(null), false);
  assert.strictEqual(hasRealApiKey(undefined), false);
});

test('hasRealApiKey accepts a real custom key', () => {
  assert.strictEqual(hasRealApiKey('abcd1234EFGH5678'), true);
});

test('require-time hydrate migration nulls a stored PDA token', () => {
  // The seeded `###PDA-APIKEY###` was migrated on load: read it back from store.
  const stored = JSON.parse(globalThis.localStorage.getItem('rwth_settings'));
  assert.strictEqual(stored.apiKey, null);
});

test('hydrate migration is idempotent and preserves a real key', () => {
  globalThis.localStorage.setItem('rwth_settings', JSON.stringify({ apiKey: 'realKEY12345' }));
  hydrate();
  hydrate(); // run twice — must be stable
  const stored = JSON.parse(globalThis.localStorage.getItem('rwth_settings'));
  assert.strictEqual(stored.apiKey, 'realKEY12345');
});

test('hydrate migration is a safe no-op on a clean install', () => {
  globalThis.localStorage.removeItem('rwth_settings');
  assert.doesNotThrow(() => hydrate());
});

test('no call site hand-rolls the PDA regex anymore (only the predicate + migration)', () => {
  // After #2 the three hand-rolled gates are gone; the only `#+PDA-APIKEY#+`
  // regex literals left are the canonical hasRealApiKey predicate and the
  // one-time hydrate() migration. All other gates route through hasRealApiKey.
  const matches = SCRIPT_SOURCE.match(/\/\^#\+PDA-APIKEY#\+\$\//g) || [];
  assert.strictEqual(matches.length, 2, 'expected exactly two PDA regexes (predicate + migration)');
});
