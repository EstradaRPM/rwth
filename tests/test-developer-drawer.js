// node test-developer-drawer.js
// Settings UX S5 (PRD §3.2 decision 5) — the Developer drawer: the weav3r smoke
// test + the full data wipe live in a section that ships FOLDED, the weav3r test
// reports its outcome on an inline status span, and the wipe is gated behind a
// typed confirm and relabeled to its real intent. These bind the shipped code
// (ADR-0002): a Node shim stubs browser globals, then requires the real .user.js.

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

globalThis.__RWTH_TEST__ = true;            // tells the IIFE to skip DOM bootstrap
globalThis.localStorage = makeMockStorage();
globalThis.document = {};                   // stub; bootstrap is skipped, so unused

require('../TORN-RW-trading-hub.src.user.js');

const { buildDeveloperDrawer, isWipeConfirmed, buildSettingsTab } = globalThis.__RwthPure;

test('S5 seam: buildDeveloperDrawer + isWipeConfirmed are exported on __RwthPure', () => {
  assert.strictEqual(typeof buildDeveloperDrawer, 'function');
  assert.strictEqual(typeof isWipeConfirmed, 'function');
});

test('S5: the Developer drawer ships FOLDED by default (seeded MEM.ui.collapsed)', () => {
  // No `ui` passed → buildSettingsTab falls back to the seeded MEM.ui, whose
  // collapsed.setDeveloper is true, so the drawer renders folded (no body).
  const html = buildSettingsTab({ settings: {}, intel: {} });
  // The header exists and carries the fold caret in the collapsed (▸) state.
  assert.match(html, /data-collapse="setDeveloper"/);
  assert.match(html, /<span class="rwth-form-title">Developer<\/span>/);
  assert.match(html, /data-collapse="setDeveloper">[\s\S]*?▸/);
  // Folded → the body (status span + buttons) is not rendered.
  assert.doesNotMatch(html, /rwth-weav3r-test-status/);
  assert.doesNotMatch(html, /data-action="clear-data"/);
});

test('S5: buildDeveloperDrawer stays folded for the seeded collapsed:true ui', () => {
  const html = buildDeveloperDrawer({ collapsed: { setDeveloper: true } });
  assert.match(html, /▸/);                       // collapsed caret
  assert.doesNotMatch(html, /rwth-settings-section-body/);
  assert.doesNotMatch(html, /data-action="smoke-weav3r"/);
});

test('S5: expanded, the weav3r test renders an INLINE STATUS span (not console-only)', () => {
  const html = buildDeveloperDrawer({ collapsed: { setDeveloper: false } });
  assert.match(html, /data-action="smoke-weav3r"/);
  // Reuses the rwth-key-test-status pattern with a stable id the impure layer writes.
  assert.match(html, /id="rwth-weav3r-test-status"[^>]*class="rwth-key-test-status"/);
  assert.match(html, /aria-live="polite"/);
});

test('S5: the wipe button is relabeled to its real intent; "(testing)" is dropped', () => {
  const html = buildDeveloperDrawer({ collapsed: { setDeveloper: false } });
  assert.match(html, /data-action="clear-data"/);
  assert.match(html, /rwth-btn-danger/);                     // danger styling kept
  assert.match(html, /Reset hub — wipe all stored data/);
  assert.doesNotMatch(html, /\(testing\)/);
  assert.doesNotMatch(html, /Clear all data/);
});

test('S5: isWipeConfirmed authorizes the wipe only for the exact typed word', () => {
  assert.strictEqual(isWipeConfirmed('RESET'), true);
  assert.strictEqual(isWipeConfirmed('reset'), true);        // case-insensitive
  assert.strictEqual(isWipeConfirmed('  Reset  '), true);    // whitespace-tolerant
});

test('S5: isWipeConfirmed rejects a cancelled/empty/wrong confirm (gate before clearAllData)', () => {
  assert.strictEqual(isWipeConfirmed(null), false);          // prompt cancelled
  assert.strictEqual(isWipeConfirmed(''), false);
  assert.strictEqual(isWipeConfirmed('yes'), false);
  assert.strictEqual(isWipeConfirmed('RESE'), false);
  assert.strictEqual(isWipeConfirmed('reset now'), false);
});
