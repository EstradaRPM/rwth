# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Torn (the browser game) **userscript** plus a Node toolchain that feeds it data:

- `TORN-RW-trading-hub.user.js` — a single ~10.5k-line Tampermonkey/Greasemonkey
  script. A trader's workbench for flipping ranked-war armor & weapons: a ledger,
  an advertising-copy generator, and a pricing engine. This is the entire shipped product.
- `auction-db/` — Node ES-module scripts that backfill/poll Torn's auction-sale
  feed into a self-owned Supabase table. The userscript reads that table over
  PostgREST for pricing comps.

## Commands

```bash
# Run the full userscript test suite (Node's built-in runner)
cd tests && node --test

# Run one test file
node tests/test-rwth.js
cd tests && node --test test-rwth.js

# auction-db scripts (run from repo root; read auction-db/secrets.local.json)
node auction-db/poll.mjs        # forward-fill new sales (scheduled job)
node auction-db/backfill.mjs    # one-time historical walk back to June 2023
node auction-db/check.mjs       # health check: row count, oldest/newest
node auction-db/compare.mjs     # dry-run: compare our DB vs the third-party source
cd auction-db && npm install && node vacuum.mjs   # VACUUM FULL — only this needs `pg`

# Regenerate the API registry from the stored Torn spec (after changing a call)
node tools/gen-api-registry.mjs           # rebuild docs/api-endpoints.md from the stored spec
node tools/gen-api-registry.mjs --fetch   # re-download Torn's openapi.json first, then rebuild
```

There is no build step, linter, or bundler — the `.user.js` ships as-is. There is
no root `package.json`; `auction-db/package.json` exists only because `vacuum.mjs`
needs the `pg` dependency (every other script uses native `fetch`).

The suite should be fully green (`node --test` → 0 fail). If you change shipped
behavior, update the binding tests rather than leaving them red — assertions are
expected to track the script, not lag it.

## Userscript architecture

The whole script is one `'use strict'` IIFE. Key invariants (see the `// ─── … ───`
banner comments that divide the file into sections):

- **Single state object, single mutation path.** All runtime state lives in `MEM`
  (around line 410). The *only* way to mutate it is `setState(patch)` (~line 663),
  which `Object.assign`s the patch and calls `render()`. Don't mutate `MEM`
  directly outside the impure handlers that route through `setState`.
- **`Store` / `hydrate`** (~line 548) wrap `localStorage` (all keys `rwth_`-prefixed,
  every call try/catch'd so it never throws). `hydrate()` also runs **one-time
  migrations** of retired settings keys — when you rename or retire a persisted
  field, add a migration there so existing installs upgrade cleanly.
- **Pure/impure split (ADR-0002).** Pure code — HTML builders (`buildLedgerTab`,
  `buildAdvertiseTab`, `buildSettingsTab`, `buildContent`), parsers (`SellParser`,
  `parseAuctionWin`), and pricing math (`PricingEngine`, `BBEngine`, `CompWidener`,
  `ItemClassifier`, `LedgerStats`, `ChartGeom`, …) — takes state in and returns
  strings/values, touching no DOM or network. Impure code (`render`, fetch clients,
  DOM scanners, bootstrap) is gated behind `if (!TEST)`.
- **The test seam.** Every pure function meant for testing is re-exported on
  `globalThis.__RwthPure` (the big object near the end of the file, ~line 10456).
  Tests stub browser globals, set `globalThis.__RWTH_TEST__ = true` (which makes the
  IIFE skip the DOM bootstrap), then `require()` the *shipped* `.user.js` directly —
  so tests exercise the real shipped code, not a copy. **If you add a pure function
  you want tested, you must add it to `__RwthPure`.** The network transport
  (`GM_xmlhttpRequest`) is swappable via `globalThis.__RWTH_GM` for tests.
- **Three tabs.** `MEM.ui.activeTab` is `'ledger' | 'advertise' | 'settings'`;
  `buildContent` dispatches on it. The UI is rendered as HTML strings with
  `data-action="…"` / `data-*` attributes wired up by delegated click handlers in
  the impure `render` layer.
- **External data (ADR-0003).** `RWTH_API` (~line 7203) holds the endpoints: our own
  Supabase `auctions` table (read with a browser-safe anon publishable key, read-only
  via RLS), the Weav3r ranked-weapons API, and the Torn API. All requests go through
  `gmRequest` (a `GM_xmlhttpRequest`→Promise wrapper). A localStorage LRU `Cache`
  (5-min TTL) sits in front of Supabase reads.

## API endpoint registry — single source of truth

**Never guess an endpoint or parameter, and never ask the user what one is.** The
complete record lives in the repo:

- **`docs/api/torn-openapi.json`** — Torn's full OpenAPI spec (all 205 paths, every
  parameter, every enum). This is authoritative for anything Torn. Refresh with
  `node tools/gen-api-registry.mjs --fetch`.
- **`docs/api-endpoints.md`** — curated fast-path: the endpoints we actually call
  (Torn + Supabase PostgREST + Weav3r) with their *full* allowed parameter surface,
  flagging which params we currently send (`✅`) vs. which are available unused. The
  Torn tables are generated from the spec — do not hand-edit them.
- **`tests/test-api-endpoints.js`** (in `node --test`) is the drift guard: it fails
  if the code calls a Torn endpoint not registered in `tools/gen-api-registry.mjs`'s
  `USED`, if `USED` claims a param the spec doesn't list, or if `docs/api-endpoints.md`
  is stale. So the registry can never silently disagree with the code or the spec.

When you add or change an API call: update `USED` in `tools/gen-api-registry.mjs`,
run `node tools/gen-api-registry.mjs`, and let the test confirm code ↔ registry ↔ spec.

### Versioning

When you change behaviour, bump the version in **both** places and keep them in sync:
the `// @version` line in the UserScript header and `const SCRIPT_VERSION` just inside
the IIFE (both currently `0.3.154`). The `@updateURL`/`@downloadURL` point at the
`estradarpm/torn-scripts` GitHub repo, so users auto-update from there.

## auction-db toolchain

- `lib.mjs` holds everything shared by `backfill`/`poll`: row mapping, the Torn
  fetch with retry/backoff, the rate-limit delay (`TORN_DELAY_MS`, ~85 req/min under
  Torn's 100 cap), Supabase upsert, and cursor helpers. The two callers differ only
  in which time window they walk.
- Every row upserts by listing `id`, so re-running and overlapping pages are safe and
  idempotent. Only bonus-bearing sales are kept (`hasBonus`) — that's the data the
  hub actually prices.
- `schema.sql` is the one-time Supabase setup (table + indexes + read-only anon RLS
  policy); run it in the Supabase SQL editor.
- Secrets live in `auction-db/secrets.local.json` (gitignored): `SUPABASE_URL`,
  `SUPABASE_SERVICE_KEY`, and (for `vacuum.mjs` only) the direct-connection
  `SUPABASE_DB_URL`. The service key writes (bypassing RLS); the userscript only ever
  uses the public anon key.

## ADRs referenced in code

Decisions are cited inline by id. The two that shape how you work:

- **ADR-0002** — the pure/impure split and the `__RwthPure` + `__RWTH_TEST__` test seam.
- **ADR-0003** — the third-party/self-owned API plumbing (Supabase, Weav3r, Torn).
