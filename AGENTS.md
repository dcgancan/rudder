# Working on Rudder

Notes for anyone — human or agent — touching this repository for the first
time. Everything here is a pointer; the reasoning lives next to the code it
belongs to, so nothing in this file restates a rule that is written somewhere
else and could drift away from it.

## Read this first

**[`CONTRIBUTING.md`](CONTRIBUTING.md) opens with the one rule that is not
negotiable.** It is about what a ruleset may never be allowed to do. Read it
before writing anything that touches validation, the interpreter, or the
container boundary.

## The shape of the thing

A strategy is **data**, not code: a JSON ruleset interpreted by one generic
Freqtrade strategy class. That single decision explains most of the
architecture — see [`README.md`](README.md) for why, and
[`engine/README.md`](engine/README.md) for how.

Each package owns its own reasoning:

| | |
|---|---|
| [`packages/ruleset`](packages/ruleset/README.md) | Schema, validation, plain-language rendering |
| [`packages/db`](packages/db/README.md) | Why rulesets are immutable versions |
| [`packages/freqtrade`](packages/freqtrade/README.md) | Why config must never override the ruleset |
| [`packages/host`](packages/host/README.md) | Container runtime, `~/.rudder` layout |
| [`packages/orchestrator`](packages/orchestrator/README.md) | Bot rows → running containers |
| [`packages/backtest`](packages/backtest/README.md) | Rulesets → measurements |
| [`apps/web`](apps/web/README.md) | Visual direction and what the numbers are allowed to say |

When a change surprises you, the answer is usually already written in one of
those files. When you learn something the hard way, write it into the one it
belongs to — that is where the next person will look.

## Commands

```sh
pnpm install
pnpm test        # unit tests, no containers
pnpm typecheck
```

Integration tests are opt-in because they start real containers:

```sh
RUDDER_INTEGRATION=1 pnpm --filter @rudder/backtest test
RUDDER_INTEGRATION=1 pnpm --filter @rudder/orchestrator test
```

Running the interface locally, against a scratch database rather than the real
`~/.rudder`:

```sh
export RUDDER_DB="$PWD/.rudder-dev/rudder.db" RUDDER_DATA_DIR="$PWD/.rudder-dev"
pnpm --filter @rudder/web seed
pnpm --filter @rudder/web dev
```

## Two habits this codebase expects

**Comments carry the reason, not the mechanism.** The code already says what it
does. A comment here exists to record why an obvious alternative was rejected —
usually because it was tried and it was wrong.

**Say what you measured.** Claims like "this is faster" or "these are
equivalent" belong in a README only with the number that backs them. Several
decisions in this repo were reversed by exactly that discipline.

## Language

Root documents, package names and user-facing English strings are in English.
Code comments and package READMEs are written in Turkish. The interface itself
is bilingual by construction — adding a language must mean adding a locale file
and changing no code. [`packages/ruleset/README.md`](packages/ruleset/README.md)
covers the rules that keep it that way.
