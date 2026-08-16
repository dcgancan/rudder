/**
 * Sınıflandırma kuralları.
 *
 * Docker'a dokunmuyor: `classify` saf ve gözlemi doğrudan alıyor. Buradaki
 * her senaryo gerçek `docker inspect` çıktısından alınmış — özellikle çöküp
 * duran container'ınki, çünkü uydurulmuş bir gözlem tam da bu hatayı kaçırırdı.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { BotEventKind } from "@rudder/db";
import type { ContainerState } from "@rudder/host";

import { classify, eventsFor } from "../src/health.ts";
import type { BotStatus, Snapshot } from "../src/health.ts";

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

// --------------------------------------------------------------------------
// Olaylar
// --------------------------------------------------------------------------

/**
 * Art arda yoklamaları `refreshStatus`'ün yaptığı gibi işleyip kayda düşen
 * satırları döndürür.
 *
 * İki ayrıntı burada taklit ediliyor, çünkü ikisi de kuralların anlamını
 * belirliyor: satırdaki sayaç yalnızca bot ÇALIŞIYOR iken ilerler, ve karar
 * son KAYDEDİLEN olaya bakar, son yoklamaya değil.
 */
function record(polls: Snapshot[]): BotEventKind[] {
  let stored = polls[0]!;
  let latest: BotEventKind | null = null;
  const written: BotEventKind[] = [];

  for (const poll of polls.slice(1)) {
    for (const kind of eventsFor(stored, poll, latest)) {
      written.push(kind);
      latest = kind;
    }

    stored =
      poll.status === "running" ? poll : { status: poll.status, restartCount: stored.restartCount };
  }

  return written;
}

const at = (status: BotStatus, restartCount = 0): Snapshot => ({ status, restartCount });

test("nothing worth recording happens when nothing changes", () => {
  assert.deepEqual(record([at("running"), at("running"), at("running")]), []);
});

test("a bot that goes down on its own is recorded", () => {
  assert.deepEqual(record([at("running"), at("stopped")]), ["stopped"]);
});

// Niyetin kaydı satırın kendisinde: `stop()` önce `stopping` yazıyor. Kullanıcı
// botu kendi durdurduysa bunu ona olay olarak geri anlatmanın anlamı yok.
test("a bot the user asked to stop is not an event", () => {
  assert.deepEqual(record([at("running"), at("stopping"), at("stopped")]), []);
});

test("a bot that has never been up does not report going down", () => {
  assert.deepEqual(record([at("stopped"), at("stopped")]), []);
});

test("a crash is recorded", () => {
  assert.deepEqual(record([at("running"), at("error", 1)]), ["failed"]);
});

test("a bot Docker brought back on its own is recorded", () => {
  assert.deepEqual(record([at("running", 0), at("running", 1)]), ["restarted"]);
});

// `start()` container'ı yeniden yaratıyor ve Docker'ın sayacı sıfırlanıyor.
// Bu düşüş bir yeniden başlatma değil, yeni bir container.
test("a restart count that falls is a new container, not a restart", () => {
  assert.deepEqual(record([at("running", 9), at("starting", 0), at("running", 0)]), []);
});

// Cevap vermeyen bir bot henüz ne düşmüş ne toparlanmıştır; bir sonraki
// yoklama hangisi olduğunu söyleyecek.
test("a restart that has not come back yet is not called a restart", () => {
  assert.deepEqual(record([at("running", 0), at("starting", 3)]), []);
});

// --------------------------------------------------------------------------
// Ölçülen diziler
// --------------------------------------------------------------------------

/*
 * Bunların hiçbiri uydurulmadı; üçü de gerçek bir koşuda gözlendi ve üçü de
 * bir kural değişikliğine yol açtı.
 */

/*
 * Çöküp duran bir bot. Sayaç saniyede bir büyüyor, durum ilk yoklamada henüz
 * `starting` görünüyor, ve loop'un ortasında bir an yine `starting`e düşüyor —
 * Docker container'ı yeni kaldırmışken örneklendiğinde.
 *
 * Kayda düşmesi gereken tek şey var: bir kez "Çöktü". İlk sürüm bu diziye üç
 * satır yazdı (restarted, restarted, failed), ikincisi iki (failed, failed).
 */
test("a crash loop as it was measured writes one row", () => {
  assert.deepEqual(
    record([
      at("running", 0),
      at("starting", 4),
      at("error", 7),
      at("error", 8),
      at("starting", 8),
      at("error", 9),
    ]),
    ["failed"],
  );
});

/*
 * Aynı botun toparlanması: ruleset düzeltildi, Docker'ın bir sonraki denemesi
 * tuttu. Durum error → starting → running izledi.
 *
 * Yalnızca bir önceki yoklamaya bakan kural buna "kendiliğinden yeniden
 * başladı" dedi, çünkü arada `starting` vardı ve çökme epizodu kaybolmuştu.
 * Kullanıcının okuması gereken cümle "tekrar çalışmaya başladı".
 */
test("a bot that comes back after failing is recorded as a recovery", () => {
  assert.deepEqual(
    record([at("running", 0), at("error", 7), at("starting", 16), at("running", 17)]),
    ["failed", "recovered"],
  );
});

// Çökme, toparlanma, sonra ikinci bir çökme. Bunlar gerçekten iki ayrı olay;
// tekrar bastırma ikincisini yutmamalı.
test("a second failure after a recovery is its own row", () => {
  assert.deepEqual(
    record([at("running", 0), at("error", 1), at("running", 2), at("error", 3)]),
    ["failed", "recovered", "failed"],
  );
});

// Çöküp duran bir bota bakmayı bırakmıyoruz, ama her yoklamada satır da
// yazmıyoruz. Kırk yoklama, bir satır.
test("forty polls of a crash loop still write one row", () => {
  const polls: Snapshot[] = [at("running", 0)];
  for (let count = 1; count <= 40; count++) polls.push(at("error", count));

  assert.deepEqual(record(polls), ["failed"]);
});
