/**
 * Gerçek Docker ile backtest zinciri.
 *
 *   RUDDER_INTEGRATION=1 pnpm --filter @rudder/backtest test
 *
 * Veritabanındaki bir satırdan indirilmiş mum verisine, oradan ayrıştırılmış
 * sonuca kadar zincirin tamamını doğrular. Borsa anahtarı gerekmez — mum
 * verisi herkese açık uçlardan iniyor.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, test } from "node:test";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { backtests, createDatabase, rulesets } from "@rudder/db";
import type { Database } from "@rudder/db";
import { removeContainer } from "@rudder/host";
import { parseRuleset } from "@rudder/ruleset";

import { backtestPaths, containerName } from "../src/paths.ts";
import { underwaterCurve } from "../src/result.ts";
import type { BacktestSummary } from "../src/result.ts";
import { BacktestRunner } from "../src/runner.ts";

const REPO = resolve(import.meta.dirname, "../../..");
const MIGRATIONS = resolve(REPO, "packages/db/migrations");

// Mount edilen hiçbir yol OS temp'inde olamaz — container çalışma zamanı o
// yolu paylaşmıyor. Repo altı paylaşılıyor.
const DATA_ROOT = resolve(REPO, ".rudder-test");

// Sabit ve geçmişte kalmış bir ay: testin sonucu takvime göre değişmesin.
const TIMERANGE = "20260601-20260701";

const enabled = process.env["RUDDER_INTEGRATION"] === "1";

const backtestId = randomUUID();
const brokenId = randomUUID();
const rulesetId = randomUUID();

let db: Database;
let runner: BacktestRunner;

before(() => {
  if (!enabled) return;

  db = createDatabase({ source: ":memory:" });
  migrate(db, { migrationsFolder: MIGRATIONS });

  const body = parseRuleset(
    JSON.parse(readFileSync(resolve(REPO, "rulesets/bb-bounce.json"), "utf8")),
  );

  db.insert(rulesets)
    .values({ id: rulesetId, slug: "bb-bounce", version: 1, body, source: "builtin" })
    .run();

  // Tek parite: zincirin doğruluğunu ölçüyoruz, stratejinin kendisini değil.
  db.insert(backtests)
    .values({
      id: backtestId,
      rulesetId,
      exchange: "binance",
      pairs: ["BTC/USDT"],
      timerange: TIMERANGE,
      status: "queued",
    })
    .run();

  db.insert(backtests)
    .values({
      id: brokenId,
      rulesetId,
      exchange: "binance",
      pairs: ["NOSUCHCOIN/USDT"],
      timerange: TIMERANGE,
      status: "queued",
    })
    .run();

  runner = new BacktestRunner({
    db,
    dataRoot: DATA_ROOT,
    engineDir: resolve(REPO, "engine"),
  });
});

after(async () => {
  if (!enabled) return;

  for (const id of [backtestId, brokenId]) {
    await removeContainer(containerName(id, "download"));
    await removeContainer(containerName(id, "backtest"));
  }
  rmSync(DATA_ROOT, { recursive: true, force: true });
});

const row = (id: string) => db.select().from(backtests).where(eq(backtests.id, id)).get();

test("a queued backtest runs to a stored result", { skip: !enabled }, async () => {
  assert.equal(await runner.run(backtestId), "done");

  const result = row(backtestId);
  assert.equal(result?.status, "done");
  assert.equal(result?.error, null);
  assert.ok(result?.finishedAt);

  assert.ok(typeof result?.totalTrades === "number");
  assert.ok((result?.maxDrawdown ?? -1) >= 0 && (result?.maxDrawdown ?? 1) < 1);
  assert.ok(typeof result?.marketChange === "number");
});

test("the stored result carries the curve but not the trades", { skip: !enabled }, () => {
  const summary = row(backtestId)?.result as BacktestSummary;

  assert.ok(summary.drawdown_curve.length > 0);
  assert.ok(!("trades" in summary), "trades[] must not reach the database");

  // Diskteki tam kayıt ile veritabanındaki özet aynı düşüşü söylemeli.
  const deepest = Math.min(...underwaterCurve(summary));
  assert.ok(
    Math.abs(deepest + summary.max_drawdown_account) < 1e-12,
    `curve bottoms at ${deepest}, freqtrade reports ${-summary.max_drawdown_account}`,
  );
});

test("the measured period stays inside the requested one", { skip: !enabled }, () => {
  const summary = row(backtestId)?.result as BacktestSummary;

  assert.ok(summary.backtest_start_ts >= Date.UTC(2026, 5, 1));
  assert.ok(summary.backtest_end_ts <= Date.UTC(2026, 6, 1));
  // Isınma payı indirildiği için ölçüm istenen günde başlamalı, daha geç değil.
  assert.ok(summary.backtest_start_ts < Date.UTC(2026, 5, 2));
});

test("the run leaves the full archive and a readable log", { skip: !enabled }, () => {
  const paths = backtestPaths(backtestId, DATA_ROOT);

  assert.ok(existsSync(paths.ruleset));
  assert.ok(existsSync(paths.config));

  const archives = readdirSync(paths.results).filter((name) => name.endsWith(".zip"));
  assert.equal(archives.length, 1, "freqtrade should have written exactly one archive");

  const log = readFileSync(paths.log, "utf8");
  assert.match(log, /===== download-data =====/);
  assert.match(log, /===== backtesting =====/);
});

// Hata yolu: satır `failed` olmalı ve sebebi teşhis edilebilir kalmalı.
test("a run that cannot get data fails with its output kept", { skip: !enabled }, async () => {
  assert.equal(await runner.run(brokenId), "failed");

  const result = row(brokenId);
  assert.equal(result?.status, "failed");
  assert.ok(result?.error && result.error.length > 0, "the failure must say something");
  assert.ok(result?.finishedAt);

  // Dizin duruyor: container gittikten sonra teşhisin tek kaynağı bu.
  assert.ok(existsSync(backtestPaths(brokenId, DATA_ROOT).log));
});
