#!/usr/bin/env node
// Regenerate docs/api-endpoints.md (the curated registry) from the stored Torn
// OpenAPI spec at docs/api/torn-openapi.json.
//
//   node tools/gen-api-registry.mjs           regenerate from the stored spec
//   node tools/gen-api-registry.mjs --fetch   re-download the spec first, then regenerate
//
// The full Torn surface is the stored openapi.json (source of truth); this script
// just curates the endpoints the project actually calls (USED, below) with their
// complete parameter list pulled straight from the spec — so the param record can
// never be a hand-typed guess. tests/test-api-endpoints.js guards code ↔ USED ↔ spec.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_PATH = path.join(REPO, 'docs/api/torn-openapi.json');
const SPEC_URL = 'https://www.torn.com/swagger/openapi.json';
// CloudFlare blocks default UAs on this file — identify ourselves.
const UA = 'rwth-endpoint-registry/1.0 (+https://github.com/EstradaRPM/rwth)';

async function fetchSpec() {
  const res = await fetch(SPEC_URL, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`spec fetch failed: HTTP ${res.status}`);
  const text = await res.text();
  JSON.parse(text); // validate before overwriting
  fs.writeFileSync(SPEC_PATH, text);
  process.stdout.write(`fetched ${text.length} bytes → docs/api/torn-openapi.json\n`);
}

// Endpoints the project calls today. `used` = params we currently send, so the
// table shows the WHOLE allowed surface with our usage flagged.
const USED = {
  '/user':                  { used: ['key', 'comment'], note: 'API-key validation (comment=rwth-test)' },
  '/user/{id}/basic':       { used: ['key', 'comment'], note: 'buyer id → name (comment=rwth-buyer)' },
  '/user/log':              { used: ['log', 'limit', 'from', 'key', 'comment'], note: 'ledger scan (comment=rwth-scan; we also append `_` cache-buster, which is NOT a spec param)' },
  '/torn/items':            { used: ['key', 'comment'], note: 'item dictionary (type/sub_type/name; comment=rwth-items)' },
  '/torn/{id}/itemdetails': { used: ['key'], note: 'per-instance quality/bonuses/rarity' },
  '/torn/logtypes':         { used: ['key', 'comment'], note: 'logtype-id validator (comment=rwth-logtypes)' },
  '/market/{id}/itemmarket':{ used: ['bonus', 'limit', 'key', 'comment'], note: 'live market comps & BB engine (comment=rwth-comps / rwth-bb; bonus filters weapons, omitted for armor)' },
  '/market/auctionhouse':   { used: ['limit', 'sort', 'from', 'to', 'key', 'comment'], note: 'auction feed (auction-db backfill/poll)' },
};

// Exported so the drift test can assert USED ⊆ spec, code-used params ⊆ spec, and
// that the committed docs/api-endpoints.md matches a fresh build (not stale).
export { USED, SPEC_PATH, build };

function build() {
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
  const paths = spec.paths || {};
  const resolve = (ref) => ref.replace(/^#\//, '').split('/').reduce((o, p) => o[p], spec);
  const esc = (x) => String(x == null ? '' : x).replace(/\|/g, '\\|');

  function schemaDesc(schema) {
    if (!schema) return '';
    if (schema.$ref) {
      const t = schema.$ref.split('/').pop();
      const r = resolve(schema.$ref);
      if (r && r.enum) return `${t} = ${r.enum.map(String).join(', ')}`;
      return t;
    }
    let t = schema.type || '';
    if (schema.enum) t += ` (${schema.enum.map(String).join(', ')})`;
    if (schema.type === 'array' && schema.items) {
      t = 'array<' + (schema.items.$ref ? schema.items.$ref.split('/').pop() : schema.items.type) + '>';
    }
    if (schema.default !== undefined) t += `, default ${schema.default}`;
    return t;
  }

  let tables = '';
  for (const [p, meta] of Object.entries(USED)) {
    const node = paths[p];
    if (!node) { tables += `\n### \`${p}\` — ⚠️ NOT FOUND IN SPEC\n`; continue; }
    const method = Object.keys(node)[0];
    const ep = node[method];
    tables += `\n### \`${method.toUpperCase()} /v2${p}\`\n\n`;
    tables += `${meta.note}.\n\n`;
    tables += `| Param | In | Req | Type / enum | We send |\n|---|---|---|---|---|\n`;
    for (const pr of (ep.parameters || [])) {
      const par = pr.$ref ? resolve(pr.$ref) : pr;
      const used = meta.used.includes(par.name) ? '✅' : '';
      tables += `| \`${esc(par.name)}\` | ${par.in} | ${par.required ? 'yes' : 'no'} | ${esc(schemaDesc(par.schema))} | ${used} |\n`;
    }
  }

  return `<!-- GENERATED FILE — do not hand-edit the Torn tables below.
     Regenerate with:  node tools/gen-api-registry.mjs
     Source of truth:  docs/api/torn-openapi.json (Torn API v${spec.info.version}, OpenAPI ${spec.openapi}) -->

# API endpoint registry

The **unequivocal record** of every API this project talks to, with the *full*
parameter surface each endpoint allows — not just the params we currently send.
"We send ✅" marks what the code uses today; everything else is available to use
without asking.

There are three data sources (ADR-0003):

| Source | Base URL | Auth | Spec |
|---|---|---|---|
| **Torn API v2** | \`https://api.torn.com/v2\` | \`key=\` query param | machine-readable — [\`docs/api/torn-openapi.json\`](api/torn-openapi.json) |
| **Supabase (PostgREST)** | \`https://kozewwpyssyzuyksnoqu.supabase.co/rest/v1\` | \`apikey\`+\`Authorization\` headers | PostgREST grammar (below) |
| **Weav3r** | \`https://weav3r.dev/api\` | none | third-party, no spec (empirically documented) |

> **The full Torn surface lives in [\`docs/api/torn-openapi.json\`](api/torn-openapi.json)** —
> all ${Object.keys(paths).length} paths, every parameter, every enum. The tables here are the
> curated fast-path for the endpoints we actually call. For any Torn endpoint or
> param not listed here, that JSON is authoritative; never guess and never ask.
>
> Quick lookup, e.g. params for one path:
> \`\`\`bash
> node -e 'const s=require("./docs/api/torn-openapi.json");const p=s.paths["/market/{id}/itemmarket"].get;for(const r of p.parameters){const x=r.$ref?r.$ref.split("/").pop():r.name;console.log(x)}'
> \`\`\`

---

## Torn API v2 — endpoints we call

Every Torn call carries \`key=\` (the user's API key) and almost all carry a
\`comment=\` tag identifying the call site. \`key\`/\`comment\`/\`timestamp\` are
universal query params on essentially every endpoint.
${tables}
---

## Supabase — \`auctions\` table over PostgREST

Our own table (\`schema.sql\`). The userscript reads it with the **anon publishable
key** (read-only via RLS); \`auction-db\` writes with the **service key**. PostgREST's
parameter grammar is fixed and documented — these are the parts we use plus the
operators available without asking.

**Endpoints**

| Call | Method | Where | Auth |
|---|---|---|---|
| \`/rest/v1/auctions?select=…&<filters>&order=…&limit=…&offset=…\` | GET | userscript \`SupabaseClient.search\`, \`check.mjs\`, \`compare.mjs\` | anon key |
| \`/rest/v1/auctions?on_conflict=id\` | POST | \`auction-db/lib.mjs\` upsert | service key |

**Query params (PostgREST, all GET)**

| Param | Meaning |
|---|---|
| \`select\` | columns to return, comma-separated (we use \`item_name,price,quality,sold_at_epoch,bonus_id,bonus_title,bonus_value,bonuses,rarity\`) |
| \`order\` | \`<col>.asc\` / \`<col>.desc\` (we sort \`sold_at_epoch\` or \`price\`) |
| \`limit\`, \`offset\` | pagination |
| \`on_conflict\` | upsert conflict target (POST; we use \`id\`) |
| \`<column>=<op>.<value>\` | row filter — see operators below |

**Filter operators** (\`<column>=<op>.<value>\`) — full PostgREST set, available to use:

\`eq\` (=), \`neq\` (≠), \`gt\` \`gte\` \`lt\` \`lte\`, \`like\` \`ilike\` (pattern), \`match\` \`imatch\`,
\`in\` (\`in.(a,b,c)\`), \`is\` (\`is.null\`), \`isdistinct\`, \`fts\` \`plfts\` \`phfts\` \`wfts\` (full-text),
\`cs\` (contains, for jsonb/array), \`cd\` (contained), \`ov\` (overlap), \`sl\` \`sr\` \`nxl\` \`nxr\` \`adj\` (ranges),
\`not\` (negate, \`not.eq.…\`), \`or\` / \`and\` (logic trees).

We currently use: \`item_name=eq.\`, \`bonus_id=eq.\`, \`bonuses=cs.[{"id":N}]\`, \`rarity=eq.\`.

**Headers**

| Header | Value | Used by |
|---|---|---|
| \`apikey\` | anon or service key | all |
| \`Authorization\` | \`Bearer <same key>\` | all |
| \`Content-Type\` | \`application/json\` | POST |
| \`Prefer\` | \`resolution=merge-duplicates,return=minimal\` | POST upsert |
| \`Prefer\` | \`count=exact\` (+ \`Range\`) | available for counts |

---

## Weav3r — \`https://weav3r.dev/api/ranked-weapons\`

Third-party, **no published spec**. Wired into the userscript (\`Weav3rClient\`,
\`@connect weav3r.dev\`) but **currently dormant** — defined and exported on
\`__RwthPure\` with no live call site. \`Weav3rClient.search(query)\` passes the
\`query\` object straight through as query-string params (any \`!= null && != ''\`
entry is sent), so the param surface is whatever Weav3r accepts. Response shape we
rely on: \`{ weapons: [...], total_count: N }\`. If we revive it, confirm params
against Weav3r's live API or the Price Checker it was modelled on — this is the one
source that is *not* backed by a machine-readable spec.

---

## Maintenance

- **Refresh the Torn spec:** \`node tools/gen-api-registry.mjs --fetch\` (re-downloads
  \`openapi.json\` with a custom UA, then regenerates this file). Without \`--fetch\`
  it regenerates from the stored JSON.
- **The drift guard** (\`tests/test-api-endpoints.js\`, run by \`node --test\`) fails if
  the code calls an endpoint missing from \`USED\`, or sends a param that isn't in the
  stored spec for that endpoint. So this registry cannot silently rot.
- **Adding/changing a call:** update \`USED\` in \`tools/gen-api-registry.mjs\`,
  regenerate, and let the test confirm code ↔ registry ↔ spec agree.
`;
}

// Run only when invoked directly (not when imported by the test).
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  if (process.argv.includes('--fetch')) await fetchSpec();
  const doc = build();
  fs.writeFileSync(path.join(REPO, 'docs/api-endpoints.md'), doc);
  process.stdout.write(`wrote docs/api-endpoints.md (${doc.length} chars)\n`);
}
