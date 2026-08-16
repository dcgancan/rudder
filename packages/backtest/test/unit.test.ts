import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";

import { RULESET_OWNED_KEYS, STANDARD_SETUP } from "@rudder/freqtrade";

import {
  buildBacktestCommand,
  buildBacktestConfig,
  buildDownloadCommand,
} from "../src/config.ts";
import { backtestPaths, containerName, marketDataDir } from "../src/paths.ts";
import { downsampleTrough, parseResult, underwaterCurve } from "../src/result.ts";
import { downloadTimerange, timeframeMinutes, timerangeFor } from "../src/timerange.ts";
import { readZipEntry, zipEntryNames, ZipError } from "../src/zip.ts";

const FIXTURE = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures/backtest-result.json"), "utf8"),
) as unknown;

// Aynı motorun tek pariteyle bir aylık koşusu. Burada günlük toplamdan çıkan
// eğri Freqtrade'in ölçtüğü düşüşü TUTMUYOR — kısayolun yanlış olduğunu
// gösteren örnek bu.
const SINGLE_PAIR = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures/single-pair-result.json"), "utf8"),
) as unknown;

// ---------------------------------------------------------------------------
// Zaman aralıkları
// ---------------------------------------------------------------------------

test("a period becomes a closed timerange", () => {
  assert.equal(timerangeFor(6, new Date("2026-08-16T09:41:00Z")), "20260216-20260816");
  assert.equal(timerangeFor(3, new Date("2026-08-16T09:41:00Z")), "20260516-20260816");
  assert.equal(timerangeFor(12, new Date("2026-08-16T09:41:00Z")), "20250816-20260816");
});

// `Date` kırpmaz, taşırır: 31 Ağustos'tan 6 ay geriye gitmek 31 Şubat'ı, yani
// 3 Mart'ı verir — istenen aralıktan üç gün kısa bir test.
test("subtracting months clamps to the end of a shorter month", () => {
  assert.equal(timerangeFor(6, new Date("2026-08-31T00:00:00Z")), "20260228-20260831");
});

test("the download range reaches back far enough to warm the indicators up", () => {
  // 400 mum × 60 dakika = 16 gün 16 saat, yani 16 Şubat'tan 30 Ocak'a.
  assert.equal(downloadTimerange("20260216-20260816", "1h"), "20260130-20260816");
  // Günlük mumda aynı pay 400 gün.
  assert.equal(downloadTimerange("20260216-20260816", "1d"), "20250112-20260816");
  assert.equal(timeframeMinutes("4h"), 240);
});

test("a malformed timerange is rejected rather than silently shifted", () => {
  assert.throws(() => downloadTimerange("20260216", "1h"), /malformed timerange/);
  assert.throws(() => downloadTimerange("2026-02-16-20260816", "1h"), /malformed date/);
});

// ---------------------------------------------------------------------------
// Yapılandırma
// ---------------------------------------------------------------------------

test("the backtest config never carries a key the ruleset owns", () => {
  const config = buildBacktestConfig();

  for (const key of RULESET_OWNED_KEYS) {
    assert.ok(!(key in config), `config must not set ${key} — it belongs to the ruleset`);
  }
});

test("the backtest config is a dry run with no API server", () => {
  const config = buildBacktestConfig();

  assert.equal(config["dry_run"], true);
  assert.equal(config["dry_run_wallet"], STANDARD_SETUP.wallet);
  assert.equal(config["stake_amount"], STANDARD_SETUP.stake);
  // Backtest bir servis değil; dinleyecek bir portu olmamalı.
  assert.ok(!("api_server" in config));
  assert.deepEqual((config["exchange"] as { pair_whitelist: string[] }).pair_whitelist, [
    ...STANDARD_SETUP.pairs,
  ]);
});

test("a wallet smaller than one position is rejected", () => {
  assert.throws(
    () => buildBacktestConfig({ ...STANDARD_SETUP, wallet: 50, stake: 100 }),
    /wallet cannot be smaller/,
  );
});

// Freqtrade sonuçları strateji DOSYASININ hash'iyle önbelleğe alıyor ve bizde o
// dosya bütün kural setleri için aynı. Önbellek açık kalırsa bir kural setinin
// sonucu bambaşka bir kural seti için döner — hiçbir yerde hata vermeden.
test("backtesting runs with the cache disabled", () => {
  const command = buildBacktestCommand({ timerange: "20260216-20260816" });
  const cache = command.indexOf("--cache");

  assert.notEqual(cache, -1);
  assert.equal(command[cache + 1], "none");
});

// `--timeframe` stratejinin zaman dilimini EZER; komut satırına girerse kural
// setinin `timeframe` alanı sessizce yok sayılır.
test("backtesting never overrides the strategy timeframe", () => {
  const command = buildBacktestCommand({ timerange: "20260216-20260816" });

  assert.ok(!command.includes("--timeframe"));
  assert.ok(!command.includes("-i"));
});

test("downloading asks for exactly the ruleset's timeframe", () => {
  const command = buildDownloadCommand({ timerange: "20260130-20260816", timeframe: "1h" });
  const timeframes = command.indexOf("--timeframes");

  assert.equal(command[0], "download-data");
  assert.equal(command[timeframes + 1], "1h");
});

// ---------------------------------------------------------------------------
// Yerleşim
// ---------------------------------------------------------------------------

test("backtest paths are laid out under the data root", () => {
  const paths = backtestPaths("abc", "/data");

  assert.equal(paths.root, "/data/backtests/abc");
  assert.equal(paths.ruleset, "/data/backtests/abc/ruleset.json");
  assert.equal(paths.results, "/data/backtests/abc/results");
  assert.equal(paths.log, "/data/backtests/abc/run.log");
});

// Mum verisi backtest başına değil borsa başına: indirme artımlı ve her testin
// kendi kopyasını çekmesi hem borsayı hem diski boşuna yorar.
test("market data is shared across backtests, one directory per exchange", () => {
  assert.equal(marketDataDir("binance", "/data"), "/data/market-data/binance");
  assert.equal(containerName("abc", "download"), "rudder-backtest-download-abc");
});

// ---------------------------------------------------------------------------
// Sonucun ayrıştırılması
// ---------------------------------------------------------------------------

test("parsing keeps the display fields and drops the bulky ones", () => {
  const { summary } = parseResult(FIXTURE);

  assert.ok(!("trades" in summary), "trades[] must not reach the database");
  assert.ok(!("periodic_breakdown" in summary));
  // Eğri günlük toplamdan hesaplanamıyor; yanlış cevap veren bir kısayolu
  // veride bırakmak, er ya da geç kullanılması demek.
  assert.ok(!("daily_profit" in summary));

  assert.equal(summary.strategy_name, "UniversalStrategy");
  assert.equal(summary.total_trades, 350);
  assert.ok(summary.drawdown_curve.length > 0);
  assert.ok(summary.results_per_pair.length > 0);
  assert.ok(summary.exit_reason_summary.length > 0);
});

test("headline metrics come straight off the result", () => {
  const { metrics } = parseResult(FIXTURE);

  assert.equal(metrics.totalTrades, 350);
  assert.equal(metrics.maxDrawdown, 0.12531019962000006);
  assert.equal(metrics.marketChange, -0.25627957409959945);
  // Bu strateji işlemlerinin %61'ini kazandı ve yine de para kaybetti.
  assert.ok(metrics.winRate > 0.6);
  assert.ok(metrics.profitRatio < 0);
});

// Kâr faktörü = kazanılan / kaybedilen. Hiç kayıp yoksa tanımsızdır ve
// Freqtrade oraya `0.0` yazıyor — ekranda "berbat" diye okunan bir sayı.
test("an undefined profit factor is stored as null, not as zero", () => {
  const flawless = withStrategy({ losses: 0, profit_factor: 0, total_trades: 12 });
  assert.equal(parseResult(flawless).metrics.profitFactor, null);

  const empty = withStrategy({ total_trades: 0, losses: 0, profit_factor: 0 });
  assert.equal(parseResult(empty).metrics.profitFactor, null);
});

test("a result without the fields the curve needs is rejected", () => {
  assert.throws(() => parseResult({}), /no `strategy` section/);
  assert.throws(() => parseResult(withoutKey("trades")), /trades/);
  assert.throws(() => parseResult(withoutKey("starting_balance")), /starting_balance/);
});

// ---------------------------------------------------------------------------
// Düşüş eğrisi
// ---------------------------------------------------------------------------

// Bu testin işi eğrinin doğruluğunu sabitlemek: en derin noktası Freqtrade'in
// kendi ölçtüğü değerin ta kendisi olmalı. İki farklı koşuda da.
for (const [label, fixture] of [
  ["a five-pair run over six months", FIXTURE],
  ["a single-pair run over one month", SINGLE_PAIR],
] as const) {
  test(`the deepest point matches Freqtrade's own max drawdown — ${label}`, () => {
    const { summary } = parseResult(fixture);

    const deepest = Math.min(...summary.drawdown_curve);
    assert.ok(
      Math.abs(deepest + summary.max_drawdown_account) < 1e-12,
      `curve bottoms at ${deepest}, freqtrade reports ${-summary.max_drawdown_account}`,
    );
  });
}

// Günlük toplamdan hesaplamak çok daha ucuz ve ilk bakışta yeterli görünüyor.
// Değil: gün içindeki dip gün sonunda toparlanınca hiç görünmüyor ve hata her
// zaman düşüşü AZ gösterme yönünde. Bu test o kısayola dönüşü engelliyor.
test("the daily aggregate would understate the drawdown", () => {
  const strategy = strategyOf(SINGLE_PAIR) as {
    daily_profit: [string, number][];
    starting_balance: number;
    max_drawdown_account: number;
  };

  let balance = strategy.starting_balance;
  let peak = balance;
  let deepest = 0;

  for (const [, profit] of strategy.daily_profit) {
    balance += profit;
    peak = Math.max(peak, balance);
    deepest = Math.min(deepest, (balance - peak) / peak);
  }

  assert.ok(
    Math.abs(deepest) < strategy.max_drawdown_account,
    "the daily aggregate is expected to miss the intraday trough",
  );
});

test("the curve starts at the datum and never rises above it", () => {
  const { summary } = parseResult(FIXTURE);

  assert.equal(summary.drawdown_curve[0], 0);
  assert.equal(summary.drawdown_curve.length, summary.total_trades + 1);
  assert.ok(summary.drawdown_curve.every((point) => point <= 0));
});

test("the stored curve is what the interface reads", () => {
  const { summary } = parseResult(SINGLE_PAIR);
  assert.deepEqual(underwaterCurve(summary), summary.drawdown_curve);
});

// Kovanın ortalamasını almak en derin çukuru yumuşatır ve sayıyı olduğundan
// iyi gösterir. İndirgeme minimum almalı.
test("downsampling keeps the trough instead of averaging it away", () => {
  const points = [0, -0.01, -0.4, -0.02, 0, -0.03, -0.01, 0];
  const reduced = downsampleTrough(points, 4);

  assert.equal(reduced.length, 4);
  assert.equal(Math.min(...reduced), -0.4);
});

test("downsampling leaves a short curve alone", () => {
  assert.deepEqual(downsampleTrough([0, -0.1, -0.2], 8), [0, -0.1, -0.2]);
});

// ---------------------------------------------------------------------------
// Zip okuyucu
// ---------------------------------------------------------------------------

test("a stored entry is read back verbatim", () => {
  const archive = buildZip([{ name: "result.json", data: Buffer.from('{"ok":true}') }]);

  assert.deepEqual(zipEntryNames(archive), ["result.json"]);
  assert.equal(readZipEntry(archive, (name) => name === "result.json").toString(), '{"ok":true}');
});

// Freqtrade'in gerçek arşivleri deflate kullanıyor.
test("a deflated entry is inflated", () => {
  const payload = Buffer.from(JSON.stringify({ strategy: { X: { total_trades: 3 } } }).repeat(50));
  const archive = buildZip([
    { name: "other_config.json", data: Buffer.from("{}") },
    { name: "result.json", data: payload, deflate: true },
  ]);

  assert.deepEqual(readZipEntry(archive, (name) => name === "result.json"), payload);
});

test("a missing entry names what the archive actually holds", () => {
  const archive = buildZip([{ name: "a.json", data: Buffer.from("1") }]);

  assert.throws(() => readZipEntry(archive, (name) => name === "b.json"), /a\.json/);
});

test("a file that is not a zip is rejected", () => {
  assert.throws(() => zipEntryNames(Buffer.from("not an archive at all")), ZipError);
});

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

function strategyOf(fixture: unknown): Record<string, unknown> {
  const { strategy } = fixture as { strategy: Record<string, unknown> };
  return Object.values(strategy)[0] as Record<string, unknown>;
}

function withStrategy(overrides: Record<string, unknown>): unknown {
  return { strategy: { UniversalStrategy: { ...strategyOf(FIXTURE), ...overrides } } };
}

function withoutKey(key: string): unknown {
  const { [key]: _dropped, ...rest } = strategyOf(FIXTURE);
  return { strategy: { UniversalStrategy: rest } };
}

/** Elle kurulmuş bir zip — okuyucuyu bağımlılıksız doğrulamak için. */
function buildZip(entries: { name: string; data: Buffer; deflate?: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const stored = entry.deflate ? deflateRawSync(entry.data) : entry.data;
    const method = entry.deflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);

    locals.push(local, name, stored);
    centrals.push(central, name);
    offset += local.length + name.length + stored.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, directory, end]);
}
