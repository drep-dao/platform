/**
 * KI-11 — i18n coverage check. Flags UI strings that are English-only or partially translated, so
 * newly added `t('…')` text doesn't silently stay English in the other locales.
 *
 *   node tools/check-i18n.cjs            # report (always exits 0)
 *   node tools/check-i18n.cjs --strict   # exit 1 if any gaps (for a future CI gate)
 *
 * It checks only STATIC keys — `t('literal')` / `t("literal")`. Dynamic calls (`t(`${x}`)`, a
 * variable) can't be verified and are skipped; prefer static strings so they're translatable.
 *
 * English is the source language (a missing key or language falls back to English — always
 * readable), so this never breaks the UI; it is a to-do list for translators.
 */
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..', 'apps', 'web', 'src');
const DICT = path.join(WEB, 'i18n', 'dictionaries.ts');
const TYPES = path.join(WEB, 'i18n', 'types.ts');
const strict = process.argv.includes('--strict');

// The translation languages (every LangCode except the English source).
const langSrc = fs.readFileSync(TYPES, 'utf8');
const LANGS = [...langSrc.matchAll(/\|\s*'([a-z]{2})'/g)].map((m) => m[1]).filter((l) => l !== 'en');

// ── 1) static t('…') keys used in the source ────────────────────────────────
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(p);
  }
  return out;
}
const tCall = /\bt\(\s*(['"])((?:\\.|(?!\1).)*?)\1\s*\)/g;
const unescape = (s) => s.replace(/\\(['"\\])/g, '$1');
const usedKeys = new Set();
for (const f of walk(WEB)) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(tCall)) usedKeys.add(unescape(m[2]));
}

// ── 2) dictionary entries (key → set of languages present) ──────────────────
//    Entries are one-per-line: 'English key': { es: '…', zh: '…', … }.
const entryLine = /^\s*(['"])((?:\\.|(?!\1).)*?)\1\s*:\s*\{(.*)\}\s*,?\s*$/;
const dict = new Map(); // key -> Set(langs)
for (const line of fs.readFileSync(DICT, 'utf8').split('\n')) {
  const m = line.match(entryLine);
  if (!m) continue;
  const key = unescape(m[2]);
  const body = m[3];
  const langs = new Set();
  // A language key sits at the start of the body or right after a comma (the leading `{` was already
  // consumed above, so anchor on `^` too — otherwise the FIRST language per entry is never detected).
  for (const lm of body.matchAll(/(?:^|[,{])\s*([a-z]{2})\s*:/g)) if (LANGS.includes(lm[1])) langs.add(lm[1]);
  dict.set(key, langs);
}

// ── 3) report ───────────────────────────────────────────────────────────────
const englishOnly = []; // in source, no dictionary entry at all
const partial = [];     // dictionary entry missing some languages
for (const k of usedKeys) {
  const langs = dict.get(k);
  if (!langs) englishOnly.push(k);
  else {
    const missing = LANGS.filter((l) => !langs.has(l));
    if (missing.length) partial.push({ key: k, missing });
  }
}
// Dictionary keys no source t() uses (dead translations) — informational only.
const unused = [...dict.keys()].filter((k) => !usedKeys.has(k));

const cap = (arr, n = 25) => arr.slice(0, n);
const short = (s) => (s.length > 70 ? s.slice(0, 67) + '…' : s);

console.log(`Languages checked (${LANGS.length}): ${LANGS.join(' ')}`);
console.log(`Static t('…') keys in source: ${usedKeys.size} · dictionary entries: ${dict.size}\n`);

console.log(`❗ English-only (used in source, NO dictionary entry): ${englishOnly.length}`);
for (const k of cap(englishOnly)) console.log(`   • ${short(k)}`);
if (englishOnly.length > 25) console.log(`   … and ${englishOnly.length - 25} more`);

console.log(`\n⚠️  Partially translated (entry missing some languages): ${partial.length}`);
for (const p of cap(partial)) console.log(`   • [missing ${p.missing.join(',')}] ${short(p.key)}`);
if (partial.length > 25) console.log(`   … and ${partial.length - 25} more`);

console.log(`\nℹ️  Dictionary entries no static t() references (maybe dead, or used dynamically): ${unused.length}`);

const gaps = englishOnly.length + partial.length;
console.log(`\n${gaps === 0 ? '✅ no gaps' : `Total gaps: ${gaps}`}`);
process.exit(strict && gaps > 0 ? 1 : 0);
