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
 * Bir Freqtrade instance'ının REST API'si için tipli istemci.
 *
 * Erişim jetonunun ömrü 15 dakikadır; istemci 401 aldığında refresh jetonuyla
 * bir kez yeniler, o da olmazsa baştan giriş yapar. Çağıran tarafın jeton
 * yönetimiyle uğraşması gerekmez.
 *
 * Tip tanımları kasıtlı olarak eksiktir: Freqtrade'in döndürdüğü alanların
 * tamamı değil, yalnızca kullandıklarımız yazılıdır.
 */

export class FreqtradeApiError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string, path: string) {
    super(`Freqtrade API ${status} on ${path}: ${body.slice(0, 200)}`);
    this.name = "FreqtradeApiError";
    this.status = status;
    this.body = body;
  }
}

export type ClientOptions = {
  baseUrl: string;
  username: string;
  password: string;
  /** Tek bir isteğin zaman aşımı. */
  timeoutMs?: number;
};

export type OpenTrade = {
  trade_id: number;
  pair: string;
  is_open: boolean;
  open_rate: number;
  amount: number;
  stake_amount: number;
  open_timestamp: number;
  profit_ratio: number | null;
  profit_abs: number | null;
  enter_tag: string | null;
};

/** `/trades` çıktısı. Kapanmış işlemler buradan aynalanır. */
export type ClosedTrade = OpenTrade & {
  close_rate: number | null;
  close_timestamp: number | null;
  exit_reason: string | null;
};

export type Profit = {
  profit_closed_coin: number;
  profit_closed_percent: number;
  profit_all_coin: number;
  profit_all_percent: number;
  trade_count: number;
  closed_trade_count: number;
  winning_trades: number;
  losing_trades: number;
};

export type Balance = {
  total: number;
  total_bot: number;
  stake: string;
  starting_capital: number;
  currencies: { currency: string; free: number; balance: number; est_stake: number }[];
};

export type Count = { current: number; max: number; total_stake: number };

export type Health = { last_process_ts: number | null; bot_start_ts: number | null };

export type BotState = {
  state: string;
  dry_run: boolean;
  strategy: string;
  timeframe: string;
  stoploss: number;
  minimal_roi: Record<string, number>;
  max_open_trades: number;
  stake_currency: string;
  stake_amount: number | string;
};

export class FreqtradeClient {
  #baseUrl: string;
  #username: string;
  #password: string;
  #timeoutMs: number;
  #accessToken: string | null = null;
  #refreshToken: string | null = null;

  constructor(options: ClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/$/, "");
    this.#username = options.username;
    this.#password = options.password;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
  }

  // ----------------------------------------------------------------- //
  // Kimlik doğrulama
  // ----------------------------------------------------------------- //

  async login(): Promise<void> {
    const basic = Buffer.from(`${this.#username}:${this.#password}`).toString("base64");
    const body = await this.#fetch<{ access_token: string; refresh_token: string }>(
      "/api/v1/token/login",
      { method: "POST", headers: { Authorization: `Basic ${basic}` } },
    );
    this.#accessToken = body.access_token;
    this.#refreshToken = body.refresh_token;
  }

  async #refresh(): Promise<boolean> {
    if (!this.#refreshToken) return false;
    try {
      const body = await this.#fetch<{ access_token: string }>("/api/v1/token/refresh", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.#refreshToken}` },
      });
      this.#accessToken = body.access_token;
      return true;
    } catch {
      return false;
    }
  }

  // ----------------------------------------------------------------- //
  // Uçlar
  // ----------------------------------------------------------------- //

  /** Kimlik doğrulaması gerektirmez — canlılık kontrolü için. */
  async ping(): Promise<boolean> {
    try {
      await this.#fetch<{ status: string }>("/api/v1/ping", {});
      return true;
    } catch {
      return false;
    }
  }

  health = (): Promise<Health> => this.#authed<Health>("/api/v1/health");
  status = (): Promise<OpenTrade[]> => this.#authed<OpenTrade[]>("/api/v1/status");
  profit = (): Promise<Profit> => this.#authed<Profit>("/api/v1/profit");
  balance = (): Promise<Balance> => this.#authed<Balance>("/api/v1/balance");
  count = (): Promise<Count> => this.#authed<Count>("/api/v1/count");
  showConfig = (): Promise<BotState> => this.#authed<BotState>("/api/v1/show_config");

  /** Freqtrade çağrı başına en fazla 500 işlem döndürür. */
  async trades(options: { limit?: number; offset?: number } = {}) {
    const query = new URLSearchParams({
      limit: String(options.limit ?? 500),
      offset: String(options.offset ?? 0),
    });
    return this.#authed<{ trades: ClosedTrade[]; total_trades: number }>(
      `/api/v1/trades?${query}`,
    );
  }

  start = (): Promise<{ status: string }> =>
    this.#authed<{ status: string }>("/api/v1/start", { method: "POST" });

  stop = (): Promise<{ status: string }> =>
    this.#authed<{ status: string }>("/api/v1/stop", { method: "POST" });

  /** Yeni pozisyon açmayı durdurur, açık olanları normal şekilde kapatır. */
  stopEntry = (): Promise<{ status: string }> =>
    this.#authed<{ status: string }>("/api/v1/stopentry", { method: "POST" });

  /**
   * Pozisyon kapatır. `"all"` tüm açık pozisyonları kapatır.
   *
   * Emir tipi stratejide `market` olarak sabitlenmiştir — limit emir asılı
   * kalabilir ve "hemen sat" davranışının gerçekten hemen olması gerekir.
   */
  forceExit = (tradeId: number | "all"): Promise<{ result: string }> =>
    this.#authed<{ result: string }>("/api/v1/forceexit", {
      method: "POST",
      body: JSON.stringify({ tradeid: String(tradeId) }),
      headers: { "Content-Type": "application/json" },
    });

  forceEnter = (pair: string, side: "long" | "short" = "long") =>
    this.#authed<Record<string, unknown>>("/api/v1/forceenter", {
      method: "POST",
      body: JSON.stringify({ pair, side }),
      headers: { "Content-Type": "application/json" },
    });

  // ----------------------------------------------------------------- //
  // Taşıma
  // ----------------------------------------------------------------- //

  /** Jeton yoksa giriş yapar, 401'de bir kez yenileyip tekrar dener. */
  async #authed<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.#accessToken) await this.login();

    try {
      return await this.#fetch<T>(path, this.#withToken(init));
    } catch (error) {
      if (!(error instanceof FreqtradeApiError) || error.status !== 401) throw error;

      if (!(await this.#refresh())) await this.login();
      return this.#fetch<T>(path, this.#withToken(init));
    }
  }

  #withToken(init: RequestInit): RequestInit {
    return {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${this.#accessToken}` },
    };
  }

  async #fetch<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.#baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(this.#timeoutMs),
    });

    if (!response.ok) {
      throw new FreqtradeApiError(response.status, await response.text(), path);
    }
    return (await response.json()) as T;
  }
}
