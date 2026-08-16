import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { AutoRefresh } from "@/components/AutoRefresh";
import { BotStatusLabel } from "@/components/BotStatusLabel";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { listBots } from "@/lib/bots";
import { displayable, PERCENT } from "@/lib/numbers";

/* Durum ve pozisyonlar sürekli değişiyor; dondurulmuş bir liste yalan söyler. */
export const dynamic = "force-dynamic";

/** Liste her satır için container'a bakıyor; detay sayfasından seyrek sorulur. */
const REFRESH_MS = 10_000;

export default async function BotsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations();
  const format = await getFormatter();
  const bots = await listBots(locale);

  const busy = bots.some((bot) => bot.status === "running" || bot.status === "starting");

  return (
    <>
      <SiteHeader />
      <AutoRefresh everyMs={REFRESH_MS} active={busy} />

      <main id="content" className="mx-auto max-w-4xl px-6 pb-20">
        <header className="border-rule border-b pt-12 pb-8">
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            {t("bots.heading")}
          </h1>
        </header>

        {bots.length === 0 ? (
          <section className="py-12">
            <p className="text-xl">{t("bots.empty")}</p>
            <p className="text-ink-soft mt-3 max-w-xl">{t("bots.emptyHelp")}</p>
            <Link href="/" className="label text-depth mt-6 inline-block">
              {t("bots.emptyAction")} →
            </Link>
          </section>
        ) : (
          <ul className="mt-2 list-none p-0">
            {bots.map((bot) => (
              <li key={bot.id} className="border-rule border-b">
                <Link
                  href={`/bots/${bot.id}`}
                  className="group text-ink flex flex-col gap-4 py-6 no-underline sm:flex-row sm:items-baseline sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <h2 className="font-display group-hover:text-depth text-xl font-semibold tracking-tight transition-colors">
                      {bot.name}
                    </h2>
                    <p className="text-ink-soft mt-1 text-[0.95rem]">
                      {t("bots.runs")}: {bot.strategy.name} · v{bot.strategy.version}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-baseline gap-6">
                    {bot.live ? (
                      <>
                        <span className="sounding text-ink-soft text-[0.95rem]">
                          {t("bots.openPositions")} {format.number(bot.live.openPositions)}
                        </span>
                        <span
                          className={`sounding text-[0.95rem] ${
                            bot.live.profitRatio < 0 ? "text-alert" : ""
                          }`}
                        >
                          {format.number(displayable(bot.live.profitRatio), PERCENT)}
                        </span>
                      </>
                    ) : null}
                    <BotStatusLabel status={bot.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>

      <SiteFooter />
    </>
  );
}
