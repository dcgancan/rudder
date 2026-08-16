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
 * Bot satırlarını çalışan Freqtrade container'larına çevirir ve geri okur.
 *
 * Bot API kimlik bilgileri veritabanında TUTULMAZ. Freqtrade bunları zaten
 * config.json'da görmek zorunda; ikinci bir kopya çıkarmak, koruma alanını
 * genişletmekten başka işe yaramaz. Bir botla konuşmak gerektiğinde kimlik
 * bilgileri o botun config dosyasından okunur.
 */

import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { and, eq, isNotNull, isNull, ne } from "drizzle-orm";

import { bots, rulesets, trades } from "@rudder/db";
import type { Database, BotRow } from "@rudder/db";
import {
  buildCommand,
  buildConfig,
  buildSecretEnv,
  CONTAINER_PATHS,
  FreqtradeClient,
  generateApiCredentials,
} from "@rudder/freqtrade";
import type { ApiCredentials, BotSpec } from "@rudder/freqtrade";

import {
  containerLogs,
  inspectContainer,
  removeContainer,
  runContainer,
  stopContainer,
} from "./docker.ts";
import { botPaths, containerName, dataRoot } from "./paths.ts";
import { allocatePort, DEFAULT_PORT_RANGE } from "./ports.ts";

export const DEFAULT_IMAGE = "freqtradeorg/freqtrade:stable";
export const BOT_LABEL = "rudder.bot";

/**
 * Host üzerinde `universal_strategy.py`'nin bulunduğu dizin.
 *
 * Modül yüklenirken DEĞİL, ihtiyaç duyulduğunda hesaplanır: bu modül bir
 * bundler'dan geçtiğinde `import.meta.dirname` tanımsız olur ve modül seviyesi
 * bir `resolve()` çağrısı, orchestrator hiç kullanılmasa bile uygulamayı
 * çökertir.
 */
function defaultEngineDir(): string {
  const configured = process.env["RUDDER_ENGINE_DIR"];
  if (configured) return resolve(configured);

  if (!import.meta.dirname) {
    throw new Error(
      "cannot locate the engine directory from a bundled build — set RUDDER_ENGINE_DIR",
    );
  }
  return resolve(import.meta.dirname, "../../../engine");
}

export type OrchestratorOptions = {
  db: Database;
  image?: string;
  dataRoot?: string;
  /** Host üzerinde `universal_strategy.py`'nin bulunduğu dizin. */
  engineDir?: string;
  portRange?: readonly [number, number];
};

export class BotNotFoundError extends Error {
  constructor(botId: string) {
    super(`no such bot: ${botId}`);
    this.name = "BotNotFoundError";
  }
}

export class Orchestrator {
  #db: Database;
  #image: string;
  #root: string;
  #engineDir: string | undefined;
  #portRange: readonly [number, number];

  constructor(options: OrchestratorOptions) {
    this.#db = options.db;
    this.#image = options.image ?? DEFAULT_IMAGE;
    this.#root = options.dataRoot ?? dataRoot();
    this.#engineDir = options.engineDir;
    this.#portRange = options.portRange ?? DEFAULT_PORT_RANGE;
  }

  get #engine(): string {
    return this.#engineDir ?? defaultEngineDir();
  }

  // ----------------------------------------------------------------- //
  // Yaşam döngüsü
  // ----------------------------------------------------------------- //

  /**
   * Botu ayağa kaldırır ve `starting` durumuna geçirir.
   *
   * Container hazır olana kadar BEKLEMEZ — Freqtrade'in borsa piyasalarını
   * yüklemesi saniyeler sürüyor ve bir web isteğini o kadar bekletmek doğru
   * değil. Hazır olduğunu görmek için `refreshStatus()` ya da
   * `waitUntilRunning()` kullanılır.
   */
  async start(botId: string): Promise<void> {
    const bot = this.#requireBot(botId);
    const name = containerName(botId);

    const existing = await inspectContainer(name);
    if (existing?.running) return;
    if (existing) await removeContainer(name);

    const ruleset = this.#db
      .select()
      .from(rulesets)
      .where(eq(rulesets.id, bot.rulesetId))
      .get();
    if (!ruleset) throw new Error(`bot ${botId} references a missing ruleset`);

    const port = await allocatePort(this.#portsInUse(botId), this.#portRange);
    const api = generateApiCredentials(8080);
    const paths = botPaths(botId, this.#root);

    await mkdir(paths.userData, { recursive: true, mode: 0o700 });
    await chmod(paths.root, 0o700);
    await writeFile(paths.ruleset, JSON.stringify(ruleset.body, null, 2), { mode: 0o600 });
    // config.json API parolasını içerir.
    await writeFile(paths.config, JSON.stringify(buildConfig(toSpec(bot), api), null, 2), {
      mode: 0o600,
    });

    let containerId: string;
    try {
      containerId = await runContainer({
        name,
        image: this.#image,
        command: buildCommand(),
        mounts: [
          { host: paths.userData, container: CONTAINER_PATHS.userData },
          { host: paths.ruleset, container: CONTAINER_PATHS.ruleset, readonly: true },
          { host: this.#engine, container: CONTAINER_PATHS.strategyDir, readonly: true },
        ],
        // Paper modda borsa anahtarı yok; live mod şifre çözmeyi gerektirir ve
        // henüz uygulanmadı.
        env: buildSecretEnv({}),
        publish: [{ hostPort: port, containerPort: 8080 }],
        labels: { [BOT_LABEL]: botId },
      });
    } catch (error) {
      this.#update(botId, { status: "error", lastError: String(error) });
      throw error;
    }

    this.#update(botId, {
      status: "starting",
      containerId,
      apiPort: port,
      lastError: null,
    });
  }

  async stop(botId: string): Promise<void> {
    this.#requireBot(botId);
    this.#update(botId, { status: "stopping" });

    await stopContainer(containerName(botId));

    this.#update(botId, { status: "stopped", containerId: null, apiPort: null });
  }

  /** Container'ı ve bot dizinini kaldırır, satırı soft-delete eder. */
  async remove(botId: string): Promise<void> {
    this.#requireBot(botId);

    await removeContainer(containerName(botId));
    await rm(botPaths(botId, this.#root).root, { recursive: true, force: true });

    this.#update(botId, {
      status: "stopped",
      containerId: null,
      apiPort: null,
      deletedAt: new Date(),
    });
  }

  // ----------------------------------------------------------------- //
  // Durum
  // ----------------------------------------------------------------- //

  /** Container ve API'ye bakıp satırdaki durumu gerçeğe eşitler. */
  async refreshStatus(botId: string): Promise<BotRow["status"]> {
    const bot = this.#requireBot(botId);
    const state = await inspectContainer(containerName(botId));

    if (!state) {
      this.#update(botId, { status: "stopped", containerId: null });
      return "stopped";
    }

    if (!state.running) {
      // Sıfırdan farklı çıkış kodu botun çöktüğü anlamına gelir; sebebi
      // kullanıcıya gösterilebilmesi için logdan alınır.
      if (state.exitCode !== 0) {
        const logs = await containerLogs(containerName(botId));
        this.#update(botId, { status: "error", lastError: logs.slice(-2000) });
        return "error";
      }
      this.#update(botId, { status: "stopped" });
      return "stopped";
    }

    const reachable = bot.apiPort ? await this.#clientFor(bot).then((c) => c.ping()) : false;
    if (!reachable) {
      // Container ayakta ama API henüz cevap vermiyor — hâlâ açılıyor.
      this.#update(botId, { status: "starting" });
      return "starting";
    }

    this.#update(botId, { status: "running", lastSeenAt: new Date(), lastError: null });
    return "running";
  }

  async waitUntilRunning(botId: string, timeoutMs = 120_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const status = await this.refreshStatus(botId);
      if (status === "running") return;
      if (status === "error") {
        const bot = this.#requireBot(botId);
        throw new Error(`bot ${botId} failed to start:\n${bot.lastError ?? "no logs"}`);
      }
      await sleep(1000);
    }

    throw new Error(`bot ${botId} did not become ready within ${timeoutMs}ms`);
  }

  /**
   * Bu botun API istemcisi.
   *
   * Kimlik bilgileri veritabanından değil, botun kendi config.json'ından
   * okunur — tek kopya orada durur.
   */
  async client(botId: string): Promise<FreqtradeClient> {
    return this.#clientFor(this.#requireBot(botId));
  }

  // ----------------------------------------------------------------- //
  // İşlem senkronizasyonu
  // ----------------------------------------------------------------- //

  /**
   * Kapanmış işlemleri bot API'sinden çekip aynalar.
   *
   * `(bot_id, ft_trade_id)` üzerinde upsert eder, yani tekrar tekrar
   * çalıştırmak güvenlidir. Açık pozisyonlar aynalanmaz: onların tek doğruluk
   * kaynağı botun kendisidir.
   */
  async syncTrades(botId: string): Promise<number> {
    const client = await this.client(botId);
    const { trades: fetched } = await client.trades({ limit: 500 });

    const closed = fetched.filter((trade) => !trade.is_open && trade.close_timestamp);
    if (closed.length === 0) return 0;

    for (const trade of closed) {
      const values = {
        botId,
        ftTradeId: trade.trade_id,
        pair: trade.pair,
        openedAt: new Date(trade.open_timestamp),
        closedAt: trade.close_timestamp ? new Date(trade.close_timestamp) : null,
        openRate: trade.open_rate,
        closeRate: trade.close_rate,
        amount: trade.amount,
        stakeAmount: trade.stake_amount,
        profitAbs: trade.profit_abs,
        profitRatio: trade.profit_ratio,
        exitReason: trade.exit_reason,
        enterTag: trade.enter_tag,
        syncedAt: new Date(),
      };

      this.#db
        .insert(trades)
        .values({ id: crypto.randomUUID(), ...values })
        .onConflictDoUpdate({ target: [trades.botId, trades.ftTradeId], set: values })
        .run();
    }

    return closed.length;
  }

  // ----------------------------------------------------------------- //
  // İç yardımcılar
  // ----------------------------------------------------------------- //

  #requireBot(botId: string): BotRow {
    const bot = this.#db
      .select()
      .from(bots)
      .where(and(eq(bots.id, botId), isNull(bots.deletedAt)))
      .get();
    if (!bot) throw new BotNotFoundError(botId);
    return bot;
  }

  #update(botId: string, values: Partial<BotRow>): void {
    this.#db
      .update(bots)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(bots.id, botId))
      .run();
  }

  /** Başka botlara atanmış portlar — yeniden kullanılmasınlar. */
  #portsInUse(exceptBotId: string): number[] {
    return this.#db
      .select({ port: bots.apiPort })
      .from(bots)
      .where(and(isNotNull(bots.apiPort), ne(bots.id, exceptBotId), isNull(bots.deletedAt)))
      .all()
      .map((row) => row.port)
      .filter((port): port is number => port !== null);
  }

  async #clientFor(bot: BotRow): Promise<FreqtradeClient> {
    if (!bot.apiPort) throw new Error(`bot ${bot.id} has no API port — is it running?`);

    const api = await readApiCredentials(botPaths(bot.id, this.#root).config);
    return new FreqtradeClient({
      baseUrl: `http://127.0.0.1:${bot.apiPort}`,
      username: api.username,
      password: api.password,
    });
  }
}

/** Botun config dosyasından API kimlik bilgilerini okur. */
export async function readApiCredentials(configPath: string): Promise<ApiCredentials> {
  // Config JSON'ı snake_case; ApiCredentials camelCase. Alan adları burada
  // eşleşmek zorunda — yanlış yazılan bir anahtar sessizce undefined döner.
  type ApiServerSection = {
    listen_port?: number;
    username?: string;
    password?: string;
    jwt_secret_key?: string;
    ws_token?: string;
  };

  const config = JSON.parse(await readFile(configPath, "utf8")) as {
    api_server?: ApiServerSection;
  };
  const server = config.api_server;

  if (!server?.username || !server.password) {
    throw new Error(`no API credentials in ${configPath}`);
  }

  return {
    port: server.listen_port ?? 8080,
    username: server.username,
    password: server.password,
    jwtSecret: server.jwt_secret_key ?? "",
    wsToken: server.ws_token ?? "",
  };
}

function toSpec(bot: BotRow): BotSpec {
  return {
    name: bot.name,
    exchange: bot.exchange,
    mode: bot.mode,
    stakeCurrency: bot.stakeCurrency,
    stakeAmount: bot.stakeAmount,
    maxOpenTrades: bot.maxOpenTrades,
    pairs: bot.pairs,
    paperWallet: bot.paperWallet,
  };
}
