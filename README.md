# Rudder

**English** · [Türkçe](README.tr.md)

**Readable trading strategies for people who don't write Python.**

Rudder is an open-source crypto trading bot built on top of
[Freqtrade](https://github.com/freqtrade/freqtrade). Strategies are structured
data, not code — so you can read one in plain language, share it as a single
file, and edit it in a form instead of a code editor.

> ### ⚠️ Early development
>
> The ruleset engine works and has been tested against real market data.
> **There is no web interface yet.** See [Status](#status) before you get excited.

---

## Why

Existing open-source bots are excellent and completely inaccessible to most
people. Freqtrade is the best of them — and a Freqtrade strategy is a Python
class using pandas. That rules out almost everyone who wants to automate a
simple, well-understood rule.

It also makes strategy sharing dangerous. If strategies are code, then copying
someone else's strategy means executing a stranger's Python on your machine,
in a process that holds your exchange API keys.

Rudder represents strategies as **structured data** instead:

```json
{
  "timeframe": "1h",
  "indicators": [
    { "id": "rsi14",  "fn": "rsi", "params": { "period": 14 } },
    { "id": "ema200", "fn": "ema", "params": { "period": 200 } }
  ],
  "entry": {
    "all": [
      { "cmp": { "op": "lt", "left": "rsi14",  "right": 30 } },
      { "cmp": { "op": "gt", "left": "close",  "right": "ema200" } }
    ]
  },
  "exit": { "any": [ { "cmp": { "op": "gt", "left": "rsi14", "right": 70 } } ] },
  "risk": { "stoploss": -0.08, "roi": { "0": 0.04, "120": 0.02 } }
}
```

A single generic Freqtrade strategy class interprets this. Nothing from the
ruleset is ever executed as code — it is walked by an interpreter that only
calls whitelisted functions.

That one decision buys four things at once:

| | |
|---|---|
| **Safety** | A shared strategy cannot run arbitrary code |
| **Readability** | The description is generated from the structure, so it can never drift from the logic |
| **Translation** | A new language is a locale file, not a re-translation of prose |
| **Editing** | "Tweak and run" is a form, not an editor |

## Generated descriptions

The same ruleset, rendered:

**English**
> **RSI Dip Buyer** — evaluated on the 1h chart.
> BUY when RSI(14) falls below 30 and price rises above the 200-period EMA.
> SELL when RSI(14) rises above 70.
> Stop loss at 8% · Take profit: 4% immediately, 2% after 2 hours

**Türkçe**
> **RSI Dip Alıcı** — 1h grafiği üzerinde değerlendirilir.
> RSI(14) 30 seviyesinin altına inerse ve fiyat 200 periyotluk EMA seviyesinin üzerine çıkarsa AL.
> RSI(14) 70 seviyesinin üzerine çıkarsa SAT.
> Zarar kes: %8 · Kâr al: hemen %4, 2 saat sonra %2

No human wrote either sentence.

## Status

| Component | State |
|---|---|
| Ruleset schema | ✅ Works |
| Generic strategy interpreter | ✅ Works, backtested on real data |
| Validation / security boundary | ✅ Works, tested against malicious rulesets |
| Description renderer (EN + TR) | ✅ Works |
| Web interface | ❌ Not started |
| Bot lifecycle management | ❌ Not started |
| Strategy sharing | ❌ Not started |

Today Rudder is a working engine with no product around it. If you want a bot
you can actually use right now, use [Freqtrade](https://github.com/freqtrade/freqtrade)
or [OctoBot](https://github.com/Drakkar-Software/OctoBot).

## Trying the engine

Requires Docker. No exchange API key needed — everything below is offline or
uses public market data.

```sh
# Download some historical data
docker run --rm -v "$(pwd)/ft_lab/user_data:/freqtrade/user_data" \
  freqtradeorg/freqtrade:stable \
  download-data --config /freqtrade/user_data/config.json \
  --timerange 20260201- --timeframes 5m 1h

# Backtest a ruleset
docker run --rm \
  -v "$(pwd)/ft_lab/user_data:/freqtrade/user_data" \
  -v "$(pwd)/engine:/freqtrade/engine:ro" \
  -v "$(pwd)/rulesets:/freqtrade/rulesets:ro" \
  -e FT_RULESET=/freqtrade/rulesets/rsi-dip-buyer.json \
  freqtradeorg/freqtrade:stable \
  backtesting --config /freqtrade/user_data/config.json \
  --strategy UniversalStrategy --strategy-path /freqtrade/engine \
  --timerange 20260201- --cache none
```

Render a ruleset in either language (requires Node 22.18+ and pnpm):

```sh
pnpm install
pnpm describe rulesets/bb-bounce.json tr
pnpm test
```

## Repository layout

| Path | What |
|---|---|
| `rulesets/` | Curated strategies, plus `_invalid/` fixtures that must be rejected |
| `packages/ruleset/` | Schema, validation and description rendering (TypeScript) |
| `packages/db/` | SQLite schema and client |
| `packages/freqtrade/` | Config generation and typed REST client |
| `engine/` | The Freqtrade interpreter — the only Python in the project |
| `ft_lab/` | Throwaway Freqtrade exploration environment |

Docs: [`packages/ruleset/README.md`](packages/ruleset/README.md) ·
[`packages/db/README.md`](packages/db/README.md) ·
[`packages/freqtrade/README.md`](packages/freqtrade/README.md) ·
[`engine/README.md`](engine/README.md) ·
[`ft_lab/README.md`](ft_lab/README.md)

## Safety

Trading carries real risk of loss. Rudder is provided without warranty of any
kind. Paper trading is the default and you should stay there until you
understand exactly what a strategy does.

**On judging a strategy.** A worked example from this repository's own testing:
a sample strategy backtested at an **82.4% win rate** and still **lost 11.57%**.
Small wins were taken at 1–4%; losses ran to 10%. Win rate is the metric most
likely to mislead you, and it is the one most trading products lead with.
Rudder deliberately surfaces profit factor, expectancy and maximum drawdown
instead.

Past performance of a backtest tells you how a rule would have done on data it
was chosen against. It is not a prediction.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Strategy contributions are welcome and
are reviewed as ordinary pull requests — a ruleset is a small JSON file.

## License

[GNU Affero General Public License v3.0](LICENSE).

Rudder derives from Freqtrade (GPL-3.0); AGPL-3.0 is compatible with that and
additionally requires that anyone running a modified version as a network
service publishes their changes.

Copyright (C) 2026 Doğancan Öztürk
