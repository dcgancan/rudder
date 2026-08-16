import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { parseRuleset } from "@rudder/ruleset";
import type { Ruleset } from "@rudder/ruleset";

import { createDatabase } from "../src/client.ts";
import type { Database } from "../src/client.ts";

const MIGRATIONS = resolve(import.meta.dirname, "../migrations");
const RULESETS = resolve(import.meta.dirname, "../../../rulesets");

/** Migration'ları uygulanmış, boş, bellek içi veritabanı. */
export function freshDatabase(): Database {
  const db = createDatabase({ source: ":memory:" });
  migrate(db, { migrationsFolder: MIGRATIONS });
  return db;
}

export function sampleRuleset(name = "rsi-dip-buyer"): Ruleset {
  return parseRuleset(JSON.parse(readFileSync(resolve(RULESETS, `${name}.json`), "utf8")));
}

export const uuid = (): string => randomUUID();
