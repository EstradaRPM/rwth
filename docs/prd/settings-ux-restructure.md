# PRD: Settings tab — UX restructure (required-ness × locality)

Status: draft · Audited against `TORN-RW-trading-hub.user.js` v0.3.233 (2026-07-10)
Feeds: `/to-issues` (see "Requirements as vertical slices")
Sibling pattern: `docs/prd/advertise-per-output-gear.md` + `docs/prd/advertise-chat-gear.md`
(the caret-popover **gear** this PRD borrows for the surface-local settings).

## 1. Problem & goal

The Advertise tab converged on a clean model: a control lives **next to the thing it
changes**, hidden behind a click-toggled **gear** (`buildAdvSurfaceGear` /
`buildAdvTxGear` / `buildAdvItemsGear` / `buildAdvChatGear`, all sharing the
`.rwth-adv-gear` caret popover), and a `●` `rwth-gear-dot` signals at a glance which
surfaces carry a non-default. Clean at rest, contextual on demand, self-labeling.

The **Settings tab is built on the opposite philosophy** and is on the wrong side of it
for most of its contents. `buildSettingsTab` (~4159) renders `SETTINGS_SCHEMA` (~3843) as
**five equally-weighted collapsible sections** via `collapseHead` (~907), every field's
help text always visible (`renderSettingField` ~3921), mixing five *different kinds* of
setting as if they were the same weight:

- **Required setup** — `setAccount`: Player ID + Torn API key.
- **Optional surface plumbing** — `setReach`: one view-counter URL.
- **Global tuning** — `setPricing`: 2 toggles + 2 numbers + 1 default toggle.
- **Power-user data** — `setAdvanced`: three free-text list editors.
- **Dev tools** — `setDiag` (console-only weav3r test) + a red "Clear all data (testing)"
  wipe button (~4175).

The signature failure mode is **presenting derived/dependent things as primary inputs**,
and **flattening a real hierarchy into "five sections, all the same."** The canonical
example: the **Player ID field renders first**, above the API key — yet it is
`lockWhenKey` (~3848) and is **auto-filled by the key's Test button** (`test-key`, the
inline status at ~3938 writes it). So the one field the user cannot meaningfully fill
by hand is presented as step one, as a full text input with an `e.g. 1234567` placeholder,
while the actual gate (the key) sits second — and the causal link between them is
invisible in the layout.

Goal: restructure Settings so each control's **home matches its required-ness × locality**
— required setup becomes a guided card, surface-local optional settings migrate to gears,
global tuning gets real effect-affordances, power-user data gets a validated structured
editor, and dev/destructive tools move behind a Developer disclosure. Consistent with the
north star of a sellable script.

## 2. Current-state audit

All line refs are `TORN-RW-trading-hub.user.js` @ v0.3.233 (they will drift; anchor by
function name).

### The tab shell
- **`buildSettingsTab(mem)`** (~4159): maps `SETTINGS_SCHEMA` → one
  `.rwth-settings-section` per entry, each headed by `collapseHead(title, key, collapsed,
  true)` (bleed variant, ~907), body built by `renderSettingField` per field. Fold state
  is `MEM.ui.collapsed[sec.key]`. A trailing `.rwth-settings-actions` holds the
  **`data-action="clear-data"`** danger button (~4175 → `clearAllData` ~5680).
- **`renderSettingField(f, s, intel, ui)`** (~3921): the single field-type → HTML site.
  Types: `text`/`url`/`password`, `image` (button + URL popover, `settingsImgEdit`),
  `number`, `toggle` (binds `data-setting` or dotted `data-intel` path), `textarea`,
  `action`. Help text (`f.help`) always renders under the field.
- **Persistence:** no save button. `data-setting` / `data-intel` fields commit through
  `persistSettingField` (~6072), wired on the delegated `change` listener (~5707). The
  API-key Test (`test-key`) and Player-ID lock (`syncKeyLock`) are the only fields with
  live feedback.

### The five sections, as they stand (`SETTINGS_SCHEMA` ~3843)
1. **`setAccount` "Your Torn account"** — `playerId` (text, `lockWhenKey`) **then** `apiKey`
   (password, `testable`). Test validates the key against Torn v2 `/user` and back-fills
   the ID; `hasRealApiKey` (~4027) is the canonical key gate; the ID field goes `readonly`
   with a "Filled in from your API key" note (~3929) while a real key is present.
2. **`setReach` "Post reach tracking"** — a single `viewCounterUrl` (url). The section
   comment (~3856) records that the content links + pictures **already moved to Advertise**;
   only this plumbing "stayed in Settings." It is an orphan; the URL feeds `counterPixel`
   (~4051), which is appended to the Advertise forum/bazaar/signature output.
3. **`setPricing` "Pricing brain"** — `enabled.auction` (toggle), `enabled.ledger` (toggle),
   `mugBuffer` (number %, feeds the Advertise item-market mug markup at ~5312 too),
   `marginTarget` (number %), `qualityClampDefault` (toggle). Governs the auction/ledger
   experience but is set in a third tab.
4. **`setAdvanced` "Advanced lists"** — three textareas: excluded bonuses
   (`fmtTrashList`/`parseTrashList`), bonus-change dates (`fmtBonusChangeDates` ~4076 /
   `parseBonusChangeDates` ~4081 — **silently drops** any line not matching
   `bonus: YYYY-MM-DD`), and similar-item groups (`fmtSimilarBases` ~4097 /
   `parseSimilarBases` ~4103). Each serializer **merges the in-code seed with the user's
   overrides into one blob**, so shipped defaults and user edits are visually
   indistinguishable and the "which lines actually persisted" answer is invisible.
5. **`setDiag` "Diagnostics"** — `smoke-weav3r` action (~3903 → `smokeWeav3r` ~4184) whose
   result is **`console.log` only**; no on-screen outcome.

### The pattern to borrow (Advertise gears)
- `buildAdvSurfaceGear`/`buildAdvTxGear`/`buildAdvItemsGear`/`buildAdvChatGear`
  (~5101–5270): pure, exposed on `__RwthPure`; `<div class="rwth-adv-gear">` → a
  `rwth-gear-btn` (`is-open` while open, `●` `rwth-gear-dot` when non-default) + a
  `rwth-adv-gear-pop` caret popover, click-toggled via `data-action="toggle-adv-*-gear"`.
- **State:** one boolean per gear in `MEM.ui` (near `settingsImgEdit` ~592), toggled in
  the impure render layer (`toggleAdvGear` ~6246).
- **Popover ceiling:** `.rwth-adv-gear-pop` is `width: 230px`, `max-height: min(60vh,
  420px); overflow-y:auto` (~8726). This is the hard constraint that decides what may and
  may **not** move into a gear (see §3.2).

## 3. Design principle & decisions

### 3.1 The rule
**Match each control's home to its required-ness × locality.** A setting that is *required*
must be discoverable and show its own dependency chain; a setting that is *optional and
local to one surface* belongs on a gear next to that surface; *global tuning touched often*
belongs in a clean labeled Settings section with an effect affordance; *power-user data*
belongs in a structured editor with room to breathe; *dev/destructive* tooling belongs
behind an explicit disclosure, not shipped inline.

| Kind | Today | Target home |
| ---- | ----- | ----------- |
| Required setup (key → identity) | `setAccount`, key-second, ID as primary input | **Guided connection card** at top of Settings; key-first, identity as a confirmed chip |
| Optional surface-local (reach URL) | `setReach` section | **Gear** on the Advertise surface it feeds |
| Global tuning (pricing) | `setPricing` flat mix | Restructured Settings section (grouped, effect-aware) |
| Power-user data (3 lists) | `setAdvanced` raw textareas | **Structured editor** in Settings: validation + seed/override split |
| Dev / destructive (weav3r test, wipe) | `setDiag` + inline red button | **Developer disclosure**, gated, real confirm |

### 3.2 Locked decisions
1. **Key-first connection card.** `setAccount` becomes a prominent, non-fold **connection
   card** at the top of the tab. The **API key input comes first** with its inline Test +
   a *persistent* status (valid / invalid / untested), not just the ephemeral aria-live
   span. **Player ID is demoted to a confirmed-identity chip** rendered *beneath* the key
   — "✓ Signed in as `<name>` [`<id>`]" when Test has resolved — that only degrades to a
   manual ID **input** when there is no real key (`hasRealApiKey` false) or Test failed.
   This makes the key → identity dependency visible and kills the backwards ordering.
2. **Reach URL migrates to a gear.** `viewCounterUrl` leaves Settings and joins the
   Advertise surface it feeds (behind an existing/nearby gear, e.g. the surface gear),
   with the `●` dot lighting when a counter is configured. `setReach` is **deleted**.
   `counterPixel` already reads `settings.viewCounterUrl` — no plumbing change, only where
   it is edited.
3. **Pricing stays in Settings, regrouped + effect-aware.** Split `setPricing` into two
   visible groups: **"Where suggestions show"** (`enabled.auction`, `enabled.ledger`) and
   **"How they're tuned"** (`mugBuffer`, `marginTarget`, `qualityClampDefault`). The two
   number fields gain a **live effect echo** (a short computed sentence beside the input,
   e.g. "a $10m buy needs to clear ~$11.5m") instead of a bare box. *(Stretch, non-blocking
   for v1: a mirror on/off gear on the ledger/auction surface so the toggles are reachable
   in context — out of scope unless cheap.)*
4. **Advanced lists → structured, honest editor.** Keep the lists in Settings (they do not
   fit a 230px popover). Add, per editor: **inline validation feedback** (e.g. "3 rules
   saved · 1 line ignored") so a malformed `bonus: YYYY-MM-DD` line no longer vanishes
   silently, and a **visual seed-vs-yours split** so shipped defaults are labeled distinct
   from user overrides. Underlying `parse*`/`fmt*` semantics unchanged; this is a presentation
   + feedback layer over them.
5. **Dev tools behind a Developer disclosure.** `smoke-weav3r` and `clear-data` move into a
   collapsed **"Developer"** drawer, default folded. The weav3r test gets an **inline
   status** (reuse the `rwth-key-test-status` pattern) so its result is visible without
   devtools. `clear-data` keeps its danger styling but gains a **typed/explicit confirm**
   and is relabeled to its real intent ("Reset hub — wipe all stored data"); the "(testing)"
   label goes.
6. **No save button, live re-render — preserved.** Every migrated/added control keeps the
   existing commit path (`persistSettingField` for Settings fields; `syncAdvertiseEdit`
   for the reach URL once it is a gear control) → `Store` → `render()`.
7. **Byte-for-byte data safety.** No stored key changes meaning; no field is dropped, only
   relocated/represented. `hydrate()` migrations only if a persisted key is renamed (none
   currently needs it — the reach URL keeps its `viewCounterUrl` key, just edited elsewhere).

## 4. Requirements as vertical slices

Each slice is independently shippable, keeps `node --test` green, and bumps `@version` +
`SCRIPT_VERSION` together. New pure helpers must be exported on `__RwthPure`.

- **S1 — Connection card (key-first + identity chip).** Lift `setAccount` out of the
  generic section loop into a dedicated `buildConnectionCard(s, ui)` at the top of
  `buildSettingsTab`. API-key input + Test first, with a persistent status derived from
  `hasRealApiKey` + last Test result; Player ID rendered as a confirmed chip, degrading to
  a manual input only when no real key / Test failed. Keep the `test-key` / `syncKeyLock`
  wiring. Tests: with a real key the ID renders as a read-only chip (no primary input);
  with no key the manual ID input returns; Test still back-fills. Pure builder on
  `__RwthPure`.
- **S2 — Reach URL → Advertise gear; delete `setReach`.** Remove the `setReach` schema
  entry; surface `viewCounterUrl` as a control in an Advertise gear (bind via `data-adv-*`
  → `syncAdvertiseEdit`, or `data-setting` if kept on `persistSettingField`), with the `●`
  dot when set. Test: `counterPixel` output unchanged for a given stored URL; Settings no
  longer renders the reach section; editing the URL in Advertise persists and re-renders.
- **S3 — Pricing regroup + effect echo.** Within `setPricing`, split into the two labeled
  groups and add the computed effect sentence beside `mugBuffer` / `marginTarget` (pure
  helper, e.g. `pricingEffectHint(field, value)` on `__RwthPure`). Test: echo text tracks
  the input value; toggles/numbers still persist via `persistSettingField`.
- **S4 — Advanced lists validation + seed/override split.** Wrap each of the three editors
  with a parse-result summary ("N saved · M ignored") computed from the existing `parse*`
  functions, and render the in-code seed distinctly from user overrides. Pure helpers on
  `__RwthPure`. Test: a malformed bonus-change line reports "1 ignored" instead of
  vanishing silently; a seed line is visually flagged as shipped.
- **S5 — Developer drawer (weav3r inline result + safer wipe).** Move `smoke-weav3r` +
  `clear-data` into a collapsed "Developer" section; give the weav3r test an inline status
  span; gate the wipe behind an explicit confirm and relabel it. Test: the drawer is folded
  by default; the wipe requires the confirm before `clearAllData` runs.

## 5. Non-goals (explicitly out)

- **Rewriting the three list editors as chip/row widgets** — v1 keeps textareas + adds a
  validation/seed-split layer only; a full structured widget is a later PRD.
- **Moving the pricing toggles fully onto ledger/auction gears** — the mirror gear is at
  most a cheap stretch in S3, not a committed deliverable.
- **A settings search box, per-field reset-to-default, or a save/undo model** — out of scope.
- **Any change to stored key names or the `AdvConfig`/pricing math** — this PRD relocates
  and re-presents controls; it does not change what a stored value means.
- **Removing the `clear-data` capability** — it is gated + relabeled, not deleted (still
  needed for support/reset).

## 6. Constraints / invariants to respect

- **Pure/impure split (ADR-0002).** New builders (`buildConnectionCard`, effect-hint and
  validation-summary helpers) stay pure and string-returning; open/close + click routing +
  Test/wipe side effects stay in the impure render layer. Export new pure helpers on
  `__RwthPure`.
- **Single state / single mutation path.** Any new UI-open flags live in `MEM.ui` beside
  `settingsImgEdit` (~592); all settings mutate via `persistSettingField` /
  `syncAdvertiseEdit` → `Store` → `render()`. Add a `hydrate()` migration only if a
  persisted key is renamed.
- **Schema-driven where it still fits.** S3/S4 should stay expressible through
  `SETTINGS_SCHEMA` + `renderSettingField` (extend the field vocabulary rather than
  hand-rolling markup) so the "add a field = add data" property survives; S1 and S5 are the
  intentional exceptions that break out of the generic loop.
- **Versioning:** bump `@version` and `SCRIPT_VERSION` together on every behaviour change.
