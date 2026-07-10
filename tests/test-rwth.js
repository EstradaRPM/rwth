// node test-rwth.js
// RW Trading Hub test suite (ADR-0002): a Node shim stubs browser globals,
// then requires the shipped .user.js directly so tests exercise real code.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SCRIPT_PATH = path.join(__dirname, '..', 'TORN-RW-trading-hub.user.js');
const SCRIPT_SOURCE = fs.readFileSync(SCRIPT_PATH, 'utf8');

// ── Browser-global shim ──────────────────────────────────────────────────────
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

require('../TORN-RW-trading-hub.user.js');

class FakeEl {
  constructor(tagName, classNames = [], children = []) {
    this.nodeType = 1;
    this.tagName = String(tagName || 'div').toUpperCase();
    this.classList = new Set(classNames);
    this.parentElement = null;
    this.children = [];
    for (const child of children) this.appendChild(child);
  }
  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  matches(selector) {
    if (!selector || selector[0] !== '.') return false;
    return this.classList.has(selector.slice(1));
  }
  closest(selector) {
    if (selector !== 'li') return null;
    let node = this;
    while (node) {
      if (node.tagName === 'LI') return node;
      node = node.parentElement;
    }
    return null;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  querySelectorAll(selector) {
    const selectors = String(selector).split(',').map(s => s.trim()).filter(Boolean);
    const out = [];
    const visit = (node) => {
      for (const child of node.children || []) {
        if (selectors.some(sel => child.matches(sel))) out.push(child);
        visit(child);
      }
    };
    visit(this);
    return out;
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────
test('__RwthPure seam exists', () => {
  assert.strictEqual(typeof globalThis.__RwthPure, 'object');
  assert.notStrictEqual(globalThis.__RwthPure, null);
});

test('build* tab functions are exposed and return strings', () => {
  const P = globalThis.__RwthPure;
  for (const fn of ['buildLedgerTab', 'buildAdvertiseTab', 'buildSettingsTab']) {
    assert.strictEqual(typeof P[fn], 'function', `${fn} should be exposed`);
    assert.strictEqual(typeof P[fn](), 'string', `${fn}() should return a string`);
  }
});

test('buildContent dispatches on activeTab', () => {
  const { buildContent } = globalThis.__RwthPure;
  assert.match(buildContent({ ui: { activeTab: 'ledger' } }), /rwth-ledger/);
  assert.match(buildContent({ ui: { activeTab: 'advertise' } }), /rwth-advertise/);
  assert.match(buildContent({ ui: { activeTab: 'settings' } }), /data-setting/);
  assert.strictEqual(buildContent({ ui: { activeTab: 'bogus' } }), '');
});

test('auction mutation candidates dedupe the changed auction row', () => {
  const { auctionCandidateRowsFromMutations } = globalThis.__RwthPure;
  const row = new FakeEl('li', [], [
    new FakeEl('div', ['item-cont-wrap']),
    new FakeEl('div', ['show-item-info']),
  ]);
  const outer = new FakeEl('div', [], [row]);

  const rows = auctionCandidateRowsFromMutations([
    { target: row.children[1], addedNodes: [outer, row.children[0]] },
  ]);

  assert.deepStrictEqual(rows, [row]);
});

test('auction mutation candidates ignore unrelated DOM changes', () => {
  const { auctionCandidateRowsFromMutations } = globalThis.__RwthPure;
  const chatLine = new FakeEl('div', ['chat-line'], [
    new FakeEl('span', ['message']),
  ]);

  assert.deepStrictEqual(
    auctionCandidateRowsFromMutations([{ target: chatLine, addedNodes: chatLine.children }]),
    [],
  );
});

test('AuctionScanner sweep does not walk every li on the page', () => {
  assert.doesNotMatch(
    SCRIPT_SOURCE,
    /document\.querySelectorAll\(\s*['"]li['"]\s*\)/,
  );
});

// #324 — the content-bearing link and picture fields moved into the Advertise
// tab; Settings keeps account (playerId/apiKey) + reach (viewCounterUrl).
test('buildSettingsTab renders the account and reach fields', () => {
  const { buildSettingsTab } = globalThis.__RwthPure;
  const html = buildSettingsTab({ settings: {} });
  for (const key of ['playerId', 'viewCounterUrl', 'apiKey']) {
    assert.match(html, new RegExp(`data-setting="${key}"`), `${key} field should render`);
  }
  for (const gone of ['forumThreadUrl', 'weav3rPricelistUrl', 'forumHeaderImageUrl']) {
    assert.doesNotMatch(html, new RegExp(`data-setting="${gone}"`),
                        `${gone} should no longer live in Settings`);
  }
});

test('buildSettingsTab pre-fills current values', () => {
  const { buildSettingsTab } = globalThis.__RwthPure;
  const html = buildSettingsTab({ settings: { playerId: '987654', apiKey: '###PDA-APIKEY###' } });
  assert.match(html, /value="987654"/);
  assert.match(html, /value="###PDA-APIKEY###"/);
});

test('buildSettingsTab escapes values into the value attribute', () => {
  const { buildSettingsTab } = globalThis.__RwthPure;
  const html = buildSettingsTab({ settings: { viewCounterUrl: 'a"<b&c' } });
  assert.match(html, /value="a&quot;&lt;b&amp;c"/);
});

test('buildSettingsTab tolerates a missing settings object', () => {
  const { buildSettingsTab } = globalThis.__RwthPure;
  assert.strictEqual(typeof buildSettingsTab({}), 'string');
  assert.strictEqual(typeof buildSettingsTab(), 'string');
});

test('buildSettingsTab auto-saves: no Save button', () => {
  const { buildSettingsTab } = globalThis.__RwthPure;
  // Fields persist on blur/Enter (persistSettingField), so the tab no longer
  // renders a manual Save button to scroll down to.
  assert.doesNotMatch(buildSettingsTab({ settings: {} }), /data-action="save-settings"/);
});

test('buildSettingsTab masks the API key as a password field', () => {
  const { buildSettingsTab } = globalThis.__RwthPure;
  const html = buildSettingsTab({ settings: {} });
  assert.match(html, /type="password" data-setting="apiKey"/);
});

// ── Ledger (slice 3) ─────────────────────────────────────────────────────────
const heldItem = {
  id: 'a1', itemName: 'Diamond Bladed Knife', type: 'weapon',
  bonuses: [{ name: 'Fury', value: 25 }], quality: 80,
  buyPrice: 600000, buyTimestamp: Date.UTC(2026, 4, 1), buySource: 'market',
  status: 'held', saleNet: null,
};
const soldItem = {
  ...heldItem, id: 'b2', status: 'sold', buyPrice: 600000, saleNet: 900000,
};

test('ROI.compute returns saleNet - buyPrice for a sold item', () => {
  const { ROI } = globalThis.__RwthPure;
  assert.strictEqual(ROI.compute(soldItem), 300000);
  assert.strictEqual(ROI.compute({ saleNet: 500, buyPrice: 800 }), -300);
});

test('ROI.compute returns null when the item is not sold', () => {
  const { ROI } = globalThis.__RwthPure;
  assert.strictEqual(ROI.compute(heldItem), null);
  assert.strictEqual(ROI.compute(null), null);
});

test('buildLedgerTab renders the ⚙ scan-settings toggle and status filters', () => {
  const { buildLedgerTab } = globalThis.__RwthPure;
  const html = buildLedgerTab({ ledger: { items: [], statusFilter: 'all' } });
  // #19 — the standalone "+ add" button moved into the ⚙ popup; the bar keeps
  // Refresh + the gear toggle.
  assert.match(html, /data-action="toggle-scan-settings"/);
  assert.doesNotMatch(html, /data-action="add-item"/);
  for (const f of ['all', 'held', 'listed', 'sold']) {
    assert.match(html, new RegExp(`data-filter="${f}"`));
  }
});

test('buildLedgerTab exposes the relocated entry points only when the ⚙ popup is open', () => {
  const { buildLedgerTab } = globalThis.__RwthPure;
  const closed = buildLedgerTab({ ledger: { items: [], statusFilter: 'all' } });
  // Popup closed: neither the standalone add nor the paste-sale box render, and
  // the popup dialog itself is absent (the gear toggle still carries its label).
  assert.doesNotMatch(closed, /data-action="add-item"/);
  assert.doesNotMatch(closed, /data-sell-input/);
  assert.doesNotMatch(closed, /data-action="close-scan-settings"/);
  const open = buildLedgerTab({
    ledger: { items: [], statusFilter: 'all' },
    ui: { scanSettingsOpen: true },
  });
  assert.match(open, /role="dialog" aria-label="Scan settings"/);
  assert.match(open, /data-action="add-item"/);
  assert.match(open, /data-scan-source="buys"/);
  assert.match(open, /data-scan-back-to/);
  assert.match(open, /data-sell-input/);
});

test('buildLedgerTab renders a row per item with name, bonus and price', () => {
  const { buildLedgerTab } = globalThis.__RwthPure;
  const html = buildLedgerTab({ ledger: { items: [heldItem], statusFilter: 'all' } });
  assert.match(html, /Diamond Bladed Knife/);
  assert.match(html, /Fury 25%/);
  assert.match(html, /\$600,000/);
  assert.match(html, /data-row-toggle="a1"/);
});

test('rarityDotColor maps each rarity to its palette colour', () => {
  const { rarityDotColor } = globalThis.__RwthPure;
  assert.strictEqual(rarityDotColor('white'), '#d6d6d6');
  assert.strictEqual(rarityDotColor('yellow'), '#ffd93b');
  assert.strictEqual(rarityDotColor('orange'), '#ff9f1c');
  assert.strictEqual(rarityDotColor('red'), '#ff5d5d');
  assert.strictEqual(rarityDotColor(''), '');
  assert.strictEqual(rarityDotColor('bogus'), '');
});

test('ledger row shows a rarity dot, not a worded pill', () => {
  const { buildLedgerTab } = globalThis.__RwthPure;
  const yellowItem = { ...heldItem, id: 'y1', rarity: 'yellow' };
  const html = buildLedgerTab({ ledger: { items: [yellowItem], statusFilter: 'all' } });
  // A dot element with the correct rarity modifier class, before the name span.
  assert.match(html, /class="rwth-rarity-dot rwth-rarity-dot--yellow"/);
  assert.match(html, /rwth-rarity-dot--yellow[^>]*><\/span><span class="rwth-row-name"/);
  // No worded rarity text anywhere in the markup.
  assert.doesNotMatch(html, /YELLOW|ORANGE|RED|WHITE/);
  assert.doesNotMatch(html, />yellow</);
});

test('buildLedgerTab status filter narrows the visible rows', () => {
  const { buildLedgerTab } = globalThis.__RwthPure;
  const html = buildLedgerTab({ ledger: { items: [heldItem, soldItem], statusFilter: 'sold' } });
  assert.doesNotMatch(html, /data-row-toggle="a1"/);
  assert.match(html, /data-row-toggle="b2"/);
});

test('buildLedgerTab keeps status filters separate from ledger actions', () => {
  const { buildLedgerTab } = globalThis.__RwthPure;
  const listed = { ...heldItem, id: 'c3', status: 'listed', listPrice: 118000000 };
  const html = buildLedgerTab({
    ledger: { items: [heldItem, listed, soldItem], statusFilter: 'all' },
    ui: { sort: 'roi' },
  });

  assert.match(html, /class="rwth-ledger-status"/);
  assert.match(html, /aria-label="Ledger status filters"/);
  assert.match(html, /data-filter="all" aria-pressed="true"/);
  assert.match(html, /<span class="rwth-filter-count">\(3\)<\/span><\/span><\/button>/);
  assert.match(html, /data-sort-select aria-label="sort ledger by"/);
  assert.match(html, /data-action="toggle-sort-dir"/);
  assert.match(html, /data-action="refresh"/);
  assert.match(html, /data-action="toggle-scan-settings"/);
});

// D4 (#27) — the standalone .rwth-filter-summary band is gone; each status
// value now folds into its own chip as a subtitle via chipMeta value/suffix.
test('buildLedgerTab folds status money into chip subtitles, drops the summary band', () => {
  const { buildLedgerTab } = globalThis.__RwthPure;
  const listed = { ...heldItem, id: 'c3', status: 'listed', listPrice: 118000000 };
  const html = buildLedgerTab({
    ledger: { items: [heldItem, listed, soldItem], statusFilter: 'all' },
    ui: { sort: 'roi' },
  });

  // No standalone summary band anymore.
  assert.doesNotMatch(html, /rwth-filter-summary/);
  // Each chip carries its value as a subtitle.
  assert.match(html, /<span class="rwth-filter-sub">\$600k cost<\/span>/);
  assert.match(html, /<span class="rwth-filter-sub">\$118m at ask<\/span>/);
});

// D4 (#27) — last-scanned text renders inline in the actions row (right of the
// Refresh button), not as its own full-width band.
test('buildLedgerTab renders last-scanned inline in the actions row', () => {
  const { buildLedgerTab } = globalThis.__RwthPure;
  const now = Date.now();
  const lastScan = now - 5 * 60 * 1000;
  const html = buildLedgerTab({ ledger: { items: [], lastScan } });

  // The scan-status span sits inside the actions row, after the Refresh button.
  const actions = html.match(/<div class="rwth-ledger-actions">[\s\S]*?<\/div>/);
  assert.ok(actions, 'actions row present');
  assert.match(actions[0], /data-action="refresh"[\s\S]*<span class="rwth-scan-status">/);
  assert.match(actions[0], /Last scanned/);
  // No standalone full-width scan-status <div> band.
  assert.doesNotMatch(html, /<div class="rwth-scan-status">/);
});

test('buildLedgerDashboard renders solid realized and dashed projected chart lines', () => {
  const { buildLedgerDashboard } = globalThis.__RwthPure;
  const day = 86_400_000;
  const t0 = Date.UTC(2026, 4, 1);
  const html = buildLedgerDashboard([
    {
      ...soldItem, id: 'sold-chart', buyPrice: 1000, saleNet: 1600,
      buyTimestamp: t0, soldTimestamp: t0 + 2 * day,
    },
    {
      ...heldItem, id: 'listed-chart', status: 'listed',
      buyPrice: 1000, listPrice: 1400, buyTimestamp: t0 + day,
    },
  ], t0 + 4 * day);

  assert.match(html, /class="rwth-hero-line rwth-hero-line-realized"/);
  assert.match(html, /class="rwth-hero-line rwth-hero-line-projected"/);
  assert.match(html, /rwth-legend-realized/);
  assert.match(html, /rwth-legend-projected/);
  assert.match(html, /Projected Month P\/L \(realized daily pace\)/);
  assert.match(html, /rwth-hero-axis/);
  assert.match(html, /rwth-hero-axis-tick/);
  assert.doesNotMatch(html, /Projection display/);
  assert.doesNotMatch(html, /data-action="set-projection-period"/);
  assert.doesNotMatch(html, />Win rate</);
});

test('buildLedgerTab demotes Refresh to a ghost/outline control (D2 #29)', () => {
  const { buildLedgerTab } = globalThis.__RwthPure;
  const html = buildLedgerTab({ ledger: { items: [], statusFilter: 'all' } });
  const btn = html.match(/<button[^>]*data-action="refresh"[^>]*>/)[0];
  // Ghost class present; no longer the solid-neon primary.
  assert.match(btn, /rwth-btn-ghost/);
});

test('buildLedgerDashboard promotes P/L to the strip lead, positive when green (D2 #29)', () => {
  const { buildLedgerDashboard } = globalThis.__RwthPure;
  const day = 86_400_000;
  const t0 = Date.UTC(2026, 4, 1);
  const html = buildLedgerDashboard([
    {
      ...soldItem, id: 'sold-lead', buyPrice: 1000, saleNet: 1600,
      buyTimestamp: t0, soldTimestamp: t0 + 2 * day,
    },
  ], t0 + 4 * day);
  const stat = html.match(/<span class="rwth-dash-stat[^"]*"><span class="rwth-dash-k">P\/L<\/span>/)[0];
  assert.match(stat, /rwth-dash-lead/);
  assert.match(stat, /rwth-dash-pos/);
});

test('collapsed dash strip stats are aligned label-over-value cells (narrow-width reflow)', () => {
  const { buildLedgerDashboard } = globalThis.__RwthPure;
  const day = 86_400_000;
  const t0 = Date.UTC(2026, 4, 1);
  const html = buildLedgerDashboard([
    {
      ...soldItem, id: 'sold-cell', buyPrice: 1000, saleNet: 1600,
      buyTimestamp: t0, soldTimestamp: t0 + 2 * day,
    },
  ], t0 + 4 * day);
  // Every strip stat is a self-contained cell carrying a label (rwth-dash-k) and
  // a value (rwth-dash-v) so they line up in columns when the strip wraps.
  const cells = html.match(/<span class="rwth-dash-stat[^"]*">[\s\S]*?<\/span><\/span>/g);
  assert.ok(cells && cells.length >= 2, 'strip should render multiple stat cells');
  for (const c of cells) {
    assert.match(c, /<span class="rwth-dash-k">/, 'stat cell carries an aligned label');
    assert.match(c, /<span class="rwth-dash-v">/, 'stat cell carries an aligned value');
  }
  // Container uses a single-row column-flow grid so a 5th stat (mugs) never wraps to
  // a second line; the strip is a query container so cell type scales to its width.
  const start = SCRIPT_SOURCE.indexOf('.rwth-dash-stats {');
  assert.notStrictEqual(start, -1, '.rwth-dash-stats rule should exist');
  const block = SCRIPT_SOURCE.slice(start, SCRIPT_SOURCE.indexOf('}', start));
  assert.match(block, /display:\s*grid/, 'stats container should be a grid');
  assert.match(block, /grid-auto-flow:\s*column/,
    'stats grid should flow into a single row so stats never wrap');
  const stripStart = SCRIPT_SOURCE.indexOf('.rwth-dash-strip {');
  const stripBlock = SCRIPT_SOURCE.slice(stripStart, SCRIPT_SOURCE.indexOf('}', stripStart));
  assert.match(stripBlock, /container-type:\s*inline-size/,
    'strip is a query container so cell type can scale to its width');
});

test('buildLedgerDashboard opens projection popup with safe period controls', () => {
  const { buildLedgerDashboard } = globalThis.__RwthPure;
  const day = 86_400_000;
  const t0 = Date.UTC(2026, 4, 1);
  const rows = [
    {
      ...soldItem, id: 'sold-popup', buyPrice: 1000, saleNet: 1600,
      buyTimestamp: t0, soldTimestamp: t0 + 2 * day,
    },
    {
      ...heldItem, id: 'listed-popup', status: 'listed',
      buyPrice: 1000, listPrice: 1400, buyTimestamp: t0 + day,
    },
  ];
  const before = JSON.stringify(rows);
  const html = buildLedgerDashboard(rows, t0 + 4 * day, true, undefined, {
    projectionPanelOpen: true,
    projectionPeriod: 'week',
  });

  assert.strictEqual(JSON.stringify(rows), before);
  assert.match(html, /data-projection-trigger role="button" tabindex="0"/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /role="dialog" aria-label="Projection controls"/);
  assert.match(html, /Projected Week P\/L \(realized daily pace\)/);
  assert.match(html, /data-action="set-projection-period" data-period="day"/);
  assert.match(html, /data-action="set-projection-period" data-period="week" aria-pressed="true"/);
  assert.match(html, /data-action="set-projection-period" data-period="month"/);
  assert.match(html, /data-action="set-projection-period" data-period="quarter"/);
  assert.match(html, /data-action="set-projection-period" data-period="year"/);
  assert.match(html, /realized daily pace/);
  assert.match(html, /days since your first buy/);
  assert.match(html, /Week projected operating profit/);
  assert.match(html, /Realized P\/L \$600 \(net of mugs\) across 1 sale over 4 days since first buy = \$150\/d/);
});

test('buildLedgerDashboard renders projected-only chart without faking realized line', () => {
  const { buildLedgerDashboard } = globalThis.__RwthPure;
  const html = buildLedgerDashboard([
    { ...heldItem, id: 'listed-only', status: 'listed', buyPrice: 1000, listPrice: 1400 },
  ], Date.UTC(2026, 4, 4));

  assert.match(html, /class="rwth-hero-line rwth-hero-line-projected"/);
  assert.match(html, /rwth-legend-projected/);
  assert.doesNotMatch(html, /rwth-hero-line-realized/);
  assert.doesNotMatch(html, /rwth-hero-area/);
});

test('buildLedgerDashboard empty state emits no fake chart paths', () => {
  const { buildLedgerDashboard } = globalThis.__RwthPure;
  const html = buildLedgerDashboard([], Date.UTC(2026, 4, 4));

  assert.match(html, /No realized or projected profit yet/);
  assert.doesNotMatch(html, /rwth-hero-svg/);
  assert.doesNotMatch(html, /rwth-hero-line-realized/);
  assert.doesNotMatch(html, /rwth-hero-line-projected/);
});

test('buildLedgerTab shows ROI in a sold row collapsed line', () => {
  const { buildLedgerTab } = globalThis.__RwthPure;
  const html = buildLedgerTab({ ledger: { items: [soldItem], statusFilter: 'all' } });
  assert.match(html, /\+\$300,000/);
});

test('#28/D5 — BUY/ASK/ROI align under the shared column track', () => {
  const { buildLedgerTab } = globalThis.__RwthPure;
  const listed = { ...heldItem, id: 'd5', status: 'listed',
    buyPrice: 100000000, listPrice: 175000000 };
  const html = buildLedgerTab({ ledger: { items: [listed], statusFilter: 'listed' } });
  // Header labels present, and header + row share the same rwth-cols-* grid track
  // so the three figure columns line up down the tab.
  assert.match(html, /class="rwth-thead rwth-cols-listed"/);
  assert.match(html, /class="rwth-row-head rwth-cols-listed"/);
  assert.match(html, /<span class="rwth-th">buy<\/span>/);
  assert.match(html, /<span class="rwth-th">ask<\/span>/);
  assert.match(html, /<span class="rwth-th">roi<\/span>/);
  // BUY renders as compact money ($100m); ASK's inline input carries the same $-form.
  assert.match(html, /class="rwth-cell-v">\$100m<\/span>/);
  assert.match(html, /value="\$175m"/);
});

test('sold tab: net→"sold" proceeds column plus a true P/L column', () => {
  const { buildLedgerTab } = globalThis.__RwthPure;
  // buy 600k, saleNet 900k → proceeds "900k", P/L +300k (win → pos).
  const html = buildLedgerTab({ ledger: { items: [soldItem], statusFilter: 'sold' } });
  // Header + row share the sold grid track and name the new columns.
  assert.match(html, /class="rwth-thead rwth-cols-sold"/);
  assert.match(html, /class="rwth-row-head rwth-cols-sold"/);
  assert.match(html, /<span class="rwth-th">sold<\/span>/);
  assert.match(html, /<span class="rwth-th">P\/L<\/span>/);
  // The old NET header label is gone.
  assert.doesNotMatch(html, /<span class="rwth-th">net<\/span>/);
  // Proceeds cell shows saleNet as compact money; P/L cell shows the signed
  // profit coloured with the ROI win token.
  assert.match(html, /class="rwth-cell-v">\$900k<\/span>/);
  assert.match(html, /class="rwth-cell-v rwth-roi-pos">\+\$300k<\/span>/);
});

test('sold tab: P/L cell goes red and signed on a realized loss', () => {
  const { buildLedgerTab } = globalThis.__RwthPure;
  const loss = { ...soldItem, id: 'loss', buyPrice: 600000, saleNet: 400000 };
  const html = buildLedgerTab({ ledger: { items: [loss], statusFilter: 'sold' } });
  assert.match(html, /class="rwth-cell-v">\$400k<\/span>/);           // proceeds
  assert.match(html, /class="rwth-cell-v rwth-roi-neg">-\$200k<\/span>/); // P/L loss
});

test('sold tab: null saleNet dims both the sold and P/L cells', () => {
  const { buildLedgerTab } = globalThis.__RwthPure;
  const noNet = { ...soldItem, id: 'nonet', buyPrice: 600000, saleNet: null };
  const html = buildLedgerTab({ ledger: { items: [noNet], statusFilter: 'sold' } });
  // Two em-dash cells (sold + P/L) render as dimmed empty legs; no P/L colour
  // leaks into the row's figure cells.
  const rowHead = html.match(/<div class="rwth-row-head rwth-cols-sold"[\s\S]*?<\/div>/)[0];
  const empties = rowHead.match(/class="rwth-cell-v rwth-cell-empty">—<\/span>/g) || [];
  assert.ok(empties.length >= 2, 'both sold and P/L render the dimmed em-dash');
  assert.doesNotMatch(rowHead, /rwth-roi-pos|rwth-roi-neg/);
});

test('sold tab: .rwth-cols-sold declares one grid track per cell (name + 5 figures)', () => {
  // name + buy + sold + P/L + roi + to-sell = 6 explicit tracks, else the last
  // cell falls into an implicit auto track and the figures drift out of column.
  const m = SCRIPT_SOURCE.match(/\.rwth-cols-sold\s*\{\s*grid-template-columns:([^;}]*)/);
  assert.ok(m, 'rwth-cols-sold grid-template-columns declared');
  const trackCount = m[1].trim().split(/\s+(?![^(]*\))/).length;
  assert.strictEqual(trackCount, 6, 'sold grid must have 6 tracks');
});

test('held tab: header + rows share the rwth-cols-held track, and the track has one column per cell', () => {
  const { buildLedgerTab } = globalThis.__RwthPure;
  const held = { ...heldItem, id: 'hgrid', status: 'held', buyPrice: 100000000 };
  const html = buildLedgerTab({ ledger: { items: [held], statusFilter: 'held' } });
  // Header + row carry the same grid-track class so figures align down the tab.
  assert.match(html, /class="rwth-thead rwth-cols-held"/);
  assert.match(html, /class="rwth-row-head rwth-cols-held"/);
  // Held renders 4 grid cells (name + buy + ask/"list" + age); the CSS track must
  // declare 4 columns, else the 4th cell falls into an implicit auto track and the
  // figures drift out of column. Assert one explicit track per cell.
  const m = SCRIPT_SOURCE.match(/\.rwth-cols-held\s*\{\s*grid-template-columns:([^;}]*)/);
  assert.ok(m, 'rwth-cols-held grid-template-columns declared');
  const trackCount = m[1].trim().split(/\s+(?![^(]*\))/).length;
  assert.strictEqual(trackCount, 4,
    'held grid must have 4 tracks (name + buy + list + age)');
});

test('#28/D5 — .rwth-th header labels lift off the muted tone for contrast', () => {
  // The header is now the only label line; its colour must be the brighter body
  // token, not the near-invisible muted one it carried before.
  assert.match(SCRIPT_SOURCE,
    /\.rwth-th \{[^}]*color: var\(--rwth-text\)/);
});

test('buildLedgerTab expanded row exposes mark-listed / edit / delete actions', () => {
  const { buildLedgerTab } = globalThis.__RwthPure;
  const html = buildLedgerTab({ ledger: { items: [heldItem], statusFilter: 'all', expandedId: 'a1' } });
  assert.match(html, /data-action="mark-listed" data-id="a1"/);
  assert.match(html, /data-action="edit-item" data-id="a1"/);
  assert.match(html, /data-action="delete-item" data-id="a1"/);
});

test('buildLedgerTab renders the add form when editingId is set', () => {
  const { buildLedgerTab } = globalThis.__RwthPure;
  const html = buildLedgerTab({ ledger: { items: [], statusFilter: 'all', editingId: 'new' } });
  assert.match(html, /data-form="itemName"/);
  assert.match(html, /data-form="buySource"/);
  assert.match(html, /data-action="save-item"/);
});

// ── Auction-win scan (slice 4) ───────────────────────────────────────────────
// An auction-win log entry from /v2/user/log?log=4320 (log is an array;
// each entry carries its own id).
const logEntry = {
  id: 'YqMfrL3c7OjpBSkPo8cO',
  timestamp: 1779372185,
  details: { id: 4320, title: 'Auction house item win', category: 'Auctions' },
  data: {
    owner: 3727993,
    item: [{ id: 614, uid: 19121539308, qty: 1 }],
    final_price: 200000001,
    listing_id: 521625,
  },
};

test('parseAuctionWin reads item id and final price from a log entry', () => {
  const { parseAuctionWin } = globalThis.__RwthPure;
  const p = parseAuctionWin(logEntry, { 614: 'Diamond Bladed Knife' });
  assert.strictEqual(p.itemId, 614);
  assert.strictEqual(p.itemName, 'Diamond Bladed Knife');
  assert.strictEqual(p.buyPrice, 200000001);
});

test('parseAuctionWin falls back to "Item #id" with no name map', () => {
  const { parseAuctionWin } = globalThis.__RwthPure;
  assert.strictEqual(parseAuctionWin(logEntry).itemName, 'Item #614');
  assert.strictEqual(parseAuctionWin({}).itemId, null);
  assert.strictEqual(parseAuctionWin({}).buyPrice, 0);
});

test('toScanHits maps the API log array and skips seen entry ids', () => {
  const { toScanHits } = globalThis.__RwthPure;
  const log = [
    logEntry,
    { id: 'EAS', timestamp: 1779368765, data: { item: [{ id: 24 }], final_price: 180000001 } },
  ];
  const hits = toScanHits(log, ['YqMfrL3c7OjpBSkPo8cO'], { 24: 'Pocket Knife' });
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].key, 'EAS');
  assert.strictEqual(hits[0].itemId, 24);
  assert.strictEqual(hits[0].itemName, 'Pocket Knife');
  assert.strictEqual(hits[0].buyPrice, 180000001);
  assert.strictEqual(hits[0].buyTimestamp, 1779368765 * 1000);
});

test('scanHitIsRwTradeable keeps colour rarities and drops everything else', () => {
  const { scanHitIsRwTradeable } = globalThis.__RwthPure;
  // Colour rarity → RW-tradeable, keep.
  for (const r of ['yellow', 'orange', 'red', 'Red']) {
    assert.strictEqual(scanHitIsRwTradeable({ rarity: r }, true), true, `keep ${r}`);
  }
  // Anything else → drop: standard/consumable (Minigun, Ipecac) or no rarity.
  assert.strictEqual(scanHitIsRwTradeable({ rarity: null }), false);
  assert.strictEqual(scanHitIsRwTradeable({ rarity: '' }), false);
  assert.strictEqual(scanHitIsRwTradeable({ rarity: 'white' }), false);
  assert.strictEqual(scanHitIsRwTradeable({}), false);
});

test('toScanHits preserves dictionary categories for scanned wins', () => {
  const { toScanHits } = globalThis.__RwthPure;
  const hits = toScanHits([
    { id: 'secondary', timestamp: 1779368765, data: { item: [{ id: 219 }], final_price: 180000001 } },
  ], [], { 219: 'Taurus' }, { taurus: 'Secondary' });
  assert.strictEqual(hits[0].category, 'Secondary');
  assert.strictEqual(hits[0].type, 'weapon');
});

test('item dictionary category builder reads Torn weapon subtype fields', () => {
  const { itemDictCategoryRecord } = globalThis.__RwthPure;
  assert.strictEqual(itemDictCategoryRecord({
    name: 'Sawed-Off Shotgun',
    type: 'Weapon',
    weapon_type: 'Primary Weapon',
  }), 'Primary');
  assert.strictEqual(itemDictCategoryRecord({
    name: 'Benelli M4 Super',
    type: 'Weapon',
    sub_type: 'Secondary Weapon',
  }), 'Secondary');
  assert.strictEqual(itemDictCategoryRecord({
    name: 'Riot Body',
    type: 'Defensive',
  }), 'Armor');
});

test('item dictionary cache guard rejects old or empty category indexes', () => {
  const { itemDictCacheUsable } = globalThis.__RwthPure;
  assert.strictEqual(itemDictCacheUsable({
    ts: Date.now(),
    map: { 1: 'Benelli M4 Super' },
    cats: { 'benelli m4 super': 'Secondary' },
  }), false);
  assert.strictEqual(itemDictCacheUsable({
    schema: 3,
    ts: Date.now(),
    map: { 1: 'Benelli M4 Super' },
    cats: {},
  }), false);
  assert.strictEqual(itemDictCacheUsable({
    schema: 3,
    ts: Date.now(),
    map: { 1: 'Benelli M4 Super' },
    cats: { 'benelli m4 super': 'Secondary' },
  }), true);
});

test('toScanHits sorts newest first', () => {
  const { toScanHits } = globalThis.__RwthPure;
  const hits = toScanHits([
    { id: 'old', timestamp: 100, data: { item: [{ id: 1 }] } },
    { id: 'new', timestamp: 900, data: { item: [{ id: 2 }] } },
  ], [], {});
  assert.deepStrictEqual(hits.map(h => h.key), ['new', 'old']);
});

test('buildScanChecklist renders a checklist when scan results exist', () => {
  const { buildScanChecklist } = globalThis.__RwthPure;
  const html = buildScanChecklist({ ledger: { scanResults: [
    { key: 'e2', itemName: 'Sword', bonusName: null, buyPrice: 200, buyTimestamp: 2e9 },
  ] } });
  assert.match(html, /data-scan-row="e2"/);
  assert.match(html, /data-scan-check/);
  assert.match(html, /data-scan-field="quality"/);
  assert.match(html, /data-action="confirm-scan"/);
});

test('buildScanChecklist shows unknown scan categories as Other, not Primary', () => {
  const { buildScanChecklist } = globalThis.__RwthPure;
  const html = buildScanChecklist({ ledger: { scanResults: [
    { key: 'unknown', itemName: 'Item #123', buyPrice: 200, buyTimestamp: 2e9 },
  ] } });
  assert.match(html, /<option value="Other" selected>Other<\/option>/);
  assert.doesNotMatch(html, /<option value="Primary" selected>Primary<\/option>/);
});

test('buildScanChecklist renders PDA-readable scan debug summary', () => {
  const { buildScanChecklist } = globalThis.__RwthPure;
  const html = buildScanChecklist({ ledger: {
    scanDebugSummary: [
      'scan v0.3.x buys=1 sales=0 mugs=0 ignored=0 already=0 cats=999',
      'BUY 1: Sawed-Off Shotgun | id=383 | stored=Other | cats=Primary | rendered=Primary',
    ],
  } });
  assert.match(html, /Scan debug summary/);
  assert.match(html, /rwth-scan-debug-box/);
  assert.match(html, /Sawed-Off Shotgun/);
  assert.match(html, /cats=Primary/);
});

test('buildScanChecklist is empty with no results', () => {
  const { buildScanChecklist } = globalThis.__RwthPure;
  assert.strictEqual(buildScanChecklist({ ledger: { scanResults: [] } }), '');
  assert.strictEqual(buildScanChecklist({}), '');
});

test('buildLedgerTab renders the Refresh + ⚙ bar and surfaces fetchError', () => {
  const { buildLedgerTab } = globalThis.__RwthPure;
  const bar = buildLedgerTab({ ledger: { items: [] } });
  assert.match(bar, /data-action="refresh"/);
  assert.match(bar, /data-action="toggle-scan-settings"/);
  assert.doesNotMatch(bar, /data-action="scan"/);
  const err = buildLedgerTab({ ledger: { items: [] }, fetchError: 'API error: x' });
  assert.match(err, /rwth-banner/);
  assert.match(err, /API error: x/);
});

// ── Sell logging (slice 5) ───────────────────────────────────────────────────
test('SellParser.parse reads a bazaar sell line (no fees)', () => {
  const { SellParser } = globalThis.__RwthPure;
  const [s] = SellParser.parse(
    'You sold a Riot Body (Impregnable) on your bazaar to Apocolypse_ ' +
    'at $84,150,000 each for a total of $84,150,000');
  assert.strictEqual(s.itemName, 'Riot Body');
  assert.strictEqual(s.bonusName, 'Impregnable');
  assert.strictEqual(s.venue, 'bazaar');
  assert.strictEqual(s.buyer, 'Apocolypse_');
  assert.strictEqual(s.saleGross, 84150000);
  assert.strictEqual(s.saleNet, 84150000);
  assert.strictEqual(s.saleFees, 0);
  assert.strictEqual(s.anonymous, false);
});

test('SellParser.parse reads an item-market sell line with fees', () => {
  const { SellParser } = globalThis.__RwthPure;
  const [s] = SellParser.parse(
    'You sold a pair of Combat Boots (Pinpoint) on the item market to Buyer123 ' +
    'at $5,000,000 each for a total of $9,500,000 after $500,000 in fees');
  assert.strictEqual(s.itemName, 'Combat Boots');
  assert.strictEqual(s.bonusName, 'Pinpoint');
  assert.strictEqual(s.venue, 'market');
  assert.strictEqual(s.buyer, 'Buyer123');
  assert.strictEqual(s.saleGross, 5000000);
  assert.strictEqual(s.saleNet, 9500000);
  assert.strictEqual(s.saleFees, 500000);
});

test('SellParser.parse handles the optional "anonymously" word', () => {
  const { SellParser } = globalThis.__RwthPure;
  const [s] = SellParser.parse(
    'You sold a Diamond Bladed Knife (Fury) anonymously on the item market ' +
    'at $3,000,000 each for a total of $2,850,000 after $150,000 in fees');
  assert.strictEqual(s.anonymous, true);
  assert.strictEqual(s.itemName, 'Diamond Bladed Knife');
  assert.strictEqual(s.bonusName, 'Fury');
  assert.strictEqual(s.buyer, null);
  assert.strictEqual(s.saleNet, 2850000);
});

test('SellParser.parse handles a sell line with no bonus in parentheses', () => {
  const { SellParser } = globalThis.__RwthPure;
  const [s] = SellParser.parse(
    'You sold a Pocket Knife on your bazaar to Tester at $100 each for a total of $100');
  assert.strictEqual(s.itemName, 'Pocket Knife');
  assert.strictEqual(s.bonusName, null);
});

test('SellParser.parse handles a multi-line block', () => {
  const { SellParser } = globalThis.__RwthPure;
  const sells = SellParser.parse(
    'You sold a Riot Body (Impregnable) on your bazaar to A_ at $1 each for a total of $1\n' +
    'You sold a pair of Combat Boots (Pinpoint) on the item market to B_ at $2 each for a total of $2');
  assert.strictEqual(sells.length, 2);
  assert.strictEqual(sells[0].itemName, 'Riot Body');
  assert.strictEqual(sells[1].itemName, 'Combat Boots');
});

test('SellParser.parse associates an interleaved timestamp with the next sale', () => {
  const { SellParser } = globalThis.__RwthPure;
  const ts = Date.UTC(2026, 4, 20, 12, 0, 0);
  const sells = SellParser.parse(
    '2026-05-20T12:00:00Z\n' +
    'You sold a Riot Body (Impregnable) on your bazaar to A_ at $1 each for a total of $1');
  assert.strictEqual(sells[0].timestamp, ts);
});

test('SellParser.parse leaves timestamp null when none precedes the sale', () => {
  const { SellParser } = globalThis.__RwthPure;
  const [s] = SellParser.parse(
    'You sold a Riot Body (Impregnable) on your bazaar to A_ at $1 each for a total of $1');
  assert.strictEqual(s.timestamp, null);
});

test('SellParser.parse ignores lines that are not sell lines', () => {
  const { SellParser } = globalThis.__RwthPure;
  assert.deepStrictEqual(SellParser.parse('just some random text\nnot a sale'), []);
  assert.deepStrictEqual(SellParser.parse(''), []);
});

const openHeld = {
  id: 'h1', itemName: 'Riot Body', status: 'held',
  bonuses: [{ name: 'Impregnable', value: 10 }], buyPrice: 80000000,
};
const openListed = {
  id: 'l1', itemName: 'Riot Body', status: 'listed',
  bonuses: [{ name: 'Impenetrable', value: 8 }], buyPrice: 70000000,
};

test('buildScanPreview stages a mug as flat cash, not tied to any item', () => {
  const { buildScanPreview, scanEventKey, SCAN_LOG_TYPES } = globalThis.__RwthPure;
  const soldAt = Date.UTC(2026, 4, 20, 12, 0, 0);
  const preview = buildScanPreview([
    {
      type: 'sale',
      eventKey: scanEventKey(SCAN_LOG_TYPES.bazaarSale, 'sale-1'),
      sell: {
        itemName: 'Riot Body',
        uid: 990,
        bonusName: 'Impregnable',
        saleNet: 84150000,
        timestamp: soldAt,
      },
    },
    {
      type: 'mug',
      eventKey: scanEventKey(SCAN_LOG_TYPES.mugged, 'mug-1'),
      mug: {
        amount: 1200000,
        timestamp: soldAt + 2 * 60 * 1000,
      },
    },
  ], {
    // The RW sale names its armoury uid; the held instance carries the same uid.
    items: [{ ...openHeld, uid: 990 }],
    cats: { 'riot body': 'Armor' },
    transactions: [],
  });

  // The sale still matches its open row; the mug rides along independently with
  // no item linkage — it's a flat cash drag the user can uncheck.
  assert.strictEqual(preview.sales[0].matchedId, 'h1');
  assert.strictEqual(preview.mugs.length, 1);
  assert.strictEqual(preview.mugs[0].mug.amount, 1200000);
  assert.strictEqual('matchedId' in preview.mugs[0], false);
  assert.strictEqual(preview.review.length, 0);
});

test('buildScanPreview re-stages a mug absent from the store, skips one already recorded', () => {
  const { buildScanPreview, scanEventKey, SCAN_LOG_TYPES } = globalThis.__RwthPure;
  const t0 = Date.UTC(2026, 4, 20, 12, 0, 0);
  const recordedKey = scanEventKey(SCAN_LOG_TYPES.mugged, 'mug-recorded');
  const freshKey = scanEventKey(SCAN_LOG_TYPES.mugged, 'mug-fresh');
  const preview = buildScanPreview([
    { type: 'mug', eventKey: recordedKey, mug: { amount: 500000, timestamp: t0 } },
    { type: 'mug', eventKey: freshKey, mug: { amount: 900000, timestamp: t0 + 60_000 } },
  ], {
    items: [],
    transactions: [],
    // recordedKey is in the global seen-set (an earlier scan saw it) AND in the
    // mug store; freshKey was seen-then-dropped by the old build (in seen-set,
    // NOT in the store) and must re-stage so it can backfill.
    seen: [recordedKey, freshKey],
    mugs: [{ amount: 500000, eventKeys: [recordedKey] }],
  });

  assert.strictEqual(preview.mugs.length, 1);
  assert.strictEqual(preview.mugs[0].mug.amount, 900000);
  assert.strictEqual(preview.already.length, 1);
});

test('buildScanPreview keeps every scanned mug selectable instead of review-skipping', () => {
  const { buildScanPreview, scanEventKey, SCAN_LOG_TYPES } = globalThis.__RwthPure;
  const t0 = Date.UTC(2026, 4, 20, 12, 0, 0);
  const preview = buildScanPreview([
    {
      type: 'mug',
      eventKey: scanEventKey(SCAN_LOG_TYPES.mugged, 'mug-1'),
      mug: { amount: 1200000, timestamp: t0 },
    },
    {
      type: 'mug',
      eventKey: scanEventKey(SCAN_LOG_TYPES.mugged, 'mug-2'),
      mug: { amount: 3400000, timestamp: t0 + 60_000 },
    },
  ], {
    items: [],
    transactions: [],
  });

  assert.strictEqual(preview.mugs.length, 2);
  assert.strictEqual(preview.mugs.every(row => row.checked === true), true);
  assert.strictEqual(preview.review.length, 0);
});

test('buildScanChecklist renders scanned mugs as checkbox rows', () => {
  const { buildScanChecklist, scanEventKey, SCAN_LOG_TYPES } = globalThis.__RwthPure;
  const html = buildScanChecklist({ ledger: { scanPreview: {
    summary: { mugs: 2 },
    mugs: [
      {
        checked: true,
        eventKeys: [scanEventKey(SCAN_LOG_TYPES.mugged, 'mug-1')],
        matchedId: 'sold-1',
        mug: { amount: 1200000, timestamp: Date.UTC(2026, 4, 20, 12, 0, 0), attacker: 'A' },
      },
      {
        checked: true,
        eventKeys: [scanEventKey(SCAN_LOG_TYPES.mugged, 'mug-2')],
        matchedId: null,
        mug: { amount: 3400000, timestamp: Date.UTC(2026, 4, 20, 12, 1, 0), attacker: 'B' },
      },
    ],
  } } });

  assert.match(html, /data-scan-mug-check/);
  // Mug rows render a plain "Mug" label (the attacker name is no longer shown),
  // the amount, and a matched / no-sale-match tag.
  assert.strictEqual((html.match(/<span>Mug<\/span>/g) || []).length, 2);
  assert.match(html, /\$1,200,000/);
  assert.match(html, /\$3,400,000/);
  assert.match(html, /matched/);
  assert.match(html, /no sale match/);
  assert.doesNotMatch(html, /Needs review/);
  assert.doesNotMatch(html, /skipped/);
});

test('matchSell matches an open row by item name', () => {
  const { matchSell } = globalThis.__RwthPure;
  const sell = { itemName: 'Riot Body', bonusName: null };
  assert.strictEqual(matchSell(sell, [openHeld]).id, 'h1');
});

test('matchSell uses bonus name as a tiebreaker', () => {
  const { matchSell } = globalThis.__RwthPure;
  const sell = { itemName: 'Riot Body', bonusName: 'Impenetrable' };
  assert.strictEqual(matchSell(sell, [openHeld, openListed]).id, 'l1');
});

test('matchSell returns null when nothing matches', () => {
  const { matchSell } = globalThis.__RwthPure;
  assert.strictEqual(matchSell({ itemName: 'Unknown Item' }, [openHeld]), null);
  assert.strictEqual(matchSell({ itemName: 'Riot Body' }, []), null);
});

test('matchSell ignores already-sold rows', () => {
  const { matchSell } = globalThis.__RwthPure;
  const sold = { id: 's1', itemName: 'Riot Body', status: 'sold', bonuses: [] };
  assert.strictEqual(matchSell({ itemName: 'Riot Body' }, [sold]), null);
});

// uid is the unequivocal key: a uid-bearing sale closes its exact instance,
// even when the realized number is a steep (but real) loss.
test('matchSell closes the held row holding the sold uid, even at a big loss', () => {
  const { matchSell } = globalThis.__RwthPure;
  const held = { id: 'h2', itemName: 'Enfield SA-80', status: 'held', uid: '111',
                 buyPrice: 80000000, bonuses: [] };
  assert.strictEqual(
    matchSell({ itemName: 'Enfield SA-80', uid: '111', saleNet: 1000 }, [held]).id, 'h2');
});

// The reported bug: a cheap non-RW sale must NOT close a held RW row — whether
// the sale carries its own uid, a different uid, or none at all (any venue).
test('matchSell never closes a held RW row from a cheap non-RW sale', () => {
  const { matchSell } = globalThis.__RwthPure;
  const rwWithUid = { id: 'r1', itemName: 'Enfield SA-80', status: 'held', uid: '111',
                      rarity: 'orange', bonuses: [], buyPrice: 80000000 };
  const rwNoUid   = { id: 'r2', itemName: 'Enfield SA-80', status: 'held', uid: null,
                      rarity: 'orange', bonuses: [], buyPrice: 80000000 };
  // sale carries a different uid (item market / bazaar with uid)
  assert.strictEqual(matchSell({ itemName: 'Enfield SA-80', uid: '999', saleNet: 250000 }, [rwWithUid]), null);
  // sale carries a uid, held row is uid-less legacy → value guard catches it
  assert.strictEqual(matchSell({ itemName: 'Enfield SA-80', uid: '999', saleNet: 250000 }, [rwNoUid]), null);
  // sale carries NO uid at all (a venue whose log omits it) → value guard catches it
  assert.strictEqual(matchSell({ itemName: 'Enfield SA-80', saleNet: 250000 }, [rwNoUid]), null);
});

// A real sale (plausible proceeds) still auto-closes a uid-less legacy row.
test('matchSell auto-closes a uid-less legacy row when the proceeds are plausible', () => {
  const { matchSell } = globalThis.__RwthPure;
  const legacy = { id: 'g1', itemName: 'Enfield SA-80', status: 'held', uid: null,
                   bonuses: [], buyPrice: 80000000 };
  assert.strictEqual(matchSell({ itemName: 'Enfield SA-80', uid: '111', saleNet: 90000000 }, [legacy]).id, 'g1');
  // a uid-less sale (no uid either side) with plausible value also closes it
  assert.strictEqual(matchSell({ itemName: 'Enfield SA-80', saleNet: 70000000 }, [legacy]).id, 'g1');
});

// Every non-duplicate sale posts to Recent Transactions (matched ones also
// close their ledger row); duplicates are already logged and skipped.
test('summarizeSells counts parsed / matched / duplicate / recent', () => {
  const { summarizeSells } = globalThis.__RwthPure;
  const s = summarizeSells([
    { matchedId: 'a' }, { matchedId: null }, { matchedId: 'c', duplicate: true },
  ]);
  assert.deepStrictEqual(s, { parsed: 3, matched: 2, duplicate: 1, recent: 2 });
  assert.deepStrictEqual(summarizeSells([]),
                         { parsed: 0, matched: 0, duplicate: 0, recent: 0 });
});

test('buildSellBox renders the paste box by default', () => {
  const { buildSellBox } = globalThis.__RwthPure;
  const html = buildSellBox({ ledger: {} });
  assert.match(html, /data-sell-input/);
  assert.match(html, /data-action="parse-sells"/);
});

test('buildSellBox renders the confirmation summary when a preview is staged', () => {
  const { buildSellBox } = globalThis.__RwthPure;
  const html = buildSellBox({ ledger: { sellPreview: {
    rows: [{ sell: { itemName: 'Riot Body', saleNet: 1 }, matchedId: 'h1' }],
    summaryText: '1 sale parsed, 1 matched, 0 → Recent Transactions',
  } } });
  assert.match(html, /1 sale parsed, 1 matched/);
  assert.match(html, /data-action="commit-sells"/);
  assert.match(html, /data-action="cancel-sells"/);
});

test('buildLedgerTab relocates the Log-a-sale box into the ⚙ popup', () => {
  const { buildLedgerTab } = globalThis.__RwthPure;
  // #19 — no longer an always-visible collapsible in the tab body...
  assert.doesNotMatch(buildLedgerTab({ ledger: { items: [] } }), /data-sell-input/);
  // ...it lives inside the ⚙ scan-settings popup.
  const open = buildLedgerTab({ ledger: { items: [] }, ui: { scanSettingsOpen: true } });
  assert.match(open, /data-sell-input/);
  assert.match(open, /data-action="parse-sells"/);
});

// ── Advertise (slice 6) ──────────────────────────────────────────────────────
const listedEnfield = {
  id: 'e1', itemName: 'Enfield SA-80', type: 'weapon', status: 'listed',
  bonuses: [{ name: 'Deadeye', value: 29 }], quality: 70, listPrice: 118000000,
};
const listedRiot = {
  id: 'r1', itemName: 'Riot Body', type: 'armor', status: 'listed',
  bonuses: [], quality: 6.5, listPrice: 78000000,
};

test('AdvertiseGenerator.toChat abbreviates known item names via ITEM_ABBREV', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  const out = AdvertiseGenerator.toChat([listedEnfield], {});
  assert.match(out, /<b>Enfield<\/b>/);
  assert.doesNotMatch(out, /SA-80/);
});

test('AdvertiseGenerator.toChat defaults parens to the bonus, falls back to quality', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  assert.match(AdvertiseGenerator.toChat([listedEnfield], {}), /\(Deadeye 29%\)/);
  assert.match(AdvertiseGenerator.toChat([listedRiot], {}), /\(6\.5% q\)/);
});

test('AdvertiseGenerator.toChat omits links when settings are blank', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  const out = AdvertiseGenerator.toChat([], {});
  assert.doesNotMatch(out, /Bazaar|Forum/);
});

// #35 (S1) — the trade-chat blurb decoration is now user-editable emoji inserts
// resolved through AdvConfig.chat. Upgrade safety: with the new settings untouched,
// the header + Floor-Prices lines must reproduce v0.3.228's inline literals exactly.
test('#35 toChat header decoration is byte-identical to v0.3.228 by default', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  const out = AdvertiseGenerator.toChat([listedEnfield], { shopName: 'Test Shop' });
  // The two header lines lead the blurb, unchanged from the shipped literals.
  assert.ok(out.startsWith('🔹🔷 <u>Test Shop</u> 🔷🔹\n🟢 <u>Floor Prices</u> 🟢\n'),
    `header not byte-identical:\n${out}`);
});

test('#35 toChat: a custom emoji changes exactly that decoration', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  // Only headerLeft is customised — right flourish + Floor-Prices marker stay default.
  const left = AdvertiseGenerator.toChat([listedEnfield], { shopName: 'Test Shop', chatHeaderLeft: '🔥' });
  assert.ok(left.startsWith('🔥 <u>Test Shop</u> 🔷🔹\n🟢 <u>Floor Prices</u> 🟢\n'),
    `custom headerLeft not applied:\n${left}`);
  // Only the Floor-Prices marker is customised — the header flourish stays default.
  const floor = AdvertiseGenerator.toChat([listedEnfield], { shopName: 'Test Shop', chatFloorMarker: '💰' });
  assert.ok(floor.startsWith('🔹🔷 <u>Test Shop</u> 🔷🔹\n💰 <u>Floor Prices</u> 💰\n'),
    `custom floorMarker not applied:\n${floor}`);
});

test('#35 toChat: a cleared field removes exactly that decoration', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  // Explicit '' drops the decoration with no stray leading/trailing space.
  const out = AdvertiseGenerator.toChat([listedEnfield], {
    shopName: 'Test Shop', chatHeaderLeft: '', chatHeaderRight: '', chatFloorMarker: '' });
  assert.ok(out.startsWith('<u>Test Shop</u>\n<u>Floor Prices</u>\n'),
    `cleared decoration not removed:\n${out}`);
});

test('#35 AdvConfig.resolve.chat: undefined -> default, "" -> removed', () => {
  const { AdvConfig } = globalThis.__RwthPure;
  const def = AdvConfig.resolve({}).chat;
  assert.deepStrictEqual(def, {
    headerLeft: '🔹🔷', headerRight: '🔷🔹', floorMarker: '🟢',
    showPrice: true, showBonus: true, // #36 — both fit toggles ship ON
    sort: 'price', // #37 — sort defaults to highest-price
  });
  const cleared = AdvConfig.resolve({ chatHeaderLeft: '', chatFloorMarker: '' }).chat;
  assert.strictEqual(cleared.headerLeft, '');
  assert.strictEqual(cleared.headerRight, '🔷🔹'); // untouched -> default
  assert.strictEqual(cleared.floorMarker, '');
});

test('#35 buildAdvChatGear hides the fields until opened, then prefills them', () => {
  const { buildAdvChatGear } = globalThis.__RwthPure;
  const chat = { headerLeft: '🔹🔷', headerRight: '🔷🔹', floorMarker: '🟢' };
  const closed = buildAdvChatGear(chat, false);
  assert.match(closed, /data-action="toggle-adv-chat-gear"/);
  assert.doesNotMatch(closed, /data-adv-chat=/);
  const open = buildAdvChatGear(chat, true);
  assert.match(open, /data-adv-chat="headerLeft"[^>]*value="🔹🔷"/);
  assert.match(open, /data-adv-chat="headerRight"[^>]*value="🔷🔹"/);
  assert.match(open, /data-adv-chat="floorMarker"[^>]*value="🟢"/);
  assert.match(open, /is-open/);
  // Default (unmodified) chat lights no active dot; a customised field does.
  assert.doesNotMatch(buildAdvChatGear(chat, false), /rwth-gear-dot/);
  assert.match(buildAdvChatGear({ ...chat, headerLeft: '🔥' }, false), /rwth-gear-dot/);
});

// #36 (S2) — show-price / show-bonus% toggles feed the 125-char fitter. Each is a
// per-item content ceiling: ON requests that content (longer lines → fewer items
// fit); OFF claws it back. Both ship ON so untouched output reproduces v0.3.229.
// NOTE: with the cheapest-first price-shed KEPT under the ON state (decision 7),
// the shed already drives an ON blurb down to the priceless state under pressure,
// so the price toggle governs the visible tails, not the derived item COUNT.
// v0.3.232: the bonus NAME always shows — the show-bonus% toggle now only strips
// the trailing ` value%`, so it saves fewer chars than before but can still let an
// extra listing fit; it is never shed mid-fit.
const chatFitItems = [
  { id: 'a', itemName: 'Kevlar Gloves', bonuses: [{ name: 'Impregnable', value: 15 }], listPrice: 900000000 },
  { id: 'b', itemName: 'Riot Shield',   bonuses: [{ name: 'Impenetrable', value: 12 }], listPrice: 800000000 },
  { id: 'c', itemName: 'Chain Vest',    bonuses: [{ name: 'Impervious', value: 10 }],  listPrice: 700000000 },
];
const chatFitSettings = { shopName: 'My Shop', playerId: '12345', forumThreadUrl: 'https://x' };
const chatItemCount = (t) => (t.match(/\[S\]/g) || []).length;

test('#36 AdvConfig.resolve.chat: showPrice/showBonus default ON, explicit false → OFF', () => {
  const { AdvConfig } = globalThis.__RwthPure;
  const def = AdvConfig.resolve({}).chat;
  assert.strictEqual(def.showPrice, true);
  assert.strictEqual(def.showBonus, true);
  const off = AdvConfig.resolve({ chatShowPrice: false, chatShowBonus: false }).chat;
  assert.strictEqual(off.showPrice, false);
  assert.strictEqual(off.showBonus, false);
  // Only an explicit false flips it — any other value reads as ON.
  assert.strictEqual(AdvConfig.resolve({ chatShowPrice: true }).chat.showPrice, true);
});

test('#36 toChat: both toggles ON with untouched emoji reproduces v0.3.229 byte-for-byte', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  const out = AdvertiseGenerator.toChat([listedEnfield, listedRiot], { shopName: 'Test Shop' });
  assert.strictEqual(out,
    '🔹🔷 <u>Test Shop</u> 🔷🔹\n🟢 <u>Floor Prices</u> 🟢\n'
    + '[S] <b>Enfield</b> (Deadeye 29%) — <b>$118m</b>\n'
    + '[S] <b>Riot Body</b> (6.5% q) — <b>$78m</b>');
});

test('#36 toChat: show-price OFF drops the — price tails and never shows fewer items', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  const on = AdvertiseGenerator.toChat(chatFitItems, chatFitSettings);
  const off = AdvertiseGenerator.toChat(chatFitItems, { ...chatFitSettings, chatShowPrice: false });
  assert.match(on, /—/);                         // ON: at least one price tail
  assert.doesNotMatch(off, /—/);                 // OFF: no price tails at all
  assert.doesNotMatch(off, /\$\d/);              // OFF: no formatted price anywhere
  // The kept cheapest-first shed means OFF is never forced to show fewer listings.
  assert.ok(chatItemCount(off) >= chatItemCount(on));
});

test('#36 toChat: show-bonus% OFF keeps the name paren but drops the trailing percentage', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  const on = AdvertiseGenerator.toChat(chatFitItems, chatFitSettings);
  const off = AdvertiseGenerator.toChat(chatFitItems, { ...chatFitSettings, chatShowBonus: false });
  // ON: name + percentage. OFF: the bonus NAME still shows — only the ` value%` is gone.
  assert.match(on, /\(Impregnable 15%\)/);
  assert.match(off, /\(Impregnable\)/);          // name survives the toggle
  assert.doesNotMatch(off, /\(Impregnable \d/);  // but the percentage does not
  assert.doesNotMatch(off, /\d%\)/);             // no bonus/quality percentage in any paren
  // Shorter lines (percentage clawed back) → the fitter shows at least as many
  // listings under the 125 cap, never fewer.
  assert.ok(chatItemCount(off) >= chatItemCount(on),
    `expected bonus-off to fit at least as many items (on=${chatItemCount(on)}, off=${chatItemCount(off)})`);
  // Char-budget honesty: every line still fits Torn's 125 rendered-char cap.
  for (const line of off.split('\n')) {
    assert.ok(line.replace(/<[^>]+>/g, '').length <= 125);
  }
});

test('#233 toChat: item count is adaptive — fills toward 125, no fixed 3-item cap', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  // Four short items, both toggles OFF → all lines minimal. Under the old fixed
  // CHAT_LIMIT=3 the 4th collapsed into "+1 more"; adaptive fits all four (they
  // total well under 125), so nothing is dropped.
  const four = [
    { id: 'a', itemName: 'A1', bonuses: [], listPrice: 900000000 },
    { id: 'b', itemName: 'B2', bonuses: [], listPrice: 800000000 },
    { id: 'c', itemName: 'C3', bonuses: [], listPrice: 700000000 },
    { id: 'd', itemName: 'D4', bonuses: [], listPrice: 600000000 },
  ];
  const out = AdvertiseGenerator.toChat(four, { shopName: 'S', chatShowPrice: false, chatShowBonus: false });
  assert.strictEqual(chatItemCount(out), 4);     // all four fit — no 3-cap
  assert.doesNotMatch(out, /more listed/);       // nothing dropped
  // The count still DERIVES from the char budget: with bonuses + prices ON the
  // same-priced armor lines are long, so only one fits and the rest collapse.
  const dense = AdvertiseGenerator.toChat(chatFitItems, chatFitSettings);
  assert.match(dense, /\+2 more listed/);
  // And the budget genuinely binds: 20 short listings can't all fit 125 chars,
  // so the fitter shows several and reports the remainder — never all 20.
  const many = Array.from({ length: 20 }, (_, i) => ({
    id: String(i), itemName: `W${i}`, bonuses: [], listPrice: (20 - i) * 1e8,
  }));
  const manyOut = AdvertiseGenerator.toChat(many, { shopName: 'S', chatShowPrice: false, chatShowBonus: false });
  assert.ok(chatItemCount(manyOut) > 3, 'adaptive shows more than the old cap of 3');
  assert.ok(chatItemCount(manyOut) < 20, 'but still bounded by the 125-char budget');
  assert.match(manyOut, /more listed/);
  for (const line of manyOut.split('\n')) {
    assert.ok(line.replace(/<[^>]+>/g, '').length <= 125);
  }
});

test('#36 buildAdvChatGear renders both toggles (default checked) and lights the dot when one is OFF', () => {
  const { buildAdvChatGear } = globalThis.__RwthPure;
  const on = buildAdvChatGear({ headerLeft: '🔹🔷', headerRight: '🔷🔹', floorMarker: '🟢', showPrice: true, showBonus: true }, true);
  assert.match(on, /data-adv-chat-showprice[^>]*checked/);
  assert.match(on, /data-adv-chat-showbonus[^>]*checked/);
  // A toggle turned OFF renders unchecked and lights the active dot even when the
  // emoji fields are all at their shipped defaults.
  const off = buildAdvChatGear({ headerLeft: '🔹🔷', headerRight: '🔷🔹', floorMarker: '🟢', showPrice: false, showBonus: true }, false);
  assert.doesNotMatch(off, /data-adv-chat-showprice[^>]*checked/);
  assert.match(off, /rwth-gear-dot/);
  const offBonus = buildAdvChatGear({ headerLeft: '🔹🔷', headerRight: '🔷🔹', floorMarker: '🟢', showPrice: true, showBonus: false }, false);
  assert.match(offBonus, /rwth-gear-dot/);
});

// #37 (S3) — sort choice governs which listings lead the blurb: highest price
// (default, reproduces today's order) or oldest-first (buyTimestamp ascending, for
// dumping long-held stock). Explicitly two options only — no bonus-% or blended rank.
// Distinct listPrice ranking vs buyTimestamp ranking so the two orders differ.
const chatSortItems = [
  { id: 'x', itemName: 'X1', bonuses: [], listPrice: 300000000, buyTimestamp: 1000 }, // oldest, cheapest
  { id: 'y', itemName: 'Y2', bonuses: [], listPrice: 900000000, buyTimestamp: 3000 }, // priciest, newest
  { id: 'z', itemName: 'Z3', bonuses: [], listPrice: 600000000, buyTimestamp: 2000 },
];

test('#37 AdvConfig.resolve.chat.sort: default price, chatSort:age → age, other → price', () => {
  const { AdvConfig } = globalThis.__RwthPure;
  assert.strictEqual(AdvConfig.resolve({}).chat.sort, 'price');
  assert.strictEqual(AdvConfig.resolve({ chatSort: 'age' }).chat.sort, 'age');
  // Any non-'age' value falls back to the highest-price default.
  assert.strictEqual(AdvConfig.resolve({ chatSort: 'bonus' }).chat.sort, 'price');
  assert.strictEqual(AdvConfig.resolve({ chatSort: 'price' }).chat.sort, 'price');
});

test('#37 toChat: Highest price (default) keeps listPrice-descending order — unchanged from today', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  const out = AdvertiseGenerator.toChat(chatSortItems, { shopName: 'S', chatShowPrice: false });
  const order = (out.match(/<b>([XYZ]\d)<\/b>/g) || []).map(m => m.replace(/<\/?b>/g, ''));
  assert.deepStrictEqual(order, ['Y2', 'Z3', 'X1']); // 900m > 600m > 300m
});

test('#37 toChat: Oldest first leads with the earliest-buyTimestamp item', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  const out = AdvertiseGenerator.toChat(chatSortItems, { shopName: 'S', chatShowPrice: false, chatSort: 'age' });
  const order = (out.match(/<b>([XYZ]\d)<\/b>/g) || []).map(m => m.replace(/<\/?b>/g, ''));
  assert.deepStrictEqual(order, ['X1', 'Z3', 'Y2']); // buyTimestamp 1000 < 2000 < 3000
  assert.match(out, /<b>X1<\/b>/); // oldest-held leads
});

test('#37 buildAdvChatGear renders the sort select with both options, default Highest price', () => {
  const { buildAdvChatGear } = globalThis.__RwthPure;
  const base = { headerLeft: '🔹🔷', headerRight: '🔷🔹', floorMarker: '🟢', showPrice: true, showBonus: true };
  const open = buildAdvChatGear({ ...base, sort: 'price' }, true);
  assert.match(open, /data-adv-chat-sort/);
  assert.match(open, /<option value="price"[^>]*selected>Highest price<\/option>/);
  assert.match(open, /<option value="age"[^>]*>Oldest first<\/option>/);
  assert.doesNotMatch(open, /value="age"[^>]*selected/);
  // Oldest-first selected marks the age option and lights the active dot.
  const age = buildAdvChatGear({ ...base, sort: 'age' }, false);
  assert.match(age, /rwth-gear-dot/);
  const ageOpen = buildAdvChatGear({ ...base, sort: 'age' }, true);
  assert.match(ageOpen, /<option value="age"[^>]*selected>Oldest first<\/option>/);
  // Default price sort with untouched emoji/toggles lights no dot.
  assert.doesNotMatch(buildAdvChatGear({ ...base, sort: 'price' }, false), /rwth-gear-dot/);
});

test('buildAdvertiseTab default-checks all listed rows with price input + IMG button', () => {
  const { buildAdvertiseTab } = globalThis.__RwthPure;
  const html = buildAdvertiseTab({
    advertise: { selectedIds: null, transactions: [] },
    ledger: { items: [listedEnfield, listedRiot] },
    settings: {},
  });
  assert.strictEqual((html.match(/data-adv-check checked/g) || []).length, 2);
  assert.match(html, /data-adv-field="listPrice"/);
  assert.match(html, /data-action="toggle-img"/);
  // #21/3 — the list-price field reads as full formatted money ($118,000,000) at
  // rest but carries the exact digits in data-raw for editing.
  assert.match(html, /data-raw="118000000" value="\$118,000,000"/);
});

test('buildAdvertiseTab honours an explicit selectedIds list', () => {
  const { buildAdvertiseTab } = globalThis.__RwthPure;
  const html = buildAdvertiseTab({
    advertise: { selectedIds: ['e1'], transactions: [] },
    ledger: { items: [listedEnfield, listedRiot] },
    settings: {},
  });
  assert.strictEqual((html.match(/data-adv-check checked/g) || []).length, 1);
});

test('buildAdvertiseTab renders the Recent Transactions editor', () => {
  const { buildAdvertiseTab } = globalThis.__RwthPure;
  const html = buildAdvertiseTab({
    advertise: { selectedIds: null, transactions: [
      { id: 't1', itemName: 'Riot Body', bonusName: 'Impregnable',
        buyer: 'Apocolypse_', price: 84150000, origin: 'paste' },
    ] },
    ledger: { items: [] },
    settings: {},
  });
  assert.match(html, /data-tx-row="t1"/);
  assert.match(html, /value="Apocolypse_"/);
  assert.match(html, /data-action="add-tx"/);
  assert.match(html, /data-action="remove-tx"/);
});

// The forum thread title field was retired — it was a copy-only scratchpad no
// generator read (the title lives in Torn's create-thread box, and shopName
// carries shop identity). The chat blurb is the one quick-copy text box in the
// Copy-to-Torn strip.
test('buildAdvertiseTab drops the retired forum thread title field and renders the chat box', () => {
  const { buildAdvertiseTab } = globalThis.__RwthPure;
  const html = buildAdvertiseTab({
    advertise: { selectedIds: null, transactions: [] },
    ledger: { items: [] },
    settings: {},
  });
  assert.doesNotMatch(html, /forumThreadTitle/);
  assert.doesNotMatch(html, /rwth-adv-forum-title/);
  assert.doesNotMatch(html, /data-copy-target="rwth-out-title"/);
  assert.match(html, /data-copy-target="rwth-out-chat"/);
});

test('buildAdvertiseTab tolerates a bare call', () => {
  const { buildAdvertiseTab } = globalThis.__RwthPure;
  assert.strictEqual(typeof buildAdvertiseTab(), 'string');
});

// ── Advertise HTML outputs (slice 7) ─────────────────────────────
const advItems = [
  { id: 'e1', itemName: 'Enfield SA-80', bonuses: [{ name: 'Deadeye', value: 29 }],
    listPrice: 118000000, gyazoUrl: 'https://i.gyazo.com/abc.jpg' },
  { id: 'r1', itemName: 'Riot Body', bonuses: [], listPrice: 78000000, gyazoUrl: '' },
];
const advTxs = [{ id: 't1', itemName: 'Riot Body', bonusName: 'Impregnable',
                  buyer: 'Apocolypse_', price: 84150000 }];
const advSettings = { playerId: '1171127',
                      bannerImageUrl: 'https://i.gyazo.com/banner.jpg' };


test('toForumHtml injects item screenshots and omits the row when absent', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  const html = AdvertiseGenerator.toForumHtml(advItems, advTxs, advSettings);
  assert.strictEqual((html.match(/i\.gyazo\.com\/abc/g) || []).length, 2);
});

// #322 — per-surface picture: forumImageUrl wins for the forum, else the
// shared bannerImageUrl; the image replaces the wordmark/Trading Post header.
test('toForumHtml uses the forum picture override, replacing the wordmark header', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  const html = AdvertiseGenerator.toForumHtml([], [], { forumImageUrl: 'https://i.gyazo.com/hdr.jpg' });
  assert.match(html, /src="https:\/\/i\.gyazo\.com\/hdr\.jpg"/);
  assert.doesNotMatch(html, /Trading Post/);
  const shared = AdvertiseGenerator.toForumHtml([], [], { bannerImageUrl: 'https://i.gyazo.com/shared.jpg' });
  assert.match(shared, /src="https:\/\/i\.gyazo\.com\/shared\.jpg"/);
});

test('toForumHtml omits the Recent Transactions section when there are none', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  const html = AdvertiseGenerator.toForumHtml(advItems, [], advSettings);
  assert.doesNotMatch(html, /Recent Transactions/);
});

// #337 — the txCompact flag tightens each transaction row's vertical padding;
// default off keeps the roomier 9px padding, on switches it to 3px.
test('toForumHtml gives transaction rows roomy padding by default, compact when opted in', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  const roomy = AdvertiseGenerator.toForumHtml(advItems, advTxs, advSettings);
  assert.match(roomy, /padding: 9px 14px/);
  assert.doesNotMatch(roomy, /padding: 3px 14px/);
  const compact = AdvertiseGenerator.toForumHtml(advItems, advTxs, { ...advSettings, txCompact: true });
  assert.match(compact, /padding: 3px 14px/);
});

// #337 — the transaction toggles moved behind a caret gear. Closed, the gear
// button renders but the checkboxes stay hidden in the popover; open, both
// checkboxes appear and reflect the resolved section flags.
test('buildAdvTxGear hides the toggles until opened, then reflects the flags', () => {
  const { buildAdvTxGear } = globalThis.__RwthPure;
  const closed = buildAdvTxGear({ transactions: true, txCompact: false }, false);
  assert.match(closed, /data-action="toggle-adv-tx-gear"/);
  assert.doesNotMatch(closed, /data-adv-tx-compact/);
  const open = buildAdvTxGear({ transactions: true, txCompact: true }, true);
  assert.match(open, /data-adv-section="transactions"[^>]* checked/);
  assert.match(open, /data-adv-tx-compact checked/);
});

test('toBazaarHtml uses the Verdana font scheme, not all-Courier', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  const html = AdvertiseGenerator.toBazaarHtml(advItems, advSettings);
  assert.match(html, /font-family: Verdana, Geneva, sans-serif/);
  assert.doesNotMatch(html, /Courier/);
});

test('toBazaarHtml renders the bazaar banner and drops it when blank', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  assert.match(AdvertiseGenerator.toBazaarHtml(advItems, advSettings), /src="https:\/\/i\.gyazo\.com\/banner\.jpg"/);
  assert.doesNotMatch(AdvertiseGenerator.toBazaarHtml(advItems, {}), /<img/);
});

// #34 — opt-in RW-item listings on the bazaar advert. Default OFF must leave the
// bazaar output byte-for-byte identical to the items-absent render (nothing
// leaks); ON renders the shared compact signature-card catalogue under an
// "Also available — RW gear" divider, never the forum's image cards.
test('toBazaarHtml hides RW items by default and lists them only when opted in', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  const off = AdvertiseGenerator.toBazaarHtml(advItems, advSettings);
  // Default-off is byte-for-byte identical to the items-absent render — no leak.
  assert.strictEqual(off, AdvertiseGenerator.toBazaarHtml([], advSettings));
  assert.doesNotMatch(off, /Also available/);
  assert.doesNotMatch(off, /Enfield SA-80/);
  // Opt-in: the divider + the shared compact cards (name + compact price) appear,
  // and it is NOT the forum's heavy image card (no per-item screenshot markup).
  const on = AdvertiseGenerator.toBazaarHtml(advItems, { ...advSettings, bazaarShowItems: true });
  assert.match(on, /Also available &mdash; RW gear/);
  assert.match(on, /Enfield SA-80/);
  assert.match(on, /\$118m/);
  assert.doesNotMatch(on, /i\.gyazo\.com\/abc/);
});

test('toSignatureHtml is item-driven and condensed with compact prices', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  const html = AdvertiseGenerator.toSignatureHtml(advItems, advSettings);
  assert.match(html, /Enfield SA-80/);
  assert.match(html, /\$118m/);
  assert.match(html, /\$78m/);
});

// #322 — same per-surface rule for the signature: signatureImageUrl wins,
// else the shared bannerImageUrl drives the header.
test('toSignatureHtml uses the signature override, falling back to the shared banner', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  const html = AdvertiseGenerator.toSignatureHtml(advItems, { signatureImageUrl: 'https://i.gyazo.com/hdr.jpg' });
  assert.match(html, /src="https:\/\/i\.gyazo\.com\/hdr\.jpg"/);
  const shared = AdvertiseGenerator.toSignatureHtml(advItems, advSettings);
  assert.match(shared, /src="https:\/\/i\.gyazo\.com\/banner\.jpg"/);
});

// #332 — one composed availability sentence. Browse venues (bazaar, display
// case) collapse into a single "my bazaar, display case" group sharing one "my";
// Item Market is always named with its markup tag baked in and joined with ", or".
// The "with a markup" tag is gated on the #321 markup setting.
test('AvailabilityLine composes one sentence; item market is always tagged, never repeated or named bare', () => {
  const { AvailabilityLine } = globalThis.__RwthPure;
  const C = (l, o, m) => AvailabilityLine.compose(l, o, m);
  assert.strictEqual(C([]), '');
  assert.strictEqual(C(['displayCase']),
    'Items may be listed in my display case. Message for any of these deals below.');
  assert.strictEqual(C(['bazaar', 'displayCase']),
    'Items may be listed in my bazaar, or display case. Message for any of these deals below.');
  // Item Market alone, markup on — named once, tagged.
  assert.strictEqual(C(['itemMarket'], undefined, true),
    'Items may be listed in the item market with a markup. Message for any of these deals below.');
  // Browse group + item market, markup on.
  assert.strictEqual(C(['displayCase', 'itemMarket'], undefined, true),
    'Items may be listed in my display case, or in the item market with a markup. Message for any of these deals below.');
  assert.strictEqual(C(['bazaar', 'displayCase', 'itemMarket'], undefined, true),
    'Items may be listed in my bazaar, display case, or in the item market with a markup. Message for any of these deals below.');
  // Markup OFF: item market is named without the "with a markup" tag.
  assert.strictEqual(C(['bazaar', 'itemMarket'], undefined, false),
    'Items may be listed in my bazaar, or in the item market. Message for any of these deals below.');
  // A manual override wins verbatim (trimmed).
  assert.strictEqual(C(['bazaar'], '  my own words  '), 'my own words');
});

test('toForumHtml emits the merged line once, not a separate markup-notice row', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  const settings = { locations: { bazaar: true, itemMarket: true }, markup: true };
  const html = AdvertiseGenerator.toForumHtml(advItems, [], settings);
  // Item market is named exactly once, with its markup tag (no duplicate row).
  assert.strictEqual((html.match(/in the item market with a markup/g) || []).length, 1);
  assert.match(html, /Items may be listed in my bazaar, or in the item market with a markup\./);
});

// #325 — the three per-surface boxes were unified into one surface switcher:
// segmented Forum/Bazaar/Signature buttons over a single rwth-out-surface
// copy box, plus a Preview/Edit-HTML flip.
test('buildAdvertiseTab renders the surface switcher with one Copy HTML box', () => {
  const { buildAdvertiseTab } = globalThis.__RwthPure;
  const html = buildAdvertiseTab({
    advertise: { selectedIds: null, transactions: [] },
    ledger: { items: [] }, settings: {},
  });
  for (const surface of ['forum', 'bazaar', 'signature']) {
    assert.match(html, new RegExp(`data-action="set-adv-surface" data-surface="${surface}"`));
  }
  assert.match(html, /data-copy-target="rwth-out-surface"/);
  assert.match(html, /data-action="toggle-adv-raw"/);
});

test('buildAdvertiseTab renders a per-item IMG button and opens its popover', () => {
  const { buildAdvertiseTab } = globalThis.__RwthPure;
  const listed = { id: 'e1', itemName: 'Enfield SA-80', type: 'weapon',
                   status: 'listed', bonuses: [], listPrice: 1 };
  const closed = buildAdvertiseTab({
    advertise: { selectedIds: null, transactions: [], imgEditId: null },
    ledger: { items: [listed] }, settings: {},
  });
  assert.match(closed, /data-action="toggle-img" data-id="e1"/);
  assert.doesNotMatch(closed, /rwth-img-pop/);
  const open = buildAdvertiseTab({
    advertise: { selectedIds: null, transactions: [], imgEditId: 'e1' },
    ledger: { items: [listed] }, settings: {},
  });
  assert.match(open, /rwth-img-pop/);
  assert.match(open, /data-adv-field="gyazoUrl"/);
  assert.match(open, /data-action="close-img"/);
});

test('ItemClassifier.classify — Riot Helmet (armor / Riot / yellow / BB-eligible)', () => {
  const { ItemClassifier } = globalThis.__RwthPure;
  const dict = {
    'Riot Helmet': { name: 'Riot Helmet', type: 'Defensive', rarity: 'Yellow' },
  };
  const c = ItemClassifier.classify('Riot Helmet', dict);
  assert.strictEqual(c.type, 'defensive');   // routes on Torn's real type field
  assert.strictEqual(c.armorSet, 'Riot');
  assert.strictEqual(c.rarity, 'yellow');
  assert.strictEqual(c.isBBFloorEligible, true);
  assert.strictEqual(c.isTrash, false);
});

test('ItemClassifier.classify — Jackhammer (weapon / yellow / shotgun)', () => {
  const { ItemClassifier } = globalThis.__RwthPure;
  const dict = {
    Jackhammer: { name: 'Jackhammer', type: 'Primary', rarity: 'Yellow', weapon_class: 'Shotgun' },
  };
  const c = ItemClassifier.classify('Jackhammer', dict);
  assert.strictEqual(c.type, 'primary');
  assert.strictEqual(c.rarity, 'yellow');
  assert.strictEqual(c.weaponBase, 'shotgun');
  assert.strictEqual(c.isTrash, false);
  assert.strictEqual(c.isBBFloorEligible, false);
});

test('ItemClassifier.classify — trash weapon (Lorcin L380 / yellow / isTrash + BB-eligible)', () => {
  const { ItemClassifier } = globalThis.__RwthPure;
  const dict = {
    'Lorcin L380': { name: 'Lorcin L380', type: 'Secondary', rarity: 'Yellow', weapon_class: 'Pistol' },
  };
  const trashSet = new Set(['Lorcin L380']);
  const c = ItemClassifier.classify('Lorcin L380', dict, { trashSet });
  assert.strictEqual(c.type, 'secondary');
  assert.strictEqual(c.rarity, 'yellow');
  assert.strictEqual(c.isTrash, true);
  assert.strictEqual(c.isBBFloorEligible, true);
});

test('ItemClassifier.classify — orange & red weapon samples carry through rarity', () => {
  const { ItemClassifier } = globalThis.__RwthPure;
  const dict = {
    'ArmaLite M-15': { name: 'ArmaLite M-15', type: 'Primary', rarity: 'Orange', weapon_class: 'Rifle' },
    'Nail Bomb':     { name: 'Nail Bomb',     type: 'Primary', rarity: 'Red',    weapon_class: 'Heavy Artillery' },
  };
  const o = ItemClassifier.classify('ArmaLite M-15', dict);
  assert.strictEqual(o.rarity, 'orange');
  assert.strictEqual(o.weaponBase, 'rifle');
  const r = ItemClassifier.classify('Nail Bomb', dict);
  assert.strictEqual(r.rarity, 'red');
  assert.strictEqual(r.weaponBase, 'heavy artillery');
});

test('formatClassTag — armor with set, plain weapon, trash, double-bonus', () => {
  const { formatClassTag } = globalThis.__RwthPure;
  assert.strictEqual(formatClassTag({ type: 'defensive', armorSet: 'Riot', rarity: 'yellow' }),
                     '[Riot · yellow]');
  assert.strictEqual(formatClassTag({ type: 'primary', rarity: 'yellow' }), '[Yellow weapon]');
  assert.strictEqual(formatClassTag({ type: 'primary', rarity: 'yellow', isTrash: true }),
                     '[trash · yellow]');
  assert.strictEqual(formatClassTag({ type: 'primary', rarity: 'red' }, 2),
                     '[Red weapon · 2 bonuses]');
});

test('WEAPON_CATEGORY constant is removed', () => {
  assert.ok(!/\bWEAPON_CATEGORY\b/.test(SCRIPT_SOURCE), 'WEAPON_CATEGORY references must be gone');
});

// ── Ledger redesign D1 — palette/radius tokens (#25) ─────────────────────────
test('radius scale tokens are declared in :root', () => {
  assert.match(SCRIPT_SOURCE, /--rwth-radius-card:\s*6px/, 'card radius token missing');
  assert.match(SCRIPT_SOURCE, /--rwth-radius-ctl:\s*4px/, 'control radius token missing');
});

test('radius call sites reference tokens, not raw 3/4/6px', () => {
  assert.doesNotMatch(SCRIPT_SOURCE, /border-radius:\s*(?:3|4|6)px/,
    'ad-hoc 3/4/6px border-radius should point at --rwth-radius-* tokens');
});

test('D1 border ramp is neutralized (no cyan-alpha border literals)', () => {
  // The border/fill ramp was retuned off cyan (#00e5ff??) toward near-neutral.
  // --rwth-secondary / --rwth-secondary-strong stay cyan (secondary text/accent).
  const rootStart = SCRIPT_SOURCE.indexOf(':root {');
  const rootEnd = SCRIPT_SOURCE.indexOf('}', rootStart);
  const root = SCRIPT_SOURCE.slice(rootStart, rootEnd);
  for (const tok of ['--rwth-border-soft', '--rwth-border', '--rwth-border-strong',
                     '--rwth-border-bright', '--rwth-fill-faint', '--rwth-fill-hover']) {
    const m = root.match(new RegExp(tok.replace(/[-]/g, '\\-') + ':\\s*(#[0-9a-fA-F]+)'));
    assert.ok(m, `${tok} should be declared`);
    assert.ok(!/^#00e5ff/i.test(m[1]), `${tok} should be neutralized off cyan, got ${m[1]}`);
  }
  // Secondary accent stays cyan.
  assert.match(root, /--rwth-secondary:\s*#00e5ff/, 'secondary should remain cyan');
});

// ── Ledger redesign D6 — charts drawer inherits the system (#30) ─────────────
test('D6 dashboard drawer/cards use the shared card radius token', () => {
  // strip, stat cards, and hero all sit on --rwth-radius-card (6px), no raw px.
  for (const sel of ['.rwth-dash-strip ', '.rwth-stat ', '.rwth-hero ']) {
    const start = SCRIPT_SOURCE.indexOf(sel + '{');
    assert.notStrictEqual(start, -1, `${sel} rule should exist`);
    const block = SCRIPT_SOURCE.slice(start, SCRIPT_SOURCE.indexOf('}', start));
    assert.match(block, /border-radius:\s*var\(--rwth-radius-card\)/,
      `${sel} should use the shared card radius token`);
  }
});

test('D6 .rwth-dash-toggle drops the bordered-button styling for a quiet chevron row', () => {
  const start = SCRIPT_SOURCE.indexOf('.rwth-dash-toggle {');
  assert.notStrictEqual(start, -1, '.rwth-dash-toggle rule should exist');
  const block = SCRIPT_SOURCE.slice(start, SCRIPT_SOURCE.indexOf('}', start));
  assert.doesNotMatch(block, /border:\s*1px/, 'toggle should no longer be a bordered button');
  assert.doesNotMatch(block, /border-radius:\s*var\(--rwth-radius-ctl\)/,
    'toggle should drop the control-radius button chrome');
  // Green-discipline (#29): chrome hover stays cyan, not neon-green.
  const hoverStart = SCRIPT_SOURCE.indexOf('.rwth-dash-toggle:hover');
  const hover = SCRIPT_SOURCE.slice(hoverStart, SCRIPT_SOURCE.indexOf('}', hoverStart));
  assert.doesNotMatch(hover, /--rwth-accent/, 'toggle hover must not use the neon-green accent');
  assert.match(hover, /--rwth-secondary/, 'toggle hover should read cyan');
});

test('bootstrap does not eagerly warm BB rate or item dictionary', () => {
  const start = SCRIPT_SOURCE.indexOf('function bootstrap()');
  const end = SCRIPT_SOURCE.indexOf('if (!TEST)', start);
  assert.notStrictEqual(start, -1, 'bootstrap function should exist');
  assert.notStrictEqual(end, -1, 'bootstrap block should precede TEST gate');
  const bootstrapBlock = SCRIPT_SOURCE.slice(start, end);
  assert.doesNotMatch(bootstrapBlock, /fetchBBRate\(/);
  assert.doesNotMatch(bootstrapBlock, /fetchItemsDict\(/);
  assert.match(SCRIPT_SOURCE, /function ensurePricingWarmups\(\)/);
});

// ── resolveMarketAnchor (bonus-bracket market anchor, #298 / PRD #296) ────────
// Worked-example cases from the PRD acceptance criteria. Each asserts external
// behaviour: given listings + a target bonus, which anchor (and tier) comes back.

test('resolveMarketAnchor: Enfield Deadeye 32% anchors on the 30–35% bracket, not the floor', () => {
  const { resolveMarketAnchor } = globalThis.__RwthPure;
  const listings = [
    { price: 100, bonusValue: 25 }, { price: 102, bonusValue: 26 },
    { price: 105, bonusValue: 29 }, { price: 140, bonusValue: 31 },
    { price: 142, bonusValue: 33 }, { price: 145, bonusValue: 35 },
  ];
  const r = resolveMarketAnchor(listings, 32);
  assert.strictEqual(r.anchor, 140);              // 30–35% tier, not the 100 floor
  assert.strictEqual(r.tier.thresholdBonus, 31);
});

test('resolveMarketAnchor: Jackhammer Warlord 16% anchors on the 16% bracket, not the 15%', () => {
  const { resolveMarketAnchor } = globalThis.__RwthPure;
  const listings = [
    { price: 220, bonusValue: 15 }, { price: 240, bonusValue: 15 },
    { price: 270, bonusValue: 16 }, { price: 290, bonusValue: 16 },
  ];
  const r = resolveMarketAnchor(listings, 16);
  assert.strictEqual(r.anchor, 270);              // 16% bracket floor, not 220
  assert.strictEqual(r.tier.thresholdBonus, 16);
});

test('resolveMarketAnchor: multi-step promotion evaluates each jump vs the previous tier', () => {
  const { resolveMarketAnchor } = globalThis.__RwthPure;
  const listings = [
    { price: 220, bonusValue: 15 },
    { price: 270, bonusValue: 16 },
    { price: 350, bonusValue: 17 },
  ];
  assert.strictEqual(resolveMarketAnchor(listings, 15).anchor, 220);
  assert.strictEqual(resolveMarketAnchor(listings, 16).anchor, 270);
  assert.strictEqual(resolveMarketAnchor(listings, 17).anchor, 350);
  assert.strictEqual(resolveMarketAnchor(listings, 17).tiers.length, 3);
});

test('resolveMarketAnchor: a cheap higher-bonus piece cancels the tier (undercut guard)', () => {
  const { resolveMarketAnchor } = globalThis.__RwthPure;
  const listings = [
    { price: 220, bonusValue: 15 },
    { price: 270, bonusValue: 16 },
    { price: 200, bonusValue: 18 },   // strong piece going cheap
  ];
  const r = resolveMarketAnchor(listings, 16);
  assert.strictEqual(r.anchor, 200);              // match/undercut the cheap 18%, not 270
  // Every bonus bucket keeps its floor tier; the guard caps the anchor instead
  // of erasing the tier, so the tier list still shows the full ladder.
  assert.strictEqual(r.tiers.length, 3);
  assert.strictEqual(r.tier.thresholdBonus, 16);
});

test('resolveMarketAnchor: sub-threshold scatter within one bracket makes no new tier', () => {
  const { resolveMarketAnchor } = globalThis.__RwthPure;
  const listings = [
    { price: 100, bonusValue: 25 },
    { price: 107, bonusValue: 25 },
    { price: 113, bonusValue: 25 },   // 13% internal spread, same bonus
  ];
  const r = resolveMarketAnchor(listings, 25);
  assert.strictEqual(r.tiers.length, 1);
  assert.strictEqual(r.anchor, 100);
});

test('resolveMarketAnchor: thin data (single listing) still yields a sensible anchor', () => {
  const { resolveMarketAnchor } = globalThis.__RwthPure;
  const r = resolveMarketAnchor([{ price: 300, bonusValue: 40 }], 40);
  assert.strictEqual(r.anchor, 300);
});

test('resolveMarketAnchor: target below the first jump anchors on the global floor', () => {
  const { resolveMarketAnchor } = globalThis.__RwthPure;
  const listings = [
    { price: 220, bonusValue: 15 },
    { price: 270, bonusValue: 16 },
    { price: 350, bonusValue: 17 },
  ];
  assert.strictEqual(resolveMarketAnchor(listings, 14).anchor, 220);  // below lowest bonus
});

test('resolveMarketAnchor: no valid listings returns a null anchor', () => {
  const { resolveMarketAnchor } = globalThis.__RwthPure;
  assert.deepStrictEqual(resolveMarketAnchor([], 20),
                         { anchor: null, tier: null, tiers: [], fallback: null });
  assert.strictEqual(resolveMarketAnchor([{ price: 0, bonusValue: 20 }], 20).anchor, null);
});

// ── auction-card drill filters (#335) ─────────────────────────────────────────
test('applyDrillFilters: quality ±10 is ten quality points, not ten percent', () => {
  const { applyDrillFilters } = globalThis.__RwthPure;
  const comps = [
    { price: 100, quality: 110 },
    { price: 111, quality: 111 },
    { price: 121, quality: 121 },
    { price: 131, quality: 131 },
    { price: 132, quality: 132 },
  ];
  const out = applyDrillFilters(
    comps,
    { bonus: 'all', quality: 'pm10' },
    { listingQuality: 121 },
  );
  assert.deepStrictEqual(out.map(c => c.quality), [111, 121, 131]);
});

test('applyDrillFilters: quality ±5 is the tightest point window', () => {
  const { applyDrillFilters } = globalThis.__RwthPure;
  const comps = [
    { price: 115, quality: 115 },
    { price: 116, quality: 116 },
    { price: 121, quality: 121 },
    { price: 126, quality: 126 },
    { price: 127, quality: 127 },
  ];
  const out = applyDrillFilters(
    comps,
    { bonus: 'all', quality: 'pm5' },
    { listingQuality: 121 },
  );
  assert.deepStrictEqual(out.map(c => c.quality), [116, 121, 126]);
});

test('applyDrillFilters: bonus ±2 is a point window around the bonus percent', () => {
  const { applyDrillFilters } = globalThis.__RwthPure;
  const comps = [
    { price: 24, bonusValue: 24 },
    { price: 25, bonusValue: 25 },
    { price: 27, bonusValue: 27 },
    { price: 29, bonusValue: 29 },
    { price: 30, bonusValue: 30 },
  ];
  const out = applyDrillFilters(
    comps,
    { bonus: 'pm2', quality: 'all' },
    { primaryBonusValue: 27 },
  );
  assert.deepStrictEqual(out.map(c => c.bonusValue), [25, 27, 29]);
});

test('compReference: card auto bonus can stop at ±2 instead of widening open', () => {
  const { PricingEngine } = globalThis.__RwthPure;
  const comps = [
    { price: 100, bonusValue: 27 },
    { price: 110, bonusValue: 28 },
    { price: 120, bonusValue: 29 },
    { price: 130, bonusValue: 30 },
  ];
  const ref = PricingEngine.compReference(comps, {
    targetBonusValue: 27,
    strictTolerance: 0,
    widenTolerances: [1, 2],
  });
  assert.strictEqual(ref.widenedTolerance, 2);
  assert.deepStrictEqual(ref.comps.map(c => c.bonusValue), [27, 28, 29]);
});

// ── mergeLadder (#302 slice 1) ───────────────────────────────────────────────
test('mergeLadder: bonus-axis groups by exact bonus %, sorted descending', () => {
  const { mergeLadder } = globalThis.__RwthPure;
  const sold = [
    { price: 100, bonusValue: 15 },
    { price: 120, bonusValue: 15 },
    { price: 300, bonusValue: 20 },
  ];
  const out = mergeLadder({ soldComps: sold, listedComps: [], axis: 'bonus', ownKey: 15 });
  assert.deepStrictEqual(out.map(b => b.sort), [20, 15]);   // descending
  assert.deepStrictEqual(out.map(b => b.label), ['20%', '15%']);
  const b15 = out.find(b => b.key === 15);
  assert.strictEqual(b15.sold.count, 2);
});

test('mergeLadder: sold summary stats (median/min/max/count)', () => {
  const { mergeLadder } = globalThis.__RwthPure;
  const sold = [
    { price: 100, bonusValue: 15 },
    { price: 200, bonusValue: 15 },
    { price: 300, bonusValue: 15 },
  ];
  const [b] = mergeLadder({ soldComps: sold, listedComps: [], axis: 'bonus', ownKey: null });
  assert.deepStrictEqual(b.sold, { median: 200, min: 100, max: 300, count: 3, rows: b.sold.rows });
  assert.strictEqual(b.listed, null);
});

test('mergeLadder: listed summary is cheapest + count', () => {
  const { mergeLadder } = globalThis.__RwthPure;
  const listed = [
    { price: 500, bonusValue: 15 },
    { price: 450, bonusValue: 15 },
    { price: 600, bonusValue: 15 },
  ];
  const [b] = mergeLadder({ soldComps: [], listedComps: listed, axis: 'bonus', ownKey: null });
  assert.strictEqual(b.listed.cheapest, 450);
  assert.strictEqual(b.listed.count, 3);
  assert.strictEqual(b.sold, null);
});

test('mergeLadder: co-locates sold + listed at the same bonus level', () => {
  const { mergeLadder } = globalThis.__RwthPure;
  const out = mergeLadder({
    soldComps:   [{ price: 100, bonusValue: 15 }],
    listedComps: [{ price: 130, bonusValue: 15 }],
    axis: 'bonus', ownKey: null,
  });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].sold.median, 100);
  assert.strictEqual(out[0].listed.cheapest, 130);
});

test('mergeLadder: missing-side buckets still appear with null on the empty side', () => {
  const { mergeLadder } = globalThis.__RwthPure;
  const out = mergeLadder({
    soldComps:   [{ price: 100, bonusValue: 15 }],   // sold only at 15
    listedComps: [{ price: 200, bonusValue: 20 }],   // listed only at 20
    axis: 'bonus', ownKey: null,
  });
  const b15 = out.find(b => b.key === 15);
  const b20 = out.find(b => b.key === 20);
  assert.ok(b15 && b20, 'both buckets present');
  assert.strictEqual(b15.listed, null);
  assert.strictEqual(b20.sold, null);
});

test('mergeLadder: own-row marking on the bonus axis', () => {
  const { mergeLadder } = globalThis.__RwthPure;
  const out = mergeLadder({
    soldComps: [{ price: 100, bonusValue: 15 }, { price: 300, bonusValue: 20 }],
    listedComps: [], axis: 'bonus', ownKey: 20,
  });
  assert.strictEqual(out.find(b => b.key === 20).isOwn, true);
  assert.strictEqual(out.find(b => b.key === 15).isOwn, false);
});

test('mergeLadder: quality-axis buckets comps into class-tiered bands (default yellow)', () => {
  const { mergeLadder } = globalThis.__RwthPure;
  const sold = [
    { price: 100, quality: 90 },    // <100%  → idx 0
    { price: 110, quality: 120 },   // 100–129 → idx 1
    { price: 120, quality: 125 },   // 100–129 → idx 1
    { price: 200, quality: 175 },   // 150%+  → idx 3
  ];
  const out = mergeLadder({ soldComps: sold, listedComps: [], axis: 'quality', ownKey: 120, itemClass: 'yellowWeapon' });
  // sorted desc by bucket index
  assert.deepStrictEqual(out.map(b => b.key), [3, 1, 0]);
  assert.deepStrictEqual(out.map(b => b.label), ['150%+', '100–129%', '<100%']);
  assert.strictEqual(out.find(b => b.key === 1).sold.count, 2);
  assert.strictEqual(out.find(b => b.key === 1).isOwn, true);   // ownKey 120 falls in idx 1
});

test('mergeLadder: quality-axis honours the orange class bands', () => {
  const { mergeLadder } = globalThis.__RwthPure;
  const sold = [{ price: 100, quality: 175 }];   // 150–199% → idx 1 for orange
  const [b] = mergeLadder({ soldComps: sold, listedComps: [], axis: 'quality', ownKey: null, itemClass: 'orangeWeapon' });
  assert.strictEqual(b.label, '150–199%');
});

test('mergeLadder: drops zero/invalid-price rows and empty buckets', () => {
  const { mergeLadder } = globalThis.__RwthPure;
  const out = mergeLadder({
    soldComps:   [{ price: 0, bonusValue: 15 }, { price: NaN, bonusValue: 15 }],
    listedComps: [{ price: -5, bonusValue: 15 }],
    axis: 'bonus', ownKey: null,
  });
  assert.strictEqual(out.length, 0);   // no priced data anywhere → no buckets
});

test('mergeLadder: comps with no bonus value are skipped on the bonus axis', () => {
  const { mergeLadder } = globalThis.__RwthPure;
  const out = mergeLadder({
    soldComps: [{ price: 100, bonusValue: null }, { price: 200, bonusValue: 15 }],
    listedComps: [], axis: 'bonus', ownKey: null,
  });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].key, 15);
});

// ── mergeLadder spread / flip-margin (#303) ──────────────────────────────────
test('mergeLadder: spread = listedCheapest − soldMedian when both sides present', () => {
  const { mergeLadder } = globalThis.__RwthPure;
  const out = mergeLadder({
    soldComps:   [{ price: 100, bonusValue: 15 }],   // sold median 100
    listedComps: [{ price: 130, bonusValue: 15 }, { price: 150, bonusValue: 15 }], // cheapest 130
    axis: 'bonus', ownKey: 15,
  });
  const b = out.find(x => x.key === 15);
  assert.strictEqual(b.spread.abs, 30);
  assert.strictEqual(b.spread.pct, 0.3);   // (130 − 100) / 100
});

test('mergeLadder: spread is null when the for-sale side is missing', () => {
  const { mergeLadder } = globalThis.__RwthPure;
  const out = mergeLadder({
    soldComps: [{ price: 100, bonusValue: 15 }], listedComps: [],
    axis: 'bonus', ownKey: 15,
  });
  assert.strictEqual(out.find(x => x.key === 15).spread, null);
});

test('mergeLadder: spread is null when the sold side is missing', () => {
  const { mergeLadder } = globalThis.__RwthPure;
  const out = mergeLadder({
    soldComps: [], listedComps: [{ price: 130, bonusValue: 15 }],
    axis: 'bonus', ownKey: 15,
  });
  assert.strictEqual(out.find(x => x.key === 15).spread, null);
});
