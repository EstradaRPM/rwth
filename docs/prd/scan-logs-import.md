# PRD: Scan Logs — log-import redesign (buys / sales / mugs)

Status: approved · Audited against `TORN-RW-trading-hub.user.js` v0.3.154 (2026-07-05)
Feeds: `/to-issues` (see “Requirements as vertical slices”)

## 1. Problem & goal

The Scan Logs flow is the primary way a trader imports buy/sale/mug events into the ledger
for accurate P/L. It functionally works, but the audit found:

- The **dismissal model is inconsistent and lossy** — unchecking a buy loses it forever,
  unchecking a mug does nothing lasting (it reappears checked on every scan).
- **$0 mugs are un-dismissable zombies** that show up in every scan preview.
- The **sales preview commits rows the user never saw** (display-only, capped at 5 visible,
  all imported unconditionally).
- The **entry-point UI is cluttered**: three separate affordances (“Scan logs”, “+ add”, an
  always-visible “Log a sale” paste box) for what is conceptually one job — “bring my ledger
  up to date”.

Goal: one obvious action (“Refresh”), a preview where **everything that will be written is
visible and opt-out-able**, uniform and **recoverable** dismissal semantics, and zero
recurring noise — polish consistent with the north star of a sellable script.

## 2. Current-state audit

All line refs are `TORN-RW-trading-hub.user.js` @ v0.3.154 (they will drift; anchor by
function name).

### Flow map

1. Ledger bar renders `[Scan logs] [+ add]` next to the sort dropdown (`buildLedgerTab`
   ~2991–2993); a collapsible “Log a sale” paste box (`buildSellBox` ~2170–2210) always
   renders below the scan area.
2. `data-action="scan"` opens the inline `buildScanSetup` panel (~2099–2122): a “scan back
   to” date and four source checkboxes (buys / sales / trades / mugs), persisted to
   `MEM.settings.scanSources` / `MEM.settings.scanBackTo` via `syncScanSettings` (~4810–4824).
3. `run-scan` → `LogScanner.scan()` (~5736–5932) fetches 10 Torn log types
   (`SCAN_LOG_TYPES` ~393–405: auction/market/bazaar buys & sales, mugged 8156, four trade
   legs) with `SCAN_LOG_LIMIT = 100` entries per type (~392), classifies each entry via
   `classifyLogEvent` (~1358) and `reconcileTradeGroup` (~1384), and stages results via
   `buildScanPreview` (~1441–1563).
4. Results render inline: `buildScanChecklist` (~2067–2097) shows per-buy rows with editable
   fields and a `data-scan-check` checkbox; `buildScanPreviewUi` (~2124–2163) shows summary
   chips plus capped, mostly read-only lists (sales ×5, review ×4, ignored ×3) and mug rows
   with `data-scan-mug-check` checkboxes.
5. `confirm-scan` → `confirmScan` (~5938–6049) imports checked buys as held ledger items,
   **all** sales (matched ones close ledger rows, the rest become Recent Transactions),
   and checked non-$0 mugs into `rwth_mugs`.

Dedupe: a global seen-set `rwth_seen_log_events` (keys `logType:entryKey`) plus legacy
`rwth_seen_wins`; **mugs dedupe only against eventKeys embedded in `rwth_mugs` rows**
(`buildScanPreview` ~1453–1456, ~1478).

Manual entry points: “+ add” opens the inline `buildLedgerForm` (~1886–1975) →
`saveLedgerItem` (~5278) → `Ledger.add`; “Log a sale” paste-parses via `SellParser` (~773) →
`parseSells`/`commitSells` (~6054–6136).

### Verified bugs

| # | Bug | Root cause (line refs) |
|---|-----|------------------------|
| B1 | **Unchecked buys are permanently lost.** Accidentally uncheck a buy, commit → it never appears again; no recovery path. | `confirmScan` skips unchecked hits from import (~5946) but still adds **all** buy eventKeys to the global seen-set (~6020–6026). |
| B2 | **Unchecked mugs reappear forever** — the user-visible “mug checkboxes don’t work” symptom. The checkbox wiring is actually correct (`syncScanPreviewEdit` 4796–4808 updates MEM + Store; render key at 2138 matches the handler key at 4804); the toggle just has no lasting effect. | `confirmScan` skips unchecked mugs (~6000); mug keys are deliberately excluded from the seen-set (~6028–6036 — an overcorrection for an earlier bug that trapped mugs as “already imported”); unchecked mugs never enter `rwth_mugs` either → orphaned, re-staged `checked: true` (~1528) on every scan. |
| B3 | **$0 mugs reappear forever.** | Staged unfiltered (~1526–1529), skipped at commit (`amount <= 0`, ~6003), recorded nowhere. |
| B4 | **Sales preview is display-only and truncated.** A mis-matched sale can’t be excluded; sales #6+ commit sight-unseen. | `buildScanPreviewUi` slices sales to 5 with no checkboxes (~2127); `confirmScan` commits every sale in the preview. Review rows capped at 4 visible, ignored at 3 (~2149–2152). |
| B5 | **Silent gaps on deep scans.** | No pagination: 100 entries per log type; a back-to date beyond the window silently misses logs, with no warning when a page comes back full. |
| B6 | **No “last scanned” feedback; manual window.** | `MEM.ledger.lastScan` exists (~469, set ~5925) but is never surfaced in the UI nor used as the default scan window; the user must manage the back-to date by hand. |
| B7 | **Test gaps.** | No coverage of `confirmScan` checked/unchecked semantics, mug/$0 handling, or sales-commit behavior — `tests/test-rwth-scan.js` and the mug tests in `tests/test-rwth.js` stop at preview construction. |

## 3. Decisions

Four product forks were put to the owner on 2026-07-05; chosen options below.

1. **UI shape → one Refresh + settings popup.** Rejected: keeping three buttons (clutter);
   Refresh + separate “+ add” (still two entry points for one job).
2. **Dismissals → uniform recoverable dismissed list.** Rejected: “unchecked = decide later”
   (noisy — irrelevant events reappear every scan); permanent dismiss with a warning
   (accidents still unrecoverable).
3. **$0 mugs → filter silently.** Rejected: show-once-under-Ignored (still noise for
   zero-information events); keep-but-dismissible (per-event busywork).
4. **Sales → checkboxes + full list**, same semantics as buys. Rejected: full-list-without-
   checkboxes (bad matches still uncorrectable pre-commit); leave-as-is.

### Target design

- **Ledger bar:** `[⟳ Refresh] [⚙]` plus a “last scanned X ago” status line. Clicking
  Refresh scans immediately using saved settings; the default window is **since the last
  scan** (first run falls back to the saved back-to date / current default).
- **⚙ popup:** source checkboxes (buys/sales/trades/mugs), scan-back-to date override, and
  the two manual fallbacks — “+ add item” (opens the existing `buildLedgerForm`) and
  “paste sale” (the existing `SellParser` box). The standalone “+ add” button and the
  always-visible “Log a sale” collapsible are removed from the tab body.
- **Preview:** one consistent mental model — every row the commit would write (buys, sales,
  review) is visible with a checkbox; lists are uncapped (scrollable if long). Checked =
  import; unchecked = dismissed.
- **Dismissal semantics:** unchecked + commit ⇒ the row’s eventKeys are recorded in a new
  persisted `rwth_dismissed` store (not the seen-set), uniformly for buys, sales, and mugs.
  A “Dismissed (N)” section/toggle in the scan UI lists dismissed rows and can restore any
  of them into the next scan. Scan staging gates against seen ∪ dismissed.
- **$0 mugs:** never staged; their eventKeys are marked at scan time so they never reappear.

## 4. Requirements as vertical slices

Ordered for `/to-issues`; each slice is independently shippable and leaves the suite green.

### S1 — Dismissal store + uniform unchecked semantics + restore UI
- Add `rwth_dismissed` store (eventKey list, plus enough row snapshot to render a label:
  type, itemName/amount, timestamp). Hydrate with migration in `hydrate()`.
- `confirmScan`: unchecked buys are **no longer** added to the seen-set (fixes B1); their
  keys go to `rwth_dismissed`. Unchecked mugs likewise (fixes B2). Checked rows behave as
  today (buys → seen-set; mugs → `rwth_mugs`).
- `buildScanPreview` (or the scan loop’s gate) treats dismissed keys like seen: staged into
  `preview.already`-style suppression, not re-shown.
- Scan UI gains a “Dismissed (N)” collapsed section listing dismissed rows with a per-row
  “restore” action that removes the keys from `rwth_dismissed` (row reappears on next scan).
- Tests: unchecked buy → dismissed, reappears after restore, never enters seen-set;
  unchecked mug → dismissed and absent from the next preview.

### S2 — $0-mug silent filter
- `buildScanPreview`: don’t stage mugs with `amount <= 0`; record their eventKeys (seen-set
  is fine here — they carry no information worth restoring) so they never reappear (fixes B3).
- Tests: $0 mug absent from preview and absent again on rescan.

### S3 — Sales/review checkboxes + uncapped lists + commit honors them
- `buildScanPreviewUi`: remove the ×5/×4/×3 slices; render every sale and review row with a
  checkbox (default checked for sales, matching current import behavior; review rows default
  unchecked as today’s “skipped”). Scroll container for long lists.
- Wire checkbox state through the same pattern as mugs (`syncScanPreviewEdit`), and make
  `confirmScan` import only checked sales; unchecked → `rwth_dismissed` (S1 semantics).
- Tests: unchecked sale not imported and dismissed; sale #6+ renders; commit honors state.

### S4 — Refresh button + “last scanned X ago” + since-last-scan window
- Replace the `scan` → setup-panel → `run-scan` two-step with a single `refresh` action that
  runs `LogScanner.scan()` immediately using saved settings.
- Default cutoff = `MEM.ledger.lastScan` (persist it to a `rwth_`-prefixed store so it
  survives reloads); first run / no lastScan falls back to `scanBackTo` or the current
  default window.
- Render “last scanned X ago” status text near the button (pure helper; export on
  `__RwthPure`).
- Tests: cutoff selection logic (lastScan present / absent / manual override), status text.

### S5 — ⚙ settings popup consolidating entry points
- New popup (modal or anchored panel; match existing shell styling) containing: source
  checkboxes, scan-back-to override, “+ add item” (invokes existing `buildLedgerForm` flow),
  and “paste sale” (relocated `buildSellBox`/`SellParser` flow).
- Remove the standalone “+ add” button and the always-visible “Log a sale” collapsible from
  the tab body. Keep all existing `data-action` handlers working (`add-item`, `parse-sells`,
  `commit-sells`, …) — this is relocation, not rewrite.
- Tests: popup markup contains the relocated affordances; ledger bar no longer renders them.

### S6 — Page-full warning (pagination stretch)
- After each log-type fetch, if the response contains `SCAN_LOG_LIMIT` entries, surface a
  non-blocking warning in the scan results: “<type> hit the 100-log limit — results may be
  incomplete; narrow the window or rescan later.” (Fixes the silent half of B5.)
- Stretch (separate issue, optional): actual pagination by walking `to`-cursors. Any new
  Torn param must be added to `USED` in `tools/gen-api-registry.mjs` + regen
  `docs/api-endpoints.md` (the drift-guard test enforces this).
- Tests: warning fires at exactly the limit, not below.

### S7 — Residual test coverage for confirmScan semantics
- Tests ride along inside S1–S3; this slice sweeps whatever remains of B7 (e.g., mug
  seen-set exclusion invariant, `rwth_seen_wins` legacy conversion, transactions dedupe on
  commit) so `confirmScan`’s contract is pinned end to end.

## 5. Engineering constraints (repo invariants)

- **State:** all mutations through `setState(patch)`; all persisted keys `rwth_`-prefixed;
  new/renamed stores need a one-time migration in `hydrate()`.
- **Pure/impure split (ADR-0002):** new preview/dismissal/window-selection logic goes in
  pure functions, exported on `globalThis.__RwthPure`, tested against the shipped `.user.js`.
- **API registry:** any endpoint/param change goes through `USED` in
  `tools/gen-api-registry.mjs` → `node tools/gen-api-registry.mjs` → drift-guard test green.
- **Versioning:** bump `@version` and `SCRIPT_VERSION` together on every behavior change.
- **Scan debug tooling** (`scanDebug*`, ~27–80) is a drift guardrail — keep it wired through
  any refactored scan path; do not strip.
- Suite must stay fully green: `cd tests && node --test`.

## 6. Non-goals

- Auto-scan on page load or background polling (explicitly out; Refresh stays user-initiated).
- Multi-account support.
- Changing classification/RW-proof gating logic (recently reworked; out of scope here).
- Restyling the ledger table/dashboard beyond the bar and scan panels.

## 7. Verification

- `cd tests && node --test` → 0 fail after every slice.
- Manual: on a live Torn session, run Refresh with a mix of new buys/sales/mugs, uncheck one
  of each, commit; rescan → dismissed rows absent, “Dismissed (N)” lists them, restore one →
  it reappears on the next scan. Confirm a $0 mug never appears, “last scanned X ago”
  updates, and the ⚙ popup’s “+ add” and “paste sale” flows produce identical ledger rows to
  today’s.
