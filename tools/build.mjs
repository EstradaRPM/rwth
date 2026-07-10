#!/usr/bin/env node
// ─── build.mjs — minify the commented source into the shipped userscript ─────
//
// We author and test `TORN-RW-trading-hub.src.user.js` (fully commented, the
// human-readable file the tests `require()`). What ships — and what
// @downloadURL serves to every installed copy — is the minified
// `TORN-RW-trading-hub.user.js` this script emits.
//
// Terser strips comments, collapses whitespace, and mangles LOCAL variable
// names only (property names like `__RwthPure.buildLedgerTab` are never
// touched, so the test seam and every DOM/data-action hook survive intact).
//
// The `// ==UserScript== … // ==/UserScript==` metadata block is preserved
// verbatim and re-prepended AFTER minification — Tampermonkey / TornPDA need
// it byte-for-byte to install and auto-update, and terser would otherwise
// discard it as a comment.
//
// Run directly (`node tools/build.mjs` / `npm run build`) or automatically via
// the .githooks/pre-commit hook. See CLAUDE.md → "Build step".

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { minify } from 'terser';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'TORN-RW-trading-hub.src.user.js');
const OUT = join(ROOT, 'TORN-RW-trading-hub.user.js');

const HEADER_END = '// ==/UserScript==';

const source = readFileSync(SRC, 'utf8');

// Split the metadata header (preserved verbatim) from the body (minified).
const endIdx = source.indexOf(HEADER_END);
if (endIdx === -1 || !source.trimStart().startsWith('// ==UserScript==')) {
  console.error('build: could not find the // ==UserScript== header block in ' + SRC);
  process.exit(1);
}
const header = source.slice(0, endIdx + HEADER_END.length).trimStart();
const body = source.slice(endIdx + HEADER_END.length);

const result = await minify(body, {
  compress: true,
  mangle: true,
  // ascii_only: escape every non-ASCII char (curly quotes, em-dashes, arrows,
  // gear/emoji glyphs, box-drawing) as \uXXXX in the emitted string/identifier
  // literals. Semantically identical JS, but the shipped file becomes pure
  // 7-bit ASCII. Desktop Tampermonkey parsed the raw UTF-8 fine; TornPDA's
  // WKWebView injection wrapper mangled the multi-byte bytes, breaking string
  // literals mid-parse (the "Unexpected identifier 'Scan'" SyntaxError landed on
  // the word right after `“…”` / `⚙`). ASCII-only output removes that whole
  // class of injection-corruption failure. Do not drop this flag.
  format: { comments: false, ascii_only: true },
});

if (result.error) {
  console.error('build: terser failed:', result.error);
  process.exit(1);
}

const out = header + '\n' + result.code + '\n';
writeFileSync(OUT, out, 'utf8');

const srcKb = (Buffer.byteLength(source) / 1024).toFixed(0);
const outKb = (Buffer.byteLength(out) / 1024).toFixed(0);
const pct = (100 - (Buffer.byteLength(out) / Buffer.byteLength(source)) * 100).toFixed(0);
console.log(`build: ${SRC.split(/[\\/]/).pop()} ${srcKb}KB → ${OUT.split(/[\\/]/).pop()} ${outKb}KB (−${pct}%)`);
