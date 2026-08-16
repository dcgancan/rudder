/**
 * Dil dosyasını diskten okur.
 *
 * `describe.ts`'ten AYRI durmasının sebebi: orası tarayıcıda da import
 * ediliyor (editörün canlı önizlemesi) ve `node:fs` içeren bir modül oraya
 * taşınamaz. Bundle'lanmış ortamlar için `locales.ts`'teki statik harita var;
 * bu dosya yalnızca CLI içindir.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Locale } from "./describe.ts";

const LOCALE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "locales");

export async function loadLocale(code: string): Promise<Locale> {
  if (!/^[a-z]{2}$/.test(code)) throw new Error(`invalid locale code: ${code}`);
  return JSON.parse(await readFile(resolve(LOCALE_DIR, `${code}.json`), "utf8")) as Locale;
}
