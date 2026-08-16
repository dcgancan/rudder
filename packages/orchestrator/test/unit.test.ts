import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { buildConfig, generateApiCredentials } from "@rudder/freqtrade";

import { botPaths, containerName } from "../src/paths.ts";
import { allocatePort, isPortFree, NoPortAvailableError } from "../src/ports.ts";
import { readApiCredentials } from "../src/orchestrator.ts";

// Bu testler container çalıştırmaz; OS temp'i kullanmakta sakınca yok.
const scratch = mkdtempSync(join(tmpdir(), "rudder-unit-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

// --------------------------------------------------------------------------
// Yerleşim
// --------------------------------------------------------------------------

test("bot paths are laid out under the data root", () => {
  const paths = botPaths("abc", "/data");

  assert.equal(paths.root, "/data/bots/abc");
  assert.equal(paths.userData, "/data/bots/abc/user_data");
  // config.json user_data içinde: Freqtrade o dizine veritabanını ve loglarını
  // da yazıyor, tek mount yeterli olsun.
  assert.equal(paths.config, "/data/bots/abc/user_data/config.json");
  assert.equal(paths.ruleset, "/data/bots/abc/ruleset.json");
});

test("the data root is configurable", () => {
  const previous = process.env["RUDDER_DATA_DIR"];
  process.env["RUDDER_DATA_DIR"] = "/tmp/custom-root";
  try {
    assert.equal(botPaths("abc").root, "/tmp/custom-root/bots/abc");
  } finally {
    if (previous === undefined) delete process.env["RUDDER_DATA_DIR"];
    else process.env["RUDDER_DATA_DIR"] = previous;
  }
});

test("container names are derived from the bot id", () => {
  assert.equal(containerName("abc-123"), "rudder-bot-abc-123");
});

// --------------------------------------------------------------------------
// Kimlik bilgileri gidiş-dönüşü
// --------------------------------------------------------------------------

// buildConfig snake_case yazar, readApiCredentials camelCase okur. Bu iki
// tarafın anahtar adları elle eşleştiriliyor, yani yanlış yazılan bir alan
// sessizce undefined döner. Gidiş-dönüş testi tam olarak onu yakalar.
test("credentials written into a config can be read back", async () => {
  const api = generateApiCredentials(8080);
  const config = buildConfig(
    {
      name: "Round Trip",
      exchange: "binance",
      mode: "paper",
      stakeCurrency: "USDT",
      stakeAmount: 100,
      maxOpenTrades: 2,
      pairs: ["BTC/USDT"],
      paperWallet: 1000,
    },
    api,
  );

  const path = join(scratch, "config.json");
  writeFileSync(path, JSON.stringify(config, null, 2));

  const read = await readApiCredentials(path);

  assert.equal(read.username, api.username);
  assert.equal(read.password, api.password);
  assert.equal(read.jwtSecret, api.jwtSecret);
  assert.equal(read.wsToken, api.wsToken);
  assert.equal(read.port, api.port);
});

test("a config without credentials is rejected", async () => {
  const path = join(scratch, "bare.json");
  writeFileSync(path, JSON.stringify({ api_server: { listen_port: 8080 } }));

  await assert.rejects(() => readApiCredentials(path), /no API credentials/);
});

// --------------------------------------------------------------------------
// Port tahsisi
// --------------------------------------------------------------------------

test("allocatePort skips ports already assigned", async () => {
  const port = await allocatePort([17_000, 17_001], [17_000, 17_010]);
  assert.ok(port >= 17_002, `expected a port past the reserved ones, got ${port}`);
});

test("allocatePort throws when the range is exhausted", async () => {
  await assert.rejects(
    () => allocatePort([17_000, 17_001], [17_000, 17_001]),
    NoPortAvailableError,
  );
});

test("a port held by a live listener is not offered", async () => {
  const { createServer } = await import("node:net");
  const server = createServer();
  await new Promise<void>((done) => server.listen(17_050, "127.0.0.1", done));

  try {
    assert.equal(await isPortFree(17_050), false);
    const port = await allocatePort([], [17_050, 17_060]);
    assert.notEqual(port, 17_050);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
});
