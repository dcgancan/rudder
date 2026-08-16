import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { StrategyTrace } from "@/components/StrategyTrace";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { listStrategies } from "@/lib/strategies";

/*
  Katalog da statik üretilemez: kartlardaki eğri bir backtest bittiğinde
  değişiyor ve derleme anında dondurulmuş bir sayfa sonsuza kadar
  "test edilmedi" derdi.
*/
export const dynamic = "force-dynamic";

export default async function CatalogPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // Yol parçası doğrulanmadan aşağı geçemez: `Intl` geçersiz bir locale ile
  // fırlatıyor ve /favicon.ico gibi eşleşmeyen istekler buraya kadar geliyor.
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);

  const t = await getTranslations();
  const strategies = listStrategies(locale);

  // Hero bir gösteri: en kısa cümleyi seçiyoruz. Alfabetik sıradaki ilk
  // strateji tesadüfen uzun ve dolambaçlı olabilir, ve ilk izlenim
  // "okunabilir" iddiasının kendisi.
  const lead = strategies.reduce<(typeof strategies)[number] | undefined>(
    (shortest, candidate) =>
      !shortest || candidate.entry.length < shortest.entry.length ? candidate : shortest,
    undefined,
  );

  return (
    <>
      <SiteHeader />

      <main id="content" className="mx-auto max-w-4xl px-6">
        {/*
          Hero, bu ürünün tek buluşunu gösteriyor: okunabilir bir strateji.
          Başlık + alt başlık + buton kalıbı yerine, gerçek bir stratejinin
          üretilmiş cümlesi. İçerik de gerçek — veritabanından geliyor.
        */}
        <section className="border-rule border-b pt-12 pb-12 sm:pt-16 sm:pb-14">
          <p className="label">{t("home.eyebrow")}</p>

          {lead ? (
            <>
              <p className="text-ink-soft mt-6 max-w-xl text-balance">{t("home.leadIn")}</p>
              <p className="text-hero mt-5 max-w-4xl text-balance leading-[1.22] font-normal hyphens-none">
                {lead.entry}
              </p>
              <p className="text-ink-soft mt-6 max-w-xl text-balance">{t("home.leadOut")}</p>
            </>
          ) : (
            <p className="text-hero mt-6 max-w-2xl leading-[1.22]">{t("home.leadIn")}</p>
          )}
        </section>

        <section className="pt-10 pb-12" aria-labelledby="all-strategies">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="all-strategies" className="label">
              {t("home.listHeading")}
            </h2>
            <span className="flex items-baseline gap-5">
              <span className="label sounding">{t("home.count", { count: strategies.length })}</span>
              <Link href="/strategies/new" className="label text-depth no-underline">
                {t("editor.create")}
              </Link>
            </span>
          </div>

          <ul className="mt-6 list-none p-0">
            {strategies.map((strategy) => (
              <li key={strategy.slug} className="border-rule border-t">
                <Link
                  href={`/strategies/${strategy.slug}`}
                  className="group text-ink flex flex-col gap-6 py-7 no-underline sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display group-hover:text-depth text-title font-semibold tracking-tight transition-colors">
                      {strategy.name}
                    </h3>
                    <p className="text-ink-soft mt-2 max-w-xl text-pretty">{strategy.entry}</p>
                    <p className="label sounding mt-3">{strategy.timeframe}</p>
                  </div>

                  <StrategyTrace strategy={strategy} />
                </Link>
              </li>
            ))}
          </ul>
          <div className="border-rule border-t" />
        </section>

        <Disclaimer />
      </main>

      <SiteFooter />
    </>
  );
}

/*
  Uyarılar dipnot değil, sayfanın parçası. Ölçtüğümüz %82.4 kazanma /
  −%11.57 getiri örneği burada somut olarak duruyor: soyut bir "risklidir"
  cümlesinden çok daha öğretici.
*/
async function Disclaimer() {
  const t = await getTranslations("disclaimer");

  return (
    <section className="border-shoal my-4 border-l-2 py-2 pl-5">
      <h2 className="label">{t("heading")}</h2>
      <div className="text-ink-soft mt-4 max-w-2xl space-y-3 text-[0.95rem]">
        <p>{t("winRate")}</p>
        <p>{t("backtest")}</p>
        <p>{t("risk")}</p>
      </div>
    </section>
  );
}
