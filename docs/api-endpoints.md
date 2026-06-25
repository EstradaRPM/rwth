<!-- GENERATED FILE — do not hand-edit the Torn tables below.
     Regenerate with:  node tools/gen-api-registry.mjs
     Source of truth:  docs/api/torn-openapi.json (Torn API v6.0.0, OpenAPI 3.1.0) -->

# API endpoint registry

The **unequivocal record** of every API this project talks to, with the *full*
parameter surface each endpoint allows — not just the params we currently send.
"We send ✅" marks what the code uses today; everything else is available to use
without asking.

There are three data sources (ADR-0003):

| Source | Base URL | Auth | Spec |
|---|---|---|---|
| **Torn API v2** | `https://api.torn.com/v2` | `key=` query param | machine-readable — [`docs/api/torn-openapi.json`](api/torn-openapi.json) |
| **Supabase (PostgREST)** | `https://kozewwpyssyzuyksnoqu.supabase.co/rest/v1` | `apikey`+`Authorization` headers | PostgREST grammar (below) |
| **Weav3r** | `https://weav3r.dev/api` | none | third-party, no spec (empirically documented) |

> **The full Torn surface lives in [`docs/api/torn-openapi.json`](api/torn-openapi.json)** —
> all 205 paths, every parameter, every enum. The tables here are the
> curated fast-path for the endpoints we actually call. For any Torn endpoint or
> param not listed here, that JSON is authoritative; never guess and never ask.
>
> Quick lookup, e.g. params for one path:
> ```bash
> node -e 'const s=require("./docs/api/torn-openapi.json");const p=s.paths["/market/{id}/itemmarket"].get;for(const r of p.parameters){const x=r.$ref?r.$ref.split("/").pop():r.name;console.log(x)}'
> ```

---

## Torn API v2 — endpoints we call

Every Torn call carries `key=` (the user's API key) and almost all carry a
`comment=` tag identifying the call site. `key`/`comment`/`timestamp` are
universal query params on essentially every endpoint.

### `GET /v2/user`

API-key validation (comment=rwth-test).

| Param | In | Req | Type / enum | We send |
|---|---|---|---|---|
| `selections` | query | no | array<UserSelectionName> |  |
| `id` | query | no |  |  |
| `legacy` | query | no | array<UserSelectionName> |  |
| `limit` | query | no | integer |  |
| `from` | query | no | integer |  |
| `to` | query | no | integer |  |
| `sort` | query | no | string (DESC, ASC) |  |
| `cat` | query | no |  |  |
| `stat` | query | no | array<PersonalStatsStatName> |  |
| `filters` | query | no | string (incoming, outgoing, ownedByUser, ownedBySpouse) |  |
| `striptags` | query | no | string (true, false) |  |
| `offset` | query | no | integer |  |
| `timestamp` | query | no |  |  |
| `comment` | query | no | string | ✅ |
| `key` | query | no | string | ✅ |

### `GET /v2/user/{id}/basic`

buyer id → name (comment=rwth-buyer).

| Param | In | Req | Type / enum | We send |
|---|---|---|---|---|
| `id` | path | yes | UserDiscordPathId |  |
| `striptags` | query | no | string (true, false), default true |  |
| `timestamp` | query | no |  |  |
| `comment` | query | no | string | ✅ |
| `key` | query | no | string | ✅ |

### `GET /v2/user/log`

ledger scan (comment=rwth-scan; we also append `_` cache-buster, which is NOT a spec param).

| Param | In | Req | Type / enum | We send |
|---|---|---|---|---|
| `log` | query | no | array<LogId> | ✅ |
| `cat` | query | no | LogCategoryId |  |
| `target` | query | no | UserId |  |
| `limit` | query | no | integer, default 20 | ✅ |
| `to` | query | no | integer |  |
| `from` | query | no | integer | ✅ |
| `timestamp` | query | no |  |  |
| `comment` | query | no | string | ✅ |
| `key` | query | no | string | ✅ |

### `GET /v2/torn/items`

item dictionary (type/sub_type/name; comment=rwth-items).

| Param | In | Req | Type / enum | We send |
|---|---|---|---|---|
| `cat` | query | no | TornItemCategory = All, Alcohol, Armor, Artifact, Book, Booster, Candy, Car, Clothing, Collectible, Defensive, Drug, Energy Drink, Enhancer, Flower, Jewelry, Material, Medical, Melee, Other, Plushie, Primary, Secondary, Special, Supply Pack, Temporary, Tool, Unused, Weapon |  |
| `sort` | query | no | string (DESC, ASC), default ASC |  |
| `timestamp` | query | no |  |  |
| `comment` | query | no | string | ✅ |
| `key` | query | no | string | ✅ |

### `GET /v2/torn/{id}/itemdetails`

per-instance quality/bonuses/rarity.

| Param | In | Req | Type / enum | We send |
|---|---|---|---|---|
| `id` | path | yes | ItemUid |  |
| `timestamp` | query | no |  |  |
| `comment` | query | no | string |  |
| `key` | query | no | string | ✅ |

### `GET /v2/torn/logtypes`

logtype-id validator (comment=rwth-logtypes).

| Param | In | Req | Type / enum | We send |
|---|---|---|---|---|
| `timestamp` | query | no |  |  |
| `comment` | query | no | string | ✅ |
| `key` | query | no | string | ✅ |

### `GET /v2/market/{id}/itemmarket`

live market comps & BB engine (comment=rwth-comps / rwth-bb).

| Param | In | Req | Type / enum | We send |
|---|---|---|---|---|
| `id` | path | yes | ItemId |  |
| `bonus` | query | no | WeaponBonusEnum = Any, Double, Yellow, Orange, Red, Achilles, Assassinate, Backstab, Berserk, Bleed, Blindfire, Blindside, Bloodlust, Burn, Comeback, Conserve, Cripple, Crusher, Cupid, Deadeye, Deadly, Demoralize, Disarm, Double-edged, Double Tap, Emasculate, Empower, Eviscerate, Execute, Expose, Finale, Focus, Freeze, Frenzy, Fury, Grace, Hazardous, Home run, Irradiate, Lacerate, Motivation, Paralyze, Parry, Penetrate, Plunder, Poison, Powerful, Proficience, Puncture, Quicken, Rage, Revitalize, Roshambo, Shock, Sleep, Slow, Smash, Smurf, Specialist, Spray, Storage, Stricken, Stun, Suppress, Sure Shot, Throttle, Toxin, Warlord, Weaken, Wind-up, Wither |  |
| `limit` | query | no | integer, default 20 | ✅ |
| `offset` | query | no | integer, default 0 |  |
| `timestamp` | query | no |  |  |
| `comment` | query | no | string | ✅ |
| `key` | query | no | string | ✅ |

### `GET /v2/market/auctionhouse`

auction feed (auction-db backfill/poll).

| Param | In | Req | Type / enum | We send |
|---|---|---|---|---|
| `limit` | query | no | integer, default 20 | ✅ |
| `sort` | query | no | string (DESC, ASC) | ✅ |
| `from` | query | no | integer | ✅ |
| `to` | query | no | integer | ✅ |
| `timestamp` | query | no |  |  |
| `comment` | query | no | string | ✅ |
| `key` | query | no | string | ✅ |

---

## Supabase — `auctions` table over PostgREST

Our own table (`schema.sql`). The userscript reads it with the **anon publishable
key** (read-only via RLS); `auction-db` writes with the **service key**. PostgREST's
parameter grammar is fixed and documented — these are the parts we use plus the
operators available without asking.

**Endpoints**

| Call | Method | Where | Auth |
|---|---|---|---|
| `/rest/v1/auctions?select=…&<filters>&order=…&limit=…&offset=…` | GET | userscript `SupabaseClient.search`, `check.mjs`, `compare.mjs` | anon key |
| `/rest/v1/auctions?on_conflict=id` | POST | `auction-db/lib.mjs` upsert | service key |

**Query params (PostgREST, all GET)**

| Param | Meaning |
|---|---|
| `select` | columns to return, comma-separated (we use `item_name,price,quality,sold_at_epoch,bonus_id,bonus_title,bonus_value,bonuses,rarity`) |
| `order` | `<col>.asc` / `<col>.desc` (we sort `sold_at_epoch` or `price`) |
| `limit`, `offset` | pagination |
| `on_conflict` | upsert conflict target (POST; we use `id`) |
| `<column>=<op>.<value>` | row filter — see operators below |

**Filter operators** (`<column>=<op>.<value>`) — full PostgREST set, available to use:

`eq` (=), `neq` (≠), `gt` `gte` `lt` `lte`, `like` `ilike` (pattern), `match` `imatch`,
`in` (`in.(a,b,c)`), `is` (`is.null`), `isdistinct`, `fts` `plfts` `phfts` `wfts` (full-text),
`cs` (contains, for jsonb/array), `cd` (contained), `ov` (overlap), `sl` `sr` `nxl` `nxr` `adj` (ranges),
`not` (negate, `not.eq.…`), `or` / `and` (logic trees).

We currently use: `item_name=eq.`, `bonus_id=eq.`, `bonuses=cs.[{"id":N}]`, `rarity=eq.`.

**Headers**

| Header | Value | Used by |
|---|---|---|
| `apikey` | anon or service key | all |
| `Authorization` | `Bearer <same key>` | all |
| `Content-Type` | `application/json` | POST |
| `Prefer` | `resolution=merge-duplicates,return=minimal` | POST upsert |
| `Prefer` | `count=exact` (+ `Range`) | available for counts |

---

## Weav3r — `https://weav3r.dev/api/ranked-weapons`

Third-party, **no published spec**. Wired into the userscript (`Weav3rClient`,
`@connect weav3r.dev`) but **currently dormant** — defined and exported on
`__RwthPure` with no live call site. `Weav3rClient.search(query)` passes the
`query` object straight through as query-string params (any `!= null && != ''`
entry is sent), so the param surface is whatever Weav3r accepts. Response shape we
rely on: `{ weapons: [...], total_count: N }`. If we revive it, confirm params
against Weav3r's live API or the Price Checker it was modelled on — this is the one
source that is *not* backed by a machine-readable spec.

---

## Maintenance

- **Refresh the Torn spec:** `node tools/gen-api-registry.mjs --fetch` (re-downloads
  `openapi.json` with a custom UA, then regenerates this file). Without `--fetch`
  it regenerates from the stored JSON.
- **The drift guard** (`tests/test-api-endpoints.js`, run by `node --test`) fails if
  the code calls an endpoint missing from `USED`, or sends a param that isn't in the
  stored spec for that endpoint. So this registry cannot silently rot.
- **Adding/changing a call:** update `USED` in `tools/gen-api-registry.mjs`,
  regenerate, and let the test confirm code ↔ registry ↔ spec agree.
