import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { BACKTEST_PERIODS } from "@rudder/backtest";
import { STANDARD_SETUP } from "@rudder/freqtrade";

import { BacktestPanel } from "@/components/BacktestPanel";
import { BacktestSummary } from "@/components/BacktestSummary";
import { RunPanel } from "@/components/RunPanel";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { StrategyTrace } from "@/components/StrategyTrace";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { archiveStrategy } from "@/app/[locale]/strategies/actions";
import { countBotsFor } from "@/lib/bots";
import { getStrategy } from "@/lib/strategies";

/*
  Bu sayfa statik üretilemez: bir backtest bittiğinde sonucu göstermesi
  gerekiyor ve derleme anında dondurulmuş bir sayfa sonsuza kadar
  "test edilmedi" derdi.
*/
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale, slug } = await params;
  const strategy = getStrategy(slug, locale);

  return strategy ? { title: strategy.name, description: strategy.entry } : {};
}

export default async function StrategyPage({ params }: Props) {
  const { locale, slug } = await params;
  // Yol parçası doğrulanmadan aşağı geçemez: `Intl` geçersiz bir locale ile
  // fırlatıyor ve eşleşmeyen istekler buraya kadar geliyor.
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);

  const strategy = getStrategy(slug, locale);
  if (!strategy) notFound();

  const t = await getTranslations();
  const measured = strategy.measurement;

  return (
    <>
      <SiteHeader />

      <main id="content" className="mx-auto max-w-3xl px-6 pb-20">
        <nav className="pt-8">
          <Link href="/" className="label text-ink-soft hover:text-depth no-underline">
            ← {t("strategy.backToList")}
          </Link>
        </nav>

        <header className="border-rule border-b pb-8">
          <h1 className="font-display mt-6 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            {strategy.name}
          </h1>
          <p className="label sounding mt-4">
            {t("strategy.timeframe")} · {strategy.timeframe} · v{strategy.version}
          </p>

          <p className="mt-4">
            <Link href={`/strategies/${strategy.slug}/edit`} className="label text-depth no-underline">
              {strategy.source === "builtin" ? t("editor.fork") : t("editor.edit")}
            </Link>
          </p>
        </header>

        {/*
          Kuralların tamamı okunabilir cümleler halinde. Hiçbiri elle yazılmadı;
          hepsi kural setinin yapısından üretildi, bu yüzden mantıktan sapamaz.
        */}
        <Rule heading={t("strategy.buyRule")} body={strategy.entry} />
        <Rule heading={t("strategy.sellRule")} body={strategy.exit} />

        <section className="border-rule border-b py-8">
          <h2 className="label">{t("strategy.riskHeading")}</h2>
          <ul className="mt-4 list-none space-y-2 p-0">
            {strategy.risk.map((line) => (
              <li key={line} className="text-lg">
                {line}
              </li>
            ))}
          </ul>
        </section>

        <section className="border-rule border-b py-8">
          <h2 className="label">{t("strategy.indicators")}</h2>
          {/* Ayraç bir noktalı çizgi: boşluk tek başına öğeleri ayırmıyor. */}
          <ul className="text-ink-soft mt-4 flex list-none flex-wrap items-center gap-x-3 gap-y-2 p-0">
            {strategy.watches.map((watch, index) => (
              <li key={watch} className="flex items-center gap-x-3">
                {index > 0 ? (
                  <span aria-hidden className="text-rule select-none">
                    ·
                  </span>
                ) : null}
                {watch}
              </li>
            ))}
          </ul>
        </section>

        <section className="border-rule flex flex-col gap-6 border-b py-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-sm">
            <h2 className="label">{t("drawdown.label")}</h2>
            <p className="text-ink-soft mt-3 text-[0.95rem]">{traceHelp()}</p>
          </div>
          <StrategyTrace strategy={strategy} />
        </section>

        {measured ? <BacktestSummary measurement={measured} /> : null}

        <BacktestPanel
          slug={strategy.slug}
          periods={BACKTEST_PERIODS}
          fixture={{
            pairs: STANDARD_SETUP.pairs.length,
            exchange: STANDARD_SETUP.exchange,
            wallet: STANDARD_SETUP.wallet,
            currency: STANDARD_SETUP.stakeCurrency,
          }}
          run={strategy.run}
          measured={measured !== null}
        />

        {/* Önce ölç, sonra çalıştır — sayfanın sırası da bunu söylüyor. */}
        <RunPanel
          slug={strategy.slug}
          defaultName={strategy.name}
          setup={{
            pairs: STANDARD_SETUP.pairs.length,
            exchange: STANDARD_SETUP.exchange,
            wallet: STANDARD_SETUP.wallet,
            currency: STANDARD_SETUP.stakeCurrency,
          }}
          measured={measured !== null}
          existingBots={countBotsFor(strategy.rulesetId)}
        />

        {/*
          Repoyla gelen stratejiler arşivlenmez; onların sahibi repo.
          Geri alınamaz olmasa da iki adımlı: katalogdan bir şeyi kaldırmak
          tek tıklamayla olmamalı.
        */}
        {strategy.source === "builtin" ? null : (
          <section className="py-8">
            <details>
              <summary className="label text-ink-soft hover:text-alert cursor-pointer">
                {t("editor.archive")}
              </summary>
              <p className="text-ink-soft mt-2 max-w-lg text-[0.9rem]">{t("editor.archiveHelp")}</p>
              <form action={archiveStrategy} className="mt-3">
                <input type="hidden" name="slug" value={strategy.slug} />
                <button
                  type="submit"
                  className="label border-alert text-alert hover:bg-alert hover:text-ground cursor-pointer border bg-transparent px-4 py-2 transition-colors"
                >
                  {t("editor.archiveConfirm")}
                </button>
              </form>
            </details>
          </section>
        )}
      </main>

      <SiteFooter />
    </>
  );

  function traceHelp(): string {
    if (strategy === null) return "";
    if (strategy.drawdown === null) return t("drawdown.untestedHelp");
    if (strategy.drawdown.length <= 1) return t("backtest.noTradesHelp");
    return t("measurement.maxDrawdownHelp");
  }
}

function Rule({ heading, body }: { heading: string; body: string }) {
  return (
    <section className="border-rule border-b py-8">
      <h2 className="label">{heading}</h2>
      <p className="mt-4 text-xl leading-relaxed text-pretty sm:text-2xl">{body}</p>
    </section>
  );
}
