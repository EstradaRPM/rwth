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

require('../TORN-RW-trading-hub.src.user.js');

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

test('buildScanSettingsPopup renders the relocated sources, back-to, add-item and paste-sale affordances', () => {
  const html = P.buildScanSettingsPopup({
    settings: { scanSources: { buys: true, sales: true, trades: false, mugs: true }, scanBackTo: '2026-06-01' },
    ledger: {},
  });
  // Source checkboxes (with sync attributes) + scan-back-to override.
  assert.match(html, /data-scan-back-to/);
  assert.match(html, /value="2026-06-01"/);
  assert.match(html, /data-scan-source="buys" checked/);
  assert.match(html, /data-scan-source="sales" checked/);
  assert.match(html, /data-scan-source="trades"/);
  assert.doesNotMatch(html, /data-scan-source="trades" checked/);
  // The two manual fallbacks: "+ add item" and the relocated paste-sale box.
  assert.match(html, /data-action="add-item"/);
  assert.match(html, /data-sell-input/);
  assert.match(html, /data-action="parse-sells"/);
  // A close control, and no retired Run-scan / Scan-logs trigger.
  assert.match(html, /data-action="close-scan-settings"/);
  assert.doesNotMatch(html, /data-action="run-scan"/);
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
  // The RW sale names its armoury uid (verified: RW sales carry the uid on every
  // channel), so it uid-exact matches the held instance carrying the same uid.
  const sale = P.classifyLogEvent({
    id: 'sale-2',
    timestamp: 1779372185,
    data: {
      item: [{ id: 614, uid: 6141, name: 'Diamond Bladed Knife' }],
      net: 120_000_000,
      buyer: 'BuyerName',
    },
  }, P.SCAN_LOG_TYPES.bazaarSale, 'sale-2', {}, cats);
  const old = P.classifyLogEvent({
    id: 'sale-old',
    timestamp: 1779372100,
    data: { item: [{ id: 614, uid: 6142, name: 'Diamond Bladed Knife' }], net: 75_000_000 },
  }, P.SCAN_LOG_TYPES.bazaarSale, 'sale-old', {}, cats);

  const preview = P.buildScanPreview([sale, old], {
    seen: { 1226: ['sale-old'] },
    cats,
    items: [{ id: 'held-1', itemName: 'Diamond Bladed Knife', uid: 6141, status: 'listed', bonuses: [] }],
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
  // The RW instance's own sale names its uid (verified: RW sales carry the uid on
  // every channel), so it uid-exact matches the same-scan staged buy.
  const sale = P.classifyLogEvent({
    id: 'sale-1',
    timestamp: soldAt,
    data: {
      item: { id: 614, uid: 19121539308, name: 'Diamond Bladed Knife' },
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
  // The item-market buy carries the armoury uid (real RW logs do) but no category
  // hint, so it stays visible-but-unchecked; its RW sale names the same uid and
  // uid-exact matches the same-scan staged buy.
  const buy = P.classifyLogEvent({
    id: 'buy-unknown',
    timestamp: boughtAt,
    action: 'You bought 1x Diamond Bladed Knife on the item market from SellerName at $75,000,000 each for a total of $75,000,000',
    data: { item: [{ id: 614, uid: 3001 }] },
  }, P.SCAN_LOG_TYPES.itemMarketBuy, 'buy-unknown', {}, {});
  const sale = P.classifyLogEvent({
    id: 'sale-action',
    timestamp: soldAt,
    action: 'You sold 1x Diamond Bladed Knife on your bazaar to BuyerName at $120,000,000 each for a total of $120,000,000',
    data: { items: [{ id: 614, uid: 3001 }] },
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

test('buildScanPreview drops a non-RW variant sale entirely — matched-only import', () => {
  const buy = P.classifyLogEvent({
    id: 'buy-rw',
    timestamp: 1779280000,
    data: { item: { id: 614, uid: 111, name: 'Diamond Bladed Knife' }, final_price: 75_000_000 },
  }, P.SCAN_LOG_TYPES.auctionBuy, 'buy-rw', {}, cats);
  // The user later sells a *standard* DBK (different uid) cheaply. It shares the
  // RW name but the value guard refuses to close the held RW row, so it is
  // unmatched — and a sale log carries no rarity/bonus to prove it RW on its own.
  const sale = P.classifyLogEvent({
    id: 'sale-nonrw',
    timestamp: 1779372185,
    data: { item: [{ id: 614, uid: 222, name: 'Diamond Bladed Knife' }], net: 18_000_000, buyer: 'Buyer' },
  }, P.SCAN_LOG_TYPES.itemMarketSale, 'sale-nonrw', {}, cats);

  const preview = P.buildScanPreview([buy, sale], { cats, items: [], transactions: [] });

  assert.strictEqual(preview.buys.length, 1);
  // Unmatched → never staged. It is dropped to IGNORED so no non-RW variant can
  // post phantom income (the user does not have to uncheck it by hand).
  assert.strictEqual(preview.sales.length, 0);
  const ignored = preview.ignored.find(r => r.itemName === 'Diamond Bladed Knife');
  assert.ok(ignored, 'the unmatched sale is dropped to ignored');
  assert.strictEqual(ignored.reason, 'unmatched sale — no tracked RW buy');
});

test('buildScanPreview keeps a matched RW sale checked so tracked sales import hands-free', () => {
  // The genuine RW instance the user holds and then sells — same scan captures
  // the auction buy, and the sale closes it: proven RW, stays checked.
  const buy = P.classifyLogEvent({
    id: 'buy-rw-match',
    timestamp: 1779280000,
    data: { item: { id: 614, uid: 333, name: 'Diamond Bladed Knife' }, final_price: 75_000_000 },
  }, P.SCAN_LOG_TYPES.auctionBuy, 'buy-rw-match', {}, cats);
  const sale = P.classifyLogEvent({
    id: 'sale-rw-match',
    timestamp: 1779372185,
    data: { item: [{ id: 614, uid: 333, name: 'Diamond Bladed Knife' }], net: 90_000_000, buyer: 'Buyer' },
  }, P.SCAN_LOG_TYPES.itemMarketSale, 'sale-rw-match', {}, cats);

  const preview = P.buildScanPreview([buy, sale], { cats, items: [], transactions: [] });

  assert.strictEqual(preview.sales.length, 1);
  assert.match(preview.sales[0].matchedId, /^scan-buy:/);
  assert.strictEqual(preview.sales[0].checked, true);
});

test('a uid-less non-RW variant sale cannot close a held uid-bearing RW row (real log shapes)', () => {
  // Verified against live Torn logs: a RW instance carries a real uid on every
  // sale channel; a standard/non-RW variant is stackable and sells with NO uid
  // (bazaar reports uid 0, read as null). So the RW Enfield's own sale names its
  // uid, and the non-RW variant dump is uid-less. The uid-less dump must NOT
  // close the multi-million RW row — the uid rule blocks it before the value
  // guard is even reached; the real uid-bearing sale closes the row.
  const buy = P.classifyLogEvent({
    id: 'buy-rw-enfield',
    timestamp: 1779280000,
    data: { item: { id: 614, uid: 444, name: 'Diamond Bladed Knife' }, final_price: 100_000_000 },
  }, P.SCAN_LOG_TYPES.auctionBuy, 'buy-rw-enfield', {}, cats);
  // Non-RW variant dumped on the bazaar: uid 0 -> null. Priced high (30m) so ONLY
  // the uid rule (not the value guard) can stop it.
  const nonRwSale = P.classifyLogEvent({
    id: 'sale-nonrw',
    timestamp: 1779300000,
    data: { item: [{ id: 614, uid: 0, name: 'Diamond Bladed Knife' }], cost_total: 30_000_000, buyer: 'Buyer' },
  }, P.SCAN_LOG_TYPES.bazaarSale, 'sale-nonrw', {}, cats);
  // The genuine RW sale carries the instance uid (item market).
  const realSale = P.classifyLogEvent({
    id: 'sale-real-rw',
    timestamp: 1779372185,
    data: { items: [{ id: 614, uid: 444, name: 'Diamond Bladed Knife' }], cost_total: 108_000_000, buyer: 'Buyer' },
  }, P.SCAN_LOG_TYPES.itemMarketSale, 'sale-real-rw', {}, cats);

  const preview = P.buildScanPreview([buy, nonRwSale, realSale], { cats, items: [], transactions: [] });

  // Exactly one sale imports — the real 108m one — and it closes the RW buy.
  assert.strictEqual(preview.sales.length, 1);
  assert.strictEqual(preview.sales[0].sell.saleNet, 108_000_000);
  // The uid-less non-RW sale is dropped to IGNORED, not staged against the RW buy.
  const dropped = preview.ignored.find(r => r.reason === 'non-RW sale — no armoury uid');
  assert.ok(dropped, 'the uid-less non-RW variant sale is dropped to ignored');
});

test('a uid-less scanned sale cannot close a uid-less ledger row (the $190k Enfield leak)', () => {
  // The exact recurring bug, isolated: a real install had a uid-less "Enfield SA-80"
  // held row (a stale/legacy/hand-entered row, or a same-name non-RW buy staged by
  // an earlier buggy import). A $190k plain-Enfield item-market SALE — uid-less,
  // buyPrice unknown on the row — slipped past BOTH the name-path uid filter (which
  // only drops uid-BEARING rows) and the value guard (unknown cost → waved through)
  // and closed that row, posting a phantom non-RW sale. The ground-truth uid gate
  // now drops any uid-less scanned sale outright: an RW instance always carries a
  // uid, so a uid-less sale is definitionally non-RW and can close nothing.
  const nonRwSale = P.classifyLogEvent({
    id: 'enfield-190k', timestamp: 1783100000,
    data: { items: [{ id: 219, uid: null, qty: 1 }], cost_total: 190_000, fee: 10_000, cost_each: 200_000 },
  }, P.SCAN_LOG_TYPES.itemMarketSale, 'enfield-190k', { 219: 'Enfield SA-80' }, { 'enfield sa-80': 'Primary' });

  const preview = P.buildScanPreview([nonRwSale], {
    cats: { 'enfield sa-80': 'Primary' }, itemNames: { 219: 'Enfield SA-80' },
    items: [{ id: 'stale-enfield', itemName: 'Enfield SA-80', uid: null, status: 'held', bonuses: [] }],
    transactions: [],
  });

  assert.strictEqual(preview.sales.length, 0, 'the $190k non-RW sale never stages');
  assert.strictEqual(preview.ignored.length, 1);
  assert.strictEqual(preview.ignored[0].reason, 'non-RW sale — no armoury uid');
});

test('a non-RW weapon carries a REAL uid — uid cannot gate it; rarity reconciliation kills the sale (the recurring Enfield phantom)', () => {
  // The insight every prior uid patch missed: a standard Torn weapon is
  // NON-stackable and carries a real armoury uid exactly like its RW namesake. So a
  // non-RW Enfield BUY and its own SALE share one real uid — buildScanPreview
  // uid-exact matches them and stages the sale. No uid rule can stop that; the two
  // records are genuinely the same instance. Rarity is the only true RW
  // discriminator, and it lands only AFTER matching (from a per-uid itemdetails
  // call). reconcileScanRarity applies that verdict: it drops the non-RW buy AND
  // the sale that matched it, so nothing reaches Recent Transactions.
  const itemNames = { 219: 'Enfield SA-80' };
  const c = { 'enfield sa-80': 'Primary' };
  const buy = P.classifyLogEvent({
    id: 'enfield-buy', timestamp: 1783000000,
    data: { items: [{ id: 219, uid: 555 }], cost_total: 200_000 },
  }, P.SCAN_LOG_TYPES.itemMarketBuy, 'enfield-buy', itemNames, c);
  const sale = P.classifyLogEvent({
    id: 'enfield-sale', timestamp: 1783100000,
    data: { items: [{ id: 219, uid: 555 }], cost_total: 190_000, buyer: 'Buyer' },
  }, P.SCAN_LOG_TYPES.itemMarketSale, 'enfield-sale', itemNames, c);

  const preview = P.buildScanPreview([buy, sale], { cats: c, itemNames, items: [], transactions: [] });
  // BEFORE rarity is known the phantom exists: the sale uid-exact matched the buy.
  assert.strictEqual(preview.buys.length, 1);
  assert.strictEqual(preview.sales.length, 1, 'uid matching alone cannot stop the non-RW sale');
  assert.match(preview.sales[0].matchedId, /^scan-buy:/);

  // itemdetails resolves the standard weapon with no colour rarity (stays null).
  const enriched = preview.buys.map(h => ({ ...h, rarity: null }));
  const { keptBuys, staged } = P.reconcileScanRarity(preview, enriched);

  assert.strictEqual(keptBuys.length, 0, 'the non-RW buy is dropped by rarity');
  assert.strictEqual(staged.sales.length, 0, 'and its orphaned sale is dropped too — no phantom transaction');
  assert.strictEqual(staged.summary.sales, 0);
  const droppedSale = staged.ignored.find(r => r.reason === 'non-RW sale — matched buy dropped as standard/non-RW');
  assert.ok(droppedSale, 'the sale is moved to ignored, not committed');
});

test('reconcileScanRarity keeps a genuine RW sale whose buy resolves to a colour rarity', () => {
  const itemNames = { 219: 'Enfield SA-80' };
  const c = { 'enfield sa-80': 'Primary' };
  const buy = P.classifyLogEvent({
    id: 'rw-buy', timestamp: 1783000000,
    data: { item: { id: 219, uid: 777 }, final_price: 50_000_000 },
  }, P.SCAN_LOG_TYPES.auctionBuy, 'rw-buy', itemNames, c);
  const sale = P.classifyLogEvent({
    id: 'rw-sale', timestamp: 1783100000,
    data: { items: [{ id: 219, uid: 777 }], cost_total: 60_000_000, buyer: 'Buyer' },
  }, P.SCAN_LOG_TYPES.itemMarketSale, 'rw-sale', itemNames, c);

  const preview = P.buildScanPreview([buy, sale], { cats: c, itemNames, items: [], transactions: [] });
  assert.strictEqual(preview.sales.length, 1);

  const enriched = preview.buys.map(h => ({ ...h, rarity: 'yellow' }));
  const { keptBuys, staged } = P.reconcileScanRarity(preview, enriched);

  assert.strictEqual(keptBuys.length, 1);
  assert.strictEqual(staged.sales.length, 1, 'the RW sale survives reconciliation');
});

test('reconcileScanRarity backfills the bonus name onto a sale closed by a same-batch buy', () => {
  // The batch-import bug: buildScanPreview enriches a sale's bonus from its matched
  // buy BEFORE itemdetails runs, so a sale closing a buy staged in the SAME batch
  // comes out blank (the buy's bonuses were [] at match time). Once itemdetails
  // resolves the buy's real bonuses, reconcileScanRarity must copy that name onto
  // the sale — otherwise Recent Transactions loses the bonus for every scanned sale.
  const itemNames = { 219: 'Enfield SA-80' };
  const c = { 'enfield sa-80': 'Primary' };
  const buy = P.classifyLogEvent({
    id: 'rw-buy', timestamp: 1783000000,
    data: { item: { id: 219, uid: 777 }, final_price: 50_000_000 },
  }, P.SCAN_LOG_TYPES.auctionBuy, 'rw-buy', itemNames, c);
  const sale = P.classifyLogEvent({
    id: 'rw-sale', timestamp: 1783100000,
    data: { items: [{ id: 219, uid: 777 }], cost_total: 60_000_000, buyer: 'Buyer' },
  }, P.SCAN_LOG_TYPES.itemMarketSale, 'rw-sale', itemNames, c);

  const preview = P.buildScanPreview([buy, sale], { cats: c, itemNames, items: [], transactions: [] });
  assert.strictEqual(preview.sales.length, 1);
  // At preview time the buy had no bonuses, so the sale came out blank.
  assert.strictEqual(preview.sales[0].sell.bonusName == null, true);

  // itemdetails resolves the buy: colour rarity AND the per-instance bonus.
  const enriched = preview.buys.map(h => ({ ...h, rarity: 'yellow', bonuses: [{ name: 'Pinpoint', value: 10 }] }));
  const { staged } = P.reconcileScanRarity(preview, enriched);

  assert.strictEqual(staged.sales.length, 1);
  assert.strictEqual(staged.sales[0].sell.bonusName, 'Pinpoint',
    'the sale inherits the buy bonus so Recent Transactions shows it');
});

test('reconcileScanRarity leaves a sale matched to a pre-existing open ledger row untouched', () => {
  // A sale can match a real ledger row (a vetted RW row with a makeId id) instead
  // of a staged buy. Dropping a same-batch non-RW buy must never collateral-drop it.
  const itemNames = { 219: 'Enfield SA-80' };
  const c = { 'enfield sa-80': 'Primary' };
  const sale = P.classifyLogEvent({
    id: 'ledger-sale', timestamp: 1783100000,
    data: { items: [{ id: 219, uid: 888 }], cost_total: 60_000_000, buyer: 'Buyer' },
  }, P.SCAN_LOG_TYPES.itemMarketSale, 'ledger-sale', itemNames, c);

  const preview = P.buildScanPreview([sale], {
    cats: c, itemNames,
    items: [{ id: 'real-row', itemName: 'Enfield SA-80', uid: 888, status: 'held', bonuses: [] }],
    transactions: [],
  });
  assert.strictEqual(preview.sales.length, 1);
  assert.strictEqual(preview.sales[0].matchedId, 'real-row');

  // No staged buys in this batch → reconcile drops nothing.
  const { staged } = P.reconcileScanRarity(preview, []);
  assert.strictEqual(staged.sales.length, 1, 'a ledger-row match is never touched by rarity reconciliation');
});

test('matchSell value guard still backstops the pure uid-less legacy case', () => {
  // Two uid-less rows (legacy / hand-entered) share a name; a near-zero sale must
  // not close the expensive one — the value guard is the only signal left here.
  const held = [
    { id: 'cheap', itemName: 'Diamond Bladed Knife', status: 'held', bonuses: [], buyPrice: 500_000 },
    { id: 'dear', itemName: 'Diamond Bladed Knife', status: 'held', bonuses: [], buyPrice: 100_000_000 },
  ];
  // 190k proceeds: >= 20% of the 500k row, but a sliver of the 100m row.
  const m = P.matchSell({ itemName: 'Diamond Bladed Knife', saleNet: 190_000 }, held);
  assert.strictEqual(m.id, 'cheap');
});

test('the RW trade sale wins its instance; a uid-less non-RW variant sale cannot steal it', () => {
  // THE recurring bug, reproduced end to end on a blank ledger in one scan:
  //   - a RW Enfield/DBK is bought at auction (carries uid 555),
  //   - it actually sells via a TRADE (the trade item leg carries the same uid),
  //   - and a plain non-RW variant of the same name is dumped on the item market
  //     with NO uid, for a price that clears the value guard.
  // Before uid-priority matching, the uid-less item-market sale was matched first
  // (main loop runs before the trade loop) and stole the RW row; the real trade
  // sale then had nothing to close. Now the uid trade sale claims the instance
  // first and consumes the row, so the non-RW sale is dropped to IGNORED.
  const buy = P.classifyLogEvent({
    id: 'buy-rw-trade', timestamp: 1779280000,
    data: { item: { id: 614, uid: 555, name: 'Diamond Bladed Knife' }, final_price: 100_000_000 },
  }, P.SCAN_LOG_TYPES.auctionBuy, 'buy-rw-trade', {}, cats);

  // Non-RW item-market sale: no uid, 30m net — clears the 20m (20%) value guard,
  // so ONLY uid-priority (not the guard) can stop it stealing the RW row.
  const nonRwSale = P.classifyLogEvent({
    id: 'sale-nonrw-imarket', timestamp: 1779300000,
    data: { item: [{ id: 614, name: 'Diamond Bladed Knife' }], net: 30_000_000, buyer: 'Rando' },
  }, P.SCAN_LOG_TYPES.itemMarketSale, 'sale-nonrw-imarket', {}, cats);

  // The real RW sale, via trade — item leg (uid 555, outgoing) + money leg (incoming).
  const tradeItem = P.classifyLogEvent({
    id: 'trade-item-out', timestamp: 1779372185, title: 'Trade items outgoing',
    data: { items: [{ id: 614, uid: 555, name: 'Diamond Bladed Knife' }], trade_id: 'T1', user_id: 1580562 },
  }, P.SCAN_LOG_TYPES.tradeItemA, 'trade-item-out', {}, cats);
  const tradeMoney = P.classifyLogEvent({
    id: 'trade-money-in', timestamp: 1779372185, title: 'Trade money incoming',
    data: { money: 90_000_000, trade_id: 'T1', user_id: 1580562 },
  }, P.SCAN_LOG_TYPES.tradeMoneyA, 'trade-money-in', {}, cats);

  const preview = P.buildScanPreview([buy, nonRwSale, tradeItem, tradeMoney],
    { cats, items: [], transactions: [], itemNames: {} });

  // Exactly one sale imports — the 90m trade sale — closing the RW buy.
  assert.strictEqual(preview.sales.length, 1);
  assert.strictEqual(preview.sales[0].sell.saleNet, 90_000_000);
  assert.strictEqual(preview.sales[0].sell.venue, 'trade');
  // The uid-less non-RW item-market sale is dropped, not staged as income.
  const dropped = preview.ignored.find(r => r.reason === 'non-RW sale — no armoury uid');
  assert.ok(dropped, 'the uid-less non-RW variant sale is dropped to ignored');
});

test('a matched row is consumed so a second same-name sale cannot re-close it', () => {
  // Two identical RW instances bought (uid 700, 701); two uid-bearing sales close
  // them one-to-one. Without consumption both sales would collide on the first row.
  const buy1 = P.classifyLogEvent({
    id: 'b700', timestamp: 1779280000,
    data: { item: { id: 614, uid: 700, name: 'Diamond Bladed Knife' }, final_price: 80_000_000 },
  }, P.SCAN_LOG_TYPES.auctionBuy, 'b700', {}, cats);
  const buy2 = P.classifyLogEvent({
    id: 'b701', timestamp: 1779280001,
    data: { item: { id: 614, uid: 701, name: 'Diamond Bladed Knife' }, final_price: 80_000_000 },
  }, P.SCAN_LOG_TYPES.auctionBuy, 'b701', {}, cats);
  const sale1 = P.classifyLogEvent({
    id: 's700', timestamp: 1779300000,
    data: { item: [{ id: 614, uid: 700, name: 'Diamond Bladed Knife' }], net: 90_000_000, buyer: 'A' },
  }, P.SCAN_LOG_TYPES.itemMarketSale, 's700', {}, cats);
  const sale2 = P.classifyLogEvent({
    id: 's701', timestamp: 1779300001,
    data: { item: [{ id: 614, uid: 701, name: 'Diamond Bladed Knife' }], net: 90_000_000, buyer: 'B' },
  }, P.SCAN_LOG_TYPES.itemMarketSale, 's701', {}, cats);

  const preview = P.buildScanPreview([buy1, buy2, sale1, sale2], { cats, items: [], transactions: [] });
  assert.strictEqual(preview.sales.length, 2);
  const ids = preview.sales.map(s => s.matchedId);
  assert.strictEqual(new Set(ids).size, 2, 'the two sales close two distinct rows');
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
  // A junk bazaar sale is stackable and uid-less → dropped at the ground-truth
  // uid gate as non-RW, before it can even look for a matching row.
  assert.strictEqual(preview.ignored[0].reason, 'non-RW sale — no armoury uid');
  assert.strictEqual(preview.ignored[0].itemName, 'Xanax');
});

// NOTE: removed "mug events attach only when one sold row is clearly nearby" —
// mugs no longer attach to a nearby sold row. They are staged as standalone flat
// cash (no matchedId); see the flat-cash mug tests in test-rwth.js.

// ─── S1 (#14): recoverable dismissal store + uniform unchecked semantics ──────

test('collectDismissals snapshots an unchecked buy into a restorable entry', () => {
  const buy = P.classifyLogEvent({
    id: 'buy-dismiss',
    timestamp: 1779280000,
    data: { item: { id: 614, uid: 191, name: 'Diamond Bladed Knife' }, final_price: 75_000_000 },
  }, P.SCAN_LOG_TYPES.auctionBuy, 'buy-dismiss', {}, {});

  const preview = P.buildScanPreview([buy], { cats: {}, items: [], transactions: [] });
  assert.strictEqual(preview.buys.length, 1);
  assert.strictEqual(preview.buys[0].checked, true);

  // User unchecks the buy in the preview, then commits.
  const results = preview.buys.map(h => ({ ...h, checked: false }));
  const dismissals = P.collectDismissals(results, preview);
  assert.strictEqual(dismissals.length, 1);
  assert.strictEqual(dismissals[0].type, 'buy');
  assert.strictEqual(dismissals[0].itemName, 'Diamond Bladed Knife');
  assert.ok(dismissals[0].eventKeys.length >= 1);
});

test('dismissed buy is suppressed on the next scan yet reappears after restore', () => {
  const buy = P.classifyLogEvent({
    id: 'buy-dismiss-2',
    timestamp: 1779280000,
    data: { item: { id: 614, uid: 192, name: 'Diamond Bladed Knife' }, final_price: 75_000_000 },
  }, P.SCAN_LOG_TYPES.auctionBuy, 'buy-dismiss-2', {}, {});

  const preview1 = P.buildScanPreview([buy], { cats: {}, items: [], transactions: [] });
  const dismissals = P.collectDismissals(
    preview1.buys.map(h => ({ ...h, checked: false })), preview1);

  // Rescan with the dismissed key present: the buy is gated like "already seen".
  const preview2 = P.buildScanPreview([buy], {
    cats: {}, items: [], transactions: [], dismissed: dismissals,
  });
  assert.strictEqual(preview2.buys.length, 0);
  assert.strictEqual(preview2.already.length, 1);

  // Restore drops the entry; the buy stages again on the following scan.
  const restored = P.restoreDismissals(dismissals, dismissals[0].eventKeys);
  assert.strictEqual(restored.length, 0);
  const preview3 = P.buildScanPreview([buy], {
    cats: {}, items: [], transactions: [], dismissed: restored,
  });
  assert.strictEqual(preview3.buys.length, 1);
});

test('unchecked mug is dismissed and absent from the next preview', () => {
  const mug = P.classifyLogEvent({
    id: 'mug-dismiss',
    timestamp: 1779372300,
    data: { cash: 8_000_000, attacker: 'Mugger' },
  }, P.SCAN_LOG_TYPES.mugged, 'mug-dismiss', {}, {});

  const preview1 = P.buildScanPreview([mug], { cats: {}, items: [], transactions: [] });
  assert.strictEqual(preview1.mugs.length, 1);

  // User unchecks the mug, then commits → it lands in the dismissal store.
  const unchecked = { ...preview1, mugs: preview1.mugs.map(m => ({ ...m, checked: false })) };
  const dismissals = P.collectDismissals([], unchecked);
  assert.strictEqual(dismissals.length, 1);
  assert.strictEqual(dismissals[0].type, 'mug');

  // Mugs gate against their own store; a dismissed mug must also be suppressed.
  const preview2 = P.buildScanPreview([mug], {
    cats: {}, items: [], transactions: [], dismissed: dismissals,
  });
  assert.strictEqual(preview2.mugs.length, 0);
  assert.strictEqual(preview2.already.length, 1);
});

test('$0 mug is silently filtered from the preview and never reappears on rescan (#15)', () => {
  const mug = P.classifyLogEvent({
    id: 'mug-zero',
    timestamp: 1779372300,
    data: { cash: 0, attacker: 'Mugger' },
  }, P.SCAN_LOG_TYPES.mugged, 'mug-zero', {}, {});

  const preview1 = P.buildScanPreview([mug], { cats: {}, items: [], transactions: [] });
  // Never staged — not under mugs, not in review/ignored the user would see.
  assert.strictEqual(preview1.mugs.length, 0);
  // Its key is surfaced for the commit to record in the seen-set (fixes B3).
  assert.deepStrictEqual(preview1.mugSuppress, [P.scanEventKey(P.SCAN_LOG_TYPES.mugged, 'mug-zero')]);

  // Rescan (mugs re-fetch even when in the seen-set, so an earlier-dropped real
  // mug can backfill): the amount filter drops the $0 mug on every pass, so it
  // stays absent from the preview no matter how many times it is re-seen.
  const preview2 = P.buildScanPreview([mug], {
    cats: {}, items: [], transactions: [],
    seen: { [P.SCAN_LOG_TYPES.mugged]: ['mug-zero'] },
  });
  assert.strictEqual(preview2.mugs.length, 0);
});

test('mergeDismissals dedupes by shared eventKey and normalizeDismissedList drops junk', () => {
  const a = { eventKeys: ['4320:x'], type: 'buy', itemName: 'Knife', amount: 5, timestamp: 1 };
  const merged = P.mergeDismissals([a], [a, { eventKeys: ['4322:y'], type: 'sale' }]);
  assert.strictEqual(merged.length, 2);
  // Re-merging the same key is a no-op.
  assert.strictEqual(P.mergeDismissals(merged, [a]).length, 2);
  // Junk entries (no eventKeys) are stripped.
  assert.strictEqual(P.normalizeDismissedList([null, {}, { eventKeys: [] }, a]).length, 1);
});

test('dismissedKeySet flattens all eventKeys and buildDismissedUi renders restore rows', () => {
  const list = [
    { eventKeys: ['4320:a', '4320:b'], type: 'buy', itemName: 'Knife', amount: 100 },
    { eventKeys: ['8156:c'], type: 'mug', itemName: 'Mug', amount: 50 },
  ];
  const keys = P.dismissedKeySet(list);
  assert.strictEqual(keys.size, 3);
  assert.ok(keys.has('4320:a') && keys.has('8156:c'));

  const openUi = P.buildDismissedUi(list, false);
  assert.match(openUi, /Dismissed \(2\)/);
  assert.match(openUi, /data-action="scan-restore"/);
  assert.match(openUi, /data-keys="4320:a\|4320:b"/);
  // Empty list renders nothing; collapsed hides the rows but keeps the header.
  assert.strictEqual(P.buildDismissedUi([], false), '');
  assert.doesNotMatch(P.buildDismissedUi(list, true), /scan-restore/);
});

// ─── S3 (#18) — sales/review checkboxes + uncapped lists + commit honors them ─

// Six matched RW sales in one preview, so we can prove the ×5 cap is gone while
// each row is a proven (matched) RW sale — the case that defaults checked.
function sixSalePreview() {
  // Six distinct RW instances, each sold with its own armoury uid, closing six
  // held rows one-to-one — the realistic shape now that RW sales must carry a uid.
  const rows = [];
  const items = [];
  for (let i = 0; i < 6; i++) {
    const uid = 6140 + i;
    items.push({ id: `held-dbk-${i}`, itemName: 'Diamond Bladed Knife', uid, status: 'held', bonuses: [] });
    rows.push(P.classifyLogEvent({
      id: `sale-cap-${i}`,
      timestamp: 1779372185 + i,
      data: { item: [{ id: 614, uid, name: 'Diamond Bladed Knife' }], net: 90_000_000 + i, buyer: 'BuyerName' },
    }, P.SCAN_LOG_TYPES.itemMarketSale, `sale-cap-${i}`, {}, cats));
  }
  return P.buildScanPreview(rows, { cats, items, transactions: [] });
}

test('buildScanPreviewUi renders every sale (no ×5 cap) with a default-checked checkbox', () => {
  const preview = sixSalePreview();
  assert.strictEqual(preview.sales.length, 6);
  const ui = P.buildScanPreviewUi(preview, 0);
  // The 6th sale row renders — the old slice(0,5) would have dropped it.
  const saleRows = (ui.match(/data-scan-sale=/g) || []).length;
  assert.strictEqual(saleRows, 6);
  // A matched (proven-RW) sale defaults checked so tracked sales import hands-free.
  assert.match(ui, /data-scan-sale-check checked/);
  // Long lists scroll inside a bounded container.
  assert.match(ui, /rwth-scan-scroll/);
});

test('buildScanPreviewUi renders review rows with a default-unchecked checkbox', () => {
  const review = [{ type: 'review', reason: 'bundled or ambiguous trade', eventKeys: ['4440:r1'] }];
  const ui = P.buildScanPreviewUi({ sales: [], mugs: [], review, ignored: [], summary: {} }, 0);
  assert.match(ui, /data-scan-review="4440:r1"/);
  // Review defaults unchecked (today's "skipped"): no `checked` on the input.
  assert.doesNotMatch(ui, /data-scan-review-check checked/);
  assert.match(ui, /skipped/);
});

test('an unchecked sale is not imported and is snapshotted into the dismissal store', () => {
  // Matched-only import: the sale must close a tracked RW buy to stage at all, and
  // it uid-exact matches the held instance carrying the same armoury uid.
  const held = { id: 'held-dbk', itemName: 'Diamond Bladed Knife', uid: 614777, status: 'held',
    bonuses: [], buyPrice: 75_000_000 };
  const preview = P.buildScanPreview([
    P.classifyLogEvent({
      id: 'sale-uncheck',
      timestamp: 1779372185,
      data: { item: [{ id: 614, uid: 614777, name: 'Diamond Bladed Knife' }], net: 90_000_000, buyer: 'BuyerName' },
    }, P.SCAN_LOG_TYPES.itemMarketSale, 'sale-uncheck', {}, cats),
  ], { cats, items: [held], transactions: [] });
  assert.strictEqual(preview.sales.length, 1);

  // User unchecks the sale in the preview (syncScanPreviewEdit sets checked:false).
  const unchecked = { ...preview, sales: preview.sales.map(r => ({ ...r, checked: false })) };

  // selectScanSales — the pure commit selection — drops it from the import set.
  const sel = P.selectScanSales(unchecked);
  assert.strictEqual(sel.imported.length, 0);
  assert.strictEqual(sel.dismissed.length, 1);

  // …and collectDismissals snapshots it as a restorable sale entry (S1 path).
  const dismissals = P.collectDismissals([], unchecked);
  assert.strictEqual(dismissals.length, 1);
  assert.strictEqual(dismissals[0].type, 'sale');
  assert.strictEqual(dismissals[0].itemName, 'Diamond Bladed Knife');
  assert.strictEqual(dismissals[0].amount, 90_000_000);
  assert.ok(dismissals[0].eventKeys.includes('1113:sale-uncheck'));

  // A dismissed sale gates like "already seen" on the next scan.
  const preview2 = P.buildScanPreview([
    P.classifyLogEvent({
      id: 'sale-uncheck',
      timestamp: 1779372185,
      data: { item: [{ id: 614, uid: 614777, name: 'Diamond Bladed Knife' }], net: 90_000_000, buyer: 'BuyerName' },
    }, P.SCAN_LOG_TYPES.itemMarketSale, 'sale-uncheck', {}, cats),
  ], { cats, items: [], transactions: [], dismissed: dismissals });
  assert.strictEqual(preview2.sales.length, 0);
  assert.strictEqual(preview2.already.length, 1);
});

test('selectScanSales imports checked sales and leaves default (undefined) sales checked', () => {
  const preview = {
    sales: [
      { sell: { itemName: 'A' }, eventKeys: ['1113:a'] },                 // default → import
      { sell: { itemName: 'B' }, eventKeys: ['1113:b'], checked: true },  // checked → import
      { sell: { itemName: 'C' }, eventKeys: ['1113:c'], checked: false }, // unchecked → dismiss
    ],
  };
  const sel = P.selectScanSales(preview);
  assert.deepStrictEqual(sel.imported.map(r => r.sell.itemName), ['A', 'B']);
  assert.deepStrictEqual(sel.dismissed.map(r => r.sell.itemName), ['C']);
  // Empty / missing preview is safe.
  assert.deepStrictEqual(P.selectScanSales({}).imported, []);
  assert.deepStrictEqual(P.selectScanSales(null).dismissed, []);
});

// ─── S4 (#16) — Refresh window selection + "last scanned X ago" status ───────

test('resolveScanCutoffUnix keeps the since-last-scan floor when back-to is LATER than lastScan', () => {
  const lastScan = Date.UTC(2026, 0, 1, 12, 0, 0);   // epoch ms — Jan 1
  // #19 — a back-to date newer than lastScan must not shrink the window: the
  // earlier (smaller unix) of the two floors wins, i.e. the since-last-scan floor.
  assert.strictEqual(
    P.resolveScanCutoffUnix(lastScan, '2026-06-01'),
    Math.floor(lastScan / 1000),
  );
});

test('resolveScanCutoffUnix lets an EARLIER back-to date force a deeper window than lastScan', () => {
  const lastScan = Date.UTC(2026, 5, 20, 12, 0, 0);  // epoch ms — Jun 20
  // #19 — the explicit override reaches further back than the last scan, so it
  // wins (the earlier unix floor). This is the S4 review fix: the override is no
  // longer a no-op once a scan has run.
  assert.strictEqual(
    P.resolveScanCutoffUnix(lastScan, '2026-01-01'),
    P.scanCutoffUnix('2026-01-01'),
  );
  assert.ok(P.scanCutoffUnix('2026-01-01') < Math.floor(lastScan / 1000));
});

test('resolveScanCutoffUnix falls back to lastScan when no back-to date is set', () => {
  const lastScan = Date.UTC(2026, 5, 20, 12, 0, 0);
  assert.strictEqual(P.resolveScanCutoffUnix(lastScan, ''), Math.floor(lastScan / 1000));
  assert.strictEqual(P.resolveScanCutoffUnix(lastScan, 'not-a-date'), Math.floor(lastScan / 1000));
});

test('resolveScanCutoffUnix falls back to scanBackTo on first run (no lastScan)', () => {
  const expected = P.scanCutoffUnix('2026-01-01');
  assert.strictEqual(P.resolveScanCutoffUnix(0, '2026-01-01'), expected);
  assert.strictEqual(P.resolveScanCutoffUnix(null, '2026-01-01'), expected);
  // A non-finite/absent lastScan still falls through to the manual override.
  assert.strictEqual(P.resolveScanCutoffUnix(undefined, '2026-01-01'), expected);
});

test('resolveScanCutoffUnix yields null when neither lastScan nor scanBackTo is set', () => {
  assert.strictEqual(P.resolveScanCutoffUnix(0, ''), null);
  assert.strictEqual(P.resolveScanCutoffUnix(0, 'not-a-date'), null);
});

// S? — Refresh rate-limit cooldown (shared Torn 100/60s budget)

test('scanCooldownRemainingMs is 0 before any scan has ever run', () => {
  // No lastScan → first Refresh is never throttled.
  assert.strictEqual(P.scanCooldownRemainingMs(0, Date.now(), P.SCAN_COOLDOWN_MS), 0);
  assert.strictEqual(P.scanCooldownRemainingMs(null, Date.now(), P.SCAN_COOLDOWN_MS), 0);
  assert.strictEqual(P.scanCooldownRemainingMs(undefined, Date.now(), P.SCAN_COOLDOWN_MS), 0);
});

test('scanCooldownRemainingMs blocks a Refresh fired inside the cooldown window', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const lastScan = now - 3000;   // scanned 3s ago, cooldown is 8s
  assert.strictEqual(P.scanCooldownRemainingMs(lastScan, now, 8000), 5000);
});

test('scanCooldownRemainingMs clears once the cooldown has fully elapsed', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  assert.strictEqual(P.scanCooldownRemainingMs(now - 8000, now, 8000), 0);   // exactly at
  assert.strictEqual(P.scanCooldownRemainingMs(now - 9000, now, 8000), 0);   // past
});

test('scanCooldownRemainingMs never traps on a clock skew (lastScan in the future)', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  assert.strictEqual(P.scanCooldownRemainingMs(now + 5000, now, 8000), 0);
});

test('formatLastScanned reports "Never scanned" before the first scan', () => {
  assert.strictEqual(P.formatLastScanned(0, Date.now()), 'Never scanned');
  assert.strictEqual(P.formatLastScanned(null, Date.now()), 'Never scanned');
  assert.strictEqual(P.formatLastScanned(undefined, Date.now()), 'Never scanned');
});

test('formatLastScanned humanizes the gap in minutes / hours / days', () => {
  const now = Date.UTC(2026, 6, 1, 12, 0, 0);
  const min = 60 * 1000, hour = 60 * min, day = 24 * hour;
  assert.strictEqual(P.formatLastScanned(now - 30 * 1000, now), 'Last scanned just now');
  assert.strictEqual(P.formatLastScanned(now - 1 * min, now), 'Last scanned 1 minute ago');
  assert.strictEqual(P.formatLastScanned(now - 5 * min, now), 'Last scanned 5 minutes ago');
  assert.strictEqual(P.formatLastScanned(now - 1 * hour, now), 'Last scanned 1 hour ago');
  assert.strictEqual(P.formatLastScanned(now - 3 * hour, now), 'Last scanned 3 hours ago');
  assert.strictEqual(P.formatLastScanned(now - 1 * day, now), 'Last scanned 1 day ago');
  assert.strictEqual(P.formatLastScanned(now - 4 * day, now), 'Last scanned 4 days ago');
  // A future/skewed stamp never renders a negative age.
  assert.strictEqual(P.formatLastScanned(now + 5 * min, now), 'Last scanned just now');
});

test('buildLedgerTab renders a one-click Refresh button and a last-scanned status line', () => {
  const html = P.buildLedgerTab({ ledger: { items: [], statusFilter: 'all', lastScan: 0 } });
  assert.match(html, /data-action="refresh"/);
  assert.match(html, /⟳ Refresh/);
  assert.match(html, /class="rwth-scan-status"/);
  assert.match(html, /Never scanned/);
});

test('buildLedgerTab status line reflects a prior scan', () => {
  const html = P.buildLedgerTab({
    ledger: { items: [], statusFilter: 'all', lastScan: Date.now() - 2 * 60 * 1000 },
  });
  assert.match(html, /Last scanned 2 minutes ago/);
});

// ─── S6 (#17): page-full warning ─────────────────────────────────────────────

test('pageFullWarnings fires at exactly the log limit, not below', () => {
  // 99 entries: under the cap → no warning.
  assert.deepStrictEqual(P.pageFullWarnings({ 'auction buys': 99 }, 100), []);
  // Exactly 100: at the cap → one warning naming the type and advising action.
  const at = P.pageFullWarnings({ 'auction buys': 100 }, 100);
  assert.strictEqual(at.length, 1);
  assert.match(at[0], /^auction buys hit the 100-log limit/);
  assert.match(at[0], /narrow the window or rescan later/);
});

test('pageFullWarnings warns each capped type and ignores under-cap types', () => {
  const out = P.pageFullWarnings(
    { 'auction buys': 100, 'item market buys': 42, 'mugs': 100 }, 100);
  assert.strictEqual(out.length, 2);
  assert.ok(out.some(w => w.startsWith('auction buys hit')));
  assert.ok(out.some(w => w.startsWith('mugs hit')));
  assert.ok(!out.some(w => w.startsWith('item market buys')));
});

test('pageFullWarnings is empty for empty/invalid input', () => {
  assert.deepStrictEqual(P.pageFullWarnings({}, 100), []);
  assert.deepStrictEqual(P.pageFullWarnings(null, 100), []);
  assert.deepStrictEqual(P.pageFullWarnings({ 'auction buys': 100 }, 0), []);
});

test('buildScanChecklist renders page-full warnings non-blockingly in the preview', () => {
  const html = P.buildScanChecklist({
    ledger: {
      scanResults: [],
      scanPreview: {
        summary: { buys: 0, sales: 0, mugs: 0, review: 0, ignored: 0, already: 0 },
        buys: [], sales: [], mugs: [], review: [], ignored: [],
        warnings: P.pageFullWarnings({ 'auction buys': 100 }, 100),
      },
    },
  });
  assert.match(html, /rwth-scan-warning/);
  assert.match(html, /auction buys hit the 100-log limit/);
  // Non-blocking: the Commit import action still renders alongside the warning.
  assert.match(html, /data-action="confirm-scan"/);
});

// ─── S7 (#20) — residual confirmScan contract: mug/seen invariant, legacy
// seen-wins conversion, transaction dedupe on commit ─────────────────────────
// These pin the parts of confirmScan's contract that S1–S6 leave implicit. The
// commit itself (confirmScan) is impure and unexported; each test exercises the
// pure precursor confirmScan consumes, so a future refactor can't silently drop
// the invariant.

test('mugs are excluded from the seen-set gate while buys are not (backfill invariant)', () => {
  // The SAME eventKey sits in the global seen-set for both a buy and a mug. The
  // buy must gate out ("already imported"); the mug must still stage — mugs
  // deliberately re-fetch so a dropped mug can backfill. confirmScan mirrors this
  // by keeping mug keys OUT of rwth_seen_log_events (only $0-mug suppress keys and
  // committed buy/sale keys land there); this asserts the preview-side half.
  const buy = P.classifyLogEvent({
    id: 'buy-seen',
    timestamp: 1779280000,
    data: { item: { id: 614, uid: 501, name: 'Diamond Bladed Knife' }, final_price: 75_000_000 },
  }, P.SCAN_LOG_TYPES.auctionBuy, 'buy-seen', {}, {});
  const mug = P.classifyLogEvent({
    id: 'mug-seen',
    timestamp: 1779280500,
    data: { cash: 6_000_000, attacker: 'Mugger' },
  }, P.SCAN_LOG_TYPES.mugged, 'mug-seen', {}, {});

  const buyKey = P.scanEventKey(P.SCAN_LOG_TYPES.auctionBuy, 'buy-seen');
  const mugKey = P.scanEventKey(P.SCAN_LOG_TYPES.mugged, 'mug-seen');

  const preview = P.buildScanPreview([buy, mug], {
    cats: {}, items: [], transactions: [],
    // Both keys are in the seen-set; NEITHER is in the mug store.
    seen: [buyKey, mugKey],
  });

  // The buy is gated by the seen-set…
  assert.strictEqual(preview.buys.length, 0);
  assert.ok(preview.already.some(r => (r.eventKeys || []).includes(buyKey)));
  // …but the mug ignores the seen-set and re-stages so it can backfill, carrying
  // the eventKeys that confirmScan writes into rwth_mugs when the row is checked.
  assert.strictEqual(preview.mugs.length, 1);
  assert.strictEqual(preview.mugs[0].mug.amount, 6_000_000);
  assert.strictEqual(preview.mugs[0].checked, true);
  assert.deepStrictEqual(preview.mugs[0].eventKeys, [mugKey]);
  // The mug is NOT parked in `already` — only the buy was gated.
  assert.strictEqual(preview.already.some(r => (r.eventKeys || []).includes(mugKey)), false);
});

test('legacy rwth_seen_wins ids convert to auction-buy eventKeys and gate the re-seen win', () => {
  // The scan loop upgrades each bare id in the legacy rwth_seen_wins store to a
  // full eventKey via scanEventKey(auctionBuy, id) before gating, and confirmScan
  // mirrors committed auction keys back into it. Pin that the converted key equals
  // the auction buy's own key, so a win recorded under the old store stays
  // suppressed after migration.
  const buy = P.classifyLogEvent({
    id: 'win-legacy',
    timestamp: 1779280000,
    data: { item: { id: 614, uid: 777, name: 'Diamond Bladed Knife' }, final_price: 75_000_000 },
  }, P.SCAN_LOG_TYPES.auctionBuy, 'win-legacy', {}, {});

  const convertedKey = P.scanEventKey(P.SCAN_LOG_TYPES.auctionBuy, 'win-legacy');
  assert.strictEqual(convertedKey, `${P.SCAN_LOG_TYPES.auctionBuy}:win-legacy`);
  // The conversion must land on exactly the buy's own key, or the gate misses.
  assert.strictEqual(buy.hit.eventKey, convertedKey);

  // Fed as seen (what the scan loop does with the legacy store), the win is gated.
  const preview = P.buildScanPreview([buy], {
    cats: {}, items: [], transactions: [], seen: [convertedKey],
  });
  assert.strictEqual(preview.buys.length, 0);
  assert.strictEqual(preview.already.length, 1);
  assert.ok(preview.already[0].eventKeys.includes(convertedKey));

  // Sanity: without the converted legacy key the same win DOES stage, proving the
  // suppression above is the conversion at work, not an unrelated filter.
  const fresh = P.buildScanPreview([buy], { cats: {}, items: [], transactions: [] });
  assert.strictEqual(fresh.buys.length, 1);
});

test('a scan sale whose txKey already exists in Recent Transactions is flagged duplicate', () => {
  // buildScanPreview flags a sale as duplicate when its txKey collides with an
  // existing transaction; confirmScan honours it (`!row.duplicate && !seenTx.has`)
  // so re-committing a sale already in Recent Transactions never double-writes.
  const mkSale = () => P.classifyLogEvent({
    id: 'sale-dupe',
    timestamp: 1779372185,
    data: { item: [{ id: 614, uid: 614333, name: 'Diamond Bladed Knife' }], price: 100_000_000, net: 95_000_000, buyer: 'BuyerName' },
  }, P.SCAN_LOG_TYPES.itemMarketSale, 'sale-dupe', {}, cats);
  // Matched-only import: a held RW row (same armoury uid) for the sale to close so it stages.
  const held = () => [{ id: 'held-dbk', itemName: 'Diamond Bladed Knife', uid: 614333, status: 'held',
    bonuses: [], buyPrice: 75_000_000 }];

  // First scan: no prior transactions → not a duplicate.
  const first = P.buildScanPreview([mkSale()], { cats, items: held(), transactions: [] });
  assert.strictEqual(first.sales.length, 1);
  assert.strictEqual(first.sales[0].duplicate, false);
  const sell = first.sales[0].sell;

  // Model the row confirmScan would write (sellToTx: gross price wins over net).
  const committedTx = {
    itemName: sell.itemName,
    bonusName: sell.bonusName,
    buyer: sell.buyer,
    price: sell.saleGross != null ? sell.saleGross : sell.saleNet,
    timestamp: sell.timestamp,
  };

  // Rescan the same log entry with that transaction already present → duplicate,
  // so the commit skips it and Recent Transactions is not written twice.
  const second = P.buildScanPreview([mkSale()], { cats, items: held(), transactions: [committedTx] });
  assert.strictEqual(second.sales.length, 1);
  assert.strictEqual(second.sales[0].duplicate, true);
});

test('two identical sales in one scan dedupe: the second is flagged duplicate', () => {
  // Within a single scan pass, two distinct log entries with identical sale
  // content share a txKey — the second is marked duplicate so the commit posts
  // only one Recent Transactions row.
  const mk = (id, uid) => P.classifyLogEvent({
    id, timestamp: 1779372185,
    data: { item: [{ id: 614, uid, name: 'Diamond Bladed Knife' }], net: 90_000_000, buyer: 'BuyerName' },
  }, P.SCAN_LOG_TYPES.itemMarketSale, id, {}, cats);

  // Distinct entry ids AND distinct armoury uids (two RW instances), so both clear
  // the seen gate and each uid-exact matches its own held row. Their sale CONTENT
  // is identical (uid is not part of txKey), so they share a txKey and the second
  // is flagged duplicate — the commit posts only one Recent Transactions row.
  const held = [
    { id: 'held-dbk-a', itemName: 'Diamond Bladed Knife', uid: 614561, status: 'held', bonuses: [], buyPrice: 75_000_000 },
    { id: 'held-dbk-b', itemName: 'Diamond Bladed Knife', uid: 614562, status: 'held', bonuses: [], buyPrice: 75_000_000 },
  ];
  const preview = P.buildScanPreview([mk('sale-a', 614561), mk('sale-b', 614562)], { cats, items: held, transactions: [] });
  assert.strictEqual(preview.sales.length, 2);
  assert.strictEqual(preview.sales[0].duplicate, false);
  assert.strictEqual(preview.sales[1].duplicate, true);
});

// ─── v0.3.238 — reinforce the auction channel across all rarity colours ──────

test('an orange auction buy survives reconcile even when itemdetails resolves no colour', () => {
  // Bug: "first auction buy of an orange rare weapon — scan did not detect it as a
  // purchase." Torn's rarity enum is only yellow|orange|red|null, so a failed or
  // rate-limited per-uid itemdetails call comes back null — indistinguishable from
  // a standard item by rarity alone. An auction win is a deliberate RW purchase, so
  // it must be kept on a null rarity, not silently dropped.
  const itemNames = { 614: 'Diamond Bladed Knife' };
  const buy = P.classifyLogEvent({
    id: 'orange-auction', timestamp: 1783000000,
    data: { item: { id: 614, uid: 900001, name: 'Diamond Bladed Knife' }, final_price: 42_000_000 },
  }, P.SCAN_LOG_TYPES.auctionBuy, 'orange-auction', itemNames, cats);
  const preview = P.buildScanPreview([buy], { cats, itemNames, items: [], transactions: [] });
  assert.strictEqual(preview.buys.length, 1);
  assert.strictEqual(preview.buys[0].buySource, 'auction');

  // itemdetails never resolved a colour → rarity stays null.
  const enriched = preview.buys.map(h => ({ ...h, rarity: null }));
  const { keptBuys } = P.reconcileScanRarity(preview, enriched);
  assert.strictEqual(keptBuys.length, 1, 'the auction buy is kept despite a null rarity');
  assert.strictEqual(keptBuys[0].itemName, 'Diamond Bladed Knife');
});

test('reconcile keeps auction buys of every RW colour (orange and red, not just yellow)', () => {
  const itemNames = { 614: 'Diamond Bladed Knife' };
  const mkBuy = (id, uid) => P.classifyLogEvent({
    id, timestamp: 1783000000,
    data: { item: { id: 614, uid, name: 'Diamond Bladed Knife' }, final_price: 42_000_000 },
  }, P.SCAN_LOG_TYPES.auctionBuy, id, itemNames, cats);
  const preview = P.buildScanPreview([mkBuy('a', 1), mkBuy('b', 2), mkBuy('c', 3)],
    { cats, itemNames, items: [], transactions: [] });
  const enriched = preview.buys.map((h, i) => ({ ...h, rarity: ['orange', 'red', 'yellow'][i] }));
  const { keptBuys } = P.reconcileScanRarity(preview, enriched);
  assert.strictEqual(keptBuys.length, 3, 'orange, red and yellow auction buys are all kept');
});

test('an item-market buy with a null rarity is STILL dropped (phantom protection intact)', () => {
  // The auction exemption must not leak to the item market / bazaar, where the
  // standard-variant phantom lives.
  const itemNames = { 219: 'Enfield SA-80' };
  const c = { 'enfield sa-80': 'Primary' };
  const buy = P.classifyLogEvent({
    id: 'mkt-buy', timestamp: 1783000000,
    data: { items: [{ id: 219, uid: 555 }], cost_total: 200_000 },
  }, P.SCAN_LOG_TYPES.itemMarketBuy, 'mkt-buy', itemNames, c);
  const preview = P.buildScanPreview([buy], { cats: c, itemNames, items: [], transactions: [] });
  const enriched = preview.buys.map(h => ({ ...h, rarity: null }));
  const { keptBuys } = P.reconcileScanRarity(preview, enriched);
  assert.strictEqual(keptBuys.length, 0, 'a colourless item-market buy is dropped as before');
});

test('a uid-less auction SELL closes an old uid-less held row (does not drop as "no armoury uid")', () => {
  // Bug: "auction SELL on an old-age held item does not match and close the previous
  // item." Old / manually-entered held rows carry no uid, and the auction sale log
  // may not surface one either. The uid-less-sale drop is scoped to the item market
  // and bazaar (where stackable non-RW variants live); the auction house lists only
  // single RW instances, so a uid-less auction sell must reach matchSell and close
  // its uid-less held row by name.
  const itemNames = { 614: 'Diamond Bladed Knife' };
  const sale = P.classifyLogEvent({
    id: 'auction-sell', timestamp: 1783100000,
    data: { item: { id: 614, name: 'Diamond Bladed Knife' }, final_price: 50_000_000, buyer: 'Buyer' },
  }, P.SCAN_LOG_TYPES.auctionSale, 'auction-sell', itemNames, cats);
  assert.strictEqual(sale.sell.uid, null, 'this auction sale log carried no uid');
  assert.strictEqual(sale.sell.venue, 'auction');

  const preview = P.buildScanPreview([sale], {
    cats, itemNames,
    items: [{ id: 'old-row', itemName: 'Diamond Bladed Knife', uid: null, status: 'held', bonuses: [], buyPrice: 30_000_000 }],
    transactions: [],
  });
  assert.strictEqual(preview.sales.length, 1, 'the uid-less auction sale is matched, not ignored');
  assert.strictEqual(preview.sales[0].matchedId, 'old-row');
  assert.ok(!preview.ignored.some(r => r.reason === 'non-RW sale — no armoury uid'),
    'the auction sale is not dropped as a uid-less non-RW dump');
});

test('a uid-less auction SELL still cannot steal a uid-bearing RW row (phantom protection intact)', () => {
  // The auction exemption only lets a uid-less auction sale reach matchSell — it does
  // NOT relax matchSell. A uid-bearing held RW row can still only be closed by its
  // exact-uid sale, so a uid-less auction sell of the same name cannot grab it.
  const itemNames = { 614: 'Diamond Bladed Knife' };
  const sale = P.classifyLogEvent({
    id: 'auction-sell', timestamp: 1783100000,
    data: { item: { id: 614, name: 'Diamond Bladed Knife' }, final_price: 5_000, buyer: 'Buyer' },
  }, P.SCAN_LOG_TYPES.auctionSale, 'auction-sell', itemNames, cats);
  const preview = P.buildScanPreview([sale], {
    cats, itemNames,
    items: [{ id: 'rw-row', itemName: 'Diamond Bladed Knife', uid: 777, status: 'held', bonuses: [], buyPrice: 75_000_000 }],
    transactions: [],
  });
  assert.strictEqual(preview.sales.length, 0, 'the uid-less auction sale cannot close the uid-bearing RW row');
  assert.strictEqual(preview.sales.filter(s => s.matchedId === 'rw-row').length, 0);
});

test('a uid-less item-market sell is STILL dropped as a non-RW dump (auction exemption is channel-scoped)', () => {
  const itemNames = { 614: 'Diamond Bladed Knife' };
  const sale = P.classifyLogEvent({
    id: 'mkt-sell', timestamp: 1783100000,
    data: { items: [{ id: 614, uid: 0, name: 'Diamond Bladed Knife' }], cost_total: 30_000_000, buyer: 'Buyer' },
  }, P.SCAN_LOG_TYPES.itemMarketSale, 'mkt-sell', itemNames, cats);
  const preview = P.buildScanPreview([sale], {
    cats, itemNames,
    items: [{ id: 'old-row', itemName: 'Diamond Bladed Knife', uid: null, status: 'held', bonuses: [], buyPrice: 30_000_000 }],
    transactions: [],
  });
  assert.strictEqual(preview.sales.length, 0);
  assert.ok(preview.ignored.some(r => r.reason === 'non-RW sale — no armoury uid'),
    'a uid-less item-market sell is still a phantom dump');
});
