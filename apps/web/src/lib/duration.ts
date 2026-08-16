import "server-only";

/**
 * Süre biçimlendirme.
 *
 * Freqtrade aynı bilgiyi `"0d 06:26"` gibi hazır İngilizce dizgelerle de
 * veriyor; onları ekrana basmak Türkçe arayüzde İngilizce metin demek olurdu.
 * Her yerde ham saniyeden başlanır ve cümle locale dosyasından gelir.
 *
 * Yuvarlama tek yerde dursun diye burada: iki ekran aynı süreyi farklı
 * yuvarlarsa aynı işlem iki farklı uzunlukta görünür.
 */

export type DurationParts =
  | { key: "duration.hoursMinutes"; values: { hours: number; minutes: number } }
  | { key: "duration.minutes"; values: { minutes: number } };

export function durationParts(seconds: number): DurationParts {
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);

  return hours === 0
    ? { key: "duration.minutes", values: { minutes } }
    : { key: "duration.hoursMinutes", values: { hours, minutes: minutes % 60 } };
}
