/**
 * Veritabanını hazırlar: migration'ları uygular ve `rulesets/` altındaki
 * kural setlerini `builtin` kaynağıyla yükler.
 *
 *   pnpm --filter @rudder/web seed
 *
 * Tekrar çalıştırmak güvenlidir. Kural setleri değişmez olduğu için, bir
 * dosyanın içeriği değiştiyse yeni bir SÜRÜM eklenir; mevcut satır
 * güncellenmez. Böylece o sürüme bağlı botların geçmişi yorumlanabilir kalır.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { desc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { createDatabase, rulesets } from "@rudder/db";
import { validateRuleset } from "@rudder/ruleset";

const REPO = resolve(import.meta.dirname, "../../..");
const RULESET_DIR = resolve(REPO, "rulesets");
const MIGRATIONS = resolve(REPO, "packages/db/migrations");

const dbPath = process.env["RUDDER_DB"] ?? resolve(process.env["HOME"] ?? ".", ".rudder/rudder.db");

mkdirSync(dirname(dbPath), { recursive: true });

const db = createDatabase({ source: dbPath });
migrate(db, { migrationsFolder: MIGRATIONS });
console.log(`database ready at ${dbPath}`);

const files = readdirSync(RULESET_DIR)
  .filter((name) => name.endsWith(".json"))
  .sort();

let added = 0;
let unchanged = 0;

for (const file of files) {
  const parsed: unknown = JSON.parse(readFileSync(resolve(RULESET_DIR, file), "utf8"));
  const result = validateRuleset(parsed);

  if (!result.ok) {
    console.error(`skipped ${file}:`);
    for (const error of result.errors) console.error(`  ${error.path}: ${error.message}`);
    process.exitCode = 1;
    continue;
  }

  const body = result.ruleset;
  const latest = db
    .select()
    .from(rulesets)
    .where(eq(rulesets.slug, body.id))
    .orderBy(desc(rulesets.version))
    .get();

  if (latest && JSON.stringify(latest.body) === JSON.stringify(body)) {
    unchanged++;
    continue;
  }

  db.insert(rulesets)
    .values({
      id: randomUUID(),
      slug: body.id,
      version: (latest?.version ?? 0) + 1,
      body,
      source: "builtin",
    })
    .run();

  console.log(`  + ${body.id} v${(latest?.version ?? 0) + 1}`);
  added++;
}

console.log(`${added} added, ${unchanged} already current`);
