// node test-rwth-scan.js
// Focused RWTH scan/import tests against the shipped userscript seam.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

function makeMockStorage() {
  const data = {};
  return {
    getItem:    k => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem:    (k, v) => { data[k] = String(v); },
    removeItem: k => { delete data[k]; },
    clear:      () => { for (const k of Object.keys(data)) delete data[k]; },
  };
}

globalThis.__RWTH_TEST__ = true;
globalThis.localStorage = makeMockStorage();
globalThis.document = {};

require('../TORN-RW-trading-hub.user.js');

const P = globalThis.__RwthPure;

const cats = {
  'diamond bladed knife': 'Melee',
  'riot body': 'Armor',
};

test('scan log constants include RW buy, sale, mug, and trade sources', () => {
  assert.strictEqual(P.SCAN_LOG_TYPES.auctionBuy, 4320);
  assert.strictEqual(P.SCAN_LOG_TYPES.itemMarketBuy, 1112);
  assert.strictEqual(P.SCAN_LOG_TYPES.bazaarBuy, 1225);
  assert.strictEqual(P.SCAN_LOG_TYPES.auctionSale, 4322);
  assert.strictEqual(P.SCAN_LOG_TYPES.itemMarketSale, 1113);
  assert.strictEqual(P.SCAN_LOG_TYPES.bazaarSale, 1226);
  assert.strictEqual(P.SCAN_LOG_TYPES.mugged, 8156);
  assert.deepStrictEqual(
    [
      P.SCAN_LOG_TYPES.tradeItemA,
      P.SCAN_LOG_TYPES.tradeItemB,
      P.SCAN_LOG_TYPES.tradeMoneyA,
      P.SCAN_LOG_TYPES.tradeMoneyB,
    ].sort(),
    [4440, 4441, 4445, 4446].sort(),
  );
});

test('selected scan log types cover all three buy sources when buys is on', () => {
  assert.deepStrictEqual(P.selectedScanLogTypes({
    buys: true,
    sales: false,
    trades: false,
    mugs: false,
  }), [P.SCAN_LOG_TYPES.auctionBuy, P.SCAN_LOG_TYPES.itemMarketBuy, P.SCAN_LOG_TYPES.bazaarBuy]);
});

test('legacy item dictionary cache can still supply auction-win names', () => {
  const cached = {
    schema: 1,
    ts: 1779368765000,
    map: { 614: 'Diamond Bladed Knife' },
  };

  assert.strictEqual(P.itemDictCacheUsable(cached), false);
  assert.deepStrictEqual(P.itemDictNameMapFromCache(cached), cached.map);
});

test('classifyLogEvent parses buy logs from action text when data.item is absent', () => {
  const row = P.classifyLogEvent({
    id: 'buy-market-1',
    timestamp: 1779280000,
    action: 'You bought 1x Diamond Bladed Knife on the item market from SellerName at $75,000,000 each for a total of $75,000,000',
    data: {},
  }, P.SCAN_LOG_TYPES.itemMarketBuy, 'buy-market-1', {}, cats);

  assert.strictEqual(row.type, 'buy');
  assert.strictEqual(row.hit.eventKey, '1112:buy-market-1');
  assert.strictEqual(row.hit.itemName, 'Diamond Bladed Knife');
  assert.strictEqual(row.hit.buySource, 'market');
  assert.strictEqual(row.hit.buyPrice, 75_000_000);
  assert.strictEqual(row.hit.category, 'Melee');
});

test('buildScanSetup renders a compact date and source selector', () => {
  const html = P.buildScanSetup(
    { buys: true, sales: true, trades: false, mugs: true },
    '2026-06-01',
    false,
  );
  assert.match(html, /data-scan-back-to/);
  assert.match(html, /value="2026-06-01"/);
  assert.match(html, /data-scan-source="buys" checked/);
  assert.match(html, /data-scan-source="sales" checked/);
  assert.match(html, /data-scan-source="trades"/);
  assert.doesNotMatch(html, /data-scan-source="trades" checked/);
  assert.match(html, /data-action="run-scan"/);
});

test('scan log failure summary names the failing source', () => {
  assert.strictEqual(P.scanLogTypeLabel(P.SCAN_LOG_TYPES.tradeMoneyA), 'trade money A');
  const text = P.scanLogFailureSummary([
    { logType: P.SCAN_LOG_TYPES.tradeMoneyA, error: 'Access denied (code 7)' },
    { logType: P.SCAN_LOG_TYPES.mugged, error: 'Temporary error' },
  ]);
  assert.match(text, /trade money A: Access denied \(code 7\)/);
  assert.match(text, /mugs: Temporary error/);
});

test('classifyLogEvent parses item-market sale logs into sell rows', () => {
  const row = P.classifyLogEvent({
    id: 'sale-1',
    timestamp: 1779372185,
    data: {
      item: [{ id: 614, name: 'Diamond Bladed Knife' }],
      price: 100_000_000,
      net: 95_000_000,
      fees: 5_000_000,
      buyer: 'BuyerName',
    },
  }, P.SCAN_LOG_TYPES.itemMarketSale, 'sale-1', {}, cats);

  assert.strictEqual(row.type, 'sale');
  assert.strictEqual(row.eventKey, '1113:sale-1');
  assert.strictEqual(row.sell.itemName, 'Diamond Bladed Knife');
  assert.strictEqual(row.sell.venue, 'market');
  assert.strictEqual(row.sell.saleNet, 95_000_000);
  assert.strictEqual(row.sell.buyer, 'BuyerName');
});

test('buildScanPreview matches RW sales and skips already-imported event ids', () => {
  const sale = P.classifyLogEvent({
    id: 'sale-2',
    timestamp: 1779372185,
    data: {
      item: [{ id: 614, name: 'Diamond Bladed Knife' }],
      net: 120_000_000,
      buyer: 'BuyerName',
    },
  }, P.SCAN_LOG_TYPES.bazaarSale, 'sale-2', {}, cats);
  const old = P.classifyLogEvent({
    id: 'sale-old',
    timestamp: 1779372100,
    data: { item: [{ name: 'Riot Body' }], net: 75_000_000 },
  }, P.SCAN_LOG_TYPES.bazaarSale, 'sale-old', {}, cats);

  const preview = P.buildScanPreview([sale, old], {
    seen: { 1226: ['sale-old'] },
    cats,
    items: [{ id: 'held-1', itemName: 'Diamond Bladed Knife', status: 'listed', bonuses: [] }],
    transactions: [],
  });

  assert.strictEqual(preview.sales.length, 1);
  assert.strictEqual(preview.sales[0].matchedId, 'held-1');
  assert.strictEqual(preview.already.length, 1);
});

test('buildScanPreview reconciles same-scan backloaded buy, sale, and mug', () => {
  const boughtAt = 1779280000;
  const soldAt = 1779372185;
  const buy = P.classifyLogEvent({
    id: 'buy-1',
    timestamp: boughtAt,
    data: {
      item: { id: 614, uid: 19121539308, name: 'Diamond Bladed Knife' },
      final_price: 75_000_000,
    },
  }, P.SCAN_LOG_TYPES.auctionBuy, 'buy-1', {}, {});
  const sale = P.classifyLogEvent({
    id: 'sale-1',
    timestamp: soldAt,
    data: {
      item: { id: 614, name: 'Diamond Bladed Knife' },
      net: 120_000_000,
      buyer: 'BuyerName',
    },
  }, P.SCAN_LOG_TYPES.bazaarSale, 'sale-1', {}, {});
  const mug = P.classifyLogEvent({
    id: 'mug-1',
    timestamp: soldAt + 120,
    data: { cash: 8_000_000, attacker: 'Mugger' },
  }, P.SCAN_LOG_TYPES.mugged, 'mug-1', {}, {});

  const preview = P.buildScanPreview([buy, sale, mug], {
    cats: {},
    items: [],
    transactions: [],
  });

  assert.strictEqual(preview.buys.length, 1);
  assert.strictEqual(preview.ignored.length, 0);
  assert.strictEqual(preview.sales.length, 1);
  assert.match(preview.sales[0].matchedId, /^scan-buy:/);
  // Mugs are standalone flat cash now (not tied to any sale/item) — see the
  // "stages a mug as flat cash" test in test-rwth.js. The same-scan buy still
  // reconciles into the sale via a scan-buy stagedId.
  assert.strictEqual(preview.mugs.length, 1);
  assert.strictEqual('matchedId' in preview.mugs[0], false);
  assert.strictEqual(preview.mugs[0].mug.amount, 8_000_000);
});

test('buildScanPreview keeps unclassified non-auction buys visible but unchecked', () => {
  const boughtAt = 1779280000;
  const soldAt = 1779372185;
  const buy = P.classifyLogEvent({
    id: 'buy-unknown',
    timestamp: boughtAt,
    action: 'You bought 1x Diamond Bladed Knife on the item market from SellerName at $75,000,000 each for a total of $75,000,000',
    data: {},
  }, P.SCAN_LOG_TYPES.itemMarketBuy, 'buy-unknown', {}, {});
  const sale = P.classifyLogEvent({
    id: 'sale-action',
    timestamp: soldAt,
    action: 'You sold 1x Diamond Bladed Knife on your bazaar to BuyerName at $120,000,000 each for a total of $120,000,000',
    data: {},
  }, P.SCAN_LOG_TYPES.bazaarSale, 'sale-action', {}, {});
  const mug = P.classifyLogEvent({
    id: 'mug-action',
    timestamp: soldAt + 120,
    action: 'You were mugged by 1580562 and lost $8,000,000',
    data: { user: 1580562 },
  }, P.SCAN_LOG_TYPES.mugged, 'mug-action', {}, {});

  const preview = P.buildScanPreview([buy, sale, mug], {
    cats: {},
    items: [],
    transactions: [],
  });

  assert.strictEqual(preview.buys.length, 1);
  assert.strictEqual(preview.buys[0].checked, false);
  assert.strictEqual(preview.buys[0].itemName, 'Diamond Bladed Knife');
  assert.strictEqual(preview.sales.length, 1);
  assert.match(preview.sales[0].matchedId, /^scan-buy:/);
  // Mugs are standalone flat cash now (not tied to any sale/item).
  assert.strictEqual(preview.mugs.length, 1);
  assert.strictEqual('matchedId' in preview.mugs[0], false);
  assert.strictEqual(preview.mugs[0].mug.amount, 8_000_000);
});

test('applyItemDetails stamps category from itemdetails when the item cache is stale', () => {
  const hit = P.applyItemDetails({
    itemName: 'Benelli M4 Super',
    category: null,
    type: 'weapon',
    bonuses: [],
    quality: null,
    rarity: null,
  }, {
    name: 'Benelli M4 Super',
    type: 'Secondary',
    rarity: 'yellow',
    stats: { quality: 64.5 },
    bonuses: [{ title: 'Fury', value: 42 }],
  });

  assert.strictEqual(hit.category, 'Secondary');
  assert.strictEqual(hit.type, 'weapon');
  assert.strictEqual(hit.quality, 64.5);
  assert.deepStrictEqual(hit.bonuses, [{ name: 'Fury', value: 42 }]);
});

test('simple RW trade becomes a buy; mixed trade stays review', () => {
  const simple = P.reconcileTradeGroup([
    {
      eventKey: '4440:item-in',
      kind: 'tradeItem',
      direction: 'in',
      item: { itemId: 614, itemName: 'Diamond Bladed Knife' },
      category: 'Melee',
      isRw: true,
      timestamp: 1779372185000,
    },
    {
      eventKey: '4445:money-out',
      kind: 'tradeMoney',
      direction: 'out',
      amount: 80_000_000,
      timestamp: 1779372185000,
    },
  ], {}, cats);

  assert.strictEqual(simple.type, 'buy');
  assert.strictEqual(simple.hit.buySource, 'trade');
  assert.strictEqual(simple.hit.buyPrice, 80_000_000);

  const mixed = P.reconcileTradeGroup([
    {
      eventKey: '4440:rw-item',
      kind: 'tradeItem',
      direction: 'in',
      item: { itemId: 614, itemName: 'Diamond Bladed Knife' },
      category: 'Melee',
      isRw: true,
    },
    {
      eventKey: '4440:xanax',
      kind: 'tradeItem',
      direction: 'in',
      item: { itemName: 'Xanax' },
      category: null,
      isRw: false,
    },
    {
      eventKey: '4445:money-out',
      kind: 'tradeMoney',
      direction: 'out',
      amount: 80_000_000,
    },
  ], {}, cats);

  assert.strictEqual(mixed.type, 'review');
});

test('tradeUser pulls the counterparty id, prefers an id over an ambiguous name, and ignores objects', () => {
  // Numeric id field → string id (resolved to a name downstream).
  assert.strictEqual(P.tradeUser({ data: { user_id: 1580562 } }), '1580562');
  assert.strictEqual(P.tradeUser({ data: { user: '1580562' } }), '1580562');
  // A real username with no id field passes through.
  assert.strictEqual(P.tradeUser({ data: { name: 'BuyerName' } }), 'BuyerName');
  // An id present alongside a name (e.g. item-leg `name` is the item) → id wins.
  assert.strictEqual(P.tradeUser({ data: { user_id: 42, name: 'Diamond Bladed Knife' } }), '42');
  // Object/array values (e.g. data.user as a nested object) are ignored.
  assert.strictEqual(P.tradeUser({ data: { user: { id: 7 } } }), null);
  assert.strictEqual(P.tradeUser({ data: {} }), null);
});

test('a RW trade SALE carries the counterparty id through to the buyer', () => {
  const sale = P.reconcileTradeGroup([
    {
      eventKey: '4441:item-out',
      kind: 'tradeItem',
      direction: 'out',
      item: { itemId: 614, itemName: 'Diamond Bladed Knife' },
      category: 'Melee',
      isRw: true,
      timestamp: 1779372185000,
      user: '1580562',
    },
    {
      eventKey: '4446:money-in',
      kind: 'tradeMoney',
      direction: 'in',
      amount: 90_000_000,
      timestamp: 1779372185000,
      user: '1580562',
    },
  ], {}, cats);

  assert.strictEqual(sale.type, 'sale');
  assert.strictEqual(sale.sell.venue, 'trade');
  assert.strictEqual(sale.sell.saleNet, 90_000_000);
  // The blank-buyer bug: this must be the counterparty id, not null.
  assert.strictEqual(sale.sell.buyer, '1580562');
});

test('matchSell will not close a held row against a different-uid sale', () => {
  const held = [{
    id: 'held-rw', itemName: 'Enfield SA-80', uid: 111, status: 'held', bonuses: [],
  }];
  // Same name, different physical instance (the plain non-RW variant) -> no match.
  assert.strictEqual(P.matchSell({ itemName: 'Enfield SA-80', uid: 222, saleNet: 5 }, held), null);
  // Same uid -> closes the exact instance.
  assert.strictEqual(
    P.matchSell({ itemName: 'Enfield SA-80', uid: 111, saleNet: 90 }, held).id, 'held-rw');
});

test('matchSell still closes legacy rows with no recorded uid by name', () => {
  const held = [{ id: 'legacy', itemName: 'Diamond Bladed Knife', status: 'listed', bonuses: [] }];
  assert.strictEqual(
    P.matchSell({ itemName: 'Diamond Bladed Knife', uid: 999 }, held).id, 'legacy');
});

test('buildScanPreview routes a non-RW variant sale to recent, not the held RW row', () => {
  const buy = P.classifyLogEvent({
    id: 'buy-rw',
    timestamp: 1779280000,
    data: { item: { id: 614, uid: 111, name: 'Diamond Bladed Knife' }, final_price: 75_000_000 },
  }, P.SCAN_LOG_TYPES.auctionBuy, 'buy-rw', {}, cats);
  // The user later sells a *standard* DBK (different uid) cheaply.
  const sale = P.classifyLogEvent({
    id: 'sale-nonrw',
    timestamp: 1779372185,
    data: { item: [{ id: 614, uid: 222, name: 'Diamond Bladed Knife' }], net: 18_000_000, buyer: 'Buyer' },
  }, P.SCAN_LOG_TYPES.itemMarketSale, 'sale-nonrw', {}, cats);

  const preview = P.buildScanPreview([buy, sale], { cats, items: [], transactions: [] });

  assert.strictEqual(preview.buys.length, 1);
  assert.strictEqual(preview.sales.length, 1);
  // Must NOT attach the cheap non-RW sale to the held RW buy.
  assert.strictEqual(preview.sales[0].matchedId, null);
});

test('buildScanPreview ignores an unrelated bazaar sale that is not an RW item', () => {
  // Selling something that isn't RW armor/weapon (drugs, plushies, junk) — its
  // name is absent from the cats index, so it resolves to no category. With no
  // matching open ledger row it must be IGNORED, never staged as income.
  const sale = P.classifyLogEvent({
    id: 'sale-junk',
    timestamp: 1779372185,
    action: 'You sold 100x Xanax on your bazaar to BuyerName at $850,000 each for a total of $85,000,000',
    data: { item: [{ id: 206, name: 'Xanax' }], net: 85_000_000, buyer: 'BuyerName' },
  }, P.SCAN_LOG_TYPES.bazaarSale, 'sale-junk', {}, cats);

  const preview = P.buildScanPreview([sale], {
    cats,
    items: [{ id: 'held-rw', itemName: 'Riot Body', status: 'held', bonuses: [] }],
    transactions: [],
  });

  assert.strictEqual(preview.sales.length, 0);
  assert.strictEqual(preview.ignored.length, 1);
  assert.strictEqual(preview.ignored[0].reason, 'non-RW sale');
  assert.strictEqual(preview.ignored[0].itemName, 'Xanax');
});

// NOTE: removed "mug events attach only when one sold row is clearly nearby" —
// mugs no longer attach to a nearby sold row. They are staged as standalone flat
// cash (no matchedId); see the flat-cash mug tests in test-rwth.js.
