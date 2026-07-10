// node test-api-endpoints.js
// Drift guard for the API endpoint registry (docs/api-endpoints.md + the stored
// Torn OpenAPI spec). Ties three things together so they can never silently
// disagree:
//   1. every Torn endpoint the code calls is registered in USED;
//   2. every param USED claims we send is a real param of that endpoint per spec;
//   3. the committed docs/api-endpoints.md matches a fresh regeneration.
// If this goes red, the registry is lying — fix the code, USED, or regenerate.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const USERSCRIPT = fs.readFileSync(path.join(ROOT, 'TORN-RW-trading-hub.src.user.js'), 'utf8');
const LIB_MJS = fs.readFileSync(path.join(ROOT, 'auction-db', 'lib.mjs'), 'utf8');

// Load the ESM generator (USED list, spec path, doc builder) from CommonJS.
let GEN, SPEC;
const loadGen = (async () => {
  GEN = await import('../tools/gen-api-registry.mjs');
  SPEC = JSON.parse(fs.readFileSync(GEN.SPEC_PATH, 'utf8'));
})();

// Pull Torn endpoint paths out of source: any URL built on `${API_BASE}` or a
// literal api.torn.com, normalising `${...}` path segments to `{id}` and dropping
// the query string and the `/v2` version prefix.
function tornPathsIn(src) {
  const re = /(?:\$\{API_BASE\}|https?:\/\/api\.torn\.com)((?:\/(?:\$\{[^}]*\}|[^/`'"?\s)]+))+)/g;
  const out = new Set();
  let m;
  while ((m = re.exec(src))) {
    let p = m[1].replace(/\/\$\{[^}]*\}/g, '/{id}'); // template segment → {id}
    p = p.replace(/^\/v2/, '');                       // strip version prefix
    out.add(p);
  }
  return out;
}

// Param names the spec lists for a given templated path (first/only method),
// resolving $ref-ed parameter objects.
function specParams(specPath) {
  const node = SPEC.paths[specPath];
  if (!node) return null;
  const ep = node[Object.keys(node)[0]];
  const resolve = (ref) => ref.replace(/^#\//, '').split('/').reduce((o, k) => o[k], SPEC);
  return new Set((ep.parameters || []).map((pr) => (pr.$ref ? resolve(pr.$ref) : pr).name));
}

test('every Torn endpoint the code calls is registered in USED', async () => {
  await loadGen;
  const registered = new Set(Object.keys(GEN.USED));
  const called = new Set([...tornPathsIn(USERSCRIPT), ...tornPathsIn(LIB_MJS)]);
  const unregistered = [...called].filter((p) => !registered.has(p));
  assert.deepStrictEqual(
    unregistered, [],
    `Torn endpoint(s) called in code but missing from USED in tools/gen-api-registry.mjs: ${unregistered.join(', ')}. `
    + `Add them (and regenerate docs/api-endpoints.md), or fix the call. `
    + `A leftover v1 path like "/torn" means a call still needs migrating to /v2.`
  );
});

test('every USED path exists in the stored spec', async () => {
  await loadGen;
  const missing = Object.keys(GEN.USED).filter((p) => !SPEC.paths[p]);
  assert.deepStrictEqual(missing, [], `USED paths absent from torn-openapi.json: ${missing.join(', ')}`);
});

test('every param USED says we send is valid for that endpoint per spec', async () => {
  await loadGen;
  const problems = [];
  for (const [p, meta] of Object.entries(GEN.USED)) {
    const allowed = specParams(p);
    if (!allowed) continue; // covered by the previous test
    for (const param of meta.used) {
      if (!allowed.has(param)) problems.push(`${p}: "${param}"`);
    }
  }
  assert.deepStrictEqual(problems, [], `Param(s) marked as sent but not in spec: ${problems.join('; ')}`);
});

test('docs/api-endpoints.md is up to date with the generator', async () => {
  await loadGen;
  const onDisk = fs.readFileSync(path.join(ROOT, 'docs', 'api-endpoints.md'), 'utf8');
  assert.strictEqual(
    onDisk, GEN.build(),
    'docs/api-endpoints.md is stale — run `node tools/gen-api-registry.mjs` and commit the result.'
  );
});
