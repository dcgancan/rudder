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
 * Bir bot tanımından Freqtrade yapılandırması üretir.
 *
 * İki kural bu modülün tamamını belirliyor:
 *
 *  1. SIRLAR DOSYAYA YAZILMAZ. Borsa anahtarları `FREQTRADE__EXCHANGE__KEY`
 *     gibi ortam değişkenleriyle geçirilir. Üretilen config.json güvenle
 *     diske yazılabilir, loglanabilir, kullanıcıya gösterilebilir.
 *
 *  2. CONFIG, KURAL SETİNİ EZEMEZ. Freqtrade'de config değerleri strateji
 *     niteliklerini geçersiz kılar. `stoploss` ya da `timeframe` gibi bir
 *     anahtar yanlışlıkla config'e girerse, bot kural setinin risk ayarlarını
 *     sessizce yok sayar — ve bu hiçbir yerde hata vermez. `buildConfig`
 *     ürettiği nesneyi bu listeye karşı denetler ve ihlalde fırlatır.
 */

import { randomBytes } from "node:crypto";

/** Container içindeki sabit yollar. Orchestrator mount'ları buna göre kurar. */
export const CONTAINER_PATHS = {
  config: "/freqtrade/user_data/config.json",
  ruleset: "/freqtrade/ruleset.json",
  strategyDir: "/freqtrade/engine",
  userData: "/freqtrade/user_data",
} as const;

export const STRATEGY_NAME = "UniversalStrategy";

/**
 * Kural setine ait olan ve bu yüzden config'de ASLA görünmemesi gereken
 * anahtarlar. Freqtrade bunların hepsinde config'i stratejiden üstün tutar.
 */
export const RULESET_OWNED_KEYS = [
  "timeframe",
  "minimal_roi",
  "stoploss",
  "trailing_stop",
  "trailing_stop_positive",
  "trailing_stop_positive_offset",
  "trailing_only_offset_is_reached",
  "use_exit_signal",
  "use_custom_stoploss",
  "order_types",
  "ignore_roi_if_entry_signal",
  "exit_profit_only",
] as const;

export type BotSpec = {
  /** Freqtrade loglarında ve Telegram'da görünen ad. */
  name: string;
  exchange: string;
  mode: "paper" | "live";
  stakeCurrency: string;
  stakeAmount: number;
  maxOpenTrades: number;
  pairs: string[];
  /** Yalnızca paper modda kullanılır. */
  paperWallet?: number | null;
};

export type ApiCredentials = {
  /** Container İÇİNDEKİ port. Yayınlanan port orchestrator'ın işi. */
  port: number;
  username: string;
  password: string;
  jwtSecret: string;
  wsToken: string;
};

export type SecretEnvInput = {
  /** Container içindeki kural seti dosyasının yolu. */
  rulesetPath?: string;
  /** Yalnızca live modda. Paper modda verilmez. */
  exchangeKey?: string | null;
  exchangeSecret?: string | null;
};

export type FreqtradeConfig = Record<string, unknown>;

/** Her bot için ayrı üretilir; botlar arasında paylaşılmaz. */
export function generateApiCredentials(port: number): ApiCredentials {
  const secret = () => randomBytes(32).toString("base64url");
  return {
    port,
    username: "rudder",
    password: secret(),
    jwtSecret: secret(),
    wsToken: secret(),
  };
}

export function buildConfig(spec: BotSpec, api: ApiCredentials): FreqtradeConfig {
  if (spec.pairs.length === 0) throw new Error("a bot needs at least one pair");
  if (spec.stakeAmount <= 0) throw new Error("stakeAmount must be positive");
  if (spec.maxOpenTrades <= 0) throw new Error("maxOpenTrades must be positive");

  const isPaper = spec.mode === "paper";

  const config: FreqtradeConfig = {
    max_open_trades: spec.maxOpenTrades,
    stake_currency: spec.stakeCurrency,
    stake_amount: spec.stakeAmount,
    tradable_balance_ratio: 0.99,
    fiat_display_currency: "USD",

    dry_run: isPaper,
    ...(isPaper ? { dry_run_wallet: spec.paperWallet ?? 1000 } : {}),

    cancel_open_orders_on_exit: false,
    trading_mode: "spot",
    margin_mode: "",

    unfilledtimeout: { entry: 10, exit: 10, exit_timeout_count: 0, unit: "minutes" },

    entry_pricing: {
      price_side: "same",
      use_order_book: true,
      order_book_top: 1,
      price_last_balance: 0,
      check_depth_of_market: { enabled: false, bids_to_ask_delta: 1 },
    },
    exit_pricing: { price_side: "same", use_order_book: true, order_book_top: 1 },

    exchange: {
      name: spec.exchange,
      // key/secret KASITLI olarak yok — ortam değişkeninden gelir.
      ccxt_config: {},
      ccxt_async_config: {},
      pair_whitelist: spec.pairs,
      pair_blacklist: [],
    },

    pairlists: [{ method: "StaticPairList" }],

    api_server: {
      enabled: true,
      // Container içinde 0.0.0.0 dinlemek zorunda, yoksa yayınlanan port
      // çalışmaz. Dışarı açılmaması orchestrator'ın sorumluluğu: port yalnızca
      // 127.0.0.1'e yayınlanır.
      listen_ip_address: "0.0.0.0",
      listen_port: api.port,
      verbosity: "error",
      enable_openapi: false,
      jwt_secret_key: api.jwtSecret,
      ws_token: api.wsToken,
      CORS_origins: [],
      username: api.username,
      password: api.password,
    },

    bot_name: spec.name,
    initial_state: "running",
    // Arayüzdeki manuel al/sat için gerekli.
    force_entry_enable: true,
    internals: { process_throttle_secs: 5 },
  };

  assertNoRulesetOverrides(config);
  return config;
}

/**
 * Config'in kural setine ait bir anahtar içermediğini doğrular.
 *
 * Bu bir iç tutarlılık kontrolü: ihlal ederse bug bizdedir, kullanıcı girdisi
 * değil. Sessizce yanlış davranan bir bot üretmektense burada patlamak yeğdir.
 */
export function assertNoRulesetOverrides(config: FreqtradeConfig): void {
  const offending = RULESET_OWNED_KEYS.filter((key) => key in config);
  if (offending.length > 0) {
    throw new Error(
      `generated config would override the ruleset: ${offending.join(", ")}. ` +
        "These settings belong to the ruleset and must come from the strategy.",
    );
  }
}

/**
 * Config dosyasına girmeyen her şey. Container'a ortam değişkeni olarak geçer.
 *
 * Dönen nesne sır içerir: loglanmamalı, hata mesajlarına konmamalı.
 */
export function buildSecretEnv(input: SecretEnvInput): Record<string, string> {
  const env: Record<string, string> = {
    FT_RULESET: input.rulesetPath ?? CONTAINER_PATHS.ruleset,
  };

  if (input.exchangeKey) env["FREQTRADE__EXCHANGE__KEY"] = input.exchangeKey;
  if (input.exchangeSecret) env["FREQTRADE__EXCHANGE__SECRET"] = input.exchangeSecret;

  return env;
}

/** Container'a verilecek Freqtrade komutu. */
export function buildCommand(): string[] {
  return [
    "trade",
    "--config",
    CONTAINER_PATHS.config,
    "--strategy",
    STRATEGY_NAME,
    "--strategy-path",
    CONTAINER_PATHS.strategyDir,
  ];
}
