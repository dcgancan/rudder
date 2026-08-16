"use client";

import { useActionState, useEffect, useState } from "react";

import { useFormatter, useLocale, useTranslations } from "next-intl";

import {
  capitalize,
  DEFAULT_PARAMS,
  describe,
  localeFor,
  OHLCV_COLUMNS,
  operandLabel,
  OUTPUTS_OF,
  PARAMS_OF,
  toRuleset,
  TIMEFRAMES,
  validateRuleset,
  COMPARISON_OPS,
  INDICATOR_FNS,
} from "@rudder/ruleset";
import type {
  ComparisonOp,
  Draft,
  DraftComparison,
  DraftOperand,
  DraftRule,
  IndicatorFn,
  IndicatorOutput,
  IndicatorParams,
  OhlcvColumn,
  Timeframe,
} from "@rudder/ruleset";

import { saveStrategy } from "@/app/[locale]/strategies/actions";
import { Link } from "@/i18n/navigation";

/**
 * Strateji formu.
 *
 * Kural setinin kendisi bir form için fazla serbest; taslak modeli iç içe
 * koşulları ve indikatör id'lerini kaldırıyor (bkz. `packages/ruleset/compose.ts`).
 * Buradaki iş yalnızca o modeli ekrana çizmek.
 *
 * ÖNİZLEME KATALOGLA AYNI KODDAN GELİYOR: `toRuleset` + `describe`, kataloğun
 * çağırdığı iki fonksiyonun aynısı. Açıklamanın kuraldan sapabileceği ikinci
 * bir yol yok — projenin tek iddiası bu ve burada yapısal olarak garanti
 * ediliyor.
 */

type Props = {
  initial: Draft;
  /** Kaynak stratejinin slug'ı; sıfırdan yazılan bir stratejide boş. */
  slug: string;
  /**
   * Kaydetmenin yeni bir strateji mi yaratacağı — YALNIZCA metin için.
   * Asıl karar sunucuda, kaynağın `source` alanına bakılarak veriliyor.
   */
  forking: boolean;
};

export function StrategyEditor({ initial, slug, forking }: Props) {
  const t = useTranslations("editor");
  const locale = useLocale();
  const format = useFormatter();

  const [draft, setDraft] = useState<Draft>(initial);
  const [state, action, pending] = useActionState(saveStrategy, null);

  // Hidrasyon tamamlanmadan kaydetmek, kullanıcının yazdığını değil BAŞLANGIÇ
  // taslağını kaydederdi: gizli alandaki JSON'ı React güncelliyor.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const L = localeFor(locale);
  const ruleset = toRuleset(draft, slug || "onizleme", locale);
  const validation = validateRuleset(ruleset);
  const preview = safeDescribe();

  const patch = (change: Partial<Draft>) => setDraft((current) => ({ ...current, ...change }));

  return (
    <form action={action}>
      <input type="hidden" name="draft" value={JSON.stringify(draft)} />
      {/*
        Kaynağın slug'ı HER ZAMAN gönderilir — çatallarken bile. Yeni sürüm mü
        yeni strateji mi olacağına sunucu, kaynağın `source` alanına bakarak
        karar veriyor. Buradan boş göndermek `forkedFromId`'yi düşürüyordu:
        aynı kararı iki yerde vermenin bedeli.
      */}
      <input type="hidden" name="slug" value={slug} />

      <Field label={t("name")}>
        <input
          name="display-name"
          value={draft.name}
          onChange={(event) => patch({ name: event.target.value })}
          placeholder={t("namePlaceholder")}
          maxLength={120}
          className="border-rule bg-surface text-ink w-full max-w-md border px-3 py-2"
        />
      </Field>

      <Field label={t("timeframe")}>
        <Select
          value={draft.timeframe}
          onChange={(value) => patch({ timeframe: value as Timeframe })}
          options={TIMEFRAMES.map((tf) => ({ value: tf, label: tf }))}
        />
      </Field>

      <RuleSection
        heading={t("entryHeading")}
        rule={draft.entry}
        onChange={(entry) => patch({ entry })}
        L={L}
        locale={locale}
      />

      <section className="border-rule border-b py-8">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="label">{t("exitHeading")}</h2>
          {draft.exit ? (
            <button type="button" className="label text-ink-soft hover:text-alert" onClick={() => patch({ exit: null })}>
              {t("removeExit")}
            </button>
          ) : null}
        </div>

        {draft.exit ? (
          <RuleBody rule={draft.exit} onChange={(exit) => patch({ exit })} L={L} locale={locale} />
        ) : (
          <div className="mt-4">
            <p className="text-ink-soft text-[0.95rem]">{t("noExit")}</p>
            <button
              type="button"
              className="label text-depth mt-3"
              onClick={() => patch({ exit: { mode: "any", comparisons: [defaultComparison()] } })}
            >
              {t("addExit")}
            </button>
          </div>
        )}
      </section>

      <RiskSection draft={draft} onChange={patch} />

      {/* Önizleme: katalogda görünecek cümlelerin ta kendisi. */}
      <section className="border-rule border-b py-8">
        <h2 className="label">{t("previewHeading")}</h2>
        <p className="text-ink-soft mt-2 max-w-xl text-[0.9rem]">{t("previewHelp")}</p>

        {preview ? (
          <div className="border-shoal mt-4 border-l-2 py-1 pl-5">
            <p className="text-xl leading-relaxed text-pretty">{preview.entry.sentence}</p>
            <p className="mt-2 text-xl leading-relaxed text-pretty">{preview.exit.sentence}</p>
            <ul className="text-ink-soft mt-3 list-none space-y-1 p-0 text-[0.95rem]">
              {preview.risk.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {/* Kaydetmeyi engelleyen ne varsa açıkça yazılı; pasif bir düğme
          sebebini söylemezse kullanıcı neyi düzelteceğini bilemez. */}
      {!draft.name.trim() ? (
        <p className="text-ink-soft mt-6 text-[0.95rem]">{t("nameRequired")}</p>
      ) : !validation.ok ? (
        <div className="mt-6">
          <p className="text-alert text-[0.95rem]">{t("invalid")}</p>
          <ul className="text-ink-soft mt-2 list-none p-0 font-mono text-xs">
            {validation.errors.map((error) => (
              <li key={`${error.path}-${error.message}`}>
                {error.path}: {error.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {state?.errors ? (
        <ul className="text-alert mt-4 list-none p-0 font-mono text-xs">
          {state.errors.map((error) => (
            <li key={`${error.path}-${error.message}`}>
              {error.path}: {error.message}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-8 flex items-center gap-6">
        <button
          type="submit"
          disabled={!ready || pending || !validation.ok}
          className="label border-ink text-ink hover:bg-ink hover:text-ground cursor-pointer border bg-transparent px-4 py-2 transition-colors disabled:cursor-default disabled:opacity-40"
        >
          {/* "Kopya" ancak kopyalanan bir şey varsa: sıfırdan yazılan bir
              stratejide yalnızca "kaydet". */}
          {slug && forking ? t("saveFork") : t("save")}
        </button>

        <Link href={slug ? `/strategies/${slug}` : "/"} className="label text-ink-soft hover:text-depth no-underline">
          {t("cancel")}
        </Link>
      </div>
    </form>
  );

  /**
   * Önizleme geçersiz bir taslakta da çizilmeli — kullanıcı yazarken kural
   * seti çoğu zaman yarım. Yalnızca `describe` bir dil anahtarını bulamazsa
   * (yani bizim hatamızda) sessizce çekiliyor.
   */
  function safeDescribe() {
    try {
      return describe(ruleset, L, locale);
    } catch {
      return null;
    }
  }

  function defaultComparison(): DraftComparison {
    return {
      op: "gt",
      left: { kind: "indicator", fn: "rsi", params: { ...DEFAULT_PARAMS.rsi } },
      right: { kind: "number", value: 70 },
    };
  }

  function RiskSection({ draft, onChange }: { draft: Draft; onChange: (change: Partial<Draft>) => void }) {
    const risk = draft.risk;
    const setRisk = (change: Partial<Draft["risk"]>) => onChange({ risk: { ...risk, ...change } });

    return (
      <section className="border-rule border-b py-8">
        <h2 className="label">{t("riskHeading")}</h2>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-[0.95rem]">{t("stoploss")}</span>
          <Percent value={risk.stoploss} onChange={(stoploss) => setRisk({ stoploss })} />
        </div>

        <div className="mt-6">
          <span className="text-[0.95rem]">{t("roiHeading")}</span>
          <ul className="mt-2 list-none space-y-2 p-0">
            {risk.roi.map((step, index) => (
              <li key={index} className="flex flex-wrap items-center gap-3">
                <Percent
                  value={step.ratio}
                  onChange={(ratio) =>
                    setRisk({ roi: risk.roi.map((s, i) => (i === index ? { ...s, ratio } : s)) })
                  }
                />
                {step.minutes === 0 ? (
                  <span className="text-ink-soft text-[0.95rem]">{t("roiImmediate")}</span>
                ) : (
                  <>
                    <input
                      type="number"
                      min={1}
                      value={step.minutes}
                      onChange={(event) =>
                        setRisk({
                          roi: risk.roi.map((s, i) =>
                            i === index ? { ...s, minutes: Number(event.target.value) } : s,
                          ),
                        })
                      }
                      className="border-rule bg-surface sounding w-20 border px-2 py-1"
                    />
                    <span className="text-ink-soft text-[0.95rem]">{t("roiAfter")}</span>
                    <button
                      type="button"
                      aria-label={t("removeRoi")}
                      className="label text-ink-soft hover:text-alert"
                      onClick={() => setRisk({ roi: risk.roi.filter((_, i) => i !== index) })}
                    >
                      ✕
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="label text-depth mt-2"
            onClick={() =>
              setRisk({
                roi: [...risk.roi, { minutes: (risk.roi.at(-1)?.minutes ?? 0) + 120, ratio: 0.02 }],
              })
            }
          >
            {t("addRoi")}
          </button>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <span className="text-[0.95rem]">{t("trailing")}</span>
          <Select
            value={risk.trailing.enabled ? "on" : "off"}
            onChange={(value) => setRisk({ trailing: { ...risk.trailing, enabled: value === "on" } })}
            options={[
              { value: "off", label: t("trailingOff") },
              { value: "on", label: t("trailingOn") },
            ]}
          />
          {risk.trailing.enabled ? (
            <>
              <span className="text-ink-soft text-[0.95rem]">{t("trailingPositive")}</span>
              <Percent
                value={risk.trailing.positive}
                onChange={(positive) => setRisk({ trailing: { ...risk.trailing, positive } })}
              />
              <span className="text-ink-soft text-[0.95rem]">{t("trailingOffset")}</span>
              <Percent
                value={risk.trailing.offset}
                onChange={(offset) => setRisk({ trailing: { ...risk.trailing, offset } })}
              />
            </>
          ) : null}
        </div>
      </section>
    );
  }

  function RuleSection({
    heading,
    rule,
    onChange,
    L,
    locale,
  }: {
    heading: string;
    rule: DraftRule;
    onChange: (rule: DraftRule) => void;
    L: ReturnType<typeof localeFor>;
    locale: string;
  }) {
    return (
      <section className="border-rule border-b py-8">
        <h2 className="label">{heading}</h2>
        <RuleBody rule={rule} onChange={onChange} L={L} locale={locale} />
      </section>
    );
  }

  function RuleBody({
    rule,
    onChange,
    L,
    locale,
  }: {
    rule: DraftRule;
    onChange: (rule: DraftRule) => void;
    L: ReturnType<typeof localeFor>;
    locale: string;
  }) {
    const setComparison = (index: number, comparison: DraftComparison) =>
      onChange({ ...rule, comparisons: rule.comparisons.map((c, i) => (i === index ? comparison : c)) });

    return (
      <div className="mt-4">
        <Select
          value={rule.mode}
          onChange={(mode) => onChange({ ...rule, mode: mode as "all" | "any" })}
          options={[
            { value: "all", label: t("modeAll") },
            { value: "any", label: t("modeAny") },
          ]}
        />

        <ul className="mt-4 list-none space-y-3 p-0">
          {rule.comparisons.map((comparison, index) => (
            <li key={index} className="border-rule flex flex-wrap items-center gap-2 border-l-2 py-1 pl-3">
              <OperandPicker
                operand={comparison.left}
                allowNumber={false}
                onChange={(left) =>
                  setComparison(index, { ...comparison, left: left as DraftComparison["left"] })
                }
                L={L}
                locale={locale}
              />

              <Select
                value={comparison.op}
                onChange={(op) => setComparison(index, { ...comparison, op: op as ComparisonOp })}
                options={COMPARISON_OPS.map((op) => ({
                  value: op,
                  label: L.picker_ops[op] ?? op,
                }))}
              />

              <OperandPicker
                operand={comparison.right}
                allowNumber
                onChange={(right) => setComparison(index, { ...comparison, right })}
                L={L}
                locale={locale}
              />

              {rule.comparisons.length > 1 ? (
                <button
                  type="button"
                  aria-label={t("removeCondition")}
                  className="label text-ink-soft hover:text-alert"
                  onClick={() =>
                    onChange({ ...rule, comparisons: rule.comparisons.filter((_, i) => i !== index) })
                  }
                >
                  ✕
                </button>
              ) : null}
            </li>
          ))}
        </ul>

        {/* Şema en fazla 8 koşula izin veriyor. */}
        {rule.comparisons.length < 8 ? (
          <button
            type="button"
            className="label text-depth mt-3"
            onClick={() => onChange({ ...rule, comparisons: [...rule.comparisons, defaultComparison()] })}
          >
            {t("addCondition")}
          </button>
        ) : null}
      </div>
    );
  }

  function OperandPicker({
    operand,
    allowNumber,
    onChange,
    L,
    locale,
  }: {
    operand: DraftOperand;
    allowNumber: boolean;
    onChange: (operand: DraftOperand) => void;
    L: ReturnType<typeof localeFor>;
    locale: string;
  }) {
    const value =
      operand.kind === "number"
        ? "num"
        : operand.kind === "column"
          ? `col:${operand.column}`
          : `ind:${operand.fn}${operand.output ? `:${operand.output}` : ""}`;

    const choose = (next: string) => {
      if (next === "num") return onChange({ kind: "number", value: 0 });
      if (next.startsWith("col:")) {
        return onChange({ kind: "column", column: next.slice(4) as OhlcvColumn });
      }
      const [, fn, output] = next.split(":");
      onChange({
        kind: "indicator",
        fn: fn as IndicatorFn,
        params: { ...DEFAULT_PARAMS[fn as IndicatorFn] },
        ...(output ? { output: output as IndicatorOutput } : {}),
      });
    };

    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <select
          value={value}
          onChange={(event) => choose(event.target.value)}
          className="border-rule bg-surface text-ink max-w-[11rem] border px-2 py-1 text-[0.95rem]"
        >
          <optgroup label={t("operandColumn")}>
            {OHLCV_COLUMNS.map((column) => (
              <option key={column} value={`col:${column}`}>
                {capitalize(locale, L.columns[column] ?? column)}
              </option>
            ))}
          </optgroup>

          <optgroup label={t("operandIndicator")}>
            {INDICATOR_FNS.flatMap((fn) => {
              const outputs = OUTPUTS_OF[fn];
              const label = (output?: IndicatorOutput) =>
                operandLabel(
                  { kind: "indicator", fn, params: DEFAULT_PARAMS[fn], ...(output ? { output } : {}) },
                  L,
                  locale,
                );

              return outputs
                ? outputs.map((output) => (
                    <option key={`${fn}:${output}`} value={`ind:${fn}:${output}`}>
                      {capitalize(locale, label(output))}
                    </option>
                  ))
                : [
                    <option key={fn} value={`ind:${fn}`}>
                      {capitalize(locale, label())}
                    </option>,
                  ];
            })}
          </optgroup>

          {allowNumber ? (
            <optgroup label={t("operandNumber")}>
              <option value="num">{t("operandNumber")}</option>
            </optgroup>
          ) : null}
        </select>

        {operand.kind === "number" ? (
          <input
            type="number"
            step="any"
            value={operand.value}
            onChange={(event) => onChange({ kind: "number", value: Number(event.target.value) })}
            className="border-rule bg-surface sounding w-24 border px-2 py-1"
          />
        ) : null}

        {operand.kind === "indicator"
          ? PARAMS_OF[operand.fn].map((key) => (
              <label key={key} className="text-ink-soft flex items-center gap-1 text-[0.8rem]">
                {t(key)}
                <input
                  type="number"
                  step={key === "stds" ? "0.1" : "1"}
                  min={1}
                  value={operand.params[key] ?? ""}
                  onChange={(event) =>
                    onChange({
                      ...operand,
                      params: { ...operand.params, [key]: Number(event.target.value) } as IndicatorParams,
                    })
                  }
                  className="border-rule bg-surface sounding text-ink w-16 border px-1.5 py-1"
                />
              </label>
            ))
          : null}
      </span>
    );
  }

  /** Yüzde girdisi. Model oran tutuyor (0.08), kullanıcı yüzde görüyor (%8). */
  function Percent({ value, onChange }: { value: number; onChange: (value: number) => void }) {
    return (
      <span className="flex items-center gap-1">
        <input
          type="number"
          step="0.1"
          min={0}
          value={Number((value * 100).toFixed(2))}
          onChange={(event) => onChange(Number(event.target.value) / 100)}
          className="border-rule bg-surface sounding w-20 border px-2 py-1"
        />
        <span className="text-ink-soft sounding">{format.number(0, { style: "percent" }).replace(/[\d\s]/g, "")}</span>
      </span>
    );
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-rule border-b py-6">
      <label className="label block">{label}</label>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="border-rule bg-surface text-ink border px-2 py-1 text-[0.95rem]"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
