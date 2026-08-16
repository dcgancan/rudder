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
 * Çalışan botları arka planda yoklar.
 *
 * BU DOSYADA KARAR YOK — yalnızca kalp atışı var. Ne olduğuna karar veren ve
 * olay kaydını yazan yer `refreshStatus()`; gözcü onu kimse sayfaya bakmasa da
 * çağırıyor. İkinci bir yerde karar vermek, aynı geçişin iki farklı sonuç
 * vermesi demek olurdu.
 *
 * Gözcü HİÇBİR BOTA MÜDAHALE ETMEZ. Çöküp duran bir botu durdurmaz, düşen bir
 * botu başlatmaz. `reconcile()` için yazılmış ilkenin aynısı: ne olduğunu
 * yazar, kullanıcının yerine karar vermez.
 */

import { and, isNull, ne } from "drizzle-orm";

import { bots } from "@rudder/db";
import type { Database } from "@rudder/db";

import type { BotStatus } from "./health.ts";

/**
 * Yoklama aralığı.
 *
 * Ölçüldü: bir `docker inspect` çağrısı **12,4 ms** (20 çağrının ortalaması,
 * Colima). Yani on botluk bir tık ~124 ms sürüyor ve on beş saniyede bir
 * çalışınca makinenin %1'inden azını kullanıyor.
 *
 * Daha sık yoklamanın kazandıracağı bir şey yok: arayüz zaten 5-10 saniyede
 * bir kendini tazeliyor, yani kullanıcı bakarken bu döngü belirleyici değil.
 * Gözcünün varlık sebebi kimsenin BAKMADIĞI zaman, ve orada on beş saniye ile
 * bir dakika arasındaki fark kullanıcı için görünmez.
 */
export const DEFAULT_INTERVAL_MS = 15_000;

/**
 * İşlem aynalama aralığı.
 *
 * Durum yoklamasından ayrı ve çok daha seyrek, çünkü ikisi farklı sorunları
 * çözüyor. Durum ekranda görünüyor ve taze olmalı. İşlem aynalaması ise bir
 * VERİ KAYBI penceresini kapatıyor: kapanmış işlemler bugüne kadar yalnızca
 * sayfa okunduğunda aynalanıyordu ve `remove()` botun Freqtrade veritabanını
 * siliyor — yani hiç bakılmadan kaldırılan bir botun geçmişi yok oluyordu.
 *
 * Beş dakika o pencereyi kapatmaya yetiyor; on beş saniyede bir 500 işlemi
 * yeniden çekmek yalnızca aynı JSON'ı tekrar tekrar ayrıştırmak olurdu.
 */
export const DEFAULT_SYNC_INTERVAL_MS = 5 * 60_000;

/**
 * Gözcünün orchestrator'dan tek beklentisi.
 *
 * Bu dar arayüz sayesinde döngünün kendi mantığı — hangi botlar, çakışma,
 * hata yalıtımı — Docker'a hiç dokunmadan test edilebiliyor. Kuyruğun
 * `BacktestExecutor`'ı ile aynı gerekçe.
 */
export type BotMonitor = {
  refreshStatus(botId: string): Promise<BotStatus>;
  syncTrades(botId: string): Promise<number>;
};

export type WatchdogOptions = {
  db: Database;
  monitor: BotMonitor;
  intervalMs?: number;
  syncIntervalMs?: number;
};

export class Watchdog {
  #db: Database;
  #monitor: BotMonitor;
  #intervalMs: number;
  #syncIntervalMs: number;

  #timer: NodeJS.Timeout | null = null;
  #ticking: Promise<void> | null = null;

  /** Bot başına son aynalama zamanı. Bellekte: kaybolması bir fazla çağrı demek. */
  #lastSync = new Map<string, number>();

  constructor(options: WatchdogOptions) {
    this.#db = options.db;
    this.#monitor = options.monitor;
    this.#intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.#syncIntervalMs = options.syncIntervalMs ?? DEFAULT_SYNC_INTERVAL_MS;
  }

  /** Zamanlayıcıyı kurar. İki kez çağrılması ikinci bir döngü açmaz. */
  start(): void {
    if (this.#timer) return;

    this.#timer = setInterval(() => void this.tick(), this.#intervalMs);

    // Süreci ayakta TUTMAZ. Aksi halde bir CLI ya da test, gözcü yüzünden
    // hiç çıkamazdı.
    this.#timer.unref();
  }

  stop(): void {
    if (!this.#timer) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }

  /**
   * Bir tur yoklama. Testler zamanlayıcı olmadan doğrudan çağırır.
   *
   * Önceki tur bitmediyse yenisi AÇILMAZ, mevcut olan döndürülür. Yavaş bir
   * Docker'da tıklar üst üste binseydi her tur bir öncekini daha da
   * yavaşlatırdı.
   */
  tick(): Promise<void> {
    this.#ticking ??= this.#sweep().finally(() => {
      this.#ticking = null;
    });
    return this.#ticking;
  }

  async #sweep(): Promise<void> {
    // Durmuş botun bakılacak container'ı yok. `error` olanlar dahil: Docker
    // onları geri getirmeye devam ediyor ve toparlanmaları kaydedilmeli.
    const watched = this.#db
      .select({ id: bots.id })
      .from(bots)
      .where(and(isNull(bots.deletedAt), ne(bots.status, "stopped")))
      .all();

    for (const bot of watched) {
      // Bir botun okunamaması diğerlerini ve döngüyü durdurmamalı.
      const status = await this.#monitor.refreshStatus(bot.id).catch(() => null);

      if (status === "running" && this.#dueForSync(bot.id)) {
        await this.#monitor.syncTrades(bot.id).catch(() => 0);
      }
    }
  }

  #dueForSync(botId: string): boolean {
    const now = Date.now();
    const last = this.#lastSync.get(botId) ?? 0;

    if (now - last < this.#syncIntervalMs) return false;

    this.#lastSync.set(botId, now);
    return true;
  }
}
