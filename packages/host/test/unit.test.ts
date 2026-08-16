import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { parseInspect, volumeArg } from "../src/docker.ts";
import { dataRoot, engineDir } from "../src/paths.ts";

// --------------------------------------------------------------------------
// Veri kökü
// --------------------------------------------------------------------------

test("the data root is configurable", () => {
  const previous = process.env["RUDDER_DATA_DIR"];
  process.env["RUDDER_DATA_DIR"] = "/tmp/custom-root";
  try {
    assert.equal(dataRoot(), "/tmp/custom-root");
  } finally {
    if (previous === undefined) delete process.env["RUDDER_DATA_DIR"];
    else process.env["RUDDER_DATA_DIR"] = previous;
  }
});

test("the data root defaults under the home directory", () => {
  const previous = process.env["RUDDER_DATA_DIR"];
  delete process.env["RUDDER_DATA_DIR"];
  try {
    // OS temp'te olmamalı — container çalışma zamanı o yolu paylaşmıyor.
    assert.ok(!dataRoot().startsWith(tmpdir()));
    assert.ok(dataRoot().endsWith(".rudder"));
  } finally {
    if (previous !== undefined) process.env["RUDDER_DATA_DIR"] = previous;
  }
});

// --------------------------------------------------------------------------
// Motor dizini
// --------------------------------------------------------------------------

test("the engine directory is found and actually holds the engine", () => {
  const previous = process.env["RUDDER_ENGINE_DIR"];
  delete process.env["RUDDER_ENGINE_DIR"];
  try {
    assert.ok(existsSync(join(engineDir(), "universal_strategy.py")));
  } finally {
    if (previous !== undefined) process.env["RUDDER_ENGINE_DIR"] = previous;
  }
});

// Next uygulaması bir bundle'dan çalışıyor ve orada `import.meta.dirname`
// tanımsız; arama çalışma dizininden yukarı doğru devam etmeli.
test("the engine directory is found from a working directory alone", () => {
  const previousEnv = process.env["RUDDER_ENGINE_DIR"];
  const previousCwd = process.cwd();

  delete process.env["RUDDER_ENGINE_DIR"];
  process.chdir(join(import.meta.dirname, "../../../apps/web"));
  try {
    assert.ok(existsSync(join(engineDir(), "universal_strategy.py")));
  } finally {
    process.chdir(previousCwd);
    if (previousEnv !== undefined) process.env["RUDDER_ENGINE_DIR"] = previousEnv;
  }
});

test("an explicit engine directory wins", () => {
  const previous = process.env["RUDDER_ENGINE_DIR"];
  process.env["RUDDER_ENGINE_DIR"] = "/somewhere/else";
  try {
    assert.equal(engineDir(), "/somewhere/else");
  } finally {
    if (previous === undefined) delete process.env["RUDDER_ENGINE_DIR"];
    else process.env["RUDDER_ENGINE_DIR"] = previous;
  }
});

// --------------------------------------------------------------------------
// Mount argümanları
// --------------------------------------------------------------------------

test("read-only mounts carry the :ro suffix", () => {
  assert.equal(volumeArg({ host: "/a", container: "/b" }), "/a:/b");
  assert.equal(volumeArg({ host: "/a", container: "/b", readonly: true }), "/a:/b:ro");
});

// --------------------------------------------------------------------------
// Inspect çıktısının ayrıştırılması
// --------------------------------------------------------------------------

// Alan sırası format dizesiyle burada elle eşleşiyor. Kayan bir alan hata
// vermez, sessizce yanlış değeri okur — bu yüzden gerçek çıktıyla test ediliyor.
test("an inspect line is read field by field", () => {
  const state = parseInspect(
    "abc123\ttrue\trunning\t0\t0\t2026-08-16T10:00:00Z\t0001-01-01T00:00:00Z\n",
  );

  assert.equal(state.id, "abc123");
  assert.equal(state.running, true);
  assert.equal(state.status, "running");
  assert.equal(state.exitCode, 0);
  assert.equal(state.restartCount, 0);
  assert.equal(state.startedAt, "2026-08-16T10:00:00Z");
});

/*
 * Ölçüldü: `--restart unless-stopped` ile saniyede bir çöken bir container
 * `running=true` diyor ve `exitCode` örnekleme anına göre 0 ya da 1 dönüyor.
 * Ayırt eden iki alan `status` ve `restartCount`; ikisi de okunuyor olmalı.
 */
test("a crash-looping container is still reported as running", () => {
  const state = parseInspect(
    "abc123\ttrue\trestarting\t1\t6\t2026-08-16T10:00:10Z\t2026-08-16T10:00:09Z",
  );

  assert.equal(state.running, true, "Docker calls a restarting container running");
  assert.equal(state.status, "restarting");
  assert.equal(state.restartCount, 6);
});

test("a missing restart count reads as zero, not as a restart", () => {
  assert.equal(parseInspect("abc\ttrue\trunning\t0").restartCount, 0);
});
