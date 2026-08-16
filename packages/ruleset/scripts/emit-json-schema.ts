/**
 * Zod şemasından JSON Schema üretir.
 *
 * Tek doğruluk kaynağı `src/schema.ts`. Bu dosya, şemayı TypeScript dışından
 * okumak isteyenler (dokümantasyon, editör tamamlaması, başka diller) için
 * üretilen bir çıktıdır — elle düzenlenmez.
 *
 * Not: `superRefine` ile yapılan anlamsal kontroller (id çakışması, tanımsız
 * operand, çok çıktılı indikatörde eksik `output`) JSON Schema'da ifade
 * edilemez. Bu yüzden üretilen dosya tek başına güvenlik sınırı DEĞİLDİR.
 * Doğrulama her zaman `validateRuleset()` ya da Python tarafındaki
 * `_validate()` üzerinden yapılmalıdır.
 *
 * usage: pnpm --filter @rudder/ruleset emit-schema
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { z } from "zod";

import { rulesetSchema } from "../src/schema.ts";

const OUTPUT = resolve(import.meta.dirname, "../ruleset.schema.json");

const jsonSchema = z.toJSONSchema(rulesetSchema, {
  io: "input",
  // Refinement'lar JSON Schema'ya çevrilemez; şemayı üretmeyi durdurmak yerine
  // atlanmalarını istiyoruz (yukarıdaki nota bakın).
  unrepresentable: "any",
});

const document = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://github.com/rudder/rudder/ruleset.schema.json",
  title: "Rudder Ruleset",
  description:
    "Generated from packages/ruleset/src/schema.ts — do not edit by hand. " +
    "Structural checks only; semantic checks live in validateRuleset().",
  ...jsonSchema,
};

writeFileSync(OUTPUT, `${JSON.stringify(document, null, 2)}\n`);
console.log(`wrote ${OUTPUT}`);
