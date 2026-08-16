import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import { validateRuleset } from "../src/schema.ts";

const RULESETS = resolve(import.meta.dirname, "../../../rulesets");

const load = (...segments: string[]): unknown =>
  JSON.parse(readFileSync(resolve(RULESETS, ...segments), "utf8"));

const jsonFiles = (dir: string): string[] =>
  readdirSync(resolve(RULESETS, dir === "." ? "." : dir))
    .filter((name) => name.endsWith(".json"))
    .sort();

test("every shipped ruleset is valid", () => {
  const files = jsonFiles(".");
  assert.ok(files.length > 0, "expected at least one shipped ruleset");

  for (const file of files) {
    const result = validateRuleset(load(file));
    assert.ok(
      result.ok,
      `${file} should be valid but got: ${result.ok ? "" : JSON.stringify(result.errors)}`,
    );
  }
});

test("every fixture in _invalid is rejected", () => {
  const files = jsonFiles("_invalid");
  assert.ok(files.length > 0, "expected at least one invalid fixture");

  for (const file of files) {
    const result = validateRuleset(load("_invalid", file));
    assert.equal(result.ok, false, `${file} should have been rejected`);
  }
});

// The security boundary. Each of these is a way a hostile ruleset could try to
// reach the runtime; none of them may ever pass validation.
test("rejects an unknown indicator function", () => {
  const result = validateRuleset(load("_invalid", "unknown-fn.json"));
  assert.equal(result.ok, false);
  assert.ok(
    !result.ok && result.errors.some((e) => e.path === "indicators.0.fn"),
    "expected the error to point at the function name",
  );
});

test("rejects an operand that is not a declared indicator or OHLCV column", () => {
  const result = validateRuleset(load("_invalid", "unknown-operand.json"));
  assert.equal(result.ok, false);
  assert.ok(
    !result.ok && result.errors.some((e) => e.message.includes("unknown operand")),
    "expected an unknown-operand error",
  );
});

test("rejects an indicator id that shadows an OHLCV column", () => {
  const result = validateRuleset(load("_invalid", "shadow-column.json"));
  assert.equal(result.ok, false);
  assert.ok(
    !result.ok && result.errors.some((e) => e.message.includes("shadows an OHLCV column")),
    "expected a shadowing error",
  );
});

const base = {
  schema_version: 1,
  id: "test-ruleset",
  name: { en: "Test" },
  timeframe: "1h",
  indicators: [{ id: "rsi14", fn: "rsi", params: { period: 14 } }],
  entry: { cmp: { op: "lt", left: "rsi14", right: 30 } },
  risk: { stoploss: -0.05, roi: { "0": 0.02 } },
};

// Guards the negative tests below: if the baseline were invalid for some
// unrelated reason, every "rejects X" test would pass without testing X.
test("the test baseline is itself valid", () => {
  assert.equal(validateRuleset(base).ok, true);
});

const withPatch = (patch: Record<string, unknown>): unknown => ({ ...base, ...patch });

test("rejects duplicate indicator ids", () => {
  const result = validateRuleset(
    withPatch({
      indicators: [
        { id: "rsi14", fn: "rsi", params: { period: 14 } },
        { id: "rsi14", fn: "rsi", params: { period: 7 } },
      ],
    }),
  );
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.errors.some((e) => e.message.includes("duplicate indicator id")));
});

test("rejects unknown top-level fields", () => {
  assert.equal(validateRuleset(withPatch({ surprise: true })).ok, false);
});

test("rejects a non-negative stoploss", () => {
  assert.equal(validateRuleset({ ...base, risk: { stoploss: 0.05 } }).ok, false);
});

test("requires a period for single-output indicators", () => {
  const result = validateRuleset(withPatch({ indicators: [{ id: "rsi14", fn: "rsi" }] }));
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.errors.some((e) => e.message.includes("requires a period")));
});

// bbands defaults to the middle band in the interpreter. Falling back silently
// would give the user a different strategy than they thought they wrote.
test("requires an explicit output for multi-output indicators", () => {
  const result = validateRuleset(
    withPatch({
      indicators: [{ id: "bb", fn: "bbands", params: { period: 20, stds: 2 } }],
      entry: { cmp: { op: "lt", left: "close", right: "bb" } },
    }),
  );
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.errors.some((e) => e.message.includes("multiple series")));
});

// Freqtrade refuses to start with trailing enabled but no positive offset —
// better to catch it here than when the bot fails to boot.
test("requires trailing.positive when trailing is enabled", () => {
  const result = validateRuleset({
    ...base,
    risk: { stoploss: -0.05, trailing: { enabled: true } },
  });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.errors.some((e) => e.message.includes("trailing.positive")));
});

test("requires an English name as the fallback", () => {
  assert.equal(validateRuleset(withPatch({ name: { tr: "Sadece Türkçe" } })).ok, false);
});

test("accepts a ruleset with no exit rule", () => {
  const { entry, ...rest } = base;
  assert.equal(validateRuleset({ ...rest, entry }).ok, true);
});
