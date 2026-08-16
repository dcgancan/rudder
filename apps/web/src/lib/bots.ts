import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";

import { botEvents, bots, rulesets, trades } from "@rudder/db";
import type { BotEventRow, BotRow, RulesetRow, TradeRow } from "@rudder/db";
import { describe, localeFor } from "@rudder/ruleset";

import { db } from "./db";
import { exitReasonKey } from "./exit-reasons";
import { orchestrator } from "./orchestrator";

export type BotStatus = BotRow["status"];

export type StrategyRef = {
  slug: string;
  name: string;
  version: number;
  /** Katalogda daha yeni bir sürüm var mı — bot eski sürümü çalıştırıyor olabilir. */
  outdated: boolean;
};

/** Yalnızca bot çalışırken okunabilen değerler. Durmuş bir bota sorulamaz. */
export type LiveReading = {
  openPositions: number;
  /** Kapanmış işlemlerin toplam getirisi, başlangıç sermayesine oran. */
  profitRatio: number;
  balance: number;
};

export type BotSummary = {
  id: string;
  name: string;
  status: BotStatus;
  strategy: StrategyRef;
  currency: string;
  createdAt: number;
  live: LiveReading | null;
};

export type Position = {
  tradeId: number;
  pair: string;
  openedAt: number;
  stake: number;
  openRate: number;
  profitRatio: number | null;
};

export type ClosedTrade = {
  id: string;
  pair: string;
  openedAt: number;
  closedAt: number | null;
  heldSeconds: number | null;
  profitRatio: number | null;
  profitAbs: number | null;
  /** `measurement.exit.*` altındaki çeviri anahtarı; ham Freqtrade değeri değil. */
  exitReason: string;
};

/** Botun başına gelen, kullanıcının istemediği bir şey. */
export type BotEvent = {
  id: string;
  /** `botEvent.*` altındaki çeviri anahtarı; ham enum kullanıcıya gösterilmez. */
  kind: BotEventRow["kind"];
  at: number;
  detail: string | null;
};

export type BotDetail = BotSummary & {
  setup: {
    mode: BotRow["mode"];
    exchange: string;
    pairs: string[];
    stake: number;
    maxOpenTrades: number;
    wallet: number | null;
  };
  positions: Position[];
  history: ClosedTrade[];
  events: BotEvent[];
  lastError: string | null;
};

/** Geçmiş sayfalama olmadan da okunabilir kalmalı. */
const HISTORY_LIMIT = 50;

/**
 * Olay listesinin sınırı.
 *
 * Daha kısa: bir botun başına gelenler seyrek olmalı. Liste uzuyorsa okunacak
 * şey zaten "bu bot sağlıklı değil", tek tek satırlar değil.
 */
const EVENT_LIMIT = 20;

// ---------------------------------------------------------------------------
// Okuma
// ---------------------------------------------------------------------------

export async function listBots(locale: string): Promise<BotSummary[]> {
  const rows = db
    .select()
    .from(bots)
    .where(isNull(bots.deletedAt))
    .orderBy(desc(bots.createdAt))
    .all();

  return Promise.all(rows.map((row) => toSummary(row, locale)));
}

export async function getBot(botId: string, locale: string): Promise<BotDetail | null> {
  const row = db
    .select()
    .from(bots)
    .where(and(eq(bots.id, botId), isNull(bots.deletedAt)))
    .get();
  if (!row) return null;

  const summary = await toSummary(row, locale);
  // Durum tazelendikten sonra satır değişmiş olabilir; hatayı ondan okuyalım.
  const current = db.select().from(bots).where(eq(bots.id, botId)).get() ?? row;

  return {
    ...summary,
    setup: {
      mode: row.mode,
      exchange: row.exchange,
      pairs: row.pairs,
      stake: row.stakeAmount,
      maxOpenTrades: row.maxOpenTrades,
      wallet: row.paperWallet,
    },
    positions: summary.status === "running" ? await readPositions(botId) : [],
    history: readHistory(botId),
    events: readEvents(botId),
    lastError: current.lastError,
  };
}

/**
 * Bu kural seti sürümünden kurulmuş bot sayısı.
 *
 * Strateji sayfasında gösteriliyor; aynı stratejiden farkında olmadan beşinci
 * botu kurmayı biraz zorlaştırıyor.
 */
export function countBotsFor(rulesetId: string): number {
  return db
    .select({ id: bots.id })
    .from(bots)
    .where(and(eq(bots.rulesetId, rulesetId), isNull(bots.deletedAt)))
    .all().length;
}

// ---------------------------------------------------------------------------
// İç yardımcılar
// ---------------------------------------------------------------------------

async function toSummary(row: BotRow, locale: string): Promise<BotSummary> {
  // Durum yalnızca sorulduğunda güncelleniyor. Ekranda görünen bir durumun
  // gerçeği yansıtması gerektiği için her okumada gerçeğe bakılır.
  const status = await orchestrator()
    .refreshStatus(row.id)
    .catch(() => row.status);

  return {
    id: row.id,
    name: row.name,
    status,
    strategy: strategyRef(row.rulesetId, locale),
    currency: row.stakeCurrency,
    createdAt: row.createdAt.getTime(),
    live: status === "running" ? await readLive(row.id) : null,
  };
}

function strategyRef(rulesetId: string, locale: string): StrategyRef {
  const row = db.select().from(rulesets).where(eq(rulesets.id, rulesetId)).get();
  if (!row) return { slug: "", name: "?", version: 0, outdated: false };

  return {
    slug: row.slug,
    name: describe(row.body, localeFor(locale), locale).name,
    version: row.version,
    outdated: latestVersion(row.slug) > row.version,
  };
}

function latestVersion(slug: string): number {
  const rows: RulesetRow[] = db.select().from(rulesets).where(eq(rulesets.slug, slug)).all();
  return rows.reduce((highest, row) => Math.max(highest, row.version), 0);
}

/**
 * Botun kendi API'sinden okunan anlık değerler.
 *
 * Açık pozisyonların tek doğruluk kaynağı botun kendisi — veritabanına
 * aynalanmıyorlar. Aynı çağrıda kapanmış işlemler de senkronize ediliyor;
 * botun kendi veritabanı `remove()` ile silindiği için geçmişin bizde durması
 * gerekiyor.
 */
async function readLive(botId: string): Promise<LiveReading | null> {
  try {
    const client = await orchestrator().client(botId);
    const [count, profit, balance] = await Promise.all([
      client.count(),
      client.profit(),
      client.balance(),
    ]);

    await orchestrator().syncTrades(botId).catch(() => 0);

    return {
      openPositions: count.current,
      profitRatio: profit.profit_closed_percent / 100,
      balance: balance.total,
    };
  } catch {
    // Bot ayakta ama API henüz cevap vermiyor olabilir; bir sonraki tazelemede
    // okunur. Yarım bir sayı göstermektense hiç göstermemek doğru.
    return null;
  }
}

async function readPositions(botId: string): Promise<Position[]> {
  try {
    const open = await (await orchestrator().client(botId)).status();

    return open.map((trade) => ({
      tradeId: trade.trade_id,
      pair: trade.pair,
      openedAt: trade.open_timestamp,
      stake: trade.stake_amount,
      openRate: trade.open_rate,
      profitRatio: trade.profit_ratio,
    }));
  } catch {
    return [];
  }
}

/**
 * Kapanmış işlemler veritabanından okunur, bot API'sinden değil.
 *
 * Bot durdurulduktan ya da kaldırıldıktan sonra da geçmişin durması gerekiyor —
 * stratejileri karşılaştırabilmenin tek yolu bu.
 */
function readHistory(botId: string): ClosedTrade[] {
  const rows: TradeRow[] = db
    .select()
    .from(trades)
    .where(eq(trades.botId, botId))
    .orderBy(desc(trades.closedAt))
    .limit(HISTORY_LIMIT)
    .all();

  return rows.map((row) => ({
    id: row.id,
    pair: row.pair,
    openedAt: row.openedAt.getTime(),
    closedAt: row.closedAt?.getTime() ?? null,
    heldSeconds: row.closedAt
      ? Math.round((row.closedAt.getTime() - row.openedAt.getTime()) / 1000)
      : null,
    profitRatio: row.profitRatio,
    profitAbs: row.profitAbs,
    exitReason: exitReasonKey(row.exitReason),
  }));
}

/**
 * Botun başına gelenler.
 *
 * Durum alanının söyleyemediği şeyi söylüyor: bot şu an çalışıyor olabilir ama
 * gece üç kez düşmüş olabilir. Docker onu geri getirdiği için durum alanında
 * bundan hiçbir iz kalmıyor.
 */
function readEvents(botId: string): BotEvent[] {
  const rows: BotEventRow[] = db
    .select()
    .from(botEvents)
    .where(eq(botEvents.botId, botId))
    .orderBy(desc(botEvents.at))
    .limit(EVENT_LIMIT)
    .all();

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    at: row.at.getTime(),
    detail: row.detail,
  }));
}
