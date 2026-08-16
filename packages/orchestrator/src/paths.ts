/**
 * Disk yerleşimi.
 *
 * Bot dizinleri OS temp'inde OLAMAZ: macOS'ta `os.tmpdir()` /var/folders
 * altındadır ve Colima ya da Docker Desktop bu yolu sanal makineye paylaşmaz.
 * Docker paylaşılmayan bir yolu mount ederken hata vermez — sessizce bir dizin
 * oluşturur — ve container içinde anlaşılmaz bir `IsADirectoryError` çıkar.
 *
 * Bu yüzden varsayılan kök kullanıcının ev dizini altındadır ve
 * `RUDDER_DATA_DIR` ile değiştirilebilir.
 */

import { homedir } from "node:os";
import { resolve, join } from "node:path";

export type BotPaths = {
  /** Botun kök dizini. 0700. */
  root: string;
  /** Container'a rw mount edilir; Freqtrade veritabanını ve loglarını buraya yazar. */
  userData: string;
  /** API parolasını içerir. 0600. */
  config: string;
  /** Kural seti; ro mount edilir. */
  ruleset: string;
};

export function dataRoot(): string {
  const configured = process.env["RUDDER_DATA_DIR"];
  return configured ? resolve(configured) : join(homedir(), ".rudder");
}

export function botPaths(botId: string, root = dataRoot()): BotPaths {
  const botRoot = join(root, "bots", botId);
  const userData = join(botRoot, "user_data");
  return {
    root: botRoot,
    userData,
    config: join(userData, "config.json"),
    ruleset: join(botRoot, "ruleset.json"),
  };
}

/** Container adı bot id'sinden türetilir; yeniden başlatmadan sonra bulunabilsin diye. */
export function containerName(botId: string): string {
  return `rudder-bot-${botId}`;
}
