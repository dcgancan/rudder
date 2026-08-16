/**
 * Taslak ile kural seti arasındaki çevrim.
 *
 * Buradaki asıl sözleşme şu: bir kural setini forma açıp geri kapatmak
 * ANLAMINI DEĞİŞTİRMEZ. İndikatör id'leri değişebilir — onlar iç detay ve
 * kullanıcı hiç görmüyor — ama üretilen cümle birebir aynı kalmalı.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import {
  emptyDraft,
  fromRuleset,
  indicatorId,
  slugFor,
  toRuleset,
} from "../src/compose.ts";
import type { Draft } from "../src/compose.ts";
import { describe } from "../src/describe.ts";
import { localeFor } from "../src/locales.ts";
import { parseRuleset, validateRuleset } from "../src/schema.ts";

const RULESETS = resolve(import.meta.dirname, "../../../rulesets");
const SHIPPED = ["bb-bounce", "ema-cross", "rsi-dip-buyer"];

const load = (name: string) =>
  parseRuleset(JSON.parse(readFileSync(resolve(RULESETS, `${name}.json`), "utf8")));

// ---------------------------------------------------------------------------
// Anlamın korunması
// ---------------------------------------------------------------------------

for (const name of SHIPPED) {
  test(`${name} survives a round trip through the form with its meaning intact`, () => {
    const original = load(name);

    const opened = fromRuleset(original, "tr");
    assert.ok(opened.ok, `${name} should be editable in the form`);

    const rebuilt = toRuleset(opened.draft, original.id, "tr");

    for (const locale of ["tr", "en"]) {
      const before = describe(original, localeFor(locale), locale);
      const after = describe(rebuilt, localeFor(locale), locale);

      assert.equal(after.entry.sentence, before.entry.sentence);
      assert.equal(after.exit.sentence, before.exit.sentence);
      assert.deepEqual(after.risk.lines, before.risk.lines);
      assert.equal(after.timeframe, before.timeframe);
    }
  });

  test(`${name} rebuilt from the form is still a valid ruleset`, () => {
    const opened = fromRuleset(load(name), "tr");
    assert.ok(opened.ok);

    const result = validateRuleset(toRuleset(opened.draft, load(name).id, "tr"));
    assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.errors));
  });
}

// Yeni taslak, kullanıcı yalnızca AD yazarak geçerli bir stratejiye dönüşmeli:
// iskelet okunur bir şeyle başlıyor, geri kalanı isteğe bağlı.
test("a new draft needs nothing but a name", () => {
  const named: Draft = { ...emptyDraft(), name: "Yeni Strateji" };
  const result = validateRuleset(toRuleset(named, "yeni-strateji", "tr"));

  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.errors));
});

// Editörün "kaydet" düğmesi buna bakıyor; sebebi de kullanıcıya bu mesajdan
// türetiliyor.
test("an unnamed draft is rejected, and the name is what it complains about", () => {
  const result = validateRuleset(toRuleset(emptyDraft(), "adsiz", "tr"));

  assert.equal(result.ok, false);
  assert.ok(
    result.ok === false && result.errors.some((error) => error.path.startsWith("name")),
    "the complaint should point at the name",
  );
});

// ---------------------------------------------------------------------------
// Formun ifade edemedikleri
// ---------------------------------------------------------------------------

// Sessizce düzleştirmek, kullanıcının okuduğu cümle ile kaydettiği kuralı
// ayırırdı — ve bu projenin tek iddiası ikisinin ayrılamaz olması.
test("a nested condition is refused rather than flattened", () => {
  const nested = parseRuleset({
    schema_version: 1,
    id: "nested",
    name: { en: "Nested" },
    timeframe: "1h",
    indicators: [{ id: "rsi14", fn: "rsi", params: { period: 14 } }],
    entry: {
      all: [{ cmp: { op: "lt", left: "rsi14", right: 30 } }, { any: [{ cmp: { op: "gt", left: "close", right: 1 } }] }],
    },
    risk: { stoploss: -0.05 },
  });

  const opened = fromRuleset(nested);
  assert.equal(opened.ok, false);
  assert.equal(opened.ok === false && opened.reason, "nested");
});

test("a negated condition is refused", () => {
  const negated = parseRuleset({
    schema_version: 1,
    id: "negated",
    name: { en: "Negated" },
    timeframe: "1h",
    indicators: [{ id: "rsi14", fn: "rsi", params: { period: 14 } }],
    entry: { not: { cmp: { op: "lt", left: "rsi14", right: 30 } } },
    risk: { stoploss: -0.05 },
  });

  assert.equal(fromRuleset(negated).ok, false);
});

// ---------------------------------------------------------------------------
// İndikatör id'leri
// ---------------------------------------------------------------------------

// Kullanıcı id diye bir şey görmüyor; iki karşılaştırmada aynı indikatörü
// seçmesi tek bir tanım üretmeli.
test("the same indicator used twice is declared once", () => {
  const draft: Draft = {
    ...emptyDraft(),
    name: "İki Kez RSI",
    entry: {
      mode: "all",
      comparisons: [
        {
          op: "lt",
          left: { kind: "indicator", fn: "rsi", params: { period: 14 } },
          right: { kind: "number", value: 30 },
        },
        {
          op: "gt",
          left: { kind: "indicator", fn: "rsi", params: { period: 14 } },
          right: { kind: "number", value: 10 },
        },
      ],
    },
    exit: null,
  };

  const ruleset = toRuleset(draft, "twice", "en");
  assert.equal(ruleset.indicators.length, 1);
  assert.ok(validateRuleset(ruleset).ok);
});

test("indicators differing only in output stay separate", () => {
  const band = (output: "lower" | "middle") =>
    ({ kind: "indicator", fn: "bbands", params: { period: 20, stds: 2 }, output }) as const;

  const draft: Draft = {
    ...emptyDraft(),
    entry: {
      mode: "all",
      comparisons: [
        { op: "lt", left: { kind: "column", column: "close" }, right: band("lower") },
        { op: "gt", left: band("middle"), right: { kind: "column", column: "open" } },
      ],
    },
    exit: null,
  };

  assert.equal(toRuleset(draft, "bands", "en").indicators.length, 2);
});

test("generated ids fit what the schema allows", () => {
  assert.equal(indicatorId({ kind: "indicator", fn: "rsi", params: { period: 14 } }), "rsi_14");
  assert.equal(
    indicatorId({ kind: "indicator", fn: "bbands", params: { period: 20, stds: 2.5 }, output: "lower" }),
    "bbands_20_2_5_lower",
  );
  assert.match(indicatorId({ kind: "indicator", fn: "macd", params: { fast: 12, slow: 26, signal: 9 }, output: "hist" }), /^[a-z][a-z0-9_]{0,31}$/);
});

// ---------------------------------------------------------------------------
// Slug
// ---------------------------------------------------------------------------

// Türkçe harfler `normalize()` ile ayrışmıyor; elle eşlenmezlerse slug'dan
// tamamen düşerler ve "Kısa İşlem" → "ksa-lem" olur.
test("Turkish letters survive slug generation", () => {
  assert.equal(slugFor("Kısa İşlem Stratejisi"), "kisa-islem-stratejisi");
  assert.equal(slugFor("Güçlü Yükseliş"), "guclu-yukselis");
  assert.equal(slugFor("  RSI Dip Alıcı  "), "rsi-dip-alici");
});

test("slugs never start or end with a hyphen", () => {
  assert.equal(slugFor("— acele —"), "acele");
  assert.equal(slugFor("v2!!!"), "v2");
});

test("a name with no letters yields an empty slug for the caller to handle", () => {
  assert.equal(slugFor("🚀🚀"), "");
});
