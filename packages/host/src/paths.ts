/**
 * Rudder'ın diskteki kökü.
 *
 * Container'a mount edilen hiçbir şey OS temp'inde OLAMAZ: macOS'ta
 * `os.tmpdir()` /var/folders altındadır ve Colima ya da Docker Desktop bu yolu
 * sanal makineye paylaşmaz. Docker paylaşılmayan bir yolu mount ederken hata
 * vermez — sessizce bir dizin oluşturur — ve container içinde anlaşılmaz bir
 * `IsADirectoryError` çıkar.
 *
 * Bu yüzden varsayılan kök kullanıcının ev dizini altındadır ve
 * `RUDDER_DATA_DIR` ile değiştirilebilir.
 *
 * ```
 * <dataRoot>/
 *   rudder.db          veritabanı (RUDDER_DB ile ayrıca değiştirilebilir)
 *   bots/<botId>/      @rudder/orchestrator
 *   backtests/<id>/    @rudder/backtest
 *   market-data/       @rudder/backtest — mum verisi, testler arasında paylaşılır
 * ```
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export function dataRoot(): string {
  const configured = process.env["RUDDER_DATA_DIR"];
  return configured ? resolve(configured) : join(homedir(), ".rudder");
}

/**
 * Host üzerinde `universal_strategy.py`'nin bulunduğu dizin.
 *
 * Üç yol sırayla denenir, güvenilirlik sırasına göre:
 *
 *  1. `RUDDER_ENGINE_DIR` — açıkça söylenmişse tartışma yok.
 *  2. Bu modülün kendi konumu. Node dosyaları doğrudan çalıştırdığında kesin
 *     sonuç verir.
 *  3. Çalışma dizininden yukarı doğru arama. Next uygulaması bir bundle'dan
 *     çalışıyor ve orada `import.meta.dirname` TANIMSIZ; bu adım olmadan
 *     arayüzden başlatılan her backtest "motor dizini bulunamadı" diye
 *     düşüyor.
 *
 * Modül yüklenirken değil, ihtiyaç duyulduğunda hesaplanır.
 */
export function engineDir(): string {
  const configured = process.env["RUDDER_ENGINE_DIR"];
  if (configured) return resolve(configured);

  if (import.meta.dirname) {
    const relative = resolve(import.meta.dirname, "../../../engine");
    if (holdsEngine(relative)) return relative;
  }

  const found = searchUpwards(process.cwd());
  if (found) return found;

  throw new Error(
    `cannot locate the engine directory from ${process.cwd()} — set RUDDER_ENGINE_DIR`,
  );
}

function searchUpwards(start: string): string | null {
  let directory = resolve(start);

  for (;;) {
    const candidate = join(directory, "engine");
    if (holdsEngine(candidate)) return candidate;

    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

/** Adı "engine" olan her dizin motor dizini değil; aranan dosya orada mı? */
function holdsEngine(directory: string): boolean {
  return existsSync(join(directory, "universal_strategy.py"));
}
