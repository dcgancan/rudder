import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertNoRulesetOverrides,
  buildCommand,
  buildConfig,
  buildSecretEnv,
  generateApiCredentials,
  RULESET_OWNED_KEYS,
} from "../src/config.ts";
import type { BotSpec } from "../src/config.ts";

const api = generateApiCredentials(8080);

const paperBot: BotSpec = {
  name: "Test Bot",
  exchange: "binance",
  mode: "paper",
  stakeCurrency: "USDT",
  stakeAmount: 100,
  maxOpenTrades: 3,
  pairs: ["BTC/USDT", "ETH/USDT"],
  paperWallet: 1000,
};

// --------------------------------------------------------------------------
// Config kural setini ezemez
// --------------------------------------------------------------------------

// Freqtrade lets config values override strategy attributes. If any of these
// leaked into the generated config, every bot would silently ignore its
// ruleset's risk settings — and nothing would report an error.
test("the generated config contains no ruleset-owned key", () => {
  const config = buildConfig(paperBot, api);

  for (const key of RULESET_OWNED_KEYS) {
    assert.ok(!(key in config), `config must not set "${key}" — it belongs to the ruleset`);
  }
});

test("assertNoRulesetOverrides catches a leaked key", () => {
  assert.throws(
    () => assertNoRulesetOverrides({ stake_currency: "USDT", stoploss: -0.1 }),
    /would override the ruleset: stoploss/,
  );
});

// --------------------------------------------------------------------------
// Sırlar dosyaya yazılmaz
// --------------------------------------------------------------------------

test("exchange credentials never appear in the config", () => {
  const config = buildConfig({ ...paperBot, mode: "live" }, api);
  const exchange = config["exchange"] as Record<string, unknown>;

  assert.ok(!("key" in exchange), "exchange.key must not be in the config file");
  assert.ok(!("secret" in exchange), "exchange.secret must not be in the config file");

  // Belt and braces: the serialized config must not contain the secret at all.
  const serialized = JSON.stringify(buildConfig({ ...paperBot, mode: "live" }, api));
  assert.ok(!serialized.includes("SECRET_KEY_VALUE"));
});

test("credentials are passed as environment variables instead", () => {
  const env = buildSecretEnv({
    exchangeKey: "my-key",
    exchangeSecret: "my-secret",
  });

  assert.equal(env["FREQTRADE__EXCHANGE__KEY"], "my-key");
  assert.equal(env["FREQTRADE__EXCHANGE__SECRET"], "my-secret");
  assert.equal(env["FT_RULESET"], "/freqtrade/ruleset.json");
});

test("paper mode passes no exchange credentials", () => {
  const env = buildSecretEnv({});

  assert.ok(!("FREQTRADE__EXCHANGE__KEY" in env));
  assert.ok(!("FREQTRADE__EXCHANGE__SECRET" in env));
});

// --------------------------------------------------------------------------
// Mod ayrımı
// --------------------------------------------------------------------------

test("paper mode enables dry run and sets a wallet", () => {
  const config = buildConfig(paperBot, api);

  assert.equal(config["dry_run"], true);
  assert.equal(config["dry_run_wallet"], 1000);
});

test("live mode disables dry run and sets no wallet", () => {
  const config = buildConfig({ ...paperBot, mode: "live" }, api);

  assert.equal(config["dry_run"], false);
  assert.ok(!("dry_run_wallet" in config), "a paper wallet is meaningless in live mode");
});

test("paper mode falls back to a default wallet", () => {
  const config = buildConfig({ ...paperBot, paperWallet: null }, api);
  assert.equal(config["dry_run_wallet"], 1000);
});

// --------------------------------------------------------------------------
// Bot ayarları geçiyor
// --------------------------------------------------------------------------

test("bot settings reach the config", () => {
  const config = buildConfig(paperBot, api);
  const exchange = config["exchange"] as Record<string, unknown>;

  assert.equal(config["max_open_trades"], 3);
  assert.equal(config["stake_currency"], "USDT");
  assert.equal(config["stake_amount"], 100);
  assert.equal(exchange["name"], "binance");
  assert.deepEqual(exchange["pair_whitelist"], ["BTC/USDT", "ETH/USDT"]);
  assert.equal(config["bot_name"], "Test Bot");
});

test("the API server is configured with the generated credentials", () => {
  const config = buildConfig(paperBot, api);
  const server = config["api_server"] as Record<string, unknown>;

  assert.equal(server["enabled"], true);
  assert.equal(server["listen_port"], 8080);
  assert.equal(server["username"], api.username);
  assert.equal(server["jwt_secret_key"], api.jwtSecret);
  // Listening on 0.0.0.0 inside the container is required for port publishing;
  // keeping it off the network is the orchestrator's job (publish to 127.0.0.1).
  assert.equal(server["listen_ip_address"], "0.0.0.0");
});

test("every bot gets distinct credentials", () => {
  const a = generateApiCredentials(8080);
  const b = generateApiCredentials(8080);

  assert.notEqual(a.password, b.password);
  assert.notEqual(a.jwtSecret, b.jwtSecret);
  assert.notEqual(a.wsToken, b.wsToken);
  assert.ok(a.jwtSecret.length >= 32);
});

// --------------------------------------------------------------------------
// Geçersiz girdi
// --------------------------------------------------------------------------

test("rejects a bot with no pairs", () => {
  assert.throws(() => buildConfig({ ...paperBot, pairs: [] }, api), /at least one pair/);
});

test("rejects a non-positive stake amount", () => {
  assert.throws(() => buildConfig({ ...paperBot, stakeAmount: 0 }, api), /stakeAmount/);
});

test("the command points at the universal strategy", () => {
  const command = buildCommand();

  assert.ok(command.includes("UniversalStrategy"));
  assert.ok(command.includes("/freqtrade/engine"));
  assert.equal(command[0], "trade");
});
