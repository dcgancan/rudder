/**
 * Gerçek Docker ile bot yaşam döngüsü.
 *
 *   RUDDER_INTEGRATION=1 pnpm --filter @rudder/orchestrator test
 *
 * Veritabanındaki bir satırdan çalışan bir bota, oradan senkronize edilmiş
 * işlem geçmişine kadar zincirin tamamını doğrular. Borsa anahtarı gerekmez —
 * paper modda çalışır.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { after, before, test } from "node:test";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { bots, createDatabase, rulesets, trades } from "@rudder/db";
import type { Database } from "@rudder/db";
import { parseRuleset } from "@rudder/ruleset";

import { removeContainer } from "@rudder/host";
import { Orchestrator } from "../src/orchestrator.ts";
import { botPaths, containerName } from "../src/paths.ts";

const REPO = resolve(import.meta.dirname, "../../..");
const MIGRATIONS = resolve(REPO, "packages/db/migrations");

// Bot dizinleri OS temp'inde olamaz — container çalışma zamanı o yolu
// paylaşmıyor. Repo altı paylaşılıyor.
const DATA_ROOT = resolve(REPO, ".rudder-test");

const enabled = process.env["RUDDER_INTEGRATION"] === "1";

const botId = randomUUID();
const rulesetId = randomUUID();

let db: Database;
let orchestrator: Orchestrator;

before(() => {
  if (!enabled) return;

  rmSync(DATA_ROOT, { recursive: true, force: true });

  db = createDatabase({ source: ":memory:" });
  migrate(db, { migrationsFolder: MIGRATIONS });

  const body = parseRuleset(
    JSON.parse(readFileSync(resolve(REPO, "rulesets/rsi-dip-buyer.json"), "utf8")),
  );

  db.insert(rulesets)
    .values({ id: rulesetId, slug: "rsi-dip-buyer", version: 1, body, source: "builtin" })
    .run();

  db.insert(bots)
    .values({
      id: botId,
      name: "Lifecycle Bot",
      rulesetId,
      mode: "paper",
      exchange: "binance",
      stakeCurrency: "USDT",
      stakeAmount: 100,
      maxOpenTrades: 2,
      pairs: ["BTC/USDT", "ETH/USDT"],
      paperWallet: 1000,
    })
    .run();

  orchestrator = new Orchestrator({
    db,
    dataRoot: DATA_ROOT,
    engineDir: resolve(REPO, "engine"),
    portRange: [17_100, 17_120],
  });
});

after(async () => {
  if (!enabled) return;
  await removeContainer(containerName(botId));
  rmSync(DATA_ROOT, { recursive: true, force: true });
});

const row = () => db.select().from(bots).where(eq(bots.id, botId)).get();

test("starting writes the bot's files and marks it starting", { skip: !enabled }, async () => {
  await orchestrator.start(botId);

  const bot = row();
  assert.equal(bot?.status, "starting");
  assert.ok(bot?.containerId, "the container id should be recorded");
  assert.ok(bot?.apiPort, "an API port should be allocated");

  const paths = botPaths(botId, DATA_ROOT);
  assert.ok(existsSync(paths.config));
  assert.ok(existsSync(paths.ruleset));

  // config.json API parolasını içeriyor — başkasına okunur olmamalı.
  assert.equal(statSync(paths.config).mode & 0o077, 0, "config.json must not be group/world readable");
});

test("the bot becomes reachable and reports running", { skip: !enabled }, async () => {
  await orchestrator.waitUntilRunning(botId);

  const bot = row();
  assert.equal(bot?.status, "running");
  assert.ok(bot?.lastSeenAt, "lastSeenAt should be stamped once reachable");
  assert.equal(bot?.lastError, null);
});

test("the running bot uses the stored ruleset", { skip: !enabled }, async () => {
  const client = await orchestrator.client(botId);
  const state = await client.showConfig();

  const stored = db.select().from(rulesets).where(eq(rulesets.id, rulesetId)).get();

  assert.equal(state.timeframe, stored?.body.timeframe);
  assert.equal(state.stoploss, stored?.body.risk.stoploss);
  assert.equal(state.dry_run, true, "a paper bot must be a dry run");
  assert.equal(state.max_open_trades, 2);
});

test("closed trades are mirrored into the database", { skip: !enabled }, async () => {
  const client = await orchestrator.client(botId);

  await client.forceEnter("ETH/USDT");
  await sleep(3000);
  await client.forceExit("all");
  await sleep(5000);

  const synced = await orchestrator.syncTrades(botId);
  assert.ok(synced > 0, "expected at least one closed trade to sync");

  const stored = db.select().from(trades).where(eq(trades.botId, botId)).all();
  assert.ok(stored.length > 0);

  const trade = stored[0];
  assert.equal(trade?.pair, "ETH/USDT");
  assert.ok(trade?.closedAt, "a mirrored trade must be closed");
  // exit_reason enum benzeri bir değer; çeviri anahtarı olarak kullanılıyor.
  assert.equal(trade?.exitReason, "force_exit");
});

test("syncing twice does not duplicate trades", { skip: !enabled }, async () => {
  const before = db.select().from(trades).where(eq(trades.botId, botId)).all().length;

  await orchestrator.syncTrades(botId);

  const after = db.select().from(trades).where(eq(trades.botId, botId)).all().length;
  assert.equal(after, before, "re-syncing must upsert, not insert");
});

test("stopping releases the port and clears the container", { skip: !enabled }, async () => {
  await orchestrator.stop(botId);

  const bot = row();
  assert.equal(bot?.status, "stopped");
  assert.equal(bot?.containerId, null);
  assert.equal(bot?.apiPort, null);
});

// Durdurulmuş container hâlâ duruyor ve Freqtrade SIGTERM aldığında 143 ile
// çıkıyor. Bunu çökme saymak, kullanıcının kendi durdurduğu botu "hata" olarak
// göstermek demek — arayüzde tam olarak öyle oldu.
test("a bot stopped on purpose does not read as an error", { skip: !enabled }, async () => {
  assert.equal(await orchestrator.refreshStatus(botId), "stopped");
  assert.equal(row()?.status, "stopped");
});

test("a stopped bot can be started again", { skip: !enabled }, async () => {
  await orchestrator.start(botId);
  await orchestrator.waitUntilRunning(botId);

  assert.equal(row()?.status, "running");
});

test("removing deletes the container, the files and soft-deletes the row", { skip: !enabled }, async () => {
  const paths = botPaths(botId, DATA_ROOT);

  await orchestrator.remove(botId);

  assert.equal(existsSync(paths.root), false, "the bot directory should be gone");

  // Satır soft-delete edildi: işlem geçmişi kalmalı.
  const stillThere = db.select().from(bots).where(eq(bots.id, botId)).get();
  assert.ok(stillThere?.deletedAt, "the row should be soft-deleted, not removed");
  assert.ok(
    db.select().from(trades).where(eq(trades.botId, botId)).all().length > 0,
    "trade history must outlive the bot",
  );
});
