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
 * Freqtrade backtest çıktısının ayrıştırılması ve düşüş eğrisinin türetilmesi.
 *
 * BU MODÜL SAF: Docker, dosya sistemi, veritabanı yok. Arayüz `@rudder/backtest`
 * paketinin tamamını değil yalnızca bunu import ediyor (`@rudder/backtest/result`)
 * — bir React sunucu bileşeninin `node:child_process` çekmesi için sebep yok.
 */

// ---------------------------------------------------------------------------
// Freqtrade'in çıktısı
// ---------------------------------------------------------------------------

/**
 * Sonuçtaki işlem kaydından eğrinin okuduğu iki alan.
 *
 * Freqtrade her işlem için 30'dan fazla alan yazıyor; burada yazılı olanlar
 * kullandıklarımız.
 */
export type ResultTrade = {
  /** ISO benzeri, sıralanabilir: `"2026-06-03 14:00:00+00:00"`. */
  close_date?: string | null;
  profit_abs: number;
};

export type PairBreakdown = {
  /** Parite adı, ya da toplam satırı için "TOTAL". */
  key: string;
  trades: number;
  profit_total: number;
  profit_total_abs: number;
};

export type ExitReasonBreakdown = {
  /** `roi` | `stop_loss` | `exit_signal` | `trailing_stop_loss` | `force_exit` */
  key: string;
  trades: number;
  profit_total: number;
  profit_total_abs: number;
};

/**
 * Sonuçtan sakladığımız alanlar.
 *
 * Freqtrade strateji başına 118 alan döndürüyor; buradaki liste okuduklarımız.
 * Diskteki zip'te hepsi duruyor — bu tip, veritabanına yazdığımız kırpılmış
 * nesnenin sözleşmesi.
 *
 * `_s` / `_ts` ile biten ham değerler KASITLI olarak tercih edildi: Freqtrade
 * aynı bilgiyi `"126 days 20:00:00"` gibi İngilizce dizgelerle de veriyor ve
 * onları ekrana basmak Türkçe arayüzde İngilizce metin demek olurdu.
 */
export type BacktestSummary = {
  strategy_name: string;
  timeframe: string;
  timerange: string;
  pairlist: string[];

  starting_balance: number;
  final_balance: number;
  stake_amount: number;
  stake_currency: string;
  max_open_trades: number;

  /** Backtest'in GERÇEKTEN kapsadığı aralık — istenenle aynı olmayabilir. */
  backtest_start_ts: number;
  backtest_end_ts: number;
  backtest_days: number;

  total_trades: number;
  trades_per_day: number;
  wins: number;
  losses: number;
  draws: number;
  winrate: number;

  profit_total: number;
  profit_total_abs: number;
  profit_factor: number;
  expectancy: number;
  expectancy_ratio: number;

  max_drawdown_account: number;
  drawdown_duration_s: number | null;

  /** Aynı dönemde piyasanın kendisi ne yaptı. Kıyas olmadan getiri anlamsız. */
  market_change: number;

  holding_avg_s: number;
  max_consecutive_losses: number;

  results_per_pair: PairBreakdown[];
  exit_reason_summary: ExitReasonBreakdown[];

  /**
   * DÜŞÜŞ EĞRİSİ — Rudder türetti, Freqtrade'den gelmiyor.
   *
   * Her kapanan işlemden sonraki oran; ilk nokta datum'un kendisi (0). Tam
   * işlem kaydı yerine bu saklanıyor: eğrinin okuduğu tek şey bu ve `trades[]`
   * tam çıktının 440 KB'ının 385 KB'ı.
   */
  drawdown_curve: number[];
};

/** `backtests` tablosundaki vitrin sütunları. */
export type BacktestMetrics = {
  totalTrades: number;
  profitRatio: number;
  profitFactor: number | null;
  expectancy: number;
  maxDrawdown: number;
  winRate: number;
  marketChange: number;
};

export type ParsedBacktest = { metrics: BacktestMetrics; summary: BacktestSummary };

/**
 * Veritabanına yazılmayan alanlar.
 *
 * `trades` tam çıktının 440 KB'ının 385 KB'ı, `periodic_breakdown` 35 KB'ı.
 * İkisi de bugün hiçbir ekranı beslemiyor; `trades` yalnızca düşüş eğrisini
 * türetmek için okunuyor ve türetilen eğri kendisinden 60 kat küçük.
 *
 * `daily_profit` de düşüyor, ama sebebi boyut değil: eğri ondan da
 * hesaplanabilir GİBİ görünüyor ve hesaplanamıyor (aşağıdaki nota bakın).
 * Yanlış cevap veren bir kısayolu veride bırakmak, o kısayolun er ya da geç
 * kullanılması demek.
 *
 * Tam kayıt diskteki zip'te duruyor; işlem listesi ekranı gerektiğinde oradan
 * okunur.
 */
const OMITTED_FIELDS = ["trades", "periodic_breakdown", "daily_profit"];

/**
 * Saklanan eğrinin en fazla nokta sayısı.
 *
 * İndirgeme kova minimumu aldığı için en derin nokta BİREBİR korunur; kaybolan
 * yalnızca ara ayrıntı. Çok işlem açan bir kural setinin satırı şişirmemesi
 * için bir tavan gerekiyor.
 */
const MAX_CURVE_POINTS = 2000;

export class MalformedResultError extends Error {
  constructor(message: string) {
    super(`malformed backtest result: ${message}`);
    this.name = "MalformedResultError";
  }
}

export function parseResult(raw: unknown): ParsedBacktest {
  const strategies = (raw as { strategy?: unknown }).strategy;
  if (!strategies || typeof strategies !== "object") {
    throw new MalformedResultError("no `strategy` section");
  }

  // Tek strateji çalıştırıyoruz, yani tek anahtar var. Adına bakmıyoruz:
  // strateji sınıfının adı bu modülün bilmesi gereken bir şey değil.
  const [result] = Object.values(strategies as Record<string, unknown>);
  if (!result || typeof result !== "object") {
    throw new MalformedResultError("`strategy` section is empty");
  }

  const raws = result as Record<string, unknown>;

  if (typeof raws["starting_balance"] !== "number") {
    throw new MalformedResultError("`starting_balance` is missing");
  }
  if (!Array.isArray(raws["trades"])) {
    throw new MalformedResultError("`trades` is missing — the curve cannot be derived");
  }

  const summary = trim(raws);
  summary.drawdown_curve = downsampleTrough(
    drawdownFromTrades(raws["trades"] as ResultTrade[], raws["starting_balance"]),
    MAX_CURVE_POINTS,
  );

  return { metrics: metricsOf(summary), summary };
}

function trim(result: Record<string, unknown>): BacktestSummary {
  const summary: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(result)) {
    if (!OMITTED_FIELDS.includes(key)) summary[key] = value;
  }

  return summary as BacktestSummary;
}

function metricsOf(summary: BacktestSummary): BacktestMetrics {
  return {
    totalTrades: summary.total_trades,
    profitRatio: finite(summary.profit_total) ?? 0,
    profitFactor: profitFactorOf(summary),
    expectancy: finite(summary.expectancy) ?? 0,
    maxDrawdown: finite(summary.max_drawdown_account) ?? 0,
    winRate: finite(summary.winrate) ?? 0,
    marketChange: finite(summary.market_change) ?? 0,
  };
}

/**
 * Kâr faktörü = kazanılan / kaybedilen. Hiç kayıp yoksa TANIMSIZDIR.
 *
 * Freqtrade bu durumda `0.0` yazıyor ve sıfır, ekranda "berbat" diye okunur —
 * oysa anlamı "hiç kaybetmedi". Ölçülemeyeni ölçülmüş gibi göstermemek için
 * `null` saklanıyor.
 */
function profitFactorOf(summary: BacktestSummary): number | null {
  if (summary.total_trades === 0) return null;
  if (summary.losses === 0) return null;
  return finite(summary.profit_factor);
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Düşüş eğrisi
// ---------------------------------------------------------------------------

/**
 * Stratejinin kendi zirvesinin ne kadar altında kaldığı — arayüzün imza öğesi.
 *
 * Hesap KAPANAN İŞLEM bazında yapılıyor: işlemler kapanış anına göre sıralanır,
 * bakiye birikir, her adımda o ana kadarki zirveye olan oran yazılır.
 *
 * GÜNLÜK TOPLAMDAN HESAPLANMAZ. `daily_profit` çok daha küçük ve ilk bakışta
 * yeterli görünüyor, ama gün içindeki dip gün sonunda toparlandığında o dibi
 * hiç görmüyor. Ölçüldü: 194 günlük bir testte iki yöntem birbirini tuttu,
 * 31 günlük bir testte günlük yöntem düşüşü %1,4137 gösterdi — Freqtrade'in
 * ölçtüğü %1,4303 yerine. Hata her zaman AZ gösterme yönünde ve bu üründe
 * riski olduğundan küçük göstermek kabul edilebilir bir hata değil.
 *
 * Dönen değerler 0 ya da negatif. Sıfırın üstüne çıkmadığı için grafiği
 * pazarlama malzemesine dönüştürmek mümkün değil.
 */
export function drawdownFromTrades(trades: ResultTrade[], startingBalance: number): number[] {
  const closed = trades
    .filter((trade) => trade.close_date)
    .sort((a, b) => (a.close_date ?? "").localeCompare(b.close_date ?? ""));

  let balance = startingBalance;
  let peak = startingBalance;

  // İlk nokta datum'un kendisi: ölçüm zirveden başlar.
  const points = [0];

  for (const trade of closed) {
    balance += trade.profit_abs;
    peak = Math.max(peak, balance);
    points.push((balance - peak) / peak);
  }

  return points;
}

/** Saklanmış eğri. Arayüzün eğriyi nereden okuyacağını bilmesi gerekmiyor. */
export function underwaterCurve(summary: BacktestSummary): number[] {
  return summary.drawdown_curve;
}

/**
 * Eğriyi çizim genişliğine indirger.
 *
 * Her kovanın ORTALAMASI değil EN DÜŞÜĞÜ alınıyor. Ortalama en derin çukuru
 * yumuşatır, ve bu grafiğin tek işi o çukuru göstermek — yumuşatmak sayıyı
 * olduğundan iyi gösterirdi.
 */
export function downsampleTrough(points: number[], count: number): number[] {
  if (count < 1) throw new Error("count must be positive");
  if (points.length <= count) return [...points];

  const buckets: number[] = [];

  for (let index = 0; index < count; index++) {
    const from = Math.floor((index * points.length) / count);
    const to = Math.max(from + 1, Math.floor(((index + 1) * points.length) / count));
    buckets.push(Math.min(...points.slice(from, to)));
  }

  return buckets;
}
