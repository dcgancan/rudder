/**
 * Bot API portlarının tahsisi.
 *
 * Portlar yalnızca 127.0.0.1'e yayınlanır, yani makine dışından erişilemez;
 * yine de her botun kendi portu olmalı.
 *
 * Not: boş olduğunu doğrulamakla Docker'ın bağlamasının arasında küçük bir
 * yarış aralığı var. Bir makinede birkaç düzine bot ölçeğinde kabul edilebilir;
 * çakışma olursa container başlatma hatası verir ve tekrar denenir.
 */

import { createServer } from "node:net";

export const DEFAULT_PORT_RANGE: readonly [number, number] = [17_000, 17_999];

export class NoPortAvailableError extends Error {
  constructor(range: readonly [number, number]) {
    super(`no free port in range ${range[0]}-${range[1]}`);
    this.name = "NoPortAvailableError";
  }
}

export function isPortFree(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

/**
 * `taken` içindeki portları atlar (veritabanında başka botlara atanmış olanlar),
 * kalanlardan gerçekten boş olan ilkini döndürür.
 */
export async function allocatePort(
  taken: Iterable<number> = [],
  range: readonly [number, number] = DEFAULT_PORT_RANGE,
): Promise<number> {
  const reserved = new Set(taken);

  for (let port = range[0]; port <= range[1]; port++) {
    if (reserved.has(port)) continue;
    if (await isPortFree(port)) return port;
  }

  throw new NoPortAvailableError(range);
}
