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
 * Kural setinden okunabilir strateji açıklaması üretir.
 *
 * Açıklama yazardan alınmaz — kural setinin kendisinden türetilir. Bunun iki
 * sonucu var: açıklama mantığa göre asla yanlış olamaz, ve yeni bir dil eklemek
 * yalnızca yeni bir locale dosyası yazmak demektir.
 *
 * Dil dosyası yazarken üç kural (üçü de gerçek hatalardan çıktı):
 *   - Kelime sırası locale'den gelir, kodda sabit değildir.
 *     İngilizce "BUY when X", Türkçe "X AL".
 *   - Büyük harf locale duyarlıdır: "işlem" -> "İşlem", "Islem" değil.
 *   - Sayı ve yüzde biçimi Intl'e bırakılır: TR'de %8, %1,5 ve 1.000.
 *
 * BU MODÜL SAF. Dosya sistemine dokunmaz, çünkü editörün canlı önizlemesi onu
 * tarayıcıda çalıştırıyor: önizlemedeki cümle ile katalogdaki cümle aynı kodun
 * çıktısı, yani ayrışabilecekleri bir yer yok. Diskten okuyan `loadLocale()`
 * ayrı bir modülde (`load-locale.ts`, yalnızca CLI).
 */

import { OHLCV_COLUMNS } from "./schema.ts";
import type { ComparisonOp, Condition, OhlcvColumn, Operand, Ruleset } from "./schema.ts";

export type Locale = {
  timeframe_line: string;
  entry_label: string;
  exit_label: string;
  entry_sentence: string;
  exit_sentence: string;
  exit_none: string;
  join_all: string;
  join_any: string;
  not: string;
  ops: Partial<Record<ComparisonOp, string>>;
  /**
   * Operatörlerin tek başına okunan hali — editördeki seçim kutusu için.
   *
   * `ops` cümle şablonu ({left}/{right} ile), bu ise etiket. Aynı kelimenin
   * iki biçimi ve ikisi de burada: yeni bir dil eklemek hâlâ tek dosya.
   */
  picker_ops: Partial<Record<ComparisonOp, string>>;
  columns: Partial<Record<OhlcvColumn, string>>;
  indicators: Record<string, string | Record<string, string>>;
  risk_heading: string;
  stoploss: string;
  roi_intro: string;
  roi_immediate: string;
  roi_after: string;
  trailing_off: string;
  trailing_on: string;
  trailing_on_no_offset: string;
  dur_minutes: string;
  dur_hours: string;
  dur_days: string;
};

export type Clause = {
  /** Kısa etiket — arayüzde rozet olarak kullanılabilir ("BUY" / "AL"). */
  label: string | null;
  /** Koşulların tek cümlelik özeti, etiketsiz. */
  conditions: string | null;
  /** Etiket ve koşulların locale'e göre birleştirilmiş hali. */
  sentence: string;
};

export type Description = {
  name: string;
  timeframe: string;
  entry: Clause;
  exit: Clause;
  risk: { heading: string; lines: string[] };
};

/**
 * Eksik çeviri anahtarı sessizce `undefined` basmasın diye. Katkı gelirken en
 * sık karşılaşılacak hata bu, ve mesajın anlaşılır olması gerekiyor.
 */
function required(value: string | undefined, key: string): string {
  if (value === undefined) throw new Error(`locale is missing the "${key}" key`);
  return value;
}

const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`);

const pct = (locale: string, ratio: number): string =>
  new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 }).format(Math.abs(ratio));

const num = (locale: string, value: number): string => new Intl.NumberFormat(locale).format(value);

// Locale duyarlı olmak zorunda: Türkçe'de "işlem" -> "İşlem" (noktalı İ),
// düz toUpperCase() "Islem" üretir ve yanlıştır.
export const capitalize = (locale: string, text: string): string =>
  text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);

function duration(L: Locale, locale: string, minutes: number): string {
  if (minutes % 1440 === 0) return fill(L.dur_days, { n: num(locale, minutes / 1440) });
  if (minutes % 60 === 0) return fill(L.dur_hours, { n: num(locale, minutes / 60) });
  return fill(L.dur_minutes, { n: num(locale, minutes) });
}

/**
 * Indicator id -> insan tarafından okunabilir ad.
 *
 * Arayüz bunu "neye bakıyor" listesi için kullanıyor, o yüzden dışa açık.
 */
export function indicatorLabels(ruleset: Ruleset, L: Locale): Map<string, string> {  const labels = new Map<string, string>();
  for (const spec of ruleset.indicators) {
    const entry = L.indicators[spec.fn];
    const template =
      typeof entry === "string" ? entry : entry?.[spec.output ?? "middle"];
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(spec.params ?? {})) {
      params[key] = String(value);
    }
    labels.set(spec.id, fill(required(template, `indicators.${spec.fn}`), params));
  }
  return labels;
}

function operandText(ref: Operand, labels: Map<string, string>, L: Locale, locale: string): string {
  if (typeof ref === "number") return num(locale, ref);
  if ((OHLCV_COLUMNS as readonly string[]).includes(ref)) {
    return required(L.columns[ref as OhlcvColumn], `columns.${ref}`);
  }
  return labels.get(ref) ?? ref;
}

/** Koşul ağacını tek bir cümleye indirger. */
function describeCondition(
  node: Condition,
  labels: Map<string, string>,
  L: Locale,
  locale: string,
): string {
  const recurse = (child: Condition) => describeCondition(child, labels, L, locale);

  if ("all" in node) return node.all.map(recurse).join(L.join_all);
  if ("any" in node) return node.any.map(recurse).join(L.join_any);
  if ("not" in node) return fill(L.not, { inner: recurse(node.not) });

  const { op, left, right } = node.cmp;
  return fill(required(L.ops[op], `ops.${op}`), {
    left: operandText(left, labels, L, locale),
    right: operandText(right, labels, L, locale),
  });
}

function describeRisk(ruleset: Ruleset, L: Locale, locale: string): string[] {
  const { stoploss, roi, trailing } = ruleset.risk;
  const lines = [fill(L.stoploss, { pct: pct(locale, stoploss) })];

  if (roi) {
    const steps = Object.entries(roi)
      .map(([minutes, ratio]) => [Number(minutes), ratio] as const)
      .sort((a, b) => a[0] - b[0])
      .map(([minutes, ratio]) =>
        minutes === 0
          ? fill(L.roi_immediate, { pct: pct(locale, ratio) })
          : fill(L.roi_after, { pct: pct(locale, ratio), duration: duration(L, locale, minutes) }),
      );
    lines.push(`${L.roi_intro} ${steps.join(", ")}`);
  }

  if (!trailing?.enabled) {
    lines.push(L.trailing_off);
  } else if (trailing.positive_offset) {
    lines.push(
      fill(L.trailing_on, {
        pct: pct(locale, trailing.positive ?? 0),
        offset: pct(locale, trailing.positive_offset),
      }),
    );
  } else {
    lines.push(fill(L.trailing_on_no_offset, { pct: pct(locale, trailing.positive ?? 0) }));
  }

  return lines;
}

/**
 * Yapısal açıklama. Arayüz bunu bileşen olarak render eder; `toText` yalnızca
 * CLI ve testler içindir.
 */
export function describe(ruleset: Ruleset, L: Locale, locale: string): Description {
  const labels = indicatorLabels(ruleset, L);

  const clause = (branch: "entry" | "exit"): Clause => {
    const node = ruleset[branch];
    if (!node) return { label: null, conditions: null, sentence: L.exit_none };
    const conditions = describeCondition(node, labels, L, locale);
    const label = branch === "entry" ? L.entry_label : L.exit_label;
    const template = branch === "entry" ? L.entry_sentence : L.exit_sentence;
    return {
      label,
      conditions,
      sentence: capitalize(locale, fill(template, { label, conditions })),
    };
  };

  return {
    name: ruleset.name[locale] ?? required(ruleset.name["en"], "name.en"),
    timeframe: fill(L.timeframe_line, { timeframe: ruleset.timeframe }),
    entry: clause("entry"),
    exit: clause("exit"),
    risk: { heading: L.risk_heading, lines: describeRisk(ruleset, L, locale) },
  };
}

export function toText(d: Description): string {
  return [
    d.name,
    d.timeframe,
    "",
    d.entry.sentence,
    d.exit.sentence,
    "",
    `${d.risk.heading}:`,
    ...d.risk.lines.map((line) => `  · ${line}`),
  ].join("\n");
}
