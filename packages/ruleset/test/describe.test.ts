import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import { describe, loadLocale, toText } from "../src/describe.ts";
import type { Locale } from "../src/describe.ts";
import { parseRuleset } from "../src/schema.ts";

const RULESETS = resolve(import.meta.dirname, "../../../rulesets");

const ruleset = (name: string) =>
  parseRuleset(JSON.parse(readFileSync(resolve(RULESETS, `${name}.json`), "utf8")));

const render = async (name: string, locale: string) =>
  describe(ruleset(name), await loadLocale(locale), locale);

test("renders English", async () => {
  const d = await render("rsi-dip-buyer", "en");

  assert.equal(d.name, "RSI Dip Buyer");
  assert.equal(d.timeframe, "Evaluated on the 1h chart.");
  assert.equal(
    d.entry.sentence,
    "BUY when RSI(14) falls below 30 and price rises above the 200-period EMA.",
  );
  assert.equal(d.exit.sentence, "SELL when RSI(14) rises above 70.");
});

// Turkish is verb-final: the label goes at the end, not the start. The sentence
// pattern lives in the locale file precisely so this can differ per language.
test("Turkish puts the verb last", async () => {
  const d = await render("rsi-dip-buyer", "tr");

  assert.equal(
    d.entry.sentence,
    "RSI(14) 30 seviyesinin altına inerse ve fiyat 200 periyotluk EMA seviyesinin üzerine çıkarsa AL.",
  );
  assert.ok(d.entry.sentence.endsWith("AL."), "Turkish entry sentence must end with the verb");
  assert.ok(!d.entry.sentence.startsWith("AL"), "Turkish must not lead with the verb");
});

// "işlem" -> "İşlem" with a dotted capital I. Plain toUpperCase() yields
// "Islem", which is wrong in Turkish and looks broken to a native speaker.
test("Turkish capitalization uses the dotted capital I", async () => {
  const volumeFirst = parseRuleset({
    schema_version: 1,
    id: "volume-first",
    name: { en: "Volume First", tr: "Hacim Önce" },
    timeframe: "1h",
    indicators: [{ id: "sma20", fn: "sma", params: { period: 20 } }],
    entry: {
      all: [
        { cmp: { op: "gt", left: "volume", right: 1000 } },
        { cmp: { op: "gt", left: "close", right: "sma20" } },
      ],
    },
    risk: { stoploss: -0.05, roi: { "0": 0.02 } },
  });

  const d = describe(volumeFirst, await loadLocale("tr"), "tr");

  assert.ok(d.entry.sentence.startsWith("İşlem hacmi"), `got: ${d.entry.sentence}`);
  assert.ok(!d.entry.sentence.startsWith("Işlem"), "dotless I is wrong in Turkish");
});

// Turkish writes the percent sign first, uses a comma decimal separator and a
// period thousands separator. All of it comes from Intl, none by hand.
test("number and percent formatting follows the locale", async () => {
  const tr = await render("bb-bounce", "tr");
  const en = await render("bb-bounce", "en");

  assert.ok(tr.risk.lines[0]?.includes("%6"), `TR percent sign leads: ${tr.risk.lines[0]}`);
  assert.ok(en.risk.lines[0]?.includes("6%"), `EN percent sign trails: ${en.risk.lines[0]}`);

  assert.ok(tr.risk.lines[1]?.includes("%1,5"), `TR decimal comma: ${tr.risk.lines[1]}`);
  assert.ok(en.risk.lines[1]?.includes("1.5%"), `EN decimal point: ${en.risk.lines[1]}`);
});

test("renders trailing stop details when enabled", async () => {
  const en = await render("bb-bounce", "en");
  assert.equal(
    en.risk.lines[2],
    "Trailing stop of 1%, activated once profit reaches 2%.",
  );
});

test("cross_above and cross_below render distinctly", async () => {
  const en = await render("ema-cross", "en");
  assert.ok(en.entry.sentence.includes("crosses above"));
  assert.ok(en.exit.sentence.includes("crosses below"));
});

test("a ruleset with no exit rule says so", async () => {
  const noExit = parseRuleset({
    schema_version: 1,
    id: "no-exit",
    name: { en: "No Exit" },
    timeframe: "1h",
    indicators: [{ id: "rsi14", fn: "rsi", params: { period: 14 } }],
    entry: { cmp: { op: "lt", left: "rsi14", right: 30 } },
    risk: { stoploss: -0.05, roi: { "0": 0.02 } },
  });

  const d = describe(noExit, await loadLocale("en"), "en");
  assert.equal(d.exit.label, null);
  assert.match(d.exit.sentence, /take-profit or stop-loss only/);
});

// A locale file missing a key must fail loudly. A silent "{left} {op} {right}"
// reaching a user is worse than a crash during development.
test("an incomplete locale fails with a useful message", async () => {
  const complete = await loadLocale("en");
  const broken = { ...complete, ops: { ...complete.ops, lt: undefined } } as unknown as Locale;

  assert.throws(
    () => describe(ruleset("rsi-dip-buyer"), broken, "en"),
    /locale is missing the "ops\.lt" key/,
  );
});

test("toText renders every section", async () => {
  const text = toText(await render("rsi-dip-buyer", "tr"));

  assert.ok(text.includes("RSI Dip Alıcı"));
  assert.ok(text.includes("Risk kontrolleri:"));
  assert.ok(text.includes("Zarar kes: %8"));
});
