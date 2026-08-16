# Contributing to Rudder

Thanks for considering it. Rudder is early — the engine works, the product
around it does not exist yet — so there is a lot of room.

## The one rule that is not negotiable

**Never add a path that executes, evaluates or imports anything derived from a
ruleset.** No `eval`, no `exec`, no dynamic `import`, no `getattr` on
user-supplied names, no template engine that can reach the runtime.

This is the property the whole project rests on: a shared strategy is data, and
data cannot own your machine. Two independent layers enforce it —
`validateRuleset()` in `packages/ruleset/src/schema.ts` (before a ruleset is
stored) and `_validate()` in `engine/universal_strategy.py` (before it runs).
Both keep explicit whitelists of allowed indicator functions and comparison
operators. Keep them in sync, and keep them closed.

Extending what strategies can express means **extending the whitelist**, never
opening an escape hatch. If a feature seems to require arbitrary code, it needs
a design discussion first — open an issue.

`rulesets/_invalid/` holds rulesets that must be rejected. Add to it whenever
you touch validation — the test suite asserts that every file in there fails,
and the Python layer is checked against the same fixtures.

## Development setup

Node ≥ 22.18 and pnpm. There is no build step; Node runs the TypeScript
directly.

```sh
pnpm install
pnpm test
pnpm typecheck
```

## Contributing a strategy

A strategy is a single JSON file in `rulesets/`. Open a normal pull request
with it.

What makes a strategy likely to be merged:

- **It is understandable.** Somebody should be able to read the generated
  description and know what it does. Ten stacked indicators is not that.
- **It is not overfitted.** If the parameters look hand-tuned to one period on
  one pair, it will not be merged. Round numbers beat suspiciously precise ones.
- **It has a stop loss that means something.** Every ruleset needs one; a −50%
  stop loss is a stop loss in name only.
- **You are honest about it in the PR.** Say what market conditions it is meant
  for and where it fails. A strategy that loses money in a downtrend is fine.
  A strategy presented as though it never loses is not.

Do not include backtest returns in the strategy name or description. If you
want to report results, put them in the PR body with the exact timerange and
pairs so they can be reproduced.

## Contributing a language

Add `packages/ruleset/src/locales/<code>.json`. No code changes should be
needed — if a translation requires touching the renderer, that is a bug in the
abstraction, so please say so in the PR.

Four rules, each of which was an actual bug during development:

- **Word order lives in the locale, not the code.** English is `BUY when {conditions}`;
  Turkish is `{conditions} AL` — the verb goes last. That is why
  `entry_sentence` / `exit_sentence` exist.
- **Capitalization is locale-sensitive.** Turkish `"işlem"` → `"İşlem"` with a
  dotted capital I. Plain `toUpperCase()` produces `"Islem"`, which is wrong.
- **Never format numbers by hand.** Turkish writes `%8`, `%1,5` and `1.000`.
  `Intl.NumberFormat` already knows this; you do not need to.
- **Avoid grammatical agreement with values.** A phrasing must work for every
  number. Turkish `"{right} seviyesinin altına inerse"` generalizes;
  `"30'un altına"` does not.

Check your work in both directions:

```sh
pnpm describe rulesets/bb-bounce.json <code>
```

A missing key throws rather than rendering `{left}` to a user, so an incomplete
locale fails loudly in tests.

## Contributing code

- Match the surrounding style. There is no linter yet; there will be.
- Keep the Python side small. `engine/universal_strategy.py` is deliberately
  the only Python file in the project and should stay that way.
- If you add an indicator function, add it to **both** whitelists (TypeScript
  and Python), the interpreter, **and** every locale file. A missing
  translation is a broken description, not a cosmetic issue.
- `packages/ruleset/ruleset.schema.json` is generated. Run
  `pnpm --filter @rudder/ruleset emit-schema` after changing the schema rather
  than editing it by hand.

## Reporting a security issue

If you find a way to make a ruleset execute code, escape the whitelist, or read
files it should not — please do not open a public issue. Open a
[private security advisory](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on the repository instead.

## Conduct

Be decent. Assume the other person is trying to help. Disagreement about
technical direction is welcome; contempt is not.

## License

By contributing you agree that your contributions are licensed under the
[AGPL-3.0](LICENSE), the same license as the project.
