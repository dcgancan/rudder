/**
 * Backtest'in disk yerleşimi.
 *
 * Kök ve "neden OS temp olamaz" gerekçesi `@rudder/host`'ta.
 *
 * ```
 * <dataRoot>/backtests/<id>/
 *   ruleset.json   → /freqtrade/ruleset.json                (ro)
 *   config.json    → /freqtrade/backtest/config.json        (ro)
 *   results/       → /freqtrade/backtest/results            (rw)
 *   run.log        yalnızca host tarafında
 * <dataRoot>/market-data/<exchange>/ → /freqtrade/backtest/data  (rw)
 * ```
 *
 * Mum verisi backtest başına DEĞİL, borsa başına tutulur: `download-data`
 * artımlıdır ve ikinci çalıştırma yalnızca eksik mumları çeker. Her testin
 * kendi kopyasını indirmesi hem borsayı hem diski boşuna yorar.
 */

import { join } from "node:path";

import { dataRoot } from "@rudder/host";

export type BacktestPaths = {
  /** Bu çalıştırmanın kök dizini. 0700. */
  root: string;
  /** Kural seti; ro mount edilir. */
  ruleset: string;
  /** Üretilmiş Freqtrade yapılandırması; ro mount edilir. */
  config: string;
  /** Freqtrade'in sonuç zip'ini yazdığı dizin. */
  results: string;
  /** İki container adımının birleşik çıktısı. Hata teşhisinin tek kaynağı. */
  log: string;
};

export function backtestPaths(id: string, root = dataRoot()): BacktestPaths {
  const backtestRoot = join(root, "backtests", id);
  return {
    root: backtestRoot,
    ruleset: join(backtestRoot, "ruleset.json"),
    config: join(backtestRoot, "config.json"),
    results: join(backtestRoot, "results"),
    log: join(backtestRoot, "run.log"),
  };
}

/** Borsa başına mum verisi. Bütün backtest'ler bunu paylaşır. */
export function marketDataDir(exchange: string, root = dataRoot()): string {
  return join(root, "market-data", exchange);
}

/** Container adı backtest id'sinden türetilir; yetim container bulunabilsin diye. */
export function containerName(backtestId: string, step: "download" | "backtest"): string {
  return `rudder-backtest-${step}-${backtestId}`;
}
