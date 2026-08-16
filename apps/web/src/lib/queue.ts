import "server-only";

import { BacktestQueue } from "@rudder/backtest";

import { db } from "./db";

/**
 * Süreç başına TEK kuyruk.
 *
 * `db.ts`'teki önbellekten farkı, burada üretimde de global tutulması: ikinci
 * bir kuyruk nesnesi aynı satırı iki kez çalıştırır ve aynı anda iki container
 * başlatır. Tek örnek olması bir performans tercihi değil, doğruluk şartı.
 */
const cache = globalThis as unknown as {
  rudderBacktestQueue?: BacktestQueue;
  rudderBacktestRecovery?: Promise<void>;
};

/**
 * Kuyruk ilk kullanımda kurulur.
 *
 * Modül yüklenirken DEĞİL: `next build` sırasında bu modül import edilir ve
 * kurulum anında yapılan bir kurtarma çağrısı derleme sırasında Docker'a
 * uzanırdı.
 */
export function backtestQueue(): BacktestQueue {
  const queue = (cache.rudderBacktestQueue ??= new BacktestQueue({ db }));

  // Önceki sürecin yarım bıraktıkları. Idempotent, bir kez yeter.
  cache.rudderBacktestRecovery ??= queue.recover().catch((error: unknown) => {
    console.error("backtest recovery failed:", error);
  });

  return queue;
}
