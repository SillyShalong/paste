import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Static completeness gate: every string literal passed to t("…") anywhere in
// the frontend must have an entry in the zh translation table. A missing key
// means English text leaking into the Chinese UI. Dynamic keys (template
// literals like `Toggle sidebar (${modLabel}+B)`) can't be extracted here and
// are intentionally out of scope — their variants are added manually.

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(name)) yield p;
  }
}

const used = new Set();
for (const file of walk(root)) {
  if (file.endsWith("i18n.ts")) continue;
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"\s*[,)]/g)) {
    used.add(m[1]);
  }
}

// zh table keys: 2-space-indented "quoted": or Bare: entries in src/i18n.ts.
const tableSrc = readFileSync(join(root, "i18n.ts"), "utf8");
const table = new Set();
for (const m of tableSrc.matchAll(/^\s{2}(?:"((?:[^"\\]|\\.)*)":|([A-Za-z][^\s:]*):)/gm)) {
  table.add(m[1] ?? m[2]);
}

test("every t() key used in components has a zh translation", () => {
  const missing = [...used].filter((k) => !table.has(k));
  assert.deepEqual(missing, [], `untranslated UI keys: ${missing.join(", ")}`);
});

test("the zh table itself has no duplicate keys", () => {
  const seen = new Set();
  const dups = [];
  for (const m of tableSrc.matchAll(/^\s{2}(?:"((?:[^"\\]|\\.)*)":|([A-Za-z][^\s:]*):)/gm)) {
    const key = m[1] ?? m[2];
    if (seen.has(key)) dups.push(key);
    seen.add(key);
  }
  assert.deepEqual(dups, [], `duplicate i18n keys: ${dups.join(", ")}`);
});
