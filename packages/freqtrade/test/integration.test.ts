/**
 * Gerçek bir Freqtrade container'ına karşı uçtan uca doğrulama.
 *
 * Docker gerektirdiği ve ~30 saniye sürdüğü için varsayılan olarak atlanır:
 *
 *   RUDDER_INTEGRATION=1 pnpm --filter @rudder/freqtrade test
 *
 * Kanıtlamak istediği şey tek cümle: kural seti → config → container → API
 * zinciri çalışıyor ve botun risk ayarları KURAL SETİNDEN geliyor.
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { after, before, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { FreqtradeClient } from "../src/client.ts";
import { buildCommand, buildConfig, buildSecretEnv, generateApiCredentials } from "../src/config.ts";
import type { BotSpec } from "../src/config.ts";

const REPO = resolve(import.meta.dirname, "../../..");
const IMAGE = "freqtradeorg/freqtrade:stable";
const CONTAINER = "rudder-integration-test";
const HOST_PORT = 18_080;

/**
 * Bot dizini OS temp'inde OLAMAZ.
 *
 * macOS'ta `os.tmpdir()` /var/folders altındadır ve Colima ya da Docker
 * Desktop bu yolu sanal makineye paylaşmaz. Docker, olmayan bir kaynağı
 * mount ederken hata vermek yerine sessizce bir DİZİN oluşturur; sonuç
 * container içinde `IsADirectoryError` olur ve sebebi hiç belli olmaz.
 *
 * Aynı kısıt orchestrator için de geçerli: bot çalışma dizinleri kullanıcının
 * ev dizini altında yapılandırılabilir bir kökte tutulmalıdır.
 */
const DATA_ROOT = resolve(REPO, ".rudder-test");

const enabled = process.env["RUDDER_INTEGRATION"] === "1";

const ruleset = JSON.parse(
  readFileSync(resolve(REPO, "rulesets/rsi-dip-buyer.json"), "utf8"),
) as { timeframe: string; risk: { stoploss: number; roi?: Record<string, number> } };

const spec: BotSpec = {
  name: "Integration Bot",
  exchange: "binance",
  mode: "paper",
  stakeCurrency: "USDT",
  stakeAmount: 100,
  maxOpenTrades: 2,
  pairs: ["BTC/USDT", "ETH/USDT"],
  paperWallet: 1000,
};

const api = generateApiCredentials(8080);
const client = new FreqtradeClient({
  baseUrl: `http://127.0.0.1:${HOST_PORT}`,
  username: api.username,
  password: api.password,
  timeoutMs: 15_000,
});

let workdir = "";

const removeContainer = () =>
  spawnSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });

const containerRunning = (): boolean =>
  spawnSync("docker", ["inspect", "-f", "{{.State.Running}}", CONTAINER], { encoding: "utf8" })
    .stdout?.trim() === "true";

const containerLogs = (): string =>
  spawnSync("docker", ["logs", "--tail", "25", CONTAINER], { encoding: "utf8" }).stderr ?? "";

before(async () => {
  if (!enabled) return;

  rmSync(DATA_ROOT, { recursive: true, force: true });
  mkdirSync(DATA_ROOT, { recursive: true });
  workdir = mkdtempSync(join(DATA_ROOT, "bot-"));

  writeFileSync(join(workdir, "config.json"), JSON.stringify(buildConfig(spec, api), null, 2));
  writeFileSync(join(workdir, "ruleset.json"), JSON.stringify(ruleset));

  const env = buildSecretEnv({});
  const envArgs = Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]);

  removeContainer();
  execFileSync("docker", [
    "run", "-d", "--name", CONTAINER,
    // 127.0.0.1'e yayınlanıyor — bot API'si makine dışından erişilebilir olmamalı.
    "-p", `127.0.0.1:${HOST_PORT}:8080`,
    "-v", `${join(workdir, "config.json")}:/freqtrade/user_data/config.json:ro`,
    "-v", `${join(workdir, "ruleset.json")}:/freqtrade/ruleset.json:ro`,
    "-v", `${resolve(REPO, "engine")}:/freqtrade/engine:ro`,
    ...envArgs,
    IMAGE,
    ...buildCommand(),
  ]);

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await client.ping()) return;

    // Çıkmış bir container'ı beklemenin anlamı yok — logunu göstererek hemen
    // başarısız ol. Sessizce 90 saniye beklemek teşhisi imkânsızlaştırıyor.
    if (!containerRunning()) {
      throw new Error(`the bot container exited during startup:\n${containerLogs()}`);
    }
    await sleep(1000);
  }
  throw new Error(`the bot never became reachable:\n${containerLogs()}`);
});

after(() => {
  if (!enabled) return;
  removeContainer();
  rmSync(DATA_ROOT, { recursive: true, force: true });
});

test("the bot comes up and answers", { skip: !enabled }, async () => {
  assert.equal(await client.ping(), true);

  const health = await client.health();
  assert.ok(health.bot_start_ts, "the bot should report a start time");
});

// The whole point of the design: risk settings come from the ruleset, not the
// config. If a ruleset-owned key ever leaked into config generation, these two
// assertions are what would catch it against a real bot.
test("risk settings come from the ruleset", { skip: !enabled }, async () => {
  const state = await client.showConfig();

  assert.equal(state.timeframe, ruleset.timeframe);
  assert.equal(state.stoploss, ruleset.risk.stoploss);
  assert.equal(state.strategy, "UniversalStrategy");
});

test("bot settings come from the config", { skip: !enabled }, async () => {
  const state = await client.showConfig();

  assert.equal(state.dry_run, true, "paper mode must be a dry run");
  assert.equal(state.max_open_trades, spec.maxOpenTrades);
  assert.equal(state.stake_currency, spec.stakeCurrency);
});

test("reads account state", { skip: !enabled }, async () => {
  const [balance, count, profit] = await Promise.all([
    client.balance(),
    client.count(),
    client.profit(),
  ]);

  assert.equal(balance.stake, "USDT");
  assert.equal(count.max, spec.maxOpenTrades);
  assert.ok(typeof profit.trade_count === "number");
});

test("opens and closes a position on demand", { skip: !enabled }, async () => {
  await client.forceEnter("ETH/USDT");
  await sleep(3000);

  const open = await client.status();
  assert.ok(open.length > 0, "forceEnter should have opened a position");

  // Emrin DOLDUĞUNU doğrula, sadece var olduğunu değil. Dolmamış bir limit
  // emir de burada görünür ama gerçek bir pozisyon değildir ve forceExit onu
  // kapatmaz, iptal eder.
  assert.ok((open[0]?.amount ?? 0) > 0, "the entry order should have filled");

  const result = await client.forceExit("all");
  assert.match(result.result, /exit orders/i);

  await sleep(5000);
  assert.equal((await client.status()).length, 0, "the position should be closed");
});

test("can be stopped through the API", { skip: !enabled }, async () => {
  const result = await client.stop();
  assert.match(result.status, /stopping/i);

  const state = await client.showConfig();
  assert.equal(state.state, "stopped");
});
