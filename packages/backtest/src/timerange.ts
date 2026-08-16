/**
 * Zaman aralıkları.
 *
 * Freqtrade'in `--timerange` biçimi `YYYYMMDD-YYYYMMDD`. Aralığın sonu her
 * zaman SABİTLENİR: açık uçlu bir aralık (`20260216-`) aynı satırı yarın
 * farklı bir sonuç verir hale getirir ve kaydedilmiş bir ölçüm yeniden
 * üretilemezse ölçüm değildir.
 */

import type { Timeframe } from "@rudder/ruleset";

/** Arayüzün sunduğu dönemler. Ay cinsinden. */
export const BACKTEST_PERIODS = [3, 6, 12] as const;
export type BacktestPeriod = (typeof BACKTEST_PERIODS)[number];

export function isBacktestPeriod(value: unknown): value is BacktestPeriod {
  return BACKTEST_PERIODS.includes(value as BacktestPeriod);
}

/**
 * Motorun `startup_candle_count` üst sınırı (bkz. `engine/README.md`).
 *
 * İndirme aralığı her zaman bu kadar mum geriden başlar. Gerçek ısınma payı
 * kural setinin en uzun indikatör periyodundan hesaplanıyor ama o mantığı
 * TypeScript'e kopyalamak, iki tarafın sessizce ayrışacağı bir yer daha
 * açardı. Üst sınırı kullanmak her kural seti için yeterli ve tek bir sayı.
 */
export const STARTUP_CANDLE_LIMIT = 400;

const MINUTES: Record<Timeframe, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "2h": 120,
  "4h": 240,
  "6h": 360,
  "12h": 720,
  "1d": 1440,
};

export function timeframeMinutes(timeframe: Timeframe): number {
  return MINUTES[timeframe];
}

/** `12` → `"20250816-20260816"`. */
export function timerangeFor(months: number, now: Date = new Date()): string {
  const end = startOfUtcDay(now);
  return `${formatDay(subtractMonths(end, months))}-${formatDay(end)}`;
}

/**
 * İndirme aralığı, backtest aralığından ısınma payı kadar geridedir.
 *
 * Freqtrade istenen aralıktan ÖNCEKİ mumları ısınma için kullanır; orada veri
 * yoksa hata vermez, backtest'i sessizce daha geç başlatır. Payı indirmemek
 * "son 12 ay" deyip 11 ay ölçmek demek olurdu.
 */
export function downloadTimerange(timerange: string, timeframe: Timeframe): string {
  const { start, end } = parseTimerange(timerange);
  const warmupMs = STARTUP_CANDLE_LIMIT * timeframeMinutes(timeframe) * 60_000;

  return `${formatDay(new Date(start.getTime() - warmupMs))}-${formatDay(end)}`;
}

export function parseTimerange(timerange: string): { start: Date; end: Date } {
  const [from, to] = timerange.split("-");
  if (!from || !to) throw new Error(`malformed timerange: ${timerange}`);
  return { start: parseDay(from), end: parseDay(to) };
}

// ---------------------------------------------------------------------------
// Tarih yardımcıları — hepsi UTC
// ---------------------------------------------------------------------------

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Ay çıkarır ve ayın son gününe kırpar.
 *
 * `Date` kırpmaz, taşırır: 31 Ağustos'tan 6 ay geriye gitmek 31 Şubat'ı, yani
 * 3 Mart'ı verir — istenen aralıktan üç gün kısa.
 */
function subtractMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() - months;
  const day = date.getUTCDate();

  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
}

function formatDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
}

function parseDay(day: string): Date {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(day);
  if (!match) throw new Error(`malformed date in timerange: ${day}`);

  const [, year, month, date] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(date)));
}
