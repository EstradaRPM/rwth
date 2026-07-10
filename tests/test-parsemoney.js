// node test-parsemoney.js
// #21/3 — binding test for parseMoney: the numeric-input parser now accepts
// Torn's k/m/b shorthand (1.5m → 1_500_000, 3.67b → 3_670_000_000) on top of the
// existing $/comma/whitespace stripping, while leaving already-numeric callers
// (the sell-log parser) unaffected. Loads the shipped .user.js directly (ADR-0002
// seam) so the real code is exercised.

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

const { parseMoney } = globalThis.__RwthPure;

let passed = 0;
let failed = 0;

function eq(label, a, b) {
  if (a === b) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}  (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`); failed++; }
}

// ── shorthand suffixes ─────────────────────────────────────────────────────────

console.log('\nk/m/b shorthand');
eq("'900k' -> 900_000", parseMoney('900k'), 900_000);
eq("'1.5m' -> 1_500_000", parseMoney('1.5m'), 1_500_000);
eq("'3.67b' -> 3_670_000_000", parseMoney('3.67b'), 3_670_000_000);
eq("'167.3m' -> 167_300_000", parseMoney('167.3m'), 167_300_000);
eq("'2b' -> 2_000_000_000", parseMoney('2b'), 2_000_000_000);
eq("'.5m' -> 500_000", parseMoney('.5m'), 500_000);

console.log('\ncase-insensitive suffixes');
eq("'1.5M' -> 1_500_000", parseMoney('1.5M'), 1_500_000);
eq("'3.67B' -> 3_670_000_000", parseMoney('3.67B'), 3_670_000_000);
eq("'900K' -> 900_000", parseMoney('900K'), 900_000);

// ── $/comma/whitespace stripping still works (with and without suffix) ─────────

console.log('\ndecoration stripping');
eq("'$1.5m' -> 1_500_000", parseMoney('$1.5m'), 1_500_000);
eq("'$1,500,000' -> 1_500_000", parseMoney('$1,500,000'), 1_500_000);
eq("' 175000000 ' -> 175000000", parseMoney(' 175000000 '), 175_000_000);
eq("'$175m' (compact display round-trips)", parseMoney('$175m'), 175_000_000);

// ── bare numbers unchanged (sell-log callers unaffected) ───────────────────────

console.log('\nbare numbers (already-numeric callers)');
eq("'175000000' -> 175000000", parseMoney('175000000'), 175_000_000);
eq('number 1450 -> 1450', parseMoney(1450), 1450);
eq("'0' -> 0", parseMoney('0'), 0);
eq("'-500' -> -500", parseMoney('-500'), -500);
eq("'1234.56' -> 1234.56", parseMoney('1234.56'), 1234.56);

// ── rejects / sentinels ────────────────────────────────────────────────────────

console.log('\nnon-numeric -> null');
eq("'abc' -> null", parseMoney('abc'), null);
eq("'1.5x' (unknown suffix) -> null", parseMoney('1.5x'), null);
eq("'1.5.5m' (bad number) -> null", parseMoney('1.5.5m'), null);
eq("'m' (suffix only) -> null", parseMoney('m'), null);
eq('null -> null', parseMoney(null), null);
eq('undefined -> null', parseMoney(undefined), null);
eq("'' -> 0 (unchanged legacy behavior)", parseMoney(''), 0);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
