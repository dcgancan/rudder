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
 * Backtest kuyruğu.
 *
 * KUYRUK VERİTABANININ KENDİSİ. Bellekte ikinci bir liste tutulmuyor: sıradaki
 * iş her seferinde en eski `queued` satır olarak sorgulanıyor. Böylece süreç
 * ölüp geri geldiğinde bekleyen işler kaybolmuyor ve "listede var ama satırda
 * yok" gibi bir tutarsızlık mümkün değil.
 *
 * İşler SERİ çalışır. Backtest CPU-yoğun; ikisini aynı anda koşturmak ikisini
 * birden yavaşlatmaktan başka bir şey yapmaz.
 */

import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray } from "drizzle-orm";

import { backtests } from "@rudder/db";
import type { BacktestRow, Database } from "@rudder/db";
import { STANDARD_SETUP } from "@rudder/freqtrade";
import { listContainers, removeContainer } from "@rudder/host";

import { BACKTEST_LABEL, BacktestRunner } from "./runner.ts";
import type { RunnerOptions } from "./runner.ts";
import { timerangeFor } from "./timerange.ts";
import type { BacktestPeriod } from "./timerange.ts";

export type EnqueueInput = {
  /** Belirli bir kural seti SÜRÜMÜ — backtest'ler sürüme bağlıdır. */
  rulesetId: string;
  /** Ay cinsinden dönem. Arayüzün kullanıcıya sorduğu tek şey. */
  months: BacktestPeriod;
};

/**
 * Kuyruğun çalıştırıcıdan tek beklentisi.
 *
 * Bu dar arayüz sayesinde kuyruğun kendi mantığı — tekilleştirme, sıralama,
 * kurtarma — Docker'a hiç dokunmadan test edilebiliyor.
 */
export type BacktestExecutor = { run(backtestId: string): Promise<unknown> };

export type QueueOptions = RunnerOptions & { runner?: BacktestExecutor };

export class BacktestQueue {
  #db: Database;
  #runner: BacktestExecutor;
  #draining: Promise<void> | null = null;

  constructor(options: QueueOptions) {
    this.#db = options.db;
    this.#runner = options.runner ?? new BacktestRunner(options);
  }

  /**
   * Sıraya bir backtest koyar ve id'sini döndürür.
   *
   * Aynı kural seti için bekleyen ya da çalışan bir test varsa yenisi
   * açılmaz — mevcudun id'si döner. Butona iki kez basmak iki container
   * başlatmamalı.
   */
  enqueue(input: EnqueueInput): string {
    const active = this.#db
      .select()
      .from(backtests)
      .where(
        and(
          eq(backtests.rulesetId, input.rulesetId),
          inArray(backtests.status, ["queued", "running"]),
        ),
      )
      .get();

    if (active) return active.id;

    const id = randomUUID();
    this.#db
      .insert(backtests)
      .values({
        id,
        rulesetId: input.rulesetId,
        exchange: STANDARD_SETUP.exchange,
        pairs: [...STANDARD_SETUP.pairs],
        timerange: timerangeFor(input.months),
        status: "queued",
      })
      .run();

    void this.drain();
    return id;
  }

  /** Sıra boşalana kadar çalışır. Aynı anda yalnızca bir döngü döner. */
  drain(): Promise<void> {
    this.#draining ??= this.#loop().finally(() => {
      this.#draining = null;
    });
    return this.#draining;
  }

  async #loop(): Promise<void> {
    let previous: string | null = null;

    for (let next = this.#next(); next; next = this.#next()) {
      // `run()` her yolda satırı `queued`'dan çıkarır. Çıkarmadığı bir durum
      // kalırsa bu döngü sıkı bir sonsuz döngüye dönerdi; erken durmak yeğdir.
      if (next.id === previous) {
        throw new Error(`backtest ${next.id} stayed queued after running — stopping the queue`);
      }
      previous = next.id;

      await this.#runner.run(next.id);
    }
  }

  #next(): BacktestRow | undefined {
    return this.#db
      .select()
      .from(backtests)
      .where(eq(backtests.status, "queued"))
      .orderBy(asc(backtests.createdAt))
      .get();
  }

  /**
   * Önceki sürecin bıraktığı artıkları toplar.
   *
   * `running` bir satır, onu çalıştıran süreç öldüğünde sonsuza kadar öyle
   * kalır ve arayüzde "çalışıyor" görünür. Yeniden kuyruğa almak da doğru
   * değil: kullanıcı testi kendisi başlattı, sessizce tekrar başlatmak onun
   * kararı olmaz. Dürüst olan yarıda kaldığını söylemek.
   */
  async recover(): Promise<void> {
    this.#db
      .update(backtests)
      .set({ status: "failed", error: "interrupted", finishedAt: new Date() })
      .where(eq(backtests.status, "running"))
      .run();

    for (const name of await listContainers(BACKTEST_LABEL)) {
      await removeContainer(name);
    }

    // Bekleyenler duruyor olabilir — onlar hiç başlamadı, devam edilebilir.
    void this.drain();
  }
}
