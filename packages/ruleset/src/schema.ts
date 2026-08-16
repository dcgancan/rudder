/*
 * Rudder — readable trading strategies
 * Copyright (C) 2026 Doğancan Öztürk
 *
 * This program is free software: you can redistribute it and/or modify it under
 * the terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option) any
 * later version. It is distributed WITHOUT ANY WARRANTY; without even the
 * implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See <https://www.gnu.org/licenses/> for the full license.
 */

/**
 * Kural seti şeması — güvenlik sınırının TypeScript tarafı.
 *
 * Buradaki whitelist'ler `engine/universal_strategy.py` içindekilerle aynıdır ve
 * kasıtlı olarak iki yerde tutulur: biri kaydetmeden önce, diğeri çalıştırmadan
 * önce doğrular. Birini genişletirken diğerini de genişlet.
 *
 * Şema iki tür kontrolü birlikte yapar:
 *   - yapısal   (Zod tipleri): bilinmeyen fonksiyon, operatör, alan
 *   - anlamsal  (superRefine): id çakışması, tanımsız operand, eksik parametre
 *
 * İkincisi tek başına yapısal doğrulamayla yakalanamaz; asıl saldırı yüzeyi de
 * orasıdır.
 */

import { z } from "zod";

export const OHLCV_COLUMNS = ["open", "high", "low", "close", "volume"] as const;
export const INDICATOR_FNS = ["rsi", "ema", "sma", "macd", "bbands", "atr", "adx"] as const;
export const COMPARISON_OPS = ["lt", "lte", "gt", "gte", "cross_above", "cross_below"] as const;
export const INDICATOR_OUTPUTS = ["macd", "signal", "hist", "upper", "middle", "lower"] as const;
export const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d"] as const;

/** Tek seri üreten indikatörler; `params.period` zorunludur. */
export const SINGLE_OUTPUT_FNS = ["rsi", "ema", "sma", "atr", "adx"] as const;
/** Birden çok seri üreten indikatörler; `output` zorunludur. */
export const MULTI_OUTPUT_FNS = ["macd", "bbands"] as const;

export type OhlcvColumn = (typeof OHLCV_COLUMNS)[number];
export type IndicatorFn = (typeof INDICATOR_FNS)[number];
export type IndicatorOutput = (typeof INDICATOR_OUTPUTS)[number];
export type ComparisonOp = (typeof COMPARISON_OPS)[number];
export type Timeframe = (typeof TIMEFRAMES)[number];

/** Sayı sabiti, OHLCV sütunu ya da tanımlı bir indikatör id'si. */
export type Operand = number | string;
export type Comparison = { op: ComparisonOp; left: Operand; right: Operand };

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { cmp: Comparison };

// ---------------------------------------------------------------------------
// Yapısal şema
// ---------------------------------------------------------------------------

const indicatorId = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,31}$/, "must be lowercase letters, digits and underscores");

const localizedText = z
  .record(z.string().regex(/^[a-z]{2}$/, "must be a two-letter language code"), z.string().min(1).max(120))
  .refine((value) => typeof value["en"] === "string", {
    message: 'an "en" translation is required as the fallback',
  });

const operand = z.union([z.number(), z.enum(OHLCV_COLUMNS), indicatorId]);

const comparison = z.strictObject({
  op: z.enum(COMPARISON_OPS),
  left: operand,
  right: operand,
});

const condition: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.strictObject({ all: z.array(condition).min(1).max(8) }),
    z.strictObject({ any: z.array(condition).min(1).max(8) }),
    z.strictObject({ not: condition }),
    z.strictObject({ cmp: comparison }),
  ]),
);

const indicator = z.strictObject({
  id: indicatorId,
  fn: z.enum(INDICATOR_FNS),
  params: z
    .strictObject({
      period: z.number().int().min(2).max(500).optional(),
      fast: z.number().int().min(2).max(200).optional(),
      slow: z.number().int().min(3).max(500).optional(),
      signal: z.number().int().min(2).max(200).optional(),
      stds: z.number().min(0.5).max(5).optional(),
    })
    .optional(),
  output: z.enum(INDICATOR_OUTPUTS).optional(),
});

const risk = z.strictObject({
  stoploss: z.number().lt(0).gte(-0.99),
  roi: z
    .record(z.string().regex(/^\d+$/, "must be a whole number of minutes"), z.number().min(0))
    .refine((value) => "0" in value, { message: 'roi must include a "0" entry' })
    .optional(),
  trailing: z
    .strictObject({
      enabled: z.boolean(),
      positive: z.number().gt(0).optional(),
      positive_offset: z.number().min(0).optional(),
      only_offset_is_reached: z.boolean().optional(),
    })
    // Freqtrade trailing_stop_positive olmadan trailing'i kabul etmez; şemada
    // yakalanmazsa hata bot ayağa kalkarken çıkar.
    .refine((t) => !t.enabled || typeof t.positive === "number", {
      message: "trailing.positive is required when trailing is enabled",
      path: ["positive"],
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// Anlamsal kontroller
// ---------------------------------------------------------------------------

/** Koşul ağacındaki her karşılaştırmayı, hata yolu ile birlikte gezer. */
function walkComparisons(
  node: Condition,
  visit: (cmp: Comparison, path: (string | number)[]) => void,
  path: (string | number)[] = [],
): void {
  if ("all" in node) node.all.forEach((child, i) => walkComparisons(child, visit, [...path, "all", i]));
  else if ("any" in node) node.any.forEach((child, i) => walkComparisons(child, visit, [...path, "any", i]));
  else if ("not" in node) walkComparisons(node.not, visit, [...path, "not"]);
  else visit(node.cmp, [...path, "cmp"]);
}

const isOhlcv = (value: string): boolean => (OHLCV_COLUMNS as readonly string[]).includes(value);

export const rulesetSchema = z
  .strictObject({
    schema_version: z.literal(1),
    id: z
      .string()
      .regex(
        /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/,
        "must be a lowercase slug of 3-64 characters (letters, digits, hyphens)",
      ),
    name: localizedText,
    timeframe: z.enum(TIMEFRAMES),
    indicators: z.array(indicator).max(12),
    entry: condition,
    exit: condition.optional(),
    risk,
  })
  .superRefine((ruleset, ctx) => {
    const declared = new Set<string>();

    ruleset.indicators.forEach((spec, i) => {
      if (isOhlcv(spec.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["indicators", i, "id"],
          message: `indicator id "${spec.id}" shadows an OHLCV column`,
        });
      }
      if (declared.has(spec.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["indicators", i, "id"],
          message: `duplicate indicator id "${spec.id}"`,
        });
      }
      declared.add(spec.id);

      const needsPeriod = (SINGLE_OUTPUT_FNS as readonly string[]).includes(spec.fn);
      if (needsPeriod && spec.params?.period === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["indicators", i, "params", "period"],
          message: `${spec.fn} requires a period`,
        });
      }

      // macd ve bbands birden çok seri üretir. Varsayılana düşmek sessiz bir
      // sürpriz olur (bbands -> orta bant), o yüzden açık yazılması zorunlu.
      const isMulti = (MULTI_OUTPUT_FNS as readonly string[]).includes(spec.fn);
      if (isMulti && spec.output === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["indicators", i, "output"],
          message: `${spec.fn} produces multiple series — "output" must be given explicitly`,
        });
      }
    });

    const known = new Set<string>([...declared, ...OHLCV_COLUMNS]);

    for (const branch of ["entry", "exit"] as const) {
      const node = ruleset[branch];
      if (!node) continue;
      walkComparisons(node, (cmp, path) => {
        for (const side of ["left", "right"] as const) {
          const ref = cmp[side];
          if (typeof ref === "number") continue;
          if (!known.has(ref)) {
            ctx.addIssue({
              code: "custom",
              path: [branch, ...path, side],
              message: `unknown operand "${ref}" — not an indicator id or OHLCV column`,
            });
          }
        }
      });
    }
  });

export type Ruleset = z.infer<typeof rulesetSchema>;

// ---------------------------------------------------------------------------
// Genel arayüz
// ---------------------------------------------------------------------------

export type ValidationResult =
  | { ok: true; ruleset: Ruleset }
  | { ok: false; errors: { path: string; message: string }[] };

/** Doğrular; hata fırlatmaz. Kullanıcı girdisi için bunu kullan. */
export function validateRuleset(input: unknown): ValidationResult {
  const result = rulesetSchema.safeParse(input);
  if (result.success) return { ok: true, ruleset: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}

/** Doğrular; geçersizse fırlatır. Güvendiğin kaynaklar için. */
export function parseRuleset(input: unknown): Ruleset {
  return rulesetSchema.parse(input);
}
