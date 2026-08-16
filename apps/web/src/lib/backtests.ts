import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";

import { backtests } from "@rudder/db";
import type { BacktestRow } from "@rudder/db";
import type { BacktestSummary } from "@rudder/backtest/result";

import { db } from "./db";

/** Satırdaki `result` sütunu şemada tipsiz JSON; tipi burada, tek yerde veriliyor. */
export type StoredBacktest = Omit<BacktestRow, "result"> & { result: BacktestSummary | null };

/**
 * Bu kural seti sürümünün en son tamamlanmış testi.
 *
 * Kural setleri değişmez ve düzenleme yeni bir sürüm yaratır, yani bir
 * backtest her zaman ölçtüğü kurallara bağlı kalır. Yeni sürümün testi yoksa
 * "test edilmedi" demek doğrudur — eski sürümün sonucunu göstermek olmaz.
 */
export function latestMeasurement(rulesetId: string): StoredBacktest | null {
  return (
    (db
      .select()
      .from(backtests)
      .where(and(eq(backtests.rulesetId, rulesetId), eq(backtests.status, "done")))
      .orderBy(desc(backtests.finishedAt))
      .get() as StoredBacktest | undefined) ?? null
  );
}

/** Bekleyen ya da çalışan test. Arayüz aynı kural seti için ikincisini açmaz. */
export function activeRun(rulesetId: string): StoredBacktest | null {
  return (
    (db
      .select()
      .from(backtests)
      .where(
        and(eq(backtests.rulesetId, rulesetId), inArray(backtests.status, ["queued", "running"])),
      )
      .get() as StoredBacktest | undefined) ?? null
  );
}

/** Son çalıştırma — durumu ne olursa olsun. Başarısızlığı gösterebilmek için. */
export function lastRun(rulesetId: string): StoredBacktest | null {
  return (
    (db
      .select()
      .from(backtests)
      .where(eq(backtests.rulesetId, rulesetId))
      .orderBy(desc(backtests.createdAt))
      .get() as StoredBacktest | undefined) ?? null
  );
}

export function getBacktest(id: string): StoredBacktest | null {
  return (
    (db.select().from(backtests).where(eq(backtests.id, id)).get() as StoredBacktest | undefined) ??
    null
  );
}
