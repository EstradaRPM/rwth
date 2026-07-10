// node test-ledgersort.js
// Tests for LedgerSort (#341) — the ledger bar sorts on one AXIS in one DIRECTION.
// ledgerComparator(axis, dir) builds the comparator over RowModel output: `date`
// keys on buyTimestamp, `age` on the age of LIVE capital only (held/listed with an
// agingLevel; sold sinks), `roi` on the mixed projected/realized roiPct, `pl` on
// realized P/L (sold) vs projected ask-buy (listed). dir 'desc' sorts high→low,
// 'asc' low→high, and a null key must sink to the bottom in BOTH directions while
// equal keys keep input order (stable). Loads the shipped .user.js directly
// (ADR-0002 seam), mirroring test-rowmodel.js's plain-assert style.

'use strict';

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

const { ledgerComparator, RowModel } = globalThis.__RwthPure;

let passed = 0;
let failed = 0;

function assertEq(label, a, b) {
  if (a === b) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}  (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`); failed++; }
}

function assert(label, condition) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}`); failed++; }
}

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

// Each fixture row is tagged with a `name` so a sorted order reads at a glance.
// Build the RowModel projection (what the comparator actually compares) but keep
// the tag on the same object — extra fields never affect the comparators.
function row(name, item) { return { name, ...RowModel.forItem(item, NOW) }; }

// order(rows, axis, dir) — sort a copy by the built comparator, return the tags.
function order(rows, axis, dir) {
  const cmp = ledgerComparator(axis, dir);
  return rows.slice().sort(cmp).map(r => r.name);
}

// ── Mixed fixture: held (no ROI/PL), listed (projected), sold (realized) ───────

const held    = row('held',    { status: 'held',   buyPrice: 1000, buyTimestamp: NOW - 10 * DAY });
const listA   = row('listA',   { status: 'listed', buyPrice: 1000, listPrice: 1500, buyTimestamp: NOW - 5 * DAY });  // +50% proj, +500 pl
const listB   = row('listB',   { status: 'listed', buyPrice: 1000, listPrice: 1200, buyTimestamp: NOW - 2 * DAY });  // +20% proj, +200 pl
const soldHi  = row('soldHi',  { status: 'sold',   buyPrice: 1000, saleNet: 1800, buyTimestamp: NOW - 20 * DAY });   // +80% real, +800 pl
const soldLo  = row('soldLo',  { status: 'sold',   buyPrice: 1000, saleNet: 900,  buyTimestamp: NOW - 30 * DAY });   // -10% real, -100 pl

const mixed = [held, listA, listB, soldHi, soldLo];

// ── date axis: buyTimestamp, both directions; nulls sink either way ────────────

console.log('\ndate axis (buyTimestamp)');
{
  assertEq('date desc = most recent buy first (newest)',
    order(mixed, 'date', 'desc').join(','), 'listB,listA,held,soldHi,soldLo');
  assertEq('date asc = earliest buy first (oldest)',
    order(mixed, 'date', 'asc').join(','), 'soldLo,soldHi,held,listA,listB');

  const noStamp = row('noStamp', { status: 'held', buyPrice: 1000, buyTimestamp: null });
  assertEq('date desc: stampless row sinks to bottom',
    order([noStamp, listA, listB], 'date', 'desc').join(','), 'listB,listA,noStamp');
  assertEq('date asc: stampless row STILL sinks (not treated as oldest)',
    order([noStamp, listA, listB], 'date', 'asc').join(','), 'listA,listB,noStamp');
}

// ── age axis: age of LIVE capital only, both directions; sold + stampless sink ─

console.log('\nage axis (age of live held/listed capital)');
{
  // held 10d, listA 5d, listB 2d (all live, agingLevel ok); soldHi/soldLo have
  // banked out (null key) so they sink, keeping input order, in EITHER direction.
  assertEq('age desc = longest-held live capital first, sold sinks',
    order(mixed, 'age', 'desc').join(','), 'held,listA,listB,soldHi,soldLo');
  assertEq('age asc = freshest live capital first, sold still sinks',
    order(mixed, 'age', 'asc').join(','), 'listB,listA,held,soldHi,soldLo');

  // The whole point of the age axis: a SOLD row bought long ago is banked, not
  // stale, so a younger live row outranks it (a raw buy-date sort would invert).
  assertEq('age desc: young live row beats an older-bought sold row',
    order([soldLo, held], 'age', 'desc').join(','), 'held,soldLo');

  const noStamp = row('noStamp', { status: 'held', buyPrice: 1000, buyTimestamp: null });
  assertEq('age desc: stampless (null age) live row sinks to bottom',
    order([noStamp, listA, listB], 'age', 'desc').join(','), 'listA,listB,noStamp');
}

// ── roi axis: projected (listed) and realized (sold) interleaved on one scale ──

console.log('\nroi axis (mixed projected + realized)');
{
  // soldHi +80% > listA +50% > listB +20% > soldLo -10%; held has no ROI -> last.
  assertEq('roi desc interleaves listed-projected and sold-realized by roiPct',
    order(mixed, 'roi', 'desc').join(','), 'soldHi,listA,listB,soldLo,held');
  assertEq('roi asc = worst ROI first, held (null) still last',
    order(mixed, 'roi', 'asc').join(','), 'soldLo,listB,listA,soldHi,held');
  assert('held (null roiPct) is last in both directions',
    order(mixed, 'roi', 'desc').pop() === 'held' && order(mixed, 'roi', 'asc').pop() === 'held');
}

// ── pl axis: realized P/L (sold) vs projected ask-buy (listed) ────────────────

console.log('\npl axis (realized for sold, projected ask-buy for listed)');
{
  // soldHi +800 > listA +500 > listB +200 > soldLo -100; held has no P/L -> last.
  assertEq('pl desc mixes realized and projected P/L',
    order(mixed, 'pl', 'desc').join(','), 'soldHi,listA,listB,soldLo,held');
  assertEq('pl asc = biggest loss first, held (null) still last',
    order(mixed, 'pl', 'asc').join(','), 'soldLo,listB,listA,soldHi,held');

  // A listed row prices its P/L off the live ask, not a realized net it lacks.
  const listBig = row('listBig', { status: 'listed', buyPrice: 1000, listPrice: 5000, buyTimestamp: NOW });
  assertEq('listed ask-buy can outrank a sold realized P/L',
    order([soldHi, listBig], 'pl', 'desc').join(','), 'listBig,soldHi');
}

// ── null sinking is exhaustive across every axis ──────────────────────────────

console.log('\nnull keys sink to the bottom (all axes)');
{
  const heldOnly = [
    row('h1', { status: 'held', buyPrice: 1000, buyTimestamp: NOW - 1 * DAY }),
    row('h2', { status: 'held', buyPrice: 1000, buyTimestamp: NOW - 2 * DAY }),
  ];
  // Held rows have null roiPct and null P/L -> roi/pl keep input order.
  assertEq('roi: all-null keeps input order (stable)',
    order(heldOnly, 'roi', 'desc').join(','), 'h1,h2');
  assertEq('pl: all-null keeps input order (stable)',
    order(heldOnly, 'pl', 'desc').join(','), 'h1,h2');

  // held carries a real buy stamp but null roiPct/PL: it sinks ONLY on the roi
  // and pl axes, while date/age still order it by its (valid) stamp/age.
  assertEq('roi: null-ROI held sinks below a live listed row',
    order([held, listA], 'roi', 'desc').join(','), 'listA,held');
  assertEq('pl: null-PL held sinks below a live listed row',
    order([held, listA], 'pl', 'desc').join(','), 'listA,held');
  assertEq('date desc: held keeps stamp order (older than listA)',
    order([held, listA], 'date', 'desc').join(','), 'listA,held');
  assertEq('age desc: held is older live capital than listA -> first',
    order([held, listA], 'age', 'desc').join(','), 'held,listA');
}

// ── stable / deterministic ties (both directions) ─────────────────────────────

console.log('\nstable ties (equal keys keep input order)');
{
  // Two listed rows with the SAME projected ROI and P/L and buy stamp.
  const t1 = row('t1', { status: 'listed', buyPrice: 1000, listPrice: 1500, buyTimestamp: NOW });
  const t2 = row('t2', { status: 'listed', buyPrice: 1000, listPrice: 1500, buyTimestamp: NOW });
  const t3 = row('t3', { status: 'listed', buyPrice: 1000, listPrice: 1500, buyTimestamp: NOW });
  const tied = [t1, t2, t3];
  for (const axis of ['date', 'age', 'roi', 'pl']) {
    for (const dir of ['desc', 'asc']) {
      assertEq(`${axis} ${dir}: equal keys preserve input order`,
        order(tied, axis, dir).join(','), 't1,t2,t3');
      // Comparator returns exactly 0 for a true tie (relied on for stability).
      assertEq(`${axis} ${dir}: comparator returns 0 on a tie`,
        ledgerComparator(axis, dir)(t1, t2), 0);
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
