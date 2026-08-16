import "server-only";

import { rulesets } from "@rudder/db";
import type { RulesetRow } from "@rudder/db";
import { describe, indicatorLabels, localeFor } from "@rudder/ruleset";
import type { BacktestSummary } from "@rudder/backtest/result";

import { activeRun, lastRun, latestMeasurement } from "./backtests";
import { db } from "./db";
import { exitReasonKey } from "./exit-reasons";

export type StrategyView = {
  /** Kural setinin sürüm satırı — backtest tetiklerken buna bağlanılır. */
  rulesetId: string;
  slug: string;
  version: number;
  /** Repoyla mı geldi, kullanıcı mı yazdı — düzenleme yolu buna bakıyor. */
  source: RulesetRow["source"];
  name: string;
  timeframe: string;
  /** Üretilmiş cümleler — hiçbiri elle yazılmadı. */
  entry: string;
  exit: string;
  risk: string[];
  watches: string[];
  /**
   * Düşüş eğrisi.
   *
   *   null → hiç test edilmedi
   *   [0]  → test edildi, hiç işlem açmadı
   *
   * Bu ayrım kasıtlı: boş bir dizi ya da sıfır, "test edildi, düşüş olmadı"
   * diye okunur ve bu yalan olur.
   */
  drawdown: number[] | null;
  measurement: Measurement | null;
  /** Bekleyen, çalışan ya da başarısız olmuş son çalıştırma. */
  run: RunState | null;
};

export type RunState = {
  id: string;
  status: "queued" | "running" | "failed";
  /** Yalnızca `failed` durumunda. Ham Freqtrade çıktısı — çeviri değil. */
  detail: string | null;
};

export type Measurement = {
  id: string;
  /** Ölçümün GERÇEKTEN kapsadığı aralık; istenenle aynı olmayabilir. */
  from: number;
  to: number;
  days: number;
  pairs: string[];
  /** Getirilerin ölçüldüğü para birimi. */
  currency: string;

  trades: number;
  profitRatio: number;
  /** Hiç kayıp yoksa tanımsızdır — sıfır değil. */
  profitFactor: number | null;
  expectancy: number;
  maxDrawdown: number;
  drawdownSeconds: number | null;
  winRate: number;
  /** Aynı dönemde piyasanın kendisi ne yaptı. */
  marketChange: number;
  holdingSeconds: number;
  maxConsecutiveLosses: number;

  exits: { reason: string; trades: number }[];
  perPair: { pair: string; trades: number; profitRatio: number }[];
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

  const measured = latestMeasurement(row.id);
  const measurement = measured?.result ? toMeasurement(measured.id, measured.result) : null;

  return {
    rulesetId: row.id,
    slug: row.slug,
    version: row.version,
    source: row.source,
    name: description.name,
    timeframe: row.body.timeframe,
    entry: description.entry.sentence,
    exit: description.exit.sentence,
    risk: description.risk.lines,
    watches: [...indicatorLabels(row.body, L).values()],
    drawdown: measured?.result?.drawdown_curve ?? null,
    measurement,
    run: toRunState(row.id),
  };
}

/** Freqtrade döküm listelerinin sonuna bir de toplam satırı koyuyor. */
function withoutTotals<T extends { key: string }>(rows: T[]): T[] {
  return rows.filter((row) => row.key !== "TOTAL");
}

function toMeasurement(id: string, summary: BacktestSummary): Measurement {
  // Eşlemeden sonra iki farklı ham sebep aynı satıra düşebilir; toplanmaları
  // gerekir, yoksa listede iki kez aynı başlık görünür.
  const exits = new Map<string, number>();
  for (const row of withoutTotals(summary.exit_reason_summary)) {
    const key = exitReasonKey(row.key);
    exits.set(key, (exits.get(key) ?? 0) + row.trades);
  }

  return {
    id,
    from: summary.backtest_start_ts,
    to: summary.backtest_end_ts,
    days: summary.backtest_days,
    pairs: summary.pairlist,
    currency: summary.stake_currency,

    trades: summary.total_trades,
    profitRatio: summary.profit_total,
    // Kâr faktörü kayıp yokken tanımsız; Freqtrade oraya 0 yazıyor ve sıfır
    // ekranda "berbat" diye okunur.
    profitFactor: summary.losses === 0 ? null : summary.profit_factor,
    expectancy: summary.expectancy,
    maxDrawdown: summary.max_drawdown_account,
    drawdownSeconds: summary.drawdown_duration_s,
    winRate: summary.winrate,
    marketChange: summary.market_change,
    holdingSeconds: summary.holding_avg_s,
    maxConsecutiveLosses: summary.max_consecutive_losses,

    exits: [...exits]
      .map(([reason, trades]) => ({ reason, trades }))
      .sort((a, b) => b.trades - a.trades),

    perPair: withoutTotals(summary.results_per_pair).map((row) => ({
      pair: row.key,
      trades: row.trades,
      profitRatio: row.profit_total,
    })),
  };
}

/**
 * Kullanıcıya gösterilecek çalıştırma durumu.
 *
 * Tamamlanmış bir test zaten `measurement` olarak görünüyor; buradaki durum
 * yalnızca "devam ediyor" ya da "başarısız oldu" hallerini taşır.
 */
function toRunState(rulesetId: string): RunState | null {
  const active = activeRun(rulesetId);
  if (active) {
    return { id: active.id, status: active.status as "queued" | "running", detail: null };
  }

  const last = lastRun(rulesetId);
  if (last?.status === "failed") {
    return { id: last.id, status: "failed", detail: last.error };
  }

  return null;
}

export function listStrategies(locale: string): StrategyView[] {
  return latestVersions().map((row) => toView(row, locale));
}

export function getStrategy(slug: string, locale: string): StrategyView | null {
  const row = latestVersions().find((candidate) => candidate.slug === slug);
  return row ? toView(row, locale) : null;
}

/** Backtest tetiklenirken bağlanılacak sürüm satırı. Dil gerektirmez. */
export function latestRulesetId(slug: string): string | null {
  return latestVersions().find((candidate) => candidate.slug === slug)?.id ?? null;
}
