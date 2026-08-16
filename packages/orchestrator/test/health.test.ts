/**
 * Sınıflandırma kuralları.
 *
 * Docker'a dokunmuyor: `classify` saf ve gözlemi doğrudan alıyor. Buradaki
 * her senaryo gerçek `docker inspect` çıktısından alınmış — özellikle çöküp
 * duran container'ınki, çünkü uydurulmuş bir gözlem tam da bu hatayı kaçırırdı.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { ContainerState } from "@rudder/host";

import { classify } from "../src/health.ts";

const state = (over: Partial<ContainerState>): ContainerState => ({
  id: "abc123",
  running: false,
  status: "exited",
  exitCode: 0,
  restartCount: 0,
  startedAt: "2026-08-16T10:00:00Z",
  finishedAt: "2026-08-16T10:05:00Z",
  ...over,
});

test("no container means the bot is stopped", () => {
  assert.equal(classify({ state: null, reachable: false }), "stopped");
});

test("a container that answers is running", () => {
  assert.equal(
    classify({ state: state({ running: true, status: "running" }), reachable: true }),
    "running",
  );
});

test("a container that is up but silent is still starting", () => {
  assert.equal(
    classify({ state: state({ running: true, status: "running" }), reachable: false }),
    "starting",
  );
});

// --------------------------------------------------------------------------
// Çöküp duran container
// --------------------------------------------------------------------------

/*
 * ÖLÇÜLDÜ. `--restart unless-stopped` ile saniyede bir çöken bir container her
 * örneklemede `running=true` diyor. Yalnızca `running`'e bakan eski kural bunu
 * "açılıyor" sayıyordu ve bot orada sonsuza kadar kalıyordu — arayüzde çöken
 * bot "Açılıyor" yazıyor, "Hata" yazmıyordu.
 *
 * Ayırt eden alan `status`; `restarting` sağlıklı bir açılışta hiç görülmüyor.
 */
test("a crash-looping container is an error, not a slow start", () => {
  const observed = state({ running: true, status: "restarting", exitCode: 1, restartCount: 6 });

  assert.equal(classify({ state: observed, reachable: false }), "error");
});

// Aynı döngü, Docker container'ı yeni ayağa kaldırmışken örneklenirse `exitCode`
// 0 dönüyor. Çıkış koduna güvenen bir kural bu örneklemede yanılırdı.
test("the restarting status decides even when the exit code looks clean", () => {
  const observed = state({ running: true, status: "restarting", exitCode: 0, restartCount: 3 });

  assert.equal(classify({ state: observed, reachable: false }), "error");
});

// --------------------------------------------------------------------------
// Sonlandırma çökme değildir
// --------------------------------------------------------------------------

// `docker stop` sonrası Freqtrade 130 ile çıkıyor. Bunu çökme saymak,
// kullanıcının kendi durdurduğu botu "hata" göstermek demekti.
test("a container killed by a signal has stopped, not failed", () => {
  for (const exitCode of [130, 137, 143]) {
    assert.equal(classify({ state: state({ exitCode }), reachable: false }), "stopped");
  }
});

test("a container that exited cleanly has stopped", () => {
  assert.equal(classify({ state: state({ exitCode: 0 }), reachable: false }), "stopped");
});

// Python hatası 1, hatalı argüman 2 — bunlar hâlâ hata.
test("a container that exited with a real failure is an error", () => {
  for (const exitCode of [1, 2, 127]) {
    assert.equal(classify({ state: state({ exitCode }), reachable: false }), "error");
  }
});
