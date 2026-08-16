/**
 * Gözcü döngüsü.
 *
 * Docker'a dokunmuyor: gözcünün orchestrator'dan tek beklentisi `refreshStatus`
 * ve `syncTrades`, ve burada ikisi de sahte. Test edilen şey döngünün kendi
 * mantığı — hangi botlara bakıldığı, hataların yalıtımı, tıkların üst üste
 * binmemesi.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, test } from "node:test";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { bots, createDatabase, rulesets } from "@rudder/db";
import type { BotRow, Database } from "@rudder/db";
import { parseRuleset } from "@rudder/ruleset";

import type { BotMonitor } from "../src/watchdog.ts";
import { Watchdog } from "../src/watchdog.ts";

const REPO = resolve(import.meta.dirname, "../../..");
const MIGRATIONS = resolve(REPO, "packages/db/migrations");

const body = parseRuleset(
  JSON.parse(readFileSync(resolve(REPO, "rulesets/bb-bounce.json"), "utf8")),
);

let db: Database;
let rulesetId: string;

beforeEach(() => {
  db = createDatabase({ source: ":memory:" });
  migrate(db, { migrationsFolder: MIGRATIONS });

  rulesetId = randomUUID();
  db.insert(rulesets)
    .values({ id: rulesetId, slug: "bb-bounce", version: 1, body, source: "builtin" })
    .run();
});

function addBot(name: string, status: BotRow["status"]): string {
  const id = randomUUID();
  db.insert(bots)
    .values({
      id,
      name,
      rulesetId,
      status,
      exchange: "binance",
      stakeCurrency: "USDT",
      stakeAmount: 100,
      maxOpenTrades: 2,
      pairs: ["BTC/USDT"],
      paperWallet: 1000,
    })
    .run();
  return id;
}

/** Çağrıları kaydeden sahte izleyici. */
function spy(over: Partial<BotMonitor> = {}) {
  const refreshed: string[] = [];
  const synced: string[] = [];

  const monitor: BotMonitor = {
    refreshStatus: async (botId) => {
      refreshed.push(botId);
      return "running";
    },
    syncTrades: async (botId) => {
      synced.push(botId);
      return 0;
    },
    ...over,
  };

  return { monitor, refreshed, synced };
}

// --------------------------------------------------------------------------
// Hangi botlar
// --------------------------------------------------------------------------

test("a stopped bot is not polled", async () => {
  addBot("Stopped", "stopped");
  const running = addBot("Running", "running");

  const { monitor, refreshed } = spy();
  await new Watchdog({ db, monitor }).tick();

  assert.deepEqual(refreshed, [running]);
});

// Docker çöken botu geri getirmeye devam ediyor, yani `error` bir bot hâlâ
// değişebilir. İzlemeyi bırakmak, toparlandığını hiç görmemek demek olurdu.
test("a failed bot is still watched", async () => {
  const failed = addBot("Failed", "error");

  const { monitor, refreshed } = spy();
  await new Watchdog({ db, monitor }).tick();

  assert.deepEqual(refreshed, [failed]);
});

test("a removed bot is not polled", async () => {
  const removed = addBot("Removed", "running");
  db.update(bots).set({ deletedAt: new Date() }).run();

  const { monitor, refreshed } = spy();
  await new Watchdog({ db, monitor }).tick();

  assert.equal(refreshed.includes(removed), false);
});

// --------------------------------------------------------------------------
// Hata yalıtımı
// --------------------------------------------------------------------------

// Bir botun okunamaması, diğerlerinin de görünmez olması demek olamaz — hele
// gözcünün varlık sebebi bir şeylerin ters gittiğini fark etmekken.
test("one unreadable bot does not hide the others", async () => {
  const first = addBot("Aaa", "running");
  const second = addBot("Bbb", "running");
  const third = addBot("Ccc", "running");

  const seen: string[] = [];
  const { monitor } = spy({
    refreshStatus: async (botId) => {
      seen.push(botId);
      if (botId === second) throw new Error("docker is having a moment");
      return "running";
    },
  });

  await new Watchdog({ db, monitor }).tick();

  assert.equal(seen.length, 3);
  assert.ok(seen.includes(first) && seen.includes(third));
});

test("a bot that cannot mirror its trades is still polled next time", async () => {
  const id = addBot("Solo", "running");

  const { monitor, refreshed } = spy({
    syncTrades: async () => {
      throw new Error("the API went away mid-request");
    },
  });

  const watchdog = new Watchdog({ db, monitor, syncIntervalMs: 0 });
  await watchdog.tick();
  await watchdog.tick();

  assert.deepEqual(refreshed, [id, id]);
});

// --------------------------------------------------------------------------
// Çakışma
// --------------------------------------------------------------------------

// Yavaş bir Docker'da tıklar üst üste binseydi, her tur bir öncekini daha da
// yavaşlatır ve döngü kendini boğardı.
test("a tick that is still running is not started again", async () => {
  addBot("Slow", "running");

  let inFlight = 0;
  let overlapped = false;
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  const { monitor } = spy({
    refreshStatus: async () => {
      inFlight += 1;
      if (inFlight > 1) overlapped = true;
      await held;
      inFlight -= 1;
      return "running";
    },
  });

  const watchdog = new Watchdog({ db, monitor });

  const first = watchdog.tick();
  const second = watchdog.tick();

  release();
  await Promise.all([first, second]);

  assert.equal(overlapped, false);
  assert.equal(first, second, "the second tick should join the first, not open a new sweep");
});

// --------------------------------------------------------------------------
// İşlem aynalama
// --------------------------------------------------------------------------

test("only a running bot mirrors its trades", async () => {
  addBot("Starting", "starting");

  const { monitor, synced } = spy({ refreshStatus: async () => "starting" });
  await new Watchdog({ db, monitor, syncIntervalMs: 0 }).tick();

  assert.deepEqual(synced, []);
});

// Durum on beş saniyede bir okunuyor; aynı 500 işlemi o sıklıkta yeniden
// çekmenin kimseye faydası yok.
test("trades are mirrored on their own, slower rhythm", async () => {
  const id = addBot("Busy", "running");

  const { monitor, refreshed, synced } = spy();
  const watchdog = new Watchdog({ db, monitor, syncIntervalMs: 60_000 });

  await watchdog.tick();
  await watchdog.tick();
  await watchdog.tick();

  assert.equal(refreshed.length, 3, "status is read on every tick");
  assert.deepEqual(synced, [id], "trades are mirrored once");
});

// --------------------------------------------------------------------------
// Zamanlayıcı
// --------------------------------------------------------------------------

test("the timer keeps polling until it is stopped", async () => {
  addBot("Ticker", "running");

  const { monitor, refreshed } = spy();
  const watchdog = new Watchdog({ db, monitor, intervalMs: 10 });

  watchdog.start();
  // İkinci `start()` ikinci bir zamanlayıcı kurmamalı; kursaydı aşağıdaki
  // sayım iki katına çıkardı.
  watchdog.start();

  await new Promise((done) => setTimeout(done, 120));
  watchdog.stop();

  const whileRunning = refreshed.length;
  assert.ok(whileRunning >= 2, `expected the timer to fire, saw ${whileRunning} polls`);

  // 10 ms aralıkta 120 ms boyunca en fazla ~12 tık olur. Belirgin şekilde
  // fazlası, ikinci bir döngünün de döndüğü anlamına gelirdi.
  assert.ok(whileRunning <= 20, `expected one loop, saw ${whileRunning} polls`);

  await new Promise((done) => setTimeout(done, 60));
  assert.equal(refreshed.length, whileRunning, "stop() should end the polling");
});
