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
 * Formun düzenlediği model ve kural setine çevrimi.
 *
 * Kural setinin kendisi bir form için fazla serbest: koşullar iç içe
 * `all`/`any`/`not` ağaçları olabiliyor ve indikatörler önce bir `id` ile
 * tanımlanıp sonra o id ile anılıyor. İkisi de programlama kavramı ve ürünün
 * gizlemeye çalıştığı şey tam olarak bu.
 *
 * TASLAK İKİSİNİ DE KALDIRIR:
 *
 *  1. **Tek seviye.** Bir kural, "hepsi" ya da "herhangi biri" ile
 *     birleştirilmiş karşılaştırmalardan ibaret. Repodaki üç kural setinin
 *     üçü de zaten böyle; iç içe ağaç için form kurmak, kaçınılan kod
 *     editörünü başka kılıkta geri getirirdi.
 *  2. **İd yok.** Karşılaştırmanın tarafı doğrudan "RSI · 14" olarak seçilir;
 *     `indicators` listesi ve id'leri kaydederken burası üretir, aynı
 *     indikatör iki kez kullanılırsa tekilleştirir.
 *
 * Bu modül SAF: tarayıcıda da çalışıyor, çünkü editörün canlı önizlemesi
 * `toRuleset` + `describe` zincirini her tuş vuruşunda çağırıyor.
 */

import { OHLCV_COLUMNS } from "./schema.ts";
import type { Locale } from "./describe.ts";
import type {
  ComparisonOp,
  Condition,
  IndicatorFn,
  IndicatorOutput,
  OhlcvColumn,
  Operand,
  Ruleset,
  Timeframe,
} from "./schema.ts";

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type IndicatorParams = {
  period?: number;
  fast?: number;
  slow?: number;
  signal?: number;
  stds?: number;
};

export type DraftOperand =
  | { kind: "column"; column: OhlcvColumn }
  | { kind: "indicator"; fn: IndicatorFn; params: IndicatorParams; output?: IndicatorOutput }
  | { kind: "number"; value: number };

export type DraftComparison = {
  op: ComparisonOp;
  /** Sol taraf sayı olamaz: "40 şunun altındaysa" diye bir cümle kurulmasın. */
  left: Exclude<DraftOperand, { kind: "number" }>;
  right: DraftOperand;
};

export type DraftRule = {
  mode: "all" | "any";
  comparisons: DraftComparison[];
};

export type DraftRoi = { minutes: number; ratio: number };

export type DraftRisk = {
  /** Pozitif oran olarak tutulur (0.08 = %8); kural setine negatif yazılır. */
  stoploss: number;
  roi: DraftRoi[];
  trailing: { enabled: boolean; positive: number; offset: number };
};

export type Draft = {
  name: string;
  timeframe: Timeframe;
  entry: DraftRule;
  /** Satış kuralı isteğe bağlı — yoksa pozisyonlar yalnızca risk ile kapanır. */
  exit: DraftRule | null;
  risk: DraftRisk;
};

/** Yeni bir taslağın başlangıç hali. Boş değil: okunur bir iskelet. */
export function emptyDraft(): Draft {
  return {
    name: "",
    timeframe: "1h",
    entry: {
      mode: "all",
      comparisons: [
        {
          op: "lt",
          left: { kind: "indicator", fn: "rsi", params: { period: 14 } },
          right: { kind: "number", value: 30 },
        },
      ],
    },
    exit: {
      mode: "any",
      comparisons: [
        {
          op: "gt",
          left: { kind: "indicator", fn: "rsi", params: { period: 14 } },
          right: { kind: "number", value: 70 },
        },
      ],
    },
    risk: {
      stoploss: 0.08,
      roi: [{ minutes: 0, ratio: 0.04 }],
      trailing: { enabled: false, positive: 0.01, offset: 0.02 },
    },
  };
}

// ---------------------------------------------------------------------------
// Taslak → kural seti
// ---------------------------------------------------------------------------

/**
 * İndikatör için kararlı bir id üretir.
 *
 * Kullanıcı bunu asla görmüyor; tek şartı şemadaki `^[a-z][a-z0-9_]{0,31}$`
 * kalıbına uyması ve aynı indikatör için hep aynı çıkması — tekilleştirme
 * buna dayanıyor. Ondalık ayıracı `_` oluyor ki `2.5` geçerli bir id kalsın.
 */
export function indicatorId(operand: Extract<DraftOperand, { kind: "indicator" }>): string {
  const parts: string[] = [operand.fn];

  for (const key of ["period", "fast", "slow", "signal", "stds"] as const) {
    const value = operand.params[key];
    if (value !== undefined) parts.push(String(value).replace(".", "_"));
  }
  if (operand.output) parts.push(operand.output);

  return parts.join("_").slice(0, 32);
}

function operandOf(
  draft: DraftOperand,
  indicators: Map<string, { id: string; fn: IndicatorFn; params: IndicatorParams; output?: IndicatorOutput }>,
): Operand {
  if (draft.kind === "number") return draft.value;
  if (draft.kind === "column") return draft.column;

  const id = indicatorId(draft);
  // Aynı indikatör birden çok karşılaştırmada geçebilir; listeye bir kez girer.
  if (!indicators.has(id)) {
    indicators.set(id, {
      id,
      fn: draft.fn,
      params: draft.params,
      ...(draft.output ? { output: draft.output } : {}),
    });
  }
  return id;
}

function conditionOf(
  rule: DraftRule,
  indicators: Parameters<typeof operandOf>[1],
): Condition {
  const comparisons: Condition[] = rule.comparisons.map((comparison) => ({
    cmp: {
      op: comparison.op,
      left: operandOf(comparison.left, indicators),
      right: operandOf(comparison.right, indicators),
    },
  }));

  return rule.mode === "all" ? { all: comparisons } : { any: comparisons };
}

/**
 * Taslağı kural setine çevirir.
 *
 * Çıktı doğrulanmış DEĞİL — çağıran `validateRuleset()`'ten geçirmek zorunda.
 * Bu ayrım kasıtlı: önizleme geçersiz bir taslağı da çizebilmeli, kaydetme
 * çizemeden geçirmemeli.
 */
export function toRuleset(draft: Draft, id: string, locale = "en"): Ruleset {
  const indicators = new Map<string, { id: string; fn: IndicatorFn; params: IndicatorParams; output?: IndicatorOutput }>();

  const entry = conditionOf(draft.entry, indicators);
  const exit = draft.exit ? conditionOf(draft.exit, indicators) : undefined;

  const roi: Record<string, number> = {};
  for (const step of [...draft.risk.roi].sort((a, b) => a.minutes - b.minutes)) {
    roi[String(step.minutes)] = step.ratio;
  }

  return {
    schema_version: 1,
    id,
    // Şema `en`'i yedek olarak zorunlu tutuyor. Kullanıcıdan tek ad alıyoruz ve
    // ikisine de onu yazıyoruz: "yedek" burada "İngilizce olmalı" demek değil,
    // "bir şey bulunmalı" demek.
    name: locale === "en" ? { en: draft.name } : { en: draft.name, [locale]: draft.name },
    timeframe: draft.timeframe,
    indicators: [...indicators.values()],
    entry,
    ...(exit ? { exit } : {}),
    risk: {
      stoploss: -Math.abs(draft.risk.stoploss),
      ...(Object.keys(roi).length > 0 ? { roi } : {}),
      trailing: draft.risk.trailing.enabled
        ? {
            enabled: true,
            positive: draft.risk.trailing.positive,
            positive_offset: draft.risk.trailing.offset,
            only_offset_is_reached: draft.risk.trailing.offset > 0,
          }
        : { enabled: false },
    },
  };
}

// ---------------------------------------------------------------------------
// Kural seti → taslak
// ---------------------------------------------------------------------------

export type FromRulesetResult =
  | { ok: true; draft: Draft }
  | { ok: false; reason: "nested" | "negated" | "bare-comparison" };

/**
 * Var olan bir kural setini forma açar.
 *
 * Formun ifade edemediği bir şekil gelirse **açmaz**. Sessizce düzleştirmek,
 * kullanıcının ekranda okuduğu cümle ile kaydettiği kuralı ayırırdı — ve bu
 * projenin tek iddiası ikisinin ayrılamaz olması.
 */
export function fromRuleset(ruleset: Ruleset, locale = "en"): FromRulesetResult {
  const byId = new Map(ruleset.indicators.map((spec) => [spec.id, spec]));

  const rule = (node: Condition): DraftRule | FromRulesetResult => {
    if ("not" in node) return { ok: false, reason: "negated" };
    if ("cmp" in node) return { ok: false, reason: "bare-comparison" };

    const [mode, children] = "all" in node ? (["all", node.all] as const) : (["any", node.any] as const);
    const comparisons: DraftComparison[] = [];

    for (const child of children) {
      if (!("cmp" in child)) return { ok: false, reason: "nested" };

      const left = operandDraft(child.cmp.left, byId);
      const right = operandDraft(child.cmp.right, byId);
      if (left.kind === "number") return { ok: false, reason: "bare-comparison" };

      comparisons.push({ op: child.cmp.op, left, right });
    }

    return { mode, comparisons };
  };

  const entry = rule(ruleset.entry);
  if ("ok" in entry) return entry;

  let exit: DraftRule | null = null;
  if (ruleset.exit) {
    const parsed = rule(ruleset.exit);
    if ("ok" in parsed) return parsed;
    exit = parsed;
  }

  const trailing = ruleset.risk.trailing;

  return {
    ok: true,
    draft: {
      name: ruleset.name[locale] ?? ruleset.name["en"] ?? "",
      timeframe: ruleset.timeframe,
      entry,
      exit,
      risk: {
        stoploss: Math.abs(ruleset.risk.stoploss),
        roi: Object.entries(ruleset.risk.roi ?? {})
          .map(([minutes, ratio]) => ({ minutes: Number(minutes), ratio }))
          .sort((a, b) => a.minutes - b.minutes),
        trailing: {
          enabled: trailing?.enabled ?? false,
          positive: trailing?.positive ?? 0.01,
          offset: trailing?.positive_offset ?? 0,
        },
      },
    },
  };
}

function operandDraft(
  ref: Operand,
  byId: Map<string, Ruleset["indicators"][number]>,
): DraftOperand {
  if (typeof ref === "number") return { kind: "number", value: ref };
  if ((OHLCV_COLUMNS as readonly string[]).includes(ref)) {
    return { kind: "column", column: ref as OhlcvColumn };
  }

  const spec = byId.get(ref);
  // Tanımsız operand şemadan geçemez; buraya gelen bir kural seti zaten
  // doğrulanmış demektir.
  if (!spec) return { kind: "column", column: "close" };

  return {
    kind: "indicator",
    fn: spec.fn,
    params: spec.params ?? {},
    ...(spec.output ? { output: spec.output } : {}),
  };
}

// ---------------------------------------------------------------------------
// Editör sözlüğü
// ---------------------------------------------------------------------------

/** Seçim kutusunda bir indikatörün ne kadar parametresi görünecek. */
export const PARAMS_OF: Record<IndicatorFn, (keyof IndicatorParams)[]> = {
  rsi: ["period"],
  ema: ["period"],
  sma: ["period"],
  atr: ["period"],
  adx: ["period"],
  macd: ["fast", "slow", "signal"],
  bbands: ["period", "stds"],
};

/** Yeni seçilen bir indikatörün makul başlangıç değerleri. */
export const DEFAULT_PARAMS: Record<IndicatorFn, IndicatorParams> = {
  rsi: { period: 14 },
  ema: { period: 50 },
  sma: { period: 50 },
  atr: { period: 14 },
  adx: { period: 14 },
  macd: { fast: 12, slow: 26, signal: 9 },
  bbands: { period: 20, stds: 2 },
};

/** Çoklu seri üreten indikatörlerin seçilebilir serileri. */
export const OUTPUTS_OF: Partial<Record<IndicatorFn, readonly IndicatorOutput[]>> = {
  macd: ["macd", "signal", "hist"],
  bbands: ["upper", "middle", "lower"],
};

/**
 * Bir operandın okunabilir adı.
 *
 * `describe()` ile AYNI dil dosyasından besleniyor, yani editördeki etiket ile
 * önizlemedeki cümlede geçen ad birbirinden ayrılamıyor.
 */
export function operandLabel(operand: DraftOperand, L: Locale, locale: string): string {
  if (operand.kind === "number") return new Intl.NumberFormat(locale).format(operand.value);
  if (operand.kind === "column") return L.columns[operand.column] ?? operand.column;

  const entry = L.indicators[operand.fn];
  const template = typeof entry === "string" ? entry : entry?.[operand.output ?? "middle"];
  if (!template) return operand.fn;

  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = operand.params[key as keyof IndicatorParams];
    return value === undefined ? `{${key}}` : new Intl.NumberFormat(locale).format(value);
  });
}

// ---------------------------------------------------------------------------
// Slug
// ---------------------------------------------------------------------------

/** Türkçe harfler `normalize()` ile ayrışmıyor; elle eşlenmeleri gerekiyor. */
const TRANSLITERATE: Record<string, string> = {
  ı: "i", İ: "i", ğ: "g", Ğ: "g", ş: "s", Ş: "s",
  ç: "c", Ç: "c", ö: "o", Ö: "o", ü: "u", Ü: "u",
};

/**
 * Addan slug üretir: `"Kısa İşlem Stratejisi"` → `"kisa-islem-stratejisi"`.
 *
 * Şema 3-64 karakterlik bir slug bekliyor ve harf/rakamla başlayıp bitmesini
 * şart koşuyor. Ad hiç harf içermiyorsa (yalnızca emoji gibi) boş döner ve
 * çağıran karar verir.
 */
export function slugFor(name: string): string {
  const ascii = [...name.trim()]
    .map((char) => TRANSLITERATE[char] ?? char)
    .join("")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

  return ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
}
