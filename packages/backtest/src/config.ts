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
 * Backtest yapılandırması ve container komutları.
 *
 * Bot yapılandırmasıyla (`@rudder/freqtrade`) aynı iki kurala tabidir —
 * sırlar dosyaya yazılmaz, config kural setini ezemez — ama yüzeyi farklıdır:
 * backtest'in API sunucusuna, Telegram'a ya da yeniden başlatma politikasına
 * ihtiyacı yok.
 */

import {
  assertNoRulesetOverrides,
  CONTAINER_PATHS,
  STANDARD_SETUP,
  STRATEGY_NAME,
} from "@rudder/freqtrade";
import type { FreqtradeConfig } from "@rudder/freqtrade";
import type { Timeframe } from "@rudder/ruleset";

/** Container içindeki sabit yollar. Mount'lar buna göre kurulur. */
export const BACKTEST_PATHS = {
  config: "/freqtrade/backtest/config.json",
  results: "/freqtrade/backtest/results",
  data: "/freqtrade/backtest/data",
  ruleset: CONTAINER_PATHS.ruleset,
  strategyDir: CONTAINER_PATHS.strategyDir,
} as const;

export type BacktestSpec = {
  exchange: string;
  stakeCurrency: string;
  pairs: readonly string[];
  wallet: number;
  stake: number;
  maxOpenTrades: number;
};

export function buildBacktestConfig(spec: BacktestSpec = STANDARD_SETUP): FreqtradeConfig {
  if (spec.pairs.length === 0) throw new Error("a backtest needs at least one pair");
  if (spec.stake <= 0) throw new Error("stake must be positive");
  if (spec.wallet < spec.stake) throw new Error("the wallet cannot be smaller than one position");
  if (spec.maxOpenTrades <= 0) throw new Error("maxOpenTrades must be positive");

  const config: FreqtradeConfig = {
    max_open_trades: spec.maxOpenTrades,
    stake_currency: spec.stakeCurrency,
    stake_amount: spec.stake,
    dry_run: true,
    dry_run_wallet: spec.wallet,
    tradable_balance_ratio: 0.99,
    fiat_display_currency: "USD",

    trading_mode: "spot",
    margin_mode: "",

    // Botun ayarıyla aynı: backtest emir zaman aşımlarını hesaba katıyor ve
    // farklı bir değer, ölçtüğümüz davranışı çalıştıracağımız davranıştan
    // ayırırdı.
    unfilledtimeout: { entry: 10, exit: 10, exit_timeout_count: 0, unit: "minutes" },

    // Emir defteri geçmişte yok; backtest zaten mum fiyatını kullanıyor.
    // Açık bırakmak yanıltıcı bir ayar görüntüsü verirdi.
    entry_pricing: { price_side: "same", use_order_book: false, price_last_balance: 0 },
    exit_pricing: { price_side: "same", use_order_book: false },

    exchange: {
      name: spec.exchange,
      // Anahtar yok ve gerekmiyor: mum verisi herkese açık uçlardan iniyor.
      ccxt_config: {},
      ccxt_async_config: {},
      pair_whitelist: spec.pairs,
      pair_blacklist: [],
    },

    pairlists: [{ method: "StaticPairList" }],
  };

  assertNoRulesetOverrides(config);
  return config;
}

/**
 * Mum verisini indirir.
 *
 * Pariteler ve borsa config'den okunur. Artımlıdır: var olan veri korunur,
 * yalnızca eksik aralık çekilir.
 */
export function buildDownloadCommand(options: {
  timerange: string;
  timeframe: Timeframe;
}): string[] {
  return [
    "download-data",
    "--config",
    BACKTEST_PATHS.config,
    "--datadir",
    BACKTEST_PATHS.data,
    "--timerange",
    options.timerange,
    "--timeframes",
    options.timeframe,
  ];
}

export function buildBacktestCommand(options: { timerange: string }): string[] {
  return [
    "backtesting",
    "--config",
    BACKTEST_PATHS.config,
    "--datadir",
    BACKTEST_PATHS.data,
    "--strategy",
    STRATEGY_NAME,
    "--strategy-path",
    BACKTEST_PATHS.strategyDir,
    "--backtest-directory",
    BACKTEST_PATHS.results,
    "--timerange",
    options.timerange,
    "--export",
    "trades",
    // ÖNBELLEK KAPALI OLMAK ZORUNDA. Freqtrade sonuçları strateji DOSYASININ
    // hash'iyle önbelleğe alıyor; bizde o dosya bütün kural setleri için aynı
    // `universal_strategy.py`. Önbellek açık kalırsa bir kural setinin sonucu
    // bambaşka bir kural seti için geri döner ve hiçbir yerde hata vermez.
    "--cache",
    "none",
  ];
  // `--timeframe` KASITLI olarak yok: Freqtrade'de bu bayrak stratejinin
  // zaman dilimini ezer ve kural setinin sessizce yok sayılmasına yol açar.
}
