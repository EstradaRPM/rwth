// node test-ledgerstats.js
// Tests for LedgerStats (issue #307) — the pure Ledger-dashboard aggregator.
// Mirrors test-trade-ledger.js's plain-assertion style, but requires the
// shipped .user.js directly (ADR-0002 seam) so the real code is exercised.
// External behavior only: feed items[] + injected now, assert summary outputs.

'use strict';

// ── Browser-global shim (lets the IIFE load under Node, skips DOM bootstrap) ──

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

const { LedgerStats } = globalThis.__RwthPure;

// ── Test helpers ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label, condition) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else           { console.error(`  ✗ ${label}`); failed++; }
}

function assertEq(label, a, b) {
  if (a === b) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}  (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`); failed++; }
}

function assertFiniteDeep(label, value) {
  const seen = new Set();
  function walk(v) {
    if (typeof v === 'number') return Number.isFinite(v);
    if (!v || typeof v !== 'object') return true;
    if (seen.has(v)) return true;
    seen.add(v);
    return Object.values(v).every(walk);
  }
  assert(label, walk(value));
}

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

function held(over = {})   { return { status: 'held',   itemName: 'Item', buyPrice: 1000, buyTimestamp: NOW, ...over }; }
function listed(over = {}) { return { status: 'listed', itemName: 'Item', buyPrice: 1000, listPrice: 1500, buyTimestamp: NOW, ...over }; }
function sold(over = {})   {
  return {
    status: 'sold', itemName: 'Item', buyPrice: 1000,
    saleNet: 1500, saleFees: 50,
    buyTimestamp: NOW - 2 * DAY, soldTimestamp: NOW, ...over,
  };
}

// ── empty ledger ──────────────────────────────────────────────────────────────

console.log('\nempty ledger');
{
  const s = LedgerStats.summarize([], NOW);
  assertEq('realized 0', s.realized, 0);
  assertEq('realizedRoiPct 0 (no divide-by-zero)', s.realizedRoiPct, 0);
  assertEq('pending 0', s.pending, 0);
  assertEq('capitalDeployed 0', s.capitalDeployed, 0);
  assertEq('winRate 0', s.winRate, 0);
  assertEq('avgDaysToClear 0', s.avgDaysToClear, 0);
  assertEq('feesPaid 0', s.feesPaid, 0);
  assertEq('soldCount 0', s.soldCount, 0);
  assertEq('best null', s.best, null);
  assertEq('worst null', s.worst, null);
  assert('no NaN anywhere', Object.values(s).every(v => typeof v !== 'number' || Number.isFinite(v)));
}

// ── non-array / garbage input never throws ────────────────────────────────────

console.log('\ngarbage input');
{
  const s = LedgerStats.summarize(undefined, NOW);
  assertEq('undefined items → realized 0', s.realized, 0);
  const s2 = LedgerStats.summarize([null, undefined, {}], NOW);
  assertEq('null/empty rows ignored → capitalDeployed 0', s2.capitalDeployed, 0);
}

// ── only held ─────────────────────────────────────────────────────────────────

console.log('\nonly held');
{
  const s = LedgerStats.summarize([held({ buyPrice: 1000 }), held({ buyPrice: 2500 })], NOW);
  assertEq('capitalDeployed sums held buy prices', s.capitalDeployed, 3500);
  assertEq('realized 0 (nothing sold)', s.realized, 0);
  assertEq('pending 0 (nothing listed)', s.pending, 0);
  assertEq('soldCount 0', s.soldCount, 0);
}

// ── only listed ───────────────────────────────────────────────────────────────

console.log('\nonly listed');
{
  const s = LedgerStats.summarize([
    listed({ buyPrice: 1000, listPrice: 1500 }),
    listed({ buyPrice: 2000, listPrice: 2400 }),
  ], NOW);
  assertEq('pending sums (list - cost)', s.pending, (1500 - 1000) + (2400 - 2000));
  assertEq('capitalDeployed counts listed cost', s.capitalDeployed, 3000);
  assertEq('listedCount 2', s.listedCount, 2);
  assertEq('realized 0', s.realized, 0);
}

// ── no sold items (mixed held + listed) ──────────────────────────────────────

console.log('\nno sold items');
{
  const s = LedgerStats.summarize([held({ buyPrice: 500 }), listed({ buyPrice: 1000, listPrice: 1200 })], NOW);
  assertEq('winRate 0 with no sales', s.winRate, 0);
  assertEq('avgDaysToClear 0 with no sales', s.avgDaysToClear, 0);
  assertEq('capitalDeployed held+listed', s.capitalDeployed, 1500);
  assertEq('pending from the listed row', s.pending, 200);
}

// ── a loss-making sale lowers realized P/L and win rate ───────────────────────

console.log('\nloss sale');
{
  const s = LedgerStats.summarize([
    sold({ itemName: 'Win',  buyPrice: 1000, saleNet: 1500 }),  // +500
    sold({ itemName: 'Loss', buyPrice: 2000, saleNet: 1200 }),  // -800
  ], NOW);
  assertEq('realized nets win + loss', s.realized, 500 - 800);
  assertEq('soldCost is total cost basis', s.realizedRoiPct, Math.round((-300 / 3000) * 100 * 10) / 10);
  assertEq('winRate counts only profitable', s.winRate, 50);
  assertEq('best flip is the winner', s.best.name, 'Win');
  assertEq('best profit', s.best.profit, 500);
  assertEq('worst flip is the loss', s.worst.name, 'Loss');
  assertEq('worst profit', s.worst.profit, -800);
}

// ── list price below cost yields negative pending ─────────────────────────────

console.log('\nlist below cost');
{
  const s = LedgerStats.summarize([listed({ buyPrice: 2000, listPrice: 1500 })], NOW);
  assertEq('pending negative', s.pending, -500);
}

// ── missing / non-finite timestamps never produce NaN ────────────────────────

console.log('\nmissing timestamps');
{
  const s = LedgerStats.summarize([
    sold({ buyTimestamp: undefined, soldTimestamp: NOW }),       // no buy stamp
    sold({ buyTimestamp: NOW - DAY, soldTimestamp: undefined }), // no sold stamp
    sold({ buyTimestamp: NOW, soldTimestamp: NOW - DAY }),       // sold before buy (sane filter)
    sold({ buyTimestamp: NOW - 4 * DAY, soldTimestamp: NOW }),   // the one valid span: 4 days
  ], NOW);
  assert('avgDaysToClear finite', Number.isFinite(s.avgDaysToClear));
  assertEq('avgDaysToClear uses only the valid span', s.avgDaysToClear, 4);
  assertEq('all four still count as sold', s.soldCount, 4);
}

// ── missing saleNet excludes the row from realized/sold ───────────────────────

console.log('\nsold row missing saleNet');
{
  const s = LedgerStats.summarize([
    sold({ saleNet: null }),
    sold({ buyPrice: 1000, saleNet: 1400 }),
  ], NOW);
  assertEq('only the priced sale counts', s.soldCount, 1);
  assertEq('realized from the priced sale', s.realized, 400);
}

// ── single sold item ──────────────────────────────────────────────────────────

console.log('\nsingle sold item');
{
  const s = LedgerStats.summarize([
    sold({ buyPrice: 1000, saleNet: 1600, saleFees: 80, buyTimestamp: NOW - 3 * DAY, soldTimestamp: NOW }),
  ], NOW);
  assertEq('realized', s.realized, 600);
  assertEq('realizedRoiPct', s.realizedRoiPct, 60);
  assertEq('winRate 100', s.winRate, 100);
  assertEq('avgDaysToClear', s.avgDaysToClear, 3);
  assertEq('feesPaid', s.feesPaid, 80);
  assertEq('best is the only flip', s.best.profit, 600);
  assertEq('worst is the only flip', s.worst.profit, 600);
}

// ── mixed realistic ledger (held + listed + sold) ─────────────────────────────

console.log('\nmixed realistic ledger');
{
  const s = LedgerStats.summarize([
    held({ buyPrice: 5000 }),
    listed({ buyPrice: 10000, listPrice: 13000 }),
    listed({ buyPrice: 8000, listPrice: 7500 }),                 // listed at a loss
    sold({ buyPrice: 12000, saleNet: 15000, saleFees: 300, buyTimestamp: NOW - 2 * DAY, soldTimestamp: NOW }),
    sold({ buyPrice: 9000, saleNet: 8500, saleFees: 200, buyTimestamp: NOW - 6 * DAY, soldTimestamp: NOW }),
  ], NOW);
  assertEq('realized', s.realized, 3000 - 500);
  assertEq('pending', s.pending, 3000 - 500);
  assertEq('capitalDeployed (held + 2 listed)', s.capitalDeployed, 5000 + 10000 + 8000);
  assertEq('feesPaid', s.feesPaid, 500);
  assertEq('winRate', s.winRate, 50);
  assertEq('avgDaysToClear', s.avgDaysToClear, 4);
  assertEq('listedCount', s.listedCount, 2);
  assertEq('soldCount', s.soldCount, 2);
}

// ── cumulative-profit series (hero chart dataset, #309) ──────────────────────

console.log('\ncumulativeProfit — empty / no sold');
{
  assertEq('empty ledger → empty series', LedgerStats.summarize([], NOW).cumulativeProfit.length, 0);
  assertEq('held + listed only → empty series',
    LedgerStats.summarize([held(), listed()], NOW).cumulativeProfit.length, 0);
}

console.log('\ncumulativeProfit — single sold');
{
  const s = LedgerStats.summarize([sold({ buyPrice: 1000, saleNet: 1500, soldTimestamp: NOW })], NOW);
  assertEq('one point', s.cumulativeProfit.length, 1);
  assertEq('point keyed by soldTimestamp', s.cumulativeProfit[0].t, NOW);
  assertEq('cumulative = its profit', s.cumulativeProfit[0].cumulative, 500);
}

console.log('\ncumulativeProfit — ordered + accumulated');
{
  // Fed out of time order; series must sort ascending by soldTimestamp.
  const s = LedgerStats.summarize([
    sold({ buyPrice: 1000, saleNet: 1300, soldTimestamp: NOW + 2 * DAY }),   // +300 (latest)
    sold({ buyPrice: 1000, saleNet: 1500, soldTimestamp: NOW }),             // +500 (earliest)
    sold({ buyPrice: 2000, saleNet: 1200, soldTimestamp: NOW + DAY }),       // -800 (middle)
  ], NOW);
  assertEq('three points', s.cumulativeProfit.length, 3);
  assert('sorted ascending by t',
    s.cumulativeProfit[0].t < s.cumulativeProfit[1].t && s.cumulativeProfit[1].t < s.cumulativeProfit[2].t);
  assertEq('running total p1', s.cumulativeProfit[0].cumulative, 500);
  assertEq('running total p2', s.cumulativeProfit[1].cumulative, 500 - 800);
  assertEq('running total p3', s.cumulativeProfit[2].cumulative, 500 - 800 + 300);
  assertEq('final cumulative == realized', s.cumulativeProfit[2].cumulative, s.realized);
}

console.log('\ncumulativeProfit — drops rows missing soldTimestamp');
{
  const s = LedgerStats.summarize([
    sold({ buyPrice: 1000, saleNet: 1500, soldTimestamp: undefined }),  // no stamp → off-curve
    sold({ buyPrice: 1000, saleNet: 1400, soldTimestamp: NOW }),
  ], NOW);
  assertEq('only the stamped sale plots', s.cumulativeProfit.length, 1);
  assertEq('but both still count as sold', s.soldCount, 2);
}

// ── profit projection forecast (#358) ────────────────────────────────────────

console.log('\nprofitProjection — sold rows stay authoritative');
{
  const s = LedgerStats.summarize([
    sold({ buyPrice: 1000, listPrice: 999999, saleNet: 1400, soldTimestamp: NOW }),
    sold({ buyPrice: 2000, listPrice: 1, saleNet: 1500, soldTimestamp: NOW + DAY }),
  ], NOW + DAY);
  assertEq('realized cumulative point 1 uses saleNet - buyPrice', s.profitProjection.realized[0].cumulative, 400);
  assertEq('realized cumulative point 2 uses saleNet - buyPrice', s.profitProjection.realized[1].cumulative, 400 - 500);
  assertEq('forecast series includes the realized points', s.profitProjection.series.length, 2);
  assertEq('no listed rows -> no projections', s.profitProjection.projected.length, 0);
}

console.log('\nprofitProjection — listed ask-derived points');
{
  // Total realized 1300. Pace anchors on the earliest BUY across all items —
  // here the stale listed row bought NOW-20d — so elapsed = 20 days and the
  // pace = 1300 / 20 = 65/d.
  const s = LedgerStats.summarize([
    sold({ buyPrice: 1000, saleNet: 1500, buyTimestamp: NOW - 10 * DAY, soldTimestamp: NOW - 8 * DAY }),
    sold({ buyPrice: 1000, saleNet: 1800, buyTimestamp: NOW - 8 * DAY, soldTimestamp: NOW - 2 * DAY }),
    listed({ id: 'future', itemName: 'Future ask', buyPrice: 2000, listPrice: 2600, buyTimestamp: NOW - DAY }),
    listed({ id: 'stale', itemName: 'Stale ask', buyPrice: 3000, listPrice: 3300, buyTimestamp: NOW - 20 * DAY }),
  ], NOW);
  const projected = s.profitProjection.projected;
  assertEq('avg clear time comes from sold rows', s.avgDaysToClear, 4);
  assertEq('two finite listed rows project', projected.length, 2);
  assertEq('future listed profit is ask - buy', projected.find(p => p.id === 'future').profit, 600);
  assertEq('future listed expected sell date is buy + avg clear', projected.find(p => p.id === 'future').t, NOW + 3 * DAY);
  assertEq('stale expected sell date clamps to now', projected.find(p => p.id === 'stale').t, NOW);
  assertEq('stale projection records the clamp basis', projected.find(p => p.id === 'stale').timing, 'avg-clear-clamped');
  assertEq('final forecast adds projected profits to realized baseline',
    s.profitProjection.series[s.profitProjection.series.length - 1].cumulative,
    s.realized + 300 + 600);
  assertEq('listed floor keeps ask profit over avg clear time', Math.round(s.profitProjection.listedDailyProfit), 225);
  assertEq('elapsed days span first buy to now', s.profitProjection.elapsedDays, 20);
  assertEq('paced profit is total realized', s.profitProjection.pacedProfit, 1300);
  assertEq('paced sold count', s.profitProjection.pacedSoldCount, 2);
  assertEq('realized pace = total profit / elapsed days', Math.round(s.profitProjection.realizedDailyProfit), 65);
  assertEq('forecast basis is realized history only', s.profitProjection.forecastBasis, 'history');
  assertEq('daily pace = realizedDaily x 1', s.profitProjection.periods.find(p => p.key === 'day').profit, 65);
  assertEq('weekly pace = realizedDaily x 7', s.profitProjection.periods.find(p => p.key === 'week').profit, 455);
  assertEq('monthly pace = realizedDaily x 30', s.profitProjection.periods.find(p => p.key === 'month').profit, 1950);
  assertEq('quarterly pace = realizedDaily x 90', s.profitProjection.periods.find(p => p.key === 'quarter').profit, 5850);
  assertEq('yearly pace = realizedDaily x 365', s.profitProjection.periods.find(p => p.key === 'year').profit, 23725);
}

console.log('\nprofitProjection — pace decays as elapsed days grow without a sale');
{
  // Same $1000 of realized profit, viewed at two different "now"s. Pace anchors
  // on the buy (NOW-19d), so elapsed is 19 then 23 days; the monthly pace eases
  // down as days accrue without a new sale.
  const base = [sold({ buyPrice: 1000, saleNet: 2000, buyTimestamp: NOW - 19 * DAY, soldTimestamp: NOW - 18 * DAY })];
  const at18 = LedgerStats.summarize(base, NOW);
  const at22 = LedgerStats.summarize(base, NOW + 4 * DAY);
  assertEq('elapsed days at first read', at18.profitProjection.elapsedDays, 19);
  assertEq('elapsed days four days later', at22.profitProjection.elapsedDays, 23);
  assertEq('monthly pace at 19 days = 1000/19*30', at18.profitProjection.periods.find(p => p.key === 'month').profit, 1579);
  assertEq('monthly pace at 23 days = 1000/23*30', at22.profitProjection.periods.find(p => p.key === 'month').profit, 1304);
  assert('pace decayed with no new sale',
    at22.profitProjection.realizedDailyProfit < at18.profitProjection.realizedDailyProfit);
}

console.log('\nprofitProjection — realized pace can lift a thin listed floor');
{
  // 5 sales, all bought NOW-6d, total realized 6300. Pace anchors on that first
  // buy: 6300 / 6 = 1050/d, well above the listed floor. Spans 0–4d → avg clear 2.
  const s = LedgerStats.summarize([
    sold({ buyPrice: 1000, saleNet: 2500, buyTimestamp: NOW - 6 * DAY, soldTimestamp: NOW - 6 * DAY }),
    sold({ buyPrice: 1000, saleNet: 2400, buyTimestamp: NOW - 6 * DAY, soldTimestamp: NOW - 5 * DAY }),
    sold({ buyPrice: 1000, saleNet: 2300, buyTimestamp: NOW - 6 * DAY, soldTimestamp: NOW - 4 * DAY }),
    sold({ buyPrice: 1000, saleNet: 2200, buyTimestamp: NOW - 6 * DAY, soldTimestamp: NOW - 3 * DAY }),
    sold({ buyPrice: 1000, saleNet: 1900, buyTimestamp: NOW - 6 * DAY, soldTimestamp: NOW - 2 * DAY }),
    listed({ id: 'thin', buyPrice: 1000, listPrice: 1700, buyTimestamp: NOW - DAY }),
  ], NOW);
  assertEq('listed floor over avg clear (700 / 2d)', Math.round(s.profitProjection.listedDailyProfit), 350);
  assertEq('elapsed days span first buy to now', s.profitProjection.elapsedDays, 6);
  assertEq('realized pace = 6300 / 6 elapsed days', Math.round(s.profitProjection.realizedDailyProfit), 1050);
  assertEq('basis is realized history even when listed pipeline exists', s.profitProjection.forecastBasis, 'history');
  assert('realized daily forecast is above the listed floor',
    s.profitProjection.dailyProfit > s.profitProjection.listedDailyProfit);
  assertEq('monthly forecast = pace x 30', s.profitProjection.periods.find(p => p.key === 'month').profit, 31500);
}

console.log('\nprofitProjection — mug cash reduces realized pace when present');
{
  // Single sale: gross flip 2000, bought NOW-10d. Mug 600 (item-agnostic, via
  // the mugs arg) nets realized to 1400 over 10 elapsed days = 140/d. Without
  // the mug it would pace at 200/d. The chart curve stays gross; the mug nets
  // the headline P/L and the pace, not individual sale points.
  const items = [sold({ buyPrice: 1000, saleNet: 3000, buyTimestamp: NOW - 10 * DAY, soldTimestamp: NOW - 9 * DAY })];
  const s = LedgerStats.summarize(items, NOW, [{ amount: 600 }]);
  const noMug = LedgerStats.summarize(items, NOW, []);
  assertEq('realized P/L subtracts mug cash', s.realized, 1400);
  assertEq('cumulative chart point stays gross flip', s.profitProjection.realized[0].cumulative, 2000);
  assertEq('realized pace subtracts mug cash (1400 / 10 days)', Math.round(s.profitProjection.realizedDailyProfit), 140);
  assertEq('monthly forecast includes mug-adjusted realized P/L', s.profitProjection.periods.find(p => p.key === 'month').profit, 4200);
  assert('mug drags the pace below the no-mug case',
    s.profitProjection.realizedDailyProfit < noMug.profitProjection.realizedDailyProfit);
}

console.log('\nprofitProjection — invalid input stays finite');
{
  const s = LedgerStats.summarize([
    listed({ id: 'missing-ask', buyPrice: 1000, listPrice: null }),
    listed({ id: 'missing-buy', buyPrice: null, listPrice: 1500 }),
    listed({ id: 'bad-ask', buyPrice: 1000, listPrice: Infinity }),
    listed({ id: 'bad-buy', buyPrice: NaN, listPrice: 1500 }),
    listed({ id: 'valid-no-stamp', buyPrice: 1000, listPrice: 1300, buyTimestamp: undefined }),
  ], NOW);
  assertEq('invalid price legs do not create fake zero-profit projections', s.profitProjection.projected.length, 1);
  assertEq('valid no-stamp projection keeps ask-derived profit', s.profitProjection.projected[0].profit, 300);
  assertEq('missing timing falls back to now', s.profitProjection.projected[0].t, NOW);
  assertEq('no clear history uses seven-day pace fallback', s.profitProjection.clearDays, 7);
  assertEq('listed ask alone does not create growth pace', s.profitProjection.periods.find(p => p.key === 'day').profit, 0);
  assertEq('listed ask alone leaves no operating forecast basis', s.profitProjection.forecastBasis, 'none');
  assertFiniteDeep('forecast contains no NaN/Infinity', s.profitProjection);
}

console.log('\nprofitProjection — invalid now still safe');
{
  const s = LedgerStats.summarize([
    listed({ id: 'no-clock', buyPrice: 1000, listPrice: 1500, buyTimestamp: undefined }),
  ], NaN);
  assertEq('projection still exists for finite prices', s.profitProjection.projected.length, 1);
  assertEq('fallback timestamp is finite zero when no time source exists', s.profitProjection.projected[0].t, 0);
  assertFiniteDeep('invalid now does not leak NaN', s.profitProjection);
}

// ── mug-loss headline (mugLossTotal / mugRoiPct) ─────────────────────────────

console.log('\nmug losses — none logged');
{
  const s = LedgerStats.summarize([sold({ buyPrice: 1000, saleNet: 1500 })], NOW);
  assertEq('mugLossTotal 0 when no mugs', s.mugLossTotal, 0);
  assertEq('mugRoiPct 0 when no mugs', s.mugRoiPct, 0);
}

console.log('\nmug losses — surfaced as ROI drag');
{
  const s = LedgerStats.summarize([
    sold({ buyPrice: 1000, saleNet: 3000 }),   // cost 1000
    sold({ buyPrice: 1000, saleNet: 1500 }),   // cost 1000
  ], NOW, [{ amount: 600 }]);                   // item-agnostic mug cash
  assertEq('mugLossTotal sums recorded mug cash', s.mugLossTotal, 600);
  // soldCost = 2000 → 600 / 2000 = 30% ROI lost.
  assertEq('mugRoiPct is mug cash / cost basis', s.mugRoiPct, 30);
  // Equals the gap between gross ROI and the realized ROI it already nets.
  const grossRoi = round1(((3000 - 1000 + 1500 - 1000) / 2000) * 100);
  assertEq('mugRoiPct equals gross ROI minus realized ROI',
    s.mugRoiPct, round1(grossRoi - s.realizedRoiPct));
}

console.log('\nmug losses — empty ledger stays finite');
{
  const s = LedgerStats.summarize([], NOW);
  assertEq('mugLossTotal 0 on empty', s.mugLossTotal, 0);
  assertEq('mugRoiPct 0 on empty (no divide-by-zero)', s.mugRoiPct, 0);
}

function round1(n) { return Math.round(n * 10) / 10; }

// ── margin spread buckets (#310) ─────────────────────────────────────────────

function bucketCount(buckets, label) {
  const b = buckets.find(x => x.label === label);
  return b ? b.count : undefined;
}

function bucketValue(buckets, label) {
  const b = buckets.find(x => x.label === label);
  return b ? b.value : undefined;
}

console.log('\nmarginBuckets — empty / no sold');
{
  const s = LedgerStats.summarize([held(), listed()], NOW);
  assertEq('five buckets even when empty', s.marginBuckets.length, 5);
  assertEq('all zero with no sales', s.marginBuckets.reduce((a, b) => a + b.count, 0), 0);
}

console.log('\nmarginBuckets — populated across ranges');
{
  const s = LedgerStats.summarize([
    sold({ buyPrice: 1000, saleNet: 800 }),    // -20%  → loss
    sold({ buyPrice: 1000, saleNet: 1100 }),   // +10%  → 0–25
    sold({ buyPrice: 1000, saleNet: 1300 }),   // +30%  → 25–50
    sold({ buyPrice: 1000, saleNet: 1700 }),   // +70%  → 50–100
    sold({ buyPrice: 1000, saleNet: 2500 }),   // +150% → 100+
    sold({ buyPrice: 0, saleNet: 500 }),       // no cost basis → excluded
  ], NOW);
  assertEq('loss bucket', bucketCount(s.marginBuckets, 'loss'), 1);
  assertEq('0–25 bucket', bucketCount(s.marginBuckets, '0–25'), 1);
  assertEq('25–50 bucket', bucketCount(s.marginBuckets, '25–50'), 1);
  assertEq('50–100 bucket', bucketCount(s.marginBuckets, '50–100'), 1);
  assertEq('100+ bucket', bucketCount(s.marginBuckets, '100+'), 1);
  assertEq('zero-cost row excluded from margin', s.marginBuckets.reduce((a, b) => a + b.count, 0), 5);
}

// ── inventory aging buckets (#310) ───────────────────────────────────────────

console.log('\nagingBuckets — empty / no held+listed');
{
  const s = LedgerStats.summarize([sold()], NOW);
  assertEq('five buckets even when empty', s.agingBuckets.length, 5);
  assertEq('all zero with nothing held/listed', s.agingBuckets.reduce((a, b) => a + b.count, 0), 0);
}

console.log('\nagingBuckets — buy-anchored via injected now');
{
  const s = LedgerStats.summarize([
    held({ buyTimestamp: NOW - 1 * DAY }),    // 1d   → 0–3d
    listed({ buyTimestamp: NOW - 5 * DAY }),  // 5d   → 3–7d
    held({ buyTimestamp: NOW - 10 * DAY }),   // 10d  → 7–14d
    listed({ buyTimestamp: NOW - 20 * DAY }), // 20d  → 14–30d
    held({ buyTimestamp: NOW - 45 * DAY }),   // 45d  → 30d+
    sold({ buyTimestamp: NOW - 99 * DAY }),   // sold → not in aging
    held({ buyTimestamp: undefined }),        // no stamp → dropped
  ], NOW);
  assertEq('0–3d', bucketCount(s.agingBuckets, '0–3d'), 1);
  assertEq('3–7d', bucketCount(s.agingBuckets, '3–7d'), 1);
  assertEq('7–14d', bucketCount(s.agingBuckets, '7–14d'), 1);
  assertEq('14–30d', bucketCount(s.agingBuckets, '14–30d'), 1);
  assertEq('30d+', bucketCount(s.agingBuckets, '30d+'), 1);
  assertEq('only held+listed with stamps counted', s.agingBuckets.reduce((a, b) => a + b.count, 0), 5);
}

// ── aging by value + dead capital (#310 rework) ──────────────────────────────

console.log('\nagingValueBuckets — dollars per age band');
{
  const s = LedgerStats.summarize([
    held({ buyPrice: 1000, buyTimestamp: NOW - 1 * DAY }),   // 1d   → 0–3d
    listed({ buyPrice: 2000, buyTimestamp: NOW - 20 * DAY }),// 20d  → 14–30d
    held({ buyPrice: 4000, buyTimestamp: NOW - 45 * DAY }),  // 45d  → 30d+
    held({ buyPrice: 500, buyTimestamp: undefined }),        // no stamp → dropped
  ], NOW);
  assertEq('five value bands', s.agingValueBuckets.length, 5);
  assertEq('0–3d $ = buy of the 1d row', bucketValue(s.agingValueBuckets, '0–3d'), 1000);
  assertEq('14–30d $ = buy of the 20d row', bucketValue(s.agingValueBuckets, '14–30d'), 2000);
  assertEq('30d+ $ = buy of the 45d row', bucketValue(s.agingValueBuckets, '30d+'), 4000);
  assertEq('empty band is $0', bucketValue(s.agingValueBuckets, '7–14d'), 0);
}

console.log('\ndeadCapital — 30d+ dollars, share, oldest');
{
  const s = LedgerStats.summarize([
    held({ buyPrice: 1000, buyTimestamp: NOW - 5 * DAY }),   // fresh
    held({ buyPrice: 3000, buyTimestamp: NOW - 40 * DAY }),  // stale
    listed({ buyPrice: 1000, buyTimestamp: NOW - 60 * DAY }),// stale + oldest
  ], NOW);
  assertEq('dead $ = 30d+ cost basis', s.deadCapital.amount, 4000);
  assertEq('% of deployed capital', s.deadCapital.pct, 80); // 4000 / 5000
  assertEq('oldest open position days', s.deadCapital.oldestDays, 60);
}

console.log('\ndeadCapital — none when all fresh');
{
  const s = LedgerStats.summarize([held({ buyTimestamp: NOW - 2 * DAY })], NOW);
  assertEq('no dead capital', s.deadCapital.amount, 0);
  assertEq('0% dead', s.deadCapital.pct, 0);
}

// ── fee drag + velocity (#310 rework) ────────────────────────────────────────

console.log('\nfeePct — fees as a share of gross turnover');
{
  const s = LedgerStats.summarize([
    sold({ buyPrice: 1000, saleNet: 1900, saleFees: 100 }), // gross 2000, fee 100
    sold({ buyPrice: 1000, saleNet: 950,  saleFees: 50 }),  // gross 1000, fee 50
  ], NOW);
  // total fee 150 / total gross 3000 = 5%
  assertEq('feePct', s.feePct, 5);
}

console.log('\nvelocityPctPerDay — ROI ÷ avg days-to-clear');
{
  const s = LedgerStats.summarize([
    sold({ buyPrice: 1000, saleNet: 1500, buyTimestamp: NOW - 5 * DAY, soldTimestamp: NOW }),
  ], NOW);
  // realized 500, mug 0 → ROI 50% over a 5d clear → 10%/day
  assertEq('velocity', s.velocityPctPerDay, 10);
}

console.log('\nvelocityPctPerDay — null with no clear time');
{
  const s = LedgerStats.summarize([held(), listed()], NOW);
  assertEq('null velocity when no sales', s.velocityPctPerDay, null);
}

// ── sourcing edge (#310 rework) ──────────────────────────────────────────────

console.log('\nsourcing — grouped by bonus/item/type, ranked by profit');
{
  const s = LedgerStats.summarize([
    sold({ itemName: 'Riot Shield', category: 'Armor',   bonusName: 'Impregnable', buyPrice: 1000, saleNet: 3000 }), // +2000
    sold({ itemName: 'Riot Shield', category: 'Armor',   bonusName: 'Impregnable', buyPrice: 1000, saleNet: 2000 }), // +1000
    sold({ itemName: 'PGP',         category: 'Primary',  bonusName: 'Damage',      buyPrice: 1000, saleNet: 1500 }), // +500
    sold({ itemName: 'Loss Item',   category: 'Primary',  bonusName: 'Damage',      buyPrice: 1000, saleNet: 800 }),  // -200
  ], NOW);

  // byBonus: Impregnable (+3000) ranks above Damage (+300)
  assertEq('top bonus key', s.sourcing.byBonus[0].key, 'Impregnable');
  assertEq('top bonus profit', s.sourcing.byBonus[0].profit, 3000);
  assertEq('top bonus count', s.sourcing.byBonus[0].count, 2);
  // capital-weighted margin: 3000 profit / 2000 cost = 150%
  assertEq('top bonus capital-weighted margin', s.sourcing.byBonus[0].marginPct, 150);
  assertEq('second bonus key', s.sourcing.byBonus[1].key, 'Damage');
  assertEq('second bonus profit', s.sourcing.byBonus[1].profit, 300);

  // byType: Armor (+3000) above Primary (+300)
  assertEq('top type key', s.sourcing.byType[0].key, 'Armor');
  assertEq('top type profit', s.sourcing.byType[0].profit, 3000);

  // byItem: Riot Shield tops
  assertEq('top item key', s.sourcing.byItem[0].key, 'Riot Shield');
  assertEq('top item profit', s.sourcing.byItem[0].profit, 3000);
}

console.log('\nsourcing — bonus-less row lands in (unknown), cost-less excluded');
{
  const s = LedgerStats.summarize([
    sold({ itemName: 'A', bonusName: undefined, bonuses: undefined, buyPrice: 1000, saleNet: 1400 }),
    sold({ itemName: 'B', bonusName: undefined, bonuses: [{ name: 'Freshness' }], buyPrice: 1000, saleNet: 1200 }),
    sold({ itemName: 'C', bonusName: 'Damage', buyPrice: 0, saleNet: 500 }), // no cost basis → excluded
  ], NOW);
  const keys = s.sourcing.byBonus.map(g => g.key);
  assert('has (unknown) bucket', keys.includes('(unknown)'));
  assert('reads bonus from bonuses[0].name', keys.includes('Freshness'));
  assert('cost-less row excluded from sourcing', !keys.includes('Damage'));
}

// ── per-status rollups (#337) ─────────────────────────────────────────────────

console.log('\nbyStatus — empty');
{
  const s = LedgerStats.summarize([], NOW);
  assertEq('held count 0', s.byStatus.held.count, 0);
  assertEq('held cost 0', s.byStatus.held.cost, 0);
  assertEq('listed count 0', s.byStatus.listed.count, 0);
  assertEq('listed askValue 0', s.byStatus.listed.askValue, 0);
  assertEq('sold count 0', s.byStatus.sold.count, 0);
}

console.log('\nbyStatus — counts and value totals');
{
  const s = LedgerStats.summarize([
    held({ buyPrice: 1000 }),
    held({ buyPrice: 2500 }),
    listed({ buyPrice: 4000, listPrice: 6000 }),
    listed({ buyPrice: 3000, listPrice: 5000 }),
    sold(),
    sold(),
    sold(),
  ], NOW);
  assertEq('held count', s.byStatus.held.count, 2);
  assertEq('held cost sums buyPrice', s.byStatus.held.cost, 3500);
  assertEq('listed count', s.byStatus.listed.count, 2);
  assertEq('listed askValue sums listPrice', s.byStatus.listed.askValue, 11000);
  assertEq('sold count (status-keyed)', s.byStatus.sold.count, 3);
}

console.log('\nbyStatus — unset listPrice contributes 0, never NaN');
{
  const s = LedgerStats.summarize([
    listed({ buyPrice: 1000, listPrice: null }),       // unset → 0 askValue
    listed({ buyPrice: 1000, listPrice: undefined }),  // unset → 0 askValue
    listed({ buyPrice: 1000, listPrice: 2500 }),       // the only priced one
  ], NOW);
  assertEq('listed count includes unpriced rows', s.byStatus.listed.count, 3);
  assertEq('askValue counts only the finite listPrice', s.byStatus.listed.askValue, 2500);
  assert('askValue finite (no NaN)', Number.isFinite(s.byStatus.listed.askValue));
}

console.log('\nbyStatus — sold count ignores saleNet finiteness');
{
  // soldCount filters by finite saleNet; the chip count is purely status-keyed.
  const s = LedgerStats.summarize([sold({ saleNet: null }), sold({ saleNet: 1400 })], NOW);
  assertEq('soldCount drops the unpriced sale', s.soldCount, 1);
  assertEq('byStatus.sold counts both', s.byStatus.sold.count, 2);
}

// ── summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
