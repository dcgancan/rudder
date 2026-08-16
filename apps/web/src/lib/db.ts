import { join } from "node:path";

import { createDatabase } from "@rudder/db";
import type { Database } from "@rudder/db";
// Dar import: bütün orchestrator'ı (Docker, container yönetimi) uygulamanın
// bundle'ına çekmenin anlamı yok — burada yalnızca veri kökü gerekiyor.
import { dataRoot } from "@rudder/orchestrator/paths";

export function databasePath(): string {
  return process.env["RUDDER_DB"] ?? join(dataRoot(), "rudder.db");
}

// Next dev sunucusu modülleri yeniden yüklerken her seferinde yeni bir SQLite
// bağlantısı açmasın diye globalde tutuluyor.
const cache = globalThis as unknown as { rudderDb?: Database };

export const db: Database = cache.rudderDb ?? createDatabase({ source: databasePath() });

if (process.env.NODE_ENV !== "production") cache.rudderDb = db;
