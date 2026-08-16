/**
 * Dil dosyalarının statik haritası.
 *
 * `loadLocale()` dosya sisteminden okur ve CLI için uygundur; ama bir bundler
 * (Next.js gibi) çalışma zamanı yolunu çözemez. Bu harita derleme anında
 * çözülür ve tarayıcı tarafına da taşınabilir.
 *
 * Yeni bir dil eklemek: locales/ altına dosyayı koy, buraya bir satır ekle.
 */

import en from "./locales/en.json" with { type: "json" };
import tr from "./locales/tr.json" with { type: "json" };

import type { Locale } from "./describe.ts";

export const LOCALES: Record<string, Locale> = { en, tr };

export const LOCALE_CODES = Object.keys(LOCALES);

export const DEFAULT_LOCALE = "en";

/** Bilinmeyen dil kodunda İngilizce'ye düşer. */
export function localeFor(code: string): Locale {
  return LOCALES[code] ?? LOCALES[DEFAULT_LOCALE]!;
}
