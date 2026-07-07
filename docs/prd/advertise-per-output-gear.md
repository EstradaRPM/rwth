# PRD: Advertise — per-output settings gear + bazaar item listings

Status: approved · Audited against `TORN-RW-trading-hub.user.js` v0.3.198 (2026-07-06)
Feeds: `/to-issues` (see "Requirements as vertical slices")

## 1. Problem & goal

The Advertise tab is a vertical stack of five peer accordions — **Items to advertise**,
**Copy to Torn**, **Brand & look**, **Post text**, **Recent transactions**. The one job
that is inherently a tight loop — *tune how the ad looks* — is spread across three
non-adjacent sections: markup lives in *Items*, colours/identity in *Brand & look*, wording
in *Post text*, while the thing that tells you whether it worked (the live preview) sits in
a fourth, *Copy to Torn*. So every adjustment is a scroll round-trip: edit down in section
3/4, scroll up to the preview in section 2, scroll back. **The controls are spatially
decoupled from the output they change.** That is the clunk.

A second, felt-everywhere gap surfaced while scoping this: **the tool does not acknowledge
actions confidently** — clicking things (the settings wheel especially) gives no clear
"that registered, and here's what it belongs to" reaction.

Goal: collapse the "look" controls next to the output they shape, so tuning is *edit → see*
in one place, and give each surface a settings **gear** that adapts to show only what that
surface actually renders. Split cleanly into a **universal** store/brand layer (edit once,
applies everywhere) and a **per-output** gear (the adaptive, surface-specific layer).
Consistent with the north star of a sellable script.

Bundled with this because it is a genuine per-surface control: an **opt-in option to list RW
items in the bazaar advert** (today the bazaar is brand copy only).

## 2. Current-state audit

All line refs are `TORN-RW-trading-hub.user.js` @ v0.3.198 (they will drift; anchor by
function name).

### Layout map

`buildAdvertiseTab` (~4734) returns five stacked `rwth-adv-section` accordions (~5013–5035),
each headed by `collapseHead(...)` with fold state in `mem.ui.collapsed`:

1. **Items to advertise** (`advItems`) — item selection, per-item price/image rows
   (`buildAdvItemRow`), and the **markup** toggle + mug sub-toggle (`itemsBody` ~4841).
2. **Copy to Torn** (`advOutputs`) — the trade-chat text strip + a Forum/Bazaar/Signature
   **surface switcher**; only the active surface renders (`activeSurface` ~4814, `outputsBody`
   ~4967–5007). One output visible at a time.
3. **Brand & look** (`brandLook`) — shop name/tagline, forum + weav3r links, theme preset,
   colour swatches, shared banner + per-surface picture overrides (`brandBody` ~4851).
4. **Post text** (`postText`) — the four copy blocks + locations checkboxes + availability
   override (`postBody` ~4911).
5. **Recent transactions** (`advTx`) — add/edit transaction rows + "show in forum post"
   toggle (`txBody` ~4954).

### Config model — what is shared vs per-surface

`AdvConfig.resolve(settings)` (~376) is the single resolver. Its output shows the split:

- **Shared (one stored value, consumed by multiple surfaces):** `identity` (shopName,
  tagline), `theme` (themeKey + colour tokens + `themeOverrides`), `copy` (subBanner, intro,
  alsoRotating, footerTagline), `sections.transactions`, `locations` → `availability`,
  `markup` / `mugMarkup`.
- **Genuinely per-surface (today):** `images` — `forumImageUrl` / `bazaarImageUrl` /
  `signatureImageUrl`, each falling back to the shared `bannerImageUrl` (~422–436).

### What each output actually renders (drives gear adaptivity)

Mapped from the three generators:

- **Forum** (`toForumHtml` ~4356) — shop name, theme, **all four copy blocks**, availability
  line, transactions, forum image, links. *The only surface that renders the copy blocks.*
- **Bazaar** (`toBazaarHtml` ~4427) — shop name + tagline, theme, bazaar image, links.
  **Body text is hardcoded** ("RW Gear — top tier weapons/bonuses…" ~4449); the copy blocks
  do nothing here. No item list.
- **Signature** (`toSignatureHtml` ~4479) — shop name, theme, availability line, signature
  image, links, compact per-item cards (`sigItemCard`). No copy blocks, no transactions.
- **Trade-chat** (`toChat` ~4535) — shop name, markup, links. Plain text, no styling.

## 3. Design decisions (locked via interview)

1. **One output at a time, single adapting gear.** Keep the Forum/Bazaar/Signature switcher;
   only the active surface renders. A single gear hangs off the switcher and re-adapts to the
   active surface. *Not* all three outputs on screen at once.
2. **Theme/store settings are universal.** Editing theme/colours/identity applies to every
   surface — one brand look. Per-surface theme overrides are **out of scope**. "Adapt per
   output" means *which controls the gear shows*, never *different stored values*.
3. **Two homes, cleanly split:**
   - **Universal "Store & brand" section** (one section on the Advertise tab — replaces the
     *Brand & look* + *Post text* two-accordion split): shop name, tagline, forum + weav3r
     links, theme preset, colour swatches + reset, shared banner image, **locations +
     availability override** (shared; feed both forum and signature availability lines).
   - **Per-output gear** (the adaptive layer, anchored on the surface switcher):
     - **Forum gear:** sub-banner, intro, also-rotating note, footer tagline (the four copy
       blocks); forum picture override.
     - **Bazaar gear:** "Show my RW items on this advert" toggle (new, default **off**);
       bazaar picture override.
     - **Signature gear:** signature picture override. *(Intentionally thin — a signature is
       otherwise pure universal theme+identity+availability. The gear adapts; sometimes there
       is little to adapt. Not padded.)*
4. **Markup stays in Items — it is a pricing control, not a look control.** The user reads the
   marked-up item-market price *while listing items on the market*, so the toggle and the
   per-row reference price must stay with the item rows. The gear never swallows it.
5. **Recent transactions stays its own section** (data entry, like Items) — its "show in
   forum post" toggle stays with the data rather than being split into the forum gear.
6. **Picture overrides move** from today's "advanced" collapse in *Brand & look* into the
   per-surface gears — a per-surface image is the definition of a per-surface control.
7. **Interaction — caret popover, click-toggled:** the gear opens a floating panel with a
   caret pointing at the gear icon; the gear itself flips to a visible open/active state. It
   is **click**-toggled (not `:hover`), so it does not reintroduce the mobile tap-stick class
   of bug (cf. v0.3.194).
8. **Overlap is accepted — "tweak → close → review."** The popover may cover the preview
   while open on the narrow single-column panel. The preview still re-renders live on every
   edit, so the result is already correct the instant the popover closes. No requirement to
   keep the full preview visible *while* the popover is open.
9. **Changes persist immediately on adjustment — no save button.** Every gear control routes
   through the existing `setState` → `Store` (localStorage) path; there is no separate save
   step. (Already the model; the gear must preserve it.)
10. **Confident-reaction requirement (tool-wide intent, applied here first):** every
    interactive control gives a clear, visible reaction — pressed/active/open state. The gear
    springing a caret popover and flipping to an active state is the first application.

### Bazaar RW-item listings

- **Opt-in, default off** — every existing user's bazaar output is unchanged byte-for-byte on
  update. Surfaced as the bazaar gear toggle.
- **Compact `sigItemCard`-style cards**, under an "Also available — RW gear" divider — the
  same compact catalogue format the profile signature already uses. No new card style; the
  forum's image-bearing cards are too heavy for a bazaar description column.
- **Same selected set + same markup** as every other surface — one selection, one price basis,
  three renderings. No independent bazaar selection.
- Bazaar body copy stays **hardcoded** for this PRD (see Non-goals).

## 4. Target model

Advertise tab collapses from five accordions to four:

```
Items to advertise        (unchanged — incl. markup pricing control)
Copy to Torn              (surface switcher + per-output GEAR + live preview)
Store & brand             (NEW — the universal edit-once layer)
Recent transactions       (unchanged)
```

Gear contents by active surface:

| Control                        | Forum | Bazaar | Signature | Home if not in gear |
| ------------------------------ | :---: | :----: | :-------: | ------------------- |
| Sub-banner / intro / also-rotating / footer copy | ✅ | — | — | — |
| Picture override (this surface)| ✅ | ✅ | ✅ | — |
| Show RW items on advert (new)  | — | ✅ | — | — |
| Shop name / tagline / links    | — | — | — | Store & brand (universal) |
| Theme / colours / banner       | — | — | — | Store & brand (universal) |
| Locations / availability       | — | — | — | Store & brand (universal) |
| Markup (+ mug)                 | — | — | — | Items (pricing) |
| Transactions add/edit + toggle | — | — | — | Recent transactions |

## 5. Requirements as vertical slices

Each slice is independently shippable, keeps `node --test` green, and bumps `@version` +
`SCRIPT_VERSION` together.

- **S1 — Consolidate the universal layer.** Merge *Brand & look* + *Post text* shared fields
  (identity, links, theme, colours, banner, locations, availability) into one **Store &
  brand** section. Pure layout move, no behaviour or output change; existing binding tests
  stay green.
- **S2 — Gear scaffold + affordance.** Add the gear button on the surface switcher, a
  click-toggled caret popover with open/active state, and the "confident reaction" styling.
  Popover initially carries the active surface's picture override (moved out of the *Brand &
  look* advanced collapse). Persists via `setState`/`Store` on adjustment.
- **S3 — Forum gear adaptivity.** Move the four copy blocks into the forum gear; make the
  gear render only the controls the active surface consumes (empty/absent where a surface
  renders nothing extra).
- **S4 — Bazaar RW-item listings.** Add the default-off bazaar toggle; extend `toBazaarHtml`
  to render compact `sigItemCard` cards under an "Also available — RW gear" divider when on,
  using the shared selected set + markup. Add a binding test asserting default-off output is
  unchanged and on-output includes the cards.

## 6. Non-goals (explicitly out)

- **Per-surface theme overrides** — theme stays universal (possible later).
- **All three outputs visible at once** — one-at-a-time switcher stays.
- **Independent bazaar item selection** — shared set only.
- **Trade-chat gear** — the chat blurb is a separate item on the user's notes list.
- **Editable bazaar body copy** — the hardcoded pitch line stays; a natural fast-follow once
  the bazaar gear exists, but not in this PRD.

## 7. Constraints / invariants to respect

- **Pure/impure split (ADR-0002).** Generators, `AdvConfig`, and builders stay pure and
  string-returning; the popover open/close and click routing live in the impure `render`
  layer. New pure helpers must be exported on `__RwthPure`.
- **Single state / single mutation path.** Gear state (which popover is open) lives in
  `MEM.ui`; all mutation via `setState`. Persisted fields keep the `rwth_`-prefixed `Store`
  path; add a `hydrate()` migration if any persisted key is renamed.
- **Versioning:** bump `@version` and `SCRIPT_VERSION` together on every behaviour change.
