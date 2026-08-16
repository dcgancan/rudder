import "server-only";

import { rulesets } from "@rudder/db";
import type { RulesetRow } from "@rudder/db";
import { describe, indicatorLabels, localeFor } from "@rudder/ruleset";

import { db } from "./db";

export type StrategyView = {
  slug: string;
  version: number;
  name: string;
  timeframe: string;
  /** Üretilmiş cümleler — hiçbiri elle yazılmadı. */
  entry: string;
  exit: string;
  risk: string[];
  watches: string[];
  /** Drawdown eğrisi. Backtest yoksa null. */
  drawdown: number[] | null;
};

/**
 * Her slug'ın en yüksek sürümü.
 *
 * Kural setleri değişmez ve düzenleme yeni sürüm yaratır, bu yüzden katalogda
 * yalnızca en güncel sürüm görünür. Eski sürümler silinmez: onlara bağlı
 * botlar ve backtest'ler olabilir.
 */
function latestVersions(): RulesetRow[] {
  const all = db.select().from(rulesets).all();
  const newest = new Map<string, RulesetRow>();

  for (const row of all) {
    if (row.archivedAt) continue;
    const current = newest.get(row.slug);
    if (!current || row.version > current.version) newest.set(row.slug, row);
  }

  return [...newest.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

function toView(row: RulesetRow, locale: string): StrategyView {
  const L = localeFor(locale);
  const description = describe(row.body, L, locale);

  return {
    slug: row.slug,
    version: row.version,
    name: description.name,
    timeframe: row.body.timeframe,
    entry: description.entry.sentence,
    exit: description.exit.sentence,
    risk: description.risk.lines,
    watches: [...indicatorLabels(row.body, L).values()],
    // Backtest çalıştırıcısı henüz yok. null "test edilmedi" demek —
    // sıfır ya da boş dizi değil, çünkü ikisi de "test edildi, düşüş yok"
    // gibi okunur ve bu yalan olur.
    drawdown: null,
  };
}

export function listStrategies(locale: string): StrategyView[] {
  return latestVersions().map((row) => toView(row, locale));
}

export function getStrategy(slug: string, locale: string): StrategyView | null {
  const row = latestVersions().find((candidate) => candidate.slug === slug);
  return row ? toView(row, locale) : null;
}
