/**
 * Sunucu açılışında bir kez çalışır.
 *
 * Hem backtest kuyruğunu hem bot orchestrator'ını burada kuruyoruz, çünkü
 * ikisinin de toparlama adımı bir kullanıcı isteğine bağlı olamaz:
 *
 *  - Önceki süreç bir test çalışırken öldüyse o satır sonsuza kadar
 *    "çalışıyor" görünür, ve bekleyen işler kimse yeni bir test başlatana
 *    kadar hiç başlamaz. Ölçüldü — sırada bekleyen iki test 25 saniye boyunca
 *    kıpırdamadı.
 *  - Bot durumları yalnızca sorulduğunda güncelleniyor; makine yeniden
 *    başlamışsa `running` yazan bir botun container'ı çoktan gitmiş olabilir
 *    ve bu, kullanıcıya gösterilen bir yalan olur.
 */
export async function register(): Promise<void> {
  // Edge çalışma zamanında ne SQLite ne de Docker var.
  if (process.env["NEXT_RUNTIME"] !== "nodejs") return;

  const [{ backtestQueue }, { orchestrator }] = await Promise.all([
    import("@/lib/queue"),
    import("@/lib/orchestrator"),
  ]);

  backtestQueue();
  orchestrator();
}
