import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { emptyDraft } from "@rudder/ruleset";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { StrategyEditor } from "@/components/StrategyEditor";
import { routing } from "@/i18n/routing";

/* Editör kaydedince katalog değişiyor; dondurulmuş bir sayfa eskir. */
export const dynamic = "force-dynamic";

export default async function NewStrategyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("editor");

  return (
    <>
      <SiteHeader />

      <main id="content" className="mx-auto max-w-3xl px-6 pb-20">
        <header className="border-rule border-b pt-12 pb-8">
          <h1 className="font-display text-4xl font-semibold tracking-tight">{t("newHeading")}</h1>
        </header>

        <StrategyEditor initial={emptyDraft()} slug="" forking />
      </main>

      <SiteFooter />
    </>
  );
}
