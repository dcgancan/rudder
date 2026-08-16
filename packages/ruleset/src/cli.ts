/**
 * usage: node packages/ruleset/src/cli.ts <ruleset.json> [locale]
 *
 * Kural setini doğrular ve seçilen dilde açıklamasını basar.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, loadLocale, toText } from "./describe.ts";
import { validateRuleset } from "./schema.ts";

const [path, locale = "en"] = process.argv.slice(2);

if (!path) {
  console.error("usage: node cli.ts <ruleset.json> [locale]");
  process.exit(1);
}

const parsed: unknown = JSON.parse(await readFile(resolve(path), "utf8"));
const result = validateRuleset(parsed);

if (!result.ok) {
  console.error(`${path} is not a valid ruleset:`);
  for (const error of result.errors) console.error(`  ${error.path}: ${error.message}`);
  process.exit(1);
}

console.log(toText(describe(result.ruleset, await loadLocale(locale), locale)));
