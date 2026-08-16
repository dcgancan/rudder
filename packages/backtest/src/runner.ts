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
 * Bir backtest satırını baştan sona yürütür.
 *
 * İki container adımı var — önce mum verisi indirilir, sonra backtest koşar —
 * ve ikisi de tek seferliktir. Aralarındaki tek durum diskteki mum verisi.
 *
 * Başarısız bir çalıştırmanın dizini SİLİNMEZ. `run.log` hata teşhisinin tek
 * kaynağı ve container gittikten sonra geriye kalan tek şey o.
 */

import { appendFile, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { eq } from "drizzle-orm";

import { backtests, rulesets } from "@rudder/db";
import type { BacktestRow, Database } from "@rudder/db";
import { STANDARD_SETUP } from "@rudder/freqtrade";
import { DockerError, engineDir, runOnce } from "@rudder/host";
import type { Ruleset } from "@rudder/ruleset";

import {
  BACKTEST_PATHS,
  buildBacktestCommand,
  buildBacktestConfig,
  buildDownloadCommand,
} from "./config.ts";
import { backtestPaths, containerName, marketDataDir } from "./paths.ts";
import { parseResult } from "./result.ts";
import { downloadTimerange } from "./timerange.ts";
import { readZipEntry } from "./zip.ts";

export const DEFAULT_IMAGE = "freqtradeorg/freqtrade:stable";
export const BACKTEST_LABEL = "rudder.backtest";

/** Mum indirme borsaya bağlı; backtest'in kendisi CPU'ya. Ayrı bütçeler. */
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;
const BACKTEST_TIMEOUT_MS = 30 * 60_000;

/** `error` sütununa yazılan log kuyruğu. */
const ERROR_TAIL = 2000;

export type RunnerOptions = {
  db: Database;
  image?: string;
  dataRoot?: string;
  /** Host üzerinde `universal_strategy.py`'nin bulunduğu dizin. */
  engineDir?: string;
  downloadTimeoutMs?: number;
  backtestTimeoutMs?: number;
};

export class BacktestNotFoundError extends Error {
  constructor(id: string) {
    super(`no such backtest: ${id}`);
    this.name = "BacktestNotFoundError";
  }
}

export class BacktestRunner {
  #db: Database;
  #image: string;
  #root: string | undefined;
  #engineDir: string | undefined;
  #downloadTimeoutMs: number;
  #backtestTimeoutMs: number;

  constructor(options: RunnerOptions) {
    this.#db = options.db;
    this.#image = options.image ?? DEFAULT_IMAGE;
    this.#root = options.dataRoot;
    this.#engineDir = options.engineDir;
    this.#downloadTimeoutMs = options.downloadTimeoutMs ?? DOWNLOAD_TIMEOUT_MS;
    this.#backtestTimeoutMs = options.backtestTimeoutMs ?? BACKTEST_TIMEOUT_MS;
  }

  /**
   * Satırı `running` yapar, container'ları çalıştırır, sonucu yazar.
   *
   * Dakikalar sürer. Fırlatmaz: her sonuç satıra yazılır, çünkü çağıran bir
   * kuyruk döngüsü ve bir backtest'in patlaması sıradakini engellememeli.
   */
  async run(backtestId: string): Promise<BacktestRow["status"]> {
    const paths = backtestPaths(backtestId, this.#root);

    try {
      const { row, ruleset } = this.#load(backtestId);
      this.#update(backtestId, { status: "running", error: null });

      await this.#prepare(backtestId, row, ruleset);

      const timeframe = ruleset.timeframe;
      const dataDir = marketDataDir(row.exchange, this.#root);
      await mkdir(dataDir, { recursive: true, mode: 0o700 });

      await this.#step(paths.log, "download-data", () =>
        runOnce({
          name: containerName(backtestId, "download"),
          image: this.#image,
          command: buildDownloadCommand({
            timerange: downloadTimerange(row.timerange, timeframe),
            timeframe,
          }),
          mounts: [
            { host: paths.config, container: BACKTEST_PATHS.config, readonly: true },
            { host: dataDir, container: BACKTEST_PATHS.data },
          ],
          labels: { [BACKTEST_LABEL]: backtestId },
          timeoutMs: this.#downloadTimeoutMs,
        }),
      );

      await this.#step(paths.log, "backtesting", () =>
        runOnce({
          name: containerName(backtestId, "backtest"),
          image: this.#image,
          command: buildBacktestCommand({ timerange: row.timerange }),
          mounts: [
            { host: paths.config, container: BACKTEST_PATHS.config, readonly: true },
            { host: paths.ruleset, container: BACKTEST_PATHS.ruleset, readonly: true },
            { host: this.#engine, container: BACKTEST_PATHS.strategyDir, readonly: true },
            { host: dataDir, container: BACKTEST_PATHS.data },
            { host: paths.results, container: BACKTEST_PATHS.results },
          ],
          // Kural setinin yolu değersiz `-e KEY` biçimiyle geçer; sır olmasa da
          // container'a değer aktarmanın tek yolu bu kalsın.
          env: { FT_RULESET: BACKTEST_PATHS.ruleset },
          labels: { [BACKTEST_LABEL]: backtestId },
          timeoutMs: this.#backtestTimeoutMs,
        }),
      );

      const { metrics, summary } = parseResult(await this.#readResult(paths.results));

      this.#update(backtestId, {
        status: "done",
        ...metrics,
        result: summary,
        finishedAt: new Date(),
        error: null,
      });
      return "done";
    } catch (error) {
      await this.#recordFailure(backtestId, paths.log, error);
      return "failed";
    }
  }

  // ----------------------------------------------------------------- //
  // Adımlar
  // ----------------------------------------------------------------- //

  #load(backtestId: string): { row: BacktestRow; ruleset: Ruleset } {
    const row = this.#db.select().from(backtests).where(eq(backtests.id, backtestId)).get();
    if (!row) throw new BacktestNotFoundError(backtestId);

    const stored = this.#db.select().from(rulesets).where(eq(rulesets.id, row.rulesetId)).get();
    if (!stored) throw new Error(`backtest ${backtestId} references a missing ruleset`);

    return { row, ruleset: stored.body };
  }

  /** Dizinleri ve container'ın göreceği iki dosyayı yazar. */
  async #prepare(backtestId: string, row: BacktestRow, ruleset: Ruleset): Promise<void> {
    const paths = backtestPaths(backtestId, this.#root);

    await mkdir(paths.results, { recursive: true, mode: 0o700 });
    await chmod(paths.root, 0o700);

    await writeFile(paths.ruleset, JSON.stringify(ruleset, null, 2), { mode: 0o600 });
    await writeFile(
      paths.config,
      JSON.stringify(
        buildBacktestConfig({ ...STANDARD_SETUP, exchange: row.exchange, pairs: row.pairs }),
        null,
        2,
      ),
      { mode: 0o600 },
    );
  }

  async #step(logPath: string, label: string, work: () => Promise<string>): Promise<void> {
    await appendFile(logPath, `\n===== ${label} =====\n`);
    try {
      await appendFile(logPath, `${await work()}\n`);
    } catch (error) {
      if (error instanceof DockerError && error.output) {
        await appendFile(logPath, `${error.output}\n`);
      }
      throw error;
    }
  }

  /**
   * Freqtrade'in ürettiği zip'i bulup içindeki sonuç JSON'ını okur.
   *
   * Dosya adı zaman damgalı ve `--export-filename` kullanımdan kalktığı için
   * sabitlenemiyor; dizindeki `.last_result.json` sonuncuyu işaret ediyor.
   */
  async #readResult(resultsDir: string): Promise<unknown> {
    const pointer = JSON.parse(
      await readFile(join(resultsDir, ".last_result.json"), "utf8"),
    ) as { latest_backtest?: string };

    if (!pointer.latest_backtest) {
      throw new Error("freqtrade wrote no result file — see run.log");
    }

    const archivePath = join(resultsDir, pointer.latest_backtest);
    const archive = await readFile(archivePath);

    // Zip içinde arşivle aynı adı taşıyan `.json` sonuç dosyasıdır; yanındaki
    // `_config.json` ve `.feather` dosyaları bizi ilgilendirmiyor.
    const wanted = basename(archivePath).replace(/\.zip$/, ".json");
    return JSON.parse(readZipEntry(archive, (name) => name === wanted).toString("utf8"));
  }

  async #recordFailure(backtestId: string, logPath: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await appendFile(logPath, `\n===== failed =====\n${message}\n`).catch(() => {});

    // Kullanıcıya gösterilecek olan bu değil; ham metin teşhis içindir ve
    // arayüz onu ayrı bir teknik detay bloğunda tutar.
    const detail = error instanceof DockerError && error.output ? error.output : message;

    this.#update(backtestId, {
      status: "failed",
      error: detail.slice(-ERROR_TAIL),
      finishedAt: new Date(),
    });
  }

  #update(backtestId: string, values: Partial<BacktestRow>): void {
    this.#db.update(backtests).set(values).where(eq(backtests.id, backtestId)).run();
  }

  get #engine(): string {
    return this.#engineDir ?? engineDir();
  }
}
