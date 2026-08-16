/**
 * Bot satırının yaratılması.
 *
 * Docker'a dokunmuyor: `create()` yalnızca satırı yazar, container'ı `start()`
 * kaldırır. Gerçek yaşam döngüsü `lifecycle.test.ts`'te.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, test } from "node:test";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { bots, createDatabase, rulesets } from "@rudder/db";
import type { Database } from "@rudder/db";
import { STANDARD_SETUP } from "@rudder/freqtrade";
import { parseRuleset } from "@rudder/ruleset";

import { Orchestrator } from "../src/orchestrator.ts";

const REPO = resolve(import.meta.dirname, "../../..");
const MIGRATIONS = resolve(REPO, "packages/db/migrations");

const body = parseRuleset(
  JSON.parse(readFileSync(resolve(REPO, "rulesets/bb-bounce.json"), "utf8")),
);

let db: Database;
let orchestrator: Orchestrator;
let rulesetId: string;

beforeEach(() => {
  db = createDatabase({ source: ":memory:" });
  migrate(db, { migrationsFolder: MIGRATIONS });

  rulesetId = randomUUID();
  db.insert(rulesets)
    .values({ id: rulesetId, slug: "bb-bounce", version: 1, body, source: "builtin" })
    .run();

  orchestrator = new Orchestrator({ db });
});

const rowOf = (id: string) => db.select().from(bots).where(eq(bots.id, id)).get();

// Bot, stratejinin ÖLÇÜLDÜĞÜ ayarlarla çalışmalı. Ayrılırsa, kullanıcının
// ekranda gördüğü sayı o botun sayısı olmaktan çıkar.
test("a new bot inherits the setup the strategy was measured with", () => {
  const row = rowOf(orchestrator.create({ rulesetId, name: "Test Bot" }));

  assert.equal(row?.exchange, STANDARD_SETUP.exchange);
  assert.equal(row?.stakeCurrency, STANDARD_SETUP.stakeCurrency);
  assert.equal(row?.stakeAmount, STANDARD_SETUP.stake);
  assert.equal(row?.maxOpenTrades, STANDARD_SETUP.maxOpenTrades);
  assert.equal(row?.paperWallet, STANDARD_SETUP.wallet);
  assert.deepEqual(row?.pairs, [...STANDARD_SETUP.pairs]);
});

// Gerçek parayla işlem borsa anahtarlarının şifresini çözmeyi gerektiriyor ve
// `packages/crypto` yazılmadı. Buradan live bir bot çıkamamalı.
test("a new bot is always on paper and always stopped", () => {
  const row = rowOf(orchestrator.create({ rulesetId, name: "Test Bot" }));

  assert.equal(row?.mode, "paper");
  assert.equal(row?.status, "stopped");
  assert.equal(row?.containerId, null);
  assert.equal(row?.apiPort, null);
  assert.equal(row?.exchangeAccountId, null);
});

// Bot belirli bir kural seti SÜRÜMÜNE bağlanır; kural seti düzenlenince
// çalışan bot etkilenmez.
test("a bot is bound to the exact ruleset version it was created from", () => {
  const row = rowOf(orchestrator.create({ rulesetId, name: "Test Bot" }));
  assert.equal(row?.rulesetId, rulesetId);
});

test("names are trimmed and an empty one is rejected", () => {
  const row = rowOf(orchestrator.create({ rulesetId, name: "  Kenarlı Ad  " }));
  assert.equal(row?.name, "Kenarlı Ad");

  assert.throws(() => orchestrator.create({ rulesetId, name: "   " }), /needs a name/);
});

test("a bot cannot be created from a ruleset that does not exist", () => {
  assert.throws(
    () => orchestrator.create({ rulesetId: randomUUID(), name: "Ghost" }),
    /no such ruleset/,
  );
});

test("two bots from the same strategy are separate rows", () => {
  const first = orchestrator.create({ rulesetId, name: "Bir" });
  const second = orchestrator.create({ rulesetId, name: "İki" });

  assert.notEqual(first, second);
  assert.equal(rowOf(second)?.name, "İki");
});
