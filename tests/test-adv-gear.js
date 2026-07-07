// node test-adv-gear.js
// Tests for the per-surface Advertise gear (issue #33) — the surface-switcher gear
// popover that adapts WHICH controls it shows to the active surface, without ever
// changing the shared stored values. Mirrors test-advconfig.js: requires the
// shipped .user.js directly (ADR-0002 seam), reads the pure builders off
// __RwthPure, and asserts on the emitted HTML string only.

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

require('../TORN-RW-trading-hub.user.js');

const { buildAdvCopyFields, buildAdvSurfaceGear, advSurfaceImageField } = globalThis.__RwthPure;

// ── Test helpers ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label, condition) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else           { console.error(`  ✗ ${label}`); failed++; }
}

const COPY_KEYS = ['subBanner', 'intro', 'alsoRotating', 'footerTagline'];
const copyFixture = {
  subBanner: 'Open shop',
  intro: 'Best in town',
  alsoRotating: 'Also drugs',
  footerTagline: 'Thanks!',
};

// ── buildAdvCopyFields — the four forum copy blocks ───────────────────────────

console.log('\nbuildAdvCopyFields — renders all four copy blocks');
{
  const html = buildAdvCopyFields(copyFixture);
  assert('every copy field binds via data-adv-copy',
    COPY_KEYS.every(k => html.includes(`data-adv-copy="${k}"`)));
  assert('intro is a textarea with its value inline',
    /data-adv-copy="intro"[^>]*>Best in town<\/textarea>/.test(html));
  assert('sub-banner value is set on the input', html.includes('value="Open shop"'));
}

console.log('\nbuildAdvCopyFields — tolerates missing / partial copy');
{
  for (const bad of [undefined, null, {}, 42, 'nope']) {
    const html = buildAdvCopyFields(bad);
    assert(`no "undefined" leaks for ${JSON.stringify(bad)}`, !html.includes('undefined'));
    assert(`still renders all four bindings for ${JSON.stringify(bad)}`,
      COPY_KEYS.every(k => html.includes(`data-adv-copy="${k}"`)));
  }
}

console.log('\nbuildAdvCopyFields — escapes values into attributes/markup');
{
  const html = buildAdvCopyFields({ subBanner: '"><b>x', intro: '<i>hi</i>' });
  assert('no raw closing tag injected via sub-banner attribute', !html.includes('"><b>x'));
  assert('intro angle brackets are escaped', !html.includes('<i>hi</i>'));
}

// ── buildAdvSurfaceGear — per-surface adaptivity ──────────────────────────────

const settings = {
  bannerImageUrl: 'https://img/banner.png',
  forumImageUrl: 'https://img/forum.png',
  bazaarImageUrl: 'https://img/bazaar.png',
  signatureImageUrl: 'https://img/sig.png',
};

console.log('\nforum gear — copy blocks + forum picture override');
{
  const html = buildAdvSurfaceGear('forum', settings, true, copyFixture);
  assert('shows all four copy blocks',
    COPY_KEYS.every(k => html.includes(`data-adv-copy="${k}"`)));
  assert('shows the forum picture override', html.includes('data-setting="forumImageUrl"'));
  assert('does not carry another surface\'s picture override',
    !html.includes('data-setting="bazaarImageUrl"') && !html.includes('data-setting="signatureImageUrl"'));
}

console.log('\nbazaar gear — bazaar picture override only, no copy blocks');
{
  const html = buildAdvSurfaceGear('bazaar', settings, true, copyFixture);
  assert('shows the bazaar picture override', html.includes('data-setting="bazaarImageUrl"'));
  assert('carries NO copy blocks', COPY_KEYS.every(k => !html.includes(`data-adv-copy="${k}"`)));
  assert('does not carry the forum picture override', !html.includes('data-setting="forumImageUrl"'));
}

console.log('\nbazaar gear — opt-in "show my RW items" toggle (#34)');
{
  const off = buildAdvSurfaceGear('bazaar', settings, true, copyFixture);
  assert('bazaar gear carries the show-items toggle', off.includes('data-adv-bazaar-items'));
  assert('toggle is unchecked by default', !/data-adv-bazaar-items[^>]*checked/.test(off));
  const on = buildAdvSurfaceGear('bazaar', { ...settings, bazaarShowItems: true }, true, copyFixture);
  assert('toggle reflects the persisted on-state', /data-adv-bazaar-items[^>]*checked/.test(on));
  // Only the bazaar surface carries the toggle — never forum or signature.
  assert('forum gear has no show-items toggle',
    !buildAdvSurfaceGear('forum', settings, true, copyFixture).includes('data-adv-bazaar-items'));
  assert('signature gear has no show-items toggle',
    !buildAdvSurfaceGear('signature', settings, true, copyFixture).includes('data-adv-bazaar-items'));
}

console.log('\nsignature gear — signature picture override only, thin by design');
{
  const html = buildAdvSurfaceGear('signature', settings, true, copyFixture);
  assert('shows the signature picture override', html.includes('data-setting="signatureImageUrl"'));
  assert('carries NO copy blocks', COPY_KEYS.every(k => !html.includes(`data-adv-copy="${k}"`)));
  // No filler: the popover holds exactly one bound field (the picture URL).
  const boundFields = (html.match(/data-setting=|data-adv-copy=/g) || []).length;
  assert('exactly one bound control in the signature gear', boundFields === 1);
}

console.log('\nclosed gear — no popover, no bound controls');
{
  const html = buildAdvSurfaceGear('forum', settings, false, copyFixture);
  assert('no popover element when closed', !html.includes('rwth-adv-gear-pop'));
  assert('no copy bindings when closed', COPY_KEYS.every(k => !html.includes(`data-adv-copy="${k}"`)));
  assert('no picture binding when closed', !html.includes('data-setting='));
  assert('still renders the toggle button', html.includes('data-action="toggle-adv-gear"'));
}

console.log('\ngear button — has-img dot reflects the surface picture');
{
  const withImg = buildAdvSurfaceGear('bazaar', settings, false, copyFixture);
  assert('filled dot when the surface has a picture override', withImg.includes('rwth-gear-dot'));
  const noImg = buildAdvSurfaceGear('bazaar', { bannerImageUrl: 'x' }, false, copyFixture);
  assert('no dot when the surface has no own override', !noImg.includes('rwth-gear-dot'));
}

console.log('\nadvSurfaceImageField — unknown surface falls back to forum');
{
  assert('unknown surface maps to the forum field', advSurfaceImageField('nope').key === 'forumImageUrl');
  assert('bazaar maps to its own field', advSurfaceImageField('bazaar').key === 'bazaarImageUrl');
}

// ── summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
