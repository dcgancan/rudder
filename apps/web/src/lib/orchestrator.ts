import "server-only";

import { Orchestrator, Watchdog } from "@rudder/orchestrator";

import { db } from "./db";

/**
 * Süreç başına TEK orchestrator.
 *
 * `lib/queue.ts` ile aynı kalıp ve aynı sebep: ikinci bir örnek aynı bota iki
 * kez müdahale eder — iki container başlatır ya da birinin ayırdığı portu
 * diğerine verir. Tek örnek olması bir performans tercihi değil.
 */
const cache = globalThis as unknown as {
  rudderOrchestrator?: Orchestrator;
  rudderReconcile?: Promise<void>;
  rudderWatchdog?: Watchdog;
};

/**
 * Modül yüklenirken DEĞİL, ilk kullanımda kurulur: `next build` bu modülü
 * import ediyor ve kurulum anındaki bir uzlaştırma çağrısı derleme sırasında
 * Docker'a uzanırdı.
 */
export function orchestrator(): Orchestrator {
  const instance = (cache.rudderOrchestrator ??= new Orchestrator({ db }));

  cache.rudderReconcile ??= instance.reconcile().catch((error: unknown) => {
    console.error("bot reconciliation failed:", error);
  });

  /*
   * Uzlaştırma yalnızca AÇILIŞTA çalışıyor, durum tazelemesi ise yalnızca
   * sayfa okunduğunda. İkisinin arasında kalan zamanda bir bot düşerse kimse
   * fark etmiyordu. Gözcü o boşluğu kapatıyor; hiçbir bota müdahale etmiyor.
   *
   * Aynı `??=` kalıbı burada da gerekli: geliştirme modunda modül yeniden
   * yüklendiğinde ikinci bir zamanlayıcı kurulurdu.
   */
  cache.rudderWatchdog ??= startWatchdog(instance);

  return instance;
}

function startWatchdog(instance: Orchestrator): Watchdog {
  const watchdog = new Watchdog({ db, monitor: instance });
  watchdog.start();
  return watchdog;
}
