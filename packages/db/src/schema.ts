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
 * Veri modeli.
 *
 * İki karar şemanın şeklini belirliyor:
 *
 *  1. Kural setleri DEĞİŞMEZ. Düzenleme yeni bir sürüm satırı yaratır, mevcut
 *     satırı güncellemez. Bir bot her zaman belirli bir sürüme bağlıdır.
 *     Aksi halde "bu işlem hangi kurallarla açıldı?" sorusunun cevabı yok olur
 *     ve geçmiş yorumlanamaz hale gelir. Bu, pazaryeri tarafındaki
 *     "kopyala, takip etme" ilkesinin iç karşılığıdır.
 *
 *  2. Botlar SOFT-DELETE edilir. İşlem geçmişi bot silindikten sonra da
 *     durmalı — stratejileri karşılaştırabilmenin tek yolu bu.
 */

import { sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  blob,
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import type { Ruleset } from "@rudder/ruleset";

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });
const NOW = sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`;

// ---------------------------------------------------------------------------
// Kural setleri
// ---------------------------------------------------------------------------

export const rulesets = sqliteTable(
  "rulesets",
  {
    id: text("id").primaryKey(),

    /** Paylaşılabilir slug — `ruleset.body.id` ile aynı. Sürümler arasında sabit. */
    slug: text("slug").notNull(),
    /** 1'den başlar, her düzenlemede artar. (slug, version) benzersizdir. */
    version: integer("version").notNull(),

    /** Doğrulanmış kural seti. Tipi @rudder/ruleset'ten gelir. */
    body: text("body", { mode: "json" }).$type<Ruleset>().notNull(),

    /** builtin: repoyla gelen · local: kullanıcının yazdığı · imported: dışarıdan alınan */
    source: text("source", { enum: ["builtin", "local", "imported"] }).notNull(),

    /** Fork soyağacı. Bir kural setinin nereden türediğini gösterir. */
    forkedFromId: text("forked_from_id").references((): AnySQLiteColumn => rulesets.id),

    /** Katalogdan gizle. Silmiyoruz: botlar ve backtest'ler buna bağlı olabilir. */
    archivedAt: timestamp("archived_at"),

    createdAt: timestamp("created_at").notNull().default(NOW),
  },
  (t) => [
    uniqueIndex("rulesets_slug_version_idx").on(t.slug, t.version),
    index("rulesets_slug_idx").on(t.slug),
  ],
);

// ---------------------------------------------------------------------------
// Borsa hesapları
// ---------------------------------------------------------------------------

export const exchangeAccounts = sqliteTable("exchange_accounts", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  exchange: text("exchange").notNull(),

  // Envelope encryption ile şifrelenmiş. Düz metin sütunu KASITLI olarak yok,
  // ve bu alanları istemciye döndüren bir okuma yolu da olmamalı: anahtar
  // yazılır ve değiştirilir, asla geri okunmaz.
  apiKeyEnc: blob("api_key_enc").notNull(),
  apiSecretEnc: blob("api_secret_enc").notNull(),

  /**
   * Anahtar bağlanırken borsaya sorulup doğrulanır. Çekim izni açık bir anahtar
   * kabul edilmez — bu tek kontrol en kötü senaryoyu ortadan kaldırıyor.
   */
  withdrawalDisabled: integer("withdrawal_disabled", { mode: "boolean" }).notNull(),
  lastVerifiedAt: timestamp("last_verified_at"),

  createdAt: timestamp("created_at").notNull().default(NOW),
});

// ---------------------------------------------------------------------------
// Botlar
// ---------------------------------------------------------------------------

export const BOT_STATUSES = ["stopped", "starting", "running", "stopping", "error"] as const;

export const bots = sqliteTable(
  "bots",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),

    /** Belirli bir kural seti SÜRÜMÜ. Kural seti düzenlenince bot etkilenmez. */
    rulesetId: text("ruleset_id")
      .notNull()
      .references(() => rulesets.id),

    /** Paper modda null. Live modda zorunlu — aşağıdaki check bunu garanti eder. */
    exchangeAccountId: text("exchange_account_id").references(() => exchangeAccounts.id),

    mode: text("mode", { enum: ["paper", "live"] })
      .notNull()
      .default("paper"),

    exchange: text("exchange").notNull(),
    stakeCurrency: text("stake_currency").notNull(),
    stakeAmount: real("stake_amount").notNull(),
    maxOpenTrades: integer("max_open_trades").notNull(),
    pairs: text("pairs", { mode: "json" }).$type<string[]>().notNull(),

    /** Yalnızca paper modda anlamlı. */
    paperWallet: real("paper_wallet"),

    status: text("status", { enum: BOT_STATUSES }).notNull().default("stopped"),

    /** Orchestrator'ın yönettiği container ve o container'ın Freqtrade API'si. */
    containerId: text("container_id"),
    apiPort: integer("api_port"),
    apiTokenEnc: blob("api_token_enc"),

    /**
     * En son gözlenen Docker yeniden başlatma sayacı.
     *
     * Sayacın BÜYÜMESİ, Docker'ın botu kimse istemeden geri getirdiği anlamına
     * gelir. Büyümeyi görmek için önceki değeri bir yerde tutmak şart; tek
     * başına anlamlı bir sayı olduğu için değil.
     *
     * `start()` container'ı yeniden yarattığında Docker'ın sayacı sıfırlanır,
     * bu sütun da öyle.
     */
    restartCount: integer("restart_count").notNull().default(0),

    lastError: text("last_error"),
    lastSeenAt: timestamp("last_seen_at"),

    /** Soft delete — işlem geçmişi kalsın diye. */
    deletedAt: timestamp("deleted_at"),

    createdAt: timestamp("created_at").notNull().default(NOW),
    updatedAt: timestamp("updated_at").notNull().default(NOW),
  },
  (t) => [
    index("bots_status_idx").on(t.status),
    index("bots_ruleset_idx").on(t.rulesetId),

    // Gerçek parayla çalışan bir bot kimlik bilgisi olmadan var olamaz.
    // Uygulama katmanı hata yapsa bile veritabanı buna izin vermez.
    check(
      "bots_live_requires_account",
      sql`${t.mode} = 'paper' OR ${t.exchangeAccountId} IS NOT NULL`,
    ),
    check("bots_stake_positive", sql`${t.stakeAmount} > 0`),
    check("bots_max_open_trades_positive", sql`${t.maxOpenTrades} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// Bot olayları
// ---------------------------------------------------------------------------

/**
 * restarted → Docker botu kimse istemeden geri getirdi
 * failed    → bot çöktü (tek seferlik ya da çöküp duran)
 * stopped   → container gitti, ama kimse durdurmasını istememişti
 * recovered → düşmüş bir bot tekrar çalışıyor
 */
export const BOT_EVENT_KINDS = ["restarted", "failed", "stopped", "recovered"] as const;

/**
 * Bir botun başına gelenler.
 *
 * Neden bir sütun değil de tablo: botlar `--restart unless-stopped` ile
 * çalışıyor, yani çöken bir botu Docker geri getiriyor. Tek bir "son hata"
 * sütunu bir sonraki başarılı açılışta siliniyor ve gece yaşanan çökme yok
 * oluyor. Kullanıcı sabah baktığında bot "çalışıyor" görünüyor ve kırk kez
 * çöktüğüne dair hiçbir iz kalmıyor.
 *
 * Satırlar yalnızca GEÇİŞTE yazılır, her yoklamada değil — yoksa çöküp duran
 * bir bot on beş saniyede bir satır üretirdi.
 */
export const botEvents = sqliteTable(
  "bot_events",
  {
    id: text("id").primaryKey(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id),

    kind: text("kind", { enum: BOT_EVENT_KINDS }).notNull(),

    /** Teknik ayrıntı — `failed` için log kuyruğu. Kullanıcıya isteğe bağlı gösterilir. */
    detail: text("detail"),

    at: timestamp("at").notNull().default(NOW),
  },
  (t) => [index("bot_events_bot_at_idx").on(t.botId, t.at)],
);

// ---------------------------------------------------------------------------
// Backtest'ler
// ---------------------------------------------------------------------------

export const backtests = sqliteTable(
  "backtests",
  {
    id: text("id").primaryKey(),
    rulesetId: text("ruleset_id")
      .notNull()
      .references(() => rulesets.id),

    exchange: text("exchange").notNull(),
    pairs: text("pairs", { mode: "json" }).$type<string[]>().notNull(),
    timerange: text("timerange").notNull(),

    status: text("status", { enum: ["queued", "running", "done", "failed"] })
      .notNull()
      .default("queued"),
    error: text("error"),

    // Vitrin metrikleri, listeleme ve sıralama tam sonucu ayrıştırmadan
    // yapılabilsin diye ayrı sütunlarda tutuluyor.
    //
    // winRate saklanır ama sıralamada VARSAYILAN DEĞİLDİR: bu repodaki testte
    // %82.4 kazanma oranıyla %11.57 kaybeden bir strateji ölçüldü. Kullanıcıya
    // önce profitFactor, expectancy ve maxDrawdown gösterilir.
    totalTrades: integer("total_trades"),
    profitRatio: real("profit_ratio"),
    profitFactor: real("profit_factor"),
    expectancy: real("expectancy"),
    maxDrawdown: real("max_drawdown"),
    winRate: real("win_rate"),
    /** Aynı dönemde piyasanın kendisi ne yaptı — kıyas olmadan getiri anlamsız. */
    marketChange: real("market_change"),

    /** Freqtrade'in tam çıktısı. Grafikler buradan beslenir. */
    result: text("result", { mode: "json" }),

    createdAt: timestamp("created_at").notNull().default(NOW),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [
    index("backtests_ruleset_idx").on(t.rulesetId),
    index("backtests_status_idx").on(t.status),
  ],
);

// ---------------------------------------------------------------------------
// İşlemler
// ---------------------------------------------------------------------------

/**
 * Freqtrade'in kendi veritabanından aynalanan kapanmış işlemler.
 *
 * Açık pozisyonlar buradan değil, doğrudan bot API'sinden okunur — tek doğruluk
 * kaynağı orasıdır. Burada tutulmalarının sebebi bot silindikten sonra da
 * geçmişin kalması ve botlar arası karşılaştırmanın ucuz olması.
 */
export const trades = sqliteTable(
  "trades",
  {
    id: text("id").primaryKey(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id),

    /** Freqtrade'in kendi işlem id'si. Bot içinde benzersiz, global değil. */
    ftTradeId: integer("ft_trade_id").notNull(),

    pair: text("pair").notNull(),
    openedAt: timestamp("opened_at").notNull(),
    closedAt: timestamp("closed_at"),
    openRate: real("open_rate").notNull(),
    closeRate: real("close_rate"),
    amount: real("amount").notNull(),
    stakeAmount: real("stake_amount").notNull(),
    profitAbs: real("profit_abs"),
    profitRatio: real("profit_ratio"),

    /**
     * Freqtrade'den gelen enum benzeri değer: roi | stop_loss | exit_signal |
     * force_exit. Doğrudan çeviri anahtarı olarak kullanılır, kullanıcıya ham
     * haliyle asla gösterilmez.
     */
    exitReason: text("exit_reason"),
    enterTag: text("enter_tag"),

    syncedAt: timestamp("synced_at").notNull().default(NOW),
  },
  (t) => [
    uniqueIndex("trades_bot_ft_id_idx").on(t.botId, t.ftTradeId),
    index("trades_bot_closed_idx").on(t.botId, t.closedAt),
  ],
);

// ---------------------------------------------------------------------------
// Çıkarılan tipler
// ---------------------------------------------------------------------------

export type RulesetRow = typeof rulesets.$inferSelect;
export type NewRulesetRow = typeof rulesets.$inferInsert;
export type ExchangeAccountRow = typeof exchangeAccounts.$inferSelect;
export type NewExchangeAccountRow = typeof exchangeAccounts.$inferInsert;
export type BotRow = typeof bots.$inferSelect;
export type NewBotRow = typeof bots.$inferInsert;
export type BotEventRow = typeof botEvents.$inferSelect;
export type NewBotEventRow = typeof botEvents.$inferInsert;
export type BotEventKind = (typeof BOT_EVENT_KINDS)[number];
export type BacktestRow = typeof backtests.$inferSelect;
export type NewBacktestRow = typeof backtests.$inferInsert;
export type TradeRow = typeof trades.$inferSelect;
export type NewTradeRow = typeof trades.$inferInsert;
