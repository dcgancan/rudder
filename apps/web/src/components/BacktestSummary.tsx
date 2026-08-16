import { getFormatter, getTranslations } from "next-intl/server";

import { durationParts } from "@/lib/duration";
import { displayable, PERCENT } from "@/lib/numbers";
import type { Measurement } from "@/lib/strategies";

/**
 * Ölçülmüş sayılar.
 *
 * Sıralama kasıtlı ve şemadaki gerekçeyle aynı: önce kâr faktörü, beklenen
 * değer ve en sert düşüş; kazanma oranı en sonda ve vurgusuz. Bu projenin
 * kendi testinde bir strateji işlemlerinin %82'sini kazanıp %11,57 kaybetti —
 * kazanma oranını başa koymak, insanı tam olarak o yanılgıya götürüyor.
 *
 * KÂR İÇİN RENK YOK. Kazanç nötr mürekkep renginde; yalnızca kayıp ve risk
 * `--color-alert` ile işaretlenir.
 */
export async function BacktestSummary({ measurement }: { measurement: Measurement }) {
  const t = await getTranslations();
  const format = await getFormatter();

  const percent = (value: number) => format.number(displayable(value), PERCENT);

  const day = (ms: number) => format.dateTime(new Date(ms), { dateStyle: "medium" });

  // Sıfır işlemlik bir ölçümde gösterilecek sayı yok; o hali sayfa söylüyor.
  if (measurement.trades === 0) return null;

  return (
    <section className="border-rule border-b py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="label">{t("measurement.heading")}</h2>
        <p className="label sounding">
          {t("measurement.range", {
            from: day(measurement.from),
            to: day(measurement.to),
          })}
          {" · "}
          {t("measurement.scope", {
            days: measurement.days,
            pairs: measurement.pairs.length,
          })}
        </p>
      </div>

      <dl className="mt-6 grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
        <Figure
          label={t("measurement.profit")}
          value={percent(measurement.profitRatio)}
          alert={measurement.profitRatio < 0}
          note={`${t("measurement.marketChange")}: ${percent(measurement.marketChange)}`}
        />

        <Figure
          label={t("measurement.maxDrawdown")}
          // Düşüş her zaman işaretli: bu sayı bir sonuç değil, taşınması
          // gereken risk.
          value={percent(-measurement.maxDrawdown)}
          alert
          note={
            measurement.drawdownSeconds
              ? t("measurement.drawdownDuration", {
                  days: Math.max(1, Math.round(measurement.drawdownSeconds / 86_400)),
                })
              : t("measurement.maxDrawdownHelp")
          }
        />

        <Figure
          label={t("measurement.profitFactor")}
          value={
            measurement.profitFactor === null
              ? t("measurement.undefined")
              : format.number(measurement.profitFactor, { maximumFractionDigits: 2 })
          }
          alert={measurement.profitFactor !== null && measurement.profitFactor < 1}
          note={t("measurement.profitFactorHelp")}
        />

        <Figure
          label={t("measurement.expectancy")}
          value={`${format.number(measurement.expectancy, { maximumFractionDigits: 2 })} ${measurement.currency}`}
          alert={measurement.expectancy < 0}
          note={t("measurement.consecutiveLosses", { count: measurement.maxConsecutiveLosses })}
        />

        <Figure
          label={t("measurement.trades")}
          value={format.number(measurement.trades)}
          note={`${t("measurement.holding")}: ${duration(measurement.holdingSeconds)}`}
        />

        <Figure
          label={t("measurement.winRate")}
          value={percent(measurement.winRate)}
          note={t("measurement.winRateHelp")}
          quiet
        />
      </dl>

      <div className="mt-8 grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
        <Breakdown
          heading={t("measurement.exitsHeading")}
          rows={measurement.exits.map((exit) => ({
            key: exit.reason,
            // Sebep zaten çeviri anahtarı; ham Freqtrade değerleri
            // `strategies.ts`'te eşlendi ve buraya asla ulaşmıyor.
            label: t(`measurement.exit.${exit.reason}`),
            value: t("measurement.exitTrades", { count: exit.trades }),
          }))}
        />

        <Breakdown
          heading={t("measurement.perPairHeading")}
          rows={measurement.perPair.map((pair) => ({
            key: pair.pair,
            label: pair.pair,
            value: percent(pair.profitRatio),
            alert: pair.profitRatio < 0,
          }))}
        />
      </div>
    </section>
  );

  /**
   * Süreler Freqtrade'in hazır dizgelerinden DEĞİL, ham saniyelerden kurulur.
   *
   * API `"0d 06:26"` gibi İngilizce biçimlenmiş değerler de döndürüyor ve
   * onları basmak Türkçe arayüzde İngilizce metin demek olurdu.
   */
  function duration(seconds: number): string {
    const parts = durationParts(seconds);
    return t(parts.key, parts.values);
  }
}

function Figure({
  label,
  value,
  note,
  alert = false,
  quiet = false,
}: {
  label: string;
  value: string;
  note?: string;
  alert?: boolean;
  quiet?: boolean;
}) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd
        className={`sounding m-0 mt-1 ${quiet ? "text-ink-soft text-xl" : "text-2xl"} ${
          alert ? "text-alert" : ""
        }`}
      >
        {value}
      </dd>
      {note ? <p className="text-ink-soft mt-1 max-w-sm text-[0.9rem]">{note}</p> : null}
    </div>
  );
}

function Breakdown({
  heading,
  rows,
}: {
  heading: string;
  rows: { key: string; label: string; value: string; alert?: boolean }[];
}) {
  if (rows.length === 0) return null;

  return (
    <div>
      <h3 className="label">{heading}</h3>
      <ul className="mt-3 list-none p-0">
        {rows.map((row) => (
          <li
            key={row.key}
            className="border-rule flex items-baseline justify-between gap-4 border-t py-1.5"
          >
            <span className="text-[0.95rem]">{row.label}</span>
            <span className={`sounding text-[0.95rem] ${row.alert ? "text-alert" : "text-ink-soft"}`}>
              {row.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
