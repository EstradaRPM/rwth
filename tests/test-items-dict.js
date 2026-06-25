// node test-items-dict.js
// Covers the /v2/torn/items consolidation (#7): one Torn.items() fetch fans the
// single payload out to BOTH projections — rwth_items (id→name map + name→cats)
// and rwth_items_dict (byName classifier index) — with the array-vs-object shape
// unwrap written in exactly one place (normalizeItems). Drives the shipped
// userscript through __RwthPure with the transport stubbed via __RWTH_GM
// (ADR-0002), and proves the BB engine no longer re-pulls /torn/items.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

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

const GOOD_KEY = 'ABCDEF1234567890';

globalThis.__RWTH_TEST__ = true;
globalThis.localStorage = makeMockStorage();
globalThis.document = {};
// Set before require so MEM.settings hydrates with a real key (the dict fetch
// resolves the key off MEM.settings.apiKey).
localStorage.setItem('rwth_settings', JSON.stringify({ apiKey: GOOD_KEY }));

require('../TORN-RW-trading-hub.user.js');

const { normalizeItems, ItemDict, ItemClassifier, BBEngine } = globalThis.__RwthPure;

// Drive __RWTH_GM with a single onload payload, counting calls + capturing opts.
function stubGM(payload) {
  const seen = { calls: 0, opts: null };
  globalThis.__RWTH_GM = (opts) => {
    seen.calls++;
    seen.opts = opts;
    setTimeout(() => opts.onload({ status: 200, responseText: JSON.stringify(payload) }), 1);
  };
  return seen;
}

function readStore(key) {
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}

// ── normalizeItems — the one-place shape unwrap ─────────────────────────────

test('normalizeItems returns the v2 array as-is (filtering nullish entries)', () => {
  const list = normalizeItems({ items: [{ id: 1, name: 'A' }, null, { id: 2, name: 'B' }] });
  assert.deepEqual(list, [{ id: 1, name: 'A' }, { id: 2, name: 'B' }]);
});

test('normalizeItems injects the object key as id when a legacy value omits it', () => {
  const list = normalizeItems({ items: { '10': { name: 'Dune Boots' }, '20': { name: 'X' } } });
  assert.deepEqual(list, [{ id: '10', name: 'Dune Boots' }, { id: '20', name: 'X' }]);
});

test('normalizeItems preserves an id the legacy value already carries', () => {
  const list = normalizeItems({ items: { '99': { id: 7, name: 'X' } } });
  assert.deepEqual(list, [{ id: 7, name: 'X' }]);
});

test('normalizeItems tolerates a missing/empty items payload', () => {
  assert.deepEqual(normalizeItems(null), []);
  assert.deepEqual(normalizeItems({}), []);
  assert.deepEqual(normalizeItems({ items: null }), []);
});

// ── One fetch → both projections, array shape ───────────────────────────────

const ARRAY_PAYLOAD = { items: [
  { id: 1, name: 'Riot Helmet',     type: 'Armor',  rarity: 'Yellow' },
  { id: 2, name: 'Jackhammer',      type: 'Weapon', weapon_class: 'Shotgun', rarity: 'Yellow' },
  { id: 3, name: 'Small Arms Cache', type: 'Supply Pack' },
  null,
  { id: 4, name: '' },               // no name → skipped in both projections
] };

test('a single fetch (array shape) populates BOTH rwth_items and rwth_items_dict', async () => {
  localStorage.clear();
  const seen = stubGM(ARRAY_PAYLOAD);

  const byName = await ItemClassifier.fetchItemsDict({ force: true });
  assert.equal(seen.calls, 1, 'exactly one /torn/items fetch');
  assert.ok(seen.opts.url.includes('/v2/torn/items?'), seen.opts.url);

  // rwth_items — id→name map, name→category cats, schema sample.
  const items = readStore('rwth_items');
  assert.deepEqual(items.map, { 1: 'Riot Helmet', 2: 'Jackhammer', 3: 'Small Arms Cache' });
  assert.deepEqual(items.cats, { 'riot helmet': 'Armor', jackhammer: 'Primary' });
  assert.equal(items.sample.length, 3);

  // rwth_items_dict — byName classifier index (returned + persisted identically).
  const persisted = readStore('rwth_items_dict');
  assert.deepEqual(persisted.byName, byName);
  assert.deepEqual(byName['Riot Helmet'], {
    id: 1, name: 'Riot Helmet', type: 'Armor', sub_type: null, weapon_class: null, rarity: 'Yellow',
  });
  assert.deepEqual(byName.Jackhammer, {
    id: 2, name: 'Jackhammer', type: 'Weapon', sub_type: null, weapon_class: 'Shotgun', rarity: 'Yellow',
  });
  assert.equal(Object.prototype.hasOwnProperty.call(byName, ''), false);
});

// ── One fetch → both projections, legacy id-keyed object shape ──────────────

const OBJECT_PAYLOAD = { items: {
  '10': { name: 'Dune Boots',    type: 'Defensive', rarity: 'Orange' },
  '20': { name: 'ArmaLite M-15', type: 'Weapon', weapon_class: 'Rifle', rarity: 'Orange' },
} };

test('a single fetch (object shape) populates BOTH projections, id taken from the key', async () => {
  localStorage.clear();
  const seen = stubGM(OBJECT_PAYLOAD);

  const map = await ItemDict.ensure(GOOD_KEY);
  assert.equal(seen.calls, 1, 'exactly one /torn/items fetch');

  assert.deepEqual(map, { 10: 'Dune Boots', 20: 'ArmaLite M-15' });

  const items = readStore('rwth_items');
  assert.deepEqual(items.map, { 10: 'Dune Boots', 20: 'ArmaLite M-15' });
  assert.deepEqual(items.cats, { 'dune boots': 'Armor', 'armalite m-15': 'Primary' });

  const dict = readStore('rwth_items_dict');
  assert.deepEqual(dict.byName['Dune Boots'], {
    id: '10', name: 'Dune Boots', type: 'Defensive', sub_type: null, weapon_class: null, rarity: 'Orange',
  });
  assert.deepEqual(dict.byName['ArmaLite M-15'], {
    id: '20', name: 'ArmaLite M-15', type: 'Weapon', sub_type: null, weapon_class: 'Rifle', rarity: 'Orange',
  });
});

// ── Either entry point refreshes the other's cache from the one payload ─────

test('ItemDict.ensure also refreshes rwth_items_dict (one fetch, two caches)', async () => {
  localStorage.clear();
  stubGM(ARRAY_PAYLOAD);
  await ItemDict.ensure(GOOD_KEY);
  // The dict cache is now warm — a follow-up fetchItemsDict serves it without a fetch.
  const seen = stubGM(ARRAY_PAYLOAD);
  const byName = await ItemClassifier.fetchItemsDict();
  assert.equal(seen.calls, 0, 'dict served from the cache ItemDict.ensure populated');
  assert.deepEqual(byName.Jackhammer.weapon_class, 'Shotgun');
});

// ── BB engine no longer re-pulls /torn/items (the redundant third fetch) ────

test('BBEngine.fetchBBRate resolves cache ids off the shared dict — no /torn/items refetch', async () => {
  localStorage.clear();
  // Pre-warm the shared dict with the five combat-cache item ids.
  const byName = {};
  BBEngine.COMBAT_CACHES.forEach((c, i) => {
    byName[c.name] = { id: 1000 + i, name: c.name, type: 'Supply Pack', sub_type: null, weapon_class: null, rarity: null };
  });
  localStorage.setItem('rwth_items_dict', JSON.stringify({ ts: Date.now(), byName }));

  // Market listings now flow through Torn.itemMarket → gmRequest → the __RWTH_GM
  // seam (#9), the same transport the items dict would use. Record every URL and
  // hand back a flat $1000 each; the items transport must NOT fire — assert no
  // request hit /torn/items rather than a bare call count.
  const urls = [];
  globalThis.__RWTH_GM = (opts) => {
    urls.push(opts.url);
    setTimeout(() => opts.onload({ status: 200, responseText: JSON.stringify({ itemmarket: { listings: [{ price: 1000 }] } }) }), 1);
  };
  const out = await BBEngine.fetchBBRate({ force: true });
  assert.ok(out && typeof out.rate === 'number' && out.rate > 0, 'a BB rate is produced');
  assert.ok(!urls.some(u => u.includes('/torn/items')), 'no /torn/items fetch — ids came from the dict');
  assert.ok(urls.every(u => /\/market\/\d+\/itemmarket/.test(u)), 'BB pull goes through Torn.itemMarket');
  const cacheIds = readStore('rwth_bb_cache_ids');
  assert.equal(cacheIds['Small Arms Cache'], 1000);
  assert.equal(cacheIds['Heavy Arms Cache'], 1004);
});
