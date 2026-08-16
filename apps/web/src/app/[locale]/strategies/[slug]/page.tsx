import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { UnderwaterTrace } from "@/components/UnderwaterTrace";
import { Link } from "@/i18n/navigation";
import { getStrategy } from "@/lib/strategies";

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale, slug } = await params;
  const strategy = getStrategy(slug, locale);

  return strategy ? { title: strategy.name, description: strategy.entry } : {};
}

export default async function StrategyPage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const strategy = getStrategy(slug, locale);
  if (!strategy) notFound();

  const t = await getTranslations();

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
            {t("strategy.timeframe")} · {strategy.timeframe}
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

        <section className="flex flex-col gap-6 py-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-sm">
            <h2 className="label">{t("drawdown.label")}</h2>
            <p className="text-ink-soft mt-3 text-[0.95rem]">{t("drawdown.untestedHelp")}</p>
          </div>
          <UnderwaterTrace
            points={strategy.drawdown}
            label={t("drawdown.label")}
            untestedLabel={t("drawdown.untested")}
          />
        </section>
      </main>

      <SiteFooter />
    </>
  );
}

function Rule({ heading, body }: { heading: string; body: string }) {
  return (
    <section className="border-rule border-b py-8">
      <h2 className="label">{heading}</h2>
      <p className="mt-4 text-xl leading-relaxed text-pretty sm:text-2xl">{body}</p>
    </section>
  );
}
