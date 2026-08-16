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
import { setTimeout as sleep } from "node:timers/promises";

import { and, desc, eq, isNotNull, isNull, ne } from "drizzle-orm";

import { botEvents, bots, rulesets, trades } from "@rudder/db";
import type { Database, BotRow } from "@rudder/db";
import {
  buildCommand,
  buildConfig,
  buildSecretEnv,
  CONTAINER_PATHS,
  FreqtradeClient,
  generateApiCredentials,
  STANDARD_SETUP,
} from "@rudder/freqtrade";
import type { ApiCredentials, BotSpec } from "@rudder/freqtrade";
import {
  containerLogs,
  dataRoot,
  engineDir,
  inspectContainer,
  listContainers,
  removeContainer,
  runContainer,
  stopContainer,
} from "@rudder/host";

import { botPaths, containerName } from "./paths.ts";
import { classify, eventsFor } from "./health.ts";
import type { Snapshot } from "./health.ts";
import { allocatePort, DEFAULT_PORT_RANGE } from "./ports.ts";

export const DEFAULT_IMAGE = "freqtradeorg/freqtrade:stable";
export const BOT_LABEL = "rudder.bot";

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
    return this.#engineDir ?? engineDir();
  }

  // ----------------------------------------------------------------- //
  // Yaşam döngüsü
  // ----------------------------------------------------------------- //

  /**
   * Bot satırını yazar ve id'sini döndürür. Container BAŞLATMAZ.
   *
   * Ayarlar `STANDARD_SETUP`'tan gelir, yani bot stratejinin ÖLÇÜLDÜĞÜ
   * ayarlarla çalışır. Kullanıcıya sorulan tek şey ad: ölçümün ayarlarından
   * sapan bir bot, ekranda gördüğü sayıyı kendi sayısı olmaktan çıkarır.
   *
   * Mod her zaman `paper`. Gerçek parayla işlem borsa anahtarlarının
   * şifresini çözmeyi gerektiriyor ve `packages/crypto` yazılmadı.
   */
  create(input: { rulesetId: string; name: string }): string {
    const name = input.name.trim();
    if (!name) throw new Error("a bot needs a name");

    const ruleset = this.#db
      .select()
      .from(rulesets)
      .where(eq(rulesets.id, input.rulesetId))
      .get();
    if (!ruleset) throw new Error(`no such ruleset: ${input.rulesetId}`);

    const id = crypto.randomUUID();

    this.#db
      .insert(bots)
      .values({
        id,
        name,
        rulesetId: input.rulesetId,
        mode: "paper",
        exchange: STANDARD_SETUP.exchange,
        stakeCurrency: STANDARD_SETUP.stakeCurrency,
        stakeAmount: STANDARD_SETUP.stake,
        maxOpenTrades: STANDARD_SETUP.maxOpenTrades,
        pairs: [...STANDARD_SETUP.pairs],
        paperWallet: STANDARD_SETUP.wallet,
      })
      .run();

    return id;
  }

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
      // Yeni container, yeni sayaç. Sıfırlanmazsa eski yüksek değer, gerçek
      // yeniden başlatmaları o değeri aşana kadar gizlerdi.
      restartCount: 0,
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

  /**
   * Container ve API'ye bakıp satırdaki durumu gerçeğe eşitler.
   *
   * Sınıflandırma kuralları `health.ts`'te ve SAF; burada kalan yalnızca
   * gözlemi toplamak, sonucu yazmak ve değişimi olay kaydına geçmek.
   *
   * Olaylar gözcüde değil BURADA yazılıyor. Sebep: sayfa okuması da tazeleme
   * yapıyor, ve iki ayrı yerde yazılan bir kayıt iki farklı sonuç verirdi.
   * Gözcü yalnızca kalp atışını sağlıyor.
   */
  async refreshStatus(botId: string): Promise<BotRow["status"]> {
    const bot = this.#requireBot(botId);
    const state = await inspectContainer(containerName(botId));

    // API yalnızca container ayaktayken sorulur; durmuş bir bota atılan ping
    // her tazelemeye bir zaman aşımı eklemekten başka işe yaramaz.
    //
    // Config dosyası okunamazsa "cevap vermiyor" sayılır, hata fırlatılmaz:
    // gözcü bunu saniyede bir çağırıyor ve fırlatan bir tazeleme satırı
    // sonsuza kadar eski halinde bırakırdı. Container'ın kendisi zaten
    // birincil sinyal.
    const reachable =
      state?.running && bot.apiPort
        ? await this.#clientFor(bot)
            .then((client) => client.ping())
            .catch(() => false)
        : false;

    const status = classify({ state, reachable });
    const detail = status === "error" ? await containerLogs(containerName(botId)) : null;

    this.#record(botId, { status, restartCount: state?.restartCount ?? 0 }, detail, state !== null);
    return status;
  }

  /**
   * Yeni durumu ve doğurduğu olayları yazar.
   *
   * SENKRON, ve satır burada YENİDEN okunuyor. `refreshStatus` hem sayfa
   * okumasından hem gözcüden çağrılıyor; ikisi arasında `await` varken satırı
   * baştan taşımak, aynı geçişi iki kez olay kaydına yazmaya yol açardı.
   * Bu blokta hiç `await` olmadığı için araya başka bir çağrı giremez.
   */
  #record(botId: string, next: Snapshot, detail: string | null, exists: boolean): void {
    const current = this.#db.select().from(bots).where(eq(bots.id, botId)).get();
    if (!current) return;

    const latest =
      this.#db
        .select({ kind: botEvents.kind })
        .from(botEvents)
        .where(eq(botEvents.botId, botId))
        .orderBy(desc(botEvents.at))
        .limit(1)
        .get()?.kind ?? null;

    for (const kind of eventsFor(current, next, latest)) {
      this.#db
        .insert(botEvents)
        .values({
          id: crypto.randomUUID(),
          botId,
          kind,
          detail: detail?.slice(-2000) ?? null,
          at: new Date(),
        })
        .run();
    }

    this.#update(botId, {
      status: next.status,
      // Sayaç yalnızca bot SAĞLIKLI iken ilerler. Gerekçesi `Snapshot`'ta:
      // her yoklamada saklamak, tek bir crash loop'u art arda "yeniden
      // başladı" satırlarına çeviriyordu.
      ...(next.status === "running" ? { restartCount: next.restartCount } : {}),
      // Container gitmişse elde tutulan id ölü bir referans.
      ...(exists ? {} : { containerId: null }),
      ...(next.status === "error" ? { lastError: detail?.slice(-2000) ?? null } : {}),
      ...(next.status === "running" ? { lastSeenAt: new Date(), lastError: null } : {}),
    });
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
   * Bütün botları gerçeğe eşitler ve sahipsiz container'ları kaldırır.
   *
   * Durum yalnızca `refreshStatus()` çağrıldığında güncelleniyor, yani süreç
   * ölüp geri geldiğinde satırlar son bilinen hallerinde kalıyor: makine
   * yeniden başlamışsa `running` yazan bir botun container'ı çoktan gitmiş
   * olabilir. Durum artık ekranda görüldüğü için bu yalan bir kullanıcıya
   * gösterilen yalan.
   *
   * Uygulama açılışında bir kez çağrılır. Hiçbir botu başlatmaz ya da
   * durdurmaz — yalnızca ne olduğunu yazar.
   */
  async reconcile(): Promise<void> {
    const known = this.#db
      .select({ id: bots.id })
      .from(bots)
      .where(isNull(bots.deletedAt))
      .all();

    for (const bot of known) {
      // Bir botun okunamaması diğerlerini engellememeli.
      await this.refreshStatus(bot.id).catch(() => undefined);
    }

    // Silinmiş ya da hiç tanınmayan botlara ait container'lar geride kalmış
    // olabilir; portu ve adı tutuyorlar.
    const live = new Set(known.map((bot) => containerName(bot.id)));

    for (const name of await listContainers(BOT_LABEL)) {
      if (!live.has(name)) await removeContainer(name);
    }
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
