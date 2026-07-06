// node test-askcell.js
// #21/1 — binding test for askCellV, the inline ASK cell. A listed row must
// render its ask as a COMPACT bare unit (175m — #28/D5 drops the repeated `$`
// so BUY/ASK/NET align on one unit) at rest so a 9-digit price never clips
// the fixed 58px track, while carrying the RAW digits on data-raw so the render
// layer can swap them in on focus for exact editing. Loads the shipped .user.js
// directly (ADR-0002 seam) so the real code is exercised.

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

require('../TORN-RW-trading-hub.user.js');

const { askCellV, RowModel } = globalThis.__RwthPure;

let passed = 0;
let failed = 0;

function assert(label, condition) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}`); failed++; }
}

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

// ── listed: compact display at rest, raw digits on data-raw ────────────────────

console.log('\nlisted ask cell');
{
  const m = RowModel.forItem(
    { status: 'listed', buyPrice: 100_000_000, listPrice: 175_000_000, buyTimestamp: NOW - DAY },
    NOW);
  const html = askCellV(m, 'x1');
  assert('is an ask-edit input', /data-ask-edit/.test(html));
  assert('display value is compact bare unit (175m, no $)', /value="175m"/.test(html));
  assert('no repeated $ prefix in the ask display', !/value="\$/.test(html));
  assert('raw digits ride on data-raw', /data-raw="175000000"/.test(html));
  assert('does NOT show raw digits in the visible value', !/value="175000000"/.test(html));
}

// A high 9-digit ask that would clip: still compact at rest.
console.log('\nhigh ask never clips at rest');
{
  const m = RowModel.forItem(
    { status: 'listed', buyPrice: 500_000_000, listPrice: 999_000_000, buyTimestamp: NOW - DAY },
    NOW);
  const html = askCellV(m, 'x2');
  assert('compact display (999m)', /value="999m"/.test(html));
  assert('raw on data-raw', /data-raw="999000000"/.test(html));
}

// ── listed with no list price yet: empty display and empty raw ─────────────────

console.log('\nlisted, ask not set');
{
  const m = RowModel.forItem(
    { status: 'listed', buyPrice: 100_000_000, listPrice: null, buyTimestamp: NOW - DAY },
    NOW);
  const html = askCellV(m, 'x3');
  assert('empty display value', /value=""/.test(html));
  assert('empty data-raw', /data-raw=""/.test(html));
}

// ── held: one-click list button, unchanged ─────────────────────────────────────

console.log('\nheld ask cell (list button)');
{
  const m = RowModel.forItem({ status: 'held', buyPrice: 100, buyTimestamp: NOW - DAY }, NOW);
  const html = askCellV(m, 'x4');
  assert('renders the mark-listed button', /data-action="mark-listed"/.test(html));
  assert('not an input', !/data-ask-edit/.test(html));
}

// ── sold: plain compact value, not editable ────────────────────────────────────

console.log('\nsold ask cell (plain)');
{
  const m = RowModel.forItem(
    { status: 'sold', buyPrice: 100_000_000, listPrice: 175_000_000, saleNet: 170_000_000,
      buyTimestamp: NOW - 5 * DAY, soldTimestamp: NOW },
    NOW);
  const html = askCellV(m, 'x5');
  assert('compact value (175m, no $)', /175m/.test(html) && !/\$175m/.test(html));
  assert('not an editable input', !/data-ask-edit/.test(html));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
