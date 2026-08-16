import "server-only";

/**
 * Freqtrade'in çıkış sebepleri.
 *
 * Motor, kural setinin satış sinyaline kural setinin id'sini etiket olarak
 * koyuyor (`populate_exit_trend`) ve Freqtrade o etiketi çıkış sebebi diye
 * kaydediyor. Yani sonuçlarda `"bb-bounce"` gibi bir sebep görünüyor.
 * Freqtrade'in kendi sebepleri dışındaki her değer, tanımı gereği bizim satış
 * kuralımızdır.
 *
 * İki tüketicisi var: backtest ölçümünün çıkış dökümü ve bir botun işlem
 * geçmişi. Ham değer kullanıcıya asla gösterilmez.
 */

const TRANSLATED = new Set([
  "roi",
  "stop_loss",
  "trailing_stop_loss",
  "exit_signal",
  "force_exit",
  "liquidation",
]);

const FREQTRADE_OWN = new Set([
  ...TRANSLATED,
  "stoploss_on_exchange",
  "emergency_exit",
  "custom_exit",
  "partial_exit",
]);

/** `measurement.exit.*` altındaki çeviri anahtarını döndürür. */
export function exitReasonKey(reason: string | null): string {
  if (!reason) return "other";
  if (TRANSLATED.has(reason)) return reason;
  return FREQTRADE_OWN.has(reason) ? "other" : "exit_signal";
}
