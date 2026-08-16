/**
 * Kuyruğun kendi mantığı: tekilleştirme, sıralama, kurtarma.
 *
 * Docker'a dokunmuyor — çalıştırıcı yerine satırı `done` yapan bir sahte
 * geçiliyor. Gerçek container zinciri `integration.test.ts`'te.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, test } from "node:test";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { backtests, createDatabase, rulesets } from "@rudder/db";
import type { Database } from "@rudder/db";
import { parseRuleset } from "@rudder/ruleset";

import { STANDARD_SETUP } from "@rudder/freqtrade";
import { BacktestQueue } from "../src/queue.ts";

const REPO = resolve(import.meta.dirname, "../../..");
const MIGRATIONS = resolve(REPO, "packages/db/migrations");

const body = parseRuleset(
  JSON.parse(readFileSync(resolve(REPO, "rulesets/bb-bounce.json"), "utf8")),
);

let db: Database;
let ran: string[];

beforeEach(() => {
  db = createDatabase({ source: ":memory:" });
  migrate(db, { migrationsFolder: MIGRATIONS });
  ran = [];
});

function seedRuleset(slug: string): string {
  const id = randomUUID();
  db.insert(rulesets).values({ id, slug, version: 1, body, source: "builtin" }).run();
  return id;
}

/** Çalıştırıcı yerine geçen sahte: sırayı kaydeder, satırı bitmiş sayar. */
function queueWith(): BacktestQueue {
  return new BacktestQueue({
    db,
    runner: {
      run: async (backtestId) => {
        ran.push(backtestId);
        db.update(backtests).set({ status: "running" }).where(eq(backtests.id, backtestId)).run();

        // Gerçek çalıştırıcı dakikalarca beklerken satır `running` kalıyor;
        // sahte de en az bir tur beklemezse eşzamanlılık hiç sınanmamış olur.
        await new Promise((done) => setImmediate(done));

        db.update(backtests)
          .set({ status: "done", finishedAt: new Date() })
          .where(eq(backtests.id, backtestId))
          .run();
      },
    },
  });
}

const rowOf = (id: string) => db.select().from(backtests).where(eq(backtests.id, id)).get();

test("enqueueing writes a queued row with the fixed test definition", async () => {
  const queue = queueWith();
  const id = queue.enqueue({ rulesetId: seedRuleset("bb-bounce"), months: 6 });
  await queue.drain();

  const row = rowOf(id);
  assert.equal(row?.exchange, STANDARD_SETUP.exchange);
  assert.deepEqual(row?.pairs, [...STANDARD_SETUP.pairs]);
  // Aralık kapalı: kaydedilmiş bir ölçüm yeniden üretilebilir olmalı.
  assert.match(row?.timerange ?? "", /^\d{8}-\d{8}$/);
  assert.equal(row?.status, "done");
});

// Butona iki kez basmak iki container başlatmamalı.
test("a second request for the same ruleset joins the running one", async () => {
  const queue = queueWith();
  const rulesetId = seedRuleset("bb-bounce");

  const first = queue.enqueue({ rulesetId, months: 6 });
  const second = queue.enqueue({ rulesetId, months: 12 });

  assert.equal(second, first);
  await queue.drain();
  assert.deepEqual(ran, [first]);
});

test("a different ruleset gets its own run", async () => {
  const queue = queueWith();

  const first = queue.enqueue({ rulesetId: seedRuleset("bb-bounce"), months: 6 });
  const second = queue.enqueue({ rulesetId: seedRuleset("ema-cross"), months: 6 });
  await queue.drain();

  assert.notEqual(second, first);
  assert.deepEqual(ran, [first, second]);
});

test("a finished ruleset can be tested again", async () => {
  const queue = queueWith();
  const rulesetId = seedRuleset("bb-bounce");

  const first = queue.enqueue({ rulesetId, months: 6 });
  await queue.drain();

  const second = queue.enqueue({ rulesetId, months: 3 });
  await queue.drain();

  assert.notEqual(second, first);
});

// `running` bir satır, onu çalıştıran süreç öldüğünde sonsuza kadar öyle kalır
// ve arayüzde "çalışıyor" görünür.
test("recovery ends runs that a dead process left behind", async () => {
  const rulesetId = seedRuleset("bb-bounce");
  const orphan = randomUUID();

  db.insert(backtests)
    .values({
      id: orphan,
      rulesetId,
      exchange: "binance",
      pairs: ["BTC/USDT"],
      timerange: "20260216-20260816",
      status: "running",
    })
    .run();

  const queue = queueWith();
  await queue.recover();

  const row = rowOf(orphan);
  assert.equal(row?.status, "failed");
  assert.equal(row?.error, "interrupted");
  assert.ok(row?.finishedAt);
  // Yarıda kalanı sessizce yeniden başlatmak kullanıcının kararı olmaz.
  assert.deepEqual(ran, []);
});

// Hiç başlamamış bir iş, süreç yeniden açıldığında devam edebilmeli.
test("recovery picks up work that never started", async () => {
  const rulesetId = seedRuleset("bb-bounce");
  const waiting = randomUUID();

  db.insert(backtests)
    .values({
      id: waiting,
      rulesetId,
      exchange: "binance",
      pairs: ["BTC/USDT"],
      timerange: "20260216-20260816",
      status: "queued",
    })
    .run();

  const queue = queueWith();
  await queue.recover();
  await queue.drain();

  assert.deepEqual(ran, [waiting]);
  assert.equal(rowOf(waiting)?.status, "done");
});
