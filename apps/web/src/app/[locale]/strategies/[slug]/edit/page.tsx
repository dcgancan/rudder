import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { fromRuleset } from "@rudder/ruleset";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { StrategyEditor } from "@/components/StrategyEditor";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { editableRuleset } from "@/lib/authoring";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; slug: string }> };

export default async function EditStrategyPage({ params }: Props) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const row = editableRuleset(slug);
  if (!row) notFound();

  const t = await getTranslations("editor");
  const opened = fromRuleset(row.body, locale);

  // Repoyla gelen stratejiler değişmez: kaydetmek kullanıcının kendi kopyasını
  // yaratır. Kendi stratejisi ise yeni bir sürüm alır.
  const forking = row.source === "builtin";

  return (
    <>
      <SiteHeader />

      <main id="content" className="mx-auto max-w-3xl px-6 pb-20">
        <nav className="pt-8">
          <Link
            href={`/strategies/${slug}`}
            className="text-ink-soft hover:text-depth text-[0.95rem] no-underline"
          >
            {/*
              Ad kullanıcı verisi ve `.label` ile büyük harfe çevrilmiyor:
              büyük harf kuralı sayfanın diline göre işliyor ve Türkçe bir adı
              İngilizce sayfada büyütmek noktalarını düşürüyor ("STRATEJISI").
            */}
            ← {row.body.name[locale] ?? row.body.name["en"]}
          </Link>
        </nav>

        <header className="border-rule border-b pb-8">
          <h1 className="font-display mt-6 text-4xl font-semibold tracking-tight text-balance">
            {forking ? t("forkHeading") : t("editHeading")}
          </h1>
          <p className="text-ink-soft mt-4 max-w-xl text-[0.95rem]">
            {forking
              ? t("forkNote")
              : t("versionNote", { current: row.version, next: row.version + 1 })}
          </p>
        </header>

        {opened.ok ? (
          <StrategyEditor initial={opened.draft} slug={slug} forking={forking} />
        ) : (
          /*
            Sessizce düzleştirmek, kullanıcının okuduğu cümle ile kaydettiği
            kuralı ayırırdı. Açamadığımızda sebebini söylüyoruz.
          */
          <section className="border-shoal my-8 border-l-2 py-2 pl-5">
            <p className="text-lg">{t("notEditable")}</p>
            <p className="text-ink-soft mt-2 max-w-xl text-[0.95rem]">
              {t(
                opened.reason === "nested"
                  ? "notEditableNested"
                  : opened.reason === "negated"
                    ? "notEditableNegated"
                    : "notEditableBare",
              )}
            </p>
          </section>
        )}
      </main>

      <SiteFooter />
    </>
  );
}
