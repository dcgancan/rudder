import BetterSqlite3 from "better-sqlite3";

import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema.ts";

export type Database = ReturnType<typeof createDatabase>;

export type DatabaseOptions = {
  /** Dosya yolu, ya da testler için ":memory:". */
  source: string;
};

/**
 * Bağlantı açar ve pragma'ları ayarlar.
 *
 * `foreign_keys` açıkça açılıyor: SQLite'ta varsayılan KAPALI olduğu için,
 * unutulursa şemadaki bütün referanslar sessizce hiçbir şey yapmaz.
 *
 * Not: Node'un yerleşik `node:sqlite` modülü bu iş için daha uygun olurdu
 * (native bağımlılık yok), ama Drizzle desteği yalnızca 1.0 release
 * candidate hattında. Drizzle 1.0 kararlıya çıkınca gözden geçirilmeli.
 */
export function createDatabase({ source }: DatabaseOptions) {
  const sqlite = new BetterSqlite3(source);

  // WAL yalnızca dosya tabanlı veritabanlarında anlamlı; bellek içi bağlantıda
  // sessizce yok sayılır ama açıkça atlamak niyeti belli ediyor.
  if (source !== ":memory:") sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  return drizzle(sqlite, { schema });
}
