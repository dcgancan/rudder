/**
 * Bot dizinlerinin yerleşimi.
 *
 * Kök ve "neden OS temp olamaz" gerekçesi `@rudder/host`'ta.
 */

import { join } from "node:path";

import { dataRoot } from "@rudder/host";

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
