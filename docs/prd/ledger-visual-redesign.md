# PRD: Ledger visual redesign — hierarchy, palette & chrome (whole-script)

Status: draft · Audited against `TORN-RW-trading-hub.user.js` v0.3.174 (2026-07-05)
Feeds: `/to-issues` (see "Requirements as vertical slices")
Origin: live-screenshot audit of the Ledger tab on TornPDA after the scan→Refresh
restructure ([[scan-logs-prd]] listed "restyling the ledger table/dashboard" as a
non-goal — this PRD picks up that deferred restyle).

## 1. Problem & goal

The Ledger tab is functionally organized but its **visual hierarchy is inverted and the
palette is over-saturated**, so it reads as loud rather than clean. On a page whose entire
purpose is money:

- The **single loudest element is a utility button** (the solid neon-green `⟳ Refresh`),
  which out-shouts the P/L figure that is the reason the page exists.
- **Two full-intensity neon accents** (green `#39ff14` + cyan `#00e5ff`) compete on every
  element, so nothing recedes and the accent green stops meaning anything.
- **Rarity chips spell the color they already are** ("YELLOW" in a yellow pill) and truncate
  mid-word ("YELL…"), reading as broken.
- **Five stacked chrome bands** sit above the first data row, pushing the ledger itself
  below the fold on a phone.

Goal: the cleanest, most contemporary version of this screen — one dark neutral surface,
cyan as quiet structure, **green reserved for "this is money / this is the action,"** and the
data starting near the top. Equally appealing as it is functional, consistent with the north
star of a sellable script. The collapsed charts/analytics drawer inherits the same rules.

Scope decision (owner, 2026-07-05): **whole-script.** The palette/hierarchy findings are
token-level (`:root`), so fixing them once benefits Ledger, Advertise, and Settings rather
than making Ledger diverge.

Note: the inline-ask clipping, sold-row `age` semantics, and Torn-shorthand input parsing
are **functional bugs split into their own issue**, not part of this design PRD (owner
decision, 2026-07-05). This PRD is the visual pass only.

## 2. Current-state audit

All line refs are `TORN-RW-trading-hub.user.js` @ v0.3.174 (they will drift; anchor by
function / selector name).

### Design system as built

- Two brand tokens at full saturation (`:root` ~6747–6769): `--rwth-accent: #39ff14` (neon
  green) and `--rwth-secondary: #00e5ff` (cyan). **Every** structural border/fill is a
  cyan-alpha ramp (`--rwth-fill-faint #00e5ff0a` … `--rwth-border #00e5ff33` …
  `--rwth-border-bright #00e5ff55`), so the whole chrome glows cyan.
- Green is spent broadly: title, active tab underline, active filter chip fill
  (`.rwth-filter-active` 7048), the primary `.rwth-btn` fill + hover glow (6886–6890), ROI
  positive (`.rwth-roi-pos` 7291).
- Radii mix arbitrarily: `.rwth-ask-edit` 3px, `.rwth-btn` 4px, `.rwth-dash-strip` 6px.

### Findings

| # | Finding | Where |
|---|---------|-------|
| F1 | **Inverted hierarchy.** The filled neon-green `⟳ Refresh` (`.rwth-btn`, solid `--rwth-accent` bg + glow) is the highest-contrast element; the P/L headline renders small in the dash strip (`.rwth-dash-stat b`, 13px). A janitorial action outweighs the number the page exists for. | `buildLedgerTab` 3232–3233; `.rwth-btn` 6886–6890; `.rwth-dash-stat` 7103–7106 |
| F2 | **Two neon accents at full strength.** Green + cyan both run at max saturation simultaneously; all borders are cyan-alpha, so content never leads. Accent green appears in ~6 unrelated roles, diluting its meaning. | `:root` 6747–6769; used throughout |
| F3 | **Rarity chips are noise and truncate.** `.rwth-rarity` renders the color word ("YELLOW") in a pill of that color; `.rwth-row-name`'s ellipsis clips it to "YELL…" when the name cell is narrow. Redundant information that also eats the one flexible column. | chip build in `buildLedgerRow` ~1986 (`rarityChip`); `.rwth-rarity*` 7026–7033; `.rwth-row-name` 7273–7276 |
| F4 | **Five stacked chrome bands before data.** hero strip → filter chips → orphan `held:… listed:… at ask` summary line → sort/refresh/gear row → `last scanned…` line → column header. Ledger starts past mid-screen on a phone. | `buildLedgerTab` 3223–3246; `.rwth-filter-summary` 7043–7047; `.rwth-scan-status` 7005 |
| F5 | **Redundant summary band.** `.rwth-filter-summary` (`held: $602.9m cost / listed: $928m at ask`) restates values that belong on the chips themselves; it floats muted and easy to miss. | `filterSummary` 3183–3190; render 3228 |
| F6 | **Radius / token inconsistency.** 3/4/6px radii applied ad hoc; no shared radius scale token. | `.rwth-ask-edit` 7300, `.rwth-btn` 6886, `.rwth-dash-strip` 7099 |
| F7 | **Column figures read ragged.** Compact `$`-prefixed values vary in width under a right-aligned track, so BUY/ASK/ROI don't form crisp columns; the 9px header labels are near-invisible. | `.rwth-cell-v` 7282–7286; `.rwth-th` 7266–7269; tracks 7258–7261 |

## 3. Decisions

Design direction (owner-approved scope; specific token/markup choices to be pinned per slice):

- **One primary action per view.** Reserve the solid neon-green fill for exactly one primary
  action, and it is *not* Refresh. Refresh becomes a ghost/outline control (the existing
  `.rwth-btn-ghost` already exists, 7090–7093). Promote the P/L figure to the largest,
  greenest thing in the dash strip.
- **Cyan = structure, green = live.** Neutralize the cyan-alpha border ramp toward a near-
  neutral dark (content leads, borders recede); keep cyan for labels/links/secondary text.
  Reserve green for positive P/L and the single primary action so green *means* something.
- **Rarity as a dot, not a word.** Replace the worded pill with a small colored dot before
  the item name (or a thin colored row-edge). Same signal, a fraction of the space, no
  truncation artifact.
- **Collapse the chrome.** Fold each status value into its own chip; remove the standalone
  `.rwth-filter-summary` band. Move `last scanned X ago` inline/right of Refresh (it is that
  button's status), not its own full-width line. Tighten inter-band gaps so the table rises.
- **Consistency pass.** Introduce a 2-step radius scale (6px cards/panels, 4px inline
  controls) as tokens and apply it. Align numeric columns on a consistent unit so BUY/ASK/ROI
  read as clean columns; give the header labels a touch more contrast.
- **Charts/analytics inherit.** The collapsed dashboard drawer follows the same rules: 6px
  card radius, neutralized borders, green only on the hero/positive number (the hero already
  uses `--rwth-accent` for the realized series and muted for projected — carry that
  restraint into the cards), cyan for axis/labels. The `.rwth-dash-toggle` / `▶ CHARTS`
  disclosure reads as a quiet chevron row, not a bordered button competing with Refresh.

## 4. Requirements as vertical slices

Ordered for `/to-issues`; each slice is independently shippable and leaves the suite green.
This is CSS/markup — assertions are largely structural (class presence, token wiring, no
worded rarity text); anything pure (e.g. a rarity→dot mapping helper) is exported on
`globalThis.__RwthPure` and unit-tested.

### D1 — Palette foundation: neutralize borders, add radius tokens
- `:root`: retune the cyan-alpha border ramp toward a near-neutral dark; keep cyan for
  text-level secondary. Add `--rwth-radius-card` (6px) / `--rwth-radius-ctl` (4px) tokens and
  point existing `.rwth-*` radii at them.
- Whole-script: this changes Advertise + Settings chrome too — eyeball all three tabs.
- Tests: token declarations present; no raw `#00e5ff33`-style border literals reintroduced in
  the touched selectors (light guard, optional).

### D2 — Hierarchy: demote Refresh, promote P/L
- Refresh → ghost/outline (`.rwth-btn-ghost` styling); drop the solid-green fill + glow from
  this control. Keep it obviously tappable (≥30px target).
- Dash strip: make the P/L stat the visual lead — larger weight/size, green when positive
  (reuse `--rwth-accent`), the loudest thing in the strip.
- Tests: Refresh markup carries the ghost class; P/L stat carries the lead/positive class.

### D3 — Rarity dot replaces the worded pill
- `rarityChip` (~1986) → a colored dot element before the name (map rarity→color via a small
  pure helper on `__RwthPure`); remove the color *word* from the chip. Keep the existing
  `--rwth-rarity-*` colors as the dot palette.
- `.rwth-row-name` truncation now ellipses only real text, never a chip.
- Tests: row markup contains a rarity-dot with the right modifier class and **no** literal
  "YELLOW/ORANGE/RED/WHITE" text; helper maps each rarity to its color.

### D4 — Collapse chrome bands (summary → chips, inline last-scanned)
- Remove the `.rwth-filter-summary` band; fold each status' value into its chip as a subtitle
  (`chipMeta` already carries `value`/`suffix`, 3172–3177).
- Move `formatLastScanned` output inline/right of the Refresh control instead of the
  standalone `.rwth-scan-status` line; tighten `buildLedgerTab` inter-band spacing.
- Tests: no `.rwth-filter-summary` element; chip markup carries its value; last-scanned text
  renders in the actions row.

### D5 — Column alignment + header contrast
- Align BUY/ASK/ROI on a consistent unit (e.g. drop the repeated `$` or fixed-width the
  numeric portion) so the three tracks read crisp under the shared grid (7258–7261).
- Bump `.rwth-th` contrast now it's the only label line.
- Tests: structural (class/track) — largely eyeballed live per the ChartGeom precedent.

### D6 — Charts/analytics drawer inherits the system
- Apply D1 radii/borders + D2 green-discipline to `buildLedgerDashboard` cards and the hero
  block; make `.rwth-dash-toggle` a quiet chevron row matching chip styling.
- Tests: drawer/card markup uses the shared radius tokens; toggle no longer carries the
  bordered-button styling.

## 5. Engineering constraints (repo invariants)

- **Pure/impure split (ADR-0002):** any new mapping logic (rarity→color/dot) is a pure
  function exported on `globalThis.__RwthPure` and tested against the shipped `.user.js`.
- **State:** no state-shape changes expected; if any, mutate only via `setState(patch)` and
  `rwth_`-prefix + migrate any persisted key in `hydrate()`.
- **Tokens are the single source of color/spacing** (`:root` note ~6735–6743): change the
  token, not the call sites; keep the "swap `--rwth-accent` and nothing else breaks" property.
- **Versioning:** bump `@version` and `SCRIPT_VERSION` together on every slice.
- **No API/registry surface** touched by this PRD.
- Suite must stay fully green: `cd tests && node --test`.

## 6. Non-goals

- The three functional bugs (inline-ask clipping / compact-money display, sold-row `age` →
  time-to-sell, Torn-shorthand input parsing) — **separate bug issue**, ships independently.
- Re-laying-out the tab structure or column *sets* (`COLUMN_SETS`) — this is a look pass, not
  an information-architecture change.
- Advertise/Settings-specific redesign beyond what the shared-token changes carry through.
- Theming/light mode or user-configurable palettes.

## 7. Verification

- `cd tests && node --test` → 0 fail after every slice.
- Manual (live TornPDA + desktop panel): the P/L figure is the first thing the eye lands on;
  Refresh reads as secondary; no worded/truncated rarity chip; the ledger's first data row
  sits materially higher; Advertise + Settings tabs still look coherent under the retuned
  tokens; the charts drawer matches the new system. Compare against the origin screenshot.
