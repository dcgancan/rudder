import assert from "node:assert/strict";
import { test } from "node:test";

import { and, eq, isNull } from "drizzle-orm";

import { describe, loadLocale } from "@rudder/ruleset";

import { backtests, bots, exchangeAccounts, rulesets, trades } from "../src/schema.ts";
import { freshDatabase, sampleRuleset, uuid } from "./helpers.ts";

// --------------------------------------------------------------------------
// Kural setleri değişmezdir
// --------------------------------------------------------------------------

test("a slug can hold multiple versions side by side", () => {
  const db = freshDatabase();
  const body = sampleRuleset();

  const v1 = uuid();
  const v2 = uuid();
  db.insert(rulesets)
    .values([
      { id: v1, slug: "my-strategy", version: 1, body, source: "local" },
      { id: v2, slug: "my-strategy", version: 2, body, source: "local" },
    ])
    .run();

  const rows = db.select().from(rulesets).where(eq(rulesets.slug, "my-strategy")).all();
  assert.equal(rows.length, 2);
});

test("the same version of a slug cannot be inserted twice", () => {
  const db = freshDatabase();
  const body = sampleRuleset();

  db.insert(rulesets)
    .values({ id: uuid(), slug: "dupe", version: 1, body, source: "local" })
    .run();

  assert.throws(() =>
    db.insert(rulesets).values({ id: uuid(), slug: "dupe", version: 1, body, source: "local" }).run(),
  );
});

// Editing a strategy must not silently rewrite what a running bot is doing —
// otherwise its trade history becomes impossible to interpret.
test("editing a ruleset does not change what an existing bot runs", () => {
  const db = freshDatabase();
  const original = sampleRuleset();

  const v1 = uuid();
  db.insert(rulesets)
    .values({ id: v1, slug: "evolving", version: 1, body: original, source: "local" })
    .run();

  const botId = uuid();
  db.insert(bots)
    .values({
      id: botId,
      name: "Bot",
      rulesetId: v1,
      exchange: "binance",
      stakeCurrency: "USDT",
      stakeAmount: 100,
      maxOpenTrades: 3,
      pairs: ["BTC/USDT"],
    })
    .run();

  // The user "edits" the strategy: a new version row, looser stop loss.
  const edited = { ...original, risk: { ...original.risk, stoploss: -0.5 } };
  db.insert(rulesets)
    .values({ id: uuid(), slug: "evolving", version: 2, body: edited, source: "local" })
    .run();

  const bot = db.select().from(bots).where(eq(bots.id, botId)).get();
  const running = db.select().from(rulesets).where(eq(rulesets.id, bot!.rulesetId)).get();

  assert.equal(running!.version, 1);
  assert.equal(running!.body.risk.stoploss, original.risk.stoploss);
});

// --------------------------------------------------------------------------
// Güvenlik kısıtları veritabanı seviyesinde
// --------------------------------------------------------------------------

// A bot trading real money cannot exist without credentials. Even if the
// application layer has a bug, the database refuses.
test("a live bot cannot be created without an exchange account", () => {
  const db = freshDatabase();
  const rulesetId = uuid();
  db.insert(rulesets)
    .values({ id: rulesetId, slug: "s", version: 1, body: sampleRuleset(), source: "local" })
    .run();

  assert.throws(
    () =>
      db
        .insert(bots)
        .values({
          id: uuid(),
          name: "Reckless",
          rulesetId,
          mode: "live",
          exchangeAccountId: null,
          exchange: "binance",
          stakeCurrency: "USDT",
          stakeAmount: 100,
          maxOpenTrades: 3,
          pairs: ["BTC/USDT"],
        })
        .run(),
    /CHECK constraint failed|constraint/i,
  );
});

test("a live bot with an exchange account is allowed", () => {
  const db = freshDatabase();
  const rulesetId = uuid();
  const accountId = uuid();

  db.insert(rulesets)
    .values({ id: rulesetId, slug: "s", version: 1, body: sampleRuleset(), source: "local" })
    .run();
  db.insert(exchangeAccounts)
    .values({
      id: accountId,
      label: "Main",
      exchange: "binance",
      apiKeyEnc: Buffer.from("enc"),
      apiSecretEnc: Buffer.from("enc"),
      withdrawalDisabled: true,
    })
    .run();

  db.insert(bots)
    .values({
      id: uuid(),
      name: "Careful",
      rulesetId,
      mode: "live",
      exchangeAccountId: accountId,
      exchange: "binance",
      stakeCurrency: "USDT",
      stakeAmount: 100,
      maxOpenTrades: 3,
      pairs: ["BTC/USDT"],
    })
    .run();

  assert.equal(db.select().from(bots).all().length, 1);
});

test("stake amount must be positive", () => {
  const db = freshDatabase();
  const rulesetId = uuid();
  db.insert(rulesets)
    .values({ id: rulesetId, slug: "s", version: 1, body: sampleRuleset(), source: "local" })
    .run();

  assert.throws(() =>
    db
      .insert(bots)
      .values({
        id: uuid(),
        name: "Zero",
        rulesetId,
        exchange: "binance",
        stakeCurrency: "USDT",
        stakeAmount: 0,
        maxOpenTrades: 3,
        pairs: ["BTC/USDT"],
      })
      .run(),
  );
});

// SQLite leaves foreign keys OFF by default. If createDatabase forgets the
// pragma every reference in the schema silently does nothing, so assert it.
test("foreign keys are actually enforced", () => {
  const db = freshDatabase();

  assert.throws(
    () =>
      db
        .insert(bots)
        .values({
          id: uuid(),
          name: "Orphan",
          rulesetId: "does-not-exist",
          exchange: "binance",
          stakeCurrency: "USDT",
          stakeAmount: 100,
          maxOpenTrades: 3,
          pairs: ["BTC/USDT"],
        })
        .run(),
    /FOREIGN KEY|constraint/i,
  );
});

// --------------------------------------------------------------------------
// Geçmiş bot silindikten sonra da kalır
// --------------------------------------------------------------------------

test("trade history survives a soft-deleted bot", () => {
  const db = freshDatabase();
  const rulesetId = uuid();
  const botId = uuid();

  db.insert(rulesets)
    .values({ id: rulesetId, slug: "s", version: 1, body: sampleRuleset(), source: "local" })
    .run();
  db.insert(bots)
    .values({
      id: botId,
      name: "Retired",
      rulesetId,
      exchange: "binance",
      stakeCurrency: "USDT",
      stakeAmount: 100,
      maxOpenTrades: 3,
      pairs: ["BTC/USDT"],
    })
    .run();
  db.insert(trades)
    .values({
      id: uuid(),
      botId,
      ftTradeId: 1,
      pair: "BTC/USDT",
      openedAt: new Date(1_700_000_000_000),
      closedAt: new Date(1_700_003_600_000),
      openRate: 100,
      closeRate: 104,
      amount: 1,
      stakeAmount: 100,
      profitAbs: 4,
      profitRatio: 0.04,
      exitReason: "roi",
    })
    .run();

  db.update(bots).set({ deletedAt: new Date() }).where(eq(bots.id, botId)).run();

  assert.equal(db.select().from(trades).where(eq(trades.botId, botId)).all().length, 1);
  assert.equal(db.select().from(bots).where(isNull(bots.deletedAt)).all().length, 0);
});

test("re-syncing the same trade does not duplicate it", () => {
  const db = freshDatabase();
  const rulesetId = uuid();
  const botId = uuid();

  db.insert(rulesets)
    .values({ id: rulesetId, slug: "s", version: 1, body: sampleRuleset(), source: "local" })
    .run();
  db.insert(bots)
    .values({
      id: botId,
      name: "Syncing",
      rulesetId,
      exchange: "binance",
      stakeCurrency: "USDT",
      stakeAmount: 100,
      maxOpenTrades: 3,
      pairs: ["BTC/USDT"],
    })
    .run();

  const row = {
    botId,
    ftTradeId: 7,
    pair: "ETH/USDT",
    openedAt: new Date(1_700_000_000_000),
    openRate: 100,
    amount: 1,
    stakeAmount: 100,
  };

  db.insert(trades).values({ id: uuid(), ...row }).run();
  assert.throws(() => db.insert(trades).values({ id: uuid(), ...row }).run());

  // The sync path should upsert on (bot_id, ft_trade_id) instead.
  db.insert(trades)
    .values({ id: uuid(), ...row, profitRatio: 0.02 })
    .onConflictDoUpdate({
      target: [trades.botId, trades.ftTradeId],
      set: { profitRatio: 0.02, closedAt: new Date(1_700_003_600_000) },
    })
    .run();

  const all = db.select().from(trades).where(eq(trades.botId, botId)).all();
  assert.equal(all.length, 1);
  assert.equal(all[0]?.profitRatio, 0.02);
});

// --------------------------------------------------------------------------
// Kural seti tipi uçtan uca korunur
// --------------------------------------------------------------------------

// The point of storing the ruleset as typed JSON: it comes back out of SQLite
// as a real Ruleset and can be rendered without re-parsing or casting.
test("a stored ruleset round-trips and can still be described", async () => {
  const db = freshDatabase();
  const id = uuid();

  db.insert(rulesets)
    .values({ id, slug: "rsi-dip-buyer", version: 1, body: sampleRuleset(), source: "builtin" })
    .run();

  const row = db.select().from(rulesets).where(eq(rulesets.id, id)).get();
  const description = describe(row!.body, await loadLocale("tr"), "tr");

  assert.equal(description.name, "RSI Dip Alıcı");
  assert.ok(description.entry.sentence.endsWith("AL."));
});

test("backtest headline metrics are queryable without parsing the result blob", () => {
  const db = freshDatabase();
  const rulesetId = uuid();
  db.insert(rulesets)
    .values({ id: rulesetId, slug: "s", version: 1, body: sampleRuleset(), source: "local" })
    .run();

  db.insert(backtests)
    .values([
      {
        id: uuid(),
        rulesetId,
        exchange: "binance",
        pairs: ["BTC/USDT"],
        timerange: "20260201-",
        status: "done",
        totalTrades: 222,
        winRate: 0.824,
        profitRatio: -0.1157,
        profitFactor: 0.62,
        expectancy: -0.52,
        maxDrawdown: 0.1292,
        marketChange: -0.2367,
        result: { note: "full freqtrade output goes here" },
      },
      {
        id: uuid(),
        rulesetId,
        exchange: "binance",
        pairs: ["BTC/USDT"],
        timerange: "20260201-",
        status: "queued",
      },
    ])
    .run();

  const done = db
    .select()
    .from(backtests)
    .where(and(eq(backtests.rulesetId, rulesetId), eq(backtests.status, "done")))
    .all();

  assert.equal(done.length, 1);
  // The cautionary example from the project's own testing: a high win rate
  // alongside a loss. Both must be visible without opening the result blob.
  assert.equal(done[0]?.winRate, 0.824);
  assert.ok((done[0]?.profitRatio ?? 0) < 0);
  assert.ok((done[0]?.profitFactor ?? 1) < 1);
});
