/**
 * Gerçek Docker ile container gözlemi.
 *
 *   RUDDER_INTEGRATION=1 pnpm --filter @rudder/host test
 *
 * Burada tek bir şey doğrulanıyor ve bu proje için önemli olmasının sebebi,
 * yanlış olduğu ortaya çıkana kadar herkesin tersini varsayması: **çöküp duran
 * bir container Docker'a göre ÇALIŞIYOR.**
 *
 * Bu davranış Docker'ın kendi sürümüne bağlı. Değişirse bot durum
 * sınıflandırması sessizce yanlışa döner, ve o zaman burası kırmızı yanar.
 */

import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { after, test } from "node:test";

import { inspectContainer, removeContainer, runContainer } from "../src/docker.ts";

const enabled = process.env["RUDDER_INTEGRATION"] === "1";

const NAME = "rudder-host-crashloop-test";

after(async () => {
  if (!enabled) return;
  await removeContainer(NAME);
});

test("a crash-looping container reports itself as running", { skip: !enabled }, async () => {
  await removeContainer(NAME);

  // Botların kullandığı politikanın aynısı. Sürekli çıkan bir komut, Docker'ı
  // yeniden başlatma döngüsüne sokuyor.
  await runContainer({
    name: NAME,
    image: "alpine:3",
    command: ["sh", "-c", "sleep 1; exit 1"],
    restart: "unless-stopped",
  });

  // Sayacın birden fazla kez artmasına yetecek kadar. Docker'ın geri çekilme
  // aralığı büyüdüğü için birkaç saniye gerekiyor.
  await sleep(9000);

  const state = await inspectContainer(NAME);
  assert.ok(state, "the container should exist");

  // Sınıflandırıcının `running` alanına güvenememesinin sebebi tam olarak bu.
  assert.equal(state.running, true, "Docker keeps calling a restarting container running");

  assert.ok(state.restartCount > 0, `expected restarts, got ${state.restartCount}`);

  // İki güvenilir sinyalden biri; diğeri sayacın kendisi. Örnekleme anına göre
  // `running` ya da `restarting` görülebiliyor, o yüzden ikisi de kabul.
  assert.ok(
    ["running", "restarting"].includes(state.status),
    `unexpected status ${state.status}`,
  );

  // İkinci bir örnekleme: sayaç monoton artıyor mu.
  const earlier = state.restartCount;
  await sleep(6000);

  const later = await inspectContainer(NAME);
  assert.ok(
    (later?.restartCount ?? 0) > earlier,
    `the restart count should keep growing: ${earlier} → ${later?.restartCount}`,
  );
});
