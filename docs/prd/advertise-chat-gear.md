# PRD: Advertise — trade-chat blurb gear (customization + smarter fit)

Status: approved · Audited against `TORN-RW-trading-hub.user.js` v0.3.228 (2026-07-09)
Feeds: `/to-issues` (see "Requirements as vertical slices")
Fast-follow to: `docs/prd/advertise-per-output-gear.md` (this is that PRD's explicit
non-goal — *"Trade-chat gear — the chat blurb is a separate item on the user's notes list"* — now scoped.)

## 1. Problem & goal

The Copy-to-Torn section now gives Forum/Bazaar/Signature each an adapting **gear**
(`buildAdvSurfaceGear`), plus a pricing gear on Items (`buildAdvItemsGear`) and an
options gear on Recent Transactions (`buildAdvTxGear`) — all the same click-toggled
caret-popover pattern. The **trade-chat blurb is the one output with no gear**: it is a
plain quick-copy text strip (`buildOutputBox('Trade-chat blurb', …)` ~5369) sitting
above the surface switcher, and everything about it — which emojis decorate it, whether
prices/bonuses show, which items lead — is **hardcoded** in `AdvertiseGenerator.toChat`
(~4758) and `chatItemLine` (~4225).

Two consequences:

1. **Everyone's blurb mirrors the shipped style.** The header flourish (`🔹🔷 … 🔷🔹`)
   and Floor-Prices marker (`🟢 … 🟢`) are fixed string literals. A trader can't stamp
   their own flavour on the one output that gets pasted into public chat all day.
2. **No control over the price/bonus/item trade-off.** The blurb must fit Torn chat's
   **125 rendered-character** cap. Today `toChat` fits by shedding item *prices*
   cheapest-first, then dropping whole listings into "+N more" — but the user can't say
   "I don't want prices in chat at all," or "always show bonus %," or change what leads.

Goal: give the trade-chat blurb its own gear — same caret-popover pattern as the other
four — carrying (a) **emoji-insert fields** so each user supplies their own decoration
from their keyboard, and (b) **show-price / show-bonus% toggles + a sort choice** that
feed a fit algorithm which **dynamically reduces the number of items shown** to stay
within 125 characters. Consistent with the north star of a sellable script.

## 2. Current-state audit

All line refs are `TORN-RW-trading-hub.user.js` @ v0.3.228 (they will drift; anchor by
function name).

### Where the blurb is built & shown

- **`AdvertiseGenerator.toChat(items, settings)`** (~4758) — pure. Builds the blurb as an
  array of lines joined by `\n`:
  - **Header (2 lines):** `🔹🔷 <u>${shopName}</u> 🔷🔹` and `🟢 <u>Floor Prices</u> 🟢`.
  - **Item lines:** up to `CHAT_LIMIT = 3` (~4783), sorted by `listPrice` **descending**
    (~4790), each via `chatItemLine`.
  - **"+N more listed"** when items remain.
  - **Link lines** (`[Bazaar]` / `[Forum]`, or a single Forum CTA when `markup` is on) —
    **reserved budget, never dropped** (~4776–4780).
- **The fitter** (~4789–4814): `CHAR_LIMIT = 125`; `visibleLen` strips HTML tags and
  counts what's left (so emoji **and** the plain-text `[S]` marker count; HTML like
  `<b>`/`<u>` does not). It walks `shown` from 3→0 and, for each, `dropped` from 0→shown,
  shedding item **prices** from the cheapest listing up; the first assembly ≤125 wins.
- **`chatItemLine(item, withPrice)`** (~4225): `[S] <b>${abbrevName}</b> (${paren}) — <b>${price}</b>`.
  `[S]` is a **fixed 3-char Torn "selling" chat indicator** (not an emoji — leave as-is).
  `paren` is the primary bonus `name value%` (falling back to `quality% q`); `price` is
  `fmtChatPrice(item.listPrice)`. Name abbreviated via `ITEM_ABBREV` (~470).
- **Rendered** at ~5369 as `buildOutputBox('Trade-chat blurb', 'rwth-out-chat', …, true, 3)`
  — a plain editable textarea + Copy button, no gear. `buildOutputBox` (~4914) has a
  `rwth-output-head` (label left, Copy right).

### Item data available to the fitter (no new fetch)

Each selected item already carries: `listPrice`, `bonuses[0].value` (percent),
`quality`, and **`buyTimestamp`** (acquisition epoch ms; used for hold-time math at
~3036). So "sort by oldest" is a sort key already in hand — nothing new to load.

### The pattern to copy

- **Gear builders** `buildAdvSurfaceGear` / `buildAdvTxGear` / `buildAdvItemsGear`
  (~5034–5140): pure, exposed on `__RwthPure`; a `<div class="rwth-adv-gear">` with a
  `rwth-gear-btn` (gets `is-open` + a `●` `rwth-gear-dot` when a setting is active) and a
  `rwth-adv-gear-pop` caret popover, click-toggled via `data-action="toggle-adv-*-gear"`.
- **State:** one boolean per gear in `MEM.ui` (`advSurfaceGearOpen`, `advTxGearOpen`,
  `advItemsGearOpen` ~572–580); toggled in the impure render layer.
- **Persistence:** popover controls bind via `data-adv-*` and commit through
  `syncAdvertiseEdit` (~5625) → `MEM.settings` + `Store.set('rwth_settings', …)` + `render()`
  (see the markup/bazaar-items toggles ~5629–5651). Text fields commit on `change` (blur).
- **Config:** `AdvConfig.resolve(settings)` (~383) is the single resolver; add a `chat`
  block there (like `sections`, `bazaarShowItems`) and read it in `toChat`.

## 3. Design decisions (locked via interview)

1. **A fourth gear, same pattern.** The chat blurb gets its own caret-popover gear on the
   `buildOutputBox` head (Copy stays right; gear goes left, mirroring the tx/surface
   heads). New `MEM.ui.advChatGearOpen` boolean; click-toggled, never `:hover`.
2. **Emoji = user-supplied insert, not a picker.** The decorations become **editable text
   fields** in the gear; the user pastes/types their own emoji from their keyboard, so
   each user's blurb carries their own flavour instead of mirroring the shipped default.
   Two slots (the unambiguous ones):
   - **Header flourish** — wraps the shop name. Default reproduces `🔹🔷` (left) / `🔷🔹`
     (right).
   - **Floor-Prices marker** — default `🟢`.
   Semantics match the forum copy blocks: **untouched → shipped default; explicitly blank
   → that decoration is removed.** `[S]` is **not** exposed (fixed Torn selling tag).
3. **Show-price / show-bonus% are toggles that drive the fit, not just visibility.** Each
   is a ceiling: turning one on requests that content per item; because each toggle adds
   characters per line, **the fitter shows fewer items** to stay ≤125. The toggles never
   *add back* content the user turned off, and the fitter may still shed the cheapest
   listings' prices under pressure (today's behaviour) before dropping listings.
4. **Sort choice — 2 options, no ranking cleverness.** "What rises to the top":
   - **Highest price** (default — reproduces today's `listPrice`-descending order).
   - **Oldest first** — sort by `buyTimestamp` ascending (longest-held → dumping).
   Explicitly **not** bonus-% ranking: raw % isn't comparable across bonus types.
5. **Item count is derived, never user-set.** There is no "feature top N" field. The
   fitter shows as many items as fit given the active toggles/emoji, capped at the
   existing `CHAT_LIMIT` (3), and collapses the rest into "+N more listed".
6. **Byte-for-byte upgrade safety.** With all new settings untouched, `toChat` output is
   **identical** to v0.3.228: emoji defaults reproduce the current literals; sort default
   is highest-price; and the show-price / show-bonus% defaults must reproduce today's
   *shown-when-they-fit* behaviour (see Decision 7).
7. **Default toggle states reproduce today, not a blank slate.** Today prices show when
   they fit and bonuses always show. So the shipped defaults are **show-price ON,
   show-bonus% ON** — the toggles let a user *turn them off*, and the fitter's
   cheapest-first price-shedding still runs underneath the ON state exactly as now.
8. **Live re-render, no save button.** Every control routes through
   `syncAdvertiseEdit` → `Store` → `render()`; the blurb re-renders on each adjustment,
   like every other Advertise control.
9. **Char-count honesty.** The fitter keeps counting via `visibleLen` (strip HTML, count
   the rest), so user-typed emoji and `[S]` count against 125 as they render. Known
   imprecision: multi-code-unit emoji (skin tones/flags/ZWJ) count as 2–4 in JS
   `.length`, and Torn's exact counting of those is unverified — acceptable for v1;
   documented, testable in-game. **Not** a blocker.

## 4. Target model

Chat gear contents (all persist to `rwth_settings`; all default to reproduce v0.3.228):

| Control                         | Type            | Default            | Effect |
| ------------------------------- | --------------- | ------------------ | ------ |
| Header flourish (left / right)  | text input(s)   | `🔹🔷` / `🔷🔹`     | Wraps shop name; blank removes |
| Floor-Prices marker             | text input      | `🟢`               | Wraps "Floor Prices"; blank removes |
| Show price                      | toggle          | **ON**             | Adds price tail per item; fewer items fit |
| Show bonus %                    | toggle          | **ON**             | Adds `(bonus %)` per item; fewer items fit |
| Sort: Highest price / Oldest    | 2-way (radio/select) | Highest price | Order items lead in |

`AdvConfig.resolve` gains a `chat` block, e.g.:

```
chat: {
  headerLeft, headerRight, floorMarker,   // strings; undefined → shipped default, '' → removed
  showPrice,  // s.chatShowPrice !== false  (default ON)
  showBonus,  // s.chatShowBonus !== false  (default ON)
  sort,       // 'price' (default) | 'age'
}
```

`toChat` reads `resolved.chat` instead of the inline literals/flags; `chatItemLine` takes
`showBonus` (drop the paren when off) alongside its existing `withPrice`. The fitter's
sacrifice order becomes: **(1)** shed prices cheapest-first *only while show-price is ON*,
**(2)** drop whole listings → "+N more", with header + links never dropped and bonuses
governed by the toggle (not shed mid-fit in v1 — the toggle is the bonus control).

## 5. Requirements as vertical slices

Each slice is independently shippable, keeps `node --test` green, and bumps `@version` +
`SCRIPT_VERSION` together. New pure helpers must be exported on `__RwthPure`.

- **S1 — Chat gear scaffold + emoji inserts.** Add `MEM.ui.advChatGearOpen` and a
  `buildAdvChatGear(chat, open)` caret popover on the chat `buildOutputBox` head
  (`toggle-adv-chat-gear`). Add the `chat` block to `AdvConfig.resolve` and route
  `toChat`'s header/Floor-Prices decoration through `resolved.chat.headerLeft/Right` +
  `floorMarker` (undefined → shipped default, '' → removed). Wire the text fields through
  `syncAdvertiseEdit` (`data-adv-chat="headerLeft|headerRight|floorMarker"`, commit on
  `change`). Binding test: untouched settings → **byte-identical** blurb; a custom /
  cleared emoji changes / removes exactly that decoration.
- **S2 — Show-price / show-bonus% toggles feeding the fitter.** Add both toggles
  (default ON) to the gear; thread `showPrice` / `showBonus` into `toChat` + `chatItemLine`
  so OFF removes that content and the fitter's derived item count grows/shrinks to stay
  ≤125. Keep the cheapest-first price-shed under the ON state. Tests: OFF-price blurb has
  no `—` price tails and fits more items; OFF-bonus has no parens; ON/ON reproduces today.
- **S3 — Sort choice.** Add the Highest-price / Oldest-first control; sort by `listPrice`
  desc (default) or `buyTimestamp` asc. Test: oldest-first leads with the
  earliest-`buyTimestamp` item; default unchanged.

## 6. Non-goals (explicitly out)

- **Emoji picker / preset styles** — user-supplied insert only.
- **Per-item marker (`[S]`) editing** — it's a fixed Torn selling indicator.
- **Bonus-% or blended ranking** — % isn't cross-bonus comparable; two sort options only.
- **A user-set "feature top N"** — item count is derived by the fitter.
- **A headline stat line** (e.g. "bonuses to X%") — dropped in interview.
- **Exact-match Torn emoji character counting** — `.length`-based `visibleLen` stays; the
  multi-code-unit imprecision is documented, not solved here.

## 7. Constraints / invariants to respect

- **Pure/impure split (ADR-0002).** `toChat`, `chatItemLine`, `AdvConfig.resolve`, and
  `buildAdvChatGear` stay pure and string-returning; popover open/close + click routing
  live in the impure render layer. Export new pure helpers on `__RwthPure`.
- **Single state / single mutation path.** `advChatGearOpen` lives in `MEM.ui`; all
  settings mutate via `syncAdvertiseEdit` → `Store.set('rwth_settings', …)` → `render()`.
  Add a `hydrate()` migration only if a persisted key is renamed (new keys need none —
  absent reads as the shipped default).
- **Versioning:** bump `@version` and `SCRIPT_VERSION` together on every behaviour change.
