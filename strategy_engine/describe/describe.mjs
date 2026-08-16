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
 * sonucu var: açıklama koda göre asla yanlış olamaz, ve yeni bir dil eklemek
 * yalnızca yeni bir locale dosyası yazmak demektir.
 *
 * Kullanım:  node describe.mjs <ruleset.json> [locale]
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

const OHLCV = new Set(["open", "high", "low", "close", "volume"]);

const loadLocale = (locale) =>
  readFile(resolve(HERE, "locales", `${locale}.json`), "utf8").then(JSON.parse);

const fill = (template, values) =>
  template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? `{${key}}`);

const pct = (locale, ratio) =>
  new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(Math.abs(ratio));

const num = (locale, value) => new Intl.NumberFormat(locale).format(value);

// Locale duyarlı olmak zorunda: Türkçe'de "işlem" -> "İşlem" (noktalı İ),
// düz toUpperCase() "Islem" üretir ve yanlıştır.
const capitalize = (locale, text) =>
  text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);

function duration(L, locale, minutes) {
  if (minutes % 1440 === 0) return fill(L.dur_days, { n: num(locale, minutes / 1440) });
  if (minutes % 60 === 0) return fill(L.dur_hours, { n: num(locale, minutes / 60) });
  return fill(L.dur_minutes, { n: num(locale, minutes) });
}

/** Indicator id -> insan tarafından okunabilir ad. */
function indicatorLabels(ruleset, L) {
  const labels = new Map();
  for (const spec of ruleset.indicators ?? []) {
    const entry = L.indicators[spec.fn];
    const template = typeof entry === "string" ? entry : entry?.[spec.output ?? "middle"];
    labels.set(spec.id, fill(template ?? spec.id, spec.params ?? {}));
  }
  return labels;
}

function operand(ref, labels, L, locale) {
  if (typeof ref === "number") return num(locale, ref);
  if (OHLCV.has(ref)) return L.columns[ref];
  return labels.get(ref) ?? ref;
}

/** Koşul ağacını tek bir cümleye indirger. */
function describeCondition(node, labels, L, locale) {
  const [key, value] = Object.entries(node)[0];

  if (key === "all" || key === "any") {
    const joiner = key === "all" ? L.join_all : L.join_any;
    const parts = value.map((child) => describeCondition(child, labels, L, locale));
    return parts.length === 1 ? parts[0] : parts.join(joiner);
  }

  if (key === "not") {
    return fill(L.not, { inner: describeCondition(value, labels, L, locale) });
  }

  return fill(L.ops[value.op], {
    left: operand(value.left, labels, L, locale),
    right: operand(value.right, labels, L, locale),
  });
}

function describeRisk(ruleset, L, locale) {
  const { stoploss, roi, trailing } = ruleset.risk;
  const lines = [fill(L.stoploss, { pct: pct(locale, stoploss) })];

  if (roi) {
    const steps = Object.entries(roi)
      .map(([minutes, ratio]) => [Number(minutes), ratio])
      .sort((a, b) => a[0] - b[0])
      .map(([minutes, ratio]) =>
        minutes === 0
          ? fill(L.roi_immediate, { pct: pct(locale, ratio) })
          : fill(L.roi_after, {
              pct: pct(locale, ratio),
              duration: duration(L, locale, minutes),
            })
      );
    lines.push(`${L.roi_intro} ${steps.join(", ")}`);
  }

  if (!trailing?.enabled) {
    lines.push(L.trailing_off);
  } else if (trailing.positive_offset) {
    lines.push(
      fill(L.trailing_on, {
        pct: pct(locale, trailing.positive),
        offset: pct(locale, trailing.positive_offset),
      })
    );
  } else {
    lines.push(fill(L.trailing_on_no_offset, { pct: pct(locale, trailing.positive) }));
  }

  return lines;
}

/**
 * Yapısal açıklama. Arayüz bunu bileşen olarak render eder;
 * aşağıdaki toText yalnızca CLI/demo içindir.
 *
 * label ve sentence ayrı tutulur: kelime sırası dile göre değişir
 * (İngilizce "BUY when X", Türkçe "X AL"), bu yüzden cümle kalıbının
 * kendisi locale dosyasından gelir — kodda sabitlenemez.
 */
export function describe(ruleset, L, locale) {
  const labels = indicatorLabels(ruleset, L);

  const clause = (branch) => {
    const conditions = describeCondition(ruleset[branch], labels, L, locale);
    const label = L[`${branch}_label`];
    return {
      label,
      conditions,
      sentence: capitalize(locale, fill(L[`${branch}_sentence`], { label, conditions })),
    };
  };

  return {
    name: ruleset.name[locale] ?? ruleset.name.en,
    timeframe: fill(L.timeframe_line, { timeframe: ruleset.timeframe }),
    entry: clause("entry"),
    exit: ruleset.exit ? clause("exit") : { label: null, conditions: null, sentence: L.exit_none },
    risk: { heading: L.risk_heading, lines: describeRisk(ruleset, L, locale) },
  };
}

export function toText(d) {
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const [path, locale = "en"] = process.argv.slice(2);
  if (!path) {
    console.error("usage: node describe.mjs <ruleset.json> [locale]");
    process.exit(1);
  }
  const [ruleset, L] = await Promise.all([
    readFile(resolve(path), "utf8").then(JSON.parse),
    loadLocale(locale),
  ]);
  console.log(toText(describe(ruleset, L, locale)));
}
